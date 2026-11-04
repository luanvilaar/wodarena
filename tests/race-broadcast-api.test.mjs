import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createFakeSupabase } from './support/fakeSupabase.mjs';
import { createRaceClient } from './support/fakeRaceSupabase.mjs';
import { BASE_MS, iso } from './support/raceBroadcastScenario.mjs';
import {
  EVENT_ID,
  SECRETS,
  TOKEN,
  athleteId,
  attemptId,
  runId,
  seedRaceDatabase,
  tokenHash,
  workoutId
} from './support/raceBroadcastSeed.mjs';
import { importServerModule, setActiveSupabaseClient } from './support/serverModuleHarness.mjs';

// Story 1.112 (Telão Fitness Race, T2): a rota /api/telao/[token] decide pelo tipo do
// evento e o telão do Fitness Race lê só o que a súmula Race grava, em fases e
// paginado, sem dado pessoal. Pelas rotas reais, com o banco em memória e o cenário de
// referência da maquete semeado em race_* (tests/support/raceBroadcastSeed.mjs).

process.env.SUPABASE_URL = 'http://supabase.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';
process.env.WODA_SESSION_SECRET = 'segredo-de-teste-telao-race-api';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

let database = createFakeSupabase();
const state = { missingRaceTables: false, beforeUpdate: {}, beforeCount: {} };
const client = createRaceClient(() => database, state);
setActiveSupabaseClient(client);

const { GET: getTelao } = await importServerModule('app/api/telao/[token]/route.ts');
const builder = await importServerModule('lib/serverRaceBroadcast.ts');
const { computeDivisionStandings } = await importServerModule('lib/leaderboardStandings.ts');
const { BROADCAST_EVENT_TYPE_MESSAGE } = await importServerModule('lib/serverBroadcast.ts');
const { RACE_SHEETS_MIGRATION } = await importServerModule('lib/serverRaceSheets.ts');

const HEADERS = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' };

/** Banco da onda 3 aos `seconds` da largada, com o relógio do servidor `nowSeconds` depois dela. */
const load = (options = {}) => {
  const seeded = seedRaceDatabase(options);
  database = createFakeSupabase(seeded.seed);
  state.missingRaceTables = false;
  return seeded;
};
const nowAt = (seconds) => BASE_MS + seconds * 1000;
const eventRow = () => database.rows('events').find((row) => row.id === EVENT_ID);
const config = () => database.rows('event_broadcasts').find((row) => row.event_id === EVENT_ID);
const build = (options = {}, over = {}) => builder.buildRaceBroadcastState(over.client ?? client, eventRow(), config(), options);

let ipCounter = 0;
const freshIp = () => ({ 'x-forwarded-for': `203.0.113.${(ipCounter += 1)}` });
const call = async (t, nowSeconds, token = TOKEN, headers = {}) => {
  t.mock.method(Date, 'now', () => nowAt(nowSeconds));
  const response = await getTelao(new Request(`http://localhost/api/telao/${token}`, { headers: { ...freshIp(), ...headers } }), { params: Promise.resolve({ token }) });
  return { status: response.status, body: response.status === 304 ? null : await response.json(), headers: response.headers };
};
const quiet = (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});
};
const withoutTime = ({ serverTime, ...rest }) => { void serverTime; return rest; };

// Corrida da onda 2 (já terminada), com cartão e penalidade: a leitura nunca pode pedi-los.
const finishedWave2 = () => ({
  race_runs: ['joao', 'samuel'].map((key, index) => ({
    id: runId(key), event_id: EVENT_ID, division_id: 'open-m', athlete_id: athleteId(key), heat_id: 'w2', ruleset_id: 'rs-race-1',
    status: 'finished', started_at: iso(-3600), finish_at: iso(-3600 + 4000 + index), gross_seconds: 4000, penalty_seconds: 0, official_seconds: 4000 + index, time_source: 'sheet'
  })),
  race_attempts: ['joao', 'samuel'].map((key) => ({
    id: attemptId(key, 'ski-erg'), run_id: runId(key), event_id: EVENT_ID, athlete_id: athleteId(key), station_id: 'ski-erg', station_kind: 'ergometer',
    status: 'released', progress: {}, started_at: iso(-3500), ended_at: iso(-3260)
  })),
  race_infractions: [{ id: 'inf-w2', run_id: runId('joao'), station_id: 'ski-erg', source_key: 'ski-erg|1|x', code: 'x', label: 'Motivo da onda 2', kind: 'penalty', seconds: 15, status: 'confirmed', origin: 'engine', general: false, created_at: iso(-3300), updated_at: iso(-3300) }]
});

// ---------------------------------------------------------------------------
// AC1: decisão por tipo de evento
// ---------------------------------------------------------------------------

test('AC1: Fitness Race responde com o payload do Race; Functional Fitness segue igual; Qualifier recebe 400', async (t) => {
  load({ seconds: 1440, extra: {
    events: [
      { id: 'ev-ff', name: 'Open Litoral', date: '2026-11-01', organizer_id: 'mgr-race-telao', event_type: 'functional_fitness', status: 'upcoming', logo_url: null, event_schedule: [] },
      { id: 'ev-qualifier', name: 'Qualifier', date: '2026-11-01', organizer_id: 'mgr-race-telao', event_type: 'functional_fitness_qualifier', status: 'upcoming', logo_url: null, event_schedule: [] }
    ],
    event_broadcasts: [
      { event_id: 'ev-ff', token_hash: tokenHash('F'.repeat(32)), token_created_at: iso(-100), token_revoked_at: null, mode: 'auto', pinned_heat_id: null, pinned_division_id: null, updated_at: iso(-100) },
      { event_id: 'ev-qualifier', token_hash: tokenHash('Q'.repeat(32)), token_created_at: iso(-100), token_revoked_at: null, mode: 'auto', pinned_heat_id: null, pinned_division_id: null, updated_at: iso(-100) }
    ]
  } });
  const race = await call(t, 1440);
  assert.equal(race.status, 200);
  assert.equal(race.body.eventType, 'fitness_racing');
  assert.equal(race.body.screen, 'live');

  const ff = await call(t, 1440, 'F'.repeat(32));
  assert.equal(ff.status, 200);
  assert.equal(ff.body.eventType, undefined, 'o payload de Functional Fitness não ganha campo nenhum');
  assert.deepEqual(Object.keys(ff.body).sort(), ['appVersion', 'call', 'event', 'interval', 'live', 'mode', 'next', 'screen', 'serverTime', 'standby', 'version']);

  const qualifier = await call(t, 1440, 'Q'.repeat(32));
  assert.equal(qualifier.status, 400);
  assert.equal(qualifier.body.error, BROADCAST_EVENT_TYPE_MESSAGE);
  assert.match(qualifier.body.error, /telão ao vivo é exclusivo/);
  assert.match(qualifier.body.error, /Fitness Race/);
  assert.doesNotMatch(qualifier.body.error, /súmula/i);
  for (const [name, value] of Object.entries(HEADERS)) assert.equal(qualifier.headers.get(name), value, `400 com ${name}`);
});

