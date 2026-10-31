import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createFakeSupabase } from './support/fakeSupabase.mjs';
import { createRaceClient } from './support/fakeRaceSupabase.mjs';
import { importServerModule, setActiveSupabaseClient } from './support/serverModuleHarness.mjs';

// Story 1.104 (F2 da súmula Fitness Race): escala de judges por estação, para
// o evento todo e por onda (D35). Regras puras (raceAssignments.ts) e a rota
// real com o banco em memória: save_assignments substitui o escopo (idempotente
// e atômico), recusas (judge fora do evento ou de outro gestor, estação fora do
// percurso, onda fora do cronograma, mais de 500 linhas), 403 para judge e
// para gestor de outro evento, clear_wave_assignments, view=assignments sem
// e-mail e com linha órfã, view=my_stations, open_attempt de judge fora da
// escala passando (D3), 429 por ação e 503 sem a migration. A função
// race_save_judge_assignments da migration é emulada aqui, na mesma ordem.

process.env.SUPABASE_URL = 'http://supabase.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';
process.env.WODA_SESSION_SECRET = 'segredo-de-teste-escala';

let database = createFakeSupabase();
const state = { missingRaceTables: false, missingAssignments: false, missingSaveFunction: false, failSaveFunction: false };
const raceClient = createRaceClient(() => database, state);
let assignmentSeq = 0;

/** Emulação de race_save_judge_assignments (migration 20261101120000_race_judge_assignments.sql). */
const emulateSave = (args) => {
  const event = database.rows('events').find((row) => row.id === args.p_event_id && row.event_type === 'fitness_racing');
  if (!event) return { data: null, error: { code: 'P0001', message: 'race_event_required' } };
  if (state.failSaveFunction) return { data: null, error: { code: '23514', message: 'violates check constraint' } };
  const rows = database.rows('race_judge_assignments');
  const inScope = (row) => row.event_id === args.p_event_id && (row.heat_id ?? null) === (args.p_heat_id ?? null);
  const wanted = (row) => args.p_rows.some((item) => item.judge_user_id === row.judge_user_id && item.station_key === row.station_key);
  const judges = new Set(database.rows('event_judges').filter((row) => row.event_id === args.p_event_id).map((row) => row.judge_user_id));
  const next = rows.filter((row) => !(inScope(row) && !wanted(row)) && !(row.event_id === args.p_event_id && !judges.has(row.judge_user_id)));
  let inserted = 0;
  for (const item of args.p_rows) {
    if (!judges.has(item.judge_user_id)) continue;
    if (next.some((row) => inScope(row) && row.judge_user_id === item.judge_user_id && row.station_key === item.station_key)) continue;
    next.push({ id: `rja_${(assignmentSeq += 1)}`, event_id: args.p_event_id, judge_user_id: item.judge_user_id, station_key: item.station_key, heat_id: args.p_heat_id ?? null, created_by_user_id: args.p_actor_id, created_at: new Date().toISOString() });
    inserted += 1;
  }
  rows.splice(0, rows.length, ...next);
  return { data: { inserted }, error: null };
};

/** Consulta à tabela que ainda não existe (migration não aplicada): 42P01 em qualquer encadeamento. */
const missingTable = (table) => {
  const result = { data: null, error: { code: '42P01', message: `relation "public.${table}" does not exist` } };
  const query = new Proxy({}, { get: (_, prop) => (prop === 'then' ? (resolve) => resolve(result) : () => query) });
  return query;
};

const client = {
  from: (table) => {
    if (table === 'race_judge_assignments' && state.missingAssignments) return missingTable(table);
    return raceClient.from(table);
  },
  rpc: async (name, args) => {
    if (name !== 'race_save_judge_assignments') return raceClient.rpc(name, args);
    database.rpcCalls.push({ name, args: structuredClone(args) });
    if (state.missingSaveFunction) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.race_save_judge_assignments' } };
    return emulateSave(args);
  }
};
setActiveSupabaseClient(client);

