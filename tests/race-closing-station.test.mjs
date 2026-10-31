import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createFakeSupabase } from './support/fakeSupabase.mjs';
import { createRaceClient } from './support/fakeRaceSupabase.mjs';
import { importServerModule, setActiveSupabaseClient } from './support/serverModuleHarness.mjs';

// Story 1.101 (F2 da súmula Fitness Race): a última estação do percurso fecha
// o tempo (D34), de qualquer tipo; o Wall Ball no meio do percurso é conferido
// e não fecha; saída incompleta de trenó ou seções não fecha, nem na última
// estação (D44); registro tardio de estação anterior com a corrida fechada
// (D9); "Sem tempo fechado" pela estação de fechamento; `closesTime` na
// tentativa e no quadro (D39). Pela rota real com o banco em memória. Até a
// 1.102, `open_attempt` só abre Wall Ball: as tentativas das outras estações
// são semeadas direto no banco (anotação do @po).

process.env.SUPABASE_URL = 'http://supabase.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';
process.env.WODA_SESSION_SECRET = 'segredo-de-teste-estacao-final';

let database = createFakeSupabase();
const state = { missingRaceTables: false, beforeUpdate: {}, beforeCount: {} };
const client = createRaceClient(() => database, state);
setActiveSupabaseClient(client);

const { GET, POST } = await importServerModule('app/api/race-sheets/route.ts');
const { POST: postPersistence } = await importServerModule('app/api/admin/persistence/route.ts');
const { POST: postSheets } = await importServerModule('app/api/sheets/route.ts');
const { createSessionToken } = await importServerModule('lib/serverSecurity.ts');
const race = await importServerModule('lib/serverRaceSheets.ts');
const structure = await importServerModule('lib/raceCourseStructure.ts');
const view = await importServerModule('lib/racePenaltiesView.ts');
const decisionsModule = await importServerModule('lib/serverRaceDecisions.ts');
const publication = await importServerModule('lib/serverRacePublication.ts');
const { WallBallCard } = await importServerModule('components/race/WallBallCard.tsx');
const wb = await importServerModule('lib/raceWallBall.ts');
const presets = await importServerModule('lib/raceRulePresets.ts');

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const MANAGER = { id: 'mgr-fim', name: 'Gestora Fim', email: 'fim@example.com', role: 'manager', service_valid_until: '2099-12-31' };
const JUDGE = { id: 'judge-rafa', name: 'Judge Rafa', email: 'rafa@example.com', role: 'judge', parent_manager_id: MANAGER.id };
const JUDGE_2 = { id: 'judge-paula', name: 'Judge Paula', email: 'paula@example.com', role: 'judge', parent_manager_id: MANAGER.id };

const EVENT = 'ev-fim';
const run = (id, orderIndex) => ({ id, name: `Corrida ${orderIndex}`, type: 'run', orderIndex, distance: '1km' });
const WALL_BALL = (orderIndex) => ({ id: 'wall-balls', name: 'Wall Balls', type: 'station', orderIndex, reps: 100, maleWeight: '9kg', femaleWeight: '6kg' });
const SLED = (orderIndex) => ({ id: 'sled-push', name: 'Sled Push', type: 'station', orderIndex, distance: '50m', maleWeight: '152kg', femaleWeight: '102kg' });
const SECTIONS = (orderIndex) => ({ id: 'sandbag', name: 'Sandbag Lunges', type: 'station', orderIndex, distance: '100m', conferenceKind: 'sections', units: 8 });
const ERG = (orderIndex) => ({ id: 'ski', name: 'SkiErg', type: 'station', orderIndex, distance: '1000m', conferenceKind: 'ergometer' });
const GENERIC = (orderIndex) => ({ id: 'box-jump', name: 'Box Jump', type: 'station', orderIndex, conferenceKind: 'generic' });

const COURSES = {
  // Percurso oficial reduzido: o Wall Ball é a última estação (comportamento da F1).
  'div-wb-last': [run('run-1', 0), SLED(1), run('run-2', 2), WALL_BALL(3)],
  // Wall Ball no meio; o trenó fecha o tempo.
  'div-sled-last': [run('run-1', 0), WALL_BALL(1), run('run-2', 2), SLED(3)],
  // 4 estações, Wall Ball na 3ª posição; seções fecham; corrida final até a linha depois.
  'div-four': [run('run-1', 0), ERG(1), run('run-2', 2), SLED(3), run('run-3', 4), WALL_BALL(5), run('run-4', 6), SECTIONS(7), run('run-final', 8)],
  'div-erg-last': [run('run-1', 0), WALL_BALL(1), run('run-2', 2), ERG(3)],
  'div-gen-last': [run('run-1', 0), WALL_BALL(1), run('run-2', 2), GENERIC(3)]
};
const ATHLETES = [
  ['ath-ana', 'Ana Souza', 'div-wb-last'],
  ['ath-bia', 'Bia Lima', 'div-wb-last'],
  ['ath-caio', 'Caio Reis', 'div-sled-last'],
  ['ath-davi', 'Davi Melo', 'div-sled-last'],
  ['ath-eva', 'Éva Prado', 'div-four'],
  ['ath-fabi', 'Fabi Rocha', 'div-four'],
  ['ath-gil', 'Gil Torres', 'div-erg-last'],
  ['ath-hugo', 'Hugo Nunes', 'div-gen-last']
];

