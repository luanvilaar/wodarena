import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createFakeSupabase } from './support/fakeSupabase.mjs';
import { createRaceClient } from './support/fakeRaceSupabase.mjs';
import { withRaceStartHeat } from './support/fakeRaceStartHeat.mjs';
import { importServerModule, setActiveSupabaseClient } from './support/serverModuleHarness.mjs';

// Story 1.97 (F1 da súmula Fitness Race): tela do Wall Ball e fechamento do
// tempo. Pela rota real com o banco em memória (largada pela função emulada da
// 1.96): trava no total, no-rep, desfazer, liberação que fecha a corrida
// (D1), `exit` recusado no Wall Ball (D22), saída `abandon` sem fechar nada
// (D24), tentativa liberada
// fechada (AC10), corrida encerrada fechada (REQ-001 do gate da 1.94), lista
// da onda (AC1, AC12); regras puras da tela (D21, fila) e renderização.

process.env.SUPABASE_URL = 'http://supabase.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';
process.env.WODA_SESSION_SECRET = 'segredo-de-teste-wall-ball';

let database = createFakeSupabase();
const state = { missingRaceTables: false, beforeUpdate: {}, beforeCount: {}, missingStartHeat: false };
const client = withRaceStartHeat(createRaceClient(() => database, state), () => database, state);
setActiveSupabaseClient(client);

const { GET, POST } = await importServerModule('app/api/race-sheets/route.ts');
const { createSessionToken } = await importServerModule('lib/serverSecurity.ts');
const engine = await importServerModule('lib/raceRules.ts');
const presets = await importServerModule('lib/raceRulePresets.ts');
const wb = await importServerModule('lib/raceWallBall.ts');
const { WallBallCard } = await importServerModule('components/race/WallBallCard.tsx');

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const P26 = presets.RACE_RULE_PRESET_2026_27;

const MANAGER = { id: 'mgr-wb', name: 'Gestora WB', email: 'wb@example.com', role: 'manager', service_valid_until: '2099-12-31' };
const JUDGE = { id: 'judge-wb', name: 'Judge Nina', email: 'nina@example.com', role: 'judge', parent_manager_id: MANAGER.id };
const JUDGE_2 = { id: 'judge-wb-2', name: 'Judge Otto', email: 'otto@example.com', role: 'judge', parent_manager_id: MANAGER.id };

const EVENT = 'ev-wb';
const COURSE = [
  { id: 'run-1', name: 'Corrida 1', type: 'run', orderIndex: 0, distance: '1km' },
  { id: 'wall-balls', name: 'Wall Balls', type: 'station', orderIndex: 1, reps: 100, maleWeight: '9kg', femaleWeight: '6kg' }
];

const seed = () => {
  database = createFakeSupabase({
    users: [MANAGER, JUDGE, JUDGE_2],
    events: [{
      id: EVENT, name: 'Race Natal', date: '2026-11-01', location: 'Natal', organizer_id: MANAGER.id, event_type: 'fitness_racing', status: 'upcoming', time_zone: 'America/Fortaleza',
      event_schedule: [
        { id: 'heat-1', kind: 'heat', date: '2026-11-01', time: '08:00', title: 'Onda 1', heatNumber: 1, athleteIds: ['ath-ana', 'ath-dupla', 'ath-bia'] },
        { id: 'heat-2', kind: 'heat', date: '2026-11-01', time: '08:20', title: 'Onda 2', heatNumber: 2, athleteIds: ['ath-caio'] }
      ]
    }],
    event_judges: [{ event_id: EVENT, judge_user_id: JUDGE.id }, { event_id: EVENT, judge_user_id: JUDGE_2.id }],
    divisions: [
      { id: 'div-pro', event_id: EVENT, name: 'Women Pro', type: 'individual', category: 'female', course_layout: COURSE },
      { id: 'div-duo', event_id: EVENT, name: 'Doubles Women', type: 'duo', category: 'female', course_layout: COURSE }
    ],
    athletes: [
      { id: 'ath-ana', name: 'Ana Souza', box: 'Box Norte', division_id: 'div-pro' },
      { id: 'ath-bia', name: 'Bia Lima', box: 'Box Sul', division_id: 'div-pro' },
      { id: 'ath-caio', name: 'Caio Reis', box: 'Box Leste', division_id: 'div-pro' },
      { id: 'ath-dupla', name: 'Gabi e Íris', box: 'Box Oeste', division_id: 'div-duo' }
    ],
    workouts: [], scores: [], registrations: []
  });
  state.missingRaceTables = false;
  state.beforeUpdate = {};
  state.beforeCount = {};
};

