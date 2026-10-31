import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createFakeSupabase } from './support/fakeSupabase.mjs';
import { createRaceClient } from './support/fakeRaceSupabase.mjs';
import { withRaceStartHeat } from './support/fakeRaceStartHeat.mjs';
import { importServerModule, setActiveSupabaseClient } from './support/serverModuleHarness.mjs';

// Story 1.96 (F1 da súmula Fitness Race): tela de largada da onda. Ação
// start_heat e visão waves pela rota real com o banco em memória (a função
// race_start_heat emulada em fakeRaceStartHeat.mjs), regras puras das ondas e
// da fila local, renderização da lista, migration da largada e estático das
// telas, do atalho e da faixa do CourtShell (D26).

process.env.SUPABASE_URL = 'http://supabase.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';
process.env.WODA_SESSION_SECRET = 'segredo-de-teste-largada';

let database = createFakeSupabase();
const state = { missingRaceTables: false, beforeUpdate: {}, beforeCount: {}, missingStartHeat: false };
const client = withRaceStartHeat(createRaceClient(() => database, state), () => database, state);
setActiveSupabaseClient(client);

const { GET, POST } = await importServerModule('app/api/race-sheets/route.ts');
const { createSessionToken } = await importServerModule('lib/serverSecurity.ts');
const waves = await importServerModule('lib/raceWaves.ts');
const queue = await importServerModule('lib/raceStartQueue.ts');
const { RaceWaveList } = await importServerModule('components/race/RaceWaveList.tsx');

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const MANAGER = { id: 'mgr-largada', name: 'Gestora Largada', email: 'largada@example.com', role: 'manager', service_valid_until: '2099-12-31' };
const OTHER_MANAGER = { id: 'mgr-outra-largada', name: 'Outra', email: 'outra-largada@example.com', role: 'manager', service_valid_until: '2099-12-31' };
const OWNER = { id: 'owner-largada', name: 'Owner', email: 'owner-largada@example.com', role: 'owner' };
const JUDGE = { id: 'judge-largada', name: 'Judge Lia', email: 'lia@example.com', role: 'judge', parent_manager_id: MANAGER.id };
const JUDGE_2 = { id: 'judge-largada-2', name: 'Judge Teo', email: 'teo@example.com', role: 'judge', parent_manager_id: MANAGER.id };
const JUDGE_OTHER = { id: 'judge-de-outra', name: 'Judge de Outra', email: 'deoutra@example.com', role: 'judge', parent_manager_id: OTHER_MANAGER.id };
const ATHLETE_USER = { id: 'atleta-largada', name: 'Atleta', email: 'atleta-largada@example.com', role: 'athlete' };

const EVENT = 'ev-largada';
const COURSE = [
  { id: 'run-1', name: 'Corrida 1', type: 'run', orderIndex: 0, distance: '1km' },
  { id: 'wall-balls', name: 'Wall Balls', type: 'station', orderIndex: 1, reps: 100 }
];
const SCHEDULE = [
  { id: 'heat-2', kind: 'heat', date: '2026-11-01', time: '08:20', title: 'Onda 2 · Men', description: '', heatNumber: 2, athleteIds: ['ath-bia', '', 'ath-caio'] },
  { id: 'heat-1', kind: 'heat', date: '2026-11-01', time: '08:00', title: '', description: '', heatNumber: 1, athleteIds: ['ath-ana', '', 'ath-ana'] },
  { id: 'heat-vazia', kind: 'heat', date: '2026-11-01', time: '09:00', title: 'Onda vazia', description: '', heatNumber: 3, athleteIds: ['', ''] },
  { id: 'heat-sem-percurso', kind: 'heat', date: '2026-11-01', time: '09:20', title: 'Pro', description: '', heatNumber: 4, athleteIds: ['ath-pro'] },
  { id: 'heat-fora', kind: 'heat', date: '2026-11-01', time: '09:40', title: 'Fora', description: '', heatNumber: 5, athleteIds: ['ath-de-outro-evento'] },
  { id: 'briefing', kind: 'briefing', date: '2026-11-01', time: '07:00', title: 'Briefing', description: '', athleteIds: ['ath-ana'] }
];

