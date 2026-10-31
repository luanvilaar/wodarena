import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createFakeSupabase } from './support/fakeSupabase.mjs';
import { createRaceClient } from './support/fakeRaceSupabase.mjs';
import { importServerModule, setActiveSupabaseClient } from './support/serverModuleHarness.mjs';

// Story 1.103 (F2 da súmula Fitness Race): tela de dois cartões e limite de 2
// atletas por judge (D31). Pela rota real com o banco em memória: limite no
// open_attempt e no assumir, estados que contam, estação de 1 atleta (reps em
// qualquer posição e a estação final de qualquer tipo, D32, D39, D43), dois
// pedidos ao mesmo tempo (AC4), dispensar e soltar o cartão (AC5), rodízio com
// a autoria preservada (AC6) e `view=my_cards` (AC10); regras puras
// (raceStation.ts), renderização do cartão e estáticos da tela /cartoes.

process.env.SUPABASE_URL = 'http://supabase.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';
process.env.WODA_SESSION_SECRET = 'segredo-de-teste-dois-cartoes';

let database = createFakeSupabase();
const state = { missingRaceTables: false, beforeUpdate: {}, beforeCount: {} };
const client = createRaceClient(() => database, state);
setActiveSupabaseClient(client);

const { GET, POST } = await importServerModule('app/api/race-sheets/route.ts');
const { createSessionToken } = await importServerModule('lib/serverSecurity.ts');
const race = await importServerModule('lib/serverRaceSheets.ts');
const station = await importServerModule('lib/raceStation.ts');
const { StationCard } = await importServerModule('components/race/StationCard.tsx');

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const MANAGER = { id: 'mgr-cartoes', name: 'Gestora Cartões', email: 'cartoes@example.com', role: 'manager', service_valid_until: '2099-12-31' };
const OTHER_MANAGER = { id: 'mgr-outra-cartoes', name: 'Outra Gestora', email: 'outra-cartoes@example.com', role: 'manager', service_valid_until: '2099-12-31' };
const JUDGE = { id: 'judge-paula', name: 'Judge Paula', email: 'paula-c@example.com', role: 'judge', parent_manager_id: MANAGER.id };
const JUDGE_2 = { id: 'judge-caio', name: 'Judge Caio', email: 'caio-c@example.com', role: 'judge', parent_manager_id: MANAGER.id };
const JUDGE_3 = { id: 'judge-rafa', name: 'Judge Rafa', email: 'rafa-c@example.com', role: 'judge', parent_manager_id: MANAGER.id };
const JUDGE_OTHER = { id: 'judge-outro-cartoes', name: 'Judge de Fora', email: 'fora-c@example.com', role: 'judge', parent_manager_id: OTHER_MANAGER.id };

const EVENT = 'ev-cartoes';
const run = (id, orderIndex) => ({ id, name: `Corrida ${orderIndex}`, type: 'run', orderIndex, distance: '1km' });
const SKI = (orderIndex) => ({ id: 'ski-erg', name: 'SkiErg', type: 'station', orderIndex, distance: '1000m' });
const SLED = (orderIndex) => ({ id: 'sled-push', name: 'Sled Push', type: 'station', orderIndex, distance: '50m', maleWeight: '152kg', femaleWeight: '102kg' });
const FARMERS = (orderIndex) => ({ id: 'farmers-carry', name: 'Farmers Carry', type: 'station', orderIndex, distance: '200m', conferenceKind: 'sections', units: 4 });
const WALL = (orderIndex) => ({ id: 'wall-balls', name: 'Wall Balls', type: 'station', orderIndex, reps: 100, maleWeight: '9kg', femaleWeight: '6kg' });
const BOX = (orderIndex) => ({ id: 'box-jump', name: 'Box Jump', type: 'station', orderIndex, conferenceKind: 'generic' });
const COURSES = {
  // Os quatro tipos e o Wall Ball no meio; a genérica fecha o tempo.
  'div-pro': [run('run-1', 0), SKI(1), run('run-2', 2), SLED(3), run('run-3', 4), FARMERS(5), run('run-4', 6), WALL(7), run('run-5', 8), BOX(9), run('run-final', 10)],
  'div-duo': [run('run-1', 0), SLED(1), run('run-2', 2), WALL(3), run('run-3', 4), BOX(5)],
  // Estação final de cada tipo (D39): ergômetro, trenó e seções fechando o tempo.
  'div-erg-last': [run('run-1', 0), SLED(1), run('run-2', 2), SKI(3), run('run-final', 4)],
  'div-sled-last': [run('run-1', 0), SKI(1), run('run-2', 2), SLED(3)],
  'div-sec-last': [run('run-1', 0), SLED(1), run('run-2', 2), FARMERS(3)]
};
const ATHLETES = [
  ['ath-ana', 'Ana Souza', 'div-pro'],
  ['ath-bia', 'Bia Lima', 'div-pro'],
  ['ath-carla', 'Carla Teste', 'div-pro'],
  ['ath-davi', 'Davi Melo', 'div-pro'],
  ['ath-eva', 'Eva Prado', 'div-pro'],
  ['ath-dupla', 'Gabi e Íris', 'div-duo'],
  ['ath-erg', 'Hugo Ergo', 'div-erg-last'],
  ['ath-sled', 'Ivo Trenó', 'div-sled-last'],
  ['ath-sec', 'Júlia Seções', 'div-sec-last']
];

