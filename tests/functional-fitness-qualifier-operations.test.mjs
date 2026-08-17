import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const adminPage = read('../src/app/admin/page.tsx');
const appContext = read('../src/context/AppContext.tsx');
const persistenceRoute = read('../src/app/api/admin/persistence/route.ts');
const judgeAccess = read('../src/lib/serverJudgeAccess.ts');
const ownerJudgeMigration = read('../supabase/migrations/20260816130000_qualifier_owner_judge_access.sql');
const originalJudgeMigration = read('../supabase/migrations/20260816120000_functional_fitness_qualifier.sql');
const submissionWindowSource = read('../src/lib/submissionWindow.ts');
const submissionWindowCompiled = ts.transpileModule(submissionWindowSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText;
const submissionWindow = await import(`data:text/javascript;base64,${Buffer.from(submissionWindowCompiled).toString('base64')}`);

test('Qualifier deadline belongs to the workout form and supports Fortaleza round trips', () => {
  const categoriesTab = adminPage.match(/const renderAbaCategories = \(\) => \{[\s\S]*?const renderAbaWods = \(\) => \{/)?.[0] || '';
  assert.match(adminPage, /wod-submission-opens-at/);
  assert.match(adminPage, /wod-submission-closes-at/);
  assert.match(adminPage, /eventType === 'functional_fitness_qualifier'/);
  assert.match(adminPage, /Prazo final de envio/);
  assert.match(adminPage, /normalizeQualifierSubmissionWindow\(wodSubmissionOpensAt, wodSubmissionClosesAt\)/);
  assert.match(adminPage, /fortalezaDateTimeLocalToUtc\(wodSubmissionClosesAt\)/);
  assert.match(adminPage, /utcToFortalezaDateTimeLocal\(workout\.submissionClosesAt\)/);
  assert.doesNotMatch(categoriesTab, /wod-submission-(opens|closes)/);

  const utc = submissionWindow.fortalezaDateTimeLocalToUtc('2026-08-16T10:30');
  assert.equal(utc, '2026-08-16T13:30:00.000Z');
  assert.equal(submissionWindow.utcToFortalezaDateTimeLocal(utc), '2026-08-16T10:30');
  assert.equal(submissionWindow.utcToFortalezaDateTimeLocal('not-a-date'), '');
  assert.deepEqual(
    submissionWindow.normalizeQualifierSubmissionWindow('2026-08-16T09:00', '2026-08-16T10:30'),
    { opensAt: '2026-08-16T12:00:00.000Z', closesAt: '2026-08-16T13:30:00.000Z' }
  );
  assert.throws(
    () => submissionWindow.normalizeQualifierSubmissionWindow('2026-08-16T10:30', '2026-08-16T10:30'),
    /abertura da submissão deve ser anterior/
  );
  assert.throws(
    () => submissionWindow.normalizeQualifierSubmissionWindow('2026-08-16T11:00', '2026-08-16T10:30'),
    /abertura da submissão deve ser anterior/
  );
  assert.throws(
    () => submissionWindow.normalizeQualifierSubmissionWindow('data-inválida', '2026-08-16T10:30'),
    /abertura da submissão/
  );
});

test('workouts can be edited without recreating them and nullable fields can be cleared', () => {
  assert.match(adminPage, /const handleEditWorkout = \(workout: Workout\)/);
  assert.match(adminPage, /await updateWorkout\(selectedEventToManage\.id, editingWorkoutId, workoutData\)/);
  assert.match(adminPage, /Salvar Alterações/);
  assert.match(adminPage, /onClick=\{resetWorkoutForm\}/);
  assert.match(adminPage, /aria-label=\{`Editar prova \$\{wod\.name\}`\}/);
  assert.match(appContext, /Object\.hasOwn\(updatedData, 'timeCap'\)/);
  assert.match(appContext, /Object\.hasOwn\(updatedData, 'divisionId'\)/);
  assert.match(appContext, /Object\.hasOwn\(updatedData, 'submissionClosesAt'\)/);

  const updateWorkoutImplementation = appContext.match(/const updateWorkout = async \(eventId: string, workoutId: string, updatedData: Partial<Workout>\) => \{[\s\S]*?\n  \};\n\n  return \(/)?.[0] || '';
  assert.match(updateWorkoutImplementation, /const previousEvents = events;/);
  assert.match(updateWorkoutImplementation, /await adminPersist\('updateWorkout', \{ eventId, workoutId, data: dbData \}\)/);
  assert.match(updateWorkoutImplementation, /catch \(error\) \{\s*setEvents\(previousEvents\);/);
});

test('a Judge can be owned by a manager or owner without weakening privileged RPC access', () => {
  assert.match(originalJudgeMigration, /qualifier_create_and_assign_judge/);
  assert.match(ownerJudgeMigration, /CREATE OR REPLACE FUNCTION qualifier_create_judge/);
  assert.match(ownerJudgeMigration, /role IN \('manager', 'owner'\)/);
  assert.match(ownerJudgeMigration, /v_organizer\.role = 'manager'/);
  assert.match(ownerJudgeMigration, /CREATE OR REPLACE FUNCTION qualifier_apply_review/);
  assert.match(ownerJudgeMigration, /v_parent_organizer\.role = 'manager'/);
  assert.match(ownerJudgeMigration, /CREATE OR REPLACE FUNCTION qualifier_remove_judge/);
  assert.match(ownerJudgeMigration, /qualifier_remove_judge[\s\S]*qualifier_manager_access_expired/);
  assert.match(ownerJudgeMigration, /REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated/);
  assert.match(ownerJudgeMigration, /REVOKE ALL ON FUNCTION qualifier_create_judge[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(ownerJudgeMigration, /REVOKE ALL ON FUNCTION qualifier_remove_judge[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(ownerJudgeMigration, /GRANT EXECUTE ON FUNCTION qualifier_create_judge[\s\S]*TO service_role/);
  assert.match(judgeAccess, /data\.role !== 'manager' && data\.role !== 'owner'/);
  assert.match(judgeAccess, /data\.role === 'manager' && isManagerAccessBlocked/);
  assert.match(judgeAccess, /assertOrganizerIsOperational\(supabaseAdmin, judge\.parent_manager_id\)/);
});

test('Judge creation explains safe, actionable domain errors without exposing database details', () => {
  assert.match(persistenceRoute, /const judgeCreationErrorResponse = \(error: unknown\) =>/);
  assert.match(persistenceRoute, /message === 'qualifier_judge_email_exists'/);
  assert.match(persistenceRoute, /Este e-mail já está cadastrado/);
  assert.match(persistenceRoute, /code === 'PGRST202'/);
  assert.match(persistenceRoute, /migrations pendentes/);
  assert.match(persistenceRoute, /const response = judgeCreationErrorResponse\(judgeError\);/);
  assert.match(persistenceRoute, /if \(response\) return response;/);
  assert.match(persistenceRoute, /throw judgeError;/);
});