const seed = () => {
  database = createFakeSupabase({
    users: [MANAGER, OTHER_MANAGER, OWNER, JUDGE, JUDGE_2, JUDGE_OTHER],
    events: [
      { id: EVENT, name: 'Race Fortaleza', date: '2026-11-01', organizer_id: MANAGER.id, event_type: 'fitness_racing', status: 'upcoming', event_schedule: SCHEDULE, time_zone: 'America/Fortaleza' },
      { id: 'ev-ff-largada', name: 'Games FF', date: '2026-11-02', organizer_id: MANAGER.id, event_type: 'functional_fitness', status: 'upcoming', event_schedule: SCHEDULE },
      { id: 'ev-outra-largada', name: 'Race da Outra', date: '2026-11-03', organizer_id: OTHER_MANAGER.id, event_type: 'fitness_racing', status: 'upcoming', event_schedule: [] }
    ],
    event_judges: [
      { event_id: EVENT, judge_user_id: JUDGE.id },
      { event_id: EVENT, judge_user_id: JUDGE_2.id },
      { event_id: 'ev-outra-largada', judge_user_id: JUDGE_OTHER.id }
    ],
    divisions: [
      { id: 'div-women', event_id: EVENT, name: 'Women', course_layout: COURSE },
      { id: 'div-men', event_id: EVENT, name: 'Men', course_layout: COURSE },
      { id: 'div-pro', event_id: EVENT, name: 'Men Pro', course_layout: [] },
      { id: 'div-outra', event_id: 'ev-outra-largada', name: 'Open', course_layout: COURSE }
    ],
    athletes: [
      { id: 'ath-ana', name: 'Ana Souza', box: 'Litoral', division_id: 'div-women' },
      { id: 'ath-bia', name: 'Bia Lima', box: 'Tropa', division_id: 'div-women' },
      { id: 'ath-caio', name: 'Caio Reis', box: 'Tropa', division_id: 'div-men' },
      { id: 'ath-pro', name: 'Pedro Pro', box: 'Elite', division_id: 'div-pro' },
      { id: 'ath-de-outro-evento', name: 'Fora', box: 'X', division_id: 'div-outra' }
    ],
    registrations: []
  });
  state.missingStartHeat = false;
};

const cookie = (user) => `woda_session=${createSessionToken({ id: user.id, name: user.name, email: user.email, role: user.role })}`;
const get = async (user, query) => {
  const response = await GET(new Request(`http://localhost/api/race-sheets?${new URLSearchParams(query)}`, { headers: user ? { cookie: cookie(user) } : {} }));
  return { status: response.status, body: await response.json() };
};
const post = async (user, body) => {
  const response = await POST(new Request('http://localhost/api/race-sheets', {
    method: 'POST', headers: { 'content-type': 'application/json', ...(user ? { cookie: cookie(user) } : {}) }, body: JSON.stringify(body)
  }));
  return { status: response.status, body: await response.json() };
};
const start = (user, heatId, extra = {}) => post(user, { action: 'start_heat', eventId: EVENT, heatId, clientNow: Date.now(), ...extra });
const quiet = (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});
};
const rows = (table) => structuredClone(database.rows(table));

// ---------------------------------------------------------------------------
// start_heat (AC2, AC3, AC4, AC6)
// ---------------------------------------------------------------------------

test('start_heat: grava a marca, trava o regulamento com o snapshot e cria corridas racing com started_at = largada', async () => {
  seed();
  const clientNow = Date.now();
  const deviceAt = clientNow - 4000; // toque guardado no aparelho 4 s antes do envio
  const response = await start(JUDGE, 'heat-2', { deviceAt, clientNow });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.runsCreated, 2);
  assert.equal(response.body.alreadyRacing, 0);

  const [mark] = rows('race_heat_marks');
  assert.equal(mark.heat_id, 'heat-2');
  assert.equal(mark.started_by_user_id, JUDGE.id);
  assert.equal(mark.started_by_name, JUDGE.name);
  assert.equal(mark.device_at, new Date(deviceAt).toISOString());
  assert.ok(Math.abs(Date.parse(mark.started_at) - deviceAt) < 1000, 'horário do toque, não o da chegada');
  assert.equal(response.body.startedAt, mark.started_at);

  const runs = rows('race_runs');
  assert.deepEqual(runs.map((run) => run.athlete_id).sort(), ['ath-bia', 'ath-caio'], 'posição vazia ignorada');
  for (const run of runs) {
    assert.equal(run.status, 'racing');
    assert.equal(run.heat_id, 'heat-2');
    assert.equal(run.started_at, mark.started_at);
  }
  assert.deepEqual(runs.map((run) => run.division_id).sort(), ['div-men', 'div-women']);

  const [ruleset] = rows('race_rulesets');
  assert.ok(ruleset.locked_at, 'regulamento travado na largada');
  assert.equal(runs[0].ruleset_id, ruleset.id);
  assert.deepEqual(ruleset.course['div-women'].map((stage) => stage.id), ['run-1', 'wall-balls']);
  const call = database.rpcCalls.find((item) => item.name === 'race_start_heat');
  assert.ok(call.args.p_course, 'primeiro uso manda o snapshot de agora');
});