const seed = () => {
  database = createFakeSupabase({
    users: [MANAGER, JUDGE, JUDGE_2],
    events: [{
      id: EVENT, name: 'Race Estação Final', date: '2026-11-01', location: 'Recife', organizer_id: MANAGER.id, event_type: 'fitness_racing', status: 'upcoming', time_zone: 'America/Fortaleza',
      event_schedule: [{ id: 'heat-1', kind: 'heat', date: '2026-11-01', time: '08:00', title: 'Onda 1', heatNumber: 1, athleteIds: ATHLETES.map(([id]) => id) }]
    }],
    event_judges: [{ event_id: EVENT, judge_user_id: JUDGE.id }, { event_id: EVENT, judge_user_id: JUDGE_2.id }],
    divisions: Object.entries(COURSES).map(([id, course]) => ({ id, event_id: EVENT, name: id, type: 'individual', category: 'female', course_layout: course })),
    athletes: ATHLETES.map(([id, name, division]) => ({ id, name, box: 'Box', division_id: division })),
    workouts: [], scores: [], registrations: []
  });
  state.missingRaceTables = false;
  state.beforeUpdate = {};
  state.beforeCount = {};
  decisionsModule.setRaceRunPublisher(publication.publishRaceRun);
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
const divisionOf = (athleteId) => ATHLETES.find(([id]) => id === athleteId)[2];
const scoreOf = (athleteId) => database.rows('scores').find((row) => row.athlete_id === athleteId && row.workout_id === `wod-${divisionOf(athleteId)}-total`);
const infractionsOf = (attemptId) => rows('race_infractions').filter((row) => row.attempt_id === attemptId);

/**
 * A onda largou uma hora atrás (Story 1.96): regulamento com o snapshot do
 * percurso e a corrida `racing` do atleta. A largada é gravada direto porque a
 * fixture do evento é no futuro (a liberação precisa vir depois da largada).
 */
const startRun = async (athleteId, extra = {}) => {
  const ruleset = await race.ensureRaceRuleset(client, EVENT);
  if (!database.rows('race_heat_marks').length) {
    database.rows('race_heat_marks').push({ event_id: EVENT, heat_id: 'heat-1', started_at: new Date(Date.now() - 3_600_000).toISOString(), started_by_user_id: MANAGER.id, started_by_name: MANAGER.name });
  }
  const row = {
    id: `run-${athleteId}`, event_id: EVENT, division_id: divisionOf(athleteId), athlete_id: athleteId, heat_id: 'heat-1', ruleset_id: ruleset.id,
    status: 'racing', started_at: new Date(Date.now() - 3_600_000).toISOString(), finish_at: null, gross_seconds: null, penalty_seconds: 0, official_seconds: null,
    time_source: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...extra
  };
  database.rows('race_runs').push(row);
  return row;
};

/** Tentativa numa estação que só abre pela rota na 1.102: gravada direto, com o tipo do snapshot. */
const seedAttempt = (runRow, stationId, stationKind, judge = JUDGE) => {
  const row = {
    id: `attempt-${runRow.athlete_id}-${stationId}`, run_id: runRow.id, event_id: EVENT, athlete_id: runRow.athlete_id, station_id: stationId, station_kind: stationKind,
    lane: 1, judge_user_id: judge.id, judge_name: judge.name, status: 'waiting', progress: {}, started_at: null, ended_at: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString()
  };
  database.rows('race_attempts').push(row);
  return row.id;
};

const openWallBall = async (athleteId, judge = JUDGE) => {
  const opened = await post(judge, { action: 'open_attempt', eventId: EVENT, athleteId, stationId: 'wall-balls' });
  assert.equal(opened.status, 200, opened.body.error);
  return opened.body;
};

let counter = 0;
const ev = (event) => ({ id: `f${(counter += 1)}`, event, deviceAt: Date.now() });
const reps = (count) => Array.from({ length: count }, () => ev({ t: 'rep' }));
const sections = (count) => Array.from({ length: count }, () => ev({ t: 'section' }));
const append = (attemptId, fromSeq, events, judge = JUDGE) => post(judge, { action: 'append', attemptId, fromSeq, events, clientNow: Date.now() });
const manage = async () => {
  const out = await get(MANAGER, { view: 'manage', eventId: EVENT });
  assert.equal(out.status, 200, out.body.error);
  return out.body;
};
const noTimeLine = (board, athleteName, clock = '09:41:12') => {
  const row = view.listNoTimeRuns(board.runs).find((item) => item.athleteName === athleteName);
  assert.ok(row, `${athleteName} em "Sem tempo fechado"`);
  return view.describeRaceNoTimeReason(row.closingStation, () => clock);
};
const assertOpenRun = (athleteId, message) => {
  const row = runOf(athleteId);
  assert.equal(row.status, 'racing', message);
  assert.equal(row.finish_at, null);
  assert.equal(row.gross_seconds, null);
  assert.equal(row.official_seconds, null);
  assert.equal(scoreOf(athleteId), undefined, 'nada publicado');
};

// ---------------------------------------------------------------------------
// lastRaceStation (AC1)
// ---------------------------------------------------------------------------

test('lastRaceStation: pula a corrida final, segue o orderIndex, lê snapshot antigo sem os campos novos; closesRaceTime', () => {
  const four = race.toRaceSnapshotStages(COURSES['div-four']);
  assert.equal(structure.lastRaceStation(four).id, 'sandbag', 'a corrida final até a linha não conta');
  const shuffled = [SLED(3), run('run-1', 0), WALL_BALL(1), run('run-2', 2), run('run-final', 4)];
  assert.equal(structure.lastRaceStation(shuffled).id, 'sled-push', 'ordem pelo orderIndex, não pela lista');
  // Snapshot da F1: sem conferenceKind, units nem orderIndex (a posição na lista vale).
  const legacy = [{ id: 'r1', name: 'Corrida', type: 'run' }, { id: 'wb', name: 'Wall Balls', type: 'station', kind: 'wall_ball' }, { id: 'sk', name: 'Ski Erg', type: 'station', kind: 'ergometer' }, { id: 'r2', name: 'Corrida', type: 'run' }];
  assert.equal(structure.lastRaceStation(legacy).id, 'sk');
  assert.equal(structure.lastRaceStation([run('run-1', 0)]), null);
  assert.equal(structure.lastRaceStation([]), null);
  assert.equal(structure.closesRaceTime(four, 'sandbag'), true);
  assert.equal(structure.closesRaceTime(four, 'wall-balls'), false);
  assert.equal(structure.closesRaceTime(four, 'run-final'), false);
  assert.equal(structure.closesRaceTime(four, null), false);
});

// ---------------------------------------------------------------------------
// Fechamento pela última estação (AC2, AC3)
// ---------------------------------------------------------------------------

test('Wall Ball por último: a liberação fecha como na F1 (bruto, oficial = bruto + vigentes, sheet), reenvio não fecha duas vezes, fim antes da largada não fecha', async () => {
  seed();
  await startRun('ath-ana');
  const opened = await openWallBall('ath-ana');
  assert.equal(opened.attempt.closesTime, true);
  const batch = [ev({ t: 'start' }), ev({ t: 'chalk' }), ...reps(100), ev({ t: 'release' })];
  const out = await append(opened.attempt.id, 0, batch);
  assert.equal(out.status, 200, out.body.error);
  assert.equal(out.body.attempt.closesTime, true);
  assert.equal(out.body.republish.ok, true);
  const closed = runOf('ath-ana');
  assert.equal(closed.status, 'finished');
  assert.equal(closed.time_source, 'sheet');
  assert.ok(closed.finish_at);
  const gross = Math.round(Date.parse(closed.finish_at) - Date.parse(closed.started_at)) / 1000;
  assert.equal(Number(closed.gross_seconds), gross);
  assert.equal(Number(closed.penalty_seconds), 120);
  assert.equal(Number(closed.official_seconds), gross + 120);
  assert.equal(scoreOf('ath-ana').race_run_id, closed.id);
  const snapshot = structuredClone(closed);

  const again = await append(opened.attempt.id, 0, batch);
  assert.equal(again.status, 200, again.body.error);
  assert.equal(runOf('ath-ana').finish_at, snapshot.finish_at, 'o reenvio não fecha de novo');
  assert.equal(Number(runOf('ath-ana').official_seconds), Number(snapshot.official_seconds));

  // Largada no futuro: o fim fica antes dela e a corrida segue sem tempo (Story 1.97, AC11).
  await startRun('ath-bia', { started_at: new Date(Date.now() + 3_600_000).toISOString() });
  const bia = await openWallBall('ath-bia');
  const early = await append(bia.attempt.id, 0, [ev({ t: 'start' }), ...reps(100), ev({ t: 'release' })]);
  assert.equal(early.status, 200, early.body.error);
  assertOpenRun('ath-bia', 'fim antes da largada não fecha');
  assert.equal(noTimeLine(await manage(), 'Bia Lima'), 'Liberação registrada com horário inválido (antes da largada ou sem largada).');
});

test('Wall Ball no meio [run, wall-balls, run, sled]: a liberação não fecha nem publica; a do trenó (última) fecha e publica', async () => {
  seed();
  const caio = await startRun('ath-caio');
  const opened = await openWallBall('ath-caio');
  assert.equal(opened.attempt.closesTime, false, 'o Wall Ball no meio não fecha o tempo');
  const released = await append(opened.attempt.id, 0, [ev({ t: 'start' }), ev({ t: 'chalk' }), ...reps(100), ev({ t: 'release' })]);
  assert.equal(released.status, 200, released.body.error);
  assert.equal(released.body.attempt.status, 'released');
  assert.equal(released.body.attempt.closesTime, false);
  assert.equal(released.body.republish, undefined, 'nada publicado');
  assertOpenRun('ath-caio', 'a corrida segue em andamento');
  assert.equal(noTimeLine(await manage(), 'Caio Reis'), 'Sem liberação de Sled Push (nenhuma súmula aberta na estação).');

  const sled = seedAttempt(caio, 'sled-push', 'sled');
  const done = await append(sled, 0, [ev({ t: 'start' }), ...sections(4), ev({ t: 'release' })]);
  assert.equal(done.status, 200, done.body.error);
  assert.equal(done.body.attempt.closesTime, true);
  assert.equal(done.body.republish.ok, true);
  const closed = runOf('ath-caio');
  assert.equal(closed.status, 'finished');
  assert.equal(Number(closed.official_seconds), Number(closed.gross_seconds) + 120, 'o magnésio do Wall Ball do meio soma no oficial');
  assert.equal(scoreOf('ath-caio').value, Math.round(Number(closed.official_seconds)));
});

test('Wall Ball na 3ª de 4 estações não fecha; a última de cada tipo (ergômetro, trenó, seções, genérica) fecha e publica na prova TOTAL', async () => {
  seed();
  const eva = await startRun('ath-eva');
  const middle = await openWallBall('ath-eva');
  assert.equal(middle.attempt.closesTime, false);
  await append(middle.attempt.id, 0, [ev({ t: 'start' }), ...reps(100), ev({ t: 'release' })]);
  assertOpenRun('ath-eva', 'Wall Ball na 3ª posição não fecha');
  const sectionsAttempt = seedAttempt(eva, 'sandbag', 'sections');
  const closedBySections = await append(sectionsAttempt, 0, [ev({ t: 'start' }), ...sections(8), ev({ t: 'release' })]);
  assert.equal(closedBySections.status, 200, closedBySections.body.error);

  const gil = await startRun('ath-gil');
  const closedByErg = await append(seedAttempt(gil, 'ski', 'ergometer'), 0, [ev({ t: 'start' }), ev({ t: 'release' })]);
  assert.equal(closedByErg.status, 200, closedByErg.body.error);

  const hugo = await startRun('ath-hugo');
  const closedByGeneric = await append(seedAttempt(hugo, 'box-jump', 'generic'), 0, [ev({ t: 'start' }), ev({ t: 'release' })]);
  assert.equal(closedByGeneric.status, 200, closedByGeneric.body.error);

  const davi = await startRun('ath-davi');
  const closedBySled = await append(seedAttempt(davi, 'sled-push', 'sled'), 0, [ev({ t: 'start' }), ...sections(4), ev({ t: 'release' })]);
  assert.equal(closedBySled.status, 200, closedBySled.body.error);

  for (const athleteId of ['ath-eva', 'ath-gil', 'ath-hugo', 'ath-davi']) {
    const closed = runOf(athleteId);
    assert.equal(closed.status, 'finished', athleteId);
    assert.equal(closed.time_source, 'sheet', athleteId);
    assert.ok(Number(closed.gross_seconds) > 0, athleteId);
    const score = scoreOf(athleteId);
    assert.ok(score, `${athleteId} publicado na prova TOTAL`);
    assert.equal(score.race_run_id, closed.id);
    assert.equal(score.value, Math.round(Number(closed.official_seconds)));
  }
});

// ---------------------------------------------------------------------------
// Saída (AC4, D22, D44)
// ---------------------------------------------------------------------------

test('exit no tipo reps: 400 no meio e na última posição, nada gravado', async () => {
  seed();
  await startRun('ath-eva');
  await startRun('ath-ana');
  // Um judge por atleta no Wall Ball (Story 1.103, AC3; D32, D43).
  for (const [athleteId, judge] of [['ath-eva', JUDGE], ['ath-ana', JUDGE_2]]) {
    const opened = await openWallBall(athleteId, judge);
    const refused = await append(opened.attempt.id, 0, [ev({ t: 'start' }), ...reps(94), ev({ t: 'exit' })], judge);
    assert.equal(refused.status, 400, athleteId);
    assert.equal(refused.body.error, 'Sair antes das reps não fecha o tempo; o atleta precisa completar as reps.');
    assert.equal(rows('race_attempt_events').filter((row) => row.attempt_id === opened.attempt.id).length, 0, 'nada do lote é gravado');
    assertOpenRun(athleteId);
  }
});

test('exit incompleto de trenó e seções: 180 s por trecho, sem fechar o tempo nem no meio nem na última estação; "Sem tempo fechado" e o organizador ajusta (D44)', async () => {
  seed();
  // Trenó no meio do percurso.
  const ana = await startRun('ath-ana');
  const middleSled = seedAttempt(ana, 'sled-push', 'sled');
  const middle = await append(middleSled, 0, [ev({ t: 'start' }), ...sections(2), ev({ t: 'exit' })]);
  assert.equal(middle.status, 200, middle.body.error);
  assert.equal(middle.body.attempt.status, 'exited_incomplete');
  assert.equal(middle.body.attempt.closesTime, false);
  assertOpenRun('ath-ana', 'exit no meio só encerra a tentativa');

  // Trenó na última estação.
  const caio = await startRun('ath-caio');
  const lastSled = seedAttempt(caio, 'sled-push', 'sled');
  const last = await append(lastSled, 0, [ev({ t: 'start' }), ...sections(2), ev({ t: 'exit' })]);
  assert.equal(last.status, 200, last.body.error);
  assert.equal(last.body.attempt.status, 'exited_incomplete');
  assert.equal(last.body.attempt.closesTime, true);
  assert.equal(last.body.republish, undefined, 'nada publicado');
  const missing = infractionsOf(lastSled).find((row) => row.code === 'missing_units');
  assert.equal(Number(missing.seconds), 360, '2 trechos faltando × 180 s');
  assert.equal(missing.status, 'confirmed');
  assertOpenRun('ath-caio', 'a saída incompleta na última estação não fecha o tempo');
  assert.equal(Number(runOf('ath-caio').penalty_seconds), 0, 'a corrida ainda não somou: sem tempo fechado');

  // Seções na última estação.
  const eva = await startRun('ath-eva');
  const lastSections = seedAttempt(eva, 'sandbag', 'sections');
  const out = await append(lastSections, 0, [ev({ t: 'start' }), ...sections(5), ev({ t: 'exit' })]);
  assert.equal(out.status, 200, out.body.error);
  assert.equal(Number(infractionsOf(lastSections).find((row) => row.code === 'missing_units').seconds), 540);
  assertOpenRun('ath-eva');

  const board = await manage();
  assert.equal(noTimeLine(board, 'Caio Reis'), 'Atleta saiu de Sled Push às 09:41:12 com 2 de 4 trechos (árbitro Judge Rafa).');
  assert.equal(noTimeLine(board, 'Éva Prado'), 'Atleta saiu de Sandbag Lunges às 09:41:12 com 5 de 8 trechos (árbitro Judge Rafa).');
  const caioRow = board.runs.find((row) => row.athleteName === 'Caio Reis');
  assert.ok(caioRow.closingStation.exitAt, 'horário da saída para a linha');
  assert.deepEqual(view.raceRunActions(caioRow.status), { adjustTime: true, markDnf: true, undoDnf: false }, 'o organizador ajusta o tempo ou marca DNF');

  // O organizador ajusta o tempo: os 360 s já cobrados entram no oficial (D2, D44).
  const adjusted = await post(MANAGER, { action: 'adjust_time', eventId: EVENT, runId: caio.id, grossSeconds: 3500, reason: 'Saiu do trenó com 2 trechos' });
  assert.equal(adjusted.status, 200, adjusted.body.error);
  assert.equal(runOf('ath-caio').status, 'finished');
  assert.equal(runOf('ath-caio').time_source, 'manual');
  assert.equal(Number(runOf('ath-caio').official_seconds), 3500 + 360);
  assert.equal(scoreOf('ath-caio').value, 3860);
});

// ---------------------------------------------------------------------------
// Registro tardio (AC5, D9)
// ---------------------------------------------------------------------------

test('registro tardio: corrida fechada aceita o lote da estação anterior e republica; DNF 409; reps liberado 409; estação que fechou 409; tentativa nova 409', async () => {
  seed();
  const ana = await startRun('ath-ana');
  const sled = seedAttempt(ana, 'sled-push', 'sled', JUDGE_2);
  const sledEvents = [ev({ t: 'start' }), ...sections(4), ev({ t: 'release' })];
  assert.equal((await append(sled, 0, sledEvents, JUDGE_2)).status, 200);
  assertOpenRun('ath-ana', 'o trenó no meio não fecha');
  const opened = await openWallBall('ath-ana');
  const closed = await append(opened.attempt.id, 0, [ev({ t: 'start' }), ...reps(100), ev({ t: 'release' })]);
  assert.equal(closed.status, 200, closed.body.error);
  const before = structuredClone(runOf('ath-ana'));
  assert.equal(before.status, 'finished');
  assert.equal(scoreOf('ath-ana').value, Math.round(Number(before.official_seconds)));

  // A internet do judge do trenó voltou: o lixo registrado na estação entra agora.
  const late = await append(sled, sledEvents.length, [ev({ t: 'infraction', code: 'litter' })], JUDGE_2);
  assert.equal(late.status, 200, late.body.error);
  assert.equal(late.body.republish.ok, true, 'a resposta traz o aviso de republicação');
  assert.equal(infractionsOf(sled).filter((row) => row.code === 'litter' && row.status === 'confirmed').length, 1);
  const after = runOf('ath-ana');
  assert.equal(after.status, 'finished', 'a situação não muda');
  assert.equal(after.finish_at, before.finish_at);
  assert.equal(Number(after.penalty_seconds), Number(before.penalty_seconds) + 120);
  assert.equal(Number(after.official_seconds), Number(before.official_seconds) + 120);
  assert.equal(scoreOf('ath-ana').value, Math.round(Number(after.official_seconds)), 'a prova TOTAL é republicada');

  // Reps liberado segue fechado (Story 1.97, AC10).
  const wallBallLate = await append(opened.attempt.id, 102, [ev({ t: 'infraction', code: 'litter' })]);
  assert.equal(wallBallLate.status, 409);
  assert.equal(wallBallLate.body.error, 'Esta tentativa já foi encerrada. Correção de tempo ou de penalidade é com o organizador.');

  // A estação que fechou o tempo (aqui, um trenó) não recebe registro do árbitro.
  const caio = await startRun('ath-caio');
  const lastSled = seedAttempt(caio, 'sled-push', 'sled');
  const lastEvents = [ev({ t: 'start' }), ...sections(4), ev({ t: 'release' })];
  assert.equal((await append(lastSled, 0, lastEvents)).status, 200);
  assert.equal(runOf('ath-caio').status, 'finished');
  const closingLate = await append(lastSled, lastEvents.length, [ev({ t: 'infraction', code: 'litter' })]);
  assert.equal(closingLate.status, 409);
  assert.match(closingLate.body.error, /já foi encerrada/);

  // DNF segue recusando (REQ-001 do gate da 1.94).
  runOf('ath-ana').status = 'dnf';
  const dnf = await append(sled, sledEvents.length + 1, [ev({ t: 'infraction', code: 'spitting' })], JUDGE_2);
  assert.equal(dnf.status, 409);
  assert.equal(dnf.body.error, 'A corrida deste atleta já foi encerrada. Correções são com o organizador.');

  // Abrir tentativa nova depois do fechamento continua recusado.
  await startRun('ath-bia', { status: 'finished', finish_at: new Date().toISOString(), gross_seconds: 3000, official_seconds: 3000, time_source: 'manual' });
  const reopened = await post(JUDGE, { action: 'open_attempt', eventId: EVENT, athleteId: 'ath-bia', stationId: 'wall-balls' });
  assert.equal(reopened.status, 409);
  assert.match(reopened.body.error, /já foi encerrada/);
});

// ---------------------------------------------------------------------------
// Painel "Sem tempo fechado" (AC7)
// ---------------------------------------------------------------------------

test('"Sem tempo fechado" nomeia a estação de fechamento: sem súmula, reps completas sem liberar, saída do Wall Ball; abandon só no tipo reps', async () => {
  seed();
  await startRun('ath-ana');
  const bia = await startRun('ath-bia');
  await startRun('ath-davi');
  const ana = await openWallBall('ath-ana');
  await append(ana.attempt.id, 0, [ev({ t: 'start' }), ...reps(40), ev({ t: 'abandon' })]);
  const biaWallBall = await openWallBall('ath-bia', JUDGE_2);
  await append(biaWallBall.attempt.id, 0, [ev({ t: 'start' }), ...reps(100)], JUDGE_2);
  // Trenó (não reps) não registra o `abandon` (D24): 400.
  const sled = seedAttempt(bia, 'sled-push', 'sled');
  const refused = await append(sled, 0, [ev({ t: 'start' }), ev({ t: 'abandon' })]);
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /a saída só é registrada no Wall Ball/);

  const board = await manage();
  assert.equal(noTimeLine(board, 'Ana Souza'), 'Atleta saiu do Wall Ball às 09:41:12 com 40 de 100 reps (árbitro Judge Rafa).');
  assert.equal(noTimeLine(board, 'Bia Lima'), 'Reps completas, mas o árbitro não liberou o atleta.');
  // Evento sem judge na última estação: a corrida aparece e o organizador lança à mão.
  assert.equal(noTimeLine(board, 'Davi Melo'), 'Sem liberação de Sled Push (nenhuma súmula aberta na estação).');
  const davi = board.runs.find((row) => row.athleteName === 'Davi Melo');
  assert.equal(davi.closingStation.stationName, 'Sled Push');
  assert.equal(davi.closingStation.kind, 'sled');
  assert.equal(davi.closingStation.status, null);
  assert.equal(view.describeRaceNoTimeReason({ ...davi.closingStation, status: 'running', judgeName: 'Judge Rafa' }, () => ''), 'Sem liberação de Sled Push (árbitro não liberou).');
  assert.equal(view.describeRaceNoTimeReason({ ...davi.closingStation, status: 'done_pending_release', judgeName: '' }, () => ''), 'Estação completa, mas o árbitro não liberou o atleta.');
  // abandoned só vale no tipo reps.
  assert.doesNotMatch(view.describeRaceNoTimeReason({ ...davi.closingStation, status: 'running', abandoned: true }, () => ''), /reps/);
});

