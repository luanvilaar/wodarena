import assert from 'node:assert/strict';
import test from 'node:test';

import { createFakeSupabase } from './support/fakeSupabase.mjs';
import { createRaceClient } from './support/fakeRaceSupabase.mjs';
import { importServerModule, setActiveSupabaseClient } from './support/serverModuleHarness.mjs';

// Story 1.94 (F1 da súmula Fitness Race): banco, serviço e rota
// /api/race-sheets pela rota real, com o banco em memória. Acesso por evento
// (judge atribuído, gestor dono, owner; só evento Fitness Race), regulamento e
// snapshot do percurso, abrir, assumir e liberar a tentativa, gravar em lote
// com reenvio sem duplicar, recálculo da corrida inteira pelo motor (Story
// 1.93) com a decisão do organizador preservada, horário dos eventos, limite
// por ação, banco sem a migration e a súmula de Functional Fitness intocada.

process.env.SUPABASE_URL = 'http://supabase.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';
process.env.WODA_SESSION_SECRET = 'segredo-de-teste-sumula-race';

let database = createFakeSupabase();
const state = { missingRaceTables: false, beforeUpdate: {}, beforeCount: {} };
const client = createRaceClient(() => database, state);
setActiveSupabaseClient(client);

const { GET: getRace, POST: postRace } = await importServerModule('app/api/race-sheets/route.ts');
const { GET: getSheets, POST: postSheets } = await importServerModule('app/api/sheets/route.ts');
const { createSessionToken } = await importServerModule('lib/serverSecurity.ts');
const race = await importServerModule('lib/serverRaceSheets.ts');

const MANAGER = { id: 'mgr-race', name: 'Gestora Race', email: 'race@example.com', role: 'manager', service_valid_until: '2099-12-31' };
const OTHER_MANAGER = { id: 'mgr-outra', name: 'Outra Gestora', email: 'outra@example.com', role: 'manager', service_valid_until: '2099-12-31' };
const EXPIRED_MANAGER = { id: 'mgr-vencida', name: 'Gestora Vencida', email: 'vencida@example.com', role: 'manager', service_valid_until: '2020-01-01' };
const OWNER = { id: 'owner-race', name: 'Owner', email: 'owner-race@example.com', role: 'owner' };
const OWNER_LIMIT = { id: 'owner-limite', name: 'Owner Limite', email: 'owner-limite@example.com', role: 'owner' };
const JUDGE = { id: 'judge-rafa', name: 'Judge Rafa', email: 'rafa@example.com', role: 'judge', parent_manager_id: MANAGER.id };
const JUDGE_2 = { id: 'judge-paula', name: 'Judge Paula', email: 'paula@example.com', role: 'judge', parent_manager_id: MANAGER.id };
const JUDGE_FREE = { id: 'judge-sem-evento', name: 'Judge Sem Evento', email: 'sem@example.com', role: 'judge', parent_manager_id: MANAGER.id };
const JUDGE_OTHER = { id: 'judge-outro', name: 'Judge de Outra', email: 'outro@example.com', role: 'judge', parent_manager_id: OTHER_MANAGER.id };
const JUDGE_EXPIRED = { id: 'judge-vencido', name: 'Judge Vencido', email: 'vencido@example.com', role: 'judge', parent_manager_id: EXPIRED_MANAGER.id };
// Atribuído ao evento da Gestora Race, mas a conta é de outra gestora.
const JUDGE_FOREIGN = { id: 'judge-estrangeiro', name: 'Judge Estrangeiro', email: 'estrangeiro@example.com', role: 'judge', parent_manager_id: OTHER_MANAGER.id };
const ATHLETE_USER = { id: 'ath-user', name: 'Atleta', email: 'atleta@example.com', role: 'athlete' };

const EVENT = 'ev-race';
const COURSE = [
  { id: 'run-1', name: 'Corrida 1', type: 'run', orderIndex: 0, distance: '1km' },
  { id: 'sled-push', name: 'Sled Push', type: 'station', orderIndex: 1, distance: '50m', maleWeight: '152kg', femaleWeight: '102kg' },
  { id: 'run-2', name: 'Corrida 2', type: 'run', orderIndex: 2, distance: '1km' },
  { id: 'wall-balls', name: 'Wall Balls', type: 'station', orderIndex: 3, reps: 100, maleWeight: '9kg', femaleWeight: '6kg' }
];

const seed = () => {
  database = createFakeSupabase({
    users: [MANAGER, OTHER_MANAGER, EXPIRED_MANAGER, OWNER, OWNER_LIMIT, JUDGE, JUDGE_2, JUDGE_FREE, JUDGE_OTHER, JUDGE_EXPIRED, JUDGE_FOREIGN],
    events: [
      { id: EVENT, name: 'Race Recife', date: '2026-11-01', location: 'Recife', organizer_id: MANAGER.id, event_type: 'fitness_racing', status: 'upcoming', event_schedule: [] },
      { id: 'ev-ff', name: 'Híbrido Games', date: '2026-11-02', location: 'Recife', organizer_id: MANAGER.id, event_type: 'functional_fitness', status: 'upcoming', event_schedule: [] },
      { id: 'ev-race-outra', name: 'Race da Outra', date: '2026-11-03', location: 'Natal', organizer_id: OTHER_MANAGER.id, event_type: 'fitness_racing', status: 'upcoming', event_schedule: [] },
      { id: 'ev-race-vencida', name: 'Race Vencida', date: '2026-11-04', location: 'Natal', organizer_id: EXPIRED_MANAGER.id, event_type: 'fitness_racing', status: 'upcoming', event_schedule: [] }
    ],
    event_judges: [
      { event_id: EVENT, judge_user_id: JUDGE.id },
      { event_id: EVENT, judge_user_id: JUDGE_2.id },
      { event_id: 'ev-ff', judge_user_id: JUDGE.id },
      { event_id: 'ev-race-outra', judge_user_id: JUDGE_OTHER.id },
      { event_id: 'ev-race-vencida', judge_user_id: JUDGE_EXPIRED.id },
      { event_id: EVENT, judge_user_id: JUDGE_FOREIGN.id }
    ],
    divisions: [
      { id: 'div-open', event_id: EVENT, name: 'Open Masculino', course_layout: COURSE },
      { id: 'div-ff', event_id: 'ev-ff', name: 'RX', course_layout: [] },
      { id: 'div-outra', event_id: 'ev-race-outra', name: 'Open', course_layout: COURSE }
    ],
    athletes: [
      { id: 'ath-caio', name: 'Caio Reis', box: 'Tropa Fit', division_id: 'div-open' },
      { id: 'ath-ana', name: 'Ana Souza', box: 'CrossFit Litoral', division_id: 'div-open' },
      { id: 'ath-fora', name: 'De Outro Evento', box: 'X', division_id: 'div-outra' },
      { id: 'ath-ff', name: 'Atleta FF', box: 'Y', division_id: 'div-ff' }
    ],
    workouts: [],
    scores: [],
    registrations: []
  });
  state.missingRaceTables = false;
  state.beforeUpdate = {};
  state.beforeCount = {};
};