const seed = () => {
  database = createFakeSupabase({
    users: [MANAGER, OTHER_MANAGER, JUDGE, JUDGE_2, JUDGE_3, JUDGE_OTHER],
    events: [
      {
        id: EVENT, name: 'Race Cartões', date: '2026-11-01', location: 'Recife', organizer_id: MANAGER.id, event_type: 'fitness_racing', status: 'upcoming', time_zone: 'America/Fortaleza',
        event_schedule: [{ id: 'heat-1', kind: 'heat', date: '2026-11-01', time: '08:00', title: 'Onda 1', heatNumber: 1, athleteIds: ATHLETES.map(([id]) => id) }]
      },
      { id: 'ev-outra-cartoes', name: 'Race da Outra', date: '2026-11-03', location: 'Natal', organizer_id: OTHER_MANAGER.id, event_type: 'fitness_racing', status: 'upcoming', event_schedule: [] }
    ],
    event_judges: [
      { event_id: EVENT, judge_user_id: JUDGE.id },
      { event_id: EVENT, judge_user_id: JUDGE_2.id },
      { event_id: EVENT, judge_user_id: JUDGE_3.id },
      { event_id: 'ev-outra-cartoes', judge_user_id: JUDGE_OTHER.id }
    ],
    divisions: Object.entries(COURSES).map(([id, course]) => ({
      id, event_id: EVENT, name: id, type: id === 'div-duo' ? 'duo' : 'individual', category: 'female', course_layout: course
    })),
    athletes: ATHLETES.map(([id, name, division]) => ({ id, name, box: 'Box Norte', division_id: division })),
    workouts: [], scores: [], registrations: []
  });
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
const divisionOf = (athleteId) => ATHLETES.find(([id]) => id === athleteId)[2];
const runOf = (athleteId) => database.rows('race_runs').find((row) => row.athlete_id === athleteId);
const attemptRow = (attemptId) => database.rows('race_attempts').find((row) => row.id === attemptId);
const activeOf = (judge) => database.rows('race_attempts').filter((row) => row.judge_user_id === judge.id && station.isRaceAttemptActive(row.status, database.rows('race_runs').find((item) => item.id === row.run_id)?.status));

/** A onda 1 largou uma hora atrás (a largada é gravada direto). */
const startRuns = async () => {
  const ruleset = await race.ensureRaceRuleset(client, EVENT);
  const startedAt = new Date(Date.now() - 3_600_000).toISOString();
  database.rows('race_heat_marks').push({ event_id: EVENT, heat_id: 'heat-1', started_at: startedAt, started_by_user_id: MANAGER.id, started_by_name: MANAGER.name });
  for (const [athleteId] of ATHLETES) {
    database.rows('race_runs').push({
      id: `run-${athleteId}`, event_id: EVENT, division_id: divisionOf(athleteId), athlete_id: athleteId, heat_id: 'heat-1', ruleset_id: ruleset.id,
      status: 'racing', started_at: startedAt, finish_at: null, gross_seconds: null, penalty_seconds: 0, official_seconds: null,
      time_source: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString()
    });
  }
};

const open = (user, athleteId, stationId) => post(user, { action: 'open_attempt', eventId: EVENT, athleteId, stationId });
const openOk = async (user, athleteId, stationId) => {
  const opened = await open(user, athleteId, stationId);
  assert.equal(opened.status, 200, `${athleteId}/${stationId}: ${opened.body.error}`);
  return opened.body.attempt;
};
let seq = 0;
/** Tentativa gravada direto no banco (estado e situação da corrida à escolha). */
const seedAttempt = (athleteId, stationId, stationKind, judge, status = 'running') => {
  const at = new Date(Date.now() - 60_000 + (seq += 1)).toISOString();
  const row = {
    id: `attempt-seed-${(seq += 1)}`, run_id: runOf(athleteId).id, event_id: EVENT, athlete_id: athleteId, station_id: stationId, station_kind: stationKind,
    lane: null, judge_user_id: judge ? judge.id : null, judge_name: judge ? judge.name : '', status, progress: {}, started_at: null, ended_at: null, created_at: at, updated_at: at
  };
  database.rows('race_attempts').push(row);
  return row;
};
let counter = 0;
const ev = (event) => ({ id: `c${(counter += 1)}`, event, deviceAt: Date.now() });
const append = (user, attemptId, fromSeq, events) => post(user, { action: 'append', attemptId, fromSeq, events, clientNow: Date.now() });

// ---------------------------------------------------------------------------
// Regras puras (AC3)
// ---------------------------------------------------------------------------

test('raceJudgeCapacity e isSoloRaceStation: 2 cartões, a estação de 1 atleta sozinha nos dois sentidos, retomar não conta', () => {
  assert.equal(station.RACE_JUDGE_MAX_ACTIVE, 2);
  assert.equal(station.RACE_JUDGE_MAX_ACTIVE_SOLO, 1);
  // Reps em qualquer posição (D32, D43) e a última estação de qualquer tipo (D39).
  assert.equal(station.isSoloRaceStation('wall_ball', false), true, 'reps no meio');
  assert.equal(station.isSoloRaceStation('wall_ball', true), true, 'reps na última');
  for (const kind of ['ergometer', 'sled', 'sections', 'generic']) {
    assert.equal(station.isSoloRaceStation(kind, true), true, `${kind} na última`);
    assert.equal(station.isSoloRaceStation(kind, false), false, `${kind} no meio`);
  }
  const card = (attemptId, stationKind = 'sled', solo = false) => ({ attemptId, stationKind, solo });
  assert.equal(station.raceJudgeCapacity([], card('a')).ok, true);
  assert.equal(station.raceJudgeCapacity([card('a')], card('b')).ok, true);
  const full = station.raceJudgeCapacity([card('a'), card('b')], card('c'));
  assert.equal(full.ok, false);
  assert.equal(full.reason, 'full');
  assert.equal(full.message, 'Você já confere 2 atletas. Libere um antes de abrir outro.');
  assert.equal(station.raceJudgeCapacity([card('a'), card('b')], card('b')).ok, true, 'retomar a própria não conta');
  const wbOpen = station.raceJudgeCapacity([card('w', 'wall_ball', true)], card('x'));
  assert.equal(wbOpen.reason, 'solo');
  assert.equal(wbOpen.message, 'O Wall Ball é conferido sozinho: libere o cartão aberto antes.');
  assert.equal(station.raceJudgeCapacity([card('a')], card('w', 'wall_ball', true)).message, 'O Wall Ball é conferido sozinho: libere o cartão aberto antes.');
  assert.equal(station.raceJudgeCapacity([card('a')], card('f', 'generic', true)).message, 'Esta estação é de 1 atleta por judge. Libere o atleta aberto antes de abrir outro.');
  assert.equal(station.raceJudgeCapacity([card('f', 'sled', true)], card('g', 'sled', true)).message, 'Esta estação é de 1 atleta por judge. Libere o atleta aberto antes de abrir outro.');
  assert.equal(station.raceJudgeCapacity([card('w', 'wall_ball', true)], card('w', 'wall_ball', true)).ok, true, 'retomar a estação de 1 atleta');
  // Estados que contam (AC2).
  for (const status of ['waiting', 'running', 'done_pending_release', 'redo']) {
    assert.equal(station.isRaceAttemptActive(status, 'racing'), true, status);
    assert.equal(station.isRaceAttemptActive(status, 'finished'), true, `${status} com a corrida fechada`);
    assert.equal(station.isRaceAttemptActive(status, 'dnf'), false, `${status} em DNF`);
    assert.equal(station.isRaceAttemptActive(status, 'cancelled'), false, `${status} em corrida cancelada`);
  }
  for (const status of ['released', 'exited_incomplete', 'cancelled']) assert.equal(station.isRaceAttemptActive(status, 'racing'), false, status);
  // Topo e indicador geral da tela (AC7, AC8).
  assert.equal(station.describeJudgeCardsCount(1), '1 de 2 · 1 vaga livre');
  assert.equal(station.describeJudgeCardsCount(0), '0 de 2 · 2 vagas livres');
  assert.equal(station.describeJudgeCardsCount(2), '2 de 2 · Você já confere 2 atletas');
  assert.equal(station.aggregateCardsSync([{ status: 'saved', pendingCount: 0 }, { status: 'saved', pendingCount: 0 }]).text, 'Salvo');
  assert.equal(station.aggregateCardsSync([{ status: 'saving', pendingCount: 2 }, { status: 'saving', pendingCount: 1 }]).text, 'Salvando 3 registros…');
  assert.match(station.aggregateCardsSync([{ status: 'conflict', pendingCount: 1 }, { status: 'saved', pendingCount: 0 }]).text, /1 cartão precisa de atenção · o outro segue salvando/);
  assert.equal(station.raceCardsHref('ev 1', 'attempt_1'), '/judge/corrida/ev%201/cartoes?foco=attempt_1');
});

// ---------------------------------------------------------------------------
// Limite no servidor (AC2)
// ---------------------------------------------------------------------------

test('open_attempt: 1º e 2º passam, o 3º dá 409 com a mensagem; retomar não conta; equipe ocupa 1 vaga', async () => {
  seed();
  await startRuns();
  const ana = await openOk(JUDGE, 'ath-ana', 'sled-push');
  const bia = await openOk(JUDGE, 'ath-bia', 'sled-push');
  assert.equal(ana.solo, false);
  assert.equal(ana.stationKey, 'sled-push');
  const third = await open(JUDGE, 'ath-carla', 'sled-push');
  assert.equal(third.status, 409);
  assert.equal(third.body.error, 'Você já confere 2 atletas. Libere um antes de abrir outro.');
  assert.equal(third.body.capacity, 'full');
  assert.deepEqual(third.body.openAttempts.map((item) => item.athleteName).sort(), ['Ana Souza', 'Bia Lima']);
  assert.equal(database.rows('race_attempts').filter((row) => row.athlete_id === 'ath-carla').length, 0, 'nada gravado');
  // Retomar a própria (mesmo atleta e estação) não conta como nova.
  assert.equal((await openOk(JUDGE, 'ath-ana', 'sled-push')).id, ana.id);
  assert.equal((await openOk(JUDGE, 'ath-bia', 'sled-push')).id, bia.id);
  // Em outra estação também conta: o limite é por judge, não por estação.
  assert.equal((await open(JUDGE, 'ath-carla', 'ski-erg')).status, 409);

  // Dupla é um cartão (D31): a dupla e mais 1 atleta, o 3º recusado.
  await openOk(JUDGE_2, 'ath-dupla', 'sled-push');
  await openOk(JUDGE_2, 'ath-carla', 'ski-erg');
  assert.equal((await open(JUDGE_2, 'ath-davi', 'ski-erg')).status, 409);
  // Vale para qualquer papel que fique como árbitro (AUTO-DECISION): a gestora também.
  await openOk(MANAGER, 'ath-davi', 'ski-erg');
  await openOk(MANAGER, 'ath-eva', 'ski-erg');
  assert.equal((await open(MANAGER, 'ath-davi', 'farmers-carry')).status, 409);
});

test('claim_attempt (assumir) respeita o limite; com vaga, assume', async () => {
  seed();
  await startRuns();
  await openOk(JUDGE, 'ath-ana', 'sled-push');
  await openOk(JUDGE, 'ath-bia', 'sled-push');
  const free = seedAttempt('ath-carla', 'sled-push', 'sled', null, 'running');
  const refused = await post(JUDGE, { action: 'claim_attempt', attemptId: free.id });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, 'Você já confere 2 atletas. Libere um antes de abrir outro.');
  assert.equal(attemptRow(free.id).judge_user_id, null, 'continua sem árbitro');
  // Assumir pela lista (open_attempt sobre a tentativa sem árbitro) também.
  assert.equal((await open(JUDGE, 'ath-carla', 'sled-push')).status, 409);
  const claimed = await post(JUDGE_2, { action: 'claim_attempt', attemptId: free.id });
  assert.equal(claimed.status, 200, claimed.body.error);
  assert.equal(claimed.body.attempt.judgeUserId, JUDGE_2.id);
});