test('painel: cabeçalhos dizem "última estação", sem DQ', () => {
  const panel = read('../src/components/admin/RacePenaltiesPanel.tsx');
  assert.match(panel, /Bruto = largada da onda até a liberação da última estação/);
  assert.match(panel, /a última estação não liberou o atleta/);
  assert.doesNotMatch(panel, /liberação do Wall Ball/);
  for (const file of ['../src/lib/serverRaceSheets.ts', '../src/lib/serverRaceDecisions.ts', '../src/lib/racePenaltiesView.ts', '../src/lib/raceCourseStructure.ts']) {
    assert.doesNotMatch(read(file), /'disqualified'/, `${file} não usa disqualified (D27)`);
  }
  assert.doesNotMatch(read('../src/lib/serverRaceDecisions.ts'), /closeIfWallBallReleased|station_kind === 'wall_ball'/, 'o refechamento segue a estação de fechamento (AC6)');
  assert.doesNotMatch(read('../src/lib/serverRaceSheets.ts'), /attempt\.station_kind !== 'wall_ball'/, 'o fechamento não depende do Wall Ball (AC2)');
});

// ---------------------------------------------------------------------------
// Refechamento pelo painel (AC6)
// ---------------------------------------------------------------------------

test('desfazer DNF refecha pela tentativa liberada da última estação; o Wall Ball do meio liberado não refecha', async () => {
  seed();
  const caio = await startRun('ath-caio');
  const opened = await openWallBall('ath-caio');
  await append(opened.attempt.id, 0, [ev({ t: 'start' }), ...reps(100), ev({ t: 'release' })]);
  assert.equal((await post(MANAGER, { action: 'mark_dnf', eventId: EVENT, runId: caio.id, reason: 'Teste de DNF' })).status, 200);
  assert.equal((await post(MANAGER, { action: 'unmark_dnf', eventId: EVENT, runId: caio.id, reason: 'Desfazendo' })).status, 200);
  assertOpenRun('ath-caio', 'o Wall Ball do meio liberado não refecha');

  // O trenó (última) já está liberado, mas a corrida não fechou (ex.: largada corrigida depois): o desfazer refecha.
  assert.equal((await post(MANAGER, { action: 'mark_dnf', eventId: EVENT, runId: caio.id, reason: 'Outra vez' })).status, 200);
  const endedAt = new Date(Date.now() - 60_000).toISOString();
  const sled = seedAttempt(caio, 'sled-push', 'sled');
  Object.assign(database.rows('race_attempts').find((row) => row.id === sled), { status: 'released', started_at: endedAt, ended_at: endedAt });
  const undone = await post(MANAGER, { action: 'unmark_dnf', eventId: EVENT, runId: caio.id, reason: 'Desfazendo o DNF' });
  assert.equal(undone.status, 200, undone.body.error);
  const closed = runOf('ath-caio');
  assert.equal(closed.status, 'finished');
  assert.equal(closed.time_source, 'sheet');
  assert.equal(Date.parse(closed.finish_at), Date.parse(endedAt));
  assert.equal(Number(closed.gross_seconds), Math.round(Date.parse(endedAt) - Date.parse(closed.started_at)) / 1000);
});