const cookie = (user) => `woda_session=${createSessionToken({ id: user.id, name: user.name, email: user.email, role: user.role })}`;
const get = async (user, query) => {
  const response = await getRace(new Request(`http://localhost/api/race-sheets?${new URLSearchParams(query)}`, { headers: user ? { cookie: cookie(user) } : {} }));
  return { status: response.status, body: await response.json() };
};
const post = async (user, body) => {
  const response = await postRace(new Request('http://localhost/api/race-sheets', {
    method: 'POST', headers: { 'content-type': 'application/json', ...(user ? { cookie: cookie(user) } : {}) }, body: JSON.stringify(body)
  }));
  return { status: response.status, body: await response.json() };
};
const quiet = (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});
};
const rows = (table) => structuredClone(database.rows(table));

/** A onda largou (Story 1.96): o regulamento com o snapshot existe e a corrida do atleta está `racing`. */
const startRun = async (athleteId = 'ath-caio', status = 'racing') => {
  const ruleset = await race.ensureRaceRuleset(client, EVENT);
  const run = {
    id: `run-${athleteId}`, event_id: EVENT, division_id: 'div-open', athlete_id: athleteId, heat_id: 'heat-1', ruleset_id: ruleset.id,
    status, started_at: '2026-11-01T10:00:00.000Z', finish_at: null, gross_seconds: null, penalty_seconds: 0, official_seconds: null,
    time_source: null, created_at: '2026-11-01T10:00:00.000Z', updated_at: '2026-11-01T10:00:00.000Z'
  };
  database.rows('race_runs').push(run);
  return run;
};

/** Tentativa numa estação que a F1 ainda não abre pela rota (o Sled), gravada direto para testar o recálculo da corrida inteira. */
const seedAttempt = (run, stationId, stationKind, judge = JUDGE) => {
  const row = {
    id: `attempt-${stationId}`, run_id: run.id, event_id: EVENT, athlete_id: run.athlete_id, station_id: stationId, station_kind: stationKind,
    lane: 1, judge_user_id: judge.id, judge_name: judge.name, status: 'waiting', progress: {}, started_at: null, ended_at: null,
    created_at: '2026-11-01T10:05:00.000Z', updated_at: '2026-11-01T10:05:00.000Z'
  };
  database.rows('race_attempts').push(row);
  return row;
};

const openWallBall = (user = JUDGE, athleteId = 'ath-caio', extra = {}) => post(user, { action: 'open_attempt', eventId: EVENT, athleteId, stationId: 'wall-balls', lane: 2, ...extra });

let counter = 0;
const ev = (event, extra = {}) => ({ id: `r${(counter += 1)}`, event, deviceAt: Date.now(), ...extra });
const append = (user, attemptId, fromSeq, events, clientNow = Date.now()) => post(user, { action: 'append', attemptId, fromSeq, events, clientNow });
const reps = (count) => Array.from({ length: count }, () => ev({ t: 'rep' }));
const infractionsOf = (attemptId) => rows('race_infractions').filter((row) => row.attempt_id === attemptId).sort((a, b) => a.source_seq - b.source_seq);

// ---------------------------------------------------------------------------
// Acesso (AC4, AC11)
// ---------------------------------------------------------------------------

test('eventos: judge vê os Fitness Race atribuídos; gestor, os dele; owner, todos; sem sessão 401; atleta 403', async (t) => {
  quiet(t);
  seed();
  assert.deepEqual((await get(JUDGE, { view: 'events' })).body.events.map((event) => event.id), [EVENT], 'sem o evento Functional Fitness atribuído');
  assert.deepEqual((await get(JUDGE_FREE, { view: 'events' })).body.events, []);
  assert.deepEqual((await get(MANAGER, { view: 'events' })).body.events.map((event) => event.id), [EVENT]);
  assert.deepEqual((await get(OWNER, { view: 'events' })).body.events.map((event) => event.id).sort(), [EVENT, 'ev-race-outra', 'ev-race-vencida']);
  assert.equal((await get(null, { view: 'events' })).status, 401);
  assert.equal((await get(ATHLETE_USER, { view: 'events' })).status, 403);
  assert.equal((await get(JUDGE, { view: 'nada' })).status, 400);
});

test('acesso por evento: FF 400, judge e gestor de outro evento 403, judge não atribuído 403, gestor vencido 403, ação desconhecida 400', async (t) => {
  quiet(t);
  seed();
  await startRun();
  const ff = await post(JUDGE, { action: 'open_attempt', eventId: 'ev-ff', athleteId: 'ath-ff', stationId: 'wall-balls' });
  assert.equal(ff.status, 400);
  assert.match(ff.body.error, /exclusiva de eventos Fitness Race/);
  assert.equal((await openWallBall(JUDGE_OTHER)).status, 403);
  assert.equal((await openWallBall(OTHER_MANAGER)).status, 403);
  assert.equal((await openWallBall(JUDGE_FREE)).status, 403);
  assert.equal((await post(EXPIRED_MANAGER, { action: 'mark_dnf', eventId: 'ev-race-vencida', runId: 'run-x', reason: 'Teste' })).status, 403);
  assert.equal((await post(JUDGE, { action: 'qualquer' })).status, 400);
  const inherited = await post(JUDGE, { action: 'toString' });
  assert.equal(inherited.status, 400, 'nome herdado de Object não é ação');
  assert.equal(inherited.body.error, 'Ação desconhecida.', 'recusado no dispatcher, não no caminho do append');
  assert.equal((await openWallBall(JUDGE)).status, 200, 'judge atribuído grava');
  assert.equal(rows('race_attempts').length, 1);
});

// ---------------------------------------------------------------------------
// Regulamento e snapshot do percurso (AC5)
// ---------------------------------------------------------------------------

