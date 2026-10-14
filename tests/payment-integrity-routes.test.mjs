import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test, { afterEach } from 'node:test';

import { createFakeSupabase } from './support/fakeSupabase.mjs';
import { importServerModule, setActiveSupabaseClient } from './support/serverModuleHarness.mjs';

// Story 1.40: as rotas que aprovam inscrição a partir de um pagamento conferem
// que ele corresponde à inscrição, conforme PAYMENT_INTEGRITY_MODE. Os testes
// executam as rotas reais contra um banco em memória, com o Mercado Pago, o
// Stripe e o envio de e-mail simulados no fetch. Nada de rede, banco real ou .env.

process.env.SUPABASE_URL = 'http://supabase.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';
process.env.WODA_SESSION_SECRET = 'segredo-de-teste-story-1-40';
process.env.MERCADOPAGO_CLIENT_ID = 'mp-client-de-teste';
process.env.MERCADOPAGO_WEBHOOK_SECRET = 'segredo-webhook-mp-de-teste';
process.env.STRIPE_SECRET_KEY = 'sk_test_story_1_40';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_story_1_40';
process.env.RESEND_API_KEY = 're_test_story_1_40';
delete process.env.MERCADOPAGO_PLATFORM_USER_ID;
delete process.env.PAYMENT_INTEGRITY_MODE;

// As rotas criam o cliente do banco ao carregar o módulo; este cliente fixo
// repassa cada chamada ao banco em memória do teste em execução.
let database = null;
setActiveSupabaseClient({
  from: (table) => database.client.from(table),
  rpc: (name, args) => database.client.rpc(name, args)
});

const { GET: getCheckoutStatus } = await importServerModule('app/api/checkout/status/route.ts');
const { POST: postMercadoPagoWebhook } = await importServerModule('app/api/webhooks/mercadopago/route.ts');
const { POST: postStripeWebhook } = await importServerModule('app/api/webhooks/stripe/route.ts');
const { reviewPaymentBeforeApproval } = await importServerModule('lib/serverPaymentIntegrity.ts');
const { createRegistrationAccessToken } = await importServerModule('lib/serverSecurity.ts');

afterEach(() => {
  delete process.env.PAYMENT_INTEGRITY_MODE;
});

const LOG_PREFIX = '[Payment Integrity] ';
const EVENT_ID = 'evt-1-40';
const EURO_EVENT_ID = 'evt-1-40-pt';
const MANAGER_ID = 'mgr-1-40';
const ATHLETE_USER_ID = 'ath-user-ana';
const ATHLETE_ID = 'ath-4f1d2c3b-6e7a-4b8c-9d0e-1f2a3b4c5d6e';
const REG_ID = 'reg-1f2e3d4c-5b6a-4987-8a6b-5c4d3e2f1a0b';
const EURO_REG_ID = 'reg-7c6b5a49-3827-4615-9a4b-3c2d1e0f9a8b';
const OTHER_REG_ID = 'reg-9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const MP_PAYMENT_ID = 1324567890;
const PREFERENCE_ID = '987654321-0a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d';
const STRIPE_INTENT_ID = 'pi_3QAbCdEfGh1234567890';

const event = (overrides = {}) => ({
  id: EVENT_ID,
  name: 'Desafio 1.40',
  logo_url: '',
  banner_url: '',
  status: 'upcoming',
  location: 'Arena Central',
  date: '2099-06-01',
  time: '08:00',
  city: 'Fortaleza',
  state: 'CE',
  description: '',
  organizer_id: MANAGER_ID,
  sponsors: [],
  format: 'individual',
  ticket_price: 150,
  ticket_slots: 100,
  is_ticketing_active: true,
  registration_deadline: null,
  rules: '',
  instagram: '',
  website: '',
  event_type: 'functional_fitness',
  country_code: 'BR',
  currency: 'BRL',
  payment_gateway: 'mercadopago',
  default_locale: 'pt-br',
  time_zone: 'America/Fortaleza',
  shirt_mode: 'included',
  shirt_addon_price: 0,
  ...overrides
});