// ---------------------------------------------------------------------------
// closesTime na tentativa, no quadro e na tela (AC8, D39)
// ---------------------------------------------------------------------------

test('closesTime: quadro da onda e tentativa (inclusive de estação que não é Wall Ball, para a tela de 1 atleta da 1.102)', async () => {
  seed();
  const ana = await startRun('ath-ana');
  const caio = await startRun('ath-caio');
  const board = await get(JUDGE, { view: 'wall_ball', eventId: EVENT });
  assert.equal(board.status, 200, board.body.error);
  const athletes = board.body.waves.flatMap((wave) => wave.athletes);
  assert.equal(athletes.find((row) => row.athleteId === 'ath-ana').closesTime, true);
  assert.equal(athletes.find((row) => row.athleteId === 'ath-caio').closesTime, false);

  const lastSled = seedAttempt(caio, 'sled-push', 'sled');
  const middleSled = seedAttempt(ana, 'sled-push', 'sled');
  const lastView = await get(JUDGE, { view: 'attempt', attemptId: lastSled });
  assert.equal(lastView.status, 200, lastView.body.error);
  assert.equal(lastView.body.attempt.closesTime, true);
  assert.equal((await get(JUDGE, { view: 'attempt', attemptId: middleSled })).body.attempt.closesTime, false);
});

