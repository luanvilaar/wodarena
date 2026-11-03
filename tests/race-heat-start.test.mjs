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
const { RaceHeatStartSheet } = await importServerModule('components/admin/RaceHeatStartSheet.tsx');
const { RaceHeatStartNotices } = await importServerModule('components/admin/RaceHeatStartNotices.tsx');

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
  const response = await start(MANAGER, 'heat-2', { deviceAt, clientNow });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.runsCreated, 2);
  assert.equal(response.body.alreadyRacing, 0);

  const [mark] = rows('race_heat_marks');
  assert.equal(mark.heat_id, 'heat-2');
  assert.equal(mark.started_by_user_id, MANAGER.id);
  assert.equal(mark.started_by_name, MANAGER.name);
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
  const response = await start(MANAGER, 'heat-1', { deviceAt: clientNow - 3000, clientNow });
  assert.equal(response.status, 200);
  const startedAt = Date.parse(response.body.startedAt);
  assert.ok(Math.abs(startedAt - (Date.now() - 3000)) < 1500, 'horário do servidor de 3 s atrás');
  assert.ok(startedAt <= Date.now());
});

test('start_heat: segunda largada (mesmo ou outro aparelho) responde 409 com o horário e não cria nada', async () => {
  seed();
  const first = await start(MANAGER, 'heat-2');
  assert.equal(first.status, 200);
  const before = database.snapshot();
  for (const user of [MANAGER, OWNER]) {
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
  const response = await start(MANAGER, 'heat-1');
  assert.equal(response.status, 409);
  assert.equal(response.body.startedAt, '2026-11-01T11:00:07.000Z');
  assert.match(response.body.error, /08:00:07/, 'no fuso do evento');
  assert.equal(rows('race_runs').length, 0);
});

test('start_heat: atleta com corrida ativa no evento não é duplicado; regulamento travado mantém o snapshot dele', async () => {
  seed();
  assert.equal((await start(MANAGER, 'heat-1')).status, 200);
  // Ana passa a estar também na onda 2 (organizador remontou o cronograma).
  database.rows('events')[0].event_schedule = SCHEDULE.map((item) => (item.id === 'heat-2' ? { ...item, athleteIds: ['ath-bia', 'ath-ana'] } : item));
  database.rows('divisions')[0].course_layout = [{ id: 'nova', name: 'Nova', type: 'run', orderIndex: 0 }];
  const second = await start(MANAGER, 'heat-2');
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
  const empty = await start(MANAGER, 'heat-vazia');
  assert.equal(empty.status, 400);
  assert.match(empty.body.error, /não tem atletas/);
  assert.equal((await start(MANAGER, 'heat-fora')).status, 400, 'atleta de outro evento não conta');
  const noCourse = await start(MANAGER, 'heat-sem-percurso');
  assert.equal(noCourse.status, 400);
  assert.match(noCourse.body.error, /percurso da categoria Men Pro/);
  assert.equal((await start(MANAGER, 'nao-existe')).status, 404);
  assert.equal((await start(MANAGER, 'briefing')).status, 404, 'só itens kind heat');
  assert.equal((await start(MANAGER, '')).status, 400);
  assert.equal((await post(MANAGER, { action: 'start_heat', eventId: EVENT, heatId: 'heat-1' })).status, 400, 'sem o horário do aparelho');
  assert.equal((await start(MANAGER, 'heat-1', { deviceAt: Date.now() + 60_000 })).status, 400, 'toque no futuro');
  assert.equal(rows('race_heat_marks').length, 0);
  assert.equal(rows('race_runs').length, 0);
});

test('start_heat (Story 1.110): judge atribuído ao evento recebe 403 e nada é criado; só o gestor dono e o owner largam', async (t) => {
  quiet(t);
  seed();
  const before = database.snapshot();
  for (const judge of [JUDGE, JUDGE_2]) {
    const refused = await start(judge, 'heat-1');
    assert.equal(refused.status, 403, `${judge.name} está atribuído ao evento e não larga`);
    assert.equal(refused.body.error, 'Acesso negado para este evento.');
  }
  assert.deepEqual(database.snapshot(), before, 'a recusa não grava marca, corrida nem regulamento');
  assert.equal(database.rpcCalls.filter((item) => item.name === 'race_start_heat').length, 0, 'a função de largada nem é chamada');
  assert.equal((await start(MANAGER, 'heat-1')).status, 200);
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
  const response = await start(MANAGER, 'heat-1');
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

  await start(MANAGER, 'heat-2');
  const after = await get(MANAGER, { view: 'waves', eventId: EVENT });
  const started = after.body.waves.find((wave) => wave.id === 'heat-2');
  assert.ok(started.startedAt);
  assert.equal(started.startedByName, MANAGER.name);
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

  // A fila e o envio vivem em useHeatStart (Story 1.110), usado só pelo painel do organizador.
  const hook = read('../src/components/race/useHeatStart.ts');
  assert.match(hook, /classifyHeatStartResponse\(response\.status, Boolean\(data\.startedAt\)\)/);
  // 401: guarda, avisa e não agenda nova tentativa (sobe quando o painel volta com o login).
  assert.match(hook, /if \(outcome === 'session'\) \{\s*setSyncStatus\('session'\);\s*setNotices\(\(previous\) => upsertHeatStartNotice\(previous, \{ kind: 'session', heatId: item\.heatId, text: RACE_SESSION_EXPIRED_MESSAGE \}\)\);\s*return;\s*\}/);
  assert.match(hook, /window\.addEventListener\('online', resume\)/);
  assert.match(hook, /action: 'start_heat', eventId, heatId: item\.heatId, deviceAt: item\.deviceAt, clientNow: Date\.now\(\)/);
  assert.doesNotMatch(hook, /response\.status !== 503/);
  // O caminho para entrar de novo fica junto da barra de sincronização do painel.
  // REQ-001: /admin dentro de /admin não recarrega o contexto; o botão recarrega a página (a fila continua guardada).
  const panel = read('../src/components/admin/RaceWavesPanel.tsx');
  assert.match(panel, /heatStart\.syncStatus === 'session' && \(\s*<button type="button" onClick=\{reloadPage\}[^>]*>Entrar de novo<\/button>/);
  assert.match(panel, /const reloadPage = \(\) => window\.location\.reload\(\);/);
  assert.doesNotMatch(panel, /<Link href="\/admin"/);
  // REL-001: a fila guardada sobe a cada carga das ondas, não só na primeira.
  assert.match(panel, /useEffect\(\(\) => \{\s*if \(payload\) flushHeatStart\(\);\s*\}, \[payload, flushHeatStart\]\);/);
});

// ---------------------------------------------------------------------------
// Renderização e estático das telas (AC1, AC5, AC8, AC9, AC10, AC11)
// ---------------------------------------------------------------------------

test('folha de largada do painel: estados da onda, gesto de segurar, tablet em duas colunas e alvos de 56 px ou mais', () => {
  const athlete = { id: 'a', name: 'Ana', box: 'Box Norte', divisionId: 'd', divisionName: 'Women' };
  const wave = { id: 'h2', title: 'Onda 2 · Pro', date: '2026-11-01', time: '08:40', heatNumber: null, categories: ['Women Pro', 'Men Pro'], athletes: [athlete], startedAt: null, startedByName: null, runsCount: 0 };
  const base = { timeZone: 'America/Fortaleza', syncStatus: 'saved', pendingCount: 0, notice: null, onStart: () => {}, onClose: () => {} };
  const waiting = renderToStaticMarkup(createElement(RaceHeatStartSheet, { ...base, wave, queued: null }));
  assert.match(waiting, /Onda 2 · Pro/);
  assert.match(waiting, /08:40<\/span> previsto · Women Pro · Men Pro · 1 atleta/);
  assert.match(waiting, /Aguardando largada/);
  assert.match(waiting, /Segure para largar/);
  assert.match(waiting, /Ana/);
  assert.match(waiting, /Box Norte · Women/);
  assert.match(waiting, /min-h-\[96px\]/);
  assert.match(waiting, /md:\[@media\(min-height:700px\)\]:min-h-\[128px\]/, 'botão maior no tablet, só em tela alta (celular deitado fica no tamanho menor)');
  assert.match(waiting, /md:grid-cols-2/, 'tablet: estado de um lado, atletas do outro');
  assert.match(waiting, /md:max-w-4xl/);
  assert.match(waiting, /role="dialog"/);
  assert.match(waiting, /Salvo/);

  const queued = renderToStaticMarkup(createElement(RaceHeatStartSheet, { ...base, wave, queued: { heatId: 'h2', deviceAt: Date.parse('2026-11-01T11:40:03.000Z') }, syncStatus: 'offline', pendingCount: 1 }));
  assert.match(queued, /Guardada no aparelho/);
  assert.match(queued, /08:40:03/);
  assert.match(queued, /Largada guardada no aparelho/);
  assert.doesNotMatch(queued, /Segure para largar/, 'guardada: o botão some, sem largar duas vezes');

  const started = renderToStaticMarkup(createElement(RaceHeatStartSheet, { ...base, wave: { ...wave, startedAt: '2026-11-01T11:00:07.000Z', runsCount: 1 }, queued: null }));
  assert.match(started, /Largou às/);
  assert.match(started, /08:00:07/);
  assert.match(started, /Largada registrada/);
  assert.match(started, /Em corrida/);
  assert.doesNotMatch(started, /Segure para largar/);

  const conflict = renderToStaticMarkup(createElement(RaceHeatStartSheet, { ...base, wave, queued: null, notice: { kind: 'conflict', heatId: 'h2', text: 'Largada já registrada às 08:00:07.' } }));
  assert.match(conflict, /Largada já registrada às 08:00:07\./);
  assert.match(conflict, /Outro aparelho largou esta onda antes/);
  const otherWaveNotice = renderToStaticMarkup(createElement(RaceHeatStartSheet, { ...base, wave, queued: null, notice: { kind: 'error', heatId: 'outra', text: 'Recusada.' } }));
  assert.doesNotMatch(otherWaveNotice, /Recusada\./, 'o aviso é da onda em que aconteceu');

  const source = read('../src/components/admin/RaceHeatStartSheet.tsx');
  assert.match(source, /import \{ useTapHold \} from '@\/components\/sheet\/useTapHold';/);
  assert.match(source, /useTapHold\(\{ onTap: showHint, onHold: \(\) => startRef\.current\(\)/);
  assert.doesNotMatch(source, /min-h-(?:9|10|11|12)\b/, 'nenhum alvo abaixo de 56 px');
  assert.doesNotMatch(source, /window\.confirm|supabase/, 'sem diálogo de confirmação nem banco no cliente');
});

test('avisos da largada (REQ-002): um por onda, ficam até dispensar e sobrevivem à folha fechada', () => {
  const a = { kind: 'error', heatId: 'h1', text: 'Esta onda não tem atletas.' };
  const b = { kind: 'conflict', heatId: 'h2', text: 'Largada já registrada às 08:00:07.' };
  const c = { kind: 'session', heatId: 'h3', text: 'Sua sessão expirou.' };
  let notices = queue.upsertHeatStartNotice([], a);
  notices = queue.upsertHeatStartNotice(notices, b);
  notices = queue.upsertHeatStartNotice(notices, c);
  assert.deepEqual(notices.map((item) => item.heatId), ['h1', 'h2', 'h3']);
  const replaced = queue.upsertHeatStartNotice(notices, { ...a, text: 'Outro motivo.' });
  assert.equal(replaced.filter((item) => item.heatId === 'h1').length, 1, 'um aviso por onda');
  assert.equal(replaced.at(-1).text, 'Outro motivo.');
  assert.deepEqual(queue.dropSessionHeatStartNotices(notices).map((item) => item.heatId), ['h1', 'h2'], 'largada que subiu tira só a sessão expirada');
  assert.deepEqual(queue.dismissHeatStartNotice(notices, 'h2').map((item) => item.heatId), ['h1', 'h3']);

  const waves = [{ id: 'h1', title: 'Onda 1' }, { id: 'h2', title: 'Onda 2 · Pro' }, { id: 'h3', title: 'Onda 3' }];
  const props = { waves, onDismiss: () => {}, onReload: () => {} };
  const html = renderToStaticMarkup(createElement(RaceHeatStartNotices, { ...props, notices }));
  assert.match(html, /Onda 1/);
  assert.match(html, /Esta onda não tem atletas\./);
  assert.match(html, /Onda 2 · Pro/);
  assert.match(html, /Outro aparelho largou esta onda antes/);
  assert.match(html, /Dispensar o aviso da Onda 1/);
  assert.match(html, /Entrar de novo/, 'sessão expirada mostra o botão de entrar de novo');
  assert.match(html, /min-h-14/);
  const hidden = renderToStaticMarkup(createElement(RaceHeatStartNotices, { ...props, notices, openHeatId: 'h1' }));
  assert.doesNotMatch(hidden, /Esta onda não tem atletas\./, 'o aviso da onda com a folha aberta fica na folha');
  assert.match(hidden, /Onda 2 · Pro/);
  assert.equal(renderToStaticMarkup(createElement(RaceHeatStartNotices, { ...props, notices: [] })), '', 'sem aviso, nada na tela');

  // O hook guarda a lista e o painel não apaga os avisos ao fechar a folha.
  const hook = read('../src/components/race/useHeatStart.ts');
  assert.match(hook, /upsertHeatStartNotice\(previous, \{ kind: 'error'/);
  assert.match(hook, /const dismissNotice = useCallback\(/);
  const panel = read('../src/components/admin/RaceWavesPanel.tsx');
  assert.match(panel, /<RaceHeatStartNotices[\s\S]*?openHeatId=\{startingWave\?\.id \?\? null\}/);
  assert.match(panel, /onClose=\{\(\) => setStartingId\(null\)\}/);
  assert.doesNotMatch(panel, /clearNotice/);
});

test('folha de largada: sessão expirada com botão dentro da folha e foco preso nela (A11Y-001)', () => {
  const athlete = { id: 'a', name: 'Ana', box: '', divisionId: 'd', divisionName: 'Women' };
  const wave = { id: 'h2', title: 'Onda 2', date: '2026-11-01', time: '08:40', heatNumber: null, categories: [], athletes: [athlete], startedAt: null, startedByName: null, runsCount: 0 };
  const base = { wave, timeZone: 'America/Fortaleza', queued: null, pendingCount: 1, notice: null, onStart: () => {}, onClose: () => {}, onReload: () => {} };
  const expired = renderToStaticMarkup(createElement(RaceHeatStartSheet, { ...base, syncStatus: 'session' }));
  assert.match(expired, /Entrar de novo/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(RaceHeatStartSheet, { ...base, syncStatus: 'saved' })), /Entrar de novo/);
  assert.match(expired, /tabindex="-1"/);

  const source = read('../src/components/admin/RaceHeatStartSheet.tsx');
  assert.match(source, /dialog\?\.focus\(\);/, 'o foco entra na folha');
  assert.match(source, /event\.key !== 'Tab'/, 'Tab não sai da folha');
  assert.match(source, /document\.body\.style\.overflow = 'hidden';/, 'o fundo não rola');
  assert.match(source, /previouslyFocused\.focus\(\)/, 'o foco volta ao botão Largar');
  assert.match(source, /md:\[@media\(min-height:700px\)\]:text-7xl/, 'celular deitado não usa o tamanho máximo');
});

test('área do judge sem largada: o hub do evento só leva ao Wall Ball e às estações; a lista de eventos é de arbitragem', () => {
  for (const path of ['../src/app/judge/corrida/page.tsx', '../src/app/judge/corrida/[eventId]/page.tsx']) assert.ok(existsSync(new URL(path, import.meta.url)), path);
  assert.ok(!existsSync(new URL('../src/components/race/HeatStartScreen.tsx', import.meta.url)), 'a tela de largada do judge saiu');
  assert.ok(!existsSync(new URL('../src/components/race/RaceWaveList.tsx', import.meta.url)));
  const hub = read('../src/components/race/RaceEventHubScreen.tsx');
  assert.match(hub, /A largada é feita pelo organizador\./);
  assert.match(hub, /Abrir Wall Ball/);
  assert.match(hub, /Abrir estações/);
  assert.doesNotMatch(hub, /start_heat|useTapHold|useHeatStart|Segure para largar|raceStartQueue/, 'o hub não larga nada');
  const page = read('../src/app/judge/corrida/[eventId]/page.tsx');
  assert.doesNotMatch(page, /searchParams|heatId/, 'o link ?onda= não abre mais a largada');
  for (const path of ['../src/components/race/RaceEventHubScreen.tsx', '../src/components/race/RaceEventsList.tsx']) {
    assert.match(read(path), /<CourtShell[\s\S]*?eyebrow="Fitness Race · Arbitragem"/, path);
  }
  assert.match(read('../src/components/race/RaceEventsList.tsx'), /fetch\('\/api\/race-sheets\?view=events'\)/);
  const route = read('../src/app/api/race-sheets/route.ts');
  const startBlock = route.slice(route.indexOf("if (action === 'start_heat')"), route.indexOf('if (Object.hasOwn(DECISIONS, action))'));
  assert.match(startBlock, /assertRaceManagerAccess\(supabaseAdmin, actor, body\.eventId\)/);
  assert.doesNotMatch(startBlock, /assertRaceJudgeAccess/);
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
  assert.match(waves, /useHeatStart\(\{ eventId: event\.id/);
  assert.match(waves, /<RaceHeatStartSheet/);
  assert.match(waves, /<Flag [^>]*\/> Largar/);
  assert.match(waves, /md:min-h-14/, 'botões maiores no tablet');
  assert.doesNotMatch(waves, /\/judge\/corrida|startHref/, 'o painel não manda largar pela tela do judge');
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