test('AC1: o evento é lido uma vez por consulta, nos dois tipos', async (t) => {
  load({ seconds: 1440, extra: {
    events: [{ id: 'ev-ff', name: 'Open Litoral', date: '2026-11-01', organizer_id: 'mgr-race-telao', event_type: 'functional_fitness', status: 'upcoming', logo_url: null, event_schedule: [] }],
    event_broadcasts: [{ event_id: 'ev-ff', token_hash: tokenHash('F'.repeat(32)), token_created_at: iso(-100), token_revoked_at: null, mode: 'auto', pinned_heat_id: null, pinned_division_id: null, updated_at: iso(-100) }]
  } });
  for (const token of [TOKEN, 'F'.repeat(32)]) {
    database.operations.length = 0;
    assert.equal((await call(t, 1440, token)).status, 200);
    assert.equal(database.operations.filter((operation) => operation.table === 'events' && operation.action === 'select').length, 1, `evento do link ${token.slice(0, 2)}`);
  }
  assert.match(read('../src/app/api/telao/[token]/route.ts'), /readBroadcastEvent/);
});

test('AC1: link inválido ou revogado continua 404 e a rota não lê o evento', async (t) => {
  load({ seconds: 1440 });
  database.rows('event_broadcasts')[0].token_revoked_at = iso(-10);
  database.operations.length = 0;
  const revoked = await call(t, 1440);
  assert.equal(revoked.status, 404);
  assert.equal(database.operations.some((operation) => operation.table === 'events'), false);
  for (const [name, value] of Object.entries(HEADERS)) assert.equal(revoked.headers.get(name), value);
  assert.equal((await call(t, 1440, 'x'.repeat(40))).status, 404);
  assert.equal((await call(t, 1440, 'curto')).status, 404);
});

// ---------------------------------------------------------------------------
// AC2: ETag, limite e cabeçalhos; version estável
// ---------------------------------------------------------------------------

test('AC2: ETag da version e 304 sem corpo quando nada mudou; version não depende da hora do servidor', async (t) => {
  load({ seconds: 1440 });
  const first = await call(t, 1440);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('ETag'), `"${first.body.version}"`);
  for (const [name, value] of Object.entries(HEADERS)) assert.equal(first.headers.get(name), value);

  const unchanged = await call(t, 1445, TOKEN, { 'if-none-match': first.headers.get('ETag') });
  assert.equal(unchanged.status, 304, 'cinco segundos depois, mesmo estado: 304');
  assert.equal(unchanged.body, null);
  for (const [name, value] of Object.entries(HEADERS)) assert.equal(unchanged.headers.get(name), value, `304 com ${name}`);

  const a = await build({ nowMs: nowAt(1440) });
  const b = await build({ nowMs: nowAt(1700) });
  assert.equal(a.version, b.version, 'duas leituras com nowMs diferentes no mesmo estado dão a mesma version');
  assert.notEqual(a.serverTime, b.serverTime);
  assert.deepEqual(withoutTime(a), withoutTime(b));
});

test('AC2: a version muda quando um cartão muda (uma repetição a mais, um cartão liberado)', async () => {
  load({ seconds: 1440 });
  const before = await build({ nowMs: nowAt(1440) });
  const card = database.rows('race_attempts').find((row) => row.id === attemptId('diego', 'sled-pull'));
  card.progress = { ...card.progress, units: 3 };
  const after = await build({ nowMs: nowAt(1440) });
  assert.notEqual(after.version, before.version);
  assert.equal(after.live.boards[0].rows.find((row) => row.name === 'Diego Martins').where.progress.done, 3);
});

test('AC2: 404, 429 e 503 saem com os cabeçalhos; 240 por minuto por link e IP', async (t) => {
  quiet(t);
  load({ seconds: 1440 });
  const ip = { 'x-forwarded-for': '198.51.100.77' };
  t.mock.method(Date, 'now', () => nowAt(1440));
  const get = async (token = TOKEN, headers = {}) => {
    const response = await getTelao(new Request(`http://localhost/api/telao/${token}`, { headers: { ...ip, ...headers } }), { params: Promise.resolve({ token }) });
    return { status: response.status, headers: response.headers };
  };
  const first = await get();
  assert.equal(first.status, 200);
  const etag = first.headers.get('ETag');
  for (let index = 1; index < 240; index += 1) assert.equal((await get(TOKEN, { 'if-none-match': etag })).status, 304);
  const limited = await get(TOKEN, { 'if-none-match': etag });
  assert.equal(limited.status, 429, 'a 241ª consulta no minuto é barrada');
  for (const [name, value] of Object.entries(HEADERS)) assert.equal(limited.headers.get(name), value, `429 com ${name}`);

  state.missingRaceTables = true;
  const missing = await call(t, 1440);
  assert.equal(missing.status, 503);
  assert.match(missing.body.error, new RegExp(RACE_SHEETS_MIGRATION.replace('.', '\\.')), 'cita a migration da súmula Race');
  for (const [name, value] of Object.entries(HEADERS)) assert.equal(missing.headers.get(name), value, `503 com ${name}`);
});

// ---------------------------------------------------------------------------
// AC3: leitura em fases, paginada, só das ondas na pista
// ---------------------------------------------------------------------------