const cardProps = (extra = {}) => ({
  athleteName: 'Ana Souza', team: false, load: '6kg', validReps: 100, targetReps: 100, noRepCount: 0, penaltySeconds: 0, lastAction: 'REP',
  elapsed: '1:02:03', abandonedAt: null, released: null,
  noRepReasons: presets.RACE_RULE_PRESET_2026_27.wallBall.noRepReasons, infractions: wb.wallBallInfractionItems(presets.RACE_RULE_PRESET_2026_27), canUndo: true, locked: false, nextHref: '/judge/corrida/ev/wall-ball',
  onRep() {}, onNoRep() {}, onUndo() {}, onInfraction() {}, onAbandon() {}, onRelease() {},
  ...extra
});
const render = (extra) => renderToStaticMarkup(createElement(WallBallCard, cardProps(extra)));

test('tela do Wall Ball: closesTime falso diz que o atleta segue para a próxima estação, sem tempo fechado; verdadeiro, como hoje', () => {
  const middle = render({ closesTime: false });
  assert.match(middle, /Segue para a próxima estação · sem desfazer/);
  assert.doesNotMatch(middle, /Fecha o tempo da corrida/);
  const middleReleased = render({ closesTime: false, released: { elapsed: '0:41:00', official: '0:43:00' } });
  assert.match(middleReleased, /O atleta segue para a próxima estação/);
  assert.match(middleReleased, /Próximo atleta/);
  assert.doesNotMatch(middleReleased, /Tempo na liberação|Tempo oficial|0:43:00/);

  const last = render({ closesTime: true });
  assert.match(last, /Fecha o tempo da corrida · sem desfazer/);
  const lastReleased = render({ released: { elapsed: '1:12:34', official: '1:14:34' } });
  assert.match(lastReleased, /Tempo na liberação/);
  assert.match(lastReleased, /Tempo oficial \(servidor\)/);
  assert.match(lastReleased, /Próximo atleta/);
  assert.doesNotMatch(lastReleased, /próxima estação/);

  const screen = read('../src/components/race/WallBallAttemptScreen.tsx');
  assert.match(screen, /closesTime=\{closesTime\}/);
  assert.match(screen, /attempt\.closesTime !== false/);
});

// ---------------------------------------------------------------------------
// Regressão (AC9)
// ---------------------------------------------------------------------------

test('regressão: a trava do lançamento manual responde 409 sobre o resultado publicado pela estação final; /api/sheets recusa Race', async () => {
  seed();
  const caio = await startRun('ath-caio');
  const sled = seedAttempt(caio, 'sled-push', 'sled');
  assert.equal((await append(sled, 0, [ev({ t: 'start' }), ...sections(4), ev({ t: 'release' })])).status, 200);
  const score = scoreOf('ath-caio');
  assert.ok(score);
  const response = await postPersistence(new Request('http://localhost/api/admin/persistence', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie(MANAGER) },
    body: JSON.stringify({ action: 'upsertScores', payload: { scores: [{ athlete_id: 'ath-caio', workout_id: score.workout_id, result: '58:00', value: 3480, rank: 1, points: 0, splits: {} }] } })
  }));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, publication.RACE_MANUAL_LOCK_MESSAGE);

  const sheets = await postSheets(new Request('http://localhost/api/sheets', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie(JUDGE) },
    body: JSON.stringify({ action: 'open', eventId: EVENT, workoutId: 'wod-x', athleteId: 'ath-caio' })
  }));
  assert.equal(sheets.status, 400);
});