test('start_heat: o desvio do relógio do aparelho é corrigido no envio', async () => {
  seed();
  const clientNow = Date.now() - 60_000; // aparelho 1 min atrasado
  const response = await start(JUDGE, 'heat-1', { deviceAt: clientNow - 3000, clientNow });
  assert.equal(response.status, 200);
  const startedAt = Date.parse(response.body.startedAt);
  assert.ok(Math.abs(startedAt - (Date.now() - 3000)) < 1500, 'horário do servidor de 3 s atrás');
  assert.ok(startedAt <= Date.now());
});

test('start_heat: segunda largada (mesmo ou outro aparelho) responde 409 com o horário e não cria nada', async () => {
  seed();
  const first = await start(JUDGE, 'heat-2');
  assert.equal(first.status, 200);
  const before = database.snapshot();
  for (const user of [JUDGE, JUDGE_2, MANAGER]) {
    const again = await start(user, 'heat-2');
    assert.equal(again.status, 409);
    assert.equal(again.body.startedAt, first.body.startedAt);
    assert.match(again.body.error, /^Largada já registrada às \d{2}:\d{2}:\d{2}\.$/);
  }
  assert.deepEqual(database.snapshot(), before);
});

test('start_heat: corrida concorrente que chega na função já com a marca gravada devolve 409', async () => {
  seed();
  // Outro aparelho gravou entre a leitura e a função (a marca não existia na conferência).
  database.onceBeforeInsert('race_rulesets', (db) => {
    db.rows('race_heat_marks').push({ event_id: EVENT, heat_id: 'heat-1', started_at: '2026-11-01T11:00:07.000Z', started_by_name: 'Outro' });
  });
  const response = await start(JUDGE, 'heat-1');
  assert.equal(response.status, 409);
  assert.equal(response.body.startedAt, '2026-11-01T11:00:07.000Z');
  assert.match(response.body.error, /08:00:07/, 'no fuso do evento');
  assert.equal(rows('race_runs').length, 0);
});

test('start_heat: atleta com corrida ativa no evento não é duplicado; regulamento travado mantém o snapshot dele', async () => {
  seed();
  assert.equal((await start(JUDGE, 'heat-1')).status, 200);
  // Ana passa a estar também na onda 2 (organizador remontou o cronograma).
  database.rows('events')[0].event_schedule = SCHEDULE.map((item) => (item.id === 'heat-2' ? { ...item, athleteIds: ['ath-bia', 'ath-ana'] } : item));
  database.rows('divisions')[0].course_layout = [{ id: 'nova', name: 'Nova', type: 'run', orderIndex: 0 }];
  const second = await start(JUDGE, 'heat-2');
  assert.equal(second.status, 200);
  assert.equal(second.body.runsCreated, 1);
  assert.equal(second.body.alreadyRacing, 1);
  assert.equal(rows('race_runs').filter((run) => run.athlete_id === 'ath-ana').length, 1);
  assert.equal(rows('race_runs').find((run) => run.athlete_id === 'ath-ana').heat_id, 'heat-1');
  const call = database.rpcCalls.filter((item) => item.name === 'race_start_heat').at(-1);
  assert.equal(call.args.p_course, null, 'regulamento travado não recebe snapshot novo');
  assert.deepEqual(rows('race_rulesets')[0].course['div-women'].map((stage) => stage.id), ['run-1', 'wall-balls']);
});