const spyClient = (log) => ({
  from: (table) => {
    const query = client.from(table);
    const wrapped = new Proxy(query, {
      get(target, prop) {
        const value = target[prop];
        if (typeof value !== 'function') return value;
        return (...args) => {
          if (prop === 'in') log.in.push({ table, column: args[0], values: [...args[1]] });
          if (prop === 'range') log.range.push({ table, from: args[0], to: args[1] });
          if (prop === 'select') log.select.push({ table, columns: args[0] });
          const result = value.apply(target, args);
          return result === target ? wrapped : result;
        };
      }
    });
    return wrapped;
  },
  rpc: (name, args) => client.rpc(name, args)
});
const newLog = () => ({ in: [], range: [], select: [] });

test('AC3 (Story 1.117): na torre da categoria, os cartões de todas as ondas largadas dela, em páginas; da onda fixada, só os dela', async () => {
  load({ seconds: 1440, extra: finishedWave2() });
  const log = newLog();
  const small = await build({ nowMs: nowAt(1440), pageSize: 10 }, { client: spyClient(log) });
  const normal = await build({ nowMs: nowAt(1440) });
  assert.deepEqual(withoutTime(small), withoutTime(normal), 'a paginação não perde nem repete linha');

  const attemptPages = log.range.filter((entry) => entry.table === 'race_attempts');
  assert.deepEqual(attemptPages.map((entry) => [entry.from, entry.to]), [[0, 9], [10, 19], [20, 29]], '27 cartões da onda 3 e 2 da onda 2 em páginas de 10');

  const openMaleRuns = new Set(['rafael', 'bruno', 'diego', 'thiago', 'lucas', 'mateus', 'caio', 'pedro', 'gustavo', 'andre', 'joao', 'samuel'].map(runId));
  const askedRunIds = log.in.filter((entry) => entry.column === 'run_id').flatMap((entry) => entry.values);
  assert.ok(askedRunIds.every((id) => openMaleRuns.has(id)), `ids pedidos: ${askedRunIds.join(', ')}`);
  assert.ok(askedRunIds.includes(runId('joao')), 'a onda 2 já terminou, mas é a referência em cada ponto: os cartões dela entram');
  assert.deepEqual(
    [...new Set(log.in.filter((entry) => entry.table === 'race_attempts' || entry.table === 'race_infractions').map((entry) => entry.table))].sort(),
    ['race_attempts', 'race_infractions']
  );
  assert.equal(log.range.filter((entry) => entry.table === 'race_judge_assignments').length, 1, 'a escala de judges é lida (checagem de certeza do R1)');
  assert.equal(normal.live.boards[0].rows.length, 15, 'os 10 da onda 3 e os 5 das ondas 1 e 2');
  assert.equal(JSON.stringify(normal).includes('Motivo da onda 2'), false, 'o motivo da penalidade nunca vai');

  load({ seconds: 1440, extra: finishedWave2(), mode: 'pin_heat', pinnedHeat: 'w3' });
  const pinnedLog = newLog();
  await build({ nowMs: nowAt(1440) }, { client: spyClient(pinnedLog) });
  const pinnedIds = pinnedLog.in.filter((entry) => entry.column === 'run_id').flatMap((entry) => entry.values);
  assert.equal(pinnedIds.includes(runId('joao')), false, 'onda fixada: só os cartões dela');
  assert.equal(pinnedLog.range.filter((entry) => entry.table === 'race_judge_assignments').length, 0);
});

test('AC3 (DoD): onda ao vivo com mais de 1000 cartões é lida inteira, sem o corte silencioso do PostgREST', async () => {
  load({ seconds: 1440 });
  // 140 atletas a mais na onda 3, com os 8 cartões do percurso cada um: 1120 + 27 cartões, em mais de uma consulta.
  const stations = ['ski-erg', 'sled-push', 'sled-pull', 'burpee-broad-jump', 'row', 'farmers-carry', 'sandbag-lunges', 'wall-balls'];
  const extraKeys = Array.from({ length: 140 }, (_, index) => `zz${String(index).padStart(3, '0')}`);
  database.rows('athletes').push(...extraKeys.map((key) => ({ id: athleteId(key), name: `Atleta ${key}`, box: 'Box Z', division_id: 'open-m', is_team: false })));
  database.rows('leaderboard_entries').push(...extraKeys.map((key) => ({ id: `le-${key}`, event_id: EVENT_ID, division_id: 'open-m', athlete_id: athleteId(key) })));
  database.rows('race_runs').push(...extraKeys.map((key) => ({
    id: runId(key), event_id: EVENT_ID, division_id: 'open-m', athlete_id: athleteId(key), heat_id: 'w3', ruleset_id: 'rs-race-1',
    status: 'racing', started_at: iso(0), finish_at: null, gross_seconds: null, penalty_seconds: 0, official_seconds: null, time_source: null
  })));
  database.rows('race_attempts').push(...extraKeys.flatMap((key, index) => stations.map((stationId, position) => ({
    id: attemptId(key, stationId), run_id: runId(key), event_id: EVENT_ID, athlete_id: athleteId(key), station_id: stationId, station_kind: 'generic',
    status: 'released', progress: {}, started_at: iso(10 + position * 100 + (index % 7)), ended_at: iso(60 + position * 100 + (index % 7))
  }))));
  const schedule = database.rows('events')[0].event_schedule;
  schedule.find((item) => item.id === 'w3').athleteIds.push(...extraKeys.map(athleteId));
  assert.ok(database.rows('race_attempts').length > 1000);

  const log = newLog();
  const payload = await build({ nowMs: nowAt(1440) }, { client: spyClient(log) });
  const rows = payload.live.boards[0].rows;
  assert.equal(rows.length, 155, 'os 10 do cenário, os 140 a mais e os 5 das ondas 1 e 2, todos na torre da categoria');
  const lastExtra = rows.find((row) => row.name === 'Atleta zz139');
  assert.ok(lastExtra, 'o último atleta (ids no fim da ordem) chegou');
  assert.equal(lastExtra.point, 15, 'todos os 8 cartões dele foram lidos: a saída do Wall Balls é o ponto 15');
  assert.ok(rows.filter((row) => row.name.startsWith('Atleta zz')).every((row) => row.point === 15), 'nenhum dos 140 perdeu cartão');
  const asked = log.in.filter((entry) => entry.table === 'race_attempts').flatMap((entry) => entry.values);
  assert.equal(new Set(asked).size, 150, 'os 150 cartões de corrida foram pedidos, em blocos de no máximo 100 ids');
  assert.ok(log.in.filter((entry) => entry.table === 'race_attempts').every((entry) => entry.values.length <= 100));
});

