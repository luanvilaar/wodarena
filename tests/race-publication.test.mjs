import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { createFakeSupabase } from './support/fakeSupabase.mjs';
import { createRaceClient } from './support/fakeRaceSupabase.mjs';
import { withRaceStartHeat } from './support/fakeRaceStartHeat.mjs';
import { importServerModule, setActiveSupabaseClient } from './support/serverModuleHarness.mjs';

// Story 1.99 (fecha a F1 da súmula Fitness Race): publicação do tempo oficial
// na prova TOTAL e no leaderboard. Pela rota real com o banco em memória:
// fechamento pela liberação da última estação, o Wall Ball neste percurso
// (D34, Story 1.101; D22), penalidades vigentes (D2),
// DNF (D14b; não há DQ), corrida sem tempo fechado e abandono (AC11, D24),
// desfazer DNF (D25, AC13), substituição
// e volta do resultado manual (AC8), ranking próprio (AC6), trava do
// lançamento manual (AC7); regras puras, leaderboard, PII e migration.

process.env.SUPABASE_URL = 'http://supabase.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';
process.env.WODA_SESSION_SECRET = 'segredo-de-teste-publicacao-race';

let database = createFakeSupabase();
const state = { missingRaceTables: false, beforeUpdate: {}, beforeCount: {}, missingStartHeat: false };
const client = withRaceStartHeat(createRaceClient(() => database, state), () => database, state);
setActiveSupabaseClient(client);

const { POST } = await importServerModule('app/api/race-sheets/route.ts');
const { POST: postPersistence } = await importServerModule('app/api/admin/persistence/route.ts');
const { createSessionToken } = await importServerModule('lib/serverSecurity.ts');
const decisionsModule = await importServerModule('lib/serverRaceDecisions.ts');
const publication = await importServerModule('lib/serverRacePublication.ts');
const { computeDivisionStandings } = await importServerModule('lib/leaderboardStandings.ts');
const { PUBLIC_SCORE_SELECT } = await importServerModule('lib/bootstrapPayload.ts');

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const MANAGER = { id: 'mgr-pub', name: 'Gestora Pub', email: 'pub@example.com', role: 'manager', service_valid_until: '2099-12-31' };
const JUDGE = { id: 'judge-pub', name: 'Judge Paula Sigilo', email: 'paula@example.com', role: 'judge', parent_manager_id: MANAGER.id };
const EVENT = 'ev-pub';
const COURSE = [
  { id: 'run-1', name: 'Corrida 1', type: 'run', orderIndex: 0, distance: '1km' },
  { id: 'wall-balls', name: 'Wall Balls', type: 'station', orderIndex: 1, reps: 100, maleWeight: '9kg', femaleWeight: '6kg' }
];
const ATHLETES = ['ath-ana', 'ath-bia', 'ath-caio', 'ath-davi', 'ath-eva'];
const TOTAL_W = 'wod-div-w-total';
const TOTAL_M = 'custom-total-m';

const seed = ({ scores = [] } = {}) => {
  database = createFakeSupabase({
    users: [MANAGER, JUDGE],
    events: [{
      id: EVENT, name: 'Race Publicação', date: '2026-11-01', location: 'Natal', organizer_id: MANAGER.id, event_type: 'fitness_racing', status: 'upcoming', time_zone: 'America/Fortaleza',
      event_schedule: [{ id: 'heat-1', kind: 'heat', date: '2026-11-01', time: '08:00', title: 'Onda 1', heatNumber: 1, athleteIds: ATHLETES }]
    }],
    event_judges: [{ event_id: EVENT, judge_user_id: JUDGE.id }],
    divisions: [
      { id: 'div-w', event_id: EVENT, name: 'Women Pro', type: 'individual', category: 'female', course_layout: COURSE },
      { id: 'div-m', event_id: EVENT, name: 'Men Pro', type: 'individual', category: 'male', course_layout: COURSE }
    ],
    athletes: [
      { id: 'ath-ana', name: 'Ana Souza', box: 'Box Norte', division_id: 'div-w' },
      { id: 'ath-bia', name: 'Bia Lima', box: 'Box Sul', division_id: 'div-w' },
      { id: 'ath-caio', name: 'Caio Reis', box: 'Box Leste', division_id: 'div-m' },
      { id: 'ath-davi', name: 'Davi Melo', box: 'Box Oeste', division_id: 'div-m' },
      { id: 'ath-eva', name: 'Éva Prado', box: 'Box Centro', division_id: 'div-w' }
    ],
    // A categoria masculina já tem a prova TOTAL (id próprio); a feminina não tem.
    workouts: [{ id: TOTAL_M, event_id: EVENT, name: 'Percurso Completo', description: '', type: 'fortime', code: 'TOTAL', order_index: 1, division_id: 'div-m', tie_breaker: '' }],
    scores,
    registrations: []
  });
  decisionsModule.setRaceRunPublisher(publication.publishRaceRun);
};