test('estados que contam: waiting, running, done_pending_release e redo; released, exited_incomplete, cancelled e corrida dnf/cancelled não', async () => {
  for (const [status, runStatus, counts] of [
    ['waiting', 'racing', true], ['running', 'racing', true], ['done_pending_release', 'racing', true], ['redo', 'racing', true],
    ['running', 'finished', true],
    ['released', 'racing', false], ['exited_incomplete', 'racing', false], ['cancelled', 'racing', false],
    ['running', 'dnf', false], ['waiting', 'cancelled', false]
  ]) {
    seed();
    await startRuns();
    seedAttempt('ath-ana', 'sled-push', 'sled', JUDGE, status);
    seedAttempt('ath-bia', 'sled-push', 'sled', JUDGE, status);
    runOf('ath-ana').status = runStatus;
    runOf('ath-bia').status = runStatus;
    const out = await open(JUDGE, 'ath-carla', 'sled-push');
    assert.equal(out.status, counts ? 409 : 200, `${status} com a corrida ${runStatus}: ${out.body.error ?? ''}`);
  }
});

// ---------------------------------------------------------------------------
// Estação de 1 atleta (AC3; D32, D39, D43)
// ---------------------------------------------------------------------------

test('Wall Ball (reps no meio): com ele aberto nada abre; com cartão aberto ele não abre; dois judges, um Wall Ball cada', async () => {
  seed();
  await startRuns();
  const wb = await openOk(JUDGE, 'ath-ana', 'wall-balls');
  assert.equal(wb.solo, true, 'reps no meio do percurso é de 1 atleta (D43)');
  assert.equal(wb.closesTime, false);
  for (const [athleteId, stationId] of [['ath-bia', 'sled-push'], ['ath-bia', 'wall-balls'], ['ath-bia', 'box-jump']]) {
    const out = await open(JUDGE, athleteId, stationId);
    assert.equal(out.status, 409, stationId);
    assert.equal(out.body.error, 'O Wall Ball é conferido sozinho: libere o cartão aberto antes.');
    assert.equal(out.body.capacity, 'solo');
  }
  // Dois judges podem ter um Wall Ball cada.
  await openOk(JUDGE_2, 'ath-bia', 'wall-balls');

  // Com um trenó aberto, o Wall Ball é recusado.
  await openOk(JUDGE_3, 'ath-carla', 'sled-push');
  const refused = await open(JUDGE_3, 'ath-davi', 'wall-balls');
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, 'O Wall Ball é conferido sozinho: libere o cartão aberto antes.');
  assert.equal(refused.body.openAttempts[0].athleteName, 'Carla Teste');
});

