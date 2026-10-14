import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createFakeSupabase } from './support/fakeSupabase.mjs';
import { importServerModule, setActiveSupabaseClient } from './support/serverModuleHarness.mjs';

// Story 1.41 (AC3, AC4): o ponto do mapa é validado e gravado pela
// persistência administrativa real (banco em memória) e chega ao cliente pelo
// bootstrap, com fallback para banco ainda sem a migration.

process.env.SUPABASE_URL = 'http://supabase.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';
process.env.WODA_SESSION_SECRET = 'segredo-de-teste-story-1-41-persistencia';

let database = createFakeSupabase();
setActiveSupabaseClient({
  from: (table) => database.client.from(table),
  rpc: (name, args) => database.client.rpc(name, args)
});

const { POST: postPersistence } = await importServerModule('app/api/admin/persistence/route.ts');
const { readEventsWithFeaturedFallback, PUBLIC_EVENT_SELECT, PUBLIC_EVENT_SELECT_LEGACY } = await importServerModule('lib/bootstrapPayload.ts');
const { createSessionToken } = await importServerModule('lib/serverSecurity.ts');

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const persistenceRoute = read('../src/app/api/admin/persistence/route.ts');
const bootstrapPayload = read('../src/lib/bootstrapPayload.ts');
const bootstrapRoute = read('../src/app/api/app/bootstrap/route.ts');
const appContext = read('../src/context/AppContext.tsx');
const types = read('../src/types/index.ts');

const block = (source, pattern) => source.match(pattern)?.[0] || '';
const caseBlock = (name) => block(persistenceRoute, new RegExp(`case '${name}': \\{[\\s\\S]*?\\n {6}\\}`));

const MANAGER = { id: 'mgr-mapa', name: 'Gestora Mapa', email: 'mapa@example.com', role: 'manager', service_valid_until: '2099-12-31' };
const OTHER_MANAGER = { id: 'mgr-outro', name: 'Outro Gestor', email: 'outro@example.com', role: 'manager', service_valid_until: '2099-12-31' };
const EXPIRED_MANAGER = { id: 'mgr-expirado', name: 'Gestor Expirado', email: 'exp@example.com', role: 'manager', service_valid_until: '2020-01-01' };
const OWNER = { id: 'owner-mapa', name: 'Owner', email: 'owner@example.com', role: 'owner' };

const existingEvent = (overrides = {}) => ({
  id: 'evt-mapa',
  name: 'Desafio do Mapa',
  organizer_id: MANAGER.id,
  location: 'Arena Beach',
  city: 'João Pessoa',
  state: 'PB',
  event_type: 'functional_fitness',
  event_schedule: [],
  shirt_mode: 'included',
  shirt_addon_price: 0,
  latitude: -7.1195,
  longitude: -34.845,
  ...overrides
});

const newEventRow = (overrides = {}) => ({
  id: 'evt-novo',
  name: 'Evento Novo',
  logo_url: '',
  banner_url: '',
  status: 'upcoming',
  location: 'Arena Beach',
  date: '2099-06-01',
  description: '',
  organizer_id: MANAGER.id,
  sponsors: [],
  format: 'individual',
  ticket_price: 150,
  ticket_slots: 100,
  is_ticketing_active: true,
  time: '',
  city: 'João Pessoa',
  state: 'PB',
  rules: '',
  instagram: '',
  website: '',
  event_type: 'functional_fitness',
  event_schedule: [],
  mp_public_key: null,
  shirt_mode: 'included',
  shirt_addon_price: 0,
  ...overrides
});

const seed = () => {
  database = createFakeSupabase({
    users: [MANAGER, OTHER_MANAGER, EXPIRED_MANAGER, OWNER],
    events: [existingEvent(), existingEvent({ id: 'evt-outro', organizer_id: OTHER_MANAGER.id, latitude: 1, longitude: 2 })]
  });
};

const persist = async (user, action, payload) => {
  const response = await postPersistence(new Request('http://localhost/api/admin/persistence', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `woda_session=${createSessionToken({ id: user.id, name: user.name, email: user.email, role: user.role })}`
    },
    body: JSON.stringify({ action, payload })
  }));
  return { status: response.status, body: await response.json() };
};

const eventRow = (id) => structuredClone(database.rows('events').find((row) => row.id === id));

const quietConsole = (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'info', () => {});
};

