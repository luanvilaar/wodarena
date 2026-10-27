import assert from 'node:assert/strict';
import test from 'node:test';

import { createFakeSupabase } from './support/fakeSupabase.mjs';
import { importServerModule, setActiveSupabaseClient } from './support/serverModuleHarness.mjs';

// Stories 1.83 e 1.84: as rotas reais de pagamento e a rota do gestor, contra um
// banco em memória, nos dois modos de quem paga a taxa. Mercado Pago, Stripe e
// e-mail são simulados no fetch. Nada de rede, banco real ou .env.

process.env.SUPABASE_URL = 'http://supabase.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';
process.env.WODA_SESSION_SECRET = 'segredo-de-teste-story-1-82';
process.env.MERCADOPAGO_CLIENT_ID = 'mp-client-de-teste';
process.env.STRIPE_SECRET_KEY = 'sk_test_story_1_82';
process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_story_1_82';
delete process.env.MERCADOPAGO_PLATFORM_USER_ID;

let database = null;
setActiveSupabaseClient({
  from: (table) => database.client.from(table),
  rpc: (name, args) => database.client.rpc(name, args)
});

const { POST: postPix } = await importServerModule('app/api/checkout/pix/route.ts');
const { POST: postCard } = await importServerModule('app/api/checkout/card/route.ts');
const { POST: postPreference } = await importServerModule('app/api/checkout/preference/route.ts');
const { GET: getConfig } = await importServerModule('app/api/checkout/config/route.ts');
const { GET: getSettings, PUT: putSettings } = await importServerModule('app/api/admin/payment-settings/route.ts');
const { GET: getOwnerFee } = await importServerModule('app/api/owner/service-fee/route.ts');
const { createRegistrationAccessToken, createSessionToken } = await importServerModule('lib/serverSecurity.ts');

const EVENT_ID = 'evt-1-82';
const EURO_EVENT_ID = 'evt-1-82-pt';
const MANAGER_ID = 'mgr-1-82';
const OTHER_MANAGER_ID = 'mgr-2-82';
const OWNER_ID = 'owner-1-82';
const ATHLETE_USER_ID = 'ath-user-ana';
const ATHLETE_ID = 'ath-4f1d2c3b-6e7a-4b8c-9d0e-1f2a3b4c5d6e';
const REG_ID = 'reg-1f2e3d4c-5b6a-4987-8a6b-5c4d3e2f1a0b';
const EURO_REG_ID = 'reg-7c6b5a49-3827-4615-9a4b-3c2d1e0f9a8b';
const CPF = '52998224725';

const event = (overrides = {}) => ({
  id: EVENT_ID, name: 'Desafio 1.82', logo_url: '', banner_url: '', status: 'upcoming', location: 'Arena Central',
  date: '2099-06-01', time: '08:00', city: 'Fortaleza', state: 'CE', description: '', organizer_id: MANAGER_ID,
  sponsors: [], format: 'individual', ticket_price: 100, ticket_slots: 100, is_ticketing_active: true,
  registration_deadline: null, rules: '', instagram: '', website: '', event_type: 'functional_fitness',
  country_code: 'BR', currency: 'BRL', payment_gateway: 'mercadopago', default_locale: 'pt-br',
  time_zone: 'America/Fortaleza', shirt_mode: 'included', shirt_addon_price: 0, ...overrides
});

const registration = (overrides = {}) => ({
  id: REG_ID, event_id: EVENT_ID, division_id: 'div-rx', user_id: ATHLETE_USER_ID, athlete_id: ATHLETE_ID,
  athlete_name: 'Ana Souza', athlete_email: 'ana@example.com', athlete_phone: '85999990000', box: 'Box Ana',
  gender: 'female', ticket_type: 'RX', ticket_price: 100, quantity: 1, total_paid: 100, shirt_addon_count: 0,
  shirt_addon_amount: 0, service_fee_percent: 0, service_fee_amount: 0, amount_collected: 100,
  application_fee_charged: 0, coupon_code: null, currency: 'BRL', payment_gateway: 'mercadopago', locale: 'pt-br',
  payment_status: 'payment_pending', payment_method: null, payment_id: null, payment_status_detail: null,
  payment_error_message: null, created_at: '2026-10-28T12:00:00.000Z', updated_at: '2026-10-28T12:00:00.000Z',
  ...overrides
});

