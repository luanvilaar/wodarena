import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import { createFakeSupabase } from './support/fakeSupabase.mjs';
import { importServerModule, setActiveSupabaseClient } from './support/serverModuleHarness.mjs';

// Story 1.137: as rotas que gravam o status de pagamento a partir de um
// pagamento passam pela regra única. Executa as rotas reais contra um banco em
// memória, com o Mercado Pago, o Stripe e o e-mail simulados no fetch.

process.env.SUPABASE_URL = 'http://supabase.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';
process.env.WODA_SESSION_SECRET = 'segredo-de-teste-story-1-137';
process.env.MERCADOPAGO_CLIENT_ID = 'mp-client-de-teste';
process.env.MERCADOPAGO_WEBHOOK_SECRET = 'segredo-webhook-mp-de-teste';
process.env.STRIPE_SECRET_KEY = 'sk_test_story_1_137';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_story_1_137';
process.env.RESEND_API_KEY = 're_test_story_1_137';
delete process.env.MERCADOPAGO_PLATFORM_USER_ID;
delete process.env.PAYMENT_INTEGRITY_MODE;

let database = null;
setActiveSupabaseClient({
  from: (table) => database.client.from(table),
  rpc: (name, args) => database.client.rpc(name, args)
});

const { GET: getCheckoutStatus } = await importServerModule('app/api/checkout/status/route.ts');
const { POST: postMercadoPagoWebhook } = await importServerModule('app/api/webhooks/mercadopago/route.ts');
const { POST: postStripeWebhook } = await importServerModule('app/api/webhooks/stripe/route.ts');
const { POST: postPix } = await importServerModule('app/api/checkout/pix/route.ts');
const { POST: postCard } = await importServerModule('app/api/checkout/card/route.ts');
const { POST: postPreference } = await importServerModule('app/api/checkout/preference/route.ts');
const { createRegistrationAccessToken } = await importServerModule('lib/serverSecurity.ts');

const LOG_PREFIX = '[Payment Transition] ';
const EVENT_ID = 'evt-1-137';
const EURO_EVENT_ID = 'evt-1-137-pt';
const MANAGER_ID = 'mgr-1-137';
const ATHLETE_USER_ID = 'ath-user-bia';
const ATHLETE_ID = 'ath-2b3c4d5e-6f70-4182-9a3b-4c5d6e7f8091';
const REG_ID = 'reg-3c4d5e6f-7081-4293-8a4b-5c6d7e8f9012';
const EURO_REG_ID = 'reg-4d5e6f70-8192-43a4-9b5c-6d7e8f901234';
const CARD_PAYMENT_ID = 188600000001;
const OLD_PIX_ID = 188547354042;
const NEW_PIX_ID = 188700000002;
const CANCELLED_AT = '2026-11-10T12:00:00.000Z';