test('EVENT_UPDATABLE_FIELDS inclui latitude e longitude', () => {
  const fields = block(persistenceRoute, /const EVENT_UPDATABLE_FIELDS = \[[\s\S]*?\] as const;/);
  assert.match(fields, /'latitude', 'longitude'/);
});

test('createEvent grava o ponto válido, inclusive 0, 0, e ignora a ausência dos campos', async (t) => {
  quietConsole(t);
  seed();
  assert.deepEqual(await persist(MANAGER, 'createEvent', { event: newEventRow({ latitude: -7.1195, longitude: -34.845 }) }), { status: 200, body: { success: true } });
  assert.equal(eventRow('evt-novo').latitude, -7.1195);
  assert.equal(eventRow('evt-novo').longitude, -34.845);

  assert.equal((await persist(MANAGER, 'createEvent', { event: newEventRow({ id: 'evt-zero', latitude: 0, longitude: 0 }) })).status, 200);
  assert.equal(eventRow('evt-zero').latitude, 0);
  assert.equal(eventRow('evt-zero').longitude, 0);

  assert.equal((await persist(MANAGER, 'createEvent', { event: newEventRow({ id: 'evt-sem-ponto' }) })).status, 200);
  const withoutPoint = eventRow('evt-sem-ponto');
  assert.equal('latitude' in withoutPoint, false, 'sem ponto, as colunas não entram no insert');
  assert.equal('longitude' in withoutPoint, false);
});

test('createEvent recusa ponto inválido com 400 em português, sem gravar nada', async (t) => {
  quietConsole(t);
  const invalid = [
    [{ latitude: -7.1195 }, /juntas/],
    [{ longitude: -34.845 }, /juntas/],
    [{ latitude: -7.1195, longitude: null }, /juntas/],
    [{ latitude: '-7.1195', longitude: '-34.845' }, /números válidos/],
    [{ latitude: 91, longitude: 0 }, /latitude \(primeiro número\) precisa estar entre -90 e 90/],
    [{ latitude: 0, longitude: 181 }, /longitude \(segundo número\) precisa estar entre -180 e 180/]
  ];
  for (const [coordinates, pattern] of invalid) {
    seed();
    const before = database.snapshot();
    const result = await persist(MANAGER, 'createEvent', { event: newEventRow(coordinates) });
    assert.equal(result.status, 400, JSON.stringify(coordinates));
    assert.match(result.body.error, pattern, JSON.stringify(coordinates));
    assert.deepEqual(database.snapshot(), before, 'nada gravado');
  }
});

test('updateEvent grava, troca e remove o ponto; sem os campos o ponto não muda', async (t) => {
  quietConsole(t);
  seed();
  assert.equal((await persist(MANAGER, 'updateEvent', { eventId: 'evt-mapa', data: { latitude: -6.98, longitude: -34.83 } })).status, 200);
  assert.deepEqual([eventRow('evt-mapa').latitude, eventRow('evt-mapa').longitude], [-6.98, -34.83]);

  assert.equal((await persist(MANAGER, 'updateEvent', { eventId: 'evt-mapa', data: { name: 'Novo nome' } })).status, 200);
  assert.deepEqual([eventRow('evt-mapa').latitude, eventRow('evt-mapa').longitude], [-6.98, -34.83]);

  assert.equal((await persist(MANAGER, 'updateEvent', { eventId: 'evt-mapa', data: { latitude: 0, longitude: 0 } })).status, 200);
  assert.deepEqual([eventRow('evt-mapa').latitude, eventRow('evt-mapa').longitude], [0, 0]);

  assert.equal((await persist(MANAGER, 'updateEvent', { eventId: 'evt-mapa', data: { latitude: null, longitude: null } })).status, 200);
  assert.deepEqual([eventRow('evt-mapa').latitude, eventRow('evt-mapa').longitude], [null, null]);
});