test('ensureRaceRuleset: cria a versão 1 com o preset 2026/27 e o snapshot do percurso, com reps do Wall Ball e trechos do Sled', async (t) => {
  quiet(t);
  seed();
  const ruleset = await race.ensureRaceRuleset(client, EVENT);
  assert.equal(ruleset.version, 1);
  assert.equal(ruleset.preset, '2026_27');
  assert.equal(ruleset.name, 'Fitness Race 2026/27');
  assert.equal(ruleset.rules.verified, false);
  const course = ruleset.course['div-open'];
  assert.deepEqual(course.map((stage) => stage.id), ['run-1', 'sled-push', 'run-2', 'wall-balls']);
  assert.deepEqual(course.map((stage) => stage.kind), ['generic', 'sled', 'generic', 'wall_ball']);
  assert.equal(course.find((stage) => stage.id === 'wall-balls').reps, 100);
  assert.equal(course.find((stage) => stage.id === 'sled-push').expectedUnits, 4, '50 m / 12,5 m');
  assert.equal(course.find((stage) => stage.id === 'wall-balls').expectedUnits, undefined);
  assert.equal(ruleset.course['div-ff'], undefined, 'só as categorias do evento');
  // Chamar de novo devolve a mesma versão.
  assert.equal((await race.ensureRaceRuleset(client, EVENT)).id, ruleset.id);
  assert.equal(rows('race_rulesets').length, 1);
});

test('snapshot: mudar o percurso depois não altera a corrida aberta (o Wall Ball de 100 reps segue travando em 100)', async (t) => {
  quiet(t);
  seed();
  const run = await startRun();
  database.rows('divisions')[0].course_layout = COURSE.map((stage) => (stage.id === 'wall-balls' ? { ...stage, reps: 80 } : stage));
  const opened = await openWallBall();
  assert.equal(opened.status, 200, opened.body.error);
  assert.equal(opened.body.stage.reps, 100);
  const id = opened.body.attempt.id;
  const sent = await append(JUDGE, id, 0, [ev({ t: 'start' }), ...reps(100)]);
  assert.equal(sent.status, 200, sent.body.error);
  assert.equal(sent.body.attempt.progress.validReps, 100);
  assert.equal(sent.body.attempt.status, 'done_pending_release');
  const extra = await append(JUDGE, id, 101, [ev({ t: 'rep' })]);
  assert.equal(extra.status, 400);
  assert.match(extra.body.error, /Registro 102: contador travado em 100 repetições/);
  assert.equal(rows('race_runs')[0].ruleset_id, run.ruleset_id);
});

test('regulamento: nasce sozinho na primeira largada com o preset 2026/27; set_ruleset não existe mais (400)', async (t) => {
  quiet(t);
  seed();
  assert.equal((await post(MANAGER, { action: 'set_ruleset', eventId: EVENT, preset: '2025_26' })).status, 400);
  assert.equal((await post(OWNER, { action: 'set_ruleset', eventId: EVENT, preset: '2026_27' })).status, 400);
  assert.equal(rows('race_rulesets').length, 0);
  const run = await startRun();
  const [ruleset] = rows('race_rulesets');
  assert.equal(ruleset.version, 1);
  assert.equal(ruleset.preset, '2026_27');
  assert.equal(run.ruleset_id, ruleset.id);
  assert.equal(rows('race_decisions').filter((row) => row.action === 'set_ruleset').length, 0);
});

// ---------------------------------------------------------------------------
// Abrir, assumir e liberar (AC6, AC7)
// ---------------------------------------------------------------------------

test('open_attempt: a onda não largou 409; estação inexistente e corrida 400; trenó abre (Story 1.102); atleta de outro evento 400', async (t) => {
  quiet(t);
  seed();
  const early = await openWallBall();
  assert.equal(early.status, 409);
  assert.equal(early.body.error, 'A onda ainda não largou.');
  await startRun();
  assert.equal((await post(JUDGE, { action: 'open_attempt', eventId: EVENT, athleteId: 'ath-caio', stationId: 'ski-erg' })).status, 400, 'fora do snapshot da categoria');
  // Story 1.102 (AC1): o trenó passa a abrir; a mensagem "só o Wall Ball" saiu.
  const sled = await post(JUDGE, { action: 'open_attempt', eventId: EVENT, athleteId: 'ath-caio', stationId: 'sled-push' });
  assert.equal(sled.status, 200, sled.body.error);
  assert.equal(sled.body.attempt.stationKind, 'sled');
  const runStage = await post(JUDGE, { action: 'open_attempt', eventId: EVENT, athleteId: 'ath-caio', stationId: 'run-1' });
  assert.equal(runStage.status, 400, 'corrida não é estação');
  assert.doesNotMatch(runStage.body.error, /só o Wall Ball/);
  const outsider = await openWallBall(JUDGE, 'ath-fora');
  assert.equal(outsider.status, 400);
  assert.match(outsider.body.error, /não pertence ao evento/);
  assert.equal((await post(JUDGE, { action: 'open_attempt', eventId: EVENT })).status, 400);
  assert.deepEqual(rows('race_attempts').map((row) => row.station_id), ['sled-push']);
});

test('open_attempt: abre, o mesmo árbitro retoma, outro árbitro recebe 409 com o nome; corrida encerrada não abre tentativa nova', async (t) => {
  quiet(t);
  seed();
  await startRun();
  const opened = await openWallBall();
  assert.equal(opened.status, 200, opened.body.error);
  assert.equal(opened.body.attempt.status, 'waiting');
  assert.equal(opened.body.attempt.judgeUserId, JUDGE.id);
  assert.equal(opened.body.attempt.stationKind, 'wall_ball');
  assert.equal(opened.body.attempt.lane, 2);
  assert.equal(opened.body.context.athleteName, 'Caio Reis');
  assert.equal(opened.body.context.divisionName, 'Open Masculino');
  assert.equal(opened.body.ruleset.preset, '2026_27');
  assert.doesNotMatch(JSON.stringify(opened.body), /@example\.com/);

  const again = await openWallBall();
  assert.equal(again.body.attempt.id, opened.body.attempt.id);
  const busy = await openWallBall(JUDGE_2);
  assert.equal(busy.status, 409);
  assert.match(busy.body.error, /está com Judge Rafa/);
  assert.equal(busy.body.judgeName, 'Judge Rafa');
  assert.equal(rows('race_attempts').length, 1);

  await startRun('ath-ana', 'finished');
  const closed = await openWallBall(JUDGE, 'ath-ana');
  assert.equal(closed.status, 409);
  assert.match(closed.body.error, /já foi encerrada/);
});

test('open_attempt: dois árbitros abrindo no mesmo instante, o segundo cai no índice único e recebe 409', async (t) => {
  quiet(t);
  seed();
  const run = await startRun();
  database.onceBeforeInsert('race_attempts', (db) => {
    db.rows('race_attempts').push({
      id: 'attempt-raced', run_id: run.id, event_id: EVENT, athlete_id: 'ath-caio', station_id: 'wall-balls', station_kind: 'wall_ball',
      lane: 1, judge_user_id: JUDGE_2.id, judge_name: JUDGE_2.name, status: 'waiting', progress: {}, started_at: null, ended_at: null,
      created_at: '2026-11-01T10:00:00.000Z', updated_at: '2026-11-01T10:00:00.000Z'
    });
  });
  // O fakeRaceSupabase confere a chave antes do insert; o gatilho do fake grava no meio, como outra requisição.
  const raced = await openWallBall(JUDGE);
  assert.equal(raced.status, 409);
  assert.match(raced.body.error, /Judge Paula/);
});