const cookie = (user) => `woda_session=${createSessionToken({ id: user.id, name: user.name, email: user.email, role: user.role })}`;
const post = async (user, body) => {
  const response = await POST(new Request('http://localhost/api/race-sheets', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie(user) }, body: JSON.stringify(body)
  }));
  return { status: response.status, body: await response.json() };
};
const get = async (user, query) => {
  const response = await GET(new Request(`http://localhost/api/race-sheets?${new URLSearchParams(query)}`, { headers: { cookie: cookie(user) } }));
  return { status: response.status, body: await response.json() };
};
const rows = (table) => structuredClone(database.rows(table));
const runOf = (athleteId) => database.rows('race_runs').find((row) => row.athlete_id === athleteId);

/** Larga a onda 1 pela rota (Story 1.96) uma hora atrás e devolve a tentativa de Wall Ball aberta pelo árbitro. */
const startAndOpen = async (athleteId = 'ath-ana', judge = JUDGE, startedAgoMs = 3_600_000) => {
  if (!database.rows('race_heat_marks').length) {
    const started = await post(MANAGER, { action: 'start_heat', eventId: EVENT, heatId: 'heat-1', clientNow: Date.now() });
    assert.equal(started.status, 200, started.body.error);
    for (const run of database.rows('race_runs')) run.started_at = new Date(Date.now() - startedAgoMs).toISOString();
  }
  const opened = await post(judge, { action: 'open_attempt', eventId: EVENT, athleteId, stationId: 'wall-balls' });
  assert.equal(opened.status, 200, opened.body.error);
  return opened.body.attempt.id;
};

let counter = 0;
const ev = (event) => ({ id: `w${(counter += 1)}`, event, deviceAt: Date.now() });
const reps = (count) => Array.from({ length: count }, () => ev({ t: 'rep' }));
const append = (user, attemptId, fromSeq, events) => post(user, { action: 'append', attemptId, fromSeq, events, clientNow: Date.now() });
const eventsOf = (attemptId) => rows('race_attempt_events').filter((row) => row.attempt_id === attemptId).sort((a, b) => a.seq - b.seq);
const infractionsOf = (attemptId) => rows('race_infractions').filter((row) => row.attempt_id === attemptId);

// ---------------------------------------------------------------------------
// Contagem, trava e liberação (AC3 a AC7, AC10)
// ---------------------------------------------------------------------------

test('100 reps travam, o 101º é recusado; no-rep com motivo não conta; desfazer volta o contador e mantém o evento', async () => {
  seed();
  const id = await startAndOpen();
  const first = await append(JUDGE, id, 0, [ev({ t: 'start' }), ...reps(3), ev({ t: 'norep', reason: P26.wallBall.noRepReasons[1].code }), ev({ t: 'undo', of: 3 })]);
  assert.equal(first.status, 200, first.body.error);
  assert.equal(first.body.attempt.progress.validReps, 2);
  assert.equal(first.body.attempt.progress.noReps, 1);
  assert.deepEqual(first.body.attempt.progress.voided, [3]);
  assert.equal(eventsOf(id).length, 6, 'o rep desfeito continua no log');
  const full = await append(JUDGE, id, 6, reps(98));
  assert.equal(full.body.attempt.status, 'done_pending_release');
  const extra = await append(JUDGE, id, 104, reps(1));
  assert.equal(extra.status, 400);
  assert.match(extra.body.error, /contador travado em 100/);
});