test('AC3: sem onda na pista, nenhum cartão nem penalidade é lido; colunas explícitas e sem select(*)', async () => {
  load({ seconds: 5300 });
  const log = newLog();
  const payload = await build({ nowMs: nowAt(5300) }, { client: spyClient(log) });
  assert.equal(payload.screen, 'class');
  assert.equal(log.in.some((entry) => entry.column === 'run_id' && (entry.table === 'race_attempts' || entry.table === 'race_infractions')), false);
  assert.equal(log.select.filter((entry) => entry.table === 'race_attempts' || entry.table === 'race_infractions').length, 0);
  for (const entry of log.select) {
    assert.equal(typeof entry.columns, 'string', entry.table);
    assert.notEqual(entry.columns.trim(), '*', `${entry.table} sem select(*)`);
  }
  assert.equal(log.select.find((entry) => entry.table === 'athletes').columns, 'id, name, box, division_id, is_team');
  assert.doesNotMatch(log.select.map((entry) => entry.columns).join(' '), /email|phone|birth|instagram|city|team_members|photo/);
});

test('AC3: penalidade vigente soma segundos; advertência e penalidade revogada não entram', async () => {
  load({ seconds: 1440 });
  const payload = await build({ nowMs: nowAt(1440) });
  const rows = payload.live.boards[0].rows;
  assert.equal(rows.find((row) => row.name === 'Thiago Bezerra').penaltySeconds, 15);
  assert.equal(rows.find((row) => row.name === 'Rafael Tavares').penaltySeconds, 0, 'a advertência e a penalidade revogada do Rafael ficam de fora');
});

test('AC3: percurso: snapshot do regulamento da corrida; sem snapshot, o percurso atual da categoria', async () => {
  load({ seconds: 1440 });
  const withSnapshot = await build({ nowMs: nowAt(1440) });
  // O organizador muda o percurso depois da largada: a corrida mantém o snapshot dela (D6).
  database.rows('divisions').find((row) => row.id === 'open-m').course_layout = [{ id: 'so-uma', name: 'Só uma', type: 'station', orderIndex: 1 }];
  const afterEdit = await build({ nowMs: nowAt(1440) });
  assert.deepEqual(afterEdit.live.boards[0].stages.map((stage) => stage.id), withSnapshot.live.boards[0].stages.map((stage) => stage.id));
  assert.equal(afterEdit.live.boards[0].stages.length, 16);

  // Sem snapshot (regulamento ainda sem percurso), vale o percurso atual da categoria.
  load({ seconds: 0, snapshot: false });
  for (const table of ['race_heat_marks', 'race_runs', 'race_attempts', 'race_infractions', 'race_decisions', 'scores']) database.rows(table).length = 0;
  database.rows('divisions').find((row) => row.id === 'open-m').course_layout = [
    { id: 'run-1', name: 'Corrida 1', type: 'run', orderIndex: 1, distance: '1000m' },
    { id: 'ski-erg', name: 'Ski Erg', type: 'station', orderIndex: 2, distance: '1000m' }
  ];
  const grid = await build({ nowMs: nowAt(0) });
  assert.equal(grid.screen, 'grid');
  assert.deepEqual(grid.grid.courses.find((course) => course.divisionKey === 'open-m').stages.map((stage) => [stage.id, stage.kind, stage.target]), [
    ['run-1', null, '1000m'], ['ski-erg', 'ergometer', '1000m']
  ]);
});

test('AC3: o instante do DNF é o da decisão mark_dnf; mudar a linha da corrida depois não o move', async () => {
  load({ seconds: 3700 });
  const first = await build({ nowMs: nowAt(3700) });
  const dnf = first.live.ticker.find((event) => event.kind === 'dnf');
  assert.deepEqual([dnf.name, dnf.at, dnf.clock], ['André Moreira', iso(3626), '11:12:31']);

  const run = database.rows('race_runs').find((row) => row.id === runId('andre'));
  run.updated_at = iso(3699);
  run.gross_seconds = 9999;
  database.rows('race_decisions').push({ id: 'dec-outra', event_id: EVENT_ID, run_id: runId('andre'), heat_id: 'w3', action: 'adjust_time', actor_role: 'manager', actor_name: 'Gestora', created_at: iso(3690) });
  const second = await build({ nowMs: nowAt(3700) });
  assert.deepEqual(second.live.ticker.find((event) => event.kind === 'dnf'), dnf, 'só mark_dnf conta, e o updated_at da corrida não entra');

  // Decisão mais recente de DNF vence.
  database.rows('race_decisions').push({ id: 'dec-nova', event_id: EVENT_ID, run_id: runId('andre'), heat_id: 'w3', action: 'mark_dnf', actor_role: 'manager', actor_name: 'Gestora', created_at: iso(3650) });
  assert.equal((await build({ nowMs: nowAt(3700) })).live.ticker.find((event) => event.kind === 'dnf').at, iso(3650));
});

// ---------------------------------------------------------------------------
// AC4, AC7: contrato por tela e modos da mesa
// ---------------------------------------------------------------------------