const cookie = (user) => `woda_session=${createSessionToken({ id: user.id, name: user.name, email: user.email, role: user.role })}`;
const post = async (user, body) => {
  const response = await POST(new Request('http://localhost/api/race-sheets', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie(user) }, body: JSON.stringify({ eventId: EVENT, ...body })
  }));
  return { status: response.status, body: await response.json() };
};
const persist = async (payload) => {
  const response = await postPersistence(new Request('http://localhost/api/admin/persistence', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie(MANAGER) }, body: JSON.stringify({ action: 'upsertScores', payload })
  }));
  return { status: response.status, body: await response.json() };
};
const decide = async (action, body) => {
  const out = await post(MANAGER, { action, ...body });
  assert.equal(out.status, 200, out.body.error);
  assert.equal(out.body.republish?.ok, true, 'republicou');
  return out.body;
};
const runOf = (athleteId) => database.rows('race_runs').find((row) => row.athlete_id === athleteId);
const scoreOf = (athleteId, workoutId = TOTAL_W) => database.rows('scores').find((row) => row.athlete_id === athleteId && row.workout_id === workoutId);
const decisionsOf = (action) => database.rows('race_decisions').filter((row) => row.action === action);

let counter = 0;
let clockMs = 0;
// Eventos com horário do aparelho crescente (1 s cada), para o split do Wall Ball ter duração.
const ev = (event) => ({ id: `q${(counter += 1)}`, event, deviceAt: (clockMs += 1000) });
const reps = (count) => Array.from({ length: count }, () => ev({ t: 'rep' }));
const append = (attemptId, fromSeq, events) => post(JUDGE, { action: 'append', attemptId, fromSeq, events, clientNow: Date.now() });

const start = async () => {
  const started = await post(MANAGER, { action: 'start_heat', heatId: 'heat-1', clientNow: Date.now() });
  assert.equal(started.status, 200, started.body.error);
  for (const run of database.rows('race_runs')) run.started_at = new Date(Date.now() - 3_600_000).toISOString();
};
const open = async (athleteId) => {
  clockMs = Date.now() - 150_000;
  const opened = await post(JUDGE, { action: 'open_attempt', athleteId, stationId: 'wall-balls' });
  assert.equal(opened.status, 200, opened.body.error);
  return opened.body.attempt.id;
};
/** Corrida fechada pela súmula com magnésio (2 min vigente). */
const finish = async (athleteId, extra = []) => {
  const attemptId = await open(athleteId);
  const out = await append(attemptId, 0, [ev({ t: 'start' }), ev({ t: 'chalk' }), ...extra, ...reps(100), ev({ t: 'release' })]);
  assert.equal(out.status, 200, out.body.error);
  assert.equal(runOf(athleteId).status, 'finished');
  return { attemptId, out };
};
const expectedOfficial = (athleteId, penalty = 120) => Math.round(Number(runOf(athleteId).gross_seconds) + penalty);
const chalkOf = (runId) => database.rows('race_infractions').find((row) => row.run_id === runId && (row.code === 'chalk' || /magn/i.test(row.label)));

// ---------------------------------------------------------------------------
// Publicação no fechamento (AC1, AC2, AC3, AC4)
// ---------------------------------------------------------------------------

