import assert from 'node:assert/strict';
import test from 'node:test';

import { createFakeSupabase } from './support/fakeSupabase.mjs';
import { importServerModule, setActiveSupabaseClient } from './support/serverModuleHarness.mjs';

// Story 1.90: o telão com baterias da prova do evento (categorias misturadas), pelas rotas
// reais com o banco em memória: título da prova do evento, progresso de cada atleta pela
// estrutura da prova da categoria dele e o geral de cada categoria no intervalo.

process.env.SUPABASE_URL = 'http://supabase.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';
process.env.WODA_SESSION_SECRET = 'segredo-de-teste-telao-etapas';

let database = createFakeSupabase();
setActiveSupabaseClient({ from: (table) => database.client.from(table), rpc: (name, args) => database.client.rpc(name, args) });

const { GET: getTelao } = await importServerModule('app/api/telao/[token]/route.ts');
const { GET: getControl, POST: postControl } = await importServerModule('app/api/telao/control/route.ts');
const { POST: postSheets } = await importServerModule('app/api/sheets/route.ts');
const { createSessionToken } = await importServerModule('lib/serverSecurity.ts');
const { validateWorkoutStructure } = await importServerModule('lib/workoutStructure.ts');

const MANAGER = { id: 'mgr-etapas', name: 'Gestora', email: 'g@example.com', role: 'manager', service_valid_until: '2099-12-31' };
const JUDGE = { id: 'judge-etapas', name: 'Judge', email: 'j@example.com', role: 'judge', parent_manager_id: MANAGER.id };
const EVENT = 'ev-telao-etapas';

const segment = (id, round, name, reps) => ({ id, round, name, reps, unit: 'reps', load: null, note: '', required: true, mark: 'reps' });
const structure = (segments, reps) => validateWorkoutStructure({
  version: 2, format: 'for_time', totalReps: reps * segments, timeCapSeconds: 600,
  incomplete: { rule: 'penalty_per_rep', secondsPerRep: 1, base: 'time_cap' },
  tieBreak: { kind: 'split_time', at: 's1', order: 'asc' }, generator: null, customized: true,
  entry: { mode: 'both', marking: 'reps', publish: 'after_review' },
  segments: Array.from({ length: segments }, (_, i) => segment(`s${i + 1}`, 1, i % 2 ? 'Pull-up' : 'Thruster', reps)),
  maxLoad: null, scoreDisplay: null
}).structure;

const seed = () => {
  database = createFakeSupabase({
    users: [MANAGER, JUDGE],
    events: [{
      id: EVENT, name: 'Híbrido Games', date: '2026-11-01', location: 'Recife', organizer_id: MANAGER.id, event_type: 'functional_fitness', status: 'upcoming', logo_url: null,
      event_schedule: [
        {
          id: 'heat-stage-1-1', kind: 'heat', heatNumber: 1, date: '2026-11-01', time: '08:00', title: 'BATERIA 1 - Prova 1 · DT Speed',
          workoutId: 'rx-1', stageNumber: 1, stageTitle: 'Prova 1 · DT Speed', stageWorkouts: { rx: 'rx-1', sc: 'sc-1' },
          athleteIds: ['a-rx1', 'a-sc1', 'a-rx2'], laneWorkoutIds: ['rx-1', 'sc-1', 'rx-1']
        },
        {
          id: 'heat-stage-1-2', kind: 'heat', heatNumber: 2, date: '2026-11-01', time: '08:15', title: 'BATERIA 2 - Prova 1 · DT Speed',
          workoutId: 'sc-1', stageNumber: 1, stageTitle: 'Prova 1 · DT Speed', stageWorkouts: { rx: 'rx-1', sc: 'sc-1' },
          athleteIds: ['a-sc2'], laneWorkoutIds: ['sc-1']
        }
      ]
    }],
    event_judges: [{ event_id: EVENT, judge_user_id: JUDGE.id }],
    divisions: [{ id: 'rx', event_id: EVENT, name: 'RX Masculino', order_index: 1 }, { id: 'sc', event_id: EVENT, name: 'Scale Masculino', order_index: 2 }],
    athletes: [
      { id: 'a-rx1', name: 'Rafael Costa', box: 'Box Litoral', division_id: 'rx', is_team: false },
      { id: 'a-rx2', name: 'Bruno Alves', box: 'Arena Norte', division_id: 'rx', is_team: false },
      { id: 'a-sc1', name: 'André Souza', box: 'Iron Lab', division_id: 'sc', is_team: false },
      { id: 'a-sc2', name: 'Caio Mendes', box: 'Pulso Fit', division_id: 'sc', is_team: false }
    ],
    leaderboard_entries: ['a-rx1', 'a-rx2', 'a-sc1', 'a-sc2'].map((id) => ({ id: `le-${id}`, event_id: EVENT, division_id: id.startsWith('a-rx') ? 'rx' : 'sc', athlete_id: id })),
    workouts: [
      { id: 'rx-1', event_id: EVENT, name: 'DT Speed (RX)', code: 'WOD 1', order_index: 1, type: 'fortime', time_cap: '10:00', tie_breaker: 'Tempo', division_id: 'rx', structure: structure(2, 21) },
      { id: 'sc-1', event_id: EVENT, name: 'DT Speed (Scale)', code: 'WOD 1', order_index: 1, type: 'fortime', time_cap: '10:00', tie_breaker: 'Tempo', division_id: 'sc', structure: structure(3, 12) }
    ],
    scores: [],
    registrations: []
  });
};

