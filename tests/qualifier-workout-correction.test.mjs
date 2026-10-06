import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const adminPage = read('../src/app/admin/page.tsx');
const persistenceRoute = read('../src/app/api/admin/persistence/route.ts');
const migration = read('../supabase/migrations/20261006120000_qualifier_workout_correction.sql');
const workoutEditSource = read('../src/lib/workoutEdit.ts');
const workoutEditCompiled = ts.transpileModule(workoutEditSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText;
const {
  canChangeQualifierWorkoutType,
  getQualifierWorkoutLockViolations,
  getWorkoutChanges,
  isQualifierWorkoutLocked
} = await import(`data:text/javascript;base64,${Buffer.from(workoutEditCompiled).toString('base64')}`);

const current = {
  type: 'amrap',
  divisionId: undefined,
  submissionOpensAt: '2026-09-22T11:00:00+00:00',
  submissionClosesAt: '2026-09-26T02:59:00+00:00'
};
const withSubmissions = { submissionCount: 2, reviewedCount: 0 };
const withReviewed = { submissionCount: 2, reviewedCount: 1 };
const fields = (violations) => violations.map((violation) => violation.field);

test('without submissions nothing is locked', () => {
  assert.equal(isQualifierWorkoutLocked({ submissionCount: 0, reviewedCount: 0 }), false);
  assert.equal(isQualifierWorkoutLocked(undefined), false);
  assert.deepEqual(getQualifierWorkoutLockViolations(current, {
    type: 'fortime', divisionId: 'div-1', submissionOpensAt: undefined, submissionClosesAt: '2026-01-01T00:00:00Z'
  }, { submissionCount: 0, reviewedCount: 0 }), []);
});

test('type can be corrected between numeric score types while nothing is reviewed', () => {
  assert.deepEqual(getQualifierWorkoutLockViolations(current, { type: 'maxweight' }, withSubmissions), []);
  assert.equal(canChangeQualifierWorkoutType('reps', 'distance', withSubmissions).allowed, true);
});

test('type change is blocked once a result is reviewed', () => {
  const violations = getQualifierWorkoutLockViolations(current, { type: 'maxweight' }, withReviewed);
  assert.deepEqual(fields(violations), ['type']);
  assert.match(violations[0].message, /resultados revisados/);
  assert.match(violations[0].message, /reenvio/);
});

test('type change from or to time is always blocked after submissions', () => {
  assert.deepEqual(fields(getQualifierWorkoutLockViolations(current, { type: 'fortime' }, withSubmissions)), ['type']);
  const fromTime = getQualifierWorkoutLockViolations({ ...current, type: 'fortime' }, { type: 'amrap' }, withSubmissions);
  assert.deepEqual(fields(fromTime), ['type']);
  assert.match(fromTime[0].message, /Tempo/);
});

test('deadline can only be extended after submissions', () => {
  const extended = { submissionClosesAt: '2026-09-28T02:59:00+00:00' };
  assert.deepEqual(getQualifierWorkoutLockViolations(current, extended, withReviewed), []);
  assert.deepEqual(fields(getQualifierWorkoutLockViolations(current, { submissionClosesAt: '2026-09-25T02:59:00+00:00' }, withSubmissions)), ['submissionClosesAt']);
  assert.deepEqual(fields(getQualifierWorkoutLockViolations(current, { submissionClosesAt: undefined }, withSubmissions)), ['submissionClosesAt']);
});

test('same instant in another format is not a change', () => {
  assert.deepEqual(getQualifierWorkoutLockViolations(current, {
    submissionOpensAt: '2026-09-22T11:00:00.000Z',
    submissionClosesAt: '2026-09-26T02:59:00.000Z'
  }, withReviewed), []);
});

test('division and opening time stay locked after submissions', () => {
  assert.deepEqual(
    fields(getQualifierWorkoutLockViolations(current, { divisionId: 'div-1', submissionOpensAt: '2026-09-23T11:00:00Z' }, withSubmissions)).sort(),
    ['divisionId', 'submissionOpensAt']
  );
  // Reenviar o mesmo valor (ou limpar um campo já vazio) não é mudança.
  assert.deepEqual(getQualifierWorkoutLockViolations(current, { divisionId: undefined }, withSubmissions), []);
});

test('getWorkoutChanges returns only what changed and keeps cleared optional fields', () => {
  const original = {
    id: 'wod-1', name: 'PROVA 1', description: 'desc', type: 'amrap', timeCap: '10', code: 'PROVA 1', orderIndex: 1,
    divisionId: undefined, tieBreaker: 'AMRAP',
    submissionOpensAt: '2026-09-22T11:00:00+00:00', submissionClosesAt: '2026-09-26T02:59:00+00:00'
  };
  const unchanged = Object.fromEntries(Object.entries(original).filter(([key]) => key !== 'id'));
  assert.deepEqual(getWorkoutChanges(original, { ...unchanged, submissionOpensAt: '2026-09-22T11:00:00.000Z' }), {});

  const changes = getWorkoutChanges(original, { ...unchanged, type: 'maxweight', timeCap: undefined, tieBreaker: '' });
  assert.deepEqual(Object.keys(changes).sort(), ['tieBreaker', 'timeCap', 'type']);
  assert.ok(Object.hasOwn(changes, 'timeCap'), 'timeCap limpo precisa continuar presente para gravar NULL');
});

test('migration relaxes the workout trigger without touching the other protections', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION qualifier_protect_workout_after_submission\(\)/);
  // exclusão com submissões continua proibida
  assert.match(migration, /TG_OP = 'DELETE'[\s\S]*qualifier_workout_has_submissions/);
  // identidade e abertura do envio continuam travadas
  assert.match(migration, /NEW\.division_id IS DISTINCT FROM OLD\.division_id[\s\S]*NEW\.submission_opens_at IS DISTINCT FROM OLD\.submission_opens_at[\s\S]*qualifier_workout_identity_or_window_locked/);
  // prazo só estende
  assert.match(migration, /NEW\.submission_closes_at < OLD\.submission_closes_at[\s\S]*qualifier_workout_deadline_extend_only/);
  // tipo: só numéricos e sem resultado ativo
  assert.match(migration, /ARRAY\['amrap', 'reps', 'maxweight', 'distance', 'points'\]/);
  assert.doesNotMatch(migration.match(/ARRAY\[[^\]]*\]/)?.[0] || '', /fortime/);
  assert.match(migration, /status IN \('validated', 'penalized', 'rejected'\)[\s\S]*qualifier_workout_type_locked_reviewed/);
  assert.doesNotMatch(migration, /DROP TRIGGER|CREATE TRIGGER/);
});