test('liberar fecha a corrida (D1): finish_at, bruto, finished, sheet, penalidades vigentes e oficial; reenvio não fecha duas vezes; liberada recusa registro e desfazer (409)', async () => {
  seed();
  const id = await startAndOpen();
  const run = runOf('ath-ana');
  await append(JUDGE, id, 0, [ev({ t: 'start' }), ev({ t: 'chalk' }), ...reps(100)]);
  const releaseEvent = ev({ t: 'release' });
  const released = await append(JUDGE, id, 102, [releaseEvent]);
  assert.equal(released.status, 200, released.body.error);
  assert.equal(released.body.attempt.status, 'released');
  const closed = runOf('ath-ana');
  assert.equal(closed.status, 'finished');
  assert.equal(closed.time_source, 'sheet');
  assert.equal(closed.finish_at, released.body.attempt.endedAt, 'fim = horário do release corrigido');
  const gross = (Date.parse(closed.finish_at) - Date.parse(run.started_at)) / 1000;
  assert.equal(closed.gross_seconds, gross);
  assert.ok(Math.abs(gross - 3600) < 5, `bruto ${gross}`);
  assert.equal(closed.penalty_seconds, 120, 'magnésio 120 s vale na hora (D2)');
  assert.equal(closed.official_seconds, gross + 120);
  assert.equal(released.body.run.status, 'finished');
  assert.equal(released.body.run.officialSeconds, gross + 120);

  const before = structuredClone(runOf('ath-ana'));
  const replay = await append(JUDGE, id, 102, [releaseEvent]);
  assert.equal(replay.status, 200, 'reenvio puro do lote segue');
  assert.deepEqual(runOf('ath-ana'), before, 'não fecha duas vezes');

  const after = await append(JUDGE, id, 103, [ev({ t: 'infraction', code: 'spitting' })]);
  assert.equal(after.status, 409);
  assert.equal(after.body.error, 'Esta tentativa já foi encerrada. Correção de tempo ou de penalidade é com o organizador.');
  assert.equal((await append(JUDGE, id, 103, [ev({ t: 'undo', of: 102 })])).status, 409, 'o árbitro não reabre');
  assert.equal((await append(JUDGE, id, 103, [ev({ t: 'rep' })])).status, 409);
  assert.equal((await append(JUDGE, id, 103, [ev({ t: 'abandon' })])).status, 409);
  assert.equal(eventsOf(id).length, 103);
});

test('liberação e desfazer dela no mesmo lote: o desfazer é recusado e nada do lote é gravado', async () => {
  seed();
  const id = await startAndOpen();
  await append(JUDGE, id, 0, [ev({ t: 'start' }), ...reps(100)]);
  const batch = await append(JUDGE, id, 101, [ev({ t: 'release' }), ev({ t: 'undo', of: 101 })]);
  assert.equal(batch.status, 409);
  assert.equal(eventsOf(id).length, 101);
  assert.equal(runOf('ath-ana').status, 'racing');
});

test('liberar com menos reps é recusado; horário do release antes da largada não fecha a corrida (AC11)', async () => {
  seed();
  const id = await startAndOpen();
  const early = await append(JUDGE, id, 0, [ev({ t: 'start' }), ...reps(99), ev({ t: 'release' })]);
  assert.equal(early.status, 400);
  assert.match(early.body.error, /faltam 1 repetições/);
  // Largada gravada no futuro (relógio do aparelho da largada errado): a tentativa libera, a corrida fica racing.
  runOf('ath-ana').started_at = new Date(Date.now() + 600_000).toISOString();
  const released = await append(JUDGE, id, 0, [ev({ t: 'start' }), ...reps(100), ev({ t: 'release' })]);
  assert.equal(released.status, 200, released.body.error);
  assert.equal(released.body.attempt.status, 'released');
  const run = runOf('ath-ana');
  assert.equal(run.status, 'racing');
  assert.equal(run.finish_at, null);
  assert.equal(run.gross_seconds, null);
});

