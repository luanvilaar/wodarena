import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import test from 'node:test';

import { createFakeSupabase } from './support/fakeSupabase.mjs';
import { importServerModule, setActiveSupabaseClient } from './support/serverModuleHarness.mjs';

// Story 1.41 (AC5, AC14): POST /api/admin/geocode executa a rota real contra
// um banco em memória, com o Mapbox simulado no fetch. Nada de rede, banco
// real ou .env; o token abaixo é fictício.

process.env.SUPABASE_URL = 'http://supabase.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';
process.env.WODA_SESSION_SECRET = 'segredo-de-teste-story-1-41';
delete process.env.MAPBOX_TOKEN;

const FAKE_TOKEN = 'pk.tokenFicticioStory141.NaoUsarEmLugarNenhum';

let database = createFakeSupabase();
setActiveSupabaseClient({
  from: (table) => database.client.from(table),
  rpc: (name, args) => database.client.rpc(name, args)
});

const { POST: postGeocode } = await importServerModule('app/api/admin/geocode/route.ts');
const { parseMapboxCandidates } = await importServerModule('lib/serverGeocoding.ts');
const { createSessionToken } = await importServerModule('lib/serverSecurity.ts');

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const geocodeRoute = read('../src/app/api/admin/geocode/route.ts');
const serverGeocoding = read('../src/lib/serverGeocoding.ts');

const ACTIVE_MANAGER = { id: 'mgr-geo-ativo', name: 'Gestora Ativa', email: 'ativa@example.com', role: 'manager', service_valid_until: '2099-12-31' };
const EXPIRED_MANAGER = { id: 'mgr-geo-expirado', name: 'Gestor Expirado', email: 'expirado@example.com', role: 'manager', service_valid_until: '2020-01-01' };

const sessionFor = (user) => createSessionToken({ id: user.id, name: user.name, email: user.email, role: user.role });

let rateLimitUserCounter = 0;
// Cada teste usa um gestor próprio: o rate limit em memória é por usuário.
const freshManager = () => {
  rateLimitUserCounter += 1;
  return { ...ACTIVE_MANAGER, id: `${ACTIVE_MANAGER.id}-${rateLimitUserCounter}`, email: `ativa-${rateLimitUserCounter}@example.com` };
};

const feature = ({ label, latitude, longitude, geometry = [longitude, latitude], name, placeFormatted, withPropertyCoordinates = true }) => ({
  type: 'Feature',
  id: `dXJuOm1ieGFkcjo${label || name}`,
  geometry: { type: 'Point', coordinates: geometry },
  properties: {
    mapbox_id: `dXJuOm1ieGFkcjo${label || name}`,
    feature_type: 'address',
    ...(label ? { full_address: label } : {}),
    ...(name ? { name } : {}),
    ...(placeFormatted ? { place_formatted: placeFormatted } : {}),
    ...(withPropertyCoordinates ? { coordinates: { latitude, longitude, accuracy: 'rooftop' } } : {})
  }
});

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' }
});

const setup = (t, { users = [ACTIVE_MANAGER, EXPIRED_MANAGER], provider = () => jsonResponse({ type: 'FeatureCollection', features: [] }) } = {}) => {
  const state = { calls: [], logs: [] };
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
    t.mock.method(console, method, (...args) => { state.logs.push(args.map(String).join(' ')); });
  }
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = String(input);
    state.calls.push({ url, init });
    if (!url.startsWith('https://api.mapbox.com/')) throw new Error(`fetch inesperado no teste: ${new URL(url).host}`);
    return provider({ url, init });
  });
  database = createFakeSupabase({ users });
  return state;
};

const geocodeRequest = ({ user, body = { query: 'Arena Beach, João Pessoa, PB' }, rawBody, headers = {} } = {}) => postGeocode(
  new Request('http://localhost/api/admin/geocode', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(user ? { cookie: `woda_session=${sessionFor(user)}` } : {}),
      ...headers
    },
    body: rawBody ?? JSON.stringify(body)
  })
);

const readResponse = async (response) => {
  const text = await response.text();
  return {
    status: response.status,
    text,
    body: JSON.parse(text),
    headers: JSON.stringify([...response.headers.entries()])
  };
};

const assertTokenNeverLeaks = (result, state) => {
  assert.doesNotMatch(result.text, /tokenFicticio|access_token|api\.mapbox\.com/, 'token ou URL do provedor na resposta');
  assert.doesNotMatch(result.headers, /tokenFicticio|access_token/, 'token nos cabeçalhos');
  for (const line of state.logs) {
    assert.doesNotMatch(line, /tokenFicticio|access_token|api\.mapbox\.com/, `token ou URL em log: ${line}`);
  }
};