// R$ 150 com cupom de 10% = R$ 135; taxa de serviço de 10% = R$ 13,50. O atleta paga R$ 148,50.
const mpRegistration = (overrides = {}) => ({
  id: REG_ID,
  event_id: EVENT_ID,
  division_id: 'div-rx',
  user_id: ATHLETE_USER_ID,
  athlete_id: ATHLETE_ID,
  athlete_name: 'Ana Souza',
  athlete_email: 'ana@example.com',
  athlete_phone: '85999990000',
  box: 'Box Ana',
  gender: 'female',
  ticket_type: 'RX',
  ticket_price: 150,
  quantity: 1,
  total_paid: 135,
  shirt_addon_count: 0,
  shirt_addon_amount: 0,
  service_fee_percent: 10,
  service_fee_amount: 13.5,
  amount_collected: 148.5,
  application_fee_charged: 0,
  coupon_code: 'DEZ',
  currency: 'BRL',
  payment_gateway: 'mercadopago',
  locale: 'pt-br',
  payment_status: 'payment_pending',
  payment_method: 'pix',
  payment_id: String(MP_PAYMENT_ID),
  payment_status_detail: 'pending_waiting_transfer',
  payment_error_message: null,
  created_at: '2026-10-14T12:00:00.000Z',
  updated_at: '2026-10-14T12:00:00.000Z',
  ...overrides
});

// Gravada pela rota de preferência do Stripe: total_paid 150, taxa 15 retida do total.
const euroRegistration = (overrides = {}) => mpRegistration({
  id: EURO_REG_ID,
  event_id: EURO_EVENT_ID,
  total_paid: 150,
  service_fee_amount: 15,
  amount_collected: 165,
  coupon_code: null,
  currency: 'EUR',
  payment_gateway: 'stripe',
  locale: 'pt-pt',
  payment_method: 'stripe_checkout',
  payment_id: null,
  payment_status_detail: null,
  ...overrides
});

const buildSeed = (registrations) => ({
  events: [event(), event({ id: EURO_EVENT_ID, name: 'Desafio 1.40 Lisboa', country_code: 'PT', currency: 'EUR', payment_gateway: 'stripe', default_locale: 'pt-pt', time_zone: 'Europe/Lisbon' })],
  divisions: [{ id: 'div-rx', event_id: EVENT_ID, name: 'RX', price: 150, is_active: true, type: 'individual', category: 'female' }],
  users: [
    { id: MANAGER_ID, name: 'Gestor', email: 'gestor@example.com', role: 'manager', organization: 'Box', service_valid_until: '2099-12-31' },
    { id: ATHLETE_USER_ID, name: 'Ana Souza', email: 'ana@example.com', role: 'athlete', organization: 'Box Ana' }
  ],
  athletes: [{
    id: ATHLETE_ID,
    name: 'Ana Souza',
    box: 'Box Ana',
    country: 'BR',
    division_id: 'div-rx',
    birth_date: '1995-05-05',
    gender: 'female',
    email: 'ana@example.com',
    phone: '85999990000',
    shirt_size: 'M',
    is_team: false,
    team_members: '[]'
  }],
  registrations: registrations || [mpRegistration(), euroRegistration()],
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
});

// GET /v1/payments/{id} do Mercado Pago.
const mpPayment = (overrides = {}) => ({
  id: MP_PAYMENT_ID,
  status: 'approved',
  status_detail: 'accredited',
  transaction_amount: 148.5,
  currency_id: 'BRL',
  payment_method_id: 'pix',
  date_approved: '2026-10-14T12:03:00.000-03:00',
  metadata: { registration_id: REG_ID, event_id: EVENT_ID },
  fee_details: [{ type: 'application_fee', amount: 13.5 }],
  payer: { email: 'ana@example.com' },
  ...overrides
});

// PaymentIntent do Checkout do Stripe na conta conectada.
const stripeIntent = (overrides = {}) => ({
  id: STRIPE_INTENT_ID,
  object: 'payment_intent',
  status: 'succeeded',
  amount: 15000,
  amount_received: 15000,
  application_fee_amount: 1500,
  currency: 'eur',
  last_payment_error: null,
  metadata: { registration_id: EURO_REG_ID, event_id: EURO_EVENT_ID },
  ...overrides
});

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' }
});

