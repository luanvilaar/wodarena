import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createFakeSupabase } from './support/fakeSupabase.mjs';
import { importServerModule } from './support/serverModuleHarness.mjs';

// Story 1.148 (docs/design/quadra-por-raia/, D4 e D8): o judge libera a súmula
// vazia aberta por engano (ela é apagada, não vira cancelada) e o gestor libera
// a súmula para outro judge sem apagar os registros.

const sheets = await importServerModule('lib/serverScoresheets.ts');
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const judge = { id: 'judge-a', name: 'Judge A', role: 'judge' };
const other = { id: 'judge-b', name: 'Judge B', role: 'judge' };
const manager = { id: 'manager-1', name: 'Gestor', role: 'manager' };

const sheetRow = (overrides = {}) => ({
  id: 'sheet-1', event_id: 'ev-1', workout_id: 'w-1', athlete_id: 'a-1', division_id: 'd-1', heat_id: 'h-4', heat_number: 4, lane: 3,
  judge_user_id: judge.id, judge_name: judge.name, structure: { format: 'amrap' }, status: 'in_progress', absent: false,
  computed_result: null, computed_value: null, computed_tie_break: null, official_result: null, official_value: null, official_tie_break: null,
  corrected: false, return_reason: null, submitted_at: null, published_at: null, created_at: '2026-11-15T13:00:00Z', updated_at: '2026-11-15T13:00:00Z',
  ...overrides
});
const event = (seq) => ({ sheet_id: 'sheet-1', seq, client_event_id: `c${seq}`, event: { t: 'rep', seg: 's1', at: seq }, author_user_id: judge.id, recorded_at: '2026-11-15T13:01:00Z' });

const rejects = async (promise, status, pattern) => {
  await assert.rejects(promise, (error) => {
    assert.equal(error.status, status);
    assert.match(error.message, pattern);
    return true;
  });
};

test('judge libera a súmula vazia: a linha some, sem cancelamento no histórico', async () => {
  const db = createFakeSupabase({ scoresheets: [sheetRow()], scoresheet_events: [], scoresheet_reviews: [] });
  const result = await sheets.releaseEmptySheet(db.client, judge, 'sheet-1');
  assert.deepEqual(result, { released: true, sheetId: 'sheet-1', eventId: 'ev-1' });
  assert.equal(db.rows('scoresheets').length, 0);
  assert.equal(db.rows('scoresheet_reviews').length, 0, 'nada de "cancelada"');
});

test('judge não libera com registro, súmula de outro judge, enviada ou ausente', async () => {
  const withEvent = createFakeSupabase({ scoresheets: [sheetRow()], scoresheet_events: [event(0)] });
  await rejects(sheets.releaseEmptySheet(withEvent.client, judge, 'sheet-1'), 409, /já tem registros.*gestor/);
  assert.equal(withEvent.rows('scoresheets').length, 1);

  const theirs = createFakeSupabase({ scoresheets: [sheetRow()], scoresheet_events: [] });
  await rejects(sheets.releaseEmptySheet(theirs.client, other, 'sheet-1'), 403, /está com Judge A/);

  for (const overrides of [{ status: 'submitted' }, { status: 'returned' }, { absent: true }]) {
    const db = createFakeSupabase({ scoresheets: [sheetRow(overrides)], scoresheet_events: [] });
    await rejects(sheets.releaseEmptySheet(db.client, judge, 'sheet-1'), 409, /em andamento e sem registro/);
    assert.equal(db.rows('scoresheets').length, 1, JSON.stringify(overrides));
  }
});

