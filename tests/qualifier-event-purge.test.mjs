import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const migration = read('../supabase/migrations/20260816140000_qualifier_event_purge.sql');
const persistenceRoute = read('../src/app/api/admin/persistence/route.ts');
const appContext = read('../src/context/AppContext.tsx');
const adminPage = read('../src/app/admin/page.tsx');

test('Qualifier purge is transactional, scoped, and removes restrictive dependencies before the event', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION qualifier_purge_event\(/);
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /SECURITY DEFINER\nSET search_path = pg_catalog, public, pg_temp/);
  assert.match(migration, /SELECT \* INTO v_event[\s\S]*FOR UPDATE/);
  assert.match(migration, /DELETE FROM contestations[\s\S]*DELETE FROM score_submission_reviews[\s\S]*DELETE FROM score_submission_versions[\s\S]*DELETE FROM score_submissions[\s\S]*DELETE FROM events/);
  assert.match(migration, /event_id = v_event\.id/);
  assert.match(migration, /submission_id IN \([\s\S]*score_submissions WHERE event_id = v_event\.id/);
  assert.doesNotMatch(migration, /EXCEPTION WHEN OTHERS/);
});

test('the history immutability bypass is limited to the purge transaction', () => {
  for (const [functionName, errorName] of [
    ['qualifier_prevent_review_mutation', 'qualifier_review_history_is_immutable'],
    ['qualifier_prevent_submission_version_mutation', 'qualifier_submission_version_history_is_immutable']
  ]) {
    const block = migration.match(new RegExp(`CREATE OR REPLACE FUNCTION ${functionName}\\(\\)[\\s\\S]*?\\$\\$;`))?.[0] || '';
    assert.match(block, /TG_OP = 'DELETE'/);
    assert.match(block, /current_setting\('app\.qualifier_event_purge', true\) = 'on'/);
    assert.match(block, new RegExp(`RAISE EXCEPTION '${errorName}'`));
  }
  assert.match(migration, /PERFORM set_config\('app\.qualifier_event_purge', 'on', true\)/);
  assert.match(migration, /REVOKE ALL ON FUNCTION qualifier_purge_event\(TEXT, TEXT, TEXT\) FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION qualifier_purge_event\(TEXT, TEXT, TEXT\) TO service_role/);
});

test('only an authorized actor with a server-validated name confirmation can purge a Qualifier', () => {
  assert.match(migration, /v_actor\.role NOT IN \('manager', 'owner'\)/);
  assert.match(migration, /v_actor\.role = 'manager' AND v_event\.organizer_id <> v_actor\.id/);
  assert.match(migration, /qualifier_manager_access_expired/);
  assert.match(migration, /trim\(coalesce\(p_event_name_confirmation, ''\)\) <> v_event\.name/);

  const deleteEventBlock = persistenceRoute.match(/case 'deleteEvent': \{[\s\S]*?\n      \}/)?.[0] || '';
  assert.match(persistenceRoute, /select\('id, name, organizer_id, event_type, event_schedule'\)/);
  assert.match(deleteEventBlock, /ensureEventOwner\(supabaseAdmin, actor, payload\.eventId\)/);
  assert.match(deleteEventBlock, /confirmation !== event\.name/);
  assert.match(deleteEventBlock, /isQualifierEvent\(event\.event_type\)/);
  assert.match(deleteEventBlock, /rpc\('qualifier_purge_event'/);
  assert.match(deleteEventBlock, /p_actor_id: actor\.id/);
  assert.match(deleteEventBlock, /p_event_name_confirmation: confirmation/);
  assert.match(persistenceRoute, /const qualifierDeleteErrorResponse = \(error: unknown\) =>/);
});

test('the existing dialog sends the confirmation and describes destructive Qualifier data', () => {
  assert.match(appContext, /deleteEvent: \(eventId: string, confirmation: string\) => Promise<void>/);
  assert.match(appContext, /adminPersist\('deleteEvent', \{ eventId, confirmation \}\)/);
  assert.match(adminPage, /deleteEvent\(eventPendingDeletion\.id, deleteEventConfirmation\.trim\(\)\)/);
  assert.match(adminPage, /eventPendingDeletion\.eventType === 'functional_fitness_qualifier'/);
  assert.match(adminPage, /submissões, versões, revisões, contestações e vínculos de Judge/);
  assert.match(adminPage, /text: err instanceof Error \? err\.message/);
});
