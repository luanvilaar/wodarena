import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

import { createFakeSupabase } from './support/fakeSupabase.mjs';
import { importServerModule, setActiveSupabaseClient } from './support/serverModuleHarness.mjs';

// Story 1.39: o servidor é a única fonte dos identificadores e da data de
// criação das inscrições, e a criação só insere: uma inscrição existente nunca
// muda por causa de uma nova requisição de criação. Os testes de comportamento
// executam a rota e o serverCheckout reais contra um banco em memória.

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const block = (source, pattern) => source.match(pattern)?.[0] || '';

const startRouteSource = read('../src/app/api/registrations/start/route.ts');
const serverCheckoutSource = read('../src/lib/serverCheckout.ts');
const registerModalSource = read('../src/components/RegisterModal.tsx');

const paymentRoutes = {
  card: read('../src/app/api/checkout/card/route.ts'),
  pix: read('../src/app/api/checkout/pix/route.ts'),
  preference: read('../src/app/api/checkout/preference/route.ts'),
  status: read('../src/app/api/checkout/status/route.ts'),
  coupon: read('../src/app/api/checkout/coupon/route.ts'),
  config: read('../src/app/api/checkout/config/route.ts'),
  mercadopagoWebhook: read('../src/app/api/webhooks/mercadopago/route.ts'),
  stripeWebhook: read('../src/app/api/webhooks/stripe/route.ts'),
  stripeReturn: read('../src/app/api/stripe/return/route.ts')
};

// Ambiente de teste: valores fictícios, sem .env e sem rede.
process.env.SUPABASE_URL = 'http://supabase.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';
process.env.WODA_SESSION_SECRET = 'segredo-de-teste-story-1-39';
process.env.MERCADOPAGO_CLIENT_ID = 'mp-client-de-teste';
delete process.env.MERCADOPAGO_PLATFORM_USER_ID;

const { POST: startRegistration } = await importServerModule('app/api/registrations/start/route.ts');
const serverCheckout = await importServerModule('lib/serverCheckout.ts');
const { verifyRegistrationAccessToken } = await importServerModule('lib/serverSecurity.ts');
const { isServerAthleteId, isServerRegistrationId } = await importServerModule('lib/registrationIds.ts');

const EVENT_ID = 'evt-1-39';
const MANAGER_ID = 'mgr-1-39';
const EXISTING_UUID = '0b7c1f8e-5a8d-4c55-9a51-2f0c3c6a1d10';
const EXISTING_REGISTRATION_ID = `reg-${EXISTING_UUID}`;
const EXISTING_ATHLETE_ID = 'ath-4f1d2c3b-6e7a-4b8c-9d0e-1f2a3b4c5d6e';
const BROWSER_CREATED_AT = '2000-01-01T00:00:00.000Z';
const ACTIVE_REGISTRATION_MESSAGE = 'Este e-mail já possui uma inscrição ativa para este evento.';

// Preço informado como undefined continua undefined (não cai no padrão de 150).
const optionOr = (options, key, fallback) => (Object.hasOwn(options, key) ? options[key] : fallback);

const buildSeed = (options = {}) => {
  const divisionPrice = optionOr(options, 'divisionPrice', 150);
  const eventTicketPrice = optionOr(options, 'eventTicketPrice', 150);
  return {
    events: [{
      id: EVENT_ID,
      name: 'Desafio 1.39',
      status: 'upcoming',
      date: '2099-06-01',
      registration_deadline: null,
      is_ticketing_active: true,
      ticket_price: eventTicketPrice,
      ticket_slots: 100,
      shirt_mode: 'included',
      shirt_addon_price: 0,
      organizer_id: MANAGER_ID
    }],
    divisions: [{
      id: 'div-rx',
      event_id: EVENT_ID,
      name: 'RX',
      price: divisionPrice,
      slots_limit: 0,
      is_active: true,
      type: 'individual',
      category: 'female'
    }],
    users: [
      { id: MANAGER_ID, name: 'Gestor', email: 'gestor@example.com', role: 'manager', organization: 'Box', service_valid_until: '2099-12-31' },
      { id: 'ath-user-ana', name: 'Ana Souza', email: 'ana@example.com', role: 'athlete', organization: 'Box Ana' }
    ],
    users_secrets: [{ user_id: 'ath-user-ana', password: 'scrypt$sal$hash' }],
    athletes: [{
      id: EXISTING_ATHLETE_ID,
      name: 'Ana Souza',
      box: 'Box Ana',
      country: 'BR',
      division_id: 'div-rx',
      email: 'ana@example.com',
      phone: '85999990000',
      shirt_size: 'M',
      is_team: false,
      team_members: '[]'
    }],
    registrations: [{
      id: EXISTING_REGISTRATION_ID,
      event_id: EVENT_ID,
      division_id: 'div-rx',
      user_id: 'ath-user-ana',
      athlete_id: EXISTING_ATHLETE_ID,
      athlete_name: 'Ana Souza',
      athlete_email: 'ana@example.com',
      athlete_phone: '85999990000',
      box: 'Box Ana',
      gender: 'female',
      ticket_type: 'RX',
      ticket_price: 150,
      quantity: 1,
      total_paid: 150,
      shirt_addon_count: 0,
      shirt_addon_amount: 0,
      service_fee_percent: 10,
      service_fee_amount: 15,
      amount_collected: 165,
      application_fee_charged: 15,
      coupon_code: null,
      payment_status: 'payment_approved',
      payment_method: 'pix',
      created_at: '2026-09-01T12:00:00.000Z',
      updated_at: '2026-09-01T12:05:00.000Z'
    }],
    coupons: [{ event_id: EVENT_ID, code: 'DEZ', discount_type: 'percentage', discount_value: 10, usage_limit: 0, usage_count: 0, is_active: true }],
    mercadopago_accounts: [{
      user_id: MANAGER_ID,
      status: 'connected',
      expires_at: '2099-01-01T00:00:00.000Z',
      mercadopago_user_id: '123456',
      oauth_client_id: 'mp-client-de-teste',
      oauth_verified_at: '2026-01-01T00:00:00.000Z',
      public_key: 'TEST-public-key'
    }],
    mercadopago_secrets: [{ user_id: MANAGER_ID, access_token: 'TEST-access-token', refresh_token: 'TEST-refresh-token' }],
    platform_settings: [{ id: true, service_fee_enabled: true, service_fee_percent: 10 }]
  };
};