test('gestor libera para outro judge: os registros ficam, o judge sai e o histórico ganha "released"', async () => {
  const db = createFakeSupabase({ scoresheets: [sheetRow()], scoresheet_events: [event(0), event(1)], scoresheet_reviews: [] });
  const result = await sheets.reviewSheet(db.client, manager, 'sheet-1', { action: 'release', reason: 'Judge trocou de raia' });
  assert.equal(result.sheet.judgeUserId, null);
  assert.equal(db.rows('scoresheets')[0].judge_user_id, null);
  assert.equal(db.rows('scoresheets')[0].status, 'in_progress');
  assert.equal(db.rows('scoresheet_events').length, 2);
  const [review] = db.rows('scoresheet_reviews');
  assert.equal(review.action, 'released');
  assert.equal(review.reason, 'Judge trocou de raia');
  assert.equal(review.actor_role, 'manager');
});

test('gestor: só em andamento ou devolvida, com judge, e com motivo', async () => {
  for (const [overrides, pattern] of [[{ status: 'submitted' }, /em andamento ou devolvida/], [{ judge_user_id: null }, /já está livre/]]) {
    const db = createFakeSupabase({ scoresheets: [sheetRow(overrides)], scoresheet_events: [], scoresheet_reviews: [] });
    await rejects(sheets.reviewSheet(db.client, manager, 'sheet-1', { action: 'release', reason: 'motivo ok' }), 409, pattern);
  }
  const db = createFakeSupabase({ scoresheets: [sheetRow()], scoresheet_events: [], scoresheet_reviews: [] });
  await assert.rejects(sheets.reviewSheet(db.client, manager, 'sheet-1', { action: 'release', reason: '' }), /motivo/);
  assert.equal(db.rows('scoresheets')[0].judge_user_id, judge.id);
});

test('gestor: se o histórico não grava, a liberação é desfeita (o judge volta)', async () => {
  const db = createFakeSupabase({ scoresheets: [sheetRow()], scoresheet_events: [], scoresheet_reviews: [] });
  db.onceBeforeInsert('scoresheet_reviews', () => { throw Object.assign(new Error('violates check constraint "scoresheet_reviews_action_check" on scoresheet_reviews'), { code: '23514' }); });
  await assert.rejects(sheets.reviewSheet(db.client, manager, 'sheet-1', { action: 'release', reason: 'motivo ok' }));
  assert.equal(db.rows('scoresheets')[0].judge_user_id, judge.id);
  assert.equal(db.rows('scoresheet_reviews').length, 0);
});

test('rota, telas e migration da liberação', () => {
  const route = read('../src/app/api/sheets/route.ts');
  assert.match(route, /release: 30/);
  assert.match(route, /if \(action === 'release'\) \{\s*await assertSheetJudgeAccess\(supabaseAdmin, actor, eventId\);\s*return NextResponse\.json\(await releaseEmptySheet\(/);

  const court = read('../src/components/judge/CourtSheet.tsx');
  assert.match(court, /const canRelease = canMarkAbsent && status === 'in_progress' && !published\.absent;/);
  assert.match(court, /body: JSON\.stringify\(\{ action: 'release', sheetId: sheet\.id \}\)/);
  assert.match(court, /Liberar súmula/);

  const board = read('../src/components/judge/CourtBoard.tsx');
  assert.match(board, /sheet\.judgeUserId !== null && sheet\.judgeUserId !== board\?\.viewer\.id/);
  assert.match(board, /Súmula liberada\. Nada foi gravado\./);

  const panel = read('../src/components/admin/ScoresheetsPanel.tsx');
  assert.match(panel, /startMode\(sheet, 'release'\)/);
  assert.match(panel, /Liberar para outro judge/);

  const labels = read('../src/lib/scoresheet.ts');
  assert.match(labels, /released: 'Liberada para outro judge'/);

  const migration = read('../supabase/migrations/20261117120000_scoresheet_release.sql');
  assert.match(migration, /CHECK \(action IN \('opened', 'submitted', 'returned', 'corrected', 'cancelled', 'manual_override', 'absent', 'released'\)\)/);
  assert.match(migration, /DELETE FROM public\.scoresheet_reviews WHERE action = 'released';/);
});