test('fechamento pela liberação publica o tempo oficial (bruto + penalidades) na prova TOTAL criada no servidor, com race_run_id e splits por etapa', async () => {
  seed();
  await start();
  const { out } = await finish('ath-ana');
  assert.equal(out.body.republish.ok, true);
  assert.equal(Object.hasOwn(out.body, 'closedRunId'), false, 'campo interno não sai na resposta');

  const workout = database.rows('workouts').find((row) => row.id === TOTAL_W);
  assert.ok(workout, 'prova TOTAL criada no padrão wod-{divisionId}-total');
  assert.equal(workout.code, 'TOTAL');
  assert.equal(workout.division_id, 'div-w');
  assert.equal(workout.event_id, EVENT);

  const run = runOf('ath-ana');
  const score = scoreOf('ath-ana');
  const value = expectedOfficial('ath-ana');
  assert.equal(score.value, value);
  assert.equal(score.result, publication.raceOfficialScore(value).result, 'texto e número saem do mesmo inteiro');
  assert.match(score.result, /^\d+:\d{2}:\d{2}$|^\d{2}:\d{2}$/);
  assert.equal(score.race_run_id, run.id);
  assert.equal(score.result_status, null, 'tempo normal com result_status nulo');
  assert.equal(score.rank, 1);
  assert.equal(score.points, null, 'sem pontos');
  assert.match(score.splits['wall-balls'], /^\d{2}:\d{2}$/, 'split do Wall Ball pelo id da etapa');
  assert.equal(score.splits[publication.RACE_SPLIT_PENALTY_SECONDS_KEY], '120');
  const listed = JSON.parse(score.splits[publication.RACE_SPLIT_PENALTIES_KEY]);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].seconds, 120);
  const text = JSON.stringify(score.splits);
  assert.doesNotMatch(text, /Paula|Sigilo|judge|note|created_by/i, 'sem dados do árbitro');

  // Idempotente: republicar não duplica nem muda.
  const snapshot = structuredClone(database.rows('scores'));
  await decisionsModule.republishRaceRun(client, run.id);
  await decisionsModule.republishRaceRun(client, run.id);
  assert.deepEqual(database.rows('scores'), snapshot);
  assert.equal(database.rows('workouts').filter((row) => row.code === 'TOTAL' && row.division_id === 'div-w').length, 1);
  assert.equal(decisionsOf('manual_override').length, 0);
});

test('prova TOTAL existente é reaproveitada (sem criar outra)', async () => {
  seed();
  await start();
  await finish('ath-caio');
  assert.equal(database.rows('workouts').filter((row) => row.division_id === 'div-m').length, 1);
  assert.equal(scoreOf('ath-caio', TOTAL_M).race_run_id, runOf('ath-caio').id);
});