const seedDatabase = (options) => {
  const database = createFakeSupabase(buildSeed(options));
  setActiveSupabaseClient(database.client);
  return database;
};

// Linhas novas entram no fim da tabela; as que já existiam ficam nas mesmas posições.
const assertExistingRowsUnchanged = (before, database) => {
  for (const [table, rows] of Object.entries(before)) {
    assert.deepEqual(database.rows(table).slice(0, rows.length), rows, `linhas existentes de ${table}`);
  }
};

const registrationWrites = (database) => database.operations
  .filter((operation) => operation.table === 'registrations' && operation.action !== 'select')
  .map((operation) => operation.action);

let requestCount = 0;

const postStart = async (body) => {
  requestCount += 1;
  const response = await startRegistration(new Request('http://localhost/api/registrations/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.51.100.${requestCount}` },
    body: JSON.stringify(body)
  }));
  return { status: response.status, body: await response.json() };
};

const startBody = ({
  name = 'Bia Lima',
  email = 'bia@example.com',
  browserRegistrationId = EXISTING_REGISTRATION_ID,
  browserAthleteId = EXISTING_ATHLETE_ID,
  paymentMethod = 'pix'
} = {}) => ({
  registrationData: {
    id: browserRegistrationId,
    eventId: EVENT_ID,
    divisionId: 'div-rx',
    athleteName: name,
    athleteEmail: email,
    athletePhone: '85988887777',
    box: 'Box Bia',
    gender: 'female',
    ticketType: 'RX',
    ticketPrice: 150,
    quantity: 1,
    totalPaid: 150,
    createdAt: BROWSER_CREATED_AT
  },
  athleteProfile: {
    id: browserAthleteId,
    name,
    box: 'Box Bia',
    country: 'BR',
    divisionId: 'div-rx',
    birthDate: '1995-05-05',
    city: 'Fortaleza',
    state: 'CE',
    photoUrl: '',
    shirtSize: 'M',
    email,
    phone: '85988887777',
    gender: 'female',
    instagram: 'bia',
    isTeam: false,
    teamMembers: []
  },
  password: 'segredo1',
  passwordConfirmation: 'segredo1',
  paymentMethod
});

const silenceServerLogs = (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'log', () => {});
};

// ---------------------------------------------------------------------------
// Regressão estática
// ---------------------------------------------------------------------------