test('persistence route explains workout locks with HTTP 409 and exposes lock state to the manager', () => {
  const updateBlock = persistenceRoute.match(/case 'updateWorkout': \{[\s\S]*?\n {6}\}/)?.[0] || '';
  assert.match(updateBlock, /getQualifierWorkoutLockViolations\(/);
  assert.match(updateBlock, /status: 409/);
  assert.match(updateBlock, /qualifierWorkoutLockErrorResponse\(error\)/);

  const deleteBlock = persistenceRoute.match(/case 'deleteWorkout': \{[\s\S]*?\n {6}\}/)?.[0] || '';
  assert.match(deleteBlock, /qualifierWorkoutLockErrorResponse\(error\)/);

  for (const code of [
    'qualifier_workout_has_submissions',
    'qualifier_workout_identity_or_window_locked',
    'qualifier_workout_deadline_extend_only',
    'qualifier_workout_type_change_not_allowed',
    'qualifier_workout_type_locked_reviewed'
  ]) {
    assert.match(migration + persistenceRoute, new RegExp(code));
    assert.match(persistenceRoute, new RegExp(`${code}:`));
  }

  const locksBlock = persistenceRoute.match(/case 'getQualifierWorkoutLocks': \{[\s\S]*?\n {6}\}/)?.[0] || '';
  assert.match(locksBlock, /ensureEventOwner\(supabaseAdmin, actor, payload\.eventId\)/);
  assert.match(locksBlock, /isQualifierEvent\(event\.event_type\)/);
});

test('admin form disables locked fields, sends only changes and surfaces the server message', () => {
  assert.match(adminPage, /getQualifierWorkoutLocks/);
  assert.match(adminPage, /getWorkoutChanges\(originalWorkout/);
  assert.match(adminPage, /id="wod-division-id"[\s\S]*?disabled=\{editingLocked\}/);
  assert.match(adminPage, /id="wod-submission-opens-at"[\s\S]*?disabled=\{editingLocked\}/);
  assert.match(adminPage, /id="wod-score-type-input"[\s\S]*?disabled=\{scoreTypeLocked\}/);
  assert.match(adminPage, /id="wod-submission-closes-at"[\s\S]*?min=\{/);
  assert.match(adminPage, /err instanceof Error \? err\.message : 'Não foi possível excluir a prova\.'/);
});