test('start_heat: onda vazia, onda de outro evento e evento sem percurso respondem 400; onda inexistente 404', async () => {
  seed();
  const empty = await start(JUDGE, 'heat-vazia');
  assert.equal(empty.status, 400);
  assert.match(empty.body.error, /não tem atletas/);
  assert.equal((await start(JUDGE, 'heat-fora')).status, 400, 'atleta de outro evento não conta');
  const noCourse = await start(JUDGE, 'heat-sem-percurso');
  assert.equal(noCourse.status, 400);
  assert.match(noCourse.body.error, /percurso da categoria Men Pro/);
  assert.equal((await start(JUDGE, 'nao-existe')).status, 404);
  assert.equal((await start(JUDGE, 'briefing')).status, 404, 'só itens kind heat');
  assert.equal((await start(JUDGE, '')).status, 400);
  assert.equal((await post(JUDGE, { action: 'start_heat', eventId: EVENT, heatId: 'heat-1' })).status, 400, 'sem o horário do aparelho');
  assert.equal((await start(JUDGE, 'heat-1', { deviceAt: Date.now() + 60_000 })).status, 400, 'toque no futuro');
  assert.equal(rows('race_heat_marks').length, 0);
  assert.equal(rows('race_runs').length, 0);
});

test('start_heat: judge de outro evento 403, atleta 403, sem sessão 401, evento Functional Fitness 400; gestor dono e owner largam', async (t) => {
  quiet(t);
  seed();
  assert.equal((await start(JUDGE_OTHER, 'heat-1')).status, 403);
  assert.equal((await start(OTHER_MANAGER, 'heat-1')).status, 403);
  assert.equal((await start(ATHLETE_USER, 'heat-1')).status, 403);
  assert.equal((await start(null, 'heat-1')).status, 401);
  assert.equal((await post(MANAGER, { action: 'start_heat', eventId: 'ev-ff-largada', heatId: 'heat-1', clientNow: Date.now() })).status, 400);
  assert.equal(rows('race_heat_marks').length, 0);
  assert.equal((await start(MANAGER, 'heat-1')).status, 200);
  assert.equal((await start(OWNER, 'heat-2')).status, 200);
});

test('start_heat: banco sem a migration da largada responde 503 pedindo a migration', async (t) => {
  quiet(t);
  seed();
  state.missingStartHeat = true;
  const response = await start(JUDGE, 'heat-1');
  assert.equal(response.status, 503);
  assert.match(response.body.error, /20261030140000_race_start_heat\.sql/);
});

test('rota: start_heat tem limite próprio no mapa LIMITS', () => {
  assert.match(read('../src/app/api/race-sheets/route.ts'), /\bstart_heat: 30\b/);
});

// ---------------------------------------------------------------------------
// Visão das ondas (AC1, AC8)
// ---------------------------------------------------------------------------

test('waves: só ondas kind heat com atletas do evento, em ordem, com categorias, atletas e estado da largada', async () => {
  seed();
  const before = await get(JUDGE, { view: 'waves', eventId: EVENT });
  assert.equal(before.status, 200);
  assert.equal(before.body.event.timeZone, 'America/Fortaleza');
  assert.deepEqual(before.body.waves.map((wave) => wave.id), ['heat-1', 'heat-2', 'heat-sem-percurso']);
  const [first, second] = before.body.waves;
  assert.equal(first.title, 'Onda 1', 'sem título usa o número');
  assert.deepEqual(first.athletes.map((athlete) => athlete.id), ['ath-ana'], 'sem vazio nem repetido');
  assert.deepEqual(second.categories, ['Women', 'Men']);
  assert.deepEqual(Object.keys(second.athletes[0]).sort(), ['box', 'divisionId', 'divisionName', 'id', 'name'], 'sem e-mail');
  assert.equal(second.startedAt, null);

  await start(JUDGE, 'heat-2');
  const after = await get(MANAGER, { view: 'waves', eventId: EVENT });
  const started = after.body.waves.find((wave) => wave.id === 'heat-2');
  assert.ok(started.startedAt);
  assert.equal(started.startedByName, JUDGE.name);
  assert.equal(started.runsCount, 2);
  assert.equal((await get(JUDGE_OTHER, { view: 'waves', eventId: EVENT })).status, 403);
  assert.equal((await get(MANAGER, { view: 'waves', eventId: 'ev-ff-largada' })).status, 400);
});