test.afterEach(() => {
  delete process.env.MAPBOX_TOKEN;
});

test('sem sessão responde 401 e papéis fora de manager/owner respondem 403, sem chamar o provedor', async (t) => {
  process.env.MAPBOX_TOKEN = FAKE_TOKEN;
  const state = setup(t);

  assert.equal((await geocodeRequest()).status, 401);
  for (const role of ['athlete', 'judge']) {
    const response = await geocodeRequest({ user: { id: `user-${role}`, name: role, email: `${role}@example.com`, role } });
    assert.equal(response.status, 403, role);
  }
  assert.equal(state.calls.length, 0);
});

test('rate limit por usuário: a 11ª chamada no minuto responde 429', async (t) => {
  process.env.MAPBOX_TOKEN = FAKE_TOKEN;
  const manager = freshManager();
  const state = setup(t, { users: [manager] });

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    assert.equal((await geocodeRequest({ user: manager })).status, 200, `chamada ${attempt}`);
  }
  const blocked = await geocodeRequest({ user: manager });
  assert.equal(blocked.status, 429);
  assert.equal(state.calls.length, 10, 'a chamada bloqueada não chega ao provedor');

  // Outro gestor não é afetado pelo limite do primeiro.
  const other = freshManager();
  database.rows('users').push(other);
  assert.equal((await geocodeRequest({ user: other })).status, 200);
});

test('corpo inválido responde 400 sem chamar o provedor', async (t) => {
  process.env.MAPBOX_TOKEN = FAKE_TOKEN;
  const manager = freshManager();
  const state = setup(t, { users: [manager] });

  const invalidBodies = [
    { body: {} },
    { body: { query: 42 } },
    { body: { query: ['Arena'] } },
    { body: { query: '  ab  ' } },
    { body: { query: 'x'.repeat(201) } },
    { rawBody: '{"query":' },
    { rawBody: 'null' }
  ];
  for (const input of invalidBodies) {
    const result = await readResponse(await geocodeRequest({ user: manager, ...input }));
    assert.equal(result.status, 400, JSON.stringify(input).slice(0, 60));
    assert.match(result.body.error, /Informe o endereço para a busca, com 3 a 200 caracteres/);
  }
  assert.equal(state.calls.length, 0);
});

test('sem MAPBOX_TOKEN (ausente, vazio ou só espaços) responde 503 com mensagem clara e não chama o provedor', async (t) => {
  const manager = freshManager();
  const state = setup(t, { users: [manager] });

  for (const token of [undefined, '', '   ']) {
    if (token === undefined) delete process.env.MAPBOX_TOKEN;
    else process.env.MAPBOX_TOKEN = token;
    const result = await readResponse(await geocodeRequest({ user: manager }));
    assert.equal(result.status, 503, JSON.stringify(token));
    assert.match(result.body.error, /busca por endereço está indisponível/);
    assert.match(result.body.error, /Cole as coordenadas no campo "Coordenadas \(lat, lng\)"/);
  }
  assert.equal(state.calls.length, 0);
});

test('o token é lido no momento da requisição', async (t) => {
  const manager = freshManager();
  setup(t, { users: [manager] });

  assert.equal((await geocodeRequest({ user: manager })).status, 503);
  process.env.MAPBOX_TOKEN = FAKE_TOKEN;
  assert.equal((await geocodeRequest({ user: manager })).status, 200);
  delete process.env.MAPBOX_TOKEN;
  assert.equal((await geocodeRequest({ user: manager })).status, 503);
});

test('com token chama só o host fixo do Mapbox v6 forward, com permanent=true e limit=5', async (t) => {
  process.env.MAPBOX_TOKEN = FAKE_TOKEN;
  const manager = freshManager();
  const state = setup(t, { users: [manager] });

  const result = await readResponse(await geocodeRequest({ user: manager, body: { query: '  Arena Beach & Fit #2, João Pessoa, PB  ' } }));
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { candidates: [] });

  assert.equal(state.calls.length, 1);
  const called = new URL(state.calls[0].url);
  assert.equal(called.origin, 'https://api.mapbox.com');
  assert.equal(called.pathname, '/search/geocode/v6/forward');
  assert.equal(called.searchParams.get('q'), 'Arena Beach & Fit #2, João Pessoa, PB');
  assert.equal(called.searchParams.get('limit'), '5');
  assert.equal(called.searchParams.get('permanent'), 'true');
  assert.equal(called.searchParams.get('country'), null, 'sem país no corpo, sem filtro de país');
  assert.equal(called.searchParams.get('access_token'), FAKE_TOKEN);
  assert.equal(state.calls[0].init.method, 'GET');
  assert.ok(state.calls[0].init.signal instanceof AbortSignal, 'chamada sem timeout');
  assertTokenNeverLeaks(result, state);
});