test('AC4: tela ao vivo: onda, torre, percurso com meta e carga, melhores, recordes e faixa', async () => {
  load({ seconds: 1440 });
  const payload = await build({ nowMs: nowAt(1440) });
  assert.deepEqual(
    [payload.eventType, payload.screen, payload.mode, payload.event, payload.appVersion],
    ['fitness_racing', 'live', 'auto', { name: 'Fitness Race Fortaleza', logoUrl: 'https://exemplo.test/logo.png', date: '2026-11-14', timeZone: 'America/Fortaleza' }, '']
  );
  assert.deepEqual([payload.grid, payload.class, payload.standby], [null, null, null]);
  assert.deepEqual(payload.next, { key: 'w4', title: 'Onda 4', heatNumber: 4, date: '2026-11-14', time: '10:40', divisionNames: ['Open Masculino', 'Open Feminino'], athleteCount: 3 });
  assert.equal(payload.serverTime, new Date(nowAt(1440)).toISOString());

  const live = payload.live;
  assert.deepEqual(Object.keys(live).sort(), ['arrivals', 'bests', 'boards', 'records', 'scope', 'steps', 'ticker', 'waves']);
  assert.equal(live.scope, 'division');
  assert.deepEqual(live.steps, [{ waveKey: null, divisionKey: 'open-m' }]);
  assert.deepEqual(live.waves, [{
    key: 'w3', title: 'Onda 3', heatNumber: 3, time: '10:12', startedAt: iso(0), startedClock: '10:12:05', lastReadingAt: iso(1418),
    divisionKeys: ['open-m'], athleteCount: 10, racingCount: 10
  }]);
  const board = live.boards[0];
  assert.deepEqual([board.scope, board.waveKey, board.divisionKey, board.divisionName, board.startedAt, board.hasLeaderReading, board.rows.length], ['division', null, 'open-m', 'Open Masculino', null, true, 15]);
  // As ondas 1 e 2 só têm resultado publicado (sem cartão): sem ponto comum com quem corre, ficam à frente (AUTO-DECISION T6-1).
  assert.deepEqual(board.rows.map((row) => [row.position, row.name, row.waveKey, row.gapSeconds]).slice(0, 7), [
    [1, 'Felipe Arruda', 'w1', null], [2, 'João Victor Castro', 'w2', 176], [3, 'Renan Pinheiro', 'w1', 289], [4, 'Samuel Rocha', 'w2', 365],
    [5, 'Rafael Tavares', 'w3', null], [6, 'Bruno Sampaio', 'w3', null], [7, 'Diego Martins', 'w3', null]
  ]);
  assert.deepEqual(board.rows.at(-1).name, 'Otávio Campos', 'DNF publicado no fim, sem posição');
  assert.deepEqual(board.battle && [board.battle.position, board.battle.intervalSeconds, board.battle.trend, board.battle.trendSeconds, board.battle.crossWave, board.battle.point], [5, 2, 'closing', 47, false, { stationName: 'Sled Pull', side: 'out' }]);
  assert.deepEqual(
    board.stages.filter((stage) => stage.type === 'station').map((stage) => [stage.name, stage.kind, stage.target, stage.load, stage.closesTime, stage.semJudge]),
    [
      ['Ski Erg', 'ergometer', '1000m', '', false, false],
      ['Sled Push', 'sled', '4 trechos · 50m', '152kg', false, false],
      ['Sled Pull', 'sled', '4 trechos · 50m', '103kg', false, false],
      ['Burpee Broad Jump', 'sections', '80m', '', false, false],
      ['Row', 'ergometer', '1000m', '', false, false],
      ['Farmers Carry', 'sections', '200m', '2x24kg', false, false],
      ['Sandbag Lunges', 'sections', '4 voltas · 100m', '20kg', false, false],
      ['Wall Balls', 'wall_ball', '100 reps', '9kg', true, false]
    ],
    'a carga é a do naipe da categoria (Open Masculino)'
  );
  assert.deepEqual(live.bests.map((best) => [best.stationKey, best.seconds, best.name]).sort(), [
    ['row', 240, 'Renan Pinheiro'], ['sandbag-lunges', 262, 'Samuel Rocha'], ['ski-erg', 218, 'Rafael Tavares'],
    ['sled-pull', 227, 'Bruno Sampaio'], ['sled-push', 171, 'Bruno Sampaio'], ['wall-balls', 356, 'João Victor Castro']
  ].sort());
  const keyOf = (name) => board.rows.find((row) => row.name === name).athleteKey;
  assert.deepEqual(live.records.map((record) => [record.stationKey, record.seconds, record.athleteKey === keyOf('Rafael Tavares') || record.athleteKey === keyOf('Bruno Sampaio')]), [
    ['ski-erg', 218, true], ['sled-push', 171, true], ['sled-pull', 227, true]
  ]);
  assert.deepEqual(live.ticker.map((event) => [event.kind, event.clock, event.name, event.seconds, event.stationName, event.position]), [
    ['enter', '10:16:54', 'Caio Fernandes', null, null, 10],
    ['enter', '10:17:01', 'Mateus Ribeiro', null, null, 11],
    ['enter', '10:17:12', 'Pedro Albuquerque', null, null, 12],
    ['enter', '10:17:34', 'Gustavo Lima', null, null, 13],
    ['enter', '10:17:55', 'André Moreira', null, null, 14],
    ['penalty', '10:26:29', 'Thiago Bezerra', 15, 'Sled Push', null]
  ], 'os 6 últimos da categoria; na penalidade, só os segundos e a estação (o motivo nunca vai)');
  assert.deepEqual([live.ticker[0].point, live.ticker[0].divisionKeys, live.ticker[0].waveTitle], [{ stationName: 'Ski Erg', side: 'in' }, ['open-m'], 'Onda 3']);
  assert.deepEqual(live.arrivals, []);
});

test('AC4: reta final, chegadas fechadas pela súmula com posição, penalidade e recordes que o atleta detém', async () => {
  load({ seconds: 4100 });
  const live = (await build({ nowMs: nowAt(4100) })).live;
  const board = live.boards[0];
  assert.deepEqual(board.finalists.map((item) => [item.name, item.position, item.progress, item.raceStartedAt, item.waveNumber]), [
    ['Diego Martins', 7, { type: 'reps', done: 75, target: 100 }, iso(0), 3],
    ['Thiago Bezerra', 8, { type: 'reps', done: 66, target: 100 }, iso(0), 3],
    ['Lucas Holanda', 9, { type: 'reps', done: 5, target: 100 }, iso(0), 3]
  ]);
  const diego = board.rows.find((row) => row.name === 'Diego Martins');
  assert.deepEqual([diego.gapCounting, diego.gapSeconds, diego.gapBaseSeconds, diego.gapPoint], [true, null, 3982, { stationName: 'Wall Balls', side: 'finish' }], 'o relógio dele passou do tempo final do Rafael: "contando", com a diferença nula no payload (a tela conta pela base)');
  assert.deepEqual(live.arrivals.map((item) => [item.name, item.finishAt, item.finishClock, item.finalSeconds, item.finalText, item.position, item.penaltySeconds, item.divisionName]), [
    ['Rafael Tavares', iso(3982), '11:18:27', 3982, '1:06:22', 1, 0, 'Open Masculino'],
    ['Bruno Sampaio', iso(4015), '11:19:00', 4015, '1:06:55', 3, 0, 'Open Masculino']
  ], 'a posição conta o Felipe (4012 s, onda 1) à frente do Bruno');
  assert.deepEqual(live.arrivals[0].holds.map((hold) => [hold.stationName, hold.seconds]).sort(), [['Ski Erg', 218], ['Row', 225]].sort());
  assert.deepEqual(live.arrivals[1].holds.map((hold) => [hold.stationName, hold.seconds]).sort(), [['Sled Push', 171], ['Sled Pull', 227], ['Wall Balls', 345]].sort());
  assert.deepEqual(live.ticker.slice(-2).map((event) => [event.kind, event.name, event.finalSeconds, event.waveKey]), [['finish', 'Rafael Tavares', 3982, 'w3'], ['finish', 'Bruno Sampaio', 4015, 'w3']]);
  assert.ok(live.ticker.some((event) => event.kind === 'dnf' && event.name === 'André Moreira'));
});

