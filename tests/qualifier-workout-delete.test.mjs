import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Story 1.37: prova de Qualifier travada só com resultado ativo e exclusão de
// prova com submissões pelo gestor organizador.

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const migration = read('../supabase/migrations/20261008120000_qualifier_workout_active_lock_and_delete.sql');
const persistenceRoute = read('../src/app/api/admin/persistence/route.ts');
const resend = read('../src/lib/resend.ts');
const appContext = read('../src/context/AppContext.tsx');
const adminPage = read('../src/app/admin/page.tsx');
const cli = read('../bin/qualifier.mjs');
const workoutEditSource = read('../src/lib/workoutEdit.ts');
const workoutEditCompiled = ts.transpileModule(workoutEditSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText;
const {
  getWorkoutDeleteConfirmationText,
  hasQualifierWorkoutSubmissions,
  isQualifierWorkoutLocked
} = await import(`data:text/javascript;base64,${Buffer.from(workoutEditCompiled).toString('base64')}`);

const functionBlock = (name) => migration.match(new RegExp(`CREATE OR REPLACE FUNCTION ${name}\\([\\s\\S]*?\\n\\$\\$;`))?.[0] || '';

const RPC_ERROR_CODES = [
  'qualifier_workout_delete_not_allowed',
  'qualifier_workout_delete_confirmation_invalid',
  'qualifier_workout_delete_justification_required',
  'qualifier_manager_access_expired',
  'qualifier_workout_not_found',
  'qualifier_event_not_found',
  'qualifier_event_required'
];

test('a workout is locked only by submissions with a result in play', () => {
  assert.equal(isQualifierWorkoutLocked({ submissionCount: 1, activeCount: 0, reviewedCount: 0 }), false);
  assert.equal(isQualifierWorkoutLocked({ submissionCount: 2, activeCount: 1, reviewedCount: 0 }), true);
  assert.equal(hasQualifierWorkoutSubmissions({ submissionCount: 1, activeCount: 0, reviewedCount: 0 }), true);
  assert.equal(hasQualifierWorkoutSubmissions({ submissionCount: 0, activeCount: 0, reviewedCount: 0 }), false);
  assert.equal(hasQualifierWorkoutSubmissions(undefined), false);
});

test('the delete confirmation is the workout code, or the name when the code is empty', () => {
  assert.equal(getWorkoutDeleteConfirmationText({ code: ' PROVA 1 ', name: 'Cardio Burn' }), 'PROVA 1');
  assert.equal(getWorkoutDeleteConfirmationText({ code: '', name: ' Cardio Burn ' }), 'Cardio Burn');
  assert.match(functionBlock('qualifier_delete_workout'), /COALESCE\(NULLIF\(trim\(v_workout\.code\), ''\), trim\(v_workout\.name\)\)/);
});

test('the workout trigger keeps identity locked but relaxes the rules while only resubmissions are pending', () => {
  const block = functionBlock('qualifier_protect_workout_after_submission');
  assert.match(block, /TG_OP = 'DELETE'[\s\S]*EXISTS \(SELECT 1 FROM score_submissions WHERE workout_id = OLD\.id\)[\s\S]*qualifier_workout_has_submissions/);
  assert.match(block, /NEW\.event_id IS DISTINCT FROM OLD\.event_id[\s\S]*status <> 'awaiting_resubmission'[\s\S]*NEW\.division_id IS DISTINCT FROM OLD\.division_id/);
  assert.match(block, /NEW\.submission_closes_at < OLD\.submission_closes_at[\s\S]*qualifier_workout_deadline_extend_only/);
  assert.match(block, /ARRAY\['amrap', 'reps', 'maxweight', 'distance', 'points'\]/);
  assert.match(block, /status IN \('validated', 'penalized', 'rejected'\)[\s\S]*qualifier_workout_type_locked_reviewed/);
  assert.doesNotMatch(migration, /DROP TRIGGER|CREATE TRIGGER/);
});

test('history immutability only opens for DELETE inside the event or workout purge transaction', () => {
  for (const [functionName, errorName] of [
    ['qualifier_prevent_review_mutation', 'qualifier_review_history_is_immutable'],
    ['qualifier_prevent_submission_version_mutation', 'qualifier_submission_version_history_is_immutable']
  ]) {
    const block = functionBlock(functionName);
    assert.match(block, /TG_OP = 'DELETE'/);
    assert.match(block, /current_setting\('app\.qualifier_event_purge', true\) = 'on'/);
    assert.match(block, /current_setting\('app\.qualifier_workout_purge', true\) = 'on'/);
    assert.match(block, new RegExp(`RAISE EXCEPTION '${errorName}'`));
  }
});

test('qualifier_delete_workout is organizer-only, confirmed, justified and removes everything in one transaction', () => {
  const block = functionBlock('qualifier_delete_workout');
  assert.match(block, /SECURITY DEFINER\nSET search_path = pg_catalog, public, pg_temp/);
  assert.match(block, /v_actor\.role IS DISTINCT FROM 'manager'[\s\S]*?qualifier_workout_delete_not_allowed/);
  assert.match(block, /v_event\.organizer_id IS DISTINCT FROM v_actor\.id[\s\S]*?qualifier_workout_delete_not_allowed/);
  assert.match(block, /service_valid_until < timezone\('America\/Fortaleza', NOW\(\)\)::DATE[\s\S]*?qualifier_manager_access_expired/);
  assert.match(block, /FROM workouts\s+WHERE id = p_workout_id AND event_id = v_event\.id\s+FOR UPDATE/);
  assert.match(block, /qualifier_workout_delete_confirmation_invalid/);
  assert.match(block, /length\(p_justification\) > 2000[\s\S]*?qualifier_workout_delete_justification_required/);
  assert.match(block, /PERFORM 1 FROM score_submissions WHERE workout_id = v_workout\.id FOR UPDATE/);
  assert.match(block, new RegExp([
    "set_config\\('app\\.qualifier_workout_purge', 'on', true\\)",
    'DELETE FROM contestations',
    'DELETE FROM score_submission_reviews',
    'DELETE FROM score_submission_versions',
    'DELETE FROM scores WHERE workout_id = v_workout\\.id',
    'DELETE FROM score_submissions WHERE id = ANY \\(v_submission_ids\\)',
    "set_config\\('app\\.qualifier_workout_purge', 'off', true\\)",
    'INSERT INTO qualifier_workout_deletions',
    'DELETE FROM workouts WHERE id = v_workout\\.id'
  ].join('[\\s\\S]*')));
  assert.match(block, /'registrationIds', to_jsonb\(v_registration_ids\)/);
  assert.doesNotMatch(migration, /EXCEPTION WHEN OTHERS/);
  assert.match(migration, /REVOKE ALL ON FUNCTION qualifier_delete_workout\(TEXT, TEXT, TEXT, TEXT, TEXT\) FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION qualifier_delete_workout\(TEXT, TEXT, TEXT, TEXT, TEXT\) TO service_role/);
});

test('the deletion audit is private to the server and follows the event purge', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS qualifier_workout_deletions \(/);
  assert.match(migration, /event_id TEXT NOT NULL REFERENCES events\(id\) ON DELETE CASCADE/);
  assert.match(migration, /removed_submissions JSONB NOT NULL/);
  assert.match(migration, /ALTER TABLE qualifier_workout_deletions ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE qualifier_workout_deletions FROM PUBLIC, anon, authenticated/);
});