test('estação final de cada tipo (D39): com cartão aberto não abre; aberta, nada mais abre; 2º atleta 409; dois judges, um atleta cada', async () => {
  seed();
  await startRuns();
  const FINAL = 'Esta estação é de 1 atleta por judge. Libere o atleta aberto antes de abrir outro.';
  // Judge com um cartão de trenó no meio não abre a estação final de nenhum tipo.
  await openOk(JUDGE, 'ath-ana', 'sled-push');
  for (const [athleteId, stationId] of [['ath-erg', 'ski-erg'], ['ath-sled', 'sled-push'], ['ath-sec', 'farmers-carry'], ['ath-bia', 'box-jump']]) {
    const out = await open(JUDGE, athleteId, stationId);
    assert.equal(out.status, 409, `${athleteId}/${stationId}`);
    assert.equal(out.body.error, FINAL);
  }
  // Com a estação final aberta, nenhuma outra abre, nem um 2º atleta na mesma.
  const final = await openOk(JUDGE_2, 'ath-erg', 'ski-erg');
  assert.equal(final.solo, true);
  assert.equal(final.closesTime, true);
  for (const [athleteId, stationId] of [['ath-bia', 'ski-erg'], ['ath-bia', 'sled-push'], ['ath-sled', 'sled-push'], ['ath-carla', 'box-jump']]) {
    const out = await open(JUDGE_2, athleteId, stationId);
    assert.equal(out.status, 409, `${athleteId}/${stationId}`);
    assert.equal(out.body.error, FINAL);
    assert.equal(out.body.openAttempts[0].athleteName, 'Hugo Ergo');
  }
  // Dois judges, um atleta cada na estação final.
  await openOk(JUDGE_3, 'ath-carla', 'box-jump');
  assert.equal(activeOf(JUDGE_2).length, 1);
  assert.equal(activeOf(JUDGE_3).length, 1);
});