test('claim_attempt: gestor libera, outro judge assume, o primeiro recebe 409 com o nome; judge não libera', async (t) => {
  quiet(t);
  seed();
  await startRun();
  const id = (await openWallBall()).body.attempt.id;
  assert.equal((await post(JUDGE_2, { action: 'claim_attempt', attemptId: id })).status, 409);
  // Wall Ball é estação de 1 atleta: o judge dono não solta, só gestor ou owner liberam (Story 1.103, AC5; D39).
  const selfRelease = await post(JUDGE, { action: 'claim_attempt', attemptId: id, release: true });
  assert.equal(selfRelease.status, 409, 'só gestor ou owner liberam');
  assert.match(selfRelease.body.error, /só o organizador libera/);
  assert.equal((await post(JUDGE_2, { action: 'claim_attempt', attemptId: id, release: true })).status, 403, 'judge que não é o dono não libera');
  const released = await post(MANAGER, { action: 'claim_attempt', attemptId: id, release: true });
  assert.equal(released.status, 200, released.body.error);
  assert.equal(released.body.attempt.judgeUserId, null);
  assert.equal((await append(JUDGE, id, 0, [ev({ t: 'start' })])).status, 403, 'sem árbitro ninguém grava');

  const claimed = await post(JUDGE_2, { action: 'claim_attempt', attemptId: id });
  assert.equal(claimed.status, 200, claimed.body.error);
  assert.equal(claimed.body.attempt.judgeUserId, JUDGE_2.id);
  const late = await post(JUDGE, { action: 'claim_attempt', attemptId: id });
  assert.equal(late.status, 409);
  assert.match(late.body.error, /Judge Paula/);
  assert.equal((await post(JUDGE_2, { action: 'claim_attempt', attemptId: id })).status, 200, 'quem já tem, mantém');

  // Sem árbitro, o judge que abre a tentativa assume (como na súmula de FF).
  await post(OWNER, { action: 'claim_attempt', attemptId: id, release: true });
  const reopened = await openWallBall(JUDGE);
  assert.equal(reopened.body.attempt.judgeUserId, JUDGE.id);
  assert.equal((await post(JUDGE, { action: 'claim_attempt', attemptId: 'nao-existe' })).status, 404);
});

// ---------------------------------------------------------------------------
// Lote (AC8, AC10)
// ---------------------------------------------------------------------------

test('append: lote novo, reenvio idêntico sem duplicar, divergência 409 com serverCount, evento inválido 400 com a posição, limites', async (t) => {
  quiet(t);
  seed();
  await startRun();
  const id = (await openWallBall()).body.attempt.id;
  const batch = [ev({ t: 'start' }), ...reps(3)];
  const sent = await append(JUDGE, id, 0, batch);
  assert.equal(sent.status, 200, sent.body.error);
  assert.equal(sent.body.count, 4);
  assert.equal(sent.body.attempt.status, 'running');
  assert.equal(sent.body.attempt.progress.validReps, 3);

  // A resposta se perdeu: o aparelho reenvia o mesmo lote com mais um evento.
  const more = ev({ t: 'rep' });
  const replay = await append(JUDGE, id, 0, [...batch, more]);
  assert.equal(replay.status, 200, replay.body.error);
  assert.equal(replay.body.count, 5);
  const stored = rows('race_attempt_events').filter((row) => row.attempt_id === id).sort((a, b) => a.seq - b.seq);
  assert.deepEqual(stored.map((row) => row.seq), [0, 1, 2, 3, 4], 'seq contígua a partir de 0, sem buraco');
  assert.deepEqual(stored.map((row) => row.client_event_id), [...batch, more].map((item) => item.id));
  assert.equal((await append(JUDGE, id, 0, [...batch, more])).body.count, 5, 'reenvio total não grava nada');

  const conflict = await append(JUDGE, id, 2, [ev({ t: 'rep' })]);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.serverCount, 5);
  const ahead = await append(JUDGE, id, 9, [ev({ t: 'rep' })]);
  assert.equal(ahead.status, 409);
  assert.equal(ahead.body.serverCount, 5);

  const invalid = await append(JUDGE, id, 5, [ev({ t: 'rep' }), ev({ t: 'voar' })]);
  assert.equal(invalid.status, 400);
  assert.match(invalid.body.error, /^Registro 7: tipo de registro desconhecido/);
  const badReason = await append(JUDGE, id, 5, [ev({ t: 'norep', reason: 'inventado' })]);
  assert.equal(badReason.status, 400);
  assert.match(badReason.body.error, /^Registro 6: motivo de no-rep desconhecido/);
  const badId = await append(JUDGE, id, 5, [{ id: 'com espaço', event: { t: 'rep' } }]);
  assert.match(badId.body.error, /identificador do aparelho inválido/);
  assert.equal(rows('race_attempt_events').length, 5, 'lote recusado não grava nada');

  assert.equal((await append(JUDGE, id, 5, [])).status, 400);
  assert.equal((await append(JUDGE, id, 5, Array.from({ length: race.RACE_MAX_EVENTS_PER_BATCH + 1 }, () => ev({ t: 'rep' })))).status, 400);
  assert.equal((await post(JUDGE, { action: 'append', attemptId: id, fromSeq: 5, events: [ev({ t: 'rep' })] })).status, 400, 'sem clientNow');
  assert.equal((await append(JUDGE_2, id, 5, [ev({ t: 'rep' })])).status, 403, 'outro árbitro não grava');
});

test('append: o limite de registros por tentativa responde 409', async (t) => {
  quiet(t);
  seed();
  await startRun();
  const id = (await openWallBall()).body.attempt.id;
  const filler = Array.from({ length: race.RACE_MAX_EVENTS_PER_ATTEMPT }, (_, seq) => ({ attempt_id: id, seq, client_event_id: `f${seq}`, event: { t: 'rep' }, device_at: null, clock_offset_ms: 0, recorded_at: '2026-11-01T10:00:00.000Z' }));
  database.rows('race_attempt_events').push(...filler);
  const full = await append(JUDGE, id, race.RACE_MAX_EVENTS_PER_ATTEMPT, [ev({ t: 'rep' })]);
  assert.equal(full.status, 409);
  assert.match(full.body.error, /limite de registros/);
});