const event = (overrides = {}) => ({
  id: EVENT_ID,
  name: 'Desafio 1.137',
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
  rules: '',
  instagram: '',
  website: '',
  ticket_price: 299,
  ticket_slots: 100,
  is_ticketing_active: true,
  registration_deadline: null,
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

// R$ 299 + taxa de 10% paga pelo atleta: R$ 328,90 no Mercado Pago.
const registration = (overrides = {}) => ({
  id: REG_ID,
  event_id: EVENT_ID,
  division_id: 'div-rx',
  user_id: ATHLETE_USER_ID,
  athlete_id: ATHLETE_ID,
  athlete_name: 'Bia Lima',
  athlete_email: 'bia@example.com',
  athlete_phone: '85999990000',
  box: 'Box Bia',
  gender: 'female',
  ticket_type: 'RX',
  ticket_price: 299,
  quantity: 1,
  total_paid: 299,
  shirt_addon_count: 0,
  shirt_addon_amount: 0,
  service_fee_percent: 10,
  service_fee_amount: 29.9,
  service_fee_payer: 'athlete',
  amount_collected: 328.9,
  application_fee_charged: 29.9,
  coupon_code: null,
  currency: 'BRL',
  payment_gateway: 'mercadopago',
  locale: 'pt-br',
  payment_status: 'payment_approved',
  payment_method: 'master',
  payment_id: String(CARD_PAYMENT_ID),
  payment_status_detail: 'accredited',
  payment_error_message: null,
  cancellation_reason: null,
  cancelled_at: null,
  cancelled_by: null,
  refund_status: 'not_requested',
  created_at: '2026-11-08T20:56:54.000Z',
  updated_at: '2026-11-08T21:05:00.000Z',
  ...overrides
});

const cancelledByManager = (overrides = {}) => registration({
  payment_status: 'payment_cancelled',
  payment_status_detail: 'manager_cancelled',
  payment_method: 'pix',
  payment_id: String(OLD_PIX_ID),
  application_fee_charged: 0,
  cancellation_reason: 'duplicada',
  cancelled_at: CANCELLED_AT,
  cancelled_by: MANAGER_ID,
  refund_status: 'manual_pending',
  ...overrides
});

const euroRegistration = (overrides = {}) => registration({
  id: EURO_REG_ID,
  event_id: EURO_EVENT_ID,
  total_paid: 150,
  service_fee_amount: 15,
  service_fee_payer: 'organizer',
  amount_collected: 150,
  currency: 'EUR',
  payment_gateway: 'stripe',
  locale: 'pt-pt',
  payment_method: 'credit_card',
  payment_id: 'pi_aprovou',
  ...overrides
});

const buildSeed = (registrations) => ({
  events: [event(), event({ id: EURO_EVENT_ID, name: 'Desafio 1.137 Lisboa', country_code: 'PT', currency: 'EUR', payment_gateway: 'stripe', default_locale: 'pt-pt', time_zone: 'Europe/Lisbon' })],
  divisions: [{ id: 'div-rx', event_id: EVENT_ID, name: 'RX', price: 299, is_active: true, type: 'individual', category: 'female' }],
  users: [
    { id: MANAGER_ID, name: 'Gestor', email: 'gestor@example.com', role: 'manager', organization: 'Box', service_valid_until: '2099-12-31' },
    { id: ATHLETE_USER_ID, name: 'Bia Lima', email: 'bia@example.com', role: 'athlete', organization: 'Box Bia' }
  ],
  athletes: [{
    id: ATHLETE_ID,
    name: 'Bia Lima',
    box: 'Box Bia',
    country: 'BR',
    division_id: 'div-rx',
    birth_date: '1995-05-05',
    gender: 'female',
    email: 'bia@example.com',
    phone: '85999990000',
    shirt_size: 'M',
    is_team: false,
    team_members: '[]'
  }],
  registrations,
  coupons: [],
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
const mpPayment = (id, overrides = {}) => ({
  id,
  status: 'approved',
  status_detail: 'accredited',
  transaction_amount: 328.9,
  currency_id: 'BRL',
  payment_method_id: 'pix',
  date_approved: '2026-11-08T18:05:00.000-03:00',
  metadata: { registration_id: REG_ID, event_id: EVENT_ID },
  fee_details: [{ type: 'application_fee', amount: 29.9 }],
  payer: { email: 'bia@example.com' },
  ...overrides
});

const expiredPix = (id = OLD_PIX_ID) => mpPayment(id, {
  status: 'cancelled',
  status_detail: 'expired',
  date_approved: null,
  fee_details: []
});

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' }
});

const setup = (t) => {
  const state = { payments: [], emails: [], warnings: [], mpCalls: [] };
  t.mock.method(console, 'warn', (...args) => { state.warnings.push(args.map(String).join(' ')); });
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'log', () => {});
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = String(input);
    if (url === 'https://api.resend.com/emails') {
      state.emails.push(JSON.parse(init.body));
      return jsonResponse({ id: `email-${state.emails.length}` });
    }
    if (url.startsWith('https://api.mercadopago.com/')) state.mpCalls.push(url);
    const byId = url.match(/^https:\/\/api\.mercadopago\.com\/v1\/payments\/([^/?]+)$/);
    if (byId) {
      const payment = state.payments.find((item) => String(item.id) === decodeURIComponent(byId[1]));
      return payment ? jsonResponse(payment) : jsonResponse({ message: 'Payment not found' }, 404);
    }
    throw new Error(`fetch inesperado no teste: ${url}`);
  });

  const run = async ({ registrations, payments = [], request, registrationId = REG_ID }) => {
    Object.assign(state, { payments, emails: [], warnings: [], mpCalls: [] });
    database = createFakeSupabase(buildSeed(registrations));
    const response = await request();
    const lines = state.warnings.filter((line) => line.startsWith(LOG_PREFIX));
    return {
      status: response.status,
      body: await response.json(),
      row: structuredClone(database.rows('registrations').find((row) => row.id === registrationId)),
      couponCalls: database.rpcCalls.filter((call) => call.name === 'apply_coupon_usage').length,
      emails: state.emails.length,
      mpCalls: [...state.mpCalls],
      transitions: lines.map((line) => JSON.parse(line.slice(LOG_PREFIX.length)))
    };
  };

  return { run };
};