// ---------------------------------------------------------------------------
// Regras puras (raceWaves.ts, raceStartQueue.ts)
// ---------------------------------------------------------------------------

test('raceWaves: posições vazias ignoradas, ordem por data e horário, próxima onda e textos do estado', () => {
  assert.deepEqual(waves.heatAthleteIds({ athleteIds: ['a', '', ' ', 'b', 'a', null] }), ['a', 'b']);
  assert.deepEqual(waves.heatAthleteIds({}), []);
  assert.equal(waves.readRaceHeatItems(JSON.stringify(SCHEDULE)).length, 5, 'aceita o cronograma como texto');
  assert.equal(waves.findRaceHeatItem(SCHEDULE, 'briefing'), null);
  const athletes = new Map([['ath-ana', { id: 'ath-ana', name: 'Ana', box: '', divisionId: 'd', divisionName: 'Women' }]]);
  const list = waves.buildRaceWaves([
    { id: 'b', kind: 'heat', date: '2026-11-01', time: '09:00', title: 'B', athleteIds: ['ath-ana'] },
    { id: 'a', kind: 'heat', date: '2026-11-01', time: '08:00', title: 'A', athleteIds: ['ath-ana'] },
    { id: 'c', kind: 'heat', date: '2026-11-01', time: '07:00', title: 'C', athleteIds: ['ninguem'] }
  ], athletes, new Map([['a', { startedAt: '2026-11-01T11:00:07.000Z' }]]));
  assert.deepEqual(list.map((wave) => wave.id), ['a', 'b']);
  assert.equal(waves.nextRaceWaveId(list), 'b');
  assert.equal(waves.nextRaceWaveId([{ id: 'x', startedAt: 'y' }]), null);
  assert.equal(waves.describeWaveStart(null), 'Aguardando largada');
  assert.equal(waves.describeWaveStart('2026-11-01T11:00:07.000Z', 'America/Fortaleza'), 'Largou às 08:00:07');
  assert.equal(waves.formatRaceClock('2026-11-01T11:00:07.000Z', 'Zona/Invalida'), '08:00:07', 'fuso inválido cai no padrão');
  assert.equal(waves.formatRaceClock('nao-e-data'), '');
});

test('fila local: guarda o horário do toque, uma por onda, e sobrevive a recarregar a tela', () => {
  const store = new Map();
  globalThis.window = { localStorage: { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: (key) => store.delete(key) } };
  try {
    let fila = queue.enqueueHeatStart([], 'heat-1', 1000);
    fila = queue.enqueueHeatStart(fila, 'heat-1', 5000);
    assert.deepEqual(fila, [{ heatId: 'heat-1', deviceAt: 1000 }], 'o segundo toque mantém o primeiro horário');
    fila = queue.enqueueHeatStart(fila, 'heat-2', 2000);
    assert.equal(queue.saveHeatStartQueue(EVENT, fila), true);
    assert.deepEqual(queue.loadHeatStartQueue(EVENT), fila);
    assert.deepEqual(queue.loadHeatStartQueue('outro'), []);
    store.set('woda-largada-lixo', '[{"heatId":"","deviceAt":1},{"heatId":"x","deviceAt":"y"},{"heatId":"ok","deviceAt":3}]');
    assert.deepEqual(queue.loadHeatStartQueue('lixo'), [{ heatId: 'ok', deviceAt: 3 }]);
    fila = queue.dequeueHeatStart(fila, 'heat-1');
    assert.deepEqual(fila, [{ heatId: 'heat-2', deviceAt: 2000 }]);
    queue.saveHeatStartQueue(EVENT, []);
    assert.equal(store.has(`woda-largada-${EVENT}`), false);
  } finally {
    delete globalThis.window;
  }
  assert.deepEqual(queue.loadHeatStartQueue(EVENT), [], 'sem armazenamento local, fila vazia');
  assert.equal(queue.describeHeatStartSync('offline', 1), 'Largada guardada no aparelho · envio quando a conexão voltar');
  assert.equal(queue.describeHeatStartSync('saving', 1), 'Salvando 1 registro…');
  assert.equal(queue.describeHeatStartSync('saved', 0), 'Salvo');
  assert.equal(queue.describeHeatStartSync('offline', 0), 'Sem conexão');
  assert.equal(queue.describeHeatStartSync('session', 1), 'Sessão expirada · largada guardada no aparelho');
});