test('a rota de criação só insere e grava id, atleta e data de criação do servidor', () => {
  assert.doesNotMatch(startRouteSource, /upsert|onConflict/);
  assert.doesNotMatch(startRouteSource, /(?:safeR|r)egistrationData\.(?:id|createdAt)\b/);
  assert.doesNotMatch(startRouteSource, /(?:safeA|a)thleteProfile\.id\b/);
  assert.doesNotMatch(startRouteSource, /(?:reg|ath)-\$\{Date\.now\(\)\}/);

  assert.match(startRouteSource, /import \{ createAthleteId \} from '@\/lib\/registrationIds';/);
  assert.match(startRouteSource, /const regId = secureSnapshot\.registrationId;/);
  assert.match(startRouteSource, /let athleteId = createAthleteId\(\);/);
  assert.match(startRouteSource, /created_at: now,/);
  assert.match(startRouteSource, /\.from\('registrations'\)\s*\.insert\(registrationPayload\)\s*\.select\('\*'\)\s*\.single\(\);/);
  assert.match(
    startRouteSource,
    /if \(regError\?\.code === '23505'\) \{\s*return NextResponse\.json\(\{\s*error: 'Este e-mail já possui uma inscrição ativa para este evento\.'\s*\}, \{ status: 409 \}\);/
  );

  // A resposta e o token continuam apontando para a inscrição do servidor.
  assert.match(startRouteSource, /createRegistrationAccessToken\(\{\s*registrationId: regId,/);
  assert.match(startRouteSource, /registrationData: \{\s*\.\.\.safeRegistrationData,\s*id: regId,/);
  assert.match(startRouteSource, /createdAt: dbRegistration\.created_at,/);
  assert.match(startRouteSource, /accessToken: registrationAccessToken/);
  assert.match(startRouteSource, /athleteProfile: \{\s*\.\.\.safeAthleteProfile,\s*id: athleteId,/);
});

const snapshotBlock = block(serverCheckoutSource, /export const calculateSecureRegistrationSnapshot[\s\S]*?\n\};/);
const couponBlock = block(serverCheckoutSource, /export const validateCheckoutCoupon[\s\S]*?\n\};/);
const managerBlock = block(serverCheckoutSource, /export const createManagerRegistration[\s\S]*?\n\};/);

test('snapshot e Bilheteria usam o gerador de identificadores do servidor', () => {
  assert.match(serverCheckoutSource, /import \{ createAthleteId, createRegistrationId \} from '@\/lib\/registrationIds';/);

  assert.ok(snapshotBlock, 'calculateSecureRegistrationSnapshot deve existir');
  assert.match(snapshotBlock, /const clientRegistrationData = omitFields\(registrationData, \['id', 'createdAt'\]\);/);
  assert.match(snapshotBlock, /const clientAthleteProfile = omitFields\(athleteProfile, \['id'\]\);/);
  assert.match(snapshotBlock, /const registrationId = createRegistrationId\(\);/);
  assert.doesNotMatch(snapshotBlock, /registrationData\.(?:id|createdAt)\b|athleteProfile\.id\b|Date\.now/);

  assert.ok(managerBlock, 'createManagerRegistration deve existir');
  assert.match(managerBlock, /let athleteId = createAthleteId\(\);/);
  assert.match(managerBlock, /const regId = createRegistrationId\(\);/);
  assert.doesNotMatch(managerBlock, /(?:reg|ath)-\$\{Date\.now\(\)\}/);
});

test('preço da categoria: snapshot e cupom usam a mesma regra, sem cair em zero', () => {
  assert.doesNotMatch(serverCheckoutSource, /asNumber\(division\.price/);
  assert.match(snapshotBlock, /const ticketPrice = resolveTicketPrice\(division\.price, event\.ticket_price\);/);
  assert.match(couponBlock, /const ticketPrice = resolveTicketPrice\(division\.price, event\.ticket_price\);/);
  assert.match(serverCheckoutSource, /throw new RegistrationAccessError\(MISSING_TICKET_PRICE_MESSAGE, 409\);/);
});

test('nenhuma rota de pagamento muda nesta fase', () => {
  for (const [name, source] of Object.entries(paymentRoutes)) {
    assert.doesNotMatch(source, /registrationIds|createRegistrationId|createAthleteId|resolveTicketPrice/, `rota ${name}`);
  }
});

const handleSubmitBlock = block(registerModalSource, /const handleSubmit = useCallback\([\s\S]*?\n {2}\}, \[/);

test('no navegador, os ids locais só aparecem no pedido de início', () => {
  assert.ok(handleSubmitBlock, 'handleSubmit deve existir');
  // Declaração + o campo id de cada objeto enviado ao início; nenhum outro uso.
  assert.equal(handleSubmitBlock.match(/\bregId\b/g)?.length, 2);
  assert.equal(handleSubmitBlock.match(/\bathleteId\b/g)?.length, 2);
  assert.match(handleSubmitBlock, /const registrationData = \{\s*id: regId,/);
  assert.match(handleSubmitBlock, /const athleteProfile = \{\s*id: athleteId,/);
  // Tudo depois do início sai da resposta do servidor.
  const afterStart = handleSubmitBlock.slice(handleSubmitBlock.indexOf('const activeRegistrationData = started.registrationData;'));
  assert.ok(afterStart.length > 0);
  assert.doesNotMatch(afterStart, /registrationData\.id|athleteProfile\.id|\bregId\b|\bathleteId\b/);
});

// ---------------------------------------------------------------------------
// Banco em memória: pré-condição dos testes de comportamento
// ---------------------------------------------------------------------------

test('o banco em memória recusa chave repetida com 23505 e não grava nada', async () => {
  const database = seedDatabase();
  const before = database.snapshot();
  const duplicateId = await database.client
    .from('registrations')
    .insert({ ...before.registrations[0], athlete_email: 'outra@example.com' })
    .select('*')
    .single();
  assert.equal(duplicateId.error?.code, '23505');
  assert.equal(duplicateId.data, null);

  const duplicateActiveEmail = await database.client
    .from('registrations')
    .insert({ ...before.registrations[0], id: 'reg-outra' });
  assert.equal(duplicateActiveEmail.error?.code, '23505');
  assert.deepEqual(database.snapshot(), before);

  // Inscrição cancelada não ocupa o e-mail no evento (índice parcial).
  const cancelled = await database.client
    .from('registrations')
    .insert({ ...before.registrations[0], id: 'reg-cancelada', payment_status: 'payment_cancelled' });
  assert.equal(cancelled.error, null);
});

// ---------------------------------------------------------------------------
// Rota /api/registrations/start executada de verdade
// ---------------------------------------------------------------------------

test('segunda criação com o mesmo id enviado pelo navegador cria inscrição nova e não altera a existente', async (t) => {
  silenceServerLogs(t);
  const database = seedDatabase();
  const before = database.snapshot();

  const startedAt = Date.now();
  const { status, body } = await postStart(startBody());
  const finishedAt = Date.now();

  assert.equal(status, 200, JSON.stringify(body));
  const newId = body.registrationData.id;
  assert.notEqual(newId, EXISTING_REGISTRATION_ID);
  assert.equal(isServerRegistrationId(newId), true, newId);

  // Tudo o que já existia continua igual; só entram linhas novas.
  assertExistingRowsUnchanged(before, database);
  assert.equal(database.rows('registrations').length, before.registrations.length + 1);
  assert.deepEqual(registrationWrites(database), ['insert']);

  const created = database.rows('registrations').find((row) => row.id === newId);
  assert.ok(created, 'a nova inscrição foi gravada com o id devolvido');
  assert.equal(created.athlete_email, 'bia@example.com');
  assert.equal(created.payment_status, 'payment_pending');
  assert.equal(created.payment_method, 'pix');
  assert.equal(created.total_paid, 150);
  assert.equal(created.amount_collected, 165);

  // Data de criação do servidor, não a do navegador.
  assert.notEqual(created.created_at, BROWSER_CREATED_AT);
  const createdAtMs = Date.parse(created.created_at);
  assert.ok(createdAtMs >= startedAt && createdAtMs <= finishedAt, created.created_at);
  assert.equal(created.updated_at, created.created_at);
  assert.equal(body.registrationData.createdAt, created.created_at);

  // Atleta novo com id do servidor; o atleta existente fica como estava.
  assert.notEqual(created.athlete_id, EXISTING_ATHLETE_ID);
  assert.equal(isServerAthleteId(created.athlete_id), true, created.athlete_id);
  const newAthlete = database.rows('athletes').find((row) => row.id === created.athlete_id);
  assert.equal(newAthlete?.email, 'bia@example.com');
  assert.equal(body.athleteProfile.id, created.athlete_id);
  assert.equal(body.registrationData.athleteId, created.athlete_id);

  // O token devolvido dá acesso à inscrição nova, e só a ela.
  const claims = verifyRegistrationAccessToken(body.registrationData.accessToken);
  assert.equal(claims?.sub, newId);
  assert.equal(claims?.eventId, EVENT_ID);
  assert.equal(claims?.userId, created.user_id);
});

test('o mesmo id enviado em duas criações gera duas inscrições distintas, sem depender do relógio', async (t) => {
  silenceServerLogs(t);
  t.mock.method(Date, 'now', () => 1_760_000_000_000);
  const database = seedDatabase();
  const before = database.snapshot();
  const browserRegistrationId = 'reg-1760000000000';
  const browserAthleteId = 'ath-1760000000000';

  const first = await postStart(startBody({ email: 'bia@example.com', browserRegistrationId, browserAthleteId }));
  const second = await postStart(startBody({ name: 'Carla Melo', email: 'carla@example.com', browserRegistrationId, browserAthleteId }));

  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(second.status, 200, JSON.stringify(second.body));
  const ids = [first.body.registrationData.id, second.body.registrationData.id];
  const athleteIds = [first.body.athleteProfile.id, second.body.athleteProfile.id];
  assert.notEqual(ids[0], ids[1]);
  assert.notEqual(athleteIds[0], athleteIds[1]);
  for (const id of ids) {
    assert.equal(isServerRegistrationId(id), true, id);
    assert.notEqual(id, browserRegistrationId);
  }
  for (const id of athleteIds) {
    assert.equal(isServerAthleteId(id), true, id);
    assert.notEqual(id, browserAthleteId);
  }

  assertExistingRowsUnchanged(before, database);
  assert.deepEqual(database.rows('registrations').slice(-2).map((row) => row.id), ids);
  assert.deepEqual(registrationWrites(database), ['insert', 'insert']);
});

test('conflito de chave na inserção devolve 409 com a mensagem de inscrição ativa e não altera nenhuma linha', async (t) => {
  silenceServerLogs(t);
  const database = seedDatabase();
  const before = database.snapshot();
  // O gerador repete o id de uma inscrição já gravada: a inserção conflita pela chave.
  t.mock.method(globalThis.crypto, 'randomUUID', () => EXISTING_UUID);

  const { status, body } = await postStart(startBody({ browserRegistrationId: 'reg-qualquer' }));

  assert.equal(status, 409, JSON.stringify(body));
  assert.deepEqual(body, { error: ACTIVE_REGISTRATION_MESSAGE });
  assertExistingRowsUnchanged(before, database);
  assert.equal(database.rows('registrations').length, before.registrations.length);
  assert.deepEqual(registrationWrites(database), ['insert']);
  assert.deepEqual(database.rpcCalls, []);
});

test('inscrição do mesmo e-mail gravada por outra requisição antes da inserção: 409 e a outra fica intacta', async (t) => {
  silenceServerLogs(t);
  const database = seedDatabase();
  const competitor = {
    ...database.rows('registrations')[0],
    id: 'reg-6a2e9c4d-1b3f-4e5a-8c7d-9e0f1a2b3c4d',
    user_id: 'ath-user-bia',
    athlete_email: 'bia@example.com',
    athlete_name: 'Bia Lima',
    payment_status: 'payment_pending',
    created_at: '2026-10-14T10:00:00.000Z'
  };
  database.onceBeforeInsert('registrations', (db) => {
    db.rows('registrations').push(structuredClone(competitor));
  });
  const before = database.snapshot();

  const { status, body } = await postStart(startBody());

  assert.equal(status, 409, JSON.stringify(body));
  assert.deepEqual(body, { error: ACTIVE_REGISTRATION_MESSAGE });
  assertExistingRowsUnchanged(before, database);
  assert.deepEqual(database.rows('registrations').find((row) => row.id === competitor.id), competitor);
  assert.equal(database.rows('registrations').length, before.registrations.length + 1);
  assert.deepEqual(registrationWrites(database), ['insert']);
});

test('categoria com 0 explícito continua gratuita: nasce aprovada e conta o cupom pela inscrição do servidor', async (t) => {
  silenceServerLogs(t);
  const database = seedDatabase({ divisionPrice: 0, eventTicketPrice: 150 });
  const before = database.snapshot();

  const { status, body } = await postStart(startBody());

  assert.equal(status, 200, JSON.stringify(body));
  const created = database.rows('registrations').find((row) => row.id === body.registrationData.id);
  assert.equal(isServerRegistrationId(created?.id), true);
  assert.equal(created.ticket_price, 0);
  assert.equal(created.total_paid, 0);
  assert.equal(created.payment_status, 'payment_approved');
  assert.equal(created.payment_method, 'free');
  assert.deepEqual(database.rpcCalls, [{ name: 'apply_coupon_usage', args: { p_registration_id: created.id } }]);
  assertExistingRowsUnchanged(before, database);
});

test('categoria e evento sem preço: a criação é recusada antes de gravar qualquer coisa', async (t) => {
  silenceServerLogs(t);
  const database = seedDatabase({ divisionPrice: null, eventTicketPrice: null });
  const before = database.snapshot();

  const { status, body } = await postStart(startBody());

  assert.equal(status, 409, JSON.stringify(body));
  assert.deepEqual(body, { error: serverCheckout.MISSING_TICKET_PRICE_MESSAGE });
  assert.deepEqual(database.snapshot(), before);
});

// ---------------------------------------------------------------------------
// serverCheckout executado de verdade
// ---------------------------------------------------------------------------

const snapshotInput = () => ({
  registrationData: {
    id: EXISTING_REGISTRATION_ID,
    createdAt: BROWSER_CREATED_AT,
    eventId: EVENT_ID,
    divisionId: 'div-rx',
    athleteName: 'Bia Lima',
    athleteEmail: 'bia@example.com',
    quantity: 1
  },
  athleteProfile: { id: EXISTING_ATHLETE_ID, name: 'Bia Lima', shirtSize: 'M', city: 'Fortaleza' }
});

test('o snapshot descarta id e data de criação da inscrição e o id do atleta enviados pelo navegador', async () => {
  const database = seedDatabase();
  const input = snapshotInput();
  const original = structuredClone(input);

  const first = await serverCheckout.calculateSecureRegistrationSnapshot(database.client, input.registrationData, input.athleteProfile);
  const second = await serverCheckout.calculateSecureRegistrationSnapshot(database.client, input.registrationData, input.athleteProfile);

  for (const snapshot of [first, second]) {
    assert.equal(isServerRegistrationId(snapshot.registrationId), true, snapshot.registrationId);
    assert.equal(snapshot.registrationData.id, snapshot.registrationId);
    assert.equal(Object.hasOwn(snapshot.registrationData, 'createdAt'), false);
    assert.equal(Object.hasOwn(snapshot.athleteProfile, 'id'), false);
    // Os demais dados seguem, com os valores calculados no servidor.
    assert.equal(snapshot.registrationData.athleteName, 'Bia Lima');
    assert.equal(snapshot.athleteProfile.city, 'Fortaleza');
    assert.equal(snapshot.registrationData.ticketPrice, 150);
    assert.equal(snapshot.transactionAmount, 150);
  }
  assert.notEqual(first.registrationId, second.registrationId);
  // A entrada do navegador não é modificada.
  assert.deepEqual(input, original);
});

const PRICE_CASES = [
  { label: 'categoria com preço próprio', divisionPrice: 120, eventTicketPrice: 150, expected: 120 },
  { label: 'categoria sem preço (null) usa o do evento', divisionPrice: null, eventTicketPrice: 90, expected: 90 },
  { label: 'categoria sem o campo usa o do evento', divisionPrice: undefined, eventTicketPrice: 90, expected: 90 },
  { label: 'preço em branco usa o do evento', divisionPrice: '  ', eventTicketPrice: 90, expected: 90 },
  { label: 'preço em texto numérico', divisionPrice: '75.5', eventTicketPrice: 90, expected: 75.5 },
  { label: '0 explícito na categoria é gratuito', divisionPrice: 0, eventTicketPrice: 150, expected: 0 },
  { label: '0 explícito no evento é gratuito', divisionPrice: null, eventTicketPrice: 0, expected: 0 }
];

test('preço da categoria: sem valor usa o do evento e 0 explícito é gratuito; snapshot e cupom concordam', async () => {
  for (const { label, divisionPrice, eventTicketPrice, expected } of PRICE_CASES) {
    const database = seedDatabase({ divisionPrice, eventTicketPrice });
    const input = snapshotInput();
    const snapshot = await serverCheckout.calculateSecureRegistrationSnapshot(database.client, input.registrationData, input.athleteProfile);
    assert.equal(snapshot.registrationData.ticketPrice, expected, label);
    assert.equal(snapshot.transactionAmount, expected, label);

    const coupon = await serverCheckout.validateCheckoutCoupon(database.client, EVENT_ID, 'div-rx', 'DEZ');
    assert.equal(coupon.ticketPrice, expected, `${label} (cupom)`);
    // Cupom DEZ: 10% sobre o preço resolvido.
    assert.equal(coupon.discount, expected / 10, `${label} (cupom)`);
  }
});

test('categoria e evento sem preço: snapshot e cupom recusam com a mesma mensagem (409)', async () => {
  const missing = [[null, null], [undefined, undefined], ['', null], [null, '   ']];
  const isMissingPrice = (error) => (
    error instanceof serverCheckout.RegistrationAccessError
    && error.status === 409
    && error.message === serverCheckout.MISSING_TICKET_PRICE_MESSAGE
  );
  for (const [divisionPrice, eventTicketPrice] of missing) {
    const database = seedDatabase({ divisionPrice, eventTicketPrice });
    const input = snapshotInput();
    await assert.rejects(
      serverCheckout.calculateSecureRegistrationSnapshot(database.client, input.registrationData, input.athleteProfile),
      isMissingPrice,
      `snapshot com ${String(divisionPrice)} / ${String(eventTicketPrice)}`
    );
    await assert.rejects(
      serverCheckout.validateCheckoutCoupon(database.client, EVENT_ID, 'div-rx', 'DEZ'),
      isMissingPrice,
      `cupom com ${String(divisionPrice)} / ${String(eventTicketPrice)}`
    );
  }
  assert.equal(serverCheckout.MISSING_TICKET_PRICE_MESSAGE, 'Esta categoria ainda não tem valor de inscrição definido. Fale com a organização do evento.');
});

test('a Bilheteria cria inscrição e atleta com ids do servidor, sem depender do relógio', async (t) => {
  t.mock.method(Date, 'now', () => 1_760_000_000_000);
  const database = seedDatabase();
  const before = database.snapshot();
  const manualInput = (athleteName, athleteEmail) => ({
    eventId: EVENT_ID,
    divisionId: 'div-rx',
    athleteName,
    athleteEmail,
    athletePhone: '85911112222',
    gender: 'female',
    shirtSize: 'G'
  });

  const first = await serverCheckout.createManagerRegistration(database.client, manualInput('Carla Melo', 'carla@example.com'));
  const second = await serverCheckout.createManagerRegistration(database.client, manualInput('Dani Rocha', 'dani@example.com'));

  for (const result of [first, second]) {
    assert.equal(isServerRegistrationId(result.registration.id), true, String(result.registration.id));
    assert.equal(isServerAthleteId(result.registration.athlete_id), true, String(result.registration.athlete_id));
    assert.equal(result.athlete?.id, result.registration.athlete_id);
    assert.equal(result.registration.payment_method, 'manual');
  }
  assert.notEqual(first.registration.id, second.registration.id);
  assert.notEqual(first.registration.athlete_id, second.registration.athlete_id);
  assertExistingRowsUnchanged(before, database);
  assert.deepEqual(registrationWrites(database), ['insert', 'insert']);
});

// ---------------------------------------------------------------------------
// Navegador: o handleSubmit real do RegisterModal com dependências falsas
// ---------------------------------------------------------------------------

const handleSubmitSource = registerModalSource.match(/const handleSubmit = useCallback\((async \(e: React\.FormEvent\) => \{[\s\S]*?\n {2}\}), \[/)?.[1] || '';
const SUBMIT_DEPS = [
  'acceptedTerms', 'alert', 't', 'visibleParticipants', 'isFitnessRacing', 'isTeamCategory', 'teamName', 'box',
  'primaryParticipant', 'athletePassword', 'athletePasswordConfirmation', 'paymentMethod', 'isValidCPF', 'cpf',
  'setIsProcessing', 'selectedDivision', 'normalizeInstagram', 'generateUniqueId', 'event', 'selectedDivisionId',
  'ticketPrice', 'totalPaid', 'appliedCoupon', 'serverUpdatedCheckout', 'setAmountsUpdatedNotice', 'startRegistration',
  'toMinorUnits', 'setServerUpdatedCheckout', 'formatMoney', 'locale', 'registerTicket', 'fetch', 'onSuccess',
  'setIsSuccess', 'sessionStorage', 'setPixData', 'getCheckoutErrorMessage', 'window', 'console'
];

const loadHandleSubmit = async () => {
  assert.ok(handleSubmitSource, 'handleSubmit deve existir');
  const compiled = ts.transpileModule(
    `export const create = ({ ${SUBMIT_DEPS.join(', ')} }) => (${handleSubmitSource});`,
    { fileName: 'handle-submit.ts', compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }
  ).outputText;
  return (await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)).create;
};

const SERVER_REGISTRATION_ID = 'reg-9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
const SERVER_ATHLETE_ID = 'ath-1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const SERVER_TOKEN = 'token-do-servidor';
const PARTICIPANT = {
  name: 'Bia Lima', email: 'bia@example.com', phone: '85988887777', gender: 'female', birthDate: '',
  city: '', state: '', instagram: '@bia', photoUrl: '', shirtSize: 'M'
};

const serverStart = (overrides = {}) => ({
  registrationData: {
    id: SERVER_REGISTRATION_ID,
    accessToken: SERVER_TOKEN,
    athleteId: SERVER_ATHLETE_ID,
    totalPaid: 150,
    amountCollected: 165,
    paymentStatus: 'payment_pending',
    createdAt: '2026-10-14T12:00:00.000Z',
    ...overrides
  },
  athleteProfile: { id: SERVER_ATHLETE_ID, name: 'Bia Lima', email: 'bia@example.com' }
});

// Os ids locais mudam a cada envio, como no navegador.
let localIdSequence = 0;
const LOCAL_ID = /\b(?:reg|ath)-local-\d+\b/;

const submit = async (create, { paymentMethod = 'pix', totalPaid = 150, start = serverStart(), stored = null }) => {
  const calls = { starts: [], fetches: [], stored: [], storage: [], tickets: [], successes: [], redirects: [], alerts: [], pix: null };
  const handleSubmit = create({
    acceptedTerms: true,
    alert: (message) => { calls.alerts.push(message); },
    t: (key, values) => (values ? `${key} ${JSON.stringify(values)}` : key),
    visibleParticipants: [PARTICIPANT],
    isFitnessRacing: false,
    isTeamCategory: false,
    teamName: '',
    box: '',
    primaryParticipant: PARTICIPANT,
    athletePassword: 'segredo1',
    athletePasswordConfirmation: 'segredo1',
    paymentMethod,
    isValidCPF: () => true,
    cpf: '12345678909',
    setIsProcessing: () => {},
    selectedDivision: { id: 'div-rx', name: 'RX', type: 'individual' },
    normalizeInstagram: (value) => value.replace(/^@/, ''),
    generateUniqueId: (prefix) => `${prefix}-local-${++localIdSequence}`,
    event: { id: EVENT_ID, currency: 'BRL' },
    selectedDivisionId: 'div-rx',
    ticketPrice: 150,
    totalPaid,
    appliedCoupon: null,
    serverUpdatedCheckout: stored,
    setAmountsUpdatedNotice: () => {},
    startRegistration: async (registrationData, athleteProfile) => {
      calls.starts.push(structuredClone({ registrationData, athleteProfile }));
      return structuredClone(start);
    },
    toMinorUnits: (amount) => Math.round(amount * 100),
    setServerUpdatedCheckout: (value) => { calls.stored.push(value); },
    formatMoney: (amount) => `R$ ${amount.toFixed(2)}`,
    locale: 'pt-br',
    registerTicket: (registration, athlete) => {
      calls.tickets.push(structuredClone({ registration, athlete }));
      return { ...registration };
    },
    fetch: async (url, init) => {
      calls.fetches.push({ url, body: init?.body ? JSON.parse(init.body) : null });
      return {
        ok: true,
        json: async () => ({ paymentId: 'pay-1', qr_code: 'qr', qr_code_base64: 'qr64', redirectUrl: 'https://pagamento.test/checkout' })
      };
    },
    onSuccess: (registration) => { calls.successes.push(structuredClone(registration)); },
    setIsSuccess: () => {},
    sessionStorage: { setItem: (key, value) => { calls.storage.push({ key, value: JSON.parse(value) }); } },
    setPixData: (value) => { calls.pix = value; },
    getCheckoutErrorMessage: async (_response, fallback) => fallback,
    window: { location: { origin: 'http://localhost', assign: (url) => { calls.redirects.push(url); } } },
    console: { log() {}, error() {} }
  });
  await handleSubmit({ preventDefault() {} });
  return calls;
};

const assertOnlyServerIds = (calls) => {
  for (const value of [calls.fetches, calls.storage, calls.tickets, calls.successes, calls.pix]) {
    assert.doesNotMatch(JSON.stringify(value ?? null), LOCAL_ID);
  }
};

test('Pix: depois do início, cobrança, polling e reenvio usam só o id e o token do servidor', async () => {
  const create = await loadHandleSubmit();
  const calls = await submit(create, { paymentMethod: 'pix' });

  assert.deepEqual(calls.alerts, []);
  assert.equal(calls.starts.length, 1);
  // O id local vai só como sugestão no pedido de início.
  assert.match(calls.starts[0].registrationData.id, /^reg-local-\d+$/);
  assert.match(calls.starts[0].athleteProfile.id, /^ath-local-\d+$/);

  assert.deepEqual(calls.fetches.map((call) => call.url), ['/api/checkout/pix']);
  const [pix] = calls.fetches;
  assert.equal(pix.body.registrationData.id, SERVER_REGISTRATION_ID);
  assert.equal(pix.body.athleteProfile.id, SERVER_ATHLETE_ID);
  assert.equal(pix.body.accessToken, SERVER_TOKEN);
  // O polling de status lê estes valores.
  assert.equal(calls.pix.registrationId, SERVER_REGISTRATION_ID);
  assert.equal(calls.pix.accessToken, SERVER_TOKEN);
  assert.equal(calls.storage[0].key, 'pending_registration');
  assert.equal(calls.storage[0].value.registrationData.id, SERVER_REGISTRATION_ID);
  assertOnlyServerIds(calls);
});

test('Cartão (preference): a cobrança usa só o id e o token do servidor', async () => {
  const create = await loadHandleSubmit();
  const calls = await submit(create, { paymentMethod: 'credit_card' });

  assert.deepEqual(calls.alerts, []);
  assert.deepEqual(calls.fetches.map((call) => call.url), ['/api/checkout/preference']);
  const [preference] = calls.fetches;
  assert.equal(preference.body.registrationData.id, SERVER_REGISTRATION_ID);
  assert.equal(preference.body.athleteProfile.id, SERVER_ATHLETE_ID);
  assert.equal(preference.body.accessToken, SERVER_TOKEN);
  assert.deepEqual(calls.redirects, ['https://pagamento.test/checkout']);
  assertOnlyServerIds(calls);
});

test('Gratuita: registro local, e-mail e sucesso usam só a inscrição do servidor', async () => {
  const create = await loadHandleSubmit();
  const calls = await submit(create, {
    totalPaid: 0,
    start: serverStart({ totalPaid: 0, amountCollected: 0, paymentStatus: 'payment_approved' })
  });

  assert.deepEqual(calls.alerts, []);
  // O e-mail da gratuita sai do servidor (Story 1.76): o navegador não chama mais /api/checkout/email.
  assert.deepEqual(calls.fetches.map((call) => call.url), []);
  assert.equal(calls.successes[0].accessToken, SERVER_TOKEN, 'o comprovante recebe o token da inscrição');
  assert.equal(calls.tickets[0].registration.id, SERVER_REGISTRATION_ID);
  assert.equal(calls.tickets[0].athlete.id, SERVER_ATHLETE_ID);
  assert.equal(calls.successes[0].id, SERVER_REGISTRATION_ID);
  assertOnlyServerIds(calls);
});

test('reenvio idêntico com novos ids locais reaproveita a inscrição do servidor (Story 1.38)', async () => {
  const create = await loadHandleSubmit();
  // Total do servidor diferente do exibido: a resposta fica guardada e nada é cobrado.
  const first = await submit(create, { totalPaid: 0, start: serverStart({ totalPaid: 60, amountCollected: 66 }) });
  const stored = first.stored.at(-1);
  assert.equal(stored?.registrationData.id, SERVER_REGISTRATION_ID);
  assert.deepEqual(first.fetches, []);

  // Mesmo formulário, outros ids locais: segue com a inscrição guardada, sem novo início.
  const resend = await submit(create, { totalPaid: 0, stored });
  assert.equal(resend.starts.length, 0);
  assert.deepEqual(resend.stored, []);
  assert.deepEqual(resend.fetches.map((call) => call.url), ['/api/checkout/pix']);
  assert.equal(resend.fetches[0].body.registrationData.id, SERVER_REGISTRATION_ID);
  assert.equal(resend.fetches[0].body.accessToken, SERVER_TOKEN);
  assertOnlyServerIds(resend);
});