test('sem árbitro no Wall Ball a corrida fica racing, sem tempo inventado, e aparece na lista como em corrida', async () => {
  seed();
  await startAndOpen('ath-ana');
  const bia = runOf('ath-bia');
  assert.equal(bia.status, 'racing');
  assert.equal(bia.finish_at, null);
  assert.equal(bia.official_seconds, null);
  const board = await get(JUDGE, { view: 'wall_ball', eventId: EVENT });
  const row = board.body.waves[0].athletes.find((item) => item.athleteId === 'ath-bia');
  assert.equal(row.attempt, null);
  assert.equal(wb.describeWallBallRow(row, JUDGE.id).chip, 'Em corrida');
});

test('infração geral: um único evento, vale na hora, soma e é desfeita pelo desfazer (D17)', async () => {
  seed();
  const id = await startAndOpen();
  const sent = await append(JUDGE, id, 0, [ev({ t: 'start' }), ev({ t: 'infraction', code: 'spitting' })]);
  assert.equal(eventsOf(id).length, 2, 'sem passo de confirmação');
  assert.equal(sent.body.attempt.progress.penaltySeconds, 120);
  assert.deepEqual(infractionsOf(id).map((row) => [row.code, row.status, row.general]), [['spitting', 'confirmed', true]]);
  await append(JUDGE, id, 2, [ev({ t: 'undo', of: 1 })]);
  assert.deepEqual(infractionsOf(id).map((row) => row.status), ['cancelled']);
});

// ---------------------------------------------------------------------------
// Sair não fecha o tempo (AC8, D22) e "Atleta saiu" (AC17, D24)
// ---------------------------------------------------------------------------

test('exit no Wall Ball com 94 reps: 400, nada gravado, sem penalidade, tentativa aberta e corrida racing; depois 6 reps e a liberação fecham o tempo', async () => {
  seed();
  const id = await startAndOpen();
  await append(JUDGE, id, 0, [ev({ t: 'start' }), ...reps(94)]);
  const exit = await append(JUDGE, id, 95, [ev({ t: 'rep' }), ev({ t: 'exit' })]);
  assert.equal(exit.status, 400);
  assert.equal(exit.body.error, 'Sair antes das reps não fecha o tempo; o atleta precisa completar as reps.');
  assert.equal(eventsOf(id).length, 95, 'nem o rep antes do exit no lote é gravado');
  assert.equal(infractionsOf(id).length, 0);
  assert.equal(rows('race_attempts').find((row) => row.id === id).status, 'running');
  assert.equal(runOf('ath-ana').status, 'racing');
  const done = await append(JUDGE, id, 95, [...reps(6), ev({ t: 'release' })]);
  assert.equal(done.status, 200, done.body.error);
  assert.equal(runOf('ath-ana').status, 'finished');
});

test('abandon: 200, tentativa running, marca no progress, sem infração, corrida racing sem fim; auditado; desfazer limpa; voltar e liberar fecha', async () => {
  seed();
  const id = await startAndOpen();
  await append(JUDGE, id, 0, [ev({ t: 'start' }), ...reps(94)]);
  const out = await append(JUDGE, id, 95, [ev({ t: 'abandon' })]);
  assert.equal(out.status, 200, out.body.error);
  assert.equal(out.body.attempt.status, 'running');
  assert.equal(out.body.attempt.progress.abandoned, true);
  assert.equal(out.body.attempt.progress.abandonSeq, 95);
  assert.equal(out.body.attempt.endedAt, null);
  assert.equal(infractionsOf(id).length, 0);
  const run = runOf('ath-ana');
  assert.equal(run.status, 'racing');
  assert.equal(run.finish_at, null);
  const logged = eventsOf(id)[95];
  assert.deepEqual(logged.event, { t: 'abandon' });
  assert.equal(logged.author_user_id, JUDGE.id);
  assert.ok(logged.device_at && logged.recorded_at && typeof logged.clock_offset_ms === 'number');
  assert.equal((await append(JUDGE, id, 96, [ev({ t: 'abandon' })])).status, 400, 'segunda saída com a primeira ativa');

  const undone = await append(JUDGE, id, 96, [ev({ t: 'undo', of: 95 })]);
  assert.equal(undone.body.attempt.progress.abandoned, false);
  await append(JUDGE, id, 97, [ev({ t: 'abandon' })]);
  const back = await append(JUDGE, id, 98, [...reps(6)]);
  assert.equal(back.body.attempt.progress.abandoned, false, 'a marca some quando o contador trava');
  const released = await append(JUDGE, id, 104, [ev({ t: 'release' })]);
  assert.equal(released.status, 200, released.body.error);
  assert.equal(runOf('ath-ana').status, 'finished');
});