test('horário: cada evento grava device_at e o desvio do lote; resolveEventTime corrige pelo desvio e usa o servidor como reserva', async (t) => {
  quiet(t);
  seed();
  await startRun();
  const id = (await openWallBall()).body.attempt.id;
  // O relógio do aparelho está 60 s atrasado; o start foi tocado 5 s antes do envio.
  const clientNow = Date.now() - 60_000;
  const start = ev({ t: 'start' }, { deviceAt: clientNow - 5000 });
  const noClock = ev({ t: 'rep' }, { deviceAt: undefined });
  const sent = await append(JUDGE, id, 0, [start, noClock], clientNow);
  assert.equal(sent.status, 200, sent.body.error);
  const [first, second] = rows('race_attempt_events').sort((a, b) => a.seq - b.seq);
  assert.equal(first.device_at, new Date(clientNow - 5000).toISOString());
  assert.ok(Math.abs(first.clock_offset_ms - 60_000) < 2000, `desvio ${first.clock_offset_ms}`);
  assert.equal(second.device_at, null);
  assert.equal(second.clock_offset_ms, first.clock_offset_ms, 'o desvio é do lote');
  // O início da tentativa é o horário do start corrigido: ~65 s antes do aparelho, ~5 s antes do servidor.
  const startedAt = Date.parse(rows('race_attempts')[0].started_at);
  assert.ok(Math.abs(startedAt - (Date.parse(first.recorded_at) - 5000)) < 2000);

  assert.equal((await append(JUDGE, id, 2, [ev({ t: 'rep' }, { deviceAt: 'ontem' })])).status, 400);
  const future = await append(JUDGE, id, 2, [ev({ t: 'rep' }, { deviceAt: Date.now() + 60_000 })]);
  assert.equal(future.status, 400);
  assert.match(future.body.error, /fora do lote/);

  const { resolveEventTime } = race;
  assert.equal(resolveEventTime({ deviceAt: '2026-11-01T10:00:00.000Z', clockOffsetMs: 1500, serverAt: '2026-11-01T10:00:10.000Z' }), '2026-11-01T10:00:01.500Z');
  assert.equal(resolveEventTime({ deviceAt: '2026-11-01T10:00:00.000Z', clockOffsetMs: '-2000', serverAt: '2026-11-01T10:00:10.000Z' }), '2026-11-01T09:59:58.000Z', 'BIGINT como texto');
  assert.equal(resolveEventTime({ deviceAt: null, clockOffsetMs: 1500, serverAt: '2026-11-01T10:00:10.000Z' }), '2026-11-01T10:00:10.000Z', 'sem horário do aparelho, vale o servidor');
  assert.equal(resolveEventTime({ deviceAt: '2026-11-01T10:00:00.000Z', clockOffsetMs: null, serverAt: '2026-11-01T10:00:10.000Z' }), '2026-11-01T10:00:10.000Z', 'sem desvio, vale o servidor');
  assert.equal(resolveEventTime({ deviceAt: '2026-11-01T10:00:20.000Z', clockOffsetMs: 0, serverAt: '2026-11-01T10:00:10.000Z' }), '2026-11-01T10:00:10.000Z', 'nunca depois de chegar ao servidor');
  assert.equal(resolveEventTime({ deviceAt: null, clockOffsetMs: null, serverAt: null }), null);
});

// ---------------------------------------------------------------------------
// Recálculo (AC9)
// ---------------------------------------------------------------------------

test('recálculo: 1ª infração advertência, 2ª vale 15 s; desfazer a 1ª cancela a dela e a 2ª vira advertência (mesma source_key)', async (t) => {
  quiet(t);
  seed();
  const run = await startRun();
  const sled = seedAttempt(run, 'sled-push', 'sled');
  const sent = await append(JUDGE, sled.id, 0, [ev({ t: 'start' }), ev({ t: 'infraction', code: 'lane_invaded' }), ev({ t: 'infraction', code: 'turned_before_line' })]);
  assert.equal(sent.status, 200, sent.body.error);
  let infractions = infractionsOf(sled.id);
  assert.deepEqual(infractions.map((row) => [row.source_key, row.kind, Number(row.seconds), row.status, row.origin]), [
    [`${sled.id}:sled-push:1:lane_invaded`, 'warning', 0, 'confirmed', 'engine'],
    [`${sled.id}:sled-push:2:turned_before_line`, 'penalty', 15, 'confirmed', 'engine']
  ]);
  assert.equal(infractions[0].created_by_user_id, JUDGE.id);

  const undo = await append(JUDGE, sled.id, 3, [ev({ t: 'undo', of: 1 })]);
  assert.equal(undo.status, 200, undo.body.error);
  infractions = infractionsOf(sled.id);
  assert.equal(infractions.length, 2, 'nada é recriado');
  assert.deepEqual(infractions.map((row) => [row.kind, Number(row.seconds), row.status]), [['warning', 0, 'cancelled'], ['warning', 0, 'confirmed']]);
  assert.deepEqual(undo.body.attempt.progress.voided, [1]);
  assert.equal(undo.body.infractions.length, 2);

  // Recálculo idempotente: o reenvio do mesmo lote não muda nada.
  const before = rows('race_infractions');
  await append(JUDGE, sled.id, 3, [ev({ t: 'undo', of: 1 }, { id: rows('race_attempt_events').find((row) => row.seq === 3).client_event_id })]);
  assert.deepEqual(rows('race_infractions').map((row) => [row.source_key, row.status, row.kind]), before.map((row) => [row.source_key, row.status, row.kind]));
  // undo de undo e de evento já desfeito são recusados pelo motor antes de gravar.
  assert.match((await append(JUDGE, sled.id, 4, [ev({ t: 'undo', of: 3 })])).body.error, /^Registro 5: não é possível desfazer um desfazer/);
  assert.match((await append(JUDGE, sled.id, 4, [ev({ t: 'undo', of: 1 })])).body.error, /já foi desfeito/);
});