// ---------------------------------------------------------------------------
// Dois pedidos ao mesmo tempo (AC4)
// ---------------------------------------------------------------------------

test('dois open_attempt ao mesmo tempo nunca deixam 3 ativas: a mais nova é cancelada e responde 409', async () => {
  seed();
  await startRuns();
  await openOk(JUDGE, 'ath-ana', 'sled-push');
  // O outro pedido grava no meio deste (entre a conferência e a gravação).
  database.onceBeforeInsert('race_attempts', () => { seedAttempt('ath-bia', 'sled-push', 'sled', JUDGE, 'waiting'); });
  const raced = await open(JUDGE, 'ath-carla', 'sled-push');
  assert.equal(raced.status, 409);
  assert.equal(raced.body.error, 'Você já confere 2 atletas. Libere um antes de abrir outro.');
  assert.equal(database.rows('race_attempts').find((row) => row.athlete_id === 'ath-carla').status, 'cancelled', 'a nova foi cancelada');
  assert.equal(activeOf(JUDGE).length, 2);

  // Os dois pedidos de verdade, juntos: um passa e o outro é recusado.
  seed();
  await startRuns();
  await openOk(JUDGE, 'ath-ana', 'sled-push');
  const both = await Promise.all([open(JUDGE, 'ath-bia', 'sled-push'), open(JUDGE, 'ath-carla', 'sled-push')]);
  assert.deepEqual(both.map((item) => item.status).sort(), [200, 409]);
  assert.equal(activeOf(JUDGE).length, 2, 'nunca uma terceira ativa');

  // Nem uma segunda ao lado da estação de 1 atleta.
  seed();
  await startRuns();
  database.onceBeforeInsert('race_attempts', () => { seedAttempt('ath-bia', 'wall-balls', 'wall_ball', JUDGE, 'running'); });
  const solo = await open(JUDGE, 'ath-carla', 'sled-push');
  assert.equal(solo.status, 409);
  assert.equal(solo.body.error, 'O Wall Ball é conferido sozinho: libere o cartão aberto antes.');
  assert.equal(activeOf(JUDGE).length, 1);
});

// ---------------------------------------------------------------------------
// Dispensar e soltar (AC5) e rodízio (AC6)
// ---------------------------------------------------------------------------

test('dismiss_attempt: sem registros cancela e libera a vaga; com registros 409; de outro judge 403; liberada 409; estação de 1 atleta 409', async () => {
  seed();
  await startRuns();
  const ana = await openOk(JUDGE, 'ath-ana', 'sled-push');
  const bia = await openOk(JUDGE, 'ath-bia', 'sled-push');
  assert.equal((await post(JUDGE_2, { action: 'dismiss_attempt', attemptId: bia.id })).status, 403);
  const dismissed = await post(JUDGE, { action: 'dismiss_attempt', attemptId: bia.id });
  assert.equal(dismissed.status, 200, dismissed.body.error);
  assert.equal(dismissed.body.attempt.status, 'cancelled');
  assert.equal(attemptRow(bia.id).status, 'cancelled');
  await openOk(JUDGE, 'ath-carla', 'sled-push');
  assert.equal((await post(JUDGE, { action: 'dismiss_attempt', attemptId: bia.id })).status, 409, 'já cancelada');

  assert.equal((await append(JUDGE, ana.id, 0, [ev({ t: 'start' }), ev({ t: 'section' })])).status, 200);
  const withRecords = await post(JUDGE, { action: 'dismiss_attempt', attemptId: ana.id });
  assert.equal(withRecords.status, 409);
  assert.match(withRecords.body.error, /já tem registros: solte o cartão/);
  assert.equal(attemptRow(ana.id).status, 'running');

  const done = seedAttempt('ath-davi', 'ski-erg', 'ergometer', JUDGE_2, 'released');
  assert.equal((await post(JUDGE_2, { action: 'dismiss_attempt', attemptId: done.id })).status, 409, 'liberada');

  // Estação de 1 atleta (Wall Ball no meio e estação final): 409 mesmo sem registros (D39).
  const wb = await openOk(JUDGE_3, 'ath-eva', 'wall-balls');
  const wbOut = await post(JUDGE_3, { action: 'dismiss_attempt', attemptId: wb.id });
  assert.equal(wbOut.status, 409);
  assert.equal(wbOut.body.error, 'Esta estação é de 1 atleta por judge: só o organizador libera a tentativa.');
  const final = await openOk(JUDGE_2, 'ath-sled', 'sled-push');
  assert.equal((await post(JUDGE_2, { action: 'dismiss_attempt', attemptId: final.id })).status, 409);
  assert.equal(attemptRow(final.id).status, 'waiting');
});