const buildSeed = ({ payer, platformEnabled = true } = {}) => ({
  events: [
    event(),
    event({ id: EURO_EVENT_ID, name: 'Desafio 1.82 Lisboa', country_code: 'PT', currency: 'EUR', payment_gateway: 'stripe', default_locale: 'pt-pt', time_zone: 'Europe/Lisbon' })
  ],
  divisions: [{ id: 'div-rx', event_id: EVENT_ID, name: 'RX', price: 100, is_active: true, type: 'individual', category: 'female' }],
  users: [
    { id: MANAGER_ID, name: 'Gestor', email: 'gestor@example.com', role: 'manager', organization: 'Box', service_valid_until: '2099-12-31' },
    { id: OTHER_MANAGER_ID, name: 'Outro', email: 'outro@example.com', role: 'manager', organization: 'Box 2', service_valid_until: '2099-12-31' },
    { id: OWNER_ID, name: 'Dono', email: 'dono@example.com', role: 'owner', organization: 'WODArena' },
    { id: ATHLETE_USER_ID, name: 'Ana Souza', email: 'ana@example.com', role: 'athlete', organization: 'Box Ana' }
  ],
  athletes: [{
    id: ATHLETE_ID, name: 'Ana Souza', box: 'Box Ana', country: 'BR', division_id: 'div-rx', birth_date: '1995-05-05',
    gender: 'female', email: 'ana@example.com', phone: '85999990000', shirt_size: 'M', is_team: false, team_members: '[]'
  }],
  registrations: [registration(), registration({ id: EURO_REG_ID, event_id: EURO_EVENT_ID, currency: 'EUR', payment_gateway: 'stripe', locale: 'pt-pt' })],
  mercadopago_accounts: [{
    user_id: MANAGER_ID, status: 'connected', expires_at: '2099-01-01T00:00:00.000Z', mercadopago_user_id: '123456',
    oauth_client_id: 'mp-client-de-teste', oauth_verified_at: '2026-01-01T00:00:00.000Z', public_key: 'TEST-public-key'
  }],
  mercadopago_secrets: [{ user_id: MANAGER_ID, access_token: 'TEST-access-token', refresh_token: 'TEST-refresh-token' }],
  stripe_accounts: [{ user_id: MANAGER_ID, stripe_account_id: 'acct_test_82', country: 'PT', default_currency: 'EUR', charges_enabled: true, payouts_enabled: true, status: 'connected' }],
  platform_settings: [{ id: true, service_fee_enabled: platformEnabled, service_fee_percent: 10 }],
  manager_payment_settings: payer ? [{ user_id: MANAGER_ID, service_fee_payer: payer }] : []
});

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' }
});

const setup = (t) => {
  const captured = { mp: [], stripeSessions: [] };
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = String(input);
    if (url === 'https://api.mercadopago.com/v1/payments') {
      const body = JSON.parse(init.body);
      captured.mp.push({ body, headers: init.headers });
      return jsonResponse({
        id: 555, status: 'pending', status_detail: 'pending_waiting_transfer',
        fee_details: body.application_fee ? [{ type: 'application_fee', amount: body.application_fee }] : [],
        point_of_interaction: { transaction_data: { qr_code: 'qr', qr_code_base64: 'qr64' } }
      });
    }
    if (url === 'https://api.mercadopago.com/checkout/preferences') {
      const body = JSON.parse(init.body);
      captured.mp.push({ body, headers: init.headers });
      return jsonResponse({ id: 'pref-1', init_point: 'https://mp.test/pay' });
    }
    if (url.startsWith('https://api.stripe.com/')) {
      captured.stripeSessions.push({ url, body: String(init?.body || '') });
      return jsonResponse({ id: 'cs_test_1', object: 'checkout.session', url: 'https://stripe.test/pay' });
    }
    throw new Error(`fetch inesperado no teste: ${url}`);
  });
  return captured;
};

const registrationRow = (id = REG_ID) => structuredClone(database.rows('registrations').find((row) => row.id === id));

const pixRequest = () => postPix(new Request('http://localhost/api/checkout/pix', {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'https://www.wodarena.com.br' },
  body: JSON.stringify({
    registrationData: { id: REG_ID, eventId: EVENT_ID },
    cpf: CPF,
    accessToken: createRegistrationAccessToken({ registrationId: REG_ID, eventId: EVENT_ID, userId: ATHLETE_USER_ID })
  })
}));