const setMode = (mode) => {
  if (mode === undefined) delete process.env.PAYMENT_INTEGRITY_MODE;
  else process.env.PAYMENT_INTEGRITY_MODE = mode;
};

// Instala uma vez por teste os simuladores de fetch e de console; cada
// execução (run) começa com banco, pagamentos e registros novos.
const setup = (t) => {
  const state = { payments: [], search: null, emails: [], warnings: [], errors: [] };
  t.mock.method(console, 'warn', (...args) => { state.warnings.push(args.map(String).join(' ')); });
  t.mock.method(console, 'error', (...args) => { state.errors.push(args.map(String).join(' ')); });
  t.mock.method(console, 'log', () => {});
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = String(input);
    if (url === 'https://api.resend.com/emails') {
      state.emails.push(JSON.parse(init.body));
      return jsonResponse({ id: `email-${state.emails.length}` });
    }
    if (url.startsWith('https://api.mercadopago.com/v1/payments/search')) {
      return jsonResponse({ results: state.search ?? state.payments });
    }
    const byId = url.match(/^https:\/\/api\.mercadopago\.com\/v1\/payments\/([^/?]+)$/);
    if (byId) {
      const payment = state.payments.find((item) => String(item.id) === decodeURIComponent(byId[1]));
      return payment ? jsonResponse(payment) : jsonResponse({ message: 'Payment not found' }, 404);
    }
    throw new Error(`fetch inesperado no teste: ${url}`);
  });

  const run = async ({ mode, payments = [], search = null, registrations, request, registrationId = REG_ID }) => {
    setMode(mode);
    Object.assign(state, { payments, search, emails: [], warnings: [], errors: [] });
    database = createFakeSupabase(buildSeed(registrations));
    const response = await request();
    const integrityLines = state.warnings.filter((line) => line.startsWith(LOG_PREFIX));
    return {
      status: response.status,
      body: await response.json(),
      row: structuredClone(database.rows('registrations').find((row) => row.id === registrationId)),
      couponCalls: database.rpcCalls.filter((call) => call.name === 'apply_coupon_usage').map((call) => call.args.p_registration_id),
      emails: state.emails.length,
      integrityLines,
      integrity: integrityLines.map((line) => JSON.parse(line.slice(LOG_PREFIX.length))),
      errors: [...state.errors]
    };
  };

  return { run, state };
};

const accessToken = (registrationId = REG_ID, eventId = EVENT_ID) => createRegistrationAccessToken({ registrationId, eventId, userId: ATHLETE_USER_ID });

const statusRequest = (params) => () => getCheckoutStatus(
  new Request(`http://localhost/api/checkout/status?${new URLSearchParams(params)}`)
);

// Polling do Pix: payment_id da consulta + registration_id + token de acesso.
const pixPolling = () => statusRequest({
  payment_id: String(MP_PAYMENT_ID),
  event_id: EVENT_ID,
  registration_id: REG_ID,
  access_token: accessToken()
});

// Sem payment_id: pagamento persistido ou busca por registration_id.
const byRegistration = () => statusRequest({ event_id: EVENT_ID, registration_id: REG_ID, access_token: accessToken() });