test('soltar e assumir: log intacto, autoria e horário preservados, judge_name atualiza, contador continua; judge sem vaga não assume', async () => {
  seed();
  await startRuns();
  const ana = await openOk(JUDGE, 'ath-ana', 'sled-push');
  const sent = await append(JUDGE, ana.id, 0, [ev({ t: 'start' }), ev({ t: 'section' }), ev({ t: 'section' }), ev({ t: 'infraction', code: 'lane_invaded' })]);
  assert.equal(sent.status, 200, sent.body.error);
  const before = structuredClone(database.rows('race_attempt_events').filter((row) => row.attempt_id === ana.id));
  const statusBefore = attemptRow(ana.id).status;

  // Só o dono solta (o outro judge recebe 403); o dono solta sem apagar nada.
  assert.equal((await post(JUDGE_2, { action: 'release_attempt', attemptId: ana.id })).status, 403);
  const released = await post(JUDGE, { action: 'release_attempt', attemptId: ana.id });
  assert.equal(released.status, 200, released.body.error);
  assert.equal(released.body.attempt.judgeUserId, null);
  assert.equal(attemptRow(ana.id).status, statusBefore, 'o estado fica como está');
  assert.deepEqual(database.rows('race_attempt_events').filter((row) => row.attempt_id === ana.id), before, 'o log fica como está');
  assert.equal((await append(JUDGE, ana.id, 4, [ev({ t: 'section' })])).status, 403, 'quem soltou não grava mais');
  // O pedido antigo (claim_attempt com release) também solta, e conta no mesmo limite.
  const bia = await openOk(JUDGE, 'ath-bia', 'sled-push');
  assert.equal((await post(JUDGE, { action: 'claim_attempt', attemptId: bia.id, release: true })).status, 200);

  // Judge sem vaga não assume.
  await openOk(JUDGE_3, 'ath-carla', 'ski-erg');
  await openOk(JUDGE_3, 'ath-davi', 'ski-erg');
  assert.equal((await post(JUDGE_3, { action: 'claim_attempt', attemptId: ana.id })).status, 409);

  // Outro judge assume e continua do ponto em que estava (D35).
  const claimed = await post(JUDGE_2, { action: 'claim_attempt', attemptId: ana.id });
  assert.equal(claimed.status, 200, claimed.body.error);
  assert.equal(claimed.body.attempt.judgeName, 'Judge Caio');
  assert.equal(claimed.body.events.length, 4);
  const more = await append(JUDGE_2, ana.id, 4, [ev({ t: 'section' })]);
  assert.equal(more.status, 200, more.body.error);
  assert.equal(more.body.attempt.progress.units, 3, 'o contador segue de 2 para 3');
  const after = database.rows('race_attempt_events').filter((row) => row.attempt_id === ana.id).sort((a, b) => a.seq - b.seq);
  for (const [index, row] of before.entries()) {
    assert.equal(after[index].author_user_id, JUDGE.id, `registro ${index} segue com a autora`);
    assert.equal(after[index].recorded_at, row.recorded_at, `registro ${index} segue com o horário`);
  }
  assert.equal(after[4].author_user_id, JUDGE_2.id);

  // Soltar não desfaz liberação nem reabre tentativa encerrada.
  const done = seedAttempt('ath-eva', 'farmers-carry', 'sections', JUDGE_2, 'released');
  assert.equal((await post(JUDGE_2, { action: 'release_attempt', attemptId: done.id })).status, 409);
});

test('estação de 1 atleta: o dono não solta (409); só a gestora libera, e só quem não tem cartão aberto assume (rodízio na estação final)', async () => {
  seed();
  await startRuns();
  const final = await openOk(JUDGE, 'ath-bia', 'box-jump');
  assert.equal((await append(JUDGE, final.id, 0, [ev({ t: 'start' }), ev({ t: 'infraction', code: 'external_help' })])).status, 200);
  const self = await post(JUDGE, { action: 'release_attempt', attemptId: final.id });
  assert.equal(self.status, 409);
  assert.equal(self.body.error, 'Esta estação é de 1 atleta por judge: só o organizador libera a tentativa.');
  const wb = await openOk(JUDGE_2, 'ath-ana', 'wall-balls');
  assert.equal((await post(JUDGE_2, { action: 'claim_attempt', attemptId: wb.id, release: true })).status, 409);
  assert.equal(attemptRow(wb.id).judge_user_id, JUDGE_2.id);

  const byManager = await post(MANAGER, { action: 'claim_attempt', attemptId: final.id, release: true });
  assert.equal(byManager.status, 200, byManager.body.error);
  assert.equal(byManager.body.attempt.judgeUserId, null);
  // Judge com cartão aberto não assume a estação final.
  await openOk(JUDGE_3, 'ath-carla', 'sled-push');
  const busy = await post(JUDGE_3, { action: 'claim_attempt', attemptId: final.id });
  assert.equal(busy.status, 409);
  assert.equal(busy.body.error, 'Esta estação é de 1 atleta por judge. Libere o atleta aberto antes de abrir outro.');
  // A Judge Paula ficou sem cartão e assume de novo; os registros mantêm a autoria.
  assert.equal((await post(JUDGE, { action: 'claim_attempt', attemptId: final.id })).status, 200);
  assert.ok(database.rows('race_attempt_events').filter((row) => row.attempt_id === final.id).every((row) => row.author_user_id === JUDGE.id));
});

// ---------------------------------------------------------------------------
// view=my_cards (AC7, AC10)
// ---------------------------------------------------------------------------