test('the persistence route sends qualifier workouts with submissions to the organizer-only deletion', () => {
  const deleteBlock = persistenceRoute.match(/case 'deleteWorkout': \{[\s\S]*?\n {6}\}/)?.[0] || '';
  assert.match(deleteBlock, /isQualifierEvent\(event\.event_type\)[\s\S]*loadQualifierWorkoutLocks\(supabaseAdmin, \[payload\.workoutId\]\)[\s\S]*hasQualifierWorkoutSubmissions\([\s\S]*deleteQualifierWorkoutWithSubmissions\(/);
  // Provas sem submissões seguem a exclusão simples de sempre.
  assert.match(deleteBlock, /from\('workouts'\)\.delete\(\)\.eq\('id', payload\.workoutId\)[\s\S]*qualifierWorkoutLockErrorResponse\(error\)/);

  const helper = persistenceRoute.match(/const deleteQualifierWorkoutWithSubmissions = async \([\s\S]*?\n\};/)?.[0] || '';
  assert.match(helper, /actor\.role !== 'manager' \|\| event\.organizer_id !== actor\.id[\s\S]*?status: 403/);
  // Painel com travas desatualizadas (confirmação simples): pede a confirmação reforçada.
  assert.match(helper, /if \(!confirmation && !justification\) \{[\s\S]*?qualifier_workout_delete_confirmation_required[\s\S]*?status: 409/);
  assert.match(helper, /rpc\('qualifier_delete_workout', \{[\s\S]*p_actor_id: actor\.id[\s\S]*p_confirmation: confirmation[\s\S]*p_justification: justification/);
  assert.match(helper, /qualifierWorkoutDeleteErrorResponse\(error\)[\s\S]*notifyAthletesOfDeletedWorkout\(/);
  assert.match(persistenceRoute, /sendQualifierWorkoutDeletedEmails\(\{ recipients, \.\.\.details \}\)/);

  for (const code of RPC_ERROR_CODES) {
    assert.match(migration, new RegExp(`RAISE EXCEPTION '${code}'`));
    assert.match(persistenceRoute, new RegExp(`${code}: \\{ error: `));
  }
});

test('lock state counts active results separately from all submissions', () => {
  const loader = persistenceRoute.match(/const loadQualifierWorkoutLocks = async [\s\S]*?\n\};/)?.[0] || '';
  assert.match(loader, /\.neq\('status', 'awaiting_resubmission'\)/);
  assert.match(loader, /submissionCount: submissions\.count \?\? 0/);
  assert.match(loader, /activeCount: active\.count \?\? 0/);
  assert.match(workoutEditSource, /isQualifierWorkoutLocked = \(lock\?: QualifierWorkoutLock \| null\) => Boolean\(lock && lock\.activeCount > 0\)/);
});

test('athletes get one e-mail each, sent in Resend batches, with the escaped reason', () => {
  const sender = resend.match(/export async function sendQualifierWorkoutDeletedEmails[\s\S]*?\n\}\n/)?.[0] || '';
  assert.match(resend, /const RESEND_BATCH_LIMIT = 100;/);
  assert.match(sender, /https:\/\/api\.resend\.com\/emails\/batch/);
  assert.match(sender, /chunk\.map\(recipient => \(\{[\s\S]*to: recipient\.to/);
  assert.match(resend, /const safeJustification = escapeHtml\(params\.justification \|\| ''\);[\s\S]*<h1>Prova removida<\/h1>/);
  assert.match(resend, /envie um novo vídeo e resultado/);
});

test('the admin opens a strong confirmation before deleting a qualifier workout with submissions', () => {
  assert.match(adminPage, /onClick=\{\(\) => requestDeleteWorkout\(wod\)\}/);
  assert.doesNotMatch(adminPage, /disabled=\{isQualifierWorkoutLocked\(qualifierWorkoutLocks\[wod\.id\]\)\}/);
  assert.doesNotMatch(adminPage, /Provas que já receberam submissões não podem ser excluídas/);
  assert.match(adminPage, /const requestDeleteWorkout = \(workout: Workout\) => \{\n\s+if \(hasQualifierWorkoutSubmissions\(qualifierWorkoutLocks\[workout\.id\]\)\)/);

  assert.match(adminPage, /aria-labelledby="delete-workout-title"/);
  assert.match(adminPage, /Todos os resultados desta prova serão perdidos/);
  assert.match(adminPage, /que enviar novamente/);
  assert.match(adminPage, /checked=\{deleteWorkoutAcknowledged\}/);
  assert.match(adminPage, /id="delete-workout-justification"/);
  assert.match(adminPage, /const confirmationText = getWorkoutDeleteConfirmationText\(workoutPendingDeletion\);/);
  assert.match(adminPage, /&& deleteWorkoutAcknowledged\n\s+&& justification\.length > 0[\s\S]*?&& deleteWorkoutConfirmation\.trim\(\) === confirmationText;/);
  assert.match(adminPage, /deleteWorkout\(selectedEventToManage\.id, workout\.id, \{\n\s+confirmation: deleteWorkoutConfirmation\.trim\(\),\n\s+justification: deleteWorkoutJustification\.trim\(\)\n\s+\}\)/);
  assert.match(adminPage, /editingLock\?\.activeCount/);
  // Recusa do servidor recarrega as travas (submissão pode ter chegado depois do carregamento).
  assert.match(adminPage, /\}, \[activeEventTab, selectedQualifierEventId, qualifierLocksVersion\]\);/);
  assert.ok((adminPage.match(/setQualifierLocksVersion\(version => version \+ 1\)/g) || []).length >= 3);

  assert.match(appContext, /qualifierConfirmation\?: QualifierWorkoutDeleteConfirmation\n\s+\) => Promise<QualifierWorkoutDeleteResult \| null>;/);
  assert.match(appContext, /adminPersist\('deleteWorkout', \{ eventId, workoutId, \.\.\.qualifierConfirmation \}\)/);
});

test('the qualifier CLI deletes a workout through the same RPC (CLI First)', () => {
  assert.match(cli, /if \(area === 'workout'\) return workout\(supabase, command, args\);/);
  assert.match(cli, /requireArgs\(args, \['actor', 'event', 'workout', 'confirm', 'justification'\]\)/);
  assert.match(cli, /rpc\('qualifier_delete_workout', \{[\s\S]*p_confirmation: String\(args\.confirm\)\.trim\(\)/);
  assert.match(cli, /workout delete --actor MANAGER_ID --event EVENT_ID --workout WORKOUT_ID --confirm/);
});