test('recálculo: decisão do organizador sobrevive a novo lote e ao desfazer do árbitro; o desfazer cancela só a não decidida', async (t) => {
  quiet(t);
  seed();
  await startRun();
  const id = (await openWallBall()).body.attempt.id;
  await append(JUDGE, id, 0, [ev({ t: 'start' }), ev({ t: 'chalk' }), ev({ t: 'infraction', code: 'spitting' })]);
  let infractions = infractionsOf(id);
  assert.deepEqual(infractions.map((row) => [row.code, row.kind, Number(row.seconds), row.status, row.general]), [
    ['wall_ball_chalk', 'penalty', 120, 'confirmed', false],
    ['spitting', 'penalty', 120, 'confirmed', true]
  ], 'penalidade nasce confirmed (D2)');

  // O organizador revoga o magnésio (Story 1.98 grava assim: status + decided_at).
  const chalk = database.rows('race_infractions').find((row) => row.code === 'wall_ball_chalk');
  Object.assign(chalk, { status: 'revoked', decided_at: '2026-11-01T10:30:00.000Z', decided_by_user_id: MANAGER.id, decided_by_name: MANAGER.name });
  await append(JUDGE, id, 3, reps(2));
  assert.equal(infractionsOf(id)[0].status, 'revoked', 'novo lote não reativa');
  // O árbitro desfaz o magnésio e o cuspe: a revogada fica como o organizador deixou; a outra é cancelada.
  const undone = await append(JUDGE, id, 5, [ev({ t: 'undo', of: 1 }), ev({ t: 'undo', of: 2 })]);
  assert.equal(undone.status, 200, undone.body.error);
  infractions = infractionsOf(id);
  assert.deepEqual(infractions.map((row) => [row.code, row.status]), [['wall_ball_chalk', 'revoked'], ['spitting', 'cancelled']]);
  assert.equal(infractions[0].decided_by_user_id, MANAGER.id);
});

test('recálculo: a corrida inteira passa pelo motor; a 2ª estação fora de ordem cobra 3 min de novo em outra estação, sem DQ (REL-002)', async (t) => {
  quiet(t);
  seed();
  const run = await startRun();
  // Trenó com a Judge Paula: o Wall Ball é conferido sozinho (Story 1.103, AC3), então fica com outro judge.
  const sled = seedAttempt(run, 'sled-push', 'sled', JUDGE_2);
  await append(JUDGE_2, sled.id, 0, [ev({ t: 'start' }), ev({ t: 'infraction', code: 'station_out_of_order' })]);
  const wallBall = (await openWallBall()).body.attempt.id;
  const sent = await append(JUDGE, wallBall, 0, [ev({ t: 'start' }), ev({ t: 'infraction', code: 'station_out_of_order' })]);
  assert.equal(sent.status, 200, sent.body.error);
  assert.deepEqual(sent.body.infractions.map((row) => [row.code, row.kind, row.seconds, row.status]), [['station_out_of_order', 'penalty', 180, 'confirmed']]);
  assert.deepEqual(infractionsOf(sled.id).map((row) => [row.kind, Number(row.seconds)]), [['penalty', 180]]);
});

// Ajuste deliberado da Story 1.97 (AC8, D22; AC10): `exit` em tentativa de Wall Ball
// passou a ser recusado com 400 pela rota (antes: 200, exited_incomplete e 90 s;
// a regra "sair com 94 gera 90 s" segue testada no motor, em race-rules.test.mjs),
// e o desfazer da liberação passou a ser recusado com 409 (antes reabria a tentativa).
test('recálculo: Wall Ball com estado, progresso e fim; sair com 94 de 100 é recusado (D22); liberar exige as 100', async (t) => {
  quiet(t);
  seed();
  await startRun();
  // Largada no passado: o fechamento só acontece com o fim depois da largada (AC11).
  Object.assign(await startRun('ath-ana'), { started_at: new Date(Date.now() - 3_600_000).toISOString() });
  const caio = (await openWallBall()).body.attempt.id;
  const early = await append(JUDGE, caio, 0, [ev({ t: 'start' }), ...reps(94), ev({ t: 'norep', reason: 'shallow_squat' }), ev({ t: 'release' })]);
  assert.equal(early.status, 400);
  assert.match(early.body.error, /faltam 6 repetições/);
  const exited = await append(JUDGE, caio, 0, [ev({ t: 'start' }), ...reps(94), ev({ t: 'norep', reason: 'shallow_squat' }), ev({ t: 'exit' })]);
  assert.equal(exited.status, 400);
  assert.match(exited.body.error, /Sair antes das reps não fecha o tempo/);
  assert.equal(rows('race_attempt_events').filter((row) => row.attempt_id === caio).length, 0, 'nada do lote é gravado');
  assert.equal(infractionsOf(caio).length, 0);

  const ana = (await openWallBall(JUDGE_2, 'ath-ana')).body.attempt.id;
  const released = await append(JUDGE_2, ana, 0, [ev({ t: 'start' }), ...reps(100), ev({ t: 'release' })]);
  assert.equal(released.status, 200, released.body.error);
  assert.equal(released.body.attempt.status, 'released');
  assert.equal(released.body.attempt.progress.validReps, 100);
  assert.deepEqual(released.body.infractions, []);
  assert.equal(rows('race_runs').find((row) => row.athlete_id === 'ath-ana').status, 'finished', 'a liberação fecha o tempo (Story 1.97)');
  // O árbitro não desfaz a liberação (AC10): 409 e nada muda.
  const reopened = await append(JUDGE_2, ana, 102, [ev({ t: 'undo', of: 101 })]);
  assert.equal(reopened.status, 409);
  assert.match(reopened.body.error, /já foi encerrada/);
  assert.equal(rows('race_attempts').find((row) => row.id === ana).status, 'released');
});

test('desfazer o start depois de várias reps (REL-003): a rota aceita, as reps perdem o efeito e a tentativa volta a aguardar', async (t) => {
  quiet(t);
  seed();
  await startRun();
  const id = (await openWallBall()).body.attempt.id;
  await append(JUDGE, id, 0, [ev({ t: 'start' }), ...reps(50)]);
  const undone = await append(JUDGE, id, 51, [ev({ t: 'undo', of: 0 })]);
  assert.equal(undone.status, 200, undone.body.error);
  assert.equal(undone.body.attempt.status, 'waiting');
  assert.equal(undone.body.attempt.progress.validReps, 0);
  assert.equal(undone.body.attempt.startedAt, null);
  assert.deepEqual(undone.body.attempt.progress.voided, [0], 'só o start aparece como desfeito; as 50 reps ficam no log sem efeito');
  assert.equal(rows('race_attempt_events').length, 52, 'nada sai do log');
});

test('leitura: view attempt devolve log, infrações, estação e regulamento para quem arbitra; judge de outro evento 403', async (t) => {
  quiet(t);
  seed();
  await startRun();
  const id = (await openWallBall()).body.attempt.id;
  await append(JUDGE, id, 0, [ev({ t: 'start' }), ev({ t: 'chalk' })]);
  const view = await get(MANAGER, { view: 'attempt', attemptId: id });
  assert.equal(view.status, 200, view.body.error);
  assert.equal(view.body.events.length, 2);
  assert.deepEqual(view.body.events[1].event, { t: 'chalk' });
  assert.equal(view.body.infractions.length, 1);
  assert.equal(view.body.stage.id, 'wall-balls');
  assert.equal(view.body.ruleset.rules.wallBall.chalkSeconds, 120);
  assert.equal(view.body.viewer.role, 'manager');
  assert.equal((await get(JUDGE_OTHER, { view: 'attempt', attemptId: id })).status, 403);
  assert.equal((await get(JUDGE, { view: 'attempt', attemptId: 'nao-existe' })).status, 404);
});