// ---------------------------------------------------------------------------
// Sem DQ: o registro propose_dq não existe mais
// ---------------------------------------------------------------------------

test('não há DQ: propose_dq é recusado (400) e nada é gravado', async () => {
  seed();
  const id = await startAndOpen();
  const refused = await append(JUDGE, id, 0, [ev({ t: 'start' }), ev({ t: 'propose_dq', reason: 'Recebeu ajuda externa' })]);
  assert.equal(refused.status, 400);
  assert.deepEqual(infractionsOf(id), []);
  assert.equal(runOf('ath-ana').status, 'racing');
});

test('REQ-001 (gate 1.94): corrida encerrada (DNF) não recebe registro novo do árbitro (409)', async () => {
  seed();
  const id = await startAndOpen();
  await append(JUDGE, id, 0, [ev({ t: 'start' })]);
  runOf('ath-ana').status = 'dnf';
  const blocked = await append(JUDGE, id, 1, [ev({ t: 'rep' })]);
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /já foi encerrada/);
});

// ---------------------------------------------------------------------------
// Lista da onda e dupla (AC1, AC12)
// ---------------------------------------------------------------------------

test('lista da onda: só ondas largadas, atletas com estação de Wall Ball, tentativa com árbitro, dupla e estados das linhas', async () => {
  seed();
  const id = await startAndOpen('ath-ana', JUDGE_2);
  await append(JUDGE_2, id, 0, [ev({ t: 'start' }), ...reps(40), ev({ t: 'abandon' })]);
  const board = await get(JUDGE, { view: 'wall_ball', eventId: EVENT });
  assert.equal(board.status, 200, board.body.error);
  assert.deepEqual(board.body.waves.map((wave) => wave.id), ['heat-1'], 'a onda 2 não largou');
  const athletes = board.body.waves[0].athletes;
  assert.deepEqual(athletes.map((item) => item.athleteId), ['ath-ana', 'ath-dupla', 'ath-bia']);
  const ana = athletes[0];
  assert.equal(ana.stationId, 'wall-balls');
  assert.deepEqual([ana.attempt.judgeName, ana.attempt.validReps, ana.attempt.targetReps, ana.attempt.abandoned], ['Judge Otto', 40, 100, true]);
  assert.equal(wb.describeWallBallRow(ana, JUDGE.id).chip, 'Com Judge Otto');
  assert.equal(wb.describeWallBallRow(ana, JUDGE_2.id).chip, 'Saiu · faltam 60');
  assert.equal(athletes[1].team, true, 'dupla é uma linha só');
  assert.equal(athletes[2].team, false);
  assert.doesNotMatch(JSON.stringify(board.body), /@example\.com/);
  assert.deepEqual(wb.describeWallBallRow({ ...ana, runStatus: 'finished' }, JUDGE.id), { done: true, disabled: true, chip: 'Liberado' });
});