test('updateEvent exige os dois campos juntos e valida faixa e tipo, sem gravar nada', async (t) => {
  quietConsole(t);
  const invalid = [
    [{ latitude: -7.2 }, /Envie latitude e longitude juntas/],
    [{ longitude: -34.9 }, /Envie latitude e longitude juntas/],
    [{ latitude: null }, /Envie latitude e longitude juntas/],
    [{ latitude: -7.2, longitude: null }, /juntas/],
    [{ latitude: 'abc', longitude: 1 }, /números válidos/],
    [{ latitude: -90.5, longitude: 0 }, /entre -90 e 90/],
    [{ latitude: 0, longitude: -180.5 }, /entre -180 e 180/],
    [{ latitude: -7.2, longitude: -34.9, name: 'Nome junto' }, null]
  ];
  for (const [data, pattern] of invalid) {
    seed();
    const before = database.snapshot();
    const result = await persist(MANAGER, 'updateEvent', { eventId: 'evt-mapa', data });
    if (pattern === null) {
      assert.equal(result.status, 200, 'controle: ponto válido junto com outro campo grava');
      continue;
    }
    assert.equal(result.status, 400, JSON.stringify(data));
    assert.match(result.body.error, pattern, JSON.stringify(data));
    assert.deepEqual(database.snapshot(), before, 'nada gravado');
  }
});

test('ownership e validade do gestor seguem valendo antes de gravar o ponto', async (t) => {
  quietConsole(t);
  seed();
  const before = database.snapshot();

  const otherEvent = await persist(MANAGER, 'updateEvent', { eventId: 'evt-outro', data: { latitude: 5, longitude: 5 } });
  assert.notEqual(otherEvent.status, 200);
  assert.match(otherEvent.body.error, /Acesso negado para este evento/);

  const otherOrganizer = await persist(MANAGER, 'createEvent', { event: newEventRow({ organizer_id: OTHER_MANAGER.id, latitude: 5, longitude: 5 }) });
  assert.equal(otherOrganizer.status, 403);

  const expired = await persist(EXPIRED_MANAGER, 'updateEvent', { eventId: 'evt-mapa', data: { latitude: 5, longitude: 5 } });
  assert.equal(expired.status, 403);
  assert.equal(expired.body.code, 'manager_access_expired');

  assert.deepEqual(database.snapshot(), before);

  // owner pode alterar o ponto de qualquer evento.
  assert.equal((await persist(OWNER, 'updateEvent', { eventId: 'evt-outro', data: { latitude: 5, longitude: 5 } })).status, 200);
  assert.deepEqual([eventRow('evt-outro').latitude, eventRow('evt-outro').longitude], [5, 5]);
});

test('createEvent e updateEvent validam o ponto com validateEventCoordinates depois da checagem de dono', () => {
  assert.match(persistenceRoute, /import \{ validateEventCoordinates \} from '@\/lib\/eventMap'/);
  assert.match(persistenceRoute, /const resolveEventCoordinatesForWrite = [\s\S]*?validateEventCoordinates\(\{ latitude: data\.latitude, longitude: data\.longitude \}\)/);
  const createEvent = caseBlock('createEvent');
  assert.match(createEvent, /event\.organizer_id !== actor\.id[\s\S]*resolveEventCoordinatesForWrite\(event\)[\s\S]*status: 400[\s\S]*\.from\('events'\)\.insert\(event\)/);
  const updateEvent = caseBlock('updateEvent');
  assert.match(updateEvent, /ensureEventOwner\(supabaseAdmin, actor, payload\.eventId\)[\s\S]*resolveEventCoordinatesForWrite\(allowedData\)[\s\S]*status: 400[\s\S]*\.update\(allowedData\)/);
  // Rate limit e validade do gestor continuam antes de qualquer ação.
  assert.match(persistenceRoute, /key: `admin-persistence:\$\{actor\.id\}`[\s\S]*await assertManagerOperationalAccess\(supabaseAdmin, actor\)[\s\S]*switch \(action\)/);
});