// ---------------------------------------------------------------------------
// Limite, banco sem migration e Functional Fitness (AC11, AC12, AC13)
// ---------------------------------------------------------------------------

test('limite por pessoa e por ação: a 11ª correção de largada no minuto responde 429, as outras ações seguem', async (t) => {
  quiet(t);
  seed();
  for (let index = 0; index < 10; index += 1) {
    assert.notEqual((await post(OWNER_LIMIT, { action: 'adjust_heat_start', eventId: EVENT, heatId: 'heat-x', clock: '08:00', reason: 'Teste' })).status, 429);
  }
  assert.equal((await post(OWNER_LIMIT, { action: 'adjust_heat_start', eventId: EVENT, heatId: 'heat-x', clock: '08:00', reason: 'Teste' })).status, 429);
  assert.notEqual((await post(OWNER_LIMIT, { action: 'open_attempt', eventId: EVENT, athleteId: 'ath-caio', stationId: 'wall-balls' })).status, 429);
  assert.notEqual((await post(MANAGER, { action: 'adjust_heat_start', eventId: EVENT, heatId: 'heat-x', clock: '08:00', reason: 'Teste' })).status, 429, 'o limite é por pessoa');
});

test('banco sem a migration: a rota responde 503 com a migration; a súmula de Functional Fitness segue de pé', async (t) => {
  quiet(t);
  seed();
  state.missingRaceTables = true;
  const open = await openWallBall();
  assert.equal(open.status, 503);
  assert.match(open.body.error, /Aplique a migration 20261030120000_race_sheets\.sql/);
  assert.equal((await get(JUDGE, { view: 'attempt', attemptId: 'qualquer' })).status, 503);
  assert.equal((await post(MANAGER, { action: 'mark_dnf', eventId: EVENT, runId: 'run-x', reason: 'Teste' })).status, 503);
  assert.equal((await get(JUDGE, { view: 'events' })).status, 200, 'a lista de eventos não depende das tabelas novas');

  const ffEvents = await getSheets(new Request('http://localhost/api/sheets?view=events', { headers: { cookie: cookie(JUDGE) } }));
  assert.equal(ffEvents.status, 200);
  assert.deepEqual((await ffEvents.json()).events.map((event) => event.id), ['ev-ff']);
});

test('regressão (AC13): /api/sheets continua recusando evento Fitness Race com 400', async (t) => {
  quiet(t);
  seed();
  const response = await postSheets(new Request('http://localhost/api/sheets', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookie(JUDGE) },
    body: JSON.stringify({ action: 'open', eventId: EVENT, workoutId: 'wod-x', athleteId: 'ath-caio' })
  }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /exclusiva de eventos Functional Fitness presenciais/);
});

// ---------------------------------------------------------------------------
// Passada do gate da 1.94 (TEST-001, TEST-002) e da revisão do @data-engineer
// ---------------------------------------------------------------------------

const seedVencidaAttempt = () => {
  database.rows('race_attempts').push({
    id: 'attempt-vencida', run_id: 'run-vencida', event_id: 'ev-race-vencida', athlete_id: 'ath-x', station_id: 'wall-balls', station_kind: 'wall_ball',
    lane: 1, judge_user_id: JUDGE_EXPIRED.id, judge_name: JUDGE_EXPIRED.name, status: 'waiting', progress: {}, started_at: null, ended_at: null,
    created_at: '2026-11-01T10:00:00.000Z', updated_at: '2026-11-01T10:00:00.000Z'
  });
};

test('TEST-001: judge de gestor vencido não lista, não abre e não grava; judge de outro gestor atribuído ao evento 403', async (t) => {
  quiet(t);
  seed();
  seedVencidaAttempt();
  const list = await get(JUDGE_EXPIRED, { view: 'events' });
  assert.equal(list.status, 403);
  assert.match(list.body.error, /expirou/);
  const open = await post(JUDGE_EXPIRED, { action: 'open_attempt', eventId: 'ev-race-vencida', athleteId: 'ath-x', stationId: 'wall-balls' });
  assert.equal(open.status, 403);
  assert.match(open.body.error, /expirou/);
  const sent = await append(JUDGE_EXPIRED, 'attempt-vencida', 0, [ev({ t: 'start' })]);
  assert.equal(sent.status, 403);
  assert.match(sent.body.error, /expirou/);
  assert.equal(rows('race_attempt_events').length, 0);

  await startRun();
  const foreign = await openWallBall(JUDGE_FOREIGN);
  assert.equal(foreign.status, 403, 'event_judges sozinho não basta');
  assert.match(foreign.body.error, /sem vínculo com o gestor do evento/);
});

test('TEST-001: judge que assumiu a tentativa e saiu de event_judges não grava nem lê', async (t) => {
  quiet(t);
  seed();
  await startRun();
  const id = (await openWallBall()).body.attempt.id;
  assert.equal((await append(JUDGE, id, 0, [ev({ t: 'start' })])).status, 200);
  const assignments = database.rows('event_judges');
  assignments.splice(assignments.findIndex((row) => row.event_id === EVENT && row.judge_user_id === JUDGE.id), 1);
  const blocked = await append(JUDGE, id, 1, [ev({ t: 'rep' })]);
  assert.equal(blocked.status, 403, 'ser dono da tentativa não basta');
  assert.match(blocked.body.error, /não atribuído/);
  assert.equal((await get(JUDGE, { view: 'attempt', attemptId: id })).status, 403);
  assert.equal(rows('race_attempt_events').length, 1);
});

test('TEST-002: dois judges assumindo a mesma tentativa sem árbitro: o segundo recebe 409 com o nome do primeiro', async (t) => {
  quiet(t);
  seed();
  await startRun();
  const id = (await openWallBall()).body.attempt.id;
  await post(MANAGER, { action: 'claim_attempt', attemptId: id, release: true });
  // Judge Paula assume no mesmo instante, entre a leitura e a gravação condicional do Judge Rafa.
  state.beforeUpdate.race_attempts = (db) => Object.assign(db.rows('race_attempts').find((row) => row.id === id), { judge_user_id: JUDGE_2.id, judge_name: JUDGE_2.name });
  const late = await post(JUDGE, { action: 'claim_attempt', attemptId: id });
  assert.equal(late.status, 409);
  assert.match(late.body.error, /Judge Paula/);
  assert.equal(rows('race_attempts')[0].judge_user_id, JUDGE_2.id, 'a gravação condicional não passa por cima');
});

