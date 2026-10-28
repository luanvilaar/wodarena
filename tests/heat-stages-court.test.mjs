import assert from 'node:assert/strict';
import test from 'node:test';

import { createFakeSupabase } from './support/fakeSupabase.mjs';
import { importServerModule, setActiveSupabaseClient } from './support/serverModuleHarness.mjs';

// Story 1.89: a quadra com baterias da prova do evento (categorias misturadas). Rota real,
// banco em memória: o quadro leva a prova de cada raia, a súmula abre na prova da categoria
// do atleta e o servidor recusa prova de outra categoria ou raia de outra prova.

process.env.SUPABASE_URL = 'http://supabase.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';
process.env.WODA_SESSION_SECRET = 'segredo-de-teste-quadra-etapas';

let database = createFakeSupabase();
setActiveSupabaseClient({ from: (table) => database.client.from(table), rpc: (name, args) => database.client.rpc(name, args) });

const { GET: getSheets, POST: postSheets } = await importServerModule('app/api/sheets/route.ts');
const { createSessionToken } = await importServerModule('lib/serverSecurity.ts');
const { validateWorkoutStructure } = await importServerModule('lib/workoutStructure.ts');

const MANAGER = { id: 'mgr-etapas', name: 'Gestora', email: 'g@example.com', role: 'manager', service_valid_until: '2099-12-31' };
const JUDGE = { id: 'judge-etapas', name: 'Judge Rafa', email: 'rafa@example.com', role: 'judge', parent_manager_id: MANAGER.id };
const EVENT = 'ev-etapas';

const segment = (id, round, name, reps) => ({ id, round, name, reps, unit: 'reps', load: null, note: '', required: true, mark: 'reps' });
const structure = (reps) => validateWorkoutStructure({
  version: 2, format: 'for_time', totalReps: reps * 2, timeCapSeconds: 600,
  incomplete: { rule: 'penalty_per_rep', secondsPerRep: 1, base: 'time_cap' },
  tieBreak: { kind: 'split_time', at: 's1', order: 'asc' }, generator: null, customized: true,
  entry: { mode: 'both', marking: 'reps', publish: 'after_review' },
  segments: [segment('s1', 1, 'Thruster', reps), segment('s2', 1, 'Pull-up', reps)],
  maxLoad: null, scoreDisplay: null
}).structure;

const seed = () => {
  database = createFakeSupabase({
    users: [MANAGER, JUDGE],
    events: [{
      id: EVENT, name: 'Híbrido Games', date: '2026-11-01', location: 'Recife', organizer_id: MANAGER.id, event_type: 'functional_fitness', status: 'upcoming',
      event_schedule: [
        {
          id: 'heat-stage-1-1', kind: 'heat', heatNumber: 1, date: '2026-11-01', time: '08:00', title: 'BATERIA 1 - Prova 1 · DT Speed',
          workoutId: 'rx-1', stageNumber: 1, stageTitle: 'Prova 1 · DT Speed', stageWorkouts: { rx: 'rx-1', sc: 'sc-1' },
          athleteIds: ['a-rx1', 'a-sc1', '', 'a-rx2'], laneWorkoutIds: ['rx-1', 'sc-1', '', 'rx-1']
        },
        { id: 'heat-old', kind: 'heat', heatNumber: 1, date: '2026-11-01', time: '09:00', title: 'BATERIA 1 - antiga', workoutId: 'rx-2', athleteIds: ['a-rx1'] }
      ]
    }],
    event_judges: [{ event_id: EVENT, judge_user_id: JUDGE.id }],
    divisions: [{ id: 'rx', event_id: EVENT, name: 'RX Masculino' }, { id: 'sc', event_id: EVENT, name: 'Scale Masculino' }],
    athletes: [
      { id: 'a-rx1', name: 'Rafael Costa', box: 'Box Litoral', division_id: 'rx' },
      { id: 'a-rx2', name: 'Bruno Alves', box: 'Arena Norte', division_id: 'rx' },
      { id: 'a-sc1', name: 'André Souza', box: 'Iron Lab', division_id: 'sc' },
      { id: 'a-sc2', name: 'Caio Mendes', box: 'Pulso Fit', division_id: 'sc' }
    ],
    workouts: [
      { id: 'rx-1', event_id: EVENT, name: 'DT Speed (RX)', code: 'WOD 1', order_index: 1, type: 'fortime', time_cap: '10:00', tie_breaker: 'Tempo', division_id: 'rx', structure: structure(21) },
      { id: 'rx-2', event_id: EVENT, name: 'Cardio Burn (RX)', code: 'WOD 2', order_index: 2, type: 'fortime', time_cap: '10:00', tie_breaker: 'Tempo', division_id: 'rx', structure: structure(15) },
      { id: 'sc-1', event_id: EVENT, name: 'DT Speed (Scale)', code: 'WOD 1', order_index: 1, type: 'fortime', time_cap: '10:00', tie_breaker: 'Tempo', division_id: 'sc', structure: structure(12) }
    ],
    scores: [],
    registrations: []
  });
};

const cookie = (user) => `woda_session=${createSessionToken({ id: user.id, name: user.name, email: user.email, role: user.role })}`;
const get = async (query) => {
  const response = await getSheets(new Request(`http://localhost/api/sheets?${new URLSearchParams(query)}`, { headers: { cookie: cookie(JUDGE) } }));
  return { status: response.status, body: await response.json() };
};
const post = async (body, user = JUDGE) => {
  const response = await postSheets(new Request('http://localhost/api/sheets', { method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie(user) }, body: JSON.stringify(body) }));
  return { status: response.status, body: await response.json() };
};
const quiet = (t) => { t.mock.method(console, 'error', () => {}); t.mock.method(console, 'warn', () => {}); t.mock.method(console, 'info', () => {}); };
const rows = (table) => structuredClone(database.rows(table));