const accessToken = (registrationId = REG_ID, eventId = EVENT_ID) => createRegistrationAccessToken({ registrationId, eventId, userId: ATHLETE_USER_ID });

const mpWebhook = (paymentId) => () => {
  const id = String(paymentId);
  const requestId = 'req-story-1-137';
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

const statusPolling = (paymentId) => () => getCheckoutStatus(new Request(`http://localhost/api/checkout/status?${new URLSearchParams({
  payment_id: String(paymentId),
  event_id: EVENT_ID,
  registration_id: REG_ID,
  access_token: accessToken()
})}`));

const stripeWebhook = (intent, type) => () => {
  const payload = JSON.stringify({
    id: 'evt_1QStory1137',
    object: 'event',
    api_version: '2025-08-27.basil',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type,
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

const checkoutBody = (extra = {}) => ({
  registrationData: { id: REG_ID, eventId: EVENT_ID },
  accessToken: accessToken(),
  ...extra
});

const postJson = (handler, body, ip) => () => handler(new Request('http://localhost/api/checkout', {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', 'x-forwarded-for': ip },
  body: JSON.stringify(body)
}));

// ---------------------------------------------------------------------------
// Inscrição aprovada
// ---------------------------------------------------------------------------

test('webhook: PIX antigo que expirou não cancela a inscrição paga com cartão', async (t) => {
  const { run } = setup(t);
  const before = registration();
  const outcome = await run({ registrations: [before], payments: [expiredPix()], request: mpWebhook(OLD_PIX_ID) });
  assert.equal(outcome.status, 200);
  assert.deepEqual(outcome.body, { received: true });
  assert.deepEqual(outcome.row, before);
  assert.equal(outcome.emails, 0);
  assert.equal(outcome.couponCalls, 0);
  assert.equal(outcome.transitions.length, 1);
  assert.equal(outcome.transitions[0].reason, 'approved_by_other_payment');
  assert.equal(outcome.transitions[0].source, 'mp-webhook');
  // Log sem dados pessoais.
  assert.doesNotMatch(JSON.stringify(outcome.transitions), /bia@|Bia Lima/);
});

test('webhook: segundo pagamento aprovado fica registrado como pagamento em dobro, sem mexer na inscrição', async (t) => {
  const { run } = setup(t);
  const before = registration();
  const outcome = await run({ registrations: [before], payments: [mpPayment(NEW_PIX_ID)], request: mpWebhook(NEW_PIX_ID) });
  assert.equal(outcome.status, 200);
  assert.deepEqual(outcome.row, before);
  assert.equal(outcome.emails, 0);
  assert.equal(outcome.couponCalls, 0);
  assert.equal(outcome.transitions[0].reason, 'duplicate_payment');
});

test('webhook: estorno do próprio pagamento cancela a inscrição como "refunded", sem autor', async (t) => {
  const { run } = setup(t);
  const outcome = await run({
    registrations: [registration()],
    payments: [mpPayment(CARD_PAYMENT_ID, { status: 'refunded', status_detail: 'bpp_refunded', payment_method_id: 'master' })],
    request: mpWebhook(CARD_PAYMENT_ID)
  });
  assert.equal(outcome.status, 200);
  assert.equal(outcome.row.payment_status, 'payment_cancelled');
  assert.equal(outcome.row.payment_status_detail, 'refunded');
  assert.equal(outcome.row.cancelled_by, null);
  assert.ok(outcome.row.cancelled_at);
  assert.equal(outcome.row.payment_id, String(CARD_PAYMENT_ID));
  assert.equal(outcome.emails, 0);
});

test('webhook: contestação (chargeback) do próprio pagamento também cancela', async (t) => {
  const { run } = setup(t);
  const outcome = await run({
    registrations: [registration()],
    payments: [mpPayment(CARD_PAYMENT_ID, { status: 'charged_back', status_detail: 'settled', payment_method_id: 'master' })],
    request: mpWebhook(CARD_PAYMENT_ID)
  });
  assert.equal(outcome.row.payment_status, 'payment_cancelled');
  assert.equal(outcome.row.payment_status_detail, 'charged_back');
});

test('consulta de status: tentativa antiga expirada não mexe na inscrição aprovada', async (t) => {
  const { run } = setup(t);
  const before = registration();
  const outcome = await run({ registrations: [before], payments: [expiredPix()], request: statusPolling(OLD_PIX_ID) });
  assert.equal(outcome.status, 200);
  assert.equal(outcome.body.status, 'cancelled');
  assert.deepEqual(outcome.row, before);
});

test('webhook do Stripe: intent de outra tentativa cancelado não mexe na inscrição aprovada', async (t) => {
  const { run } = setup(t);
  const before = euroRegistration();
  const intent = {
    id: 'pi_outra_tentativa',
    object: 'payment_intent',
    status: 'canceled',
    amount: 15000,
    amount_received: 0,
    currency: 'eur',
    last_payment_error: null,
    metadata: { registration_id: EURO_REG_ID, event_id: EURO_EVENT_ID }
  };
  const outcome = await run({ registrations: [before], request: stripeWebhook(intent, 'payment_intent.canceled'), registrationId: EURO_REG_ID });
  assert.equal(outcome.status, 200);
  assert.deepEqual(outcome.row, before);
  assert.equal(outcome.transitions[0].reason, 'approved_by_other_payment');
});

// ---------------------------------------------------------------------------
// Inscrição cancelada pelo gestor
// ---------------------------------------------------------------------------

test('webhook: PIX pago depois do cancelamento pelo gestor não reabre a inscrição; fica marcada', async (t) => {
  const { run } = setup(t);
  const outcome = await run({
    registrations: [cancelledByManager()],
    payments: [mpPayment(OLD_PIX_ID, { date_approved: '2026-11-10T15:00:00.000-03:00' })],
    request: mpWebhook(OLD_PIX_ID)
  });
  assert.equal(outcome.status, 200);
  assert.equal(outcome.row.payment_status, 'payment_cancelled');
  assert.equal(outcome.row.payment_status_detail, 'paid_after_cancellation');
  assert.equal(outcome.row.cancelled_by, MANAGER_ID);
  assert.equal(outcome.row.cancellation_reason, 'duplicada');
  assert.equal(outcome.row.cancelled_at, CANCELLED_AT);
  assert.equal(outcome.row.application_fee_charged, 29.9);
  assert.equal(outcome.emails, 0);
  assert.equal(outcome.couponCalls, 0);
  assert.equal(outcome.transitions[0].decision, 'paid_after_cancellation');
});

test('webhook: outro pagamento aprovado depois do cancelamento guarda o id dele para o reembolso', async (t) => {
  const { run } = setup(t);
  const outcome = await run({
    registrations: [cancelledByManager()],
    payments: [mpPayment(CARD_PAYMENT_ID, { payment_method_id: 'master' })],
    request: mpWebhook(CARD_PAYMENT_ID)
  });
  assert.equal(outcome.row.payment_status, 'payment_cancelled');
  assert.equal(outcome.row.payment_status_detail, 'paid_after_cancellation');
  assert.equal(outcome.row.payment_id, String(CARD_PAYMENT_ID));
  assert.equal(outcome.row.payment_method, 'master');
});

test('webhook: aviso reenviado do pagamento aprovado antes do cancelamento não muda nada', async (t) => {
  const { run } = setup(t);
  const before = cancelledByManager({ payment_method: 'master', payment_id: String(CARD_PAYMENT_ID) });
  const outcome = await run({
    registrations: [before],
    payments: [mpPayment(CARD_PAYMENT_ID, { date_approved: '2026-11-08T18:05:00.000-03:00' })],
    request: mpWebhook(CARD_PAYMENT_ID)
  });
  assert.deepEqual(outcome.row, before);
  assert.equal(outcome.transitions[0].reason, 'cancelled_by_manager');
});

test('consulta de status: pagamento aprovado em inscrição cancelada pelo gestor não devolve comprovante', async (t) => {
  const { run } = setup(t);
  const outcome = await run({
    registrations: [cancelledByManager()],
    payments: [mpPayment(OLD_PIX_ID, { date_approved: '2026-11-10T15:00:00.000-03:00' })],
    request: statusPolling(OLD_PIX_ID)
  });
  assert.equal(outcome.status, 200);
  assert.deepEqual(outcome.body, { status: 'registration_cancelled', registrationData: null, athleteProfile: null, cpf: '' });
  assert.equal(outcome.row.payment_status, 'payment_cancelled');
  assert.equal(outcome.row.payment_status_detail, 'paid_after_cancellation');
  assert.equal(outcome.emails, 0);
});

// ---------------------------------------------------------------------------
// Inscrição pendente
// ---------------------------------------------------------------------------

test('webhook: PIX antigo que expirou não derruba o PIX novo em andamento', async (t) => {
  const { run } = setup(t);
  const before = registration({ payment_status: 'payment_pending', payment_method: 'pix', payment_id: String(NEW_PIX_ID), payment_status_detail: 'pending_waiting_transfer', application_fee_charged: 0 });
  const outcome = await run({ registrations: [before], payments: [expiredPix()], request: mpWebhook(OLD_PIX_ID) });
  assert.equal(outcome.status, 200);
  assert.deepEqual(outcome.row, before);
  assert.equal(outcome.transitions[0].reason, 'older_attempt');
});

test('webhook: pagamento aprovado de qualquer tentativa aprova a inscrição pendente, como hoje', async (t) => {
  const { run } = setup(t);
  const outcome = await run({
    registrations: [registration({ payment_status: 'payment_pending', payment_method: 'pix', payment_id: String(NEW_PIX_ID), payment_status_detail: null, application_fee_charged: 0 })],
    payments: [mpPayment(OLD_PIX_ID)],
    request: mpWebhook(OLD_PIX_ID)
  });
  assert.equal(outcome.row.payment_status, 'payment_approved');
  assert.equal(outcome.row.payment_id, String(OLD_PIX_ID));
  assert.equal(outcome.couponCalls, 1);
  assert.equal(outcome.emails, 1);
  assert.deepEqual(outcome.transitions, []);
});

test('webhook: a tentativa atual que expira cancela a inscrição pendente, como hoje', async (t) => {
  const { run } = setup(t);
  const outcome = await run({
    registrations: [registration({ payment_status: 'payment_pending', payment_method: 'pix', payment_id: String(OLD_PIX_ID), payment_status_detail: null, application_fee_charged: 0 })],
    payments: [expiredPix()],
    request: mpWebhook(OLD_PIX_ID)
  });
  assert.equal(outcome.row.payment_status, 'payment_cancelled');
  assert.equal(outcome.row.payment_status_detail, 'expired');
  assert.equal(outcome.row.cancelled_by, null);
});

// ---------------------------------------------------------------------------
// Cobrança nova
// ---------------------------------------------------------------------------

test('PIX, cartão e link recusam cobrança nova para inscrição já paga, sem chamar o Mercado Pago', async (t) => {
  const { run } = setup(t);
  const cases = [
    ['pix', postJson(postPix, checkoutBody({ cpf: '12345678909' }), '10.0.0.1')],
    ['cartão', postJson(postCard, checkoutBody({ token: 'tok', payment_method_id: 'master', installments: 1, cpf: '12345678909' }), '10.0.0.2')],
    ['link', postJson(postPreference, checkoutBody({ origin: 'http://localhost:3000', locale: 'pt-br' }), '10.0.0.3')]
  ];
  for (const [label, request] of cases) {
    const before = registration();
    const outcome = await run({ registrations: [before], request });
    assert.equal(outcome.status, 409, label);
    assert.match(outcome.body.error, /já está paga/, label);
    assert.deepEqual(outcome.mpCalls, [], label);
    assert.deepEqual(outcome.row, before, label);
  }
});

test('PIX, cartão e link recusam cobrança nova para inscrição cancelada pelo gestor', async (t) => {
  const { run } = setup(t);
  const cases = [
    ['pix', postJson(postPix, checkoutBody({ cpf: '12345678909' }), '10.0.1.1')],
    ['cartão', postJson(postCard, checkoutBody({ token: 'tok', payment_method_id: 'master', installments: 1, cpf: '12345678909' }), '10.0.1.2')],
    ['link', postJson(postPreference, checkoutBody({ origin: 'http://localhost:3000', locale: 'pt-br' }), '10.0.1.3')]
  ];
  for (const [label, request] of cases) {
    const before = cancelledByManager();
    const outcome = await run({ registrations: [before], request });
    assert.equal(outcome.status, 409, label);
    assert.match(outcome.body.error, /cancelada pela organização/, label);
    assert.deepEqual(outcome.mpCalls, [], label);
    assert.deepEqual(outcome.row, before, label);
  }
});

test('PIX, cartão e link marcam no metadata por onde a cobrança nasceu; webhook e status repassam a marca', async () => {
  const { readFileSync } = await import('node:fs');
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
  assert.match(read('../src/app/api/checkout/pix/route.ts'), /metadata: \{[\s\S]*?checkout: 'pix'\s*\}/);
  assert.match(read('../src/app/api/checkout/card/route.ts'), /metadata: \{[\s\S]*?checkout: 'card'\s*\}/);
  assert.match(read('../src/app/api/checkout/preference/route.ts'), /const metadataPayload = \{[\s\S]*?checkout: 'preference'\s*\}/);
  assert.match(read('../src/app/api/webhooks/mercadopago/route.ts'), /checkoutKind: paymentData\.metadata\?\.checkout/);
  assert.match(read('../src/app/api/checkout/status/route.ts'), /checkoutKind: paymentData\.metadata\?\.checkout/);
});

test('webhook: PIX criado direto antes do link expira sem derrubar o link em andamento', async (t) => {
  const { run } = setup(t);
  const before = registration({ payment_status: 'payment_pending', payment_method: 'mercadopago_preference', payment_id: '299411356-pref', payment_status_detail: null, application_fee_charged: 0 });
  const outcome = await run({
    registrations: [before],
    payments: [mpPayment(OLD_PIX_ID, { status: 'cancelled', status_detail: 'expired', date_approved: null, fee_details: [], metadata: { registration_id: REG_ID, event_id: EVENT_ID, checkout: 'pix' } })],
    request: mpWebhook(OLD_PIX_ID)
  });
  assert.deepEqual(outcome.row, before);
  assert.equal(outcome.transitions[0].reason, 'older_attempt');
});

test('webhook do Stripe: o mesmo intent aprovado depois do cancelamento pelo gestor fica marcado pela hora do evento', async (t) => {
  const { run } = setup(t);
  const intent = {
    id: 'pi_tentativa_unica',
    object: 'payment_intent',
    status: 'succeeded',
    amount: 15000,
    amount_received: 15000,
    currency: 'eur',
    last_payment_error: null,
    metadata: { registration_id: EURO_REG_ID, event_id: EURO_EVENT_ID }
  };
  // Cancelada pelo gestor em 2026-11-10; o evento do Stripe é de agora.
  const outcome = await run({
    registrations: [euroRegistration({ payment_status: 'payment_cancelled', payment_status_detail: 'manager_cancelled', payment_id: 'pi_tentativa_unica', cancelled_by: MANAGER_ID, cancelled_at: CANCELLED_AT })],
    request: stripeWebhook(intent, 'payment_intent.succeeded'),
    registrationId: EURO_REG_ID
  });
  assert.equal(outcome.row.payment_status, 'payment_cancelled');
  assert.equal(outcome.row.payment_status_detail, 'paid_after_cancellation');
  assert.equal(outcome.emails, 0);
});

test('a gravação compara também o autor do cancelamento lido', async () => {
  const { readFileSync } = await import('node:fs');
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
  assert.match(read('../src/lib/serverPaymentTransition.ts'), /query = currentCancelledBy === null \? query\.is\('cancelled_by', null\) : query\.eq\('cancelled_by', currentCancelledBy\);/);
  assert.match(read('../src/app/api/checkout/preference/route.ts'), /query = query\.is\('cancelled_by', null\);/);
});