const { GET, POST } = await importServerModule('app/api/race-sheets/route.ts');
const { createSessionToken } = await importServerModule('lib/serverSecurity.ts');
const race = await importServerModule('lib/serverRaceSheets.ts');
const rules = await importServerModule('lib/raceAssignments.ts');

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const MANAGER = { id: 'mgr-escala', name: 'Gestora Escala', email: 'escala@example.com', role: 'manager', service_valid_until: '2099-12-31' };
const OTHER_MANAGER = { id: 'mgr-outra-escala', name: 'Outra Gestora', email: 'outra-escala@example.com', role: 'manager', service_valid_until: '2099-12-31' };
const OWNER = { id: 'owner-escala', name: 'Dona', email: 'dona-escala@example.com', role: 'owner' };
const OWNER_RL = { id: 'owner-escala-limite', name: 'Dona Limite', email: 'dona-limite@example.com', role: 'owner' };
const OWNER_RL2 = { id: 'owner-escala-limite-2', name: 'Dona Limite 2', email: 'dona-limite-2@example.com', role: 'owner' };
const J1 = { id: 'judge-esc-paula', name: 'Judge Paula', email: 'paula-esc@example.com', role: 'judge', parent_manager_id: MANAGER.id };
const J2 = { id: 'judge-esc-rafa', name: 'Judge Rafa', email: 'rafa-esc@example.com', role: 'judge', parent_manager_id: MANAGER.id };
const J3 = { id: 'judge-esc-caio', name: 'Judge Caio', email: 'caio-esc@example.com', role: 'judge', parent_manager_id: MANAGER.id };
const J_FREE = { id: 'judge-esc-livre', name: 'Judge Livre', email: 'livre-esc@example.com', role: 'judge', parent_manager_id: MANAGER.id };
const J_OTHER = { id: 'judge-esc-fora', name: 'Judge de Fora', email: 'fora-esc@example.com', role: 'judge', parent_manager_id: OTHER_MANAGER.id };

const EVENT = 'ev-escala';
const OTHER_EVENT = 'ev-escala-outra';
const run = (id, orderIndex) => ({ id, name: `Corrida ${orderIndex}`, type: 'run', orderIndex, distance: '1km' });
const COURSES = {
  'div-pro': [
    run('run-1', 0), { id: 'ski-erg', name: 'Ski Erg', type: 'station', orderIndex: 1, distance: '1000m' },
    run('run-2', 2), { id: 'sled-push', name: 'Sled Push', type: 'station', orderIndex: 3, distance: '50m' },
    run('run-3', 4), { id: 'wall-balls', name: 'Wall Balls', type: 'station', orderIndex: 5, reps: 100 }
  ],
  'div-duo': [
    run('run-1', 0), { id: 'sled-push-duo', name: 'Sled Push', type: 'station', orderIndex: 1, distance: '50m' },
    run('run-2', 2), { id: 'box-jump', name: 'Box Jump', type: 'station', orderIndex: 3, conferenceKind: 'generic' }
  ]
};
const ATHLETES = [['ath-ana', 'Ana', 'div-pro'], ['ath-bia', 'Bia', 'div-pro'], ['ath-dupla', 'Dupla', 'div-duo']];