const cardRequest = () => postCard(new Request('http://localhost/api/checkout/card', {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'https://www.wodarena.com.br' },
  body: JSON.stringify({
    registrationData: { id: REG_ID, eventId: EVENT_ID },
    token: 'card-token', payment_method_id: 'visa', installments: 1, cpf: CPF,
    accessToken: createRegistrationAccessToken({ registrationId: REG_ID, eventId: EVENT_ID, userId: ATHLETE_USER_ID })
  })
}));

const preferenceRequest = (eventId = EVENT_ID, registrationId = REG_ID) => postPreference(new Request('http://localhost/api/checkout/preference', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    registrationData: { id: registrationId, eventId },
    origin: 'https://www.wodarena.com.br',
    locale: 'pt-br',
    accessToken: createRegistrationAccessToken({ registrationId, eventId, userId: ATHLETE_USER_ID })
  })
}));

test('Pix, atleta paga a taxa: cobra inscrição + 10% e retém os 10% no split', async (t) => {
  const captured = setup(t);
  database = createFakeSupabase(buildSeed({ payer: 'athlete' }));
  const response = await pixRequest();
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const { body } = captured.mp[0];
  assert.equal(body.transaction_amount, 110);
  assert.equal(body.application_fee, 10);
  const row = registrationRow();
  assert.equal(row.service_fee_payer, 'athlete');
  assert.equal(row.service_fee_amount, 10);
  assert.equal(row.amount_collected, 110);
  assert.equal(row.total_paid, 100);
});

test('Pix, gestor absorve a taxa: cobra só a inscrição e retém os mesmos 10% no split', async (t) => {
  const captured = setup(t);
  database = createFakeSupabase(buildSeed({ payer: 'organizer' }));
  const response = await pixRequest();
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const { body } = captured.mp[0];
  assert.equal(body.transaction_amount, 100);
  assert.equal(body.application_fee, 10);
  const row = registrationRow();
  assert.equal(row.service_fee_payer, 'organizer');
  assert.equal(row.service_fee_amount, 10);
  assert.equal(row.amount_collected, 100);
  assert.equal(row.total_paid, 100);
});

test('Pix sem escolha salva (padrão do Mercado Pago): atleta paga, como sempre', async (t) => {
  const captured = setup(t);
  database = createFakeSupabase(buildSeed());
  await pixRequest();
  assert.equal(captured.mp[0].body.transaction_amount, 110);
  assert.equal(registrationRow().service_fee_payer, 'athlete');
});

test('cartão: o valor cobrado e a comissão seguem a escolha do gestor', async (t) => {
  for (const [payer, expected] of [['athlete', 110], ['organizer', 100]]) {
    const captured = setup(t);
    database = createFakeSupabase(buildSeed({ payer }));
    const response = await cardRequest();
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    assert.equal(captured.mp[0].body.transaction_amount, expected, payer);
    assert.equal(captured.mp[0].body.application_fee, 10, payer);
    assert.equal(registrationRow().service_fee_payer, payer);
    t.mock.restoreAll();
  }
});

test('preferência do Mercado Pago: o item "Taxa de serviço" só existe quando o atleta paga', async (t) => {
  const withAthlete = setup(t);
  database = createFakeSupabase(buildSeed({ payer: 'athlete' }));
  assert.equal((await preferenceRequest()).status, 200);
  const itemsAthlete = withAthlete.mp[0].body.items;
  assert.equal(itemsAthlete.length, 2);
  assert.equal(itemsAthlete[1].unit_price, 10);
  assert.equal(withAthlete.mp[0].body.marketplace_fee, 10);
  t.mock.restoreAll();

  const absorbed = setup(t);
  database = createFakeSupabase(buildSeed({ payer: 'organizer' }));
  assert.equal((await preferenceRequest()).status, 200);
  assert.equal(absorbed.mp[0].body.items.length, 1);
  assert.equal(absorbed.mp[0].body.items[0].unit_price, 100);
  assert.equal(absorbed.mp[0].body.marketplace_fee, 10);
  assert.equal(registrationRow().service_fee_payer, 'organizer');
  assert.equal(registrationRow().amount_collected, 100);
});