const cookie = (user) => `woda_session=${createSessionToken({ id: user.id, name: user.name, email: user.email, role: user.role })}`;
const json = async (response) => ({ status: response.status, body: response.status === 304 ? null : await response.json() });
const control = async (user, body) => json(await postControl(new Request('http://localhost/api/telao/control', { method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie(user) }, body: JSON.stringify({ eventId: EVENT, ...body }) })));
const controlView = async (user) => json(await getControl(new Request(`http://localhost/api/telao/control?eventId=${EVENT}`, { headers: { cookie: cookie(user) } })));
const telao = async (token) => json(await getTelao(new Request(`http://localhost/api/telao/${token}`), { params: Promise.resolve({ token }) }));
const sheets = async (body) => json(await postSheets(new Request('http://localhost/api/sheets', { method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie(JUDGE) }, body: JSON.stringify(body) })));
const quiet = (t) => { t.mock.method(console, 'error', () => {}); t.mock.method(console, 'warn', () => {}); };

let counter = 0;
const e = (event) => ({ id: `t${(counter += 1)}`, event });
const open = async (athleteId, workoutId, lane, heatId = 'heat-stage-1-1') => (await sheets({ action: 'open', eventId: EVENT, workoutId, athleteId, heatId, lane })).body.sheet.id;
const append = async (sheetId, events) => {
  const fromSeq = database.rows('scoresheet_events').filter((row) => row.sheet_id === sheetId).length;
  const response = await sheets({ action: 'append', sheetId, fromSeq, events });
  assert.equal(response.status, 200, response.body?.error);
};

test('mesa do telão: a lista de baterias traz o nome da prova do evento', async (t) => {
  quiet(t);
  seed();
  const view = await controlView(MANAGER);
  assert.equal(view.status, 200, view.body.error);
  assert.deepEqual(view.body.heats.map((heat) => heat.label), [
    'Bateria 1 · Prova 1 · DT Speed · 08:00',
    'Bateria 2 · Prova 1 · DT Speed · 08:15'
  ]);
});