test('view=my_cards: só as tentativas ativas de quem pede, na ordem de abertura, com estação, atleta e log; acesso por evento', async () => {
  seed();
  await startRuns();
  const ana = await openOk(JUDGE, 'ath-ana', 'sled-push');
  await append(JUDGE, ana.id, 0, [ev({ t: 'start' }), ev({ t: 'section' })]);
  const bia = await openOk(JUDGE, 'ath-bia', 'ski-erg');
  await openOk(JUDGE_2, 'ath-carla', 'sled-push');
  seedAttempt('ath-davi', 'farmers-carry', 'sections', JUDGE, 'released');

  const mine = await get(JUDGE, { view: 'my_cards', eventId: EVENT });
  assert.equal(mine.status, 200, mine.body.error);
  assert.deepEqual(mine.body.cards.map((card) => card.attempt.id), [ana.id, bia.id]);
  assert.deepEqual(mine.body.capacity, { max: 2, active: 2, solo: false });
  const [first] = mine.body.cards;
  assert.equal(first.context.athleteName, 'Ana Souza');
  assert.equal(first.stage.name, 'Sled Push');
  assert.equal(first.attempt.stationKey, 'sled-push');
  assert.equal(first.attempt.solo, false);
  assert.equal(first.events.length, 2);
  // Cada cartão traz quem pede, como a leitura `attempt`: o cartão lê viewer.id (sem ele a tela caía).
  for (const card of mine.body.cards) assert.equal(card.viewer?.id, JUDGE.id);
  assert.doesNotMatch(JSON.stringify(mine.body), /@example\.com/);
  assert.equal((await get(JUDGE_2, { view: 'my_cards', eventId: EVENT })).body.cards.length, 1);
  assert.equal((await get(JUDGE_OTHER, { view: 'my_cards', eventId: EVENT })).status, 403);
  assert.equal((await get(MANAGER, { view: 'my_cards', eventId: EVENT })).body.cards.length, 0);

  await post(JUDGE, { action: 'release_attempt', attemptId: ana.id });
  assert.deepEqual((await get(JUDGE, { view: 'my_cards', eventId: EVENT })).body.cards.map((card) => card.attempt.id), [bia.id]);
  const solo = await openOk(JUDGE_3, 'ath-eva', 'wall-balls');
  const soloCards = (await get(JUDGE_3, { view: 'my_cards', eventId: EVENT })).body;
  assert.equal(soloCards.cards[0].attempt.id, solo.id);
  assert.deepEqual(soloCards.capacity, { max: 1, active: 1, solo: true });
});

test('LIMITS: dismiss_attempt e o soltar pelo dono com limite próprio por pessoa e ação; /api/sheets (Functional Fitness) sem mudança', () => {
  const route = read('../src/app/api/race-sheets/route.ts');
  assert.match(route, /dismiss_attempt: 30,/);
  assert.match(route, /release_attempt: 30,/);
  assert.match(route, /const limitAction = release \? 'release_attempt' : action;/);
  assert.match(route, /key: `race-sheets:\$\{actor\.id\}:\$\{limitAction\}`/);
  assert.match(route, /view === 'my_cards'/);
  const ff = read('../src/app/api/sheets/route.ts');
  for (const word of [/my_cards/, /dismiss_attempt/, /release_attempt/]) assert.doesNotMatch(ff, word);
  assert.doesNotMatch(read('../src/lib/raceStation.ts'), /\bDQ\b|desclassific/i, 'nenhuma regra de DQ (D27)');
});

// ---------------------------------------------------------------------------
// Cartão e tela /cartoes (AC7, AC8, AC9)
// ---------------------------------------------------------------------------

const baseCard = (overrides = {}) => ({
  athleteName: 'Ana Souza', team: false, kind: 'sled', target: '4 trechos', load: '102kg', closesTime: false, oneAthlete: false,
  controls: station.describeStationControls({ stage: { kind: 'sled' }, closesTime: false, result: { state: 'in_progress', started: true, units: 2, expectedUnits: 4, roxzoneLeft: false, infractions: [] } }),
  units: 2, expectedUnits: 4, stationReasons: [], generalItems: [], warningText: '', warningUsed: false, penaltySeconds: 0, returnWrongSeconds: 30, redoDeclinedSeconds: 180,
  lastAction: '+1 trecho', refusal: '', stationElapsed: '2:14', raceElapsed: '38:20', exitInfo: null, released: null, exited: null, canUndo: true, locked: false,
  nextHref: '/judge/corrida/ev/estacao/sled-push?de=cartoes',
  onStart() {}, onUnit() {}, onStationInfraction() {}, onGeneralInfraction() {}, onReturnWrong() {}, onReturnCorrected() {}, onLeaveRoxzone() {},
  onWrongLoad() {}, onRedoDone() {}, onRedoDeclined() {}, onExit() {}, onRelease() {}, onUndo() {},
  ...overrides
});
const render = (overrides) => renderToStaticMarkup(createElement(StationCard, baseCard(overrides)));