test('AC4: classificação: linhas por categoria, melhores, a onda que terminou por último e o grid da próxima', async () => {
  load({ seconds: 5300 });
  const payload = await build({ nowMs: nowAt(5300) });
  assert.equal(payload.screen, 'class');
  assert.deepEqual([payload.live, payload.grid, payload.standby], [null, null, null]);
  const cls = payload.class;
  assert.deepEqual(cls.divisions.map((division) => division.key), ['open-m'], 'Open Feminino ainda não tem resultado');
  assert.deepEqual(cls.lastWave, { key: 'w3', title: 'Onda 3' });
  const rows = cls.divisions[0].rows;
  assert.deepEqual(rows.map((row) => [row.position, row.name, row.waveTitle, row.timeText, row.gapSeconds, row.dnf, row.fresh]).slice(0, 4), [
    [1, 'Rafael Tavares', 'Onda 3', '1:06:22', null, false, true],
    [2, 'Felipe Arruda', 'Onda 1', '1:06:52', 30, false, false],
    [3, 'Bruno Sampaio', 'Onda 3', '1:06:55', 33, false, true],
    [4, 'Diego Martins', 'Onda 3', '1:09:40', 198, false, true]
  ]);
  assert.deepEqual(rows.filter((row) => row.dnf).map((row) => [row.position, row.name, row.timeText, row.gapSeconds, row.fresh]), [
    [null, 'Otávio Campos', null, null, false],
    [null, 'André Moreira', null, null, true]
  ].sort((a, b) => rows.findIndex((r) => r.name === a[1]) - rows.findIndex((r) => r.name === b[1])));
  assert.equal(rows.length, 15);
  assert.deepEqual(cls.divisions[0].bests.map((best) => [best.stationKey, best.seconds, best.name]).sort(), [
    ['row', 225, 'Rafael Tavares'], ['sandbag-lunges', 253, 'Thiago Bezerra'], ['ski-erg', 218, 'Rafael Tavares'],
    ['sled-pull', 227, 'Bruno Sampaio'], ['sled-push', 171, 'Bruno Sampaio'], ['wall-balls', 325, 'Diego Martins']
  ].sort());
  assert.deepEqual(cls.steps, [
    { kind: 'class', divisionKey: 'open-m', page: 0, pageCount: 2 },
    { kind: 'class', divisionKey: 'open-m', page: 1, pageCount: 2 },
    { kind: 'grid', waveKey: 'w4', page: 0, pageCount: 1 }
  ]);
  assert.deepEqual(cls.grid.wave, { key: 'w4', title: 'Onda 4', heatNumber: 4, date: '2026-11-14', time: '10:40', divisionNames: ['Open Masculino', 'Open Feminino'], athleteCount: 3 });
  assert.deepEqual(cls.grid.athletes.map((athlete) => [athlete.name, athlete.divisionName]), [['Ana Paula Lima', 'Open Feminino'], ['Beatriz Nogueira', 'Open Feminino'], ['Davi Lacerda', 'Open Masculino']], 'na ordem do cronograma');
  assert.deepEqual(cls.grid.courses.map((course) => [course.divisionKey, course.stages.length]), [['open-m', 16], ['open-f', 16]]);
  assert.equal(cls.grid.courses[1].stages.find((stage) => stage.name === 'Sled Push').load, '102kg', 'carga do naipe feminino');
});

test('AC7: antes da primeira largada o automático mostra o grid (não a espera); a espera só sem próxima onda e sem resultado', async () => {
  const clear = () => {
    for (const table of ['race_heat_marks', 'race_runs', 'race_attempts', 'race_infractions', 'race_decisions', 'scores']) database.rows(table).length = 0;
  };
  load({ seconds: 0 });
  clear();
  const grid = await build({ nowMs: nowAt(-9000) });
  assert.equal(grid.screen, 'grid');
  assert.equal(grid.grid.wave.key, 'w1');
  assert.deepEqual(grid.grid.athletes.map((athlete) => athlete.name), ['Felipe Arruda', 'Renan Pinheiro']);
  assert.deepEqual([grid.live, grid.class, grid.standby], [null, null, null]);
  assert.equal(grid.next.key, 'w1');

  load({ seconds: 0, schedule: [] });
  clear();
  const empty = await build({ nowMs: nowAt(0) });
  assert.equal(empty.screen, 'standby', 'evento sem onda no cronograma: espera, não erro');
  assert.deepEqual(empty.standby, { upcoming: [] });
  assert.equal(empty.next, null);
});