test('telão: bateria mista na chamada e ao vivo, com o progresso de cada atleta pela prova da categoria dele', async (t) => {
  quiet(t);
  seed();
  const { token } = (await control(MANAGER, { action: 'generate_link' })).body;

  const standby = await telao(token);
  assert.equal(standby.body.screen, 'standby');
  assert.deepEqual(standby.body.standby.upcoming.map((item) => [item.title, item.workoutName]), [
    ['Bateria 1', 'Prova 1 · DT Speed'],
    ['Bateria 2', 'Prova 1 · DT Speed']
  ]);
  assert.deepEqual(standby.body.standby.upcoming[0].divisionNames, ['RX Masculino', 'Scale Masculino']);

  const rx1 = await open('a-rx1', 'rx-1', 1);
  const sc1 = await open('a-sc1', 'sc-1', 2);
  const rx2 = await open('a-rx2', 'rx-1', 3);

  const call = await telao(token);
  assert.equal(call.body.screen, 'call');
  assert.equal(call.body.call.heat.heatCount, 2, 'as duas baterias da prova do evento');
  assert.equal(call.body.call.heat.workout.name, 'Prova 1 · DT Speed', 'versões diferentes: o nome da prova do evento');
  assert.deepEqual(call.body.call.heat.workout.lines, [], 'sem as linhas de uma só categoria');
  assert.deepEqual(call.body.call.lanes.map((lane) => [lane.lane, lane.name, lane.divisionName]), [
    [1, 'Rafael Costa', 'RX Masculino'], [2, 'André Souza', 'Scale Masculino'], [3, 'Bruno Alves', 'RX Masculino']
  ]);

  await append(rx1, [e({ t: 'fill', seg: 's1', n: 21, at: 70 })]);
  await append(sc1, [e({ t: 'fill', seg: 's1', n: 12, at: 60 })]);
  await append(rx2, [e({ t: 'fill', seg: 's1', n: 10, at: 50 })]);
  const live = await telao(token);
  assert.equal(live.body.screen, 'live');
  const byName = Object.fromEntries(live.body.live.entries.map((entry) => [entry.name, entry]));
  assert.equal(byName['Rafael Costa'].segments.length, 2, 'RX: estrutura de 2 movimentos');
  assert.equal(byName['André Souza'].segments.length, 3, 'Scale: estrutura de 3 movimentos');
  assert.equal(byName['Rafael Costa'].repsDone, 21);
  assert.equal(byName['André Souza'].repsDone, 12);
  assert.equal(byName['Bruno Alves'].repsDone, 10);
  assert.equal(byName['André Souza'].divisionName, 'Scale Masculino');
});

test('telão: o intervalo mostra o geral de cada categoria da bateria mista e "Depois da Prova 1"', async (t) => {
  quiet(t);
  seed();
  const { token } = (await control(MANAGER, { action: 'generate_link' })).body;
  const rx1 = await open('a-rx1', 'rx-1', 1);
  const sc1 = await open('a-sc1', 'sc-1', 2);
  const rx2 = await open('a-rx2', 'rx-1', 3);
  await append(rx1, [e({ t: 'fill', seg: 's1', n: 21, at: 60 }), e({ t: 'fill', seg: 's2', n: 21, at: 120 })]);
  await append(sc1, [e({ t: 'fill', seg: 's1', n: 12, at: 40 }), e({ t: 'fill', seg: 's2', n: 12, at: 80 }), e({ t: 'fill', seg: 's3', n: 12, at: 130 })]);
  await append(rx2, [e({ t: 'fill', seg: 's1', n: 21, at: 70 }), e({ t: 'fill', seg: 's2', n: 21, at: 140 })]);
  for (const id of [rx1, sc1, rx2]) {
    const expectedCount = database.rows('scoresheet_events').filter((row) => row.sheet_id === id).length;
    const submitted = await sheets({ action: 'submit', sheetId: id, expectedCount });
    assert.equal(submitted.status, 200, submitted.body?.error);
  }

  const interval = await telao(token);
  assert.equal(interval.body.screen, 'interval');
  assert.equal(interval.body.interval.afterTitle, 'Depois da Prova 1 · DT Speed');
  assert.deepEqual(interval.body.interval.boards.map((board) => board.divisionName), ['RX Masculino', 'Scale Masculino']);
  for (const board of interval.body.interval.boards) {
    assert.deepEqual(board.columns, [{ label: 'WOD 1', fresh: true }], `${board.divisionName}: a coluna recém-publicada é a prova da categoria`);
    assert.ok(board.rows.some((row) => row.fresh), `${board.divisionName}: os atletas da bateria aparecem destacados`);
  }
});