test('dupla conta como um cartão: a corrida e as 100 reps são da equipe, mesma tela', async () => {
  seed();
  const id = await startAndOpen('ath-dupla');
  const view = await get(JUDGE, { view: 'attempt', attemptId: id });
  assert.equal(view.body.context.team, true);
  assert.equal(view.body.context.category, 'female');
  assert.equal(view.body.context.timeZone, 'America/Fortaleza');
  assert.equal(view.body.run.startedAt, runOf('ath-dupla').started_at, 'a largada vem com a tentativa (D21)');
  const done = await append(JUDGE, id, 0, [ev({ t: 'start' }), ...reps(100), ev({ t: 'release' })]);
  assert.equal(done.status, 200, done.body.error);
  assert.equal(runOf('ath-dupla').status, 'finished');
});

// ---------------------------------------------------------------------------
// Regras puras da tela (D21, AC5, AC13)
// ---------------------------------------------------------------------------

test('tempo exibido (D21): largada + decorrido, desvio, congelado no toque de liberar, "—" sem largada, rótulo provisório', () => {
  const start = '2026-11-01T08:00:00.000Z';
  const at = (s) => Date.parse(start) + s * 1000;
  assert.equal(wb.raceElapsedSeconds(start, at(4354.9)), 4354);
  assert.equal(wb.raceElapsedSeconds(start, at(100), 5000), 105);
  assert.equal(wb.raceElapsedSeconds(null, at(10)), null);
  assert.equal(wb.formatRaceElapsed(4354), '1:12:34');
  assert.equal(wb.formatRaceElapsed(754), '12:34');
  assert.equal(wb.formatRaceElapsed(null), '—');
  const items = [{ id: 'a', event: { t: 'start' }, deviceAt: at(3000) }, ...Array.from({ length: 3 }, (_, i) => ({ id: `r${i}`, event: { t: 'rep' }, deviceAt: at(3001 + i) })), { id: 'z', event: { t: 'release' }, deviceAt: at(4354) }];
  const result = engine.evaluateRaceStation(P26, engine.toRaceCourseStage({ id: 'wall-balls', name: 'Wall Balls', type: 'station', orderIndex: 1, reps: 3 }), items.map((item) => item.event));
  assert.equal(wb.releasedElapsedSeconds(start, items, result), 4354, 'congela no toque, não na resposta');
  assert.equal(wb.releasedElapsedSeconds(null, items, result), null);
  assert.match(wb.RACE_PROVISIONAL_TIME_LABEL, /Provisório/);
  assert.match(wb.RACE_PROVISIONAL_TIME_LABEL, /sem penalidades/);
});

test('desfazer último pula start, release, undo e já desfeitos; textos; menu de infração com o magnésio primeiro', () => {
  const items = [{ t: 'start' }, { t: 'rep' }, { t: 'abandon' }, { t: 'undo', of: 2 }].map((event, i) => ({ id: String(i), event }));
  const stage = engine.toRaceCourseStage({ id: 'wall-balls', name: 'Wall Balls', type: 'station', orderIndex: 1, reps: 100 });
  const result = engine.evaluateRaceStation(P26, stage, items.map((item) => item.event));
  assert.equal(wb.lastUndoableSeq(items, result), 1);
  assert.equal(wb.lastUndoableSeq(items.slice(0, 1), engine.evaluateRaceStation(P26, stage, [{ t: 'start' }])), null);
  assert.match(wb.describeLastWallBallAction(items, P26, 1, 100), /^desfeito \(saída registrada\)/);
  assert.equal(wb.formatRacePenalty(0), 'Sem penalidade');
  assert.equal(wb.formatRacePenalty(120), '+2 min');
  assert.equal(wb.formatRacePenalty(90), '+1 min 30 s');
  const menu = wb.wallBallInfractionItems(P26);
  assert.deepEqual(menu[0].event, { t: 'chalk' });
  assert.equal(menu[0].seconds, 120);
  assert.ok(menu.slice(1).every((item) => item.event.t === 'infraction'));
  assert.equal(wb.wallBallLoad({ maleWeight: '9kg', femaleWeight: '6kg' }, 'female'), '6kg');
  assert.equal(wb.wallBallLoad({ maleWeight: '9kg', femaleWeight: '6kg' }, 'mixed'), 'M 9kg · F 6kg');
});