test('resposta da largada: só sai da fila confirmada ou recusada de vez; sessão expirada, limite e serviço fora guardam o horário do toque', () => {
  assert.equal(queue.classifyHeatStartResponse(200, true), 'started');
  assert.equal(queue.classifyHeatStartResponse(409, true), 'started', 'outro aparelho largou antes: vale o horário do servidor');
  assert.equal(queue.classifyHeatStartResponse(409, false), 'rejected');
  assert.equal(queue.classifyHeatStartResponse(401, false), 'session');
  for (const status of [429, 500, 502, 503, 599]) assert.equal(queue.classifyHeatStartResponse(status, false), 'retry', String(status));
  for (const status of [400, 403, 404]) assert.equal(queue.classifyHeatStartResponse(status, false), 'rejected', String(status));

  const screen = read('../src/components/race/HeatStartScreen.tsx');
  assert.match(screen, /classifyHeatStartResponse\(response\.status, Boolean\(data\.startedAt\)\)/);
  // 401: guarda, avisa e não agenda nova tentativa (sobe quando a tela volta com o login).
  assert.match(screen, /if \(outcome === 'session'\) \{\s*setSyncStatus\('session'\);\s*setNotice\(\{ kind: 'session', heatId: item\.heatId, text: RACE_SESSION_EXPIRED_MESSAGE \}\);\s*return;\s*\}/);
  assert.match(screen, /href="\/admin"[^>]*>Entrar de novo<\/Link>/);
  assert.doesNotMatch(screen, /response\.status !== 503/);
});

// ---------------------------------------------------------------------------
// Renderização e estático das telas (AC1, AC5, AC8, AC9, AC10, AC11)
// ---------------------------------------------------------------------------