test('o cliente não escolhe o host: campos extras no corpo são ignorados', async (t) => {
  process.env.MAPBOX_TOKEN = FAKE_TOKEN;
  const manager = freshManager();
  const state = setup(t, { users: [manager] });

  const result = await geocodeRequest({
    user: manager,
    body: { query: 'Arena Beach', url: 'http://169.254.169.254/latest/meta-data', endpoint: 'https://evil.example', access_token: 'outro' }
  });
  assert.equal(result.status, 200);
  assert.equal(state.calls.length, 1);
  const called = new URL(state.calls[0].url);
  assert.equal(called.origin, 'https://api.mapbox.com');
  assert.equal(called.searchParams.get('access_token'), FAKE_TOKEN);
  assert.equal(called.searchParams.getAll('access_token').length, 1);
});

test('country (Story 1.42): BR, PT e GB em qualquer caixa viram country=<minúsculas> no provedor', async (t) => {
  process.env.MAPBOX_TOKEN = FAKE_TOKEN;
  const manager = freshManager();
  const state = setup(t, { users: [manager] });

  for (const [sent, expected] of [['BR', 'br'], ['br', 'br'], [' pt ', 'pt'], ['Gb', 'gb']]) {
    state.calls.length = 0;
    const result = await readResponse(await geocodeRequest({ user: manager, body: { query: 'Arena Beach, Lisboa', country: sent } }));
    assert.equal(result.status, 200, JSON.stringify(sent));
    assert.equal(new URL(state.calls[0].url).searchParams.get('country'), expected, JSON.stringify(sent));
  }
  // Vazio ou nulo equivale a não informar o país.
  for (const empty of ['', null]) {
    state.calls.length = 0;
    const result = await readResponse(await geocodeRequest({ user: manager, body: { query: 'Arena Beach', country: empty } }));
    assert.equal(result.status, 200, JSON.stringify(empty));
    assert.equal(new URL(state.calls[0].url).searchParams.get('country'), null);
  }
});

test('country fora de BR, PT e GB responde 400 sem chamar o provedor', async (t) => {
  process.env.MAPBOX_TOKEN = FAKE_TOKEN;
  const manager = freshManager();
  const state = setup(t, { users: [manager] });

  for (const country of ['FR', 'BRA', 42, ['BR'], { code: 'BR' }, 'br,pt', '../etc']) {
    const result = await readResponse(await geocodeRequest({ user: manager, body: { query: 'Arena Beach', country } }));
    assert.equal(result.status, 400, JSON.stringify(country));
    assert.match(result.body.error, /País inválido para a busca\. Use BR, PT ou GB\./);
  }
  assert.equal(state.calls.length, 0);
});

test('responde até 5 candidatos válidos com rótulo e descarta coordenadas inválidas', async (t) => {
  process.env.MAPBOX_TOKEN = FAKE_TOKEN;
  const manager = freshManager();
  const features = [
    feature({ label: 'Arena Beach, Avenida Cabo Branco, João Pessoa - Paraíba 58045, Brasil', latitude: -7.1195, longitude: -34.845 }),
    feature({ label: 'Latitude fora da faixa', latitude: 95, longitude: -34.8 }),
    feature({ label: 'Longitude como texto', latitude: -7.1, longitude: '-34.8' }),
    feature({ name: 'Arena Beach', placeFormatted: 'Cabedelo, Paraíba, Brasil', latitude: -6.98, longitude: -34.83 }),
    feature({ label: 'Só na geometria', latitude: -7.2, longitude: -34.9, withPropertyCoordinates: false }),
    feature({ latitude: -7.3, longitude: -34.7 }),
    feature({ label: 'Zero é válido', latitude: 0, longitude: 0 }),
    feature({ label: 'Quinto válido', latitude: -8.05, longitude: -34.9 }),
    feature({ label: 'Sexto válido (excede o limite)', latitude: -9, longitude: -35 })
  ];
  const state = setup(t, { users: [manager], provider: () => jsonResponse({ type: 'FeatureCollection', features }) });

  const result = await readResponse(await geocodeRequest({ user: manager }));
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.candidates, [
    { label: 'Arena Beach, Avenida Cabo Branco, João Pessoa - Paraíba 58045, Brasil', latitude: -7.1195, longitude: -34.845 },
    { label: 'Arena Beach, Cabedelo, Paraíba, Brasil', latitude: -6.98, longitude: -34.83 },
    { label: 'Só na geometria', latitude: -7.2, longitude: -34.9 },
    { label: 'Zero é válido', latitude: 0, longitude: 0 },
    { label: 'Quinto válido', latitude: -8.05, longitude: -34.9 }
  ]);
  assertTokenNeverLeaks(result, state);
});