test('AC7: os quatro modos da mesa: espera, onda fixada (grid antes, ao vivo depois), classificação fixada e automático', async () => {
  const clearRuns = () => {
    for (const table of ['race_heat_marks', 'race_runs', 'race_attempts', 'race_infractions', 'race_decisions', 'scores']) database.rows(table).length = 0;
  };
  load({ seconds: 0, mode: 'standby' });
  clearRuns();
  const standby = await build({ nowMs: nowAt(0) });
  assert.equal(standby.screen, 'standby');
  assert.equal(standby.mode, 'standby');
  assert.deepEqual(standby.standby.upcoming.map((wave) => wave.key), ['w1', 'w2', 'w3', 'w4'], 'até 4 próximas ondas, com a espera fixada na mesa');
  assert.deepEqual(standby.standby.upcoming[0], { key: 'w1', title: 'Onda 1', heatNumber: 1, date: '2026-11-14', time: '08:30', divisionNames: ['Open Masculino'], athleteCount: 2 });

  load({ seconds: 1440, mode: 'pin_heat', pinnedHeat: 'w4' });
  const pinnedGrid = await build({ nowMs: nowAt(1440) });
  assert.deepEqual([pinnedGrid.screen, pinnedGrid.mode, pinnedGrid.grid.wave.key, pinnedGrid.live], ['grid', 'pin_heat', 'w4', null], 'onda fixada que não largou: grid');

  load({ seconds: 5300, mode: 'pin_heat', pinnedHeat: 'w3' });
  const pinnedLive = await build({ nowMs: nowAt(5300) });
  assert.deepEqual([pinnedLive.screen, pinnedLive.live.waves.map((wave) => wave.key)], ['live', ['w3']], 'onda fixada que largou: ao vivo, mesmo terminada');
  assert.equal(pinnedLive.live.boards[0].rows.find((row) => row.name === 'Gustavo Lima').status, 'finished');

  load({ seconds: 5300, mode: 'pin_standings', pinnedDivision: 'open-m' });
  const pinnedClass = await build({ nowMs: nowAt(5300) });
  assert.deepEqual([pinnedClass.screen, pinnedClass.class.divisions.map((division) => division.key), pinnedClass.class.grid], ['class', ['open-m'], null]);

  load({ seconds: 1440, mode: 'pin_heat', pinnedHeat: 'nao-existe' });
  assert.equal((await build({ nowMs: nowAt(1440) })).screen, 'live', 'onda fixada que não existe cai no automático');
});

// ---------------------------------------------------------------------------
// AC5: privacidade
// ---------------------------------------------------------------------------

test('AC5: nenhum dado pessoal, motivo de penalidade nem id interno no JSON, em nenhuma tela', async () => {
  const patches = {
    rafael: { name: 'Rafael Tavares 85999991234', email: SECRETS.email, phone: SECRETS.phone },
    bruno: { name: 'Bruno Sampaio bruno.sigilo@example.com' },
    diego: { name: `Arena Sul Racing (Diego Martins / ${SECRETS.member})`, is_team: true }
  };
  const forbidden = [
    SECRETS.email, SECRETS.phone, SECRETS.birth, SECRETS.instagram, SECRETS.city, SECRETS.judge, SECRETS.reason, SECRETS.note, SECRETS.member,
    '85999991234', 'bruno.sigilo', '85900000000', '@exemplo.test',
    'judge-race-1', 'mgr-race-telao', 'gestora.telao'
  ];
  const ids = ['rafael', 'bruno', 'diego', 'thiago', 'lucas', 'mateus', 'caio', 'pedro', 'gustavo', 'andre', 'felipe', 'renan', 'joao', 'samuel', 'otavio', 'ana', 'bia', 'davi']
    .flatMap((key) => [athleteId(key), runId(key), attemptId(key, 'ski-erg'), attemptId(key, 'wall-balls')]);
  for (const seconds of [0, 1440, 4100, 5300]) {
    load({ seconds, athletePatch: patches });
    const payload = await build({ nowMs: nowAt(seconds) });
    const text = JSON.stringify(payload);
    for (const secret of forbidden) assert.equal(text.includes(secret), false, `vazou "${secret}" aos ${seconds} s`);
    for (const id of ids) assert.equal(text.includes(`"${id}"`), false, `vazou o id ${id} aos ${seconds} s`);
    assert.doesNotMatch(text, /ath-|att-|"inf-|"dec-|"rs-race|"le-/, `ids internos aos ${seconds} s`);
    const names = [];
    const walk = (value, key = '') => {
      if (Array.isArray(value)) value.forEach((item) => walk(item, key));
      else if (value && typeof value === 'object') Object.entries(value).forEach(([k, item]) => { names.push(k); walk(item, k); });
    };
    walk(payload);
    const bad = [...new Set(names)].filter((name) => /^(athlete_?id|run_?id|attempt_?id|user_?id|registration_?id|email|phone|birth|instagram|city|team_?members|judge|judgeName|label|code|note|reason|createdBy|author)$/i.test(name));
    assert.deepEqual(bad, [], `campos proibidos aos ${seconds} s`);
  }
});

test('AC5: nome sanitizado, equipe pelo nome da equipe e box como está', async () => {
  load({ seconds: 1440, athletePatch: {
    rafael: { name: 'Rafael Tavares 85999991234' },
    bruno: { name: 'Bruno Sampaio bruno.sigilo@example.com' },
    diego: { name: `Arena Sul Racing (Diego Martins / ${SECRETS.member})`, is_team: true, box: 'Arena Sul' }
  } });
  const rows = (await build({ nowMs: nowAt(1440) })).live.boards[0].rows.filter((row) => row.waveKey === 'w3');
  const byPosition = (index) => rows[index];
  assert.deepEqual([byPosition(0).name, byPosition(1).name, byPosition(2).name, byPosition(2).box], ['Rafael Tavares', 'Bruno Sampaio', 'Arena Sul Racing', 'Arena Sul']);
});

test('AC5: a chave do atleta é opaca, estável entre consultas e única; o id nunca sai', async () => {
  load({ seconds: 1440 });
  const first = await build({ nowMs: nowAt(1440) });
  const second = await build({ nowMs: nowAt(1500) });
  const keys = first.live.boards[0].rows.map((row) => row.athleteKey);
  assert.deepEqual(keys, second.live.boards[0].rows.map((row) => row.athleteKey), 'igual entre consultas');
  assert.equal(new Set(keys).size, keys.length, 'única por atleta');
  for (const [index, key] of keys.entries()) {
    assert.match(key, /^[A-Za-z0-9_-]{16}$/);
    assert.ok(!['rafael', 'bruno', 'diego', 'thiago', 'lucas', 'mateus', 'caio', 'pedro', 'gustavo', 'andre'].some((name) => key.includes(name)), `chave ${index}`);
  }
  // Outro segredo do servidor, outras chaves: quem não tem o segredo não confere um palpite de id.
  const { deriveOpaqueId } = await importServerModule('lib/serverSecurity.ts');
  const rafaelKey = first.live.boards[0].rows.find((row) => row.name === 'Rafael Tavares').athleteKey;
  assert.equal(deriveOpaqueId(athleteId('rafael'), 'telao-athlete'), rafaelKey);
  assert.notEqual(deriveOpaqueId(athleteId('rafael'), 'outra-finalidade'), rafaelKey);
});