test('falha ao garantir a prova TOTAL não publica e volta como aviso para tentar de novo', async (t) => {
  t.mock.method(console, 'error', () => {});
  seed();
  await start();
  const insert = client.from;
  let failed = false;
  t.mock.method(client, 'from', (table) => {
    const query = insert(table);
    if (table !== 'workouts' || failed) return query;
    return new Proxy(query, {
      get(target, prop) {
        if (prop === 'insert') { failed = true; return () => Promise.resolve({ data: null, error: { code: '23503', message: 'fk' } }); }
        const value = target[prop];
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
  });
  const { out } = await finish('ath-ana');
  t.mock.restoreAll();
  assert.equal(out.body.republish.ok, false);
  assert.deepEqual(out.body.republish.failedRunIds, [runOf('ath-ana').id]);
  assert.equal(scoreOf('ath-ana'), undefined, 'nada publicado');
  const retry = await post(MANAGER, { action: 'republish_run', runId: runOf('ath-ana').id });
  assert.equal(retry.status, 200, retry.body.error);
  assert.equal(scoreOf('ath-ana').value, expectedOfficial('ath-ana'));
});

// ---------------------------------------------------------------------------
// Decisões que mudam o tempo (AC1; D2)
// ---------------------------------------------------------------------------

test('revogar tira a penalidade do placar; alterar vale pelo novo valor', async () => {
  seed();
  await start();
  await finish('ath-ana');
  const run = runOf('ath-ana');
  const chalk = chalkOf(run.id);
  await decide('adjust_infraction', { infractionId: chalk.id, seconds: 30, reason: 'Magnésio leve' });
  assert.equal(scoreOf('ath-ana').value, expectedOfficial('ath-ana', 30));
  assert.equal(scoreOf('ath-ana').splits[publication.RACE_SPLIT_PENALTY_SECONDS_KEY], '30');
  await decide('revoke_infraction', { infractionId: chalk.id, reason: 'Não houve magnésio' });
  assert.equal(scoreOf('ath-ana').value, expectedOfficial('ath-ana', 0));
  assert.equal(JSON.parse(scoreOf('ath-ana').splits[publication.RACE_SPLIT_PENALTIES_KEY]).length, 0);
});

// ---------------------------------------------------------------------------
// DNF, sem tempo e abandono (AC5, AC11; D14b, D24)
// ---------------------------------------------------------------------------

test('não há DQ: propose_dq é recusado e nenhuma decisão de DQ existe na rota', async () => {
  seed();
  await start();
  const attemptId = await open('ath-ana');
  const refused = await append(attemptId, 0, [ev({ t: 'start' }), ev({ t: 'propose_dq', reason: 'Ajuda externa' })]);
  assert.equal(refused.status, 400);
  assert.equal(database.rows('race_infractions').filter((row) => row.kind === 'dq_proposal').length, 0);
});

test('DNF publica "DNF" com 999999; desfazer DNF volta ao tempo; repetir a republicação não muda nada', async () => {
  seed();
  await start();
  await finish('ath-ana');
  const run = runOf('ath-ana');
  await decide('mark_dnf', { runId: run.id, reason: 'Saiu de maca' });
  assert.equal(scoreOf('ath-ana').result, 'DNF');
  assert.equal(scoreOf('ath-ana').value, 999999);
  assert.equal(scoreOf('ath-ana').result_status, 'dnf');
  assert.equal(scoreOf('ath-ana').rank, null);
  await decide('unmark_dnf', { runId: run.id, reason: 'Marcado por engano' });
  assert.equal(scoreOf('ath-ana').value, expectedOfficial('ath-ana'));
  const snapshot = structuredClone(database.rows('scores'));
  await decisionsModule.republishRaceRun(client, run.id);
  assert.deepEqual(database.rows('scores'), snapshot);
});

test('corrida sem tempo fechado não publica; o "Atleta saiu" (abandon, D24) também não', async () => {
  seed();
  await start();
  const attemptId = await open('ath-bia');
  const out = await append(attemptId, 0, [ev({ t: 'start' }), ...reps(40), ev({ t: 'abandon' })]);
  assert.equal(out.status, 200, out.body.error);
  assert.equal(Object.hasOwn(out.body, 'republish'), false);
  assert.equal(runOf('ath-bia').status, 'racing');
  await decisionsModule.republishRaceRun(client, runOf('ath-bia').id);
  assert.equal(database.rows('scores').length, 0);
});

test('desfazer DNF de corrida em andamento retira a linha da súmula', async () => {
  seed();
  await start();
  await open('ath-ana');
  const b = runOf('ath-bia');
  await decide('mark_dnf', { runId: b.id, reason: 'Desistiu' });
  assert.equal(scoreOf('ath-bia').result, 'DNF');
  await decide('unmark_dnf', { runId: b.id, reason: 'Voltou' });
  assert.equal(scoreOf('ath-bia'), undefined);
  await decisionsModule.republishRaceRun(client, b.id);
  assert.equal(database.rows('scores').length, 0);
});

// ---------------------------------------------------------------------------
// Resultado manual substituído (AC8, AC13)
// ---------------------------------------------------------------------------

test('súmula sobre resultado manual grava manual_override (antes e depois); retirar devolve o manual com race_run_id nulo', async () => {
  const manual = { athlete_id: 'ath-caio', workout_id: TOTAL_M, result: '58:00', value: 3480, rank: 1, points: 0, splits: { 'run-1': '04:00' }, result_status: null };
  seed({ scores: [manual] });
  await start();
  const run = runOf('ath-caio');
  await open('ath-caio');
  await decide('mark_dnf', { runId: run.id, reason: 'Fora do percurso' });
  const [override] = decisionsOf('manual_override');
  assert.ok(override);
  assert.equal(override.actor_role, 'system');
  assert.equal(override.run_id, run.id);
  assert.equal(override.before.result, '58:00');
  assert.equal(override.before.value, 3480);
  assert.deepEqual(override.before.splits, { 'run-1': '04:00' });
  assert.equal(override.after.result, 'DNF');
  assert.equal(scoreOf('ath-caio', TOTAL_M).race_run_id, run.id);

  await decide('unmark_dnf', { runId: run.id, reason: 'Engano do staff' });
  const restored = scoreOf('ath-caio', TOTAL_M);
  assert.equal(restored.result, '58:00');
  assert.equal(restored.value, 3480);
  assert.equal(restored.race_run_id, null);
  assert.equal(restored.rank, 1);
  assert.deepEqual(restored.splits, { 'run-1': '04:00' });
  await decisionsModule.republishRaceRun(client, run.id);
  assert.deepEqual(scoreOf('ath-caio', TOTAL_M), restored, 'repetir não muda');
  assert.equal(decisionsOf('manual_override').length, 1);
});

// ---------------------------------------------------------------------------
// Ranking próprio (AC6)
// ---------------------------------------------------------------------------

test('rankRaceScores: só tempo, empate 1, 1, 3; DNF e sem resultado sem posição; nunca pontos', () => {
  const ranked = publication.rankRaceScores([
    { athlete_id: 'a', value: 3600, result_status: null },
    { athlete_id: 'b', value: 3500, result_status: null },
    { athlete_id: 'c', value: 3500, result_status: null },
    { athlete_id: 'd', value: 999999, result_status: 'dnf' },
    { athlete_id: 'e', value: 999999, result_status: 'dnf' },
    { athlete_id: 'f', value: 3700, result_status: 'manual' }
  ]);
  const byId = Object.fromEntries(ranked.map((row) => [row.athleteId, row]));
  assert.deepEqual([byId.b.rank, byId.c.rank, byId.a.rank, byId.f.rank], [1, 1, 3, 4]);
  assert.equal(byId.d.rank, null);
  assert.equal(byId.e.rank, null);
  assert.ok(ranked.every((row) => row.points === null));
  const source = read('../src/lib/serverRacePublication.ts').replace(/^\s*(\/\/|\*|\/\*\*).*$/gm, '');
  assert.doesNotMatch(source, /recalculateWorkoutRanking\s*\(|rankWorkoutScores\s*\(|from '@\/lib\/serverScoresheets'/);
});

test('arredondamento: segundo mais próximo, uma vez; valor e texto do mesmo inteiro', () => {
  assert.deepEqual(publication.raceOfficialScore(3599.4), { value: 3599, result: '59:59' });
  assert.deepEqual(publication.raceOfficialScore(3599.5), { value: 3600, result: '1:00:00' });
  assert.deepEqual(publication.raceOfficialScore(65.2), { value: 65, result: '01:05' });
});

// ---------------------------------------------------------------------------
// Trava do lançamento manual (AC7)
// ---------------------------------------------------------------------------

test('upsertScores: mudar resultado da súmula responde 409; linha igual sai do lote; atleta sem súmula grava como antes', async () => {
  seed();
  await start();
  await finish('ath-ana');
  const published = structuredClone(scoreOf('ath-ana'));

  const locked = await persist({ scores: [{ athlete_id: 'ath-ana', workout_id: TOTAL_W, result: '30:00', value: 1800, rank: 1, points: 0, splits: {} }] });
  assert.equal(locked.status, 409);
  assert.equal(locked.body.error, publication.RACE_MANUAL_LOCK_MESSAGE);
  assert.deepEqual(scoreOf('ath-ana'), published, 'nada mudou');

  // O painel reenvia a categoria toda (a da súmula igual, com rank do cliente) e o tempo novo de Bia.
  const ok = await persist({ scores: [
    { athlete_id: 'ath-ana', workout_id: TOTAL_W, result: published.result, value: published.value, rank: 2, points: 0, splits: published.splits },
    { athlete_id: 'ath-bia', workout_id: TOTAL_W, result: '30:00', value: 1800, rank: 1, points: 0, splits: {} }
  ] });
  assert.equal(ok.status, 200, ok.body.error);
  assert.equal(scoreOf('ath-ana').race_run_id, published.race_run_id);
  assert.equal(scoreOf('ath-bia').value, 1800);
  assert.equal(scoreOf('ath-bia').rank, 1, 'ranking por tempo do que está gravado');
  assert.equal(scoreOf('ath-ana').rank, 2);
  assert.equal(scoreOf('ath-bia').race_run_id ?? null, null);

  // Sem súmula na prova: como antes (o rank do cliente fica).
  const plain = await persist({ scores: [{ athlete_id: 'ath-davi', workout_id: TOTAL_M, result: '59:00', value: 3540, rank: 1, points: 0, splits: {} }] });
  assert.equal(plain.status, 200, plain.body.error);
  assert.equal(scoreOf('ath-davi', TOTAL_M).rank, 1);
});

test('upsertScores: depois de manual, a súmula substitui (AC8) e o manual não sobrescreve mais (AC7)', async () => {
  seed();
  await start();
  assert.equal((await persist({ scores: [{ athlete_id: 'ath-caio', workout_id: TOTAL_M, result: '58:00', value: 3480, rank: 1, points: 0, splits: {} }] })).status, 200);
  await finish('ath-caio');
  assert.equal(decisionsOf('manual_override').length, 1);
  assert.equal(scoreOf('ath-caio', TOTAL_M).race_run_id, runOf('ath-caio').id);
  assert.equal((await persist({ scores: [{ athlete_id: 'ath-caio', workout_id: TOTAL_M, result: '58:00', value: 3480, rank: 1, points: 0, splits: {} }] })).status, 409);
});

// ---------------------------------------------------------------------------
// Leaderboard (AC10)
// ---------------------------------------------------------------------------

test('leaderboard Race: tempo oficial, DQ e DNF atrás e sem posição; splits só do Wall Ball e chaves race: não quebram', () => {
  const athletes = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id.toUpperCase(), divisionId: 'div-w' }));
  const splits = { 'wall-balls': '01:40', [publication.RACE_SPLIT_PENALTY_SECONDS_KEY]: '120', [publication.RACE_SPLIT_PENALTIES_KEY]: '[{"label":"Magnésio","seconds":120}]' };
  const standings = computeDivisionStandings({
    event: { date: '2026-11-01', eventType: 'fitness_racing', workouts: [{ id: TOTAL_W, name: 'Percurso Completo', description: '', type: 'fortime', code: 'TOTAL', orderIndex: 1, divisionId: 'div-w' }] },
    divisionId: 'div-w',
    divisionAthletes: athletes,
    scores: [
      { athleteId: 'a', workoutId: TOTAL_W, result: 'DQ', value: 999999, splits, resultStatus: 'disqualified' },
      { athleteId: 'b', workoutId: TOTAL_W, result: '59:00', value: 3540, rank: 1, splits },
      { athleteId: 'c', workoutId: TOTAL_W, result: 'DNF', value: 999999, splits, resultStatus: 'dnf' },
      { athleteId: 'd', workoutId: TOTAL_W, result: '1:01:00', value: 3660, rank: 2, splits }
    ]
  });
  assert.deepEqual(standings.slice(0, 2).map((row) => [row.athlete.id, row.rank]), [['b', 1], ['d', 2]]);
  assert.deepEqual(standings.slice(2).map((row) => row.rank), [0, 0]);
  const leaderboard = read('../src/components/Leaderboard.tsx');
  // A análise de splits percorre só as etapas do percurso (chaves desconhecidas ficam de fora) e filtra tempos zerados.
  assert.match(leaderboard, /const splitsArray = stages\.map\(stg => \{\s*const timeStr = score\.splits\?\.\[stg\.id\] \|\| '';/);
  assert.match(leaderboard, /\}\)\.filter\(s => s\.secs > 0\);/);
});

// ---------------------------------------------------------------------------
// PII e tipos (AC5, AC9)
// ---------------------------------------------------------------------------

test('bootstrap sem race_*: PUBLIC_SCORE_SELECT sem race_run_id; bootstrap não lê tabelas race_*; tipo aceita disqualified e dnf', () => {
  assert.equal(PUBLIC_SCORE_SELECT, 'athlete_id, workout_id, result, value, rank, points, splits, result_status');
  assert.doesNotMatch(read('../src/lib/bootstrapPayload.ts'), /race_/);
  assert.doesNotMatch(read('../src/app/api/app/bootstrap/route.ts'), /race_/);
  assert.match(read('../src/types/index.ts'), /resultStatus\?: 'validated' \| 'penalized' \| 'rejected' \| 'manual' \| 'absent' \| 'disqualified' \| 'dnf';/);
  assert.match(read('../src/context/AppContext.tsx'), /resultStatus: optionalString\(score\.result_status\) as Score\['resultStatus'\]/);
});

// ---------------------------------------------------------------------------
// Migration (AC4, AC5)
// ---------------------------------------------------------------------------

const MIGRATION = '20261031120000_race_publication.sql';
const PREVIOUS_SHA256 = '406a95492299df20218ce50743154d455fa0e51321e3ffcf67d625a918022b70';

test('migration: race_run_id com FK ON DELETE SET NULL e índice único parcial; CHECK com os sete valores; rollback comentado; anteriores intactas', () => {
  const migration = read(`../supabase/migrations/${MIGRATION}`);
  const code = migration.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
  assert.match(code, /ALTER TABLE public\.scores ADD COLUMN IF NOT EXISTS race_run_id TEXT;/);
  assert.match(code, /FOREIGN KEY \(race_run_id\) REFERENCES public\.race_runs\(id\) ON DELETE SET NULL/);
  assert.match(code, /conname = 'scores_race_run_id_fkey'/);
  assert.match(code, /CREATE UNIQUE INDEX IF NOT EXISTS scores_race_run_id_key\s+ON public\.scores \(race_run_id\) WHERE race_run_id IS NOT NULL;/);
  assert.match(code, /ALTER TABLE public\.scores DROP CONSTRAINT IF EXISTS scores_result_status_check;/);
  assert.match(code, /CHECK \(result_status IS NULL OR result_status IN \('validated', 'penalized', 'rejected', 'manual', 'absent', 'disqualified', 'dnf'\)\)/);
  assert.doesNotMatch(code.replace(/DROP CONSTRAINT IF EXISTS scores_result_status_check/, '').replace(/ON DELETE SET NULL/, ''), /\bDROP\b|\bDELETE\b|\bUPDATE\b|\bTRUNCATE\b/);
  assert.match(migration, /-- Rollback/);
  assert.match(migration, /--\s+ALTER TABLE public\.scores DROP COLUMN IF EXISTS race_run_id;/);
  assert.match(migration, /-- Ordem de deploy: aplicar depois de 20261030140000_race_start_heat\.sql/);

  const names = readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter((name) => name.endsWith('.sql')).sort();
  assert.ok(names.includes(MIGRATION));
  assert.ok(MIGRATION > '20261030140000_race_start_heat.sql');
  const hash = createHash('sha256');
  for (const name of ['20260816120000_functional_fitness_qualifier.sql', '20261030120000_race_sheets.sql', '20261030130000_race_judges.sql', '20261030140000_race_start_heat.sql']) {
    hash.update(`${name}\n${read(`../supabase/migrations/${name}`).replace(/\r\n/g, '\n')}\n`);
  }
  assert.equal(hash.digest('hex'), PREVIOUS_SHA256, 'migration anterior alterada');
});