const seed = () => {
  database = createFakeSupabase({
    users: [MANAGER, OTHER_MANAGER, OWNER, OWNER_RL, OWNER_RL2, J1, J2, J3, J_FREE, J_OTHER],
    events: [
      {
        id: EVENT, name: 'Race Escala', date: '2026-11-01', location: 'Recife', organizer_id: MANAGER.id, event_type: 'fitness_racing', status: 'upcoming', time_zone: 'America/Fortaleza',
        event_schedule: [
          { id: 'heat-1', kind: 'heat', date: '2026-11-01', time: '08:00', title: 'Onda 1', heatNumber: 1, athleteIds: ['ath-ana', 'ath-dupla'] },
          { id: 'heat-2', kind: 'heat', date: '2026-11-01', time: '08:20', title: 'Onda 2', heatNumber: 2, athleteIds: ['ath-bia'] },
          { id: 'item-x', kind: 'workout', date: '2026-11-01', time: '07:00', title: 'Aquecimento' }
        ]
      },
      { id: OTHER_EVENT, name: 'Race da Outra', date: '2026-11-03', location: 'Natal', organizer_id: OTHER_MANAGER.id, event_type: 'fitness_racing', status: 'upcoming', event_schedule: [] },
      { id: 'ev-ff-escala', name: 'FF', date: '2026-11-03', location: 'Natal', organizer_id: MANAGER.id, event_type: 'functional_fitness', status: 'upcoming', event_schedule: [] }
    ],
    event_judges: [
      { event_id: EVENT, judge_user_id: J1.id, created_at: '2026-10-01T10:00:00Z' },
      { event_id: EVENT, judge_user_id: J2.id, created_at: '2026-10-01T10:01:00Z' },
      { event_id: EVENT, judge_user_id: J3.id, created_at: '2026-10-01T10:02:00Z' },
      { event_id: OTHER_EVENT, judge_user_id: J_OTHER.id, created_at: '2026-10-01T10:00:00Z' }
    ],
    divisions: Object.entries(COURSES).map(([id, course]) => ({ id, event_id: EVENT, name: id === 'div-pro' ? 'Pro' : 'Dupla', type: id === 'div-duo' ? 'duo' : 'individual', category: 'female', course_layout: course })),
    athletes: ATHLETES.map(([id, name, division]) => ({ id, name, box: 'Box Norte', division_id: division })),
    race_judge_assignments: [],
    workouts: [], scores: [], registrations: []
  });
  Object.assign(state, { missingRaceTables: false, missingAssignments: false, missingSaveFunction: false, failSaveFunction: false });
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
const save = (user, heatId, assignments, eventId = EVENT) => post(user, { action: 'save_assignments', eventId, heatId, assignments });
const pair = (judge, stationKey) => ({ judgeUserId: judge.id, stationKey });
const stored = () => database.rows('race_judge_assignments')
  .map((row) => `${row.heat_id ?? '*'}|${row.judge_user_id}|${row.station_key}`)
  .sort();

// ---------------------------------------------------------------------------
// Regras puras (AC2, AC6)
// ---------------------------------------------------------------------------

test('resolveRaceWaveAssignments: onda sem linhas segue o padrão; com linhas usa só as dela; judge removido ignorado; ajustada sem judge volta ao padrão', () => {
  const rows = [
    { judgeUserId: 'j1', stationKey: 'ski-erg', heatId: null },
    { judgeUserId: 'j2', stationKey: 'sled-push', heatId: null },
    { judgeUserId: 'j2', stationKey: 'ski-erg', heatId: 'heat-2' },
    { judgeUserId: 'j9', stationKey: 'box-jump', heatId: 'heat-3' }
  ];
  assert.deepEqual(rules.resolveRaceWaveAssignments(rows, 'heat-1'), {
    source: 'default', pairs: [{ judgeUserId: 'j1', stationKey: 'ski-erg' }, { judgeUserId: 'j2', stationKey: 'sled-push' }]
  });
  assert.deepEqual(rules.resolveRaceWaveAssignments(rows, 'heat-2'), { source: 'wave', pairs: [{ judgeUserId: 'j2', stationKey: 'ski-erg' }] });
  assert.equal(rules.resolveRaceWaveAssignments(rows, null).source, 'default');
  // j9 saiu do evento: a onda 3 só tinha ele e volta ao padrão (limitação registrada).
  assert.equal(rules.resolveRaceWaveAssignments(rows, 'heat-3', ['j1', 'j2']).source, 'default');
  assert.equal(rules.resolveRaceWaveAssignments(rows, 'heat-3').source, 'wave');
  assert.deepEqual(rules.resolveRaceWaveAssignments(rows, 'heat-1', ['j2']).pairs, [{ judgeUserId: 'j2', stationKey: 'sled-push' }]);
  assert.equal(rules.raceWaveIsAdjusted(rows, 'heat-2'), true);
  assert.equal(rules.raceWaveIsAdjusted(rows, 'heat-1'), false);
  assert.equal(rules.describeRaceAssignmentScope(true), 'Ajustada');
  assert.equal(rules.describeRaceAssignmentScope(false), 'Segue o padrão');
});

test('parse, alternar, estações sem judge, "Minhas estações" (onda em andamento ou todas) e a divisão da lista', () => {
  assert.equal(rules.RACE_ASSIGNMENTS_MAX_ROWS, 500);
  assert.deepEqual(rules.parseRaceAssignmentPairs([pair(J1, 'ski-erg'), pair(J1, 'ski-erg'), { judgeUserId: ` ${J2.id} `, stationKey: 'sled-push' }]), {
    ok: true, pairs: [pair(J1, 'ski-erg'), pair(J2, 'sled-push')]
  });
  assert.equal(rules.parseRaceAssignmentPairs('x').ok, false);
  assert.equal(rules.parseRaceAssignmentPairs([{ judgeUserId: J1.id, stationKey: 'Ski Erg' }]).ok, false);
  assert.equal(rules.parseRaceAssignmentPairs(Array.from({ length: 501 }, () => pair(J1, 'ski-erg'))).ok, false);
  assert.equal(rules.parseRaceAssignmentPairs(Array.from({ length: 500 }, () => pair(J1, 'ski-erg'))).ok, true);
  const toggled = rules.toggleRaceAssignment([pair(J1, 'ski-erg')], pair(J2, 'ski-erg'));
  assert.deepEqual(toggled, [pair(J1, 'ski-erg'), pair(J2, 'ski-erg')]);
  assert.deepEqual(rules.toggleRaceAssignment(toggled, pair(J1, 'ski-erg')), [pair(J2, 'ski-erg')]);
  assert.equal(rules.sameRaceAssignmentPairs([pair(J1, 'a'), pair(J2, 'b')], [pair(J2, 'b'), pair(J1, 'a')]), true);
  assert.deepEqual(rules.raceStationsWithoutJudge(['ski-erg', 'sled-push', 'wall-balls'], [pair(J1, 'sled-push')]), ['ski-erg', 'wall-balls']);
  const waves = [
    { heatId: 'h1', inProgress: false, stationKeys: ['ski-erg'] },
    { heatId: 'h2', inProgress: true, stationKeys: ['sled-push'] }
  ];
  assert.deepEqual(rules.pickMyRaceStationKeys(waves), ['sled-push']);
  assert.deepEqual(rules.pickMyRaceStationKeys(waves.map((wave) => ({ ...wave, inProgress: false }))), ['ski-erg', 'sled-push']);
  assert.deepEqual(rules.pickMyRaceStationKeys([], ['box-jump']), ['box-jump'], 'sem onda no cronograma, o padrão');
  const stations = [{ key: 'ski-erg' }, { key: 'sled-push' }, { key: 'wall-balls' }];
  assert.deepEqual(rules.splitMyRaceStations(stations, ['wall-balls', 'ski-erg']), { mine: [{ key: 'ski-erg' }, { key: 'wall-balls' }], others: [{ key: 'sled-push' }] });
  assert.deepEqual(rules.splitMyRaceStations(stations, []), { mine: [], others: stations }, 'sem escala: tudo como na 1.102');
});

// ---------------------------------------------------------------------------
// save_assignments (AC3)
// ---------------------------------------------------------------------------

test('save_assignments substitui o conjunto do escopo, é idempotente e devolve a escala atualizada', async () => {
  seed();
  const first = await save(MANAGER, null, [pair(J1, 'ski-erg'), pair(J2, 'sled-push'), pair(J2, 'ski-erg')]);
  assert.equal(first.status, 200, first.body.error);
  assert.deepEqual(stored(), ['*|judge-esc-paula|ski-erg', '*|judge-esc-rafa|ski-erg', '*|judge-esc-rafa|sled-push']);
  assert.equal(first.body.defaultRows.length, 3);
  assert.equal(first.body.hasAssignments, true);
  const ids = database.rows('race_judge_assignments').map((row) => row.id).sort();

  const again = await save(MANAGER, null, [pair(J2, 'ski-erg'), pair(J2, 'sled-push'), pair(J1, 'ski-erg')]);
  assert.equal(again.status, 200);
  assert.deepEqual(database.rows('race_judge_assignments').map((row) => row.id).sort(), ids, 'reenviar o mesmo conjunto não regrava nada');

  // Substitui: J2 sai do SkiErg; a onda 2 ganha um conjunto próprio sem mexer no padrão.
  assert.equal((await save(MANAGER, null, [pair(J1, 'ski-erg'), pair(J2, 'sled-push')])).status, 200);
  const wave = await save(OWNER, 'heat-2', [pair(J3, 'ski-erg')]);
  assert.equal(wave.status, 200, wave.body.error);
  assert.deepEqual(stored(), ['*|judge-esc-paula|ski-erg', '*|judge-esc-rafa|sled-push', 'heat-2|judge-esc-caio|ski-erg']);
  const heat2 = wave.body.waves.find((item) => item.id === 'heat-2');
  assert.equal(heat2.adjusted, true);
  assert.deepEqual(heat2.effective.map((row) => row.judgeUserId), [J3.id]);
  const heat1 = wave.body.waves.find((item) => item.id === 'heat-1');
  assert.equal(heat1.adjusted, false);
  assert.deepEqual(heat1.effective.map((row) => `${row.judgeUserId}|${row.stationKey}`), [`${J1.id}|ski-erg`, `${J2.id}|sled-push`]);
  // Estação sem judge não impede gravar (D3): a lista vazia do padrão também grava.
  assert.equal((await save(MANAGER, null, [])).status, 200);
  assert.deepEqual(stored(), ['heat-2|judge-esc-caio|ski-erg']);
  assert.equal(database.rpcCalls.at(-1).args.p_heat_id, null);
  assert.equal(database.rpcCalls.at(-1).args.p_actor_id, MANAGER.id);
});

test('save_assignments recusa judge fora do evento ou de outro gestor, estação fora do percurso, onda fora do cronograma e mais de 500 linhas, sem gravar nada', async () => {
  seed();
  assert.equal((await save(MANAGER, null, [pair(J1, 'ski-erg')])).status, 200);
  const before = stored();
  const calls = database.rpcCalls.length;
  // Dados incoerentes: judge de outro gestor em event_judges deste evento.
  database.rows('event_judges').push({ event_id: EVENT, judge_user_id: J_OTHER.id, created_at: '2026-10-02T00:00:00Z' });

  const outsider = await save(MANAGER, null, [pair(J1, 'ski-erg'), pair(J_FREE, 'sled-push')]);
  assert.equal(outsider.status, 400);
  assert.match(outsider.body.error, /Judge não atribuído a este evento/);
  assert.equal((await save(MANAGER, null, [pair(J_OTHER, 'ski-erg')])).status, 400, 'judge de outro gestor');
  const station = await save(MANAGER, null, [pair(J1, 'ski-erg'), pair(J2, 'estacao-que-nao-existe')]);
  assert.equal(station.status, 400);
  assert.match(station.body.error, /não está no percurso/);
  const heat = await save(MANAGER, 'heat-9', [pair(J1, 'ski-erg')]);
  assert.equal(heat.status, 404);
  assert.match(heat.body.error, /Onda não encontrada no cronograma/);
  assert.equal((await save(MANAGER, 'item-x', [pair(J1, 'ski-erg')])).status, 404, 'item do cronograma que não é onda');
  const many = await save(MANAGER, null, Array.from({ length: 501 }, () => pair(J1, 'ski-erg')));
  assert.equal(many.status, 400);
  assert.match(many.body.error, /no máximo 500 linhas/);
  assert.equal((await save(MANAGER, null, [{ judgeUserId: J1.id, stationKey: 'SkiErg!' }])).status, 400);
  assert.equal((await post(MANAGER, { action: 'save_assignments', eventId: EVENT, heatId: null })).status, 400, 'sem a lista');

  assert.deepEqual(stored(), before);
  assert.equal(database.rpcCalls.length, calls, 'nenhuma recusa chega ao banco');
});

test('gravação atômica: a função que falha no meio não deixa o escopo pela metade; a linha órfã já gravada pode ficar', async () => {
  seed();
  assert.equal((await save(MANAGER, null, [pair(J1, 'ski-erg'), pair(J2, 'sled-push')])).status, 200);
  const before = stored();
  state.failSaveFunction = true;
  const failed = await save(MANAGER, null, [pair(J3, 'ski-erg')]);
  assert.equal(failed.status, 500);
  assert.deepEqual(stored(), before);
  state.failSaveFunction = false;
  // A estação renomeada no percurso deixa a linha órfã: o editor avisa e ela pode ser mantida até ser removida.
  database.rows('race_judge_assignments').push({ id: 'rja-orfa', event_id: EVENT, judge_user_id: J1.id, station_key: 'estacao-antiga', heat_id: null });
  const kept = await save(MANAGER, null, [pair(J1, 'ski-erg'), pair(J1, 'estacao-antiga')]);
  assert.equal(kept.status, 200, kept.body.error);
  assert.deepEqual(kept.body.defaultRows.find((row) => row.stationKey === 'estacao-antiga'), { judgeUserId: J1.id, stationKey: 'estacao-antiga', orphan: true });
  assert.equal((await save(MANAGER, null, [pair(J1, 'ski-erg')])).status, 200);
  assert.deepEqual(stored(), ['*|judge-esc-paula|ski-erg']);
});

test('acesso: judge recebe 403 (gravar, voltar ao padrão e ler a escala); gestor de outro evento recusado; owner pode; evento FF recusado', async () => {
  seed();
  assert.equal((await save(J1, null, [pair(J1, 'ski-erg')])).status, 403);
  assert.equal((await post(J1, { action: 'clear_wave_assignments', eventId: EVENT, heatId: 'heat-1' })).status, 403);
  assert.equal((await get(J1, { view: 'assignments', eventId: EVENT })).status, 403);
  assert.equal((await save(OTHER_MANAGER, null, [pair(J1, 'ski-erg')])).status, 403);
  assert.equal((await get(OTHER_MANAGER, { view: 'assignments', eventId: EVENT })).status, 403);
  assert.equal((await save(OWNER, null, [pair(J1, 'ski-erg')])).status, 200);
  assert.equal((await save(MANAGER, null, [], 'ev-ff-escala')).status, 400);
  // Gestor com acesso vencido não opera.
  database.rows('users').find((row) => row.id === MANAGER.id).service_valid_until = '2020-01-01';
  assert.equal((await save(MANAGER, null, [pair(J1, 'ski-erg')])).status, 403);
  assert.deepEqual(stored(), ['*|judge-esc-paula|ski-erg']);
});

test('clear_wave_assignments volta a onda ao padrão; onda obrigatória e do cronograma', async () => {
  seed();
  await save(MANAGER, null, [pair(J1, 'ski-erg')]);
  await save(MANAGER, 'heat-1', [pair(J2, 'ski-erg')]);
  await save(MANAGER, 'heat-2', [pair(J3, 'sled-push')]);
  const cleared = await post(MANAGER, { action: 'clear_wave_assignments', eventId: EVENT, heatId: 'heat-1' });
  assert.equal(cleared.status, 200, cleared.body.error);
  assert.deepEqual(cleared.body.cleared, { heatId: 'heat-1' });
  assert.deepEqual(stored(), ['*|judge-esc-paula|ski-erg', 'heat-2|judge-esc-caio|sled-push']);
  const heat1 = cleared.body.waves.find((item) => item.id === 'heat-1');
  assert.equal(heat1.adjusted, false);
  assert.deepEqual(heat1.effective.map((row) => row.judgeUserId), [J1.id]);
  assert.equal((await post(MANAGER, { action: 'clear_wave_assignments', eventId: EVENT })).status, 400);
  assert.equal((await post(MANAGER, { action: 'clear_wave_assignments', eventId: EVENT, heatId: 'heat-9' })).status, 404);
});

// ---------------------------------------------------------------------------
// Leituras (AC4, AC6, AC7)
// ---------------------------------------------------------------------------

test('view=assignments: estações, judges sem e-mail, ondas, linhas do padrão e das ondas, escala efetiva, órfã marcada, judge removido fora', async () => {
  seed();
  await save(MANAGER, null, [pair(J1, 'ski-erg'), pair(J2, 'sled-push')]);
  await save(MANAGER, 'heat-2', [pair(J3, 'wall-balls')]);
  database.rows('race_judge_assignments').push({ id: 'rja-orfa', event_id: EVENT, judge_user_id: J2.id, station_key: 'estacao-antiga', heat_id: null });
  // Linha de onda que saiu do cronograma: ignorada.
  database.rows('race_judge_assignments').push({ id: 'rja-onda-velha', event_id: EVENT, judge_user_id: J1.id, station_key: 'ski-erg', heat_id: 'heat-apagada' });

  const view = await get(MANAGER, { view: 'assignments', eventId: EVENT });
  assert.equal(view.status, 200, view.body.error);
  assert.doesNotMatch(JSON.stringify(view.body), /@example\.com|"email"/, 'sem e-mail');
  assert.deepEqual(view.body.judges, [{ id: J1.id, name: J1.name }, { id: J2.id, name: J2.name }, { id: J3.id, name: J3.name }]);
  assert.deepEqual(view.body.stations.map((item) => item.key), ['ski-erg', 'sled-push', 'box-jump', 'wall-balls'], 'ordem do percurso, como na lista do judge (1.102)');
  const sled = view.body.stations.find((item) => item.key === 'sled-push');
  assert.deepEqual(sled.categories, ['Pro', 'Dupla']);
  assert.equal(sled.kindLabel, 'Trenó');
  assert.equal(sled.meta, '4 trechos · 50m');
  assert.equal(view.body.stations.find((item) => item.key === 'wall-balls').closesTime, true);
  assert.deepEqual(view.body.waves.map((item) => [item.id, item.title, item.time, item.startedAt, item.adjusted]), [
    ['heat-1', 'Onda 1', '08:00', null, false],
    ['heat-2', 'Onda 2', '08:20', null, true]
  ]);
  assert.deepEqual(view.body.defaultRows.map((row) => [row.stationKey, row.orphan]), [['ski-erg', false], ['sled-push', false], ['estacao-antiga', true]]);
  assert.deepEqual(view.body.waves[1].rows, [{ judgeUserId: J3.id, stationKey: 'wall-balls', orphan: false }]);

  // Judge removido do evento (race_remove_judge da 1.95, inalterada): some na hora (AC7).
  database.rows('event_judges').splice(database.rows('event_judges').findIndex((row) => row.judge_user_id === J3.id), 1);
  const after = await get(MANAGER, { view: 'assignments', eventId: EVENT });
  assert.equal(after.body.judges.some((judge) => judge.id === J3.id), false);
  const heat2 = after.body.waves.find((item) => item.id === 'heat-2');
  assert.equal(heat2.adjusted, false, 'a onda só com o judge removido volta ao padrão');
  assert.deepEqual(heat2.rows, []);
  assert.deepEqual(heat2.effective.map((row) => row.judgeUserId), [J1.id, J2.id, J2.id]);
  // A próxima gravação apaga as linhas dele (AC2).
  await save(MANAGER, 'heat-1', [pair(J1, 'box-jump')]);
  assert.equal(database.rows('race_judge_assignments').some((row) => row.judge_user_id === J3.id), false);
});

test('percurso da escala: snapshot travado do regulamento quando existe; antes da primeira largada, divisions.course_layout', async () => {
  seed();
  const ruleset = await race.ensureRaceRuleset(client, EVENT);
  // Mudança no percurso depois da criação do regulamento ainda não travado: vale o percurso atual.
  database.rows('divisions').find((row) => row.id === 'div-duo').course_layout = [run('run-1', 0), { id: 'burpee', name: 'Burpee Broad Jump', type: 'station', orderIndex: 1 }];
  let view = await get(MANAGER, { view: 'assignments', eventId: EVENT });
  assert.ok(view.body.stations.some((item) => item.key === 'burpee-broad-jump'));
  assert.equal(view.body.stations.some((item) => item.key === 'box-jump'), false);
  // Travado na largada: vale o snapshot, mesmo que o percurso mude de novo.
  database.rows('race_rulesets').find((row) => row.id === ruleset.id).locked_at = new Date().toISOString();
  database.rows('divisions').find((row) => row.id === 'div-duo').course_layout = [run('run-1', 0), { id: 'row', name: 'Row', type: 'station', orderIndex: 1 }];
  view = await get(MANAGER, { view: 'assignments', eventId: EVENT });
  assert.ok(view.body.stations.some((item) => item.key === 'box-jump'));
  assert.equal(view.body.stations.some((item) => item.key === 'row'), false);
});

const startHeat = async (heatId, athleteIds) => {
  const ruleset = await race.ensureRaceRuleset(client, EVENT);
  const startedAt = new Date(Date.now() - 600_000).toISOString();
  database.rows('race_heat_marks').push({ event_id: EVENT, heat_id: heatId, started_at: startedAt, started_by_user_id: MANAGER.id, started_by_name: MANAGER.name });
  for (const athleteId of athleteIds) {
    database.rows('race_runs').push({
      id: `run-${athleteId}`, event_id: EVENT, division_id: ATHLETES.find(([id]) => id === athleteId)[2], athlete_id: athleteId, heat_id: heatId, ruleset_id: ruleset.id,
      status: 'racing', started_at: startedAt, finish_at: null, gross_seconds: null, penalty_seconds: 0, official_seconds: null,
      time_source: null, created_at: startedAt, updated_at: startedAt
    });
  }
};

test('view=my_stations: escala efetiva de quem pede por onda; onda em andamento primeiro; sem escala, vazio', async () => {
  seed();
  let mine = await get(J1, { view: 'my_stations', eventId: EVENT });
  assert.equal(mine.status, 200, mine.body.error);
  assert.equal(mine.body.hasAssignments, false);
  assert.deepEqual(mine.body.myStationKeys, []);

  await save(MANAGER, null, [pair(J1, 'ski-erg'), pair(J2, 'sled-push')]);
  await save(MANAGER, 'heat-2', [pair(J1, 'wall-balls')]);
  mine = await get(J1, { view: 'my_stations', eventId: EVENT });
  assert.deepEqual(mine.body.waves.map((wave) => [wave.heatId, wave.inProgress, wave.stationKeys]), [['heat-1', false, ['ski-erg']], ['heat-2', false, ['wall-balls']]]);
  assert.deepEqual(mine.body.myStationKeys, ['ski-erg', 'wall-balls'], 'sem onda em andamento: todas');
  await startHeat('heat-2', ['ath-bia']);
  mine = await get(J1, { view: 'my_stations', eventId: EVENT });
  assert.deepEqual(mine.body.myStationKeys, ['wall-balls'], 'a da onda em andamento');
  assert.doesNotMatch(JSON.stringify(mine.body), /@example\.com/);
  const other = await get(J3, { view: 'my_stations', eventId: EVENT });
  assert.equal(other.body.hasAssignments, true);
  assert.deepEqual(other.body.myStationKeys, [], 'judge fora da escala: lista como na 1.102');
  assert.equal((await get(J_FREE, { view: 'my_stations', eventId: EVENT })).status, 403, 'judge não atribuído ao evento');
});

test('D3: a escala não bloqueia open_attempt; judge fora da escala abre a estação em que estiver', async () => {
  seed();
  await save(MANAGER, null, [pair(J1, 'ski-erg')]);
  await startHeat('heat-1', ['ath-ana']);
  const opened = await post(J3, { action: 'open_attempt', eventId: EVENT, athleteId: 'ath-ana', stationId: 'ski-erg' });
  assert.equal(opened.status, 200, opened.body.error);
  assert.equal(opened.body.attempt.judgeUserId, J3.id);
  // Com a tabela da escala indisponível, o open_attempt segue funcionando (não lê a escala).
  state.missingAssignments = true;
  const second = await post(J2, { action: 'open_attempt', eventId: EVENT, athleteId: 'ath-ana', stationId: 'sled-push' });
  assert.equal(second.status, 200, second.body.error);
});

// ---------------------------------------------------------------------------
// Limites e banco sem a migration
// ---------------------------------------------------------------------------

test('429 por ação: save_assignments acima de 60 e clear_wave_assignments acima de 30 por minuto', async () => {
  seed();
  for (let index = 0; index < 60; index += 1) assert.notEqual((await post(OWNER_RL, { action: 'save_assignments', eventId: 'ev-inexistente', assignments: [] })).status, 429);
  assert.equal((await post(OWNER_RL, { action: 'save_assignments', eventId: EVENT, assignments: [] })).status, 429);
  // Limite próprio por ação: a outra ação do mesmo usuário ainda passa.
  assert.notEqual((await post(OWNER_RL, { action: 'clear_wave_assignments', eventId: EVENT, heatId: 'heat-1' })).status, 429);
  for (let index = 0; index < 30; index += 1) assert.notEqual((await post(OWNER_RL2, { action: 'clear_wave_assignments', eventId: 'ev-inexistente', heatId: 'heat-1' })).status, 429);
  assert.equal((await post(OWNER_RL2, { action: 'clear_wave_assignments', eventId: EVENT, heatId: 'heat-1' })).status, 429);
});

test('503 sem a migration: leitura, gravação e "voltar ao padrão" pedem a migration da escala', async () => {
  seed();
  state.missingAssignments = true;
  for (const response of [
    await get(MANAGER, { view: 'assignments', eventId: EVENT }),
    await get(J1, { view: 'my_stations', eventId: EVENT }),
    await save(MANAGER, null, [pair(J1, 'ski-erg')]),
    await post(MANAGER, { action: 'clear_wave_assignments', eventId: EVENT, heatId: 'heat-1' })
  ]) {
    assert.equal(response.status, 503);
    assert.match(response.body.error, /20261101120000_race_judge_assignments\.sql/);
  }
  state.missingAssignments = false;
  state.missingSaveFunction = true;
  const fn = await save(MANAGER, null, [pair(J1, 'ski-erg')]);
  assert.equal(fn.status, 503);
  assert.match(fn.body.error, /20261101120000_race_judge_assignments\.sql/);
});

// ---------------------------------------------------------------------------
// Estáticos: painel, lista do judge e regressão (AC5, AC6, AC7, AC8)
// ---------------------------------------------------------------------------

test('painel: seção em RaceSheetPanel, matriz com alvo de 44 px, selos, ajustar e voltar ao padrão; admin/page.tsx sem edição', () => {
  const container = read('../src/components/admin/RaceSheetPanel.tsx');
  assert.match(container, /import \{ RaceAssignmentsPanel \} from '@\/components\/admin\/RaceAssignmentsPanel';/);
  assert.match(container, /<RaceAssignmentsPanel event=\{event\} \/>/);
  const panel = read('../src/components/admin/RaceAssignmentsPanel.tsx');
  assert.match(panel, /Escala de judges/);
  assert.match(panel, /h-11 min-h-11 w-11 min-w-11/, 'célula da matriz com 44 px');
  assert.match(panel, /aria-pressed=\{on\}/);
  assert.match(panel, /describeRaceAssignmentScope\(item\.adjusted\)/);
  assert.match(panel, /Padrão do evento/);
  assert.match(panel, /Ajustar esta onda/);
  assert.match(panel, /Voltar ao padrão/);
  assert.match(panel, /action: 'save_assignments'/);
  assert.match(panel, /action: 'clear_wave_assignments'/);
  assert.match(panel, /view=assignments/);
  assert.match(panel, /Sem judge escalado/);
  assert.match(panel, /Remover linha/);
  assert.doesNotMatch(panel.replace(/^\/\/[^\n]*$/gm, ''), /\braia|head judge|gerar escala/i, 'fora do escopo (D38)');
  assert.doesNotMatch(read('../src/app/admin/page.tsx'), /RaceAssignmentsPanel|save_assignments|race_judge_assignments/);
});

test('lista do judge: "Minhas estações" primeiro pela view=my_stations, sem bloquear as outras estações', () => {
  const list = read('../src/components/race/StationListScreen.tsx');
  assert.match(list, /view=my_stations/);
  assert.match(list, /splitMyRaceStations\(stations, myKeys\)/);
  assert.match(list, /Minhas estações/);
  assert.match(list, /Outras estações/);
});

test('regressão: open_attempt e as funções race_* da 1.95 não leem a escala; Functional Fitness intocado; sem DQ', () => {
  const route = read('../src/app/api/race-sheets/route.ts');
  const openBlock = route.slice(route.indexOf("if (action === 'open_attempt')"), route.indexOf("if (action === 'start_heat')"));
  assert.doesNotMatch(openBlock, /assignment/i);
  assert.doesNotMatch(read('../src/lib/serverRaceSheets.ts'), /race_judge_assignments|serverRaceAssignments/);
  const service = read('../src/lib/serverRaceAssignments.ts');
  assert.doesNotMatch(service, /race_assign_judge|race_remove_judge|race_create_and_assign_judge/);
  assert.doesNotMatch(service + read('../src/lib/raceAssignments.ts'), /\bdq\b|disqualif/i);
  assert.match(route, /save_assignments: 60/);
  assert.match(route, /clear_wave_assignments: 30/);
  for (const file of ['../src/app/api/sheets/route.ts', '../src/lib/serverSheetAccess.ts', '../src/lib/serverScoresheets.ts', '../src/app/api/admin/persistence/route.ts']) {
    assert.doesNotMatch(read(file), /race_judge_assignments|serverRaceAssignments|raceAssignments/, file);
  }
});