// ---------------------------------------------------------------------------
// AC6: classificação sem segunda regra
// ---------------------------------------------------------------------------

test('AC6: a classificação é a de computeDivisionStandings: empate divide a posição, DNF sem posição, só os elegíveis', async () => {
  load({ seconds: 5300 });
  // Lucas empata com o Diego (4180 s) e o Pedro deixa de ser elegível no leaderboard.
  const lucas = database.rows('scores').find((row) => row.athlete_id === athleteId('lucas'));
  lucas.value = 4180;
  lucas.result = '1:09:40';
  database.rows('leaderboard_entries').splice(database.rows('leaderboard_entries').findIndex((row) => row.athlete_id === athleteId('pedro')), 1);

  const rows = (await build({ nowMs: nowAt(5300) })).class.divisions[0].rows;
  assert.equal(rows.some((row) => row.name === 'Pedro Albuquerque'), false, 'inelegível não aparece');
  assert.deepEqual(rows.filter((row) => row.timeText).map((row) => [row.position, row.name, row.gapSeconds]), [
    [1, 'Rafael Tavares', null], [2, 'Felipe Arruda', 30], [3, 'Bruno Sampaio', 33], [4, 'Diego Martins', 198], [4, 'Lucas Holanda', 198],
    [6, 'João Victor Castro', 206], [7, 'Thiago Bezerra', 253], [8, 'Renan Pinheiro', 319], [9, 'Samuel Rocha', 395],
    [10, 'Mateus Ribeiro', 602], [11, 'Caio Fernandes', 755], [12, 'Gustavo Lima', 1182]
  ]);
  assert.equal(rows.filter((row) => row.dnf).length, 2);
  assert.ok(rows.filter((row) => row.dnf).every((row) => row.position === null && row.timeText === null && row.gapSeconds === null));

  // Mesma conta que o leaderboard do site: o motor do site dá as mesmas posições.
  const athletes = database.rows('athletes').filter((row) => row.division_id === 'open-m' && database.rows('leaderboard_entries').some((entry) => entry.athlete_id === row.id))
    .map((row) => ({ id: row.id, name: row.name, box: row.box, country: '', divisionId: row.division_id }));
  const scores = database.rows('scores').filter((row) => row.workout_id === workoutId('open-m'))
    .map((row) => ({ athleteId: row.athlete_id, workoutId: row.workout_id, result: row.result, value: row.value, splits: row.splits, resultStatus: row.result_status ?? undefined }));
  const site = computeDivisionStandings({ event: { date: '2026-11-14', eventType: 'fitness_racing', workouts: [{ id: workoutId('open-m'), name: 'Percurso Completo', description: '', type: 'fortime', code: 'TOTAL', orderIndex: 1, divisionId: 'open-m' }] }, divisionId: 'open-m', divisionAthletes: athletes, scores });
  const expected = new Map(site.filter((item) => item.rank > 0).map((item) => [item.athlete.name, item.rank]));
  for (const row of rows.filter((item) => item.timeText)) assert.equal(row.position, expected.get(row.name), row.name);
});

test('AC6: o selo NOVO marca os atletas da onda que terminou por último; sem faixa etária', async () => {
  load({ seconds: 5300 });
  const cls = (await build({ nowMs: nowAt(5300) })).class;
  const rows = cls.divisions[0].rows;
  const fresh = rows.filter((row) => row.fresh).map((row) => row.name).sort();
  assert.deepEqual(fresh, ['André Moreira', 'Bruno Sampaio', 'Caio Fernandes', 'Diego Martins', 'Gustavo Lima', 'Lucas Holanda', 'Mateus Ribeiro', 'Pedro Albuquerque', 'Rafael Tavares', 'Thiago Bezerra'], 'os dez da onda 3');
  assert.ok(rows.filter((row) => !row.fresh).every((row) => ['Onda 1', 'Onda 2'].includes(row.waveTitle)));
  assert.doesNotMatch(JSON.stringify(cls), /ageGroup|faixa|birth/i);
});

// ---------------------------------------------------------------------------
// AC8: sem regressão e estáticos
// ---------------------------------------------------------------------------

test('AC8: estático: a rota decide pelo tipo; a leitura nova é só leitura, paginada e sem ciclo de import', () => {
  const route = read('../src/app/api/telao/[token]/route.ts');
  assert.match(route, /event_type === 'fitness_racing'/);
  assert.match(route, /buildRaceBroadcastState\(supabaseAdmin, eventRow, config\)/);
  assert.match(route, /buildBroadcastState\(supabaseAdmin, config\.event_id, config, Date\.now\(\), eventRow\)/);

  const source = read('../src/lib/serverRaceBroadcast.ts');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /\.(insert|update|upsert|delete)\(/, 'só leitura');
  assert.doesNotMatch(code, /select\('\*'\)|select\("\*"\)/, 'colunas explícitas');
  assert.doesNotMatch(code, /readRaceBoardSources/, 'não usa a leitura que não pagina');
  assert.match(code, /readAllPages<[A-Za-z]+>\(fetchPage, pageSize, check\)/);
  assert.match(source, /RACE_SHEETS_MIGRATION/);

  const base = read('../src/lib/serverBroadcast.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(base, /serverRaceBroadcast/, 'serverBroadcast.ts não importa a leitura nova (sem import circular)');
  assert.match(base, /prefetchedEvent\?: BroadcastEventRow/);
  assert.match(base, /checkResult: \(result: \{ data: unknown; error: unknown \}\) => unknown = check/);

  const types = read('../src/lib/raceBroadcastPayload.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.deepEqual([...types.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]).sort(), ['@/lib/broadcastMode', '@/lib/raceBroadcast', '@/lib/raceRules']);
  assert.match(types, /eventType: 'fitness_racing'/);
});

test('AC8: a mesa atual não muda: /api/telao/control só herda o texto novo da mensagem', () => {
  const control = read('../src/app/api/telao/control/route.ts');
  assert.match(control, /notPresentialMessage: BROADCAST_EVENT_TYPE_MESSAGE/);
  assert.match(BROADCAST_EVENT_TYPE_MESSAGE, /^O telão ao vivo é exclusivo de eventos Functional Fitness e Fitness Race presenciais\.$/);
});
