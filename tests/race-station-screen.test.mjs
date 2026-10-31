import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createFakeSupabase } from './support/fakeSupabase.mjs';
import { createRaceClient } from './support/fakeRaceSupabase.mjs';
import { importServerModule, setActiveSupabaseClient } from './support/serverModuleHarness.mjs';

// Story 1.102 (F2 da súmula Fitness Race): tela do judge de uma estação que
// não é a contagem de reps (D33). Abertura da tentativa nos cinco tipos,
// chave da estação entre categorias, leituras `stations` e `station_board`,
// regras puras da tela (raceStation.ts), registros pela rota real com o banco
// em memória (trenó, seções, carga errada, Roxzone), a estação final de 1
// atleta (AC12, D39; saída incompleta não fecha o tempo, D44) e a
// renderização do cartão.

process.env.SUPABASE_URL = 'http://supabase.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';
process.env.WODA_SESSION_SECRET = 'segredo-de-teste-estacao';

let database = createFakeSupabase();
const state = { missingRaceTables: false, beforeUpdate: {}, beforeCount: {} };
const client = createRaceClient(() => database, state);
setActiveSupabaseClient(client);

const { GET, POST } = await importServerModule('app/api/race-sheets/route.ts');
const { createSessionToken } = await importServerModule('lib/serverSecurity.ts');
const race = await importServerModule('lib/serverRaceSheets.ts');
const structure = await importServerModule('lib/raceCourseStructure.ts');
const engine = await importServerModule('lib/raceRules.ts');
const presets = await importServerModule('lib/raceRulePresets.ts');
const station = await importServerModule('lib/raceStation.ts');
const wb = await importServerModule('lib/raceWallBall.ts');
const { StationCard } = await importServerModule('components/race/StationCard.tsx');

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const P26 = presets.RACE_RULE_PRESET_2026_27;

const MANAGER = { id: 'mgr-est', name: 'Gestora Estação', email: 'est@example.com', role: 'manager', service_valid_until: '2099-12-31' };
const OTHER_MANAGER = { id: 'mgr-outra-est', name: 'Outra Gestora', email: 'outra-est@example.com', role: 'manager', service_valid_until: '2099-12-31' };
const JUDGE = { id: 'judge-lia', name: 'Judge Lia', email: 'lia@example.com', role: 'judge', parent_manager_id: MANAGER.id };
const JUDGE_2 = { id: 'judge-rui', name: 'Judge Rui', email: 'rui@example.com', role: 'judge', parent_manager_id: MANAGER.id };
const JUDGE_OTHER = { id: 'judge-outro-est', name: 'Judge de Outro Evento', email: 'outro-est@example.com', role: 'judge', parent_manager_id: OTHER_MANAGER.id };

const EVENT = 'ev-estacoes';
const run = (id, orderIndex) => ({ id, name: `Corrida ${orderIndex}`, type: 'run', orderIndex, distance: '1km' });
const COURSES = {
  // Percurso com os quatro tipos no meio e a genérica fechando o tempo.
  'div-pro': [
    run('run-1', 0),
    { id: 'ski-erg', name: 'SkiErg', type: 'station', orderIndex: 1, distance: '1000m' },
    run('run-2', 2),
    { id: 'sled-push', name: 'Sled Push', type: 'station', orderIndex: 3, distance: '50m', maleWeight: '152kg', femaleWeight: '102kg' },
    run('run-3', 4),
    { id: 'farmers-carry', name: 'Farmers Carry', type: 'station', orderIndex: 5, distance: '200m', conferenceKind: 'sections', units: 4, maleWeight: '2 × 24kg', femaleWeight: '2 × 16kg' },
    run('run-4', 6),
    { id: 'burpee-broad-jump', name: 'Burpee Broad Jump', type: 'station', orderIndex: 7, distance: '80m', conferenceKind: 'sections', units: 4 },
    run('run-5', 8),
    { id: 'wall-balls', name: 'Wall Balls', type: 'station', orderIndex: 9, reps: 100, maleWeight: '9kg', femaleWeight: '6kg' },
    run('run-6', 10),
    { id: 'box-jump', name: 'Box Jump', type: 'station', orderIndex: 11, conferenceKind: 'generic' },
    run('run-final', 12)
  ],
  // Dupla: ids personalizados (mudam por categoria) e o mesmo nome duas vezes; o Wall Ball fecha.
  'div-duo': [
    run('run-1', 0),
    { id: 'stage-course-sled-push-111', name: 'Sled Push', type: 'station', orderIndex: 1, distance: '25m' },
    run('run-2', 2),
    { id: 'stage-course-sled-push-222', name: 'Sled Push', type: 'station', orderIndex: 3, distance: '25m' },
    run('run-3', 4),
    { id: 'wall-balls', name: 'Wall Balls', type: 'station', orderIndex: 5, reps: 100 }
  ],
  // Seções com carga fecham o tempo.
  'div-final': [
    run('run-1', 0),
    { id: 'wall-balls', name: 'Wall Balls', type: 'station', orderIndex: 1, reps: 100 },
    run('run-2', 2),
    { id: 'sandbag', name: 'Sandbag Lunges', type: 'station', orderIndex: 3, distance: '100m', conferenceKind: 'sections', units: 2, maleWeight: '20kg', femaleWeight: '10kg' }
  ]
};
const ATHLETES = [
  ['ath-ana', 'Ana Souza', 'div-pro'],
  ['ath-bia', 'Bia Lima', 'div-pro'],
  ['ath-dupla', 'Gabi e Íris', 'div-duo'],
  ['ath-caio', 'Caio Reis', 'div-final'],
  ['ath-davi', 'Davi Melo', 'div-final']
];