const mpWebhookRequest = (paymentId = MP_PAYMENT_ID) => () => {
  const id = String(paymentId);
  const requestId = 'req-story-1-40';
  const ts = String(Math.floor(Date.now() / 1000));
  const v1 = createHmac('sha256', process.env.MERCADOPAGO_WEBHOOK_SECRET)
    .update(`id:${id};request-id:${requestId};ts:${ts};`)
    .digest('hex');
  return postMercadoPagoWebhook(new Request(`http://localhost/api/webhooks/mercadopago?event_id=${EVENT_ID}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-request-id': requestId, 'x-signature': `ts=${ts},v1=${v1}` },
    body: JSON.stringify({ action: 'payment.updated', type: 'payment', data: { id } })
  }));
};

// Assinatura calculada como a do Stripe: HMAC-SHA256 de `${t}.${payload}`.
const stripeWebhookRequest = (intent) => () => {
  const payload = JSON.stringify({
    id: 'evt_1QStory140',
    object: 'event',
    api_version: '2025-08-27.basil',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type: 'payment_intent.succeeded',
    data: { object: intent }
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(`${timestamp}.${payload}`).digest('hex');
  return postStripeWebhook(new Request('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': `t=${timestamp},v1=${signature}` },
    body: payload
  }));
};

const withoutUpdatedAt = (row) => {
  const copy = structuredClone(row);
  delete copy.updated_at;
  return copy;
};

const STATUS_RESPONSE_KEYS = ['athleteProfile', 'cpf', 'registrationData', 'status'];

const assertApproved = (outcome, { registrationId = REG_ID, statusDetail = 'accredited' } = {}) => {
  assert.equal(outcome.status, 200, JSON.stringify(outcome.body));
  assert.equal(outcome.row.payment_status, 'payment_approved');
  assert.equal(outcome.row.payment_status_detail, statusDetail);
  assert.deepEqual(outcome.couponCalls, [registrationId]);
  assert.equal(outcome.emails, 1);
};

const assertHeldForReview = (outcome) => {
  assert.equal(outcome.status, 200, JSON.stringify(outcome.body));
  assert.equal(outcome.row.payment_status, 'payment_in_review');
  assert.equal(outcome.row.payment_status_detail, 'payment_integrity_mismatch');
  assert.deepEqual(outcome.couponCalls, []);
  assert.equal(outcome.emails, 0);
};

const assertSingleWarning = (outcome, expected) => {
  assert.equal(outcome.integrityLines.length, 1, outcome.integrityLines.join('\n'));
  assert.doesNotMatch(outcome.integrityLines[0], /\n|@|Ana Souza/);
  assert.deepEqual(outcome.integrity[0], expected);
};

const mpWarning = (overrides = {}) => ({
  mode: 'observe',
  source: 'mp-status',
  registrationId: REG_ID,
  eventId: EVENT_ID,
  paymentId: String(MP_PAYMENT_ID),
  reasons: ['amount_mismatch'],
  expected: 148.5,
  paid: 135,
  currency: 'BRL',
  ...overrides
});

// ---------------------------------------------------------------------------
// /api/checkout/status: payment_id da consulta (polling do Pix)
// ---------------------------------------------------------------------------

test('status: pagamento correspondente aprova em todos os modos, sem aviso', async (t) => {
  const { run } = setup(t);
  for (const mode of [undefined, 'off', 'observe', 'enforce']) {
    const outcome = await run({ mode, payments: [mpPayment()], request: pixPolling() });
    assertApproved(outcome);
    assert.equal(outcome.body.status, 'approved', String(mode));
    assert.equal(outcome.row.amount_collected, 148.5);
    assert.equal(outcome.row.application_fee_charged, 13.5);
    assert.deepEqual(outcome.integrityLines, [], String(mode));
  }
});

test('status em observe: divergência só gera um aviso; resposta, banco, cupom e e-mail iguais aos de off', async (t) => {
  const { run } = setup(t);
  const divergent = () => [mpPayment({ transaction_amount: 135 })];

  const off = await run({ mode: 'off', payments: divergent(), request: pixPolling() });
  const observe = await run({ mode: 'observe', payments: divergent(), request: pixPolling() });

  assertApproved(off);
  assertApproved(observe);
  assert.deepEqual(off.integrityLines, []);
  assertSingleWarning(observe, mpWarning());

  assert.equal(observe.status, off.status);
  assert.deepEqual(observe.body, off.body);
  assert.deepEqual(withoutUpdatedAt(observe.row), withoutUpdatedAt(off.row));
  assert.deepEqual(observe.couponCalls, off.couponCalls);
  assert.equal(observe.emails, off.emails);
  assert.equal(observe.row.amount_collected, 135);
});

test('status sem PAYMENT_INTEGRITY_MODE (ou com valor desconhecido) se comporta como observe', async (t) => {
  const { run } = setup(t);
  for (const mode of [undefined, '', 'ENFORCE', 'bloquear']) {
    const outcome = await run({ mode, payments: [mpPayment({ transaction_amount: 135 })], request: pixPolling() });
    assertApproved(outcome);
    assertSingleWarning(outcome, mpWarning());
  }
});

test('status em enforce: divergência deixa a inscrição em análise, sem cupom e sem e-mail, no formato atual da resposta', async (t) => {
  const { run } = setup(t);
  const outcome = await run({ mode: 'enforce', payments: [mpPayment({ transaction_amount: 135 })], request: pixPolling() });

  assertHeldForReview(outcome);
  assertSingleWarning(outcome, mpWarning({ mode: 'enforce' }));
  // Os demais campos que a rota grava continuam sendo gravados.
  assert.equal(outcome.row.payment_id, String(MP_PAYMENT_ID));
  assert.equal(outcome.row.payment_method, 'pix');
  assert.equal(outcome.row.payment_error_message, null);
  assert.equal(outcome.row.amount_collected, 135);
  assert.equal(outcome.row.application_fee_charged, 13.5);
  // Mesmo formato de resposta; status é o do pagamento no gateway.
  assert.deepEqual(Object.keys(outcome.body).sort(), STATUS_RESPONSE_KEYS);
  assert.equal(outcome.body.status, 'approved');
  assert.equal(outcome.body.registrationData.id, REG_ID);
  assert.equal(outcome.body.cpf, '');
});

test('status em enforce: moeda divergente também segura a aprovação; em off nada é conferido', async (t) => {
  const { run } = setup(t);
  const currency = await run({ mode: 'enforce', payments: [mpPayment({ currency_id: 'USD' })], request: pixPolling() });
  assertHeldForReview(currency);
  assertSingleWarning(currency, mpWarning({ mode: 'enforce', reasons: ['currency_mismatch'], paid: 148.5 }));

  // Em off nada é conferido.
  const off = await run({ mode: 'off', payments: [mpPayment({ currency_id: 'USD' })], request: pixPolling() });
  assertApproved(off);
  assert.deepEqual(off.integrityLines, []);
});

test('status: pagamento ainda não aprovado não é conferido em nenhum modo', async (t) => {
  const { run } = setup(t);
  for (const mode of ['observe', 'enforce']) {
    const outcome = await run({
      mode,
      payments: [mpPayment({ status: 'pending', status_detail: 'pending_waiting_transfer', transaction_amount: 1 })],
      request: pixPolling()
    });
    assert.equal(outcome.status, 200);
    assert.equal(outcome.body.status, 'pending');
    assert.equal(outcome.row.payment_status, 'payment_pending');
    assert.equal(outcome.row.payment_status_detail, 'pending_waiting_transfer');
    assert.deepEqual(outcome.couponCalls, []);
    assert.equal(outcome.emails, 0);
    assert.deepEqual(outcome.integrityLines, []);
  }
});

// ---------------------------------------------------------------------------
// /api/checkout/status: pagamento persistido e busca por registration_id
// ---------------------------------------------------------------------------

test('status pelo pagamento persistido: observe aprova e avisa; enforce deixa em análise', async (t) => {
  const { run } = setup(t);
  const payments = () => [mpPayment({ transaction_amount: 135 })];

  const observe = await run({ mode: 'observe', payments: payments(), request: byRegistration() });
  assertApproved(observe);
  assertSingleWarning(observe, mpWarning());

  const enforce = await run({ mode: 'enforce', payments: payments(), request: byRegistration() });
  assertHeldForReview(enforce);
  assertSingleWarning(enforce, mpWarning({ mode: 'enforce' }));

  const correct = await run({ mode: 'enforce', payments: [mpPayment()], request: byRegistration() });
  assertApproved(correct);
  assert.deepEqual(correct.integrityLines, []);
});

test('status pela busca por registration_id (preferência): observe aprova e avisa; enforce deixa em análise', async (t) => {
  const { run } = setup(t);
  const registrations = () => [mpRegistration({ payment_method: 'mercadopago_preference', payment_id: PREFERENCE_ID }), euroRegistration()];
  // A busca devolve pagamentos de outras inscrições; a rota escolhe o da inscrição pelo metadata.
  const search = () => [
    mpPayment({ id: 1324567001, transaction_amount: 99, metadata: { registration_id: OTHER_REG_ID, event_id: EVENT_ID } }),
    mpPayment({ transaction_amount: 135, payment_method_id: 'master' })
  ];

  const observe = await run({ mode: 'observe', registrations: registrations(), search: search(), request: byRegistration() });
  assertApproved(observe);
  assert.equal(observe.row.payment_id, String(MP_PAYMENT_ID));
  assertSingleWarning(observe, mpWarning());

  const enforce = await run({ mode: 'enforce', registrations: registrations(), search: search(), request: byRegistration() });
  assertHeldForReview(enforce);
  assert.equal(enforce.row.payment_id, String(MP_PAYMENT_ID));
  assertSingleWarning(enforce, mpWarning({ mode: 'enforce' }));

  const correct = await run({
    mode: 'enforce',
    registrations: registrations(),
    search: [mpPayment({ payment_method_id: 'master' })],
    request: byRegistration()
  });
  assertApproved(correct);
  assert.deepEqual(correct.integrityLines, []);
});

test('status: inscrição gratuita (total 0) não tem pagamento a conciliar e não é alterada', async (t) => {
  const { run } = setup(t);
  const free = mpRegistration({
    ticket_price: 0,
    total_paid: 0,
    service_fee_percent: null,
    service_fee_amount: 0,
    amount_collected: 0,
    coupon_code: null,
    payment_status: 'payment_approved',
    payment_method: 'free',
    payment_id: null,
    payment_status_detail: null
  });
  for (const mode of ['observe', 'enforce']) {
    // A busca só traz pagamentos de outras inscrições.
    const outcome = await run({
      mode,
      registrations: [free, euroRegistration()],
      search: [mpPayment({ id: 1324567001, metadata: { registration_id: OTHER_REG_ID, event_id: EVENT_ID } })],
      request: byRegistration()
    });
    assert.equal(outcome.status, 200);
    assert.deepEqual(outcome.body, { status: 'pending', message: 'Nenhum pagamento correspondente localizado.' });
    assert.deepEqual(outcome.row, free);
    assert.deepEqual(outcome.couponCalls, []);
    assert.equal(outcome.emails, 0);
    assert.deepEqual(outcome.integrityLines, []);
  }
});

test('status: inscrição já aprovada não reenvia e-mail; em enforce uma confirmação divergente a deixa em análise', async (t) => {
  const { run } = setup(t);
  const approved = () => [mpRegistration({ payment_status: 'payment_approved', payment_status_detail: 'accredited' }), euroRegistration()];

  const observe = await run({ mode: 'observe', registrations: approved(), payments: [mpPayment({ transaction_amount: 135 })], request: pixPolling() });
  assert.equal(observe.row.payment_status, 'payment_approved');
  assert.deepEqual(observe.couponCalls, [REG_ID]);
  assert.equal(observe.emails, 0);
  assertSingleWarning(observe, mpWarning());

  const enforce = await run({ mode: 'enforce', registrations: approved(), payments: [mpPayment({ transaction_amount: 135 })], request: pixPolling() });
  assertHeldForReview(enforce);
});

// ---------------------------------------------------------------------------
// Webhook do Mercado Pago
// ---------------------------------------------------------------------------

test('webhook do Mercado Pago: pagamento correspondente aprova em todos os modos, sem aviso', async (t) => {
  const { run } = setup(t);
  for (const mode of [undefined, 'off', 'observe', 'enforce']) {
    const outcome = await run({ mode, payments: [mpPayment()], request: mpWebhookRequest() });
    assertApproved(outcome);
    assert.deepEqual(outcome.body, { received: true });
    assert.deepEqual(outcome.integrityLines, [], String(mode));
  }
});

test('webhook do Mercado Pago em observe: divergência só gera um aviso; o resto é igual a off', async (t) => {
  const { run } = setup(t);
  const divergent = () => [mpPayment({ transaction_amount: 135 })];

  const off = await run({ mode: 'off', payments: divergent(), request: mpWebhookRequest() });
  const observe = await run({ mode: 'observe', payments: divergent(), request: mpWebhookRequest() });
  const absent = await run({ mode: undefined, payments: divergent(), request: mpWebhookRequest() });

  assertApproved(off);
  assertApproved(observe);
  assertApproved(absent);
  assert.deepEqual(off.integrityLines, []);
  assertSingleWarning(observe, mpWarning({ source: 'mp-webhook' }));
  assertSingleWarning(absent, mpWarning({ source: 'mp-webhook' }));
  for (const outcome of [observe, absent]) {
    assert.equal(outcome.status, off.status);
    assert.deepEqual(outcome.body, off.body);
    assert.deepEqual(withoutUpdatedAt(outcome.row), withoutUpdatedAt(off.row));
    assert.deepEqual(outcome.couponCalls, off.couponCalls);
    assert.equal(outcome.emails, off.emails);
  }
});

test('webhook do Mercado Pago em enforce: divergência deixa em análise, sem cupom e sem e-mail', async (t) => {
  const { run } = setup(t);
  const outcome = await run({ mode: 'enforce', payments: [mpPayment({ transaction_amount: 135 })], request: mpWebhookRequest() });

  assertHeldForReview(outcome);
  assert.deepEqual(outcome.body, { received: true });
  assert.equal(outcome.row.payment_id, String(MP_PAYMENT_ID));
  assert.equal(outcome.row.amount_collected, 135);
  assertSingleWarning(outcome, mpWarning({ mode: 'enforce', source: 'mp-webhook' }));
});

// ---------------------------------------------------------------------------
// Webhook do Stripe (assinatura calculada no teste)
// ---------------------------------------------------------------------------

const stripeWarning = (overrides = {}) => ({
  mode: 'observe',
  source: 'stripe-webhook',
  registrationId: EURO_REG_ID,
  eventId: EURO_EVENT_ID,
  paymentId: STRIPE_INTENT_ID,
  reasons: ['amount_mismatch'],
  expected: 150,
  paid: 100,
  currency: 'EUR',
  ...overrides
});

test('webhook do Stripe: Checkout com taxa retida do total aprova em todos os modos, sem aviso', async (t) => {
  const { run } = setup(t);
  for (const mode of [undefined, 'off', 'observe', 'enforce']) {
    const outcome = await run({ mode, request: stripeWebhookRequest(stripeIntent()), registrationId: EURO_REG_ID });
    assertApproved(outcome, { registrationId: EURO_REG_ID, statusDetail: null });
    assert.deepEqual(outcome.body, { received: true });
    assert.equal(outcome.row.payment_id, STRIPE_INTENT_ID);
    assert.equal(outcome.row.amount_collected, 150);
    assert.equal(outcome.row.application_fee_charged, 15);
    assert.deepEqual(outcome.integrityLines, [], String(mode));
  }
});

test('webhook do Stripe em observe: divergência só gera um aviso; o resto é igual a off', async (t) => {
  const { run } = setup(t);
  const divergent = () => stripeWebhookRequest(stripeIntent({ amount: 10000, amount_received: 10000, application_fee_amount: 1000 }));

  const off = await run({ mode: 'off', request: divergent(), registrationId: EURO_REG_ID });
  const observe = await run({ mode: 'observe', request: divergent(), registrationId: EURO_REG_ID });

  assertApproved(off, { registrationId: EURO_REG_ID, statusDetail: null });
  assertApproved(observe, { registrationId: EURO_REG_ID, statusDetail: null });
  assert.deepEqual(off.integrityLines, []);
  assertSingleWarning(observe, stripeWarning());
  assert.deepEqual(observe.body, off.body);
  assert.deepEqual(withoutUpdatedAt(observe.row), withoutUpdatedAt(off.row));
  assert.deepEqual(observe.couponCalls, off.couponCalls);
  assert.equal(observe.emails, off.emails);
});

test('webhook do Stripe em enforce: valor ou moeda divergentes deixam em análise, sem cupom e sem e-mail', async (t) => {
  const { run } = setup(t);
  const amount = await run({
    mode: 'enforce',
    request: stripeWebhookRequest(stripeIntent({ amount: 10000, amount_received: 10000, application_fee_amount: 1000 })),
    registrationId: EURO_REG_ID
  });
  assertHeldForReview(amount);
  assert.deepEqual(amount.body, { received: true });
  assert.equal(amount.row.payment_id, STRIPE_INTENT_ID);
  assert.equal(amount.row.payment_method, 'credit_card');
  assertSingleWarning(amount, stripeWarning({ mode: 'enforce' }));

  const currency = await run({ mode: 'enforce', request: stripeWebhookRequest(stripeIntent({ currency: 'gbp' })), registrationId: EURO_REG_ID });
  assertHeldForReview(currency);
  assertSingleWarning(currency, stripeWarning({ mode: 'enforce', reasons: ['currency_mismatch'], paid: 150 }));
});

// ---------------------------------------------------------------------------
// reviewPaymentBeforeApproval: moeda do evento e falhas
// ---------------------------------------------------------------------------

const stripePaymentInput = (overrides = {}) => ({
  id: STRIPE_INTENT_ID,
  status: 'succeeded',
  amount: 150,
  currency: 'eur',
  registrationId: EURO_REG_ID,
  gateway: 'stripe',
  ...overrides
});

const review = (registration, payment = stripePaymentInput(), eventId = EURO_EVENT_ID) => reviewPaymentBeforeApproval(database.client, {
  source: 'stripe-webhook',
  eventId,
  registrationId: EURO_REG_ID,
  registration,
  payment
});

test('moeda vazia na inscrição: vale a do evento; sem evento, a moeda não é conferida', async (t) => {
  const { state } = setup(t);
  setMode('enforce');
  database = createFakeSupabase(buildSeed());

  for (const currency of [null, undefined, '', '  ']) {
    assert.deepEqual(await review({ total_paid: 150, service_fee_amount: 15, currency }), { holdForReview: false }, String(currency));
  }
  // Evento em BRL e pagamento em EUR: divergência de moeda.
  assert.deepEqual(await review({ total_paid: 150, service_fee_amount: 15, currency: null }, stripePaymentInput(), EVENT_ID), { holdForReview: true });
  const [line] = state.warnings.filter((warning) => warning.startsWith(LOG_PREFIX));
  assert.deepEqual(JSON.parse(line.slice(LOG_PREFIX.length)).reasons, ['currency_mismatch']);
  assert.equal(JSON.parse(line.slice(LOG_PREFIX.length)).currency, 'BRL');
  // Evento inexistente: sem moeda para comparar.
  assert.deepEqual(await review({ total_paid: 150, currency: null }, stripePaymentInput(), 'evt-inexistente'), { holdForReview: false });
});

test('falha ao ler a moeda do evento não interrompe a conferência', async (t) => {
  setup(t);
  setMode('enforce');
  database = { client: { from: () => { throw new Error('falha de leitura simulada'); }, rpc: async () => ({ data: null, error: null }) } };
  assert.deepEqual(await review({ total_paid: 150, currency: null }), { holdForReview: false });
  assert.deepEqual(await review({ total_paid: 100, currency: null }), { holdForReview: true });
});

test('modo off e pagamento não aprovado não consultam o banco', async (t) => {
  setup(t);
  database = createFakeSupabase(buildSeed());
  setMode('off');
  assert.deepEqual(await review({ total_paid: 1, currency: null }), { holdForReview: false });
  setMode('enforce');
  assert.deepEqual(await review({ total_paid: 1, currency: null }, stripePaymentInput({ status: 'processing' })), { holdForReview: false });
  assert.deepEqual(database.operations, []);
});

test('falha inesperada na conferência: observe segue como hoje; enforce deixa em análise', async (t) => {
  const { state } = setup(t);
  database = createFakeSupabase(buildSeed());
  const unreadable = {
    currency: 'EUR',
    get total_paid() {
      throw new Error('leitura inesperada');
    }
  };

  setMode('observe');
  assert.deepEqual(await review(unreadable), { holdForReview: false });
  setMode('enforce');
  assert.deepEqual(await review(unreadable), { holdForReview: true });

  const failures = state.errors.filter((line) => line.startsWith(LOG_PREFIX)).map((line) => JSON.parse(line.slice(LOG_PREFIX.length)));
  assert.deepEqual(failures.map((entry) => entry.mode), ['observe', 'enforce']);
  assert.equal(failures[0].registrationId, EURO_REG_ID);
  assert.equal(failures[0].error, 'leitura inesperada');
});