test('o quadro leva a prova do evento, a prova de cada raia e deixa a bateria antiga como está', async (t) => {
  quiet(t);
  seed();
  const board = await get({ view: 'board', eventId: EVENT });
  assert.equal(board.status, 200, board.body.error);

  assert.deepEqual(board.body.stages, [{ number: 1, title: 'Prova 1 · DT Speed', workoutByDivision: { rx: 'rx-1', sc: 'sc-1' } }]);
  const mixed = board.body.heats.find((heat) => heat.id === 'heat-stage-1-1');
  assert.equal(mixed.stageNumber, 1);
  assert.equal(mixed.stageTitle, 'Prova 1 · DT Speed');
  assert.deepEqual(mixed.lanes.map((lane) => [lane.lane, lane.athleteId, lane.divisionName, lane.workoutId]), [
    [1, 'a-rx1', 'RX Masculino', 'rx-1'],
    [2, 'a-sc1', 'Scale Masculino', 'sc-1'],
    [4, 'a-rx2', 'RX Masculino', 'rx-1']
  ]);

  const old = board.body.heats.find((heat) => heat.id === 'heat-old');
  assert.equal(old.stageNumber, null);
  assert.deepEqual(old.lanes.map((lane) => [lane.athleteId, lane.workoutId]), [['a-rx1', 'rx-2']], 'na bateria antiga a prova da raia é a da bateria');
});

test('abrir: cada raia abre a súmula da prova da categoria do atleta, com a bateria e a raia', async (t) => {
  quiet(t);
  seed();
  const rx = await post({ action: 'open', eventId: EVENT, workoutId: 'rx-1', athleteId: 'a-rx1', heatId: 'heat-stage-1-1', lane: 1 });
  assert.equal(rx.status, 200, rx.body.error);
  const sc = await post({ action: 'open', eventId: EVENT, workoutId: 'sc-1', athleteId: 'a-sc1', heatId: 'heat-stage-1-1', lane: 2 });
  assert.equal(sc.status, 200, sc.body.error);

  const sheets = rows('scoresheets');
  assert.deepEqual(sheets.map((row) => [row.athlete_id, row.workout_id, row.division_id, row.heat_id, row.heat_number, row.lane]).sort(), [
    ['a-rx1', 'rx-1', 'rx', 'heat-stage-1-1', 1, 1],
    ['a-sc1', 'sc-1', 'sc', 'heat-stage-1-1', 1, 2]
  ]);
  assert.notDeepEqual(sheets.find((row) => row.athlete_id === 'a-rx1').structure, sheets.find((row) => row.athlete_id === 'a-sc1').structure, 'cada um leva a estrutura da prova da categoria');
});

test('abrir: o servidor recusa prova de outra categoria e raia de bateria que é de outra prova', async (t) => {
  quiet(t);
  seed();
  // atleta Scale na prova do RX
  const wrongCategory = await post({ action: 'open', eventId: EVENT, workoutId: 'rx-1', athleteId: 'a-sc1', heatId: 'heat-stage-1-1', lane: 2 });
  assert.equal(wrongCategory.status, 400);
  assert.match(wrongCategory.body.error, /outra categoria/);

  // atleta RX na 2ª prova dele, mas a raia dele nesta bateria é da 1ª
  const wrongStage = await post({ action: 'open', eventId: EVENT, workoutId: 'rx-2', athleteId: 'a-rx1', heatId: 'heat-stage-1-1', lane: 1 });
  assert.equal(wrongStage.status, 400);
  assert.match(wrongStage.body.error, /outra prova/);

  assert.equal(rows('scoresheets').length, 0, 'nada é gravado');

  // a bateria antiga segue abrindo como sempre
  const legacy = await post({ action: 'open', eventId: EVENT, workoutId: 'rx-2', athleteId: 'a-rx1', heatId: 'heat-old', lane: 1 });
  assert.equal(legacy.status, 200, legacy.body.error);
});

test('atleta sem bateria: abre pela prova da categoria dele; categoria sem prova na etapa não aparece no quadro como elegível', async (t) => {
  quiet(t);
  seed();
  const board = await get({ view: 'board', eventId: EVENT });
  const stage = board.body.stages[0];
  assert.equal(stage.workoutByDivision[board.body.athletes.find((a) => a.id === 'a-sc2').divisionId], 'sc-1');
  const loose = await post({ action: 'open', eventId: EVENT, workoutId: stage.workoutByDivision.sc, athleteId: 'a-sc2' });
  assert.equal(loose.status, 200, loose.body.error);
  assert.equal(rows('scoresheets')[0].workout_id, 'sc-1');
});

test('marcar ausente numa bateria da prova do evento usa a raia do atleta na prova dele', async (t) => {
  quiet(t);
  seed();
  const absent = await post({ action: 'mark_absent', eventId: EVENT, workoutId: 'sc-1', athleteId: 'a-sc1', reason: 'Não compareceu à bateria' }, MANAGER);
  assert.equal(absent.status, 200, absent.body.error);
  const row = rows('scoresheets').find((sheet) => sheet.athlete_id === 'a-sc1');
  assert.equal(row.heat_id, 'heat-stage-1-1');
  assert.equal(row.lane, 2);

  const outsideHeat = await post({ action: 'mark_absent', eventId: EVENT, workoutId: 'rx-2', athleteId: 'a-rx2', reason: 'Não compareceu à bateria', heatId: 'heat-stage-1-1' }, MANAGER);
  assert.equal(outsideHeat.status, 400, 'a raia dele na bateria é da prova 1, não da prova pedida');
});