const seed = () => {
  database = createFakeSupabase({
    users: [MANAGER, OTHER_MANAGER, JUDGE, JUDGE_2, JUDGE_OTHER],
    events: [
      {
        id: EVENT, name: 'Race Estações', date: '2026-11-01', location: 'Recife', organizer_id: MANAGER.id, event_type: 'fitness_racing', status: 'upcoming', time_zone: 'America/Fortaleza',
        event_schedule: [
          { id: 'heat-1', kind: 'heat', date: '2026-11-01', time: '08:00', title: 'Onda 1', heatNumber: 1, athleteIds: ATHLETES.map(([id]) => id) },
          { id: 'heat-2', kind: 'heat', date: '2026-11-01', time: '08:30', title: 'Onda 2', heatNumber: 2, athleteIds: [] }
        ]
      },
      { id: 'ev-outra-est', name: 'Race da Outra', date: '2026-11-03', location: 'Natal', organizer_id: OTHER_MANAGER.id, event_type: 'fitness_racing', status: 'upcoming', event_schedule: [] }
    ],
    event_judges: [
      { event_id: EVENT, judge_user_id: JUDGE.id },
      { event_id: EVENT, judge_user_id: JUDGE_2.id },
      { event_id: 'ev-outra-est', judge_user_id: JUDGE_OTHER.id }
    ],
    divisions: [
      { id: 'div-pro', event_id: EVENT, name: 'Women Pro', type: 'individual', category: 'female', course_layout: COURSES['div-pro'] },
      { id: 'div-duo', event_id: EVENT, name: 'Doubles Women', type: 'duo', category: 'female', course_layout: COURSES['div-duo'] },
      { id: 'div-final', event_id: EVENT, name: 'Men Open', type: 'individual', category: 'male', course_layout: COURSES['div-final'] },
      { id: 'div-outra', event_id: 'ev-outra-est', name: 'Open', type: 'individual', course_layout: COURSES['div-pro'] }
    ],
    athletes: [
      ...ATHLETES.map(([id, name, division]) => ({ id, name, box: 'Box Norte', division_id: division })),
      { id: 'ath-fora', name: 'De Outro Evento', box: 'X', division_id: 'div-outra' }
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
const quiet = (t) => {
  const original = console.error;
  console.error = () => {};
  t.after(() => { console.error = original; });
};
const rows = (table) => structuredClone(database.rows(table));
const runOf = (athleteId) => database.rows('race_runs').find((row) => row.athlete_id === athleteId);
const divisionOf = (athleteId) => ATHLETES.find(([id]) => id === athleteId)[2];
const infractionsOf = (attemptId) => rows('race_infractions').filter((row) => row.attempt_id === attemptId).sort((a, b) => a.source_seq - b.source_seq);

/** A onda 1 largou uma hora atrás (a fixture do evento é no futuro: a largada é gravada direto). */
const startRuns = async (athleteIds = ATHLETES.map(([id]) => id)) => {
  const ruleset = await race.ensureRaceRuleset(client, EVENT);
  const startedAt = new Date(Date.now() - 3_600_000).toISOString();
  database.rows('race_heat_marks').push({ event_id: EVENT, heat_id: 'heat-1', started_at: startedAt, started_by_user_id: MANAGER.id, started_by_name: MANAGER.name });
  for (const athleteId of athleteIds) {
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
  assert.equal(opened.status, 200, opened.body.error);
  return opened.body;
};

let counter = 0;
const ev = (event) => ({ id: `s${(counter += 1)}`, event, deviceAt: Date.now() });
const sections = (count) => Array.from({ length: count }, () => ev({ t: 'section' }));
const append = (user, attemptId, fromSeq, events) => post(user, { action: 'append', attemptId, fromSeq, events, clientNow: Date.now() });

// ---------------------------------------------------------------------------
// Abertura nos cinco tipos (AC1)
// ---------------------------------------------------------------------------

test('open_attempt: abre ergômetro, trenó, seções, genérica e Wall Ball; corrida 400 sem "só o Wall Ball"; onda sem largar 409; atleta de outro evento 400', async (t) => {
  quiet(t);
  seed();
  const early = await open(JUDGE, 'ath-ana', 'sled-push');
  assert.equal(early.status, 409);
  assert.equal(early.body.error, 'A onda ainda não largou.');
  assert.deepEqual(race.RACE_OPENABLE_STATION_KINDS, ['ergometer', 'sled', 'sections', 'generic', 'wall_ball']);
  assert.doesNotMatch(read('../src/lib/serverRaceSheets.ts'), /nesta fase, só o Wall Ball/);

  await startRuns();
  const kinds = {};
  for (const stationId of ['ski-erg', 'sled-push', 'farmers-carry', 'box-jump', 'wall-balls']) {
    const opened = await openOk(JUDGE, 'ath-ana', stationId);
    kinds[stationId] = opened.attempt.stationKind;
    assert.equal(opened.attempt.status, 'waiting');
    assert.doesNotMatch(JSON.stringify(opened), /@example\.com/);
    // Até 2 cartões e a estação de 1 atleta sozinha (Story 1.103): o cartão vazio é dispensado antes do
    // próximo; a estação final (Box Jump, de 1 atleta) não se dispensa, só a gestora libera (D39).
    if (stationId === 'box-jump') assert.equal((await post(MANAGER, { action: 'claim_attempt', attemptId: opened.attempt.id, release: true })).status, 200);
    else if (stationId !== 'wall-balls') assert.equal((await post(JUDGE, { action: 'dismiss_attempt', attemptId: opened.attempt.id })).status, 200);
  }
  assert.deepEqual(kinds, { 'ski-erg': 'ergometer', 'sled-push': 'sled', 'farmers-carry': 'sections', 'box-jump': 'generic', 'wall-balls': 'wall_ball' });

  const runStage = await open(JUDGE, 'ath-ana', 'run-2');
  assert.equal(runStage.status, 400, 'corrida não abre tentativa');
  assert.doesNotMatch(runStage.body.error, /só o Wall Ball/);
  assert.equal((await open(JUDGE, 'ath-ana', 'stage-course-sled-push-111')).status, 400, 'estação de outra categoria');
  const outsider = await open(JUDGE, 'ath-fora', 'sled-push');
  assert.equal(outsider.status, 400);
  assert.match(outsider.body.error, /não pertence ao evento/);
  assert.equal(rows('race_attempts').length, 5);
});

// ---------------------------------------------------------------------------
// Chave da estação (AC2)
// ---------------------------------------------------------------------------

test('raceStationKey: "Sled Push" tem a mesma chave nas duas categorias; nome repetido ganha -2; chave inválida é recusada', () => {
  assert.equal(structure.raceStationKey('Sled Push'), 'sled-push');
  assert.equal(structure.raceStationKey('  Sled   Push! '), 'sled-push');
  assert.equal(structure.raceStationKey('Sled Push', 2), 'sled-push-2');
  assert.equal(structure.raceStationKey('Sled Push', 3), 'sled-push-3');
  assert.equal(structure.raceStationKey('???'), 'estacao');
  const pro = structure.raceStationKeysOf(race.toRaceSnapshotStages(COURSES['div-pro']));
  const duo = structure.raceStationKeysOf(race.toRaceSnapshotStages(COURSES['div-duo']));
  assert.equal(pro.get('sled-push'), 'sled-push');
  assert.equal(duo.get('stage-course-sled-push-111'), 'sled-push', 'ids diferentes, mesma estação física');
  assert.equal(duo.get('stage-course-sled-push-222'), 'sled-push-2');
  assert.equal(pro.has('run-1'), false, 'corrida não tem chave');
  // Ordem pelo orderIndex, não pela lista.
  const shuffled = structure.raceStationKeysOf([
    { id: 'b', name: 'Sled Push', type: 'station', orderIndex: 3 },
    { id: 'a', name: 'Sled Push', type: 'station', orderIndex: 1 }
  ]);
  assert.equal(shuffled.get('a'), 'sled-push');
  assert.equal(shuffled.get('b'), 'sled-push-2');
  assert.equal(structure.isRaceStationKey('sled-push-2'), true);
  assert.equal(structure.isRaceStationKey('../etc'), false);
  assert.equal(structure.isRaceStationKey(''), false);
});

// ---------------------------------------------------------------------------
// view=stations e view=station_board (AC3)
// ---------------------------------------------------------------------------

test('view=stations: estações do evento agrupadas pela chave, na ordem, com tipo, meta e closesTime por categoria; judge de outro evento 403', async (t) => {
  quiet(t);
  seed();
  await startRuns();
  const out = await get(JUDGE, { view: 'stations', eventId: EVENT });
  assert.equal(out.status, 200, out.body.error);
  const byKey = Object.fromEntries(out.body.stations.map((item) => [item.key, item]));
  assert.deepEqual(out.body.stations.map((item) => item.key).slice(0, 2), ['skierg', 'sled-push'], 'chave pelo nome "SkiErg", não pelo id');
  assert.deepEqual(Object.keys(byKey).sort(), ['box-jump', 'burpee-broad-jump', 'farmers-carry', 'sandbag-lunges', 'skierg', 'sled-push', 'sled-push-2', 'wall-balls']);
  assert.equal(byKey['sled-push'].kind, 'sled');
  assert.deepEqual(byKey['sled-push'].divisions.map((item) => [item.divisionId, item.stationId, item.expectedUnits]).sort(), [
    ['div-duo', 'stage-course-sled-push-111', 2],
    ['div-pro', 'sled-push', 4]
  ]);
  assert.equal(byKey['farmers-carry'].divisions[0].expectedUnits, 4);
  assert.equal(byKey['box-jump'].closesTime, true, 'genérica é a última do Women Pro');
  assert.equal(byKey['sandbag-lunges'].closesTime, true);
  assert.equal(byKey.skierg.kind, 'ergometer');
  assert.equal(byKey.skierg.closesTime, false);
  // Wall Ball: fecha só na dupla.
  const wallBall = byKey['wall-balls'];
  assert.equal(wallBall.kind, 'wall_ball');
  assert.equal(wallBall.closesTime, true);
  assert.deepEqual(wallBall.divisions.map((item) => [item.divisionId, item.closesTime]).sort(), [['div-duo', true], ['div-final', false], ['div-pro', false]]);
  assert.doesNotMatch(JSON.stringify(out.body), /@example\.com/);

  assert.equal((await get(JUDGE_OTHER, { view: 'stations', eventId: EVENT })).status, 403);
  // Antes da primeira largada (sem regulamento), lê o percurso atual.
  seed();
  const fresh = await get(JUDGE, { view: 'stations', eventId: EVENT });
  assert.equal(fresh.status, 200, fresh.body.error);
  assert.equal(fresh.body.stations.length, 8);
});

test('view=stations: regulamento ainda não travado segue o percurso editado; travado na largada, vale o snapshot (igual à escala)', async (t) => {
  quiet(t);
  seed();
  const ruleset = await race.ensureRaceRuleset(client, EVENT);
  // O organizador troca a Sled Push da dupla depois de o regulamento existir, antes de largar.
  const duo = database.rows('divisions').find((row) => row.id === 'div-duo');
  duo.course_layout = [run('run-1', 0), { id: 'burpee-duo', name: 'Burpee Broad Jump', type: 'station', orderIndex: 1 }];
  let out = await get(JUDGE, { view: 'stations', eventId: EVENT });
  assert.equal(out.status, 200, out.body.error);
  let duoKeys = out.body.stations.filter((item) => item.divisions.some((division) => division.divisionId === 'div-duo')).map((item) => item.key);
  assert.deepEqual(duoKeys, ['burpee-broad-jump'], 'a lista do judge mostra o percurso atual da dupla');
  // Travado (primeira largada): nova edição do percurso não muda a lista.
  database.rows('race_rulesets').find((row) => row.id === ruleset.id).locked_at = new Date().toISOString();
  duo.course_layout = [run('run-1', 0), { id: 'row-duo', name: 'Row', type: 'station', orderIndex: 1 }];
  out = await get(JUDGE, { view: 'stations', eventId: EVENT });
  duoKeys = out.body.stations.filter((item) => item.divisions.some((division) => division.divisionId === 'div-duo')).map((item) => item.key);
  assert.equal(out.body.stations.some((item) => item.key === 'row'), false);
  assert.ok(duoKeys.length > 0 && !duoKeys.includes('row'), 'vale o snapshot travado');
});

test('view=station_board: só ondas largadas, atletas com a estação, dupla como um cartão, tentativa com árbitro e trechos, sem e-mail; 404, 400 e 403', async (t) => {
  quiet(t);
  seed();
  const before = await get(JUDGE, { view: 'station_board', eventId: EVENT, stationKey: 'sled-push' });
  assert.equal(before.status, 200, before.body.error);
  assert.deepEqual(before.body.waves, [], 'onda sem largar não aparece');

  await startRuns();
  const opened = await openOk(JUDGE_2, 'ath-bia', 'sled-push');
  assert.equal((await append(JUDGE_2, opened.attempt.id, 0, [ev({ t: 'start' }), ...sections(2)])).status, 200);

  const out = await get(JUDGE, { view: 'station_board', eventId: EVENT, stationKey: 'sled-push' });
  assert.equal(out.status, 200, out.body.error);
  assert.deepEqual(out.body.station, { key: 'sled-push', name: 'Sled Push', kind: 'sled', closesTime: false });
  assert.equal(out.body.waves.length, 1);
  const athletes = Object.fromEntries(out.body.waves[0].athletes.map((item) => [item.athleteId, item]));
  assert.deepEqual(Object.keys(athletes).sort(), ['ath-ana', 'ath-bia', 'ath-dupla'], 'Men Open não tem Sled Push');
  assert.equal(athletes['ath-dupla'].team, true);
  assert.equal(athletes['ath-dupla'].stationId, 'stage-course-sled-push-111');
  assert.equal(athletes['ath-dupla'].expectedUnits, 2);
  assert.equal(athletes['ath-ana'].team, false);
  assert.equal(athletes['ath-ana'].attempt, null);
  assert.equal(athletes['ath-bia'].attempt.judgeName, JUDGE_2.name);
  assert.equal(athletes['ath-bia'].attempt.units, 2);
  assert.equal(athletes['ath-bia'].attempt.expectedUnits, 4);
  assert.equal(athletes['ath-bia'].attempt.status, 'running');
  assert.doesNotMatch(JSON.stringify(out.body), /@example\.com/);

  const second = await get(JUDGE, { view: 'station_board', eventId: EVENT, stationKey: 'sled-push-2' });
  assert.deepEqual(second.body.waves[0].athletes.map((item) => item.stationId), ['stage-course-sled-push-222']);

  assert.equal((await get(JUDGE, { view: 'station_board', eventId: EVENT, stationKey: 'remo' })).status, 404);
  assert.equal((await get(JUDGE, { view: 'station_board', eventId: EVENT, stationKey: '../x' })).status, 400);
  assert.equal((await get(JUDGE_OTHER, { view: 'station_board', eventId: EVENT, stationKey: 'sled-push' })).status, 403);
  // A leitura do Wall Ball (1.97) segue como está.
  const wallBall = await get(JUDGE, { view: 'wall_ball', eventId: EVENT });
  assert.equal(wallBall.status, 200);
  assert.ok(wallBall.body.waves[0].athletes.every((item) => item.attempt === null), 'a tentativa do trenó não entra no quadro do Wall Ball');
});

// ---------------------------------------------------------------------------
// Regras puras (AC5 a AC10)
// ---------------------------------------------------------------------------

const snapshot = (divisionId) => race.toRaceSnapshotStages(COURSES[divisionId]);
const stageOf = (divisionId, id) => {
  const stage = snapshot(divisionId).find((item) => item.id === id);
  return { ...engine.toRaceCourseStage(stage, stage.expectedUnits !== undefined ? { expectedUnits: stage.expectedUnits } : {}), kind: stage.kind, maleWeight: stage.maleWeight, femaleWeight: stage.femaleWeight };
};
const evaluate = (stage, events) => engine.evaluateRaceStation(P26, stage, events);

test('raceStation: botões por tipo, "Liberar" só com os trechos completos, controles de carga só com carga informada', () => {
  const erg = stageOf('div-pro', 'ski-erg');
  let controls = station.describeStationControls({ stage: erg, closesTime: false, result: evaluate(erg, []) });
  assert.equal(controls.counter, false);
  assert.equal(controls.showStart, true);
  assert.equal(controls.release.enabled, false);
  assert.equal(controls.release.label, 'Inicie para liberar');
  assert.equal(controls.exit.visible, false, 'ergômetro não tem "Atleta saiu"');
  controls = station.describeStationControls({ stage: erg, closesTime: false, result: evaluate(erg, [{ t: 'start' }]) });
  assert.equal(controls.showStart, false);
  assert.equal(controls.release.enabled, true);
  assert.match(controls.release.sub, /próxima estação/);

  const sled = stageOf('div-pro', 'sled-push');
  controls = station.describeStationControls({ stage: sled, closesTime: false, result: evaluate(sled, [{ t: 'start' }, { t: 'section' }, { t: 'section' }]) });
  assert.equal(controls.counter, true);
  assert.equal(controls.showStart, false, 'o 1º "+1" inicia junto (maquete)');
  assert.equal(controls.release.enabled, false);
  assert.equal(controls.release.label, 'Faltam 2 trechos');
  assert.deepEqual(controls.exit, { visible: true, enabled: true });
  assert.equal(controls.load.visible, false, 'trenó não tem devolução nem carga errada');
  controls = station.describeStationControls({ stage: sled, closesTime: true, result: evaluate(sled, [{ t: 'start' }, ...Array(4).fill({ t: 'section' })]) });
  assert.equal(controls.release.enabled, true);
  assert.equal(controls.canAddUnit, false);
  assert.equal(controls.exit.enabled, false);
  assert.equal(controls.release.sub, 'Fecha o tempo da prova · sem desfazer');

  const farmers = stageOf('div-pro', 'farmers-carry');
  const bbj = stageOf('div-pro', 'burpee-broad-jump');
  assert.equal(station.stationHasLoad(farmers), true);
  assert.equal(station.stationHasLoad(bbj), false);
  assert.equal(station.stationHasLoad(sled), false, 'só seções');
  controls = station.describeStationControls({ stage: farmers, closesTime: false, result: evaluate(farmers, [{ t: 'start' }]) });
  assert.deepEqual(controls.load, { visible: true, openReturn: false, canReturnWrong: true, canWrongLoad: true });
  controls = station.describeStationControls({ stage: farmers, closesTime: false, result: evaluate(farmers, [{ t: 'start' }, { t: 'return_wrong' }]) });
  assert.deepEqual(controls.load, { visible: true, openReturn: true, canReturnWrong: false, canWrongLoad: false });
  controls = station.describeStationControls({ stage: farmers, closesTime: false, result: evaluate(farmers, [{ t: 'start' }, { t: 'return_wrong' }, { t: 'return_corrected' }]) });
  assert.equal(controls.load.openReturn, false, 'corrigida, a janela fecha');
  controls = station.describeStationControls({ stage: farmers, closesTime: false, result: evaluate(farmers, [{ t: 'start' }, { t: 'wrong_load' }]) });
  assert.equal(controls.redo, true);
  assert.equal(controls.load.visible, false);
  assert.equal(controls.release.enabled, false);
  assert.equal(controls.exit.visible, false);
  controls = station.describeStationControls({ stage: bbj, closesTime: false, result: evaluate(bbj, [{ t: 'start' }]) });
  assert.equal(controls.load.visible, false, 'Burpee Broad Jump sem carga: sem "Carga errada"');

  // Seções sem meta: sem "Atleta saiu" (a saída não cobraria nada e fecharia a estação).
  const noMeta = { id: 'x', name: 'Seções', kind: 'sections' };
  controls = station.describeStationControls({ stage: noMeta, closesTime: true, result: evaluate(noMeta, [{ t: 'start' }, { t: 'section' }]) });
  assert.equal(controls.exit.visible, false);
  assert.equal(controls.release.enabled, true);
});

test('raceStation: texto de "Atleta saiu" com faltantes × 180 s; na estação final avisa que não fecha o tempo', () => {
  const exit = station.describeStationExit({ kind: 'sled', units: 2, expectedUnits: 4, perUnitSeconds: P26.missingUnit.perUnitSeconds, closesTime: false });
  assert.equal(exit.missing, 2);
  assert.equal(exit.seconds, 360);
  assert.equal(exit.calc, '2 × 180 s');
  assert.equal(exit.charge, '+6 min');
  assert.equal(exit.progress, '2 de 4 trechos · faltam 2');
  assert.equal(exit.consequence, 'Encerra a estação e cobra os trechos que faltam.');
  assert.equal(exit.closesTimeWarning, null);
  const last = station.describeStationExit({ kind: 'sections', units: 1, expectedUnits: 2, perUnitSeconds: 180, closesTime: true });
  assert.equal(last.consequence, 'Encerra a estação e cobra a volta que falta.');
  assert.match(last.closesTimeWarning, /não fecha o tempo/);
  assert.match(last.closesTimeWarning, /organizador/);
});

test('raceStation: motivos agrupados por estação da biblioteca, infração geral, desfazer, tempo na estação, linhas da lista e aviso de 1 atleta', () => {
  const codes = (stage) => station.stationReasons(P26, stage).map((item) => item.code);
  assert.deepEqual(codes(stageOf('div-pro', 'farmers-carry')), ['kb_moved_forward', 'arms_not_extended']);
  assert.deepEqual(codes(stageOf('div-pro', 'burpee-broad-jump')), ['chest_not_touching', 'hands_too_far', 'feet_misaligned', 'extra_step']);
  assert.deepEqual(codes(stageOf('div-final', 'sandbag')), ['knee_not_touching', 'no_extension', 'step_between_reps', 'sandbag_outside_shoulders'], 'pelo nome, id personalizado');
  assert.equal(codes({ id: 'x', name: 'Seções Extra', kind: 'sections' }).length, 10, 'fora da biblioteca: todos os motivos');
  assert.deepEqual(codes(stageOf('div-pro', 'ski-erg')), ['feet_off_base', 'feet_off_rest']);
  assert.deepEqual(codes(stageOf('div-pro', 'box-jump')), [], 'genérica: só infrações gerais');
  const general = station.stationGeneralInfractionItems(P26);
  assert.equal(general.length, P26.general.length);
  assert.ok(general.every((item) => item.event.t === 'infraction'), 'sem magnésio do Wall Ball');
  assert.match(station.describeStationWarning(P26, 'sled', false), /advertência \(0 s\)/);

  // Desfazer nunca atinge início, liberação nem saída.
  const sled = stageOf('div-pro', 'sled-push');
  const log = [{ t: 'start' }, { t: 'section' }, { t: 'infraction', code: 'lane_invaded' }].map((event) => ({ event }));
  assert.equal(station.lastUndoableStationSeq(log, evaluate(sled, log.map((item) => item.event))), 2);
  const exited = [{ t: 'start' }, { t: 'section' }, { t: 'exit' }].map((event) => ({ event }));
  assert.equal(station.lastUndoableStationSeq(exited, evaluate(sled, exited.map((item) => item.event))), 1);
  const onlyStart = [{ event: { t: 'start' } }];
  assert.equal(station.lastUndoableStationSeq(onlyStart, evaluate(sled, [{ t: 'start' }])), null);
  const erg = stageOf('div-pro', 'ski-erg');
  const released = [{ t: 'start' }, { t: 'release' }].map((event) => ({ event }));
  assert.equal(station.lastUndoableStationSeq(released, evaluate(erg, released.map((item) => item.event))), null);
  assert.equal(station.describeLastStationAction([...log, { event: { t: 'undo', of: 2 } }], P26, 'sled'), 'desfeito (Invadiu a raia). O registro continua no histórico');

  // Tempo na estação: do toque do início até agora; encerrada, até o toque do fim.
  const t0 = Date.parse('2026-11-01T11:00:00Z');
  const queued = [{ id: 'a', event: { t: 'start' }, deviceAt: t0 }, { id: 'b', event: { t: 'release' }, deviceAt: t0 + 95_000 }];
  assert.equal(station.stationElapsedSeconds(queued.slice(0, 1), evaluate(erg, [{ t: 'start' }]), t0 + 40_000), 40);
  assert.equal(station.stationElapsedSeconds(queued, evaluate(erg, queued.map((item) => item.event)), t0 + 500_000), 95);
  assert.equal(station.stationElapsedSeconds([], evaluate(erg, []), t0), null);

  // Linhas da lista e o aviso da estação final.
  const row = (athleteId, name, attempt, extra = {}) => ({ athleteId, name, box: 'Box', divisionName: 'Pro', team: false, runStatus: 'racing', stationId: 'box-jump', kind: 'generic', expectedUnits: null, closesTime: true, attempt, ...extra });
  const attempt = (judgeUserId, status = 'running', extra = {}) => ({ id: `att-${judgeUserId}`, status, judgeUserId, judgeName: judgeUserId ? 'Judge X' : '', started: true, units: 0, expectedUnits: null, missing: 0, penaltySeconds: 0, ...extra });
  const mine = row('a', 'Ana', attempt('me'));
  assert.equal(station.describeStationRow(mine, 'me').chip, 'Seu atleta');
  assert.equal(station.describeStationRow(row('b', 'Bia', attempt('other')), 'me').chip, 'Com Judge X');
  assert.equal(station.describeStationRow(row('b', 'Bia', attempt(null)), 'me').chip, 'Sem judge · assumir');
  assert.equal(station.describeStationRow(row('b', 'Bia', null), 'me').chip, 'Em corrida');
  assert.equal(station.describeStationRow(row('b', 'Bia', attempt('me', 'released')), 'me').done, true);
  assert.equal(station.describeStationRow(row('b', 'Bia', attempt('me', 'exited_incomplete', { missing: 2 }), { kind: 'sled' }), 'me').chip, 'Saiu · faltaram 2');
  assert.equal(station.describeStationRow(row('b', 'Bia', null, { runStatus: 'dnf' }), 'me').chip, 'DNF');
  assert.equal(station.describeStationRow(row('b', 'Bia', attempt('me', 'running', { units: 2, expectedUnits: 4 }), { kind: 'sled', closesTime: false }), 'me').detail, '2 de 4 trechos');
  const other = row('b', 'Bia', null);
  const guard = station.finalStationGuard([mine, other], 'me', other);
  assert.equal(guard.message, 'Esta estação é de 1 atleta por judge. Libere Ana antes de abrir outro atleta.');
  assert.equal(guard.open.athleteId, 'a');
  assert.equal(station.finalStationGuard([mine, other], 'me', mine), null, 'o próprio atleta aberto abre normal');
  assert.equal(station.finalStationGuard([row('a', 'Ana', attempt('me', 'released')), other], 'me', other), null, 'liberado não conta');
  const middleOther = { ...other, closesTime: false };
  assert.equal(station.finalStationGuard([{ ...mine, closesTime: false }, middleOther], 'me', middleOther), null, 'no meio do percurso, os 2 cartões são da 1.103');
  assert.deepEqual(station.filterStationRows([{ name: 'Éva Prado' }, { name: 'Bia Lima' }], 'eva').map((item) => item.name), ['Éva Prado']);
  assert.equal(station.filterStationRows([{ name: 'A' }, { name: 'B' }], '  ').length, 2);
  assert.equal(station.raceStationEyebrow('Sled Push'), 'Fitness Race · Sled Push');
  assert.equal(station.stationOpensWallBall('wall_ball'), true);
  assert.equal(station.stationOpensWallBall('generic'), false);
});

test('fila no aparelho: o cartão reaproveita useRaceSync (lote em ordem, 409 recarregar, 401 preserva a fila)', () => {
  const body = wb.buildRaceAppendBody('attempt_1', 3, [
    { id: 'a', event: { t: 'start' }, deviceAt: 10 },
    { id: 'b', event: { t: 'section' }, deviceAt: 11 }
  ], 20);
  assert.deepEqual(body.events.map((item) => item.id), ['a', 'b']);
  assert.equal(body.fromSeq, 3);
  assert.equal(wb.classifyRaceSyncResponse(409), 'conflict');
  assert.equal(wb.classifyRaceSyncResponse(401), 'session');
  assert.equal(wb.classifyRaceSyncResponse(400), 'rejected');
  assert.equal(wb.classifyRaceSyncResponse(503), 'retry');
  assert.match(wb.RACE_SESSION_EXPIRED_MESSAGE, /continuam guardados/);
  const screen = read('../src/components/race/StationAttemptScreen.tsx');
  assert.match(screen, /useRaceSync\(\{ attemptId: attempt\.id, serverEvents, writable, onSaved \}\)/);
  assert.match(screen, /evaluateRaceStation\(rules, engineStage, sync\.items/);
  assert.match(screen, /Recarregar/);
  assert.match(screen, /Entrar de novo/);
});

// ---------------------------------------------------------------------------
// Pela rota (AC6, AC7, D28)
// ---------------------------------------------------------------------------

test('rota: trenó completo libera; liberar com trecho faltando recusa com a mensagem do motor; saída cobra 180 s por trecho', async (t) => {
  quiet(t);
  seed();
  await startRuns();
  const ana = await openOk(JUDGE, 'ath-ana', 'sled-push');
  let sent = await append(JUDGE, ana.attempt.id, 0, [ev({ t: 'start' }), ...sections(2)]);
  assert.equal(sent.status, 200, sent.body.error);
  const early = await append(JUDGE, ana.attempt.id, 3, [ev({ t: 'release' })]);
  assert.equal(early.status, 400);
  assert.equal(early.body.error, 'Registro 4: faltam 2 trechos: registre a saída.');
  sent = await append(JUDGE, ana.attempt.id, 3, [...sections(2), ev({ t: 'release' })]);
  assert.equal(sent.status, 200, sent.body.error);
  assert.equal(sent.body.attempt.status, 'released');
  assert.equal(sent.body.attempt.closesTime, false);
  assert.equal(runOf('ath-ana').status, 'racing', 'trenó no meio não fecha o tempo');
  assert.ok(rows('race_attempts').find((row) => row.id === ana.attempt.id).ended_at);

  const bia = await openOk(JUDGE_2, 'ath-bia', 'sled-push');
  sent = await append(JUDGE_2, bia.attempt.id, 0, [ev({ t: 'start' }), ...sections(1), ev({ t: 'exit' })]);
  assert.equal(sent.status, 200, sent.body.error);
  assert.equal(sent.body.attempt.status, 'exited_incomplete');
  const charged = infractionsOf(bia.attempt.id).find((row) => row.code === 'missing_units');
  assert.equal(charged.seconds, 540, '3 trechos × 180 s');
  assert.equal(charged.units, 3);
  assert.equal(charged.status, 'confirmed');
});

test('rota: seções com carga: devolução corrigida antes da Roxzone cancela os 30 s, depois não; carga errada leva a REFAZER e "não refez" cobra 180 s', async (t) => {
  quiet(t);
  seed();
  await startRuns();
  const ana = await openOk(JUDGE, 'ath-ana', 'farmers-carry');
  const id = ana.attempt.id;
  let sent = await append(JUDGE, id, 0, [ev({ t: 'start' }), ev({ t: 'section' }), ev({ t: 'return_wrong' }), ev({ t: 'return_corrected' })]);
  assert.equal(sent.status, 200, sent.body.error);
  assert.equal(infractionsOf(id).find((row) => row.code === 'return_wrong').status, 'cancelled', 'corrigida antes da Roxzone: 30 s cancelados');
  sent = await append(JUDGE, id, 4, [ev({ t: 'return_wrong' }), ev({ t: 'leave_roxzone' })]);
  assert.equal(sent.status, 200, sent.body.error);
  const late = await append(JUDGE, id, 6, [ev({ t: 'return_corrected' })]);
  assert.equal(late.status, 400);
  assert.match(late.body.error, /já saiu da Roxzone/);
  const kept = infractionsOf(id).filter((row) => row.code === 'return_wrong' && row.status === 'confirmed');
  assert.equal(kept.length, 1);
  assert.equal(kept[0].seconds, 30);

  sent = await append(JUDGE, id, 6, [ev({ t: 'wrong_load' })]);
  assert.equal(sent.status, 200, sent.body.error);
  assert.equal(sent.body.attempt.status, 'redo');
  const blocked = await append(JUDGE, id, 7, [ev({ t: 'release' })]);
  assert.equal(blocked.status, 400);
  assert.match(blocked.body.error, /refez antes de liberar/);
  sent = await append(JUDGE, id, 7, [ev({ t: 'redo_declined' })]);
  assert.equal(sent.status, 200, sent.body.error);
  const declined = infractionsOf(id).find((row) => row.code === 'redo_declined');
  assert.equal(declined.seconds, 180);
  assert.equal(declined.status, 'confirmed');
  assert.equal(sent.body.attempt.status, 'running');
});

// ---------------------------------------------------------------------------
// Estação final: tela de 1 atleta (AC12, D39, D44)
// ---------------------------------------------------------------------------

test('estação final: a genérica libera e fecha o tempo; seções saem incompletas sem fechar; reps abre a tela do Wall Ball', async (t) => {
  quiet(t);
  seed();
  await startRuns();
  const ana = await openOk(JUDGE, 'ath-ana', 'box-jump');
  assert.equal(ana.attempt.closesTime, true);
  let sent = await append(JUDGE, ana.attempt.id, 0, [ev({ t: 'start' }), ev({ t: 'release' })]);
  assert.equal(sent.status, 200, sent.body.error);
  assert.equal(sent.body.attempt.status, 'released');
  assert.equal(runOf('ath-ana').status, 'finished', 'a última estação fecha o tempo (D34)');
  assert.equal(runOf('ath-ana').time_source, 'sheet');

  const caio = await openOk(JUDGE_2, 'ath-caio', 'sandbag');
  assert.equal(caio.attempt.closesTime, true);
  sent = await append(JUDGE_2, caio.attempt.id, 0, [ev({ t: 'start' }), ev({ t: 'section' }), ev({ t: 'exit' })]);
  assert.equal(sent.status, 200, sent.body.error);
  assert.equal(sent.body.attempt.status, 'exited_incomplete');
  assert.equal(runOf('ath-caio').status, 'racing', 'saída incompleta na última estação não fecha (D44)');
  assert.equal(runOf('ath-caio').finish_at, null);
  assert.equal(infractionsOf(caio.attempt.id).find((row) => row.code === 'missing_units').seconds, 180);

  // A dupla fecha no Wall Ball: reps nunca usa o cartão de estação.
  const stations = await get(JUDGE, { view: 'stations', eventId: EVENT });
  const wallBall = stations.body.stations.find((item) => item.key === 'wall-balls');
  assert.equal(station.stationOpensWallBall(wallBall.kind), true);
  const list = read('../src/components/race/StationListScreen.tsx');
  const attemptScreen = read('../src/components/race/StationAttemptScreen.tsx');
  assert.match(list, /stationOpensWallBall\(payload\.station\.kind\)/);
  assert.match(list, /\/wall-ball`/);
  assert.match(attemptScreen, /stationOpensWallBall\(payload\.stage\?\.kind \?\? payload\.attempt\.stationKind\)/);
  assert.match(attemptScreen, /\/wall-ball\/\$\{encode\(attemptId\)\}/);
  assert.doesNotMatch(attemptScreen, /\/cartoes/, 'a estação final não é redirecionada para os 2 cartões (1.103)');
});

// ---------------------------------------------------------------------------
// Renderização do cartão (AC4 a AC8, AC12)
// ---------------------------------------------------------------------------

const noop = () => {};
const cardProps = (stage, events, extra = {}) => {
  const result = evaluate(stage, events);
  const closesTime = extra.closesTime ?? false;
  const controls = station.describeStationControls({ stage, closesTime, result });
  return {
    athleteName: 'Ana Souza',
    team: false,
    kind: stage.kind,
    target: station.describeStationMeta(stage, 'female').target,
    load: station.describeStationMeta(stage, 'female').load,
    closesTime,
    oneAthlete: closesTime,
    controls,
    units: result.units,
    expectedUnits: result.expectedUnits,
    stationReasons: station.stationReasons(P26, stage),
    generalItems: station.stationGeneralInfractionItems(P26),
    warningText: station.describeStationWarning(P26, stage.kind, false),
    warningUsed: station.stationWarningUsed(result),
    penaltySeconds: result.penaltySeconds,
    returnWrongSeconds: P26.returnWrong.seconds,
    redoDeclinedSeconds: P26.wrongLoad.declinedSeconds,
    lastAction: '',
    refusal: '',
    stationElapsed: result.started ? '1:40' : null,
    raceElapsed: '1:10:58',
    exitInfo: controls.exit.visible && result.expectedUnits !== null
      ? station.describeStationExit({ kind: stage.kind, units: result.units, expectedUnits: result.expectedUnits, perUnitSeconds: 180, closesTime })
      : null,
    released: null,
    exited: null,
    canUndo: false,
    locked: false,
    nextHref: '/judge/corrida/ev/estacao/box-jump',
    onStart: noop, onUnit: noop, onStationInfraction: noop, onGeneralInfraction: noop, onReturnWrong: noop, onReturnCorrected: noop,
    onLeaveRoxzone: noop, onWrongLoad: noop, onRedoDone: noop, onRedoDeclined: noop, onExit: noop, onRelease: noop, onUndo: noop,
    ...extra
  };
};
const render = (props) => renderToStaticMarkup(createElement(StationCard, props));

test('cartão: ergômetro com Iniciar e motivos em 1 toque; trenó com contador e "Atleta saiu"; seções com carga; alvos de 56 px', () => {
  const erg = render(cardProps(stageOf('div-pro', 'ski-erg'), []));
  assert.match(erg, />Iniciar</);
  assert.match(erg, /Pés fora da base/);
  assert.match(erg, /Pés fora do apoio/);
  assert.doesNotMatch(erg, /Atleta saiu/);
  assert.match(erg, /Inicie para liberar/);
  assert.match(erg, /data-hold-to-confirm/);

  const sled = render(cardProps(stageOf('div-pro', 'sled-push'), [{ t: 'start' }, { t: 'section' }]));
  assert.match(sled, /de 4 trechos/);
  assert.match(sled, /Mais 1 trecho/);
  assert.match(sled, /Infração da estação/, '7 motivos ficam na folha');
  assert.match(sled, /Atleta saiu/);
  assert.match(sled, /Faltam 3 trechos/);
  assert.match(sled, /102kg/, 'carga do naipe vem do percurso (D6)');
  assert.doesNotMatch(sled, /Devolução incorreta/);

  const exitSheet = render(cardProps(stageOf('div-pro', 'sled-push'), [{ t: 'start' }, { t: 'section' }], { initialSheet: 'exit' }));
  assert.match(exitSheet, /3 × 180 s/);
  assert.match(exitSheet, /\+9 min/);
  assert.match(exitSheet, /Segure para registrar a saída/);

  const farmers = render(cardProps(stageOf('div-pro', 'farmers-carry'), [{ t: 'start' }]));
  assert.match(farmers, /Devolução incorreta/);
  assert.match(farmers, /Carga errada/);
  assert.match(farmers, /KB avançou ao apoiar/);
  assert.match(farmers, /de 4 voltas/);
  const rox = render(cardProps(stageOf('div-pro', 'farmers-carry'), [{ t: 'start' }, { t: 'return_wrong' }]));
  assert.match(rox, /Devolução corrigida/);
  assert.match(rox, /Saiu da Roxzone/);
  const redo = render(cardProps(stageOf('div-pro', 'farmers-carry'), [{ t: 'start' }, { t: 'wrong_load' }]));
  assert.match(redo, /REFAZER com a carga certa/);
  assert.match(redo, /Refez/);
  assert.match(redo, /Não refez/);
  assert.doesNotMatch(redo, /Segure para liberar/);

  const general = render(cardProps(stageOf('div-pro', 'box-jump'), [{ t: 'start' }], { initialSheet: 'general' }));
  assert.match(general, /Infração geral/);
  assert.match(general, /data-one-tap-infraction/);
  assert.doesNotMatch(general, /Confirmar/, 'infração geral sem diálogo de confirmação (D17)');

  for (const html of [erg, sled, farmers]) {
    assert.match(html, /min-h-14/);
    assert.match(html, /Desfazer último/);
    assert.match(html, /\(provisório\)/);
  }
});

test('cartão na estação final (AC12): 1 atleta, sem Soltar, Dispensar, vaga livre nem segundo cartão; "Liberar" fecha o tempo; liberado mostra o tempo e "Próximo atleta"', () => {
  const final = stageOf('div-pro', 'box-jump');
  const running = render(cardProps(final, [{ t: 'start' }], { closesTime: true }));
  assert.match(running, /1 atleta por judge/);
  assert.match(running, /Fecha o tempo/);
  assert.match(running, /Fecha o tempo da prova · sem desfazer/);
  for (const absent of [/Soltar/, /Dispensar/, /Vaga livre/, /Adicionar atleta/, /Meus cartões/]) assert.doesNotMatch(running, absent);
  assert.equal((running.match(/<section/g) || []).length, 1, 'um cartão só');

  const released = render(cardProps(final, [{ t: 'start' }, { t: 'release' }], {
    closesTime: true,
    released: { at: '09:52:42', stationElapsed: '3:22', athleteElapsed: '1:12:40', official: '1:14:40' }
  }));
  assert.match(released, /Tempo do atleta/);
  assert.match(released, /1:12:40/);
  assert.match(released, /Tempo oficial \(servidor\)/);
  assert.match(released, /Próximo atleta/);
  assert.match(released, /href="\/judge\/corrida\/ev\/estacao\/box-jump"/);
  assert.doesNotMatch(released, /Fechar</);

  const sandbag = stageOf('div-final', 'sandbag');
  const exitFinal = render(cardProps(sandbag, [{ t: 'start' }, { t: 'section' }], { closesTime: true, initialSheet: 'exit' }));
  assert.match(exitFinal, /não fecha o tempo da prova/);
  const exited = render(cardProps(sandbag, [{ t: 'start' }, { t: 'section' }, { t: 'exit' }], { closesTime: true, exited: { missing: 1, charge: '+3 min' } }));
  assert.match(exited, /Saída registrada/);
  assert.match(exited, /O tempo da prova não fecha/);

  const middle = render(cardProps(stageOf('div-pro', 'ski-erg'), [{ t: 'start' }, { t: 'release' }], {
    released: { at: '09:16:40', stationElapsed: '3:42', athleteElapsed: '40:00', official: null }
  }));
  assert.match(middle, /Liberado às/);
  assert.match(middle, /Tempo na estação/);
  assert.doesNotMatch(middle, /Tempo do atleta/);
});

test('estático: faixa "Fitness Race · {estação}", segurar no Liberar e no Atleta saiu, sem abandon, sem exit em reps, atalho "Abrir estações"; Functional Fitness intocado', () => {
  const card = read('../src/components/race/StationCard.tsx');
  const screen = read('../src/components/race/StationAttemptScreen.tsx');
  const list = read('../src/components/race/StationListScreen.tsx');
  const rules = read('../src/lib/raceStation.ts');
  assert.match(card, /useTapHold\(\{/);
  assert.match(card, /onHold=\{onRelease\}/);
  assert.match(card, /onHold=\{\(\) => \{ setSheet\(null\); onExit\(\); \}\}/);
  for (const source of [card, screen, list]) {
    assert.doesNotMatch(source, /'abandon'|t: 'abandon'/, 'a tela nunca envia abandon');
    assert.doesNotMatch(source, /useSheetSync|\/api\/sheets/, 'Functional Fitness fica de fora');
  }
  assert.match(screen, /if \(counter && controls\.exit\.enabled\) withStart\(\{ t: 'exit' \}\)/, 'exit só no trenó e nas seções');
  assert.match(rules, /kind === 'sled' \|\| kind === 'sections'/);
  assert.match(screen, /eyebrow=\{raceStationEyebrow\(stage\.name\)\}/);
  assert.match(list, /eyebrow=\{raceStationEyebrow\(station\?\.name\)\}/);
  assert.match(list, /type="search"/);
  assert.match(list, /Esta estação é de 1 atleta por judge/);
  const heat = read('../src/components/race/HeatStartScreen.tsx');
  assert.match(heat, /Abrir Wall Ball/);
  assert.match(heat, /Abrir estações/);
  assert.match(heat, /\$\{listHref\}\/estacao/);
  for (const page of ['estacao/page.tsx', 'estacao/[stationKey]/page.tsx', 'estacao/[stationKey]/[attemptId]/page.tsx']) {
    assert.ok(read(`../src/app/judge/corrida/[eventId]/${page}`).length > 0, page);
  }
  // O padrão de Functional Fitness da faixa não muda.
  assert.match(read('../src/components/judge/CourtShell.tsx'), /COURT_DEFAULT_EYEBROW = 'Arbitragem na quadra'/);
});