test('configuração pública do checkout informa quem paga a taxa, com o padrão de cada gateway', async (t) => {
  setup(t);
  const configFor = async (eventId) => {
    const response = await getConfig(new Request(`http://localhost/api/checkout/config?event_id=${eventId}`));
    return { status: response.status, body: await response.json() };
  };

  database = createFakeSupabase(buildSeed());
  assert.equal((await configFor(EVENT_ID)).body.serviceFeePayer, 'athlete');
  assert.equal((await configFor(EURO_EVENT_ID)).body.serviceFeePayer, 'organizer');

  database = createFakeSupabase(buildSeed({ payer: 'organizer' }));
  assert.equal((await configFor(EVENT_ID)).body.serviceFeePayer, 'organizer');
  database = createFakeSupabase(buildSeed({ payer: 'athlete' }));
  assert.equal((await configFor(EURO_EVENT_ID)).body.serviceFeePayer, 'athlete');
});

// --- rota do gestor e leitura do dono ---

const sessionCookie = (id) => {
  const user = buildSeed().users.find((item) => item.id === id);
  return `woda_session=${createSessionToken({ id: user.id, name: user.name, email: user.email, role: user.role })}`;
};

const settingsRequest = (method, userId, body) => {
  const request = new Request('http://localhost/api/admin/payment-settings', {
    method,
    headers: { 'content-type': 'application/json', ...(userId ? { cookie: sessionCookie(userId) } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return method === 'GET' ? getSettings(request) : putSettings(request);
};

test('rota do gestor: sem sessão é 401, atleta é 403 e dado inválido é 400', async (t) => {
  setup(t);
  database = createFakeSupabase(buildSeed());
  assert.equal((await settingsRequest('GET', null)).status, 401);
  assert.equal((await settingsRequest('GET', ATHLETE_USER_ID)).status, 403);
  assert.equal((await settingsRequest('PUT', MANAGER_ID, { serviceFeePayer: 'gestor' })).status, 400);
  assert.equal((await settingsRequest('PUT', MANAGER_ID, {})).status, 400);
  assert.equal(database.rows('manager_payment_settings').length, 0);
});

test('rota do gestor: salva a escolha, devolve a taxa da plataforma e troca sem duplicar a linha', async (t) => {
  setup(t);
  database = createFakeSupabase(buildSeed());

  const before = await (await settingsRequest('GET', MANAGER_ID)).json();
  assert.equal(before.serviceFeePayer, null);
  assert.deepEqual(before.platformFee, { enabled: true, percent: 10 });

  assert.equal((await settingsRequest('PUT', MANAGER_ID, { serviceFeePayer: 'organizer' })).status, 200);
  assert.equal((await (await settingsRequest('GET', MANAGER_ID)).json()).serviceFeePayer, 'organizer');
  assert.equal((await settingsRequest('PUT', MANAGER_ID, { serviceFeePayer: 'athlete' })).status, 200);
  assert.equal((await (await settingsRequest('GET', MANAGER_ID)).json()).serviceFeePayer, 'athlete');
  assert.equal(database.rows('manager_payment_settings').length, 1);
});

test('rota do gestor: um gestor não altera a escolha de outro', async (t) => {
  setup(t);
  database = createFakeSupabase(buildSeed());
  const response = await settingsRequest('PUT', OTHER_MANAGER_ID, { serviceFeePayer: 'organizer', userId: MANAGER_ID });
  assert.equal(response.status, 403);
  assert.equal(database.rows('manager_payment_settings').length, 0);
});

test('rota do gestor informa a taxa da plataforma desligada para a tela esconder o cartão', async (t) => {
  setup(t);
  database = createFakeSupabase(buildSeed({ platformEnabled: false }));
  const body = await (await settingsRequest('GET', MANAGER_ID)).json();
  assert.equal(body.platformFee.enabled, false);
});

test('o dono lê quem paga em cada gestor, só leitura; gestor não acessa essa rota', async (t) => {
  setup(t);
  database = createFakeSupabase(buildSeed({ payer: 'organizer' }));
  const ownerResponse = await getOwnerFee(new Request('http://localhost/api/owner/service-fee', { headers: { cookie: sessionCookie(OWNER_ID) } }));
  assert.equal(ownerResponse.status, 200);
  assert.deepEqual((await ownerResponse.json()).payers, { [MANAGER_ID]: 'organizer' });

  const managerResponse = await getOwnerFee(new Request('http://localhost/api/owner/service-fee', { headers: { cookie: sessionCookie(MANAGER_ID) } }));
  assert.equal(managerResponse.status, 403);
});