test('fila do aparelho (AC13): 2xx sai, 409 pede recarregar, 401 preserva e leva ao login, 400/403 param, resto tenta de novo; lote com horário do toque', () => {
  assert.equal(wb.classifyRaceSyncResponse(200), 'ok');
  assert.equal(wb.classifyRaceSyncResponse(409), 'conflict');
  assert.equal(wb.classifyRaceSyncResponse(401), 'session');
  assert.equal(wb.classifyRaceSyncResponse(400), 'rejected');
  assert.equal(wb.classifyRaceSyncResponse(403), 'rejected');
  assert.equal(wb.classifyRaceSyncResponse(503), 'retry');
  assert.equal(wb.classifyRaceSyncResponse(599), 'retry');
  assert.match(wb.RACE_SESSION_EXPIRED_MESSAGE, /continuam guardados/);
  const body = wb.buildRaceAppendBody('attempt_1', 4, [{ id: 'x', event: { t: 'rep' }, deviceAt: 1000 }, { id: 'y', event: { t: 'rep' }, deviceAt: null }], 2000);
  assert.deepEqual(body, { action: 'append', attemptId: 'attempt_1', fromSeq: 4, clientNow: 2000, events: [{ id: 'x', event: { t: 'rep' }, deviceAt: 1000 }, { id: 'y', event: { t: 'rep' } }] });
  const hook = read('../src/components/judge/useRaceSync.ts');
  assert.match(hook, /fetch\('\/api\/race-sheets'/);
  assert.match(hook, /mergePending/);
  assert.match(hook, /saveLocalSheet\(attemptId/);
  assert.match(hook, /visibilitychange/);
  assert.doesNotMatch(hook, /\/api\/sheets'/);
});

// ---------------------------------------------------------------------------
// Renderização e estático (AC2 a AC18)
// ---------------------------------------------------------------------------

const cardProps = (extra = {}) => ({
  athleteName: 'Ana Souza', team: false, load: '6kg', validReps: 37, targetReps: 100, noRepCount: 1, penaltySeconds: 0, lastAction: 'REP',
  elapsed: '1:02:03', abandonedAt: null, released: null,
  noRepReasons: P26.wallBall.noRepReasons, infractions: wb.wallBallInfractionItems(P26), canUndo: true, locked: false, nextHref: '/judge/corrida/ev/wall-ball',
  onRep() {}, onNoRep() {}, onUndo() {}, onInfraction() {}, onAbandon() {}, onRelease() {},
  ...extra
});
const render = (extra) => renderToStaticMarkup(createElement(WallBallCard, cardProps(extra)));
/** O botão (tag de abertura) que contém o texto, para conferir se está desativado. */
const buttonOf = (html, label) => {
  const end = html.indexOf(`</svg>${label}</button>`);
  assert.ok(end > 0, label);
  return html.slice(html.lastIndexOf('<button', end), end).split('>')[0];
};

test('tela de contagem: contador, total, tempo, REP, sem Liberar antes da trava, nenhum botão de exit; travado mostra Liberar e desativa REP, NO REP e Atleta saiu', () => {
  const html = render();
  assert.match(html, />37</);
  assert.match(html, /de 100 reps válidas/);
  assert.match(html, /Tempo 1:02:03/);
  assert.match(html, /REP válida\. 37 de 100/);
  assert.doesNotMatch(html, /Segure para liberar/);
  assert.match(html, /Atleta saiu/);
  assert.doesNotMatch(html, /Propor DQ|DQ proposto/);
  assert.doesNotMatch(html, /\bexit\b/i);
  const locked = render({ validReps: 100 });
  assert.match(locked, /Segure para liberar/);
  assert.match(locked, /Contador travado em 100/);
  assert.doesNotMatch(locked, /REP válida/);
  assert.match(buttonOf(locked, 'NO REP'), /disabled=""/);
  assert.match(buttonOf(locked, 'Atleta saiu'), /disabled=""/);
  assert.doesNotMatch(buttonOf(html, 'Atleta saiu'), /disabled=""/);
});

test('NO REP com os motivos do regulamento; infração geral sem diálogo de confirmação; saída com segurar e aviso; dupla', () => {
  const norep = render({ initialSheet: 'norep' });
  for (const reason of P26.wallBall.noRepReasons) assert.ok(norep.includes(reason.label), reason.label);
  const infra = render({ initialSheet: 'infra' });
  assert.match(infra, /Um toque registra, vale na hora/);
  assert.equal((infra.match(/data-one-tap-infraction/g) || []).length, P26.general.length + 1);
  assert.doesNotMatch(infra, /Confirmar/);
  const exit = render({ initialSheet: 'exit', validReps: 94 });
  assert.match(exit, /Segure para registrar a saída/);
  assert.match(exit, /Faltam 6 reps/);
  assert.match(exit, /Não fecha o tempo/);
  const out = render({ validReps: 94, abandonedAt: '09:51:10' });
  assert.match(out, /Saída registrada às <span[^>]*>09:51:10<\/span> · faltam 6 reps/);
  assert.match(buttonOf(out, 'Saída registrada'), /disabled=""/);
  assert.match(render({ team: true }), /Dupla · reps juntas/);
});

test('liberado: tempo congelado com rótulo provisório, oficial do servidor com rótulo próprio, Próximo atleta', () => {
  const html = render({ validReps: 100, released: { elapsed: '1:12:34', official: '1:14:34' } });
  assert.match(html, /Tempo na liberação/);
  assert.match(html, /1:12:34/);
  assert.match(html, /Provisório/);
  assert.match(html, /Tempo oficial \(servidor\): <span[^>]*>1:14:34/);
  assert.match(html, /Próximo atleta/);
  assert.doesNotMatch(html, /REP válida|Desfazer último/);
});

test('estático: useTapHold no REP, Liberar e saída; CourtShell com a faixa "Fitness Race · Wall Ball" nas duas telas; alvos de 56 px; FF intocado', () => {
  const card = read('../src/components/race/WallBallCard.tsx');
  assert.equal((card.match(/useTapHold\(/g) || []).length, 3);
  assert.match(card, /min-h-14/);
  assert.doesNotMatch(card, /t: 'exit'/);
  const list = read('../src/components/race/WallBallListScreen.tsx');
  const screen = read('../src/components/race/WallBallAttemptScreen.tsx');
  assert.match(read('../src/lib/raceWallBall.ts'), /export const WALL_BALL_EYEBROW = 'Fitness Race · Wall Ball'/);
  assert.match(list, /<CourtShell\s+eyebrow=\{WALL_BALL_EYEBROW\}/);
  assert.equal((screen.match(/<CourtShell eyebrow=\{WALL_BALL_EYEBROW\}/g) || []).length, 2);
  assert.match(screen, /role="status"/);
  assert.match(screen, /action: 'claim_attempt'/);
  assert.match(list, /action: 'open_attempt'/);
  assert.match(read('../src/app/judge/corrida/[eventId]/wall-ball/page.tsx'), /WallBallListScreen/);
  assert.match(read('../src/app/judge/corrida/[eventId]/wall-ball/[attemptId]/page.tsx'), /WallBallAttemptScreen/);
  assert.match(read('../src/components/admin/RaceSheetPanel.tsx'), /\/wall-ball`/);
  assert.doesNotMatch(read('../src/app/admin/page.tsx'), /WallBallListScreen|WallBallCard|view=wall_ball/);
  assert.doesNotMatch(read('../src/components/judge/useSheetSync.ts'), /race-sheets/);
  assert.doesNotMatch(read('../src/app/api/sheets/route.ts'), /race|abandon/i);
});