test('parseMapboxCandidates tolera respostas inesperadas', () => {
  for (const body of [null, 'texto', 42, [], {}, { features: 'x' }, { features: [null, 1, 'a', { properties: null }] }]) {
    assert.deepEqual(parseMapboxCandidates(body), [], JSON.stringify(body));
  }
  const longLabel = 'A'.repeat(500);
  const [candidate] = parseMapboxCandidates({ features: [feature({ label: longLabel, latitude: 1, longitude: 2 })] });
  assert.equal(candidate.label.length, 300);
});

test('falha do provedor (5xx, 401, 403, 422, rede, timeout, JSON inválido) responde 502 genérico sem vazar token', async (t) => {
  process.env.MAPBOX_TOKEN = FAKE_TOKEN;
  const manager = freshManager();
  let scenario = null;
  const providerBody = { message: `Not Authorized - Invalid Token ${FAKE_TOKEN}` };
  const state = setup(t, {
    users: [manager],
    provider: () => {
      if (scenario === 'network') throw new TypeError(`fetch failed https://api.mapbox.com/search/geocode/v6/forward?access_token=${FAKE_TOKEN}`);
      if (scenario === 'timeout') throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      if (scenario === 'invalid-json') return new Response(`<html>${FAKE_TOKEN}</html>`, { status: 200 });
      return jsonResponse(providerBody, scenario);
    }
  });

  const expectedLogs = {
    500: '"reason":"status","providerStatus":500',
    503: '"reason":"status","providerStatus":503',
    401: '"reason":"status","providerStatus":401',
    403: '"reason":"status","providerStatus":403',
    422: '"reason":"status","providerStatus":422',
    network: '"reason":"network","providerStatus":null',
    timeout: '"reason":"timeout","providerStatus":null',
    'invalid-json': '"reason":"invalid_response","providerStatus":200'
  };
  for (const [name, expectedLog] of Object.entries(expectedLogs)) {
    scenario = Number.isNaN(Number(name)) ? name : Number(name);
    state.logs.length = 0;
    const result = await readResponse(await geocodeRequest({ user: manager }));
    assert.equal(result.status, 502, name);
    assert.equal(result.body.error, 'Não foi possível buscar o endereço agora. Tente novamente em instantes ou cole as coordenadas.');
    assert.ok(state.logs.some((line) => line.includes('[Geocode API] Falha no provedor:') && line.includes(expectedLog)), `${name}: ${state.logs.join(' | ')}`);
    assertTokenNeverLeaks(result, state);
  }
});

test('gestor com acesso expirado é bloqueado antes de chamar o provedor; owner passa', async (t) => {
  process.env.MAPBOX_TOKEN = FAKE_TOKEN;
  const state = setup(t);

  const expired = await readResponse(await geocodeRequest({ user: EXPIRED_MANAGER }));
  assert.equal(expired.status, 403);
  assert.equal(expired.body.code, 'manager_access_expired');
  assert.equal(state.calls.length, 0);

  const owner = await geocodeRequest({ user: { id: 'owner-geo', name: 'Owner', email: 'owner@example.com', role: 'owner' } });
  assert.equal(owner.status, 200);
  assert.equal(state.calls.length, 1);
});

test('a rota segue a ordem sessão, rate limit, validade do gestor, corpo e provedor', () => {
  const order = [
    "requireSession(request, ['manager', 'owner'])",
    'checkRateLimit({',
    'assertManagerOperationalAccess(createSupabaseAdmin(), actor)',
    'await request.json()',
    'GEOCODE_QUERY_MIN_LENGTH ||',
    'await geocodeAddress(query, { country })'
  ];
  let cursor = -1;
  for (const marker of order) {
    const index = geocodeRoute.indexOf(marker, cursor + 1);
    assert.ok(index > cursor, `fora de ordem ou ausente: ${marker}`);
    cursor = index;
  }
  assert.match(geocodeRoute, /key: `admin-geocode:\$\{actor\.id\}`/);
  assert.match(geocodeRoute, /const GEOCODE_RATE_LIMIT = 10;/);
  assert.match(geocodeRoute, /\{ status: 503 \}/);
  assert.match(geocodeRoute, /\{ status: 502 \}/);
});