test('StationCard nos dois cartões: Soltar com registros, Dispensar sem; folhas dentro do cartão; dupla = 1 cartão; tela de 1 atleta sem os dois', () => {
  const withRecords = render({ contained: true, hasRecords: true, onRelinquish() {}, onDismiss() {} });
  assert.match(withRecords, />Soltar</);
  assert.doesNotMatch(withRecords, /Dispensar/);
  const empty = render({ contained: true, hasRecords: false, isNew: true, onRelinquish() {}, onDismiss() {} });
  assert.match(empty, />Dispensar</);
  assert.match(empty, />Novo</);
  assert.doesNotMatch(empty, />Soltar</);
  const relinquishSheet = render({ contained: true, hasRecords: true, onRelinquish() {}, initialSheet: 'relinquish' });
  assert.match(relinquishSheet, /Soltar o cartão de Ana\?/);
  assert.match(relinquishSheet, /Nada é apagado/);
  assert.match(relinquishSheet, /Sua vaga fica livre\./);
  assert.match(relinquishSheet, /absolute inset-0/, 'a folha cobre só o cartão (AC8)');
  assert.doesNotMatch(relinquishSheet, /fixed inset-0/);
  const dismissSheet = render({ contained: true, hasRecords: false, onDismiss() {}, initialSheet: 'dismiss' });
  assert.match(dismissSheet, /Dispensar o cartão de Ana\?/);
  assert.match(dismissSheet, /abriu o atleta errado/);
  assert.match(render({ contained: true, team: true }), /Dupla · 1 cartão/);
  // Estação de 1 atleta (D39): nunca "Soltar" nem "Dispensar", mesmo com os handlers.
  for (const hasRecords of [true, false]) {
    const solo = render({ oneAthlete: true, closesTime: true, hasRecords, onRelinquish() {}, onDismiss() {} });
    assert.doesNotMatch(solo, /Soltar|Dispensar/);
  }
  // Resumo do cartão liberado na tela de dois cartões: "Fechar" e "Próximo atleta"; a vaga está livre.
  const done = render({ contained: true, released: { at: '09:16:40', stationElapsed: '3:42', athleteElapsed: '—', official: null }, onClose() {} });
  assert.match(done, />Fechar</);
  assert.match(done, /Próximo atleta/);
  assert.match(done, /Sua vaga está livre/);
  for (const html of [withRecords, empty, relinquishSheet, dismissSheet]) assert.match(html, /min-h-14/);
});

test('estático: /cartoes com CourtShell "Fitness Race · Estações", cada cartão com a sua fila, sem estação de 1 atleta; rotas de cartão único; maquete citada', () => {
  const page = '../src/app/judge/corrida/[eventId]/cartoes/page.tsx';
  assert.ok(existsSync(new URL(page, import.meta.url)));
  assert.match(read(page), /<TwoCardsScreen eventId=\{decodeURIComponent\(eventId\)\} focusId=/);
  const screen = read('../src/components/race/TwoCardsScreen.tsx');
  assert.equal(station.RACE_STATIONS_EYEBROW, 'Fitness Race · Estações');
  assert.match(screen, /eyebrow=\{RACE_STATIONS_EYEBROW\}/);
  assert.match(screen, /title="Meus cartões"/);
  assert.match(screen, /docs\/design\/fitness-race-sumula\/telas\/dois-cartoes\.html/);
  assert.ok(existsSync(new URL('../docs/design/fitness-race-sumula/telas/dois-cartoes.html', import.meta.url)), 'maquete aprovada (D42)');
  // Cada cartão é um componente que chama o gancho uma vez: a fila (useRaceSync) é do cartão.
  assert.match(screen, /function TwoCardsCard\([\s\S]*?useStationCardModel\(payload\)/);
  assert.equal((screen.match(/useStationCardModel\(/g) || []).length, 1, 'uma chamada, dentro do componente do cartão (sem laço de hooks)');
  const attemptScreen = read('../src/components/race/StationAttemptScreen.tsx');
  assert.match(attemptScreen, /export function useStationCardModel\(payload: AttemptPayload\) \{[\s\S]*?useRaceSync\(\{ attemptId: attempt\.id, serverEvents, writable, onSaved \}\)/);
  // A estação de 1 atleta não vira cartão aqui (D39), e a vaga some com 2 cartões.
  assert.match(screen, /cards\.filter\(\(card\) => !isSoloCard\(card\) && card\.stage\)\.slice\(0, RACE_JUDGE_MAX_ACTIVE\)/);
  assert.match(screen, /const showSlot = shown\.length < RACE_JUDGE_MAX_ACTIVE && soloCards\.length === 0;/);
  assert.match(screen, /Adicionar atleta/);
  assert.match(screen, /contained/);
  // Layout (AC8): lado a lado no celular deitado e no tablet; abas no celular em pé; alvos de 56 px ou mais.
  assert.match(screen, /md:grid-cols-2 landscape:grid-cols-2/);
  assert.match(screen, /max-md:portrait:hidden/);
  assert.match(screen, /min-h-16/);
  assert.match(screen, /min-h-14/);
  // A rota de cartão único da 1.102 leva aos dois cartões, menos na estação de 1 atleta (AC7, AC9).
  assert.match(attemptScreen, /payload\.attempt\.solo === false/);
  assert.match(attemptScreen, /router\.replace\(raceCardsHref\(eventId, attemptId\)\)/);
  assert.match(attemptScreen, /<StationCard \{\.\.\.cardProps\} oneAthlete=\{closesTime\} nextHref=\{listHref\} \/>/, 'tela de 1 atleta sem Soltar nem Dispensar');
  assert.doesNotMatch(attemptScreen, /onRelinquish|onDismiss/);
  const list = read('../src/components/race/StationListScreen.tsx');
  assert.match(list, /if \(data\.attempt\.solo === false\) router\.push\(raceCardsHref\(eventId, data\.attempt\.id\)\);/);
  assert.match(list, /\.filter\(\(athlete\) => !fromCards \|\| !athlete\.closesTime\)/, '"Adicionar atleta" não lista a estação final');
  assert.match(list, /Você já confere 2 atletas/);
  assert.match(list, /Ver meus cartões/);
});