test('bootstrap: PUBLIC_EVENT_SELECT termina com latitude, longitude e o legado não as pede', () => {
  assert.match(PUBLIC_EVENT_SELECT, /, shirt_mode, shirt_addon_price, latitude, longitude$/);
  assert.doesNotMatch(PUBLIC_EVENT_SELECT_LEGACY, /latitude|longitude/);
  assert.match(PUBLIC_EVENT_SELECT_LEGACY, /, shirt_mode, shirt_addon_price$/);
  // Os dois bootstraps (público e autenticado) usam o fallback.
  assert.equal((bootstrapPayload.match(/readEventsWithFeaturedFallback\(/g) || []).length, 2);
  assert.equal((bootstrapRoute.match(/readEventsWithFeaturedFallback\(/g) || []).length, 2);
});

test('readEventsWithFeaturedFallback cai no select legado quando falta is_featured, latitude ou longitude', async (t) => {
  const warnings = [];
  t.mock.method(console, 'warn', (...args) => { warnings.push(args.map(String).join(' ')); });
  t.mock.method(console, 'info', () => {});
  t.mock.method(console, 'error', () => {});

  const legacyRows = [{ id: 'evt-1', name: 'Evento', is_featured: true }];
  const missingColumnErrors = [
    { code: '42703', message: 'column events.latitude does not exist' },
    { code: '42703', message: 'column events.longitude does not exist' },
    { code: 'PGRST204', message: "Could not find the 'latitude' column of 'events' in the schema cache" },
    { code: '42703', message: 'column events.is_featured does not exist' }
  ];
  for (const error of missingColumnErrors) {
    let legacyCalls = 0;
    const rows = await readEventsWithFeaturedFallback(
      'eventos de teste',
      async () => ({ data: null, error }),
      async () => { legacyCalls += 1; return { data: structuredClone(legacyRows), error: null }; }
    );
    assert.equal(legacyCalls, 1, error.message);
    assert.deepEqual(rows, [{ id: 'evt-1', name: 'Evento', is_featured: false }], error.message);
  }
  assert.ok(warnings.some((line) => line.includes('"column":"latitude"')));
  assert.ok(warnings.some((line) => line.includes('"column":"is_featured"')));

  // Outros erros não caem no legado.
  for (const error of [
    { code: '42703', message: 'column events.outra_coluna does not exist' },
    { code: 'PGRST116', message: 'latitude' },
    { code: '57014', message: 'canceling statement due to statement timeout' }
  ]) {
    let legacyCalls = 0;
    await assert.rejects(readEventsWithFeaturedFallback(
      'eventos de teste',
      async () => ({ data: null, error }),
      async () => { legacyCalls += 1; return { data: [], error: null }; }
    ), /Falha ao carregar eventos de teste/);
    assert.equal(legacyCalls, 0, error.message);
  }

  // Sem erro, o select completo segue valendo, com o ponto.
  const fullRows = await readEventsWithFeaturedFallback(
    'eventos de teste',
    async () => ({ data: [{ id: 'evt-1', is_featured: true, latitude: -7.1, longitude: -34.8 }], error: null }),
    async () => { throw new Error('não deveria cair no legado'); }
  );
  assert.deepEqual(fullRows, [{ id: 'evt-1', is_featured: true, latitude: -7.1, longitude: -34.8 }]);
});

test('tipo Event e AppContext: ponto só com números válidos, zero não é ausência, addEvent só envia com ponto', () => {
  assert.match(types, /shirtAddonPrice\?: number;\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*latitude\?: number \| null;\s*longitude\?: number \| null;/);
  assert.match(appContext, /import \{ validateEventCoordinates \} from '@\/lib\/eventMap'/);

  const reader = block(appContext, /const readEventMapPoint = [\s\S]*?\n\};/);
  assert.match(reader, /if \(latitude == null \|\| longitude == null\) return \{\};/);
  assert.match(reader, /validateEventCoordinates\(\{ latitude, longitude \}\)/);
  assert.doesNotMatch(reader, /!latitude|!longitude/);

  assert.match(appContext, /shirtAddonPrice: Number\(evt\.shirt_addon_price\) \|\| 0,\s*\.\.\.readEventMapPoint\(evt\.latitude, evt\.longitude\)/);

  const addEvent = block(appContext, /const addEvent = async[\s\S]*?adminPersist\('createEvent'/);
  assert.match(addEvent, /const mapPoint = readEventMapPoint\(eventData\.latitude, eventData\.longitude\);/);
  assert.match(addEvent, /\.\.\.\(mapPoint\.latitude != null && mapPoint\.longitude != null\s*\? \{ latitude: mapPoint\.latitude, longitude: mapPoint\.longitude \}\s*: \{\}\)/);
  assert.doesNotMatch(addEvent, /latitude: newEvent\.latitude \?\? null|latitude: null/);

  const updateEvent = block(appContext, /const updateEvent = async \(eventId: string, updatedData: Partial<Event>\)[\s\S]*?adminPersist\('updateEvent'/);
  assert.match(updateEvent, /if \(updatedData\.latitude !== undefined\) dbPayload\.latitude = updatedData\.latitude;/);
  assert.match(updateEvent, /if \(updatedData\.longitude !== undefined\) dbPayload\.longitude = updatedData\.longitude;/);
});