test('o módulo do provedor é isolado, com host fixo, timeout de 5 s e sem log da URL', () => {
  assert.match(serverGeocoding, /const MAPBOX_FORWARD_GEOCODING_URL = 'https:\/\/api\.mapbox\.com\/search\/geocode\/v6\/forward';/);
  assert.match(serverGeocoding, /export const GEOCODE_TIMEOUT_MS = 5000;/);
  assert.match(serverGeocoding, /signal: AbortSignal\.timeout\(GEOCODE_TIMEOUT_MS\)/);
  assert.match(serverGeocoding, /searchParams\.set\('permanent', 'true'\)/);
  assert.match(serverGeocoding, /searchParams\.set\('limit', String\(GEOCODE_MAX_CANDIDATES\)\)/);
  assert.match(serverGeocoding, /process\.env\.MAPBOX_TOKEN/);
  assert.doesNotMatch(serverGeocoding, /console\./);
  assert.doesNotMatch(geocodeRoute, /process\.env|fetch\(|mapbox\.com/);
});

test('o token de servidor só aparece no módulo do provedor; o do navegador, só no helper e no next.config.ts', () => {
  const srcDir = new URL('../src/', import.meta.url);
  const walk = (dir) => readdirSync(dir).flatMap((name) => {
    const url = new URL(name, dir);
    return statSync(url).isDirectory() ? walk(new URL(`${name}/`, dir)) : [url];
  });
  const mentionsOf = (pattern) => walk(srcDir)
    .filter((url) => pattern.test(readFileSync(url, 'utf8')))
    .map((url) => url.pathname.slice(srcDir.pathname.length));
  // Token de servidor (sem o prefixo NEXT_PUBLIC_): só o módulo do provedor lê.
  assert.deepEqual(mentionsOf(/(?<!NEXT_PUBLIC_)MAPBOX_TOKEN/), ['lib/serverGeocoding.ts']);
  assert.doesNotMatch(serverGeocoding, /^'use client'/m);
  // Token do navegador (Story 1.42): só o helper lê, e é ele que o Next troca pelo valor.
  assert.deepEqual(mentionsOf(/NEXT_PUBLIC_MAPBOX_TOKEN/), ['lib/mapboxPublicToken.ts']);
  assert.match(read('../src/lib/mapboxPublicToken.ts'), /process\.env\.NEXT_PUBLIC_MAPBOX_TOKEN/);
  assert.match(read('../next.config.ts'), /NEXT_PUBLIC_MAPBOX_TOKEN: process\.env\.NEXT_PUBLIC_MAPBOX_TOKEN \|\| process\.env\.MAPBOX_TOKEN \|\| ""/);

  for (const clientFile of ['../src/app/admin/page.tsx', '../src/context/AppContext.tsx', '../src/components/admin/EventLocationPicker.tsx']) {
    assert.doesNotMatch(read(clientFile), /MAPBOX_TOKEN|access_token|api\.mapbox\.com/, clientFile);
  }

  const envExample = read('../.env.example');
  assert.match(envExample, /^MAPBOX_TOKEN=$/m);
  assert.match(envExample, /^NEXT_PUBLIC_MAPBOX_TOKEN=$/m);
  const mapboxBlock = envExample.match(/# Mapbox: mapa do local do evento[\s\S]*?^NEXT_PUBLIC_MAPBOX_TOKEN=$/m)?.[0] || '';
  assert.match(mapboxBlock, /permanent=true/);
  assert.match(mapboxBlock, /POST \/api\/admin\/geocode responde 503/);
  assert.match(mapboxBlock, /qualquer visitante consegue copiá-lo/);
  assert.match(mapboxBlock, /token público restrito por URL/);
  const claudeMd = read('../CLAUDE.md');
  assert.match(claudeMd, /`MAPBOX_TOKEN`[^\n]*permanent=true/);
  assert.match(claudeMd, /`NEXT_PUBLIC_MAPBOX_TOKEN`[^\n]*Mapbox GL JS/);
});