test('lista de ondas renderiza horário previsto, categorias, atletas, estado e a próxima onda', () => {
  const athlete = { id: 'a', name: 'Ana', box: '', divisionId: 'd', divisionName: 'Women' };
  const base = { date: '2026-11-01', heatNumber: null, athletes: [athlete], startedByName: null, runsCount: 0 };
  const html = renderToStaticMarkup(createElement(RaceWaveList, {
    waves: [
      { ...base, id: 'h1', title: 'Onda 1 · Women', time: '08:00', categories: ['Women'], startedAt: '2026-11-01T11:00:07.000Z' },
      { ...base, id: 'h2', title: 'Onda 2 · Pro', time: '08:40', categories: ['Women Pro', 'Men Pro'], startedAt: null },
      { ...base, id: 'h3', title: 'Onda 3', time: '09:00', categories: [], startedAt: null }
    ],
    queuedIds: ['h3'],
    nextId: 'h2',
    timeZone: 'America/Fortaleza',
    hrefFor: (id) => `/judge/corrida/ev?onda=${id}`
  }));
  assert.match(html, /Largou às 08:00:07/);
  assert.match(html, /Aguardando largada/);
  assert.match(html, /Guardada no aparelho/);
  assert.match(html, /08:40<\/span> previsto · Women Pro · Men Pro · 1 atleta/);
  assert.match(html, /border-2 border-primary[^"]*"><span class="min-w-0"><span class="block truncate text-base font-extrabold"><span[^>]*>Próxima<\/span>Onda 2 · Pro/);
  assert.match(html, /href="\/judge\/corrida\/ev\?onda=h1"/);
  assert.match(html, /min-h-\[68px\]/);
});

test('tela de largada: CourtShell com a faixa Race, segurar 700 ms (useTapHold), alvos de 56 px ou mais e sincronização sempre visível', () => {
  for (const path of ['../src/app/judge/corrida/page.tsx', '../src/app/judge/corrida/[eventId]/page.tsx']) assert.ok(existsSync(new URL(path, import.meta.url)), path);
  const screen = read('../src/components/race/HeatStartScreen.tsx');
  assert.match(screen, /import \{ useTapHold \} from '@\/components\/sheet\/useTapHold';/);
  assert.match(screen, /useTapHold\(\{ onTap: showHint, onHold: \(\) => startRef\.current\(\)/);
  assert.match(screen, /'Segure para largar'/);
  assert.match(screen, /min-h-\[88px\]/);
  assert.doesNotMatch(screen, /min-h-(?:9|10|11|12)\b/, 'nenhum alvo abaixo de 56 px');
  assert.match(screen, /role="status"\s+aria-live="polite"/);
  assert.match(screen, /sticky bottom-0/);
  assert.match(screen, /action: 'start_heat', eventId, heatId: item\.heatId, deviceAt: item\.deviceAt, clientNow: Date\.now\(\)/);
  assert.match(screen, /window\.addEventListener\('online', resume\)/);
  assert.doesNotMatch(screen, /window\.confirm|supabase/, 'sem diálogo de confirmação nem banco no cliente');
  for (const path of ['../src/components/race/HeatStartScreen.tsx', '../src/components/race/RaceEventsList.tsx']) {
    assert.match(read(path), /<CourtShell[\s\S]*?eyebrow="Fitness Race · Largada"/, path);
  }
  assert.match(read('../src/components/race/RaceEventsList.tsx'), /fetch\('\/api\/race-sheets\?view=events'\)/);
});

test('faixa do CourtShell (D26): parâmetro opcional com padrão "Arbitragem na quadra"; telas de FF sem o parâmetro', () => {
  const shell = read('../src/components/judge/CourtShell.tsx');
  assert.match(shell, /export const COURT_DEFAULT_EYEBROW = 'Arbitragem na quadra';/);
  assert.match(shell, /eyebrow\?: string;/);
  assert.match(shell, /eyebrow = COURT_DEFAULT_EYEBROW/);
  assert.match(shell, /text-primary">\{eyebrow\}<\/p>/);
  for (const path of ['../src/components/judge/CourtEventsList.tsx', '../src/components/judge/CourtBoard.tsx', '../src/components/judge/CourtSheet.tsx', '../src/app/judge/quadra/page.tsx', '../src/app/judge/quadra/[eventId]/page.tsx', '../src/app/judge/quadra/sumula/[sheetId]/page.tsx']) {
    assert.doesNotMatch(read(path), /eyebrow/, path);
  }
});

test('atalho "Fitness Race" ao lado de "Quadra" na área do judge; seção "Ondas" no RaceSheetPanel, sem lógica nova no admin', () => {
  const judge = read('../src/app/judge/page.tsx');
  assert.match(judge, /href="\/judge\/quadra"/);
  assert.match(judge, /href="\/judge\/corrida"[\s\S]*?Fitness Race\s*<\/Link>/);
  assert.ok(judge.indexOf('href="/judge/quadra"') < judge.indexOf('href="/judge/corrida"'));
  const panel = read('../src/components/admin/RaceSheetPanel.tsx');
  // Story 1.104: a "Escala de judges" entra entre as ondas e os judges do evento.
  assert.match(panel, /<RaceWavesPanel event=\{event\} \/>\n\s*<RaceAssignmentsPanel event=\{event\} \/>\n\s*<RaceJudgesPanel event=\{event\} \/>/);
  const waves = read('../src/components/admin/RaceWavesPanel.tsx');
  assert.match(waves, /fetch\(`\/api\/race-sheets\?view=waves&eventId=\$\{encodeURIComponent\(event\.id\)\}`\)/);
  assert.match(waves, /href=\{`\$\{startHref\}\?onda=\$\{encodeURIComponent\(wave\.id\)\}`\}/);
  assert.doesNotMatch(read('../src/app/admin/page.tsx'), /RaceWavesPanel|start_heat|view=waves/);
});

test('Functional Fitness intocado: /api/sheets e o acesso de FF não citam a largada', () => {
  for (const file of ['../src/app/api/sheets/route.ts', '../src/lib/serverSheetAccess.ts', '../src/lib/serverScoresheets.ts']) {
    assert.doesNotMatch(read(file), /start_heat|race_start_heat|raceWaves|race_heat_marks/, file);
  }
  assert.match(read('../src/lib/serverSheetAccess.ts'), /export const isPresentialEventType = \(eventType: unknown\) => !eventType \|\| eventType === 'functional_fitness';/);
});

// ---------------------------------------------------------------------------
// Migration da largada (gate ARCH-001, @data-engineer M4)
// ---------------------------------------------------------------------------

const MIGRATION = '20261030140000_race_start_heat.sql';
const migration = read(`../supabase/migrations/${MIGRATION}`);
const SIGNATURE = '(TEXT, TEXT, TEXT, JSONB, TIMESTAMPTZ, TIMESTAMPTZ, BIGINT, TEXT, TEXT, JSONB)';
const escape = (value) => value.replace(/[()]/g, '\\$&');

test('migration: race_start_heat numa transação, marca única, trava antes das corridas e sem duplicar corrida ativa', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.race_start_heat\(/);
  assert.match(migration, /RETURNS JSONB\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path = public/);
  assert.match(migration, /ON CONFLICT \(event_id, heat_id\) DO NOTHING;\n\s*IF NOT FOUND THEN/);
  const lock = migration.indexOf('WHERE id = p_ruleset_id AND locked_at IS NULL;');
  const runs = migration.indexOf('INSERT INTO race_runs');
  assert.ok(lock > 0 && runs > lock, 'trava o regulamento antes de criar as corridas');
  assert.match(migration, /SET locked_at = NOW\(\),/);
  assert.match(migration, /ON CONFLICT \(event_id, athlete_id\) WHERE status <> 'cancelled' DO NOTHING;/);
  assert.match(migration, /'racing', p_started_at, NOW\(\), NOW\(\)/);
  assert.match(migration, /JOIN divisions d ON d\.id = a\.division_id AND d\.event_id = p_event_id/);
  assert.match(migration, /RAISE EXCEPTION 'race_event_required'/);
});

test('migration: gatilho recusa mudar regulamento travado; grants só para service_role; idempotente', () => {
  assert.match(migration, /DROP TRIGGER IF EXISTS race_rulesets_guard_locked ON public\.race_rulesets;\nCREATE TRIGGER race_rulesets_guard_locked\n\s*BEFORE UPDATE ON public\.race_rulesets/);
  for (const column of ['rules', 'course', 'preset', 'version', 'event_id']) {
    assert.match(migration, new RegExp(`NEW\\.${column} IS DISTINCT FROM OLD\\.${column}`), column);
  }
  assert.match(migration, /IF OLD\.locked_at IS NOT NULL AND \(/);
  assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION public\\.race_start_heat${escape(SIGNATURE)} FROM PUBLIC, anon, authenticated;`));
  assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.race_start_heat${escape(SIGNATURE)} TO service_role;`));
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.race_rulesets_guard_locked\(\) FROM PUBLIC, anon, authenticated;/);
  assert.doesNotMatch(migration, /TO (anon|authenticated|PUBLIC)\b/);
  assert.doesNotMatch(migration, /CREATE TABLE|ALTER TABLE|DROP TABLE(?! IF EXISTS)/);
  assert.match(migration, new RegExp(`--\\s+DROP FUNCTION IF EXISTS public\\.race_start_heat${escape(SIGNATURE)};`));
  assert.match(migration, /-- Ordem de deploy: aplicar depois de 20261030120000_race_sheets\.sql/);
});

test('migration: as duas da súmula Race anteriores (1.94 e 1.95) não foram editadas', () => {
  const names = readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter((name) => name.endsWith('.sql')).sort();
  // Story 1.99: 20261031120000_race_publication.sql veio depois; a da largada segue a mais nova até a 1.98.
  assert.equal(names.filter((name) => name < '20261031120000').at(-1), MIGRATION, 'a da largada é a mais nova até a 1.98');
  const hash = createHash('sha256');
  for (const name of ['20261030120000_race_sheets.sql', '20261030130000_race_judges.sql']) {
    hash.update(`${name}\n${read(`../supabase/migrations/${name}`).replace(/\r\n/g, '\n')}\n`);
  }
  assert.equal(hash.digest('hex'), RACE_PREVIOUS_SHA256, 'migration da 1.94 ou da 1.95 foi alterada');
});

const RACE_PREVIOUS_SHA256 = '3c29cd0546dd3c9576c58b4e0a22c1422f09c9b0675a75a0757238e8aa3736dc';