test('TEST-002: tentativa e corrida canceladas ficam de fora ao abrir, ao gravar e no recálculo', async (t) => {
  quiet(t);
  seed();
  // Corrida cancelada sozinha não conta como largada.
  database.rows('race_runs').push({ ...(await startRun('ath-ana')), id: 'run-ana-cancelada', status: 'cancelled' });
  database.rows('race_runs').splice(database.rows('race_runs').findIndex((row) => row.id === 'run-ath-ana'), 1);
  assert.equal((await openWallBall(JUDGE, 'ath-ana')).body.error, 'A onda ainda não largou.');

  const run = await startRun();
  const cancelledWb = { ...seedAttempt(run, 'wall-balls', 'wall_ball', JUDGE_2), id: 'attempt-wb-cancelada', status: 'cancelled' };
  database.rows('race_attempts').splice(-1, 1, cancelledWb);
  const cancelledSled = { ...seedAttempt(run, 'sled-push', 'sled'), id: 'attempt-sled-cancelada', status: 'cancelled' };
  database.rows('race_attempts').splice(-1, 1, cancelledSled);
  database.rows('race_attempt_events').push(
    { attempt_id: cancelledSled.id, seq: 0, client_event_id: 'k0', event: { t: 'start' }, device_at: null, clock_offset_ms: 0, recorded_at: '2026-11-01T10:06:00.000Z' },
    { attempt_id: cancelledSled.id, seq: 1, client_event_id: 'k1', event: { t: 'infraction', code: 'station_out_of_order' }, device_at: null, clock_offset_ms: 0, recorded_at: '2026-11-01T10:06:01.000Z' }
  );
  assert.equal((await append(JUDGE_2, cancelledWb.id, 0, [ev({ t: 'start' })])).status, 409, 'tentativa cancelada não grava');

  const opened = await openWallBall(JUDGE);
  assert.equal(opened.status, 200, opened.body.error);
  assert.notEqual(opened.body.attempt.id, cancelledWb.id, 'a cancelada não é retomada');
  const sent = await append(JUDGE, opened.body.attempt.id, 0, [ev({ t: 'start' }), ev({ t: 'infraction', code: 'station_out_of_order' })]);
  assert.equal(sent.status, 200, sent.body.error);
  assert.deepEqual(sent.body.infractions.map((row) => [row.kind, row.seconds]), [['penalty', 180]], 'a fora de ordem da tentativa cancelada não conta');
  assert.equal(rows('race_attempts').find((row) => row.id === cancelledSled.id).status, 'cancelled', 'o recálculo não mexe na cancelada');
});

test('L9: o mesmo lote gravado por outro pedido no mesmo instante segue como reenvio; lote diferente dá 409 com a contagem de agora', async (t) => {
  quiet(t);
  seed();
  await startRun();
  const id = (await openWallBall()).body.attempt.id;
  const batch = [ev({ t: 'start' }), ev({ t: 'rep' })];
  const asStored = (items, from) => items.map((item, index) => ({ attempt_id: id, seq: from + index, client_event_id: item.id, event: item.event, device_at: null, clock_offset_ms: 0, recorded_at: new Date().toISOString() }));
  database.onceBeforeInsert('race_attempt_events', (db) => db.rows('race_attempt_events').push(...asStored(batch, 0)));
  const parallel = await append(JUDGE, id, 0, batch);
  assert.equal(parallel.status, 200, parallel.body.error);
  assert.equal(parallel.body.count, 2);
  assert.equal(parallel.body.attempt.progress.validReps, 1, 'o recálculo roda sobre o log gravado');
  assert.equal(rows('race_attempt_events').length, 2);

  database.onceBeforeInsert('race_attempt_events', (db) => db.rows('race_attempt_events').push(...asStored([ev({ t: 'rep' }), ev({ t: 'rep' })], 2)));
  const other = await append(JUDGE, id, 2, [ev({ t: 'rep' })]);
  assert.equal(other.status, 409);
  assert.equal(other.body.serverCount, 4, 'contagem relida depois do conflito');
});

test('M2: sem o log lido inteiro, o recálculo não grava estado velho nem cancela infração de evento que não leu', async (t) => {
  quiet(t);
  seed();
  const run = await startRun();
  const id = (await openWallBall()).body.attempt.id;
  // Infração criada por um recálculo que já viu um evento que este ainda não leu (seq 7).
  database.rows('race_infractions').push({
    id: 'infraction-futura', run_id: run.id, attempt_id: id, station_id: 'wall-balls', source_key: `${id}:wall-balls:7:wall_ball_chalk`, source_seq: 7,
    code: 'wall_ball_chalk', label: 'Magnésio no Wall Ball', kind: 'penalty', seconds: 120, status: 'confirmed', origin: 'engine', general: false,
    units: null, resolution: null, note: null, decided_at: null, created_at: '2026-11-01T10:00:00.000Z', updated_at: '2026-11-01T10:00:00.000Z'
  });
  // Outro lote entra entre a leitura do log e a gravação do estado.
  state.beforeCount.race_attempt_events = (db) => db.rows('race_attempt_events').push({ attempt_id: id, seq: 1, client_event_id: 'paralelo', event: { t: 'rep' }, device_at: null, clock_offset_ms: 0, recorded_at: new Date().toISOString() });
  const sent = await append(JUDGE, id, 0, [ev({ t: 'start' })]);
  assert.equal(sent.status, 200, sent.body.error);
  assert.equal(sent.body.attempt.status, 'waiting', 'o estado do log velho (running, 0 reps) não foi gravado');
  assert.deepEqual(sent.body.attempt.progress, {});
  assert.equal(rows('race_infractions').find((row) => row.id === 'infraction-futura').status, 'confirmed', 'evento fora do log lido não cancela');

  const next = await append(JUDGE, id, 2, [ev({ t: 'rep' })]);
  assert.equal(next.body.attempt.status, 'running');
  assert.equal(next.body.attempt.progress.validReps, 2);
  assert.equal(rows('race_infractions').find((row) => row.id === 'infraction-futura').status, 'confirmed', 'seq 7 ainda fora do log');
});

test('não há DQ: propose_dq responde 400 com a posição e nada é gravado', async (t) => {
  quiet(t);
  seed();
  await startRun();
  const id = (await openWallBall()).body.attempt.id;
  const refused = await append(JUDGE, id, 0, [ev({ t: 'start' }), ev({ t: 'propose_dq', reason: 'Pisou fora da área' })]);
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /^Registro 2: tipo de registro desconhecido/);
  assert.deepEqual(infractionsOf(id), []);
});
