import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  PAYMENT_INTEGRITY_LOG_PREFIX,
  PAYMENT_INTEGRITY_MODES,
  PAYMENT_INTEGRITY_STATUS_DETAIL,
  PAYMENT_INTEGRITY_TOLERANCE_CENTS,
  checkPaymentAgainstRegistration,
  formatPaymentIntegrityWarning,
  isApprovedPaymentStatus,
  resolvePaymentIntegrityMode,
  reviewPaymentIntegrity
} from '../src/lib/paymentIntegrity.ts';

// Story 1.40: antes de aprovar uma inscrição, o servidor confere que o
// pagamento corresponde a ela (valor, moeda e vínculo). Testes do módulo puro,
// com pagamentos no formato devolvido pelo Mercado Pago e pelo Stripe.

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const moduleSource = read('../src/lib/paymentIntegrity.ts');

const REG_ID = 'reg-1f2e3d4c-5b6a-4987-8a6b-5c4d3e2f1a0b';
const OTHER_REG_ID = 'reg-9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const EVENT_ID = 'evt-1-40';

// Inscrição de R$ 150 com taxa de serviço de 10%: o atleta paga R$ 165 no Mercado Pago.
const registration = (overrides = {}) => ({
  id: REG_ID,
  totalPaid: 150,
  serviceFeeAmount: 15,
  currency: 'BRL',
  ...overrides
});

// GET /v1/payments/{id} do Mercado Pago (campos usados pelas rotas).
const mercadoPagoPayment = (overrides = {}) => ({
  id: 1324567890,
  status: 'approved',
  status_detail: 'accredited',
  transaction_amount: 165,
  currency_id: 'BRL',
  payment_method_id: 'pix',
  metadata: { registration_id: REG_ID, event_id: EVENT_ID },
  fee_details: [{ type: 'application_fee', amount: 15 }],
  ...overrides
});

// Mesma tradução feita nas rotas do Mercado Pago.
const fromMercadoPago = (payment) => ({
  id: payment.id,
  status: payment.status,
  amount: payment.transaction_amount,
  currency: payment.currency_id,
  registrationId: payment.metadata?.registration_id,
  gateway: 'mercadopago'
});

// PaymentIntent do Stripe (Checkout com application_fee_amount na conta conectada).
const stripeIntent = (overrides = {}) => ({
  id: 'pi_3QAbCdEfGh1234567890',
  object: 'payment_intent',
  status: 'succeeded',
  amount: 15000,
  amount_received: 15000,
  application_fee_amount: 1500,
  currency: 'eur',
  metadata: { registration_id: REG_ID, event_id: EVENT_ID },
  ...overrides
});

// Mesma tradução do webhook do Stripe: unidades menores → unidade principal
// (fromMinorUnits; todas as moedas aceitas têm 2 casas).
const fromStripe = (intent) => ({
  id: intent.id,
  status: intent.status,
  amount: (intent.amount_received || intent.amount) / 100,
  currency: intent.currency,
  registrationId: intent.metadata?.registration_id,
  gateway: 'stripe'
});

const check = (registrationOverrides, payment) => checkPaymentAgainstRegistration({
  registration: registration(registrationOverrides),
  payment
});

const mismatch = (reasons, expected, paid, direction) => ({ ok: false, reasons, expected, paid, direction });

// ---------------------------------------------------------------------------
// Módulo e modo
// ---------------------------------------------------------------------------

test('paymentIntegrity é um módulo puro: sem imports, sem ambiente e só com sintaxe apagável', () => {
  assert.doesNotMatch(moduleSource, /^\s*import\s/m);
  assert.doesNotMatch(moduleSource, /\brequire\(/);
  assert.doesNotMatch(moduleSource, /\benum\b|\bnamespace\b|\bdeclare\b/);
  assert.doesNotMatch(moduleSource, /process\.env|Date\.now|new Date|Math\.random|console\./);
});

test('modos: só off e enforce exatos mudam; o resto vale observe', () => {
  assert.deepEqual([...PAYMENT_INTEGRITY_MODES], ['off', 'observe', 'enforce']);
  assert.equal(resolvePaymentIntegrityMode('off'), 'off');
  assert.equal(resolvePaymentIntegrityMode('enforce'), 'enforce');
  assert.equal(resolvePaymentIntegrityMode('observe'), 'observe');
  for (const value of [undefined, null, '', ' ', 'OFF', 'Enforce', ' enforce', 'enforce ', 'true', 'false', '0', '1', 0, 1, true, {}, []]) {
    assert.equal(resolvePaymentIntegrityMode(value), 'observe', JSON.stringify(value) ?? String(value));
  }
});

test('status aprovado depende do gateway: approved no Mercado Pago e succeeded no Stripe', () => {
  assert.equal(isApprovedPaymentStatus('mercadopago', 'approved'), true);
  assert.equal(isApprovedPaymentStatus('stripe', 'succeeded'), true);
  assert.equal(isApprovedPaymentStatus('mercadopago', 'succeeded'), false);
  assert.equal(isApprovedPaymentStatus('stripe', 'approved'), false);
  assert.equal(isApprovedPaymentStatus('paypal', 'approved'), false);
  assert.equal(isApprovedPaymentStatus(undefined, undefined), false);
  assert.equal(PAYMENT_INTEGRITY_STATUS_DETAIL, 'payment_integrity_mismatch');
  assert.equal(PAYMENT_INTEGRITY_TOLERANCE_CENTS, 10);
});

// ---------------------------------------------------------------------------
// Mercado Pago
// ---------------------------------------------------------------------------

test('Mercado Pago: pagamento igual a total_paid + service_fee_amount corresponde', () => {
  assert.deepEqual(check({}, fromMercadoPago(mercadoPagoPayment())), { ok: true });
  // Valores como string numérica (formato possível do banco) também valem.
  assert.deepEqual(check({ totalPaid: '150.00', serviceFeeAmount: '15.00' }, fromMercadoPago(mercadoPagoPayment())), { ok: true });
});

test('Mercado Pago: tolerância de 0,10 para cima e para baixo; acima disso é divergência de valor', () => {
  for (const amount of [165.1, 164.9, 165.05, 164.95]) {
    assert.deepEqual(check({}, fromMercadoPago(mercadoPagoPayment({ transaction_amount: amount }))), { ok: true }, String(amount));
  }
  assert.deepEqual(
    check({}, fromMercadoPago(mercadoPagoPayment({ transaction_amount: 165.11 }))),
    mismatch(['amount_mismatch'], 165, 165.11, 'above')
  );
  assert.deepEqual(
    check({}, fromMercadoPago(mercadoPagoPayment({ transaction_amount: 164.89 }))),
    mismatch(['amount_mismatch'], 165, 164.89, 'below')
  );
});

test('Mercado Pago: valor abaixo e acima do esperado', () => {
  assert.deepEqual(
    check({}, fromMercadoPago(mercadoPagoPayment({ transaction_amount: 150 }))),
    mismatch(['amount_mismatch'], 165, 150, 'below')
  );
  assert.deepEqual(
    check({}, fromMercadoPago(mercadoPagoPayment({ transaction_amount: 1.5 }))),
    mismatch(['amount_mismatch'], 165, 1.5, 'below')
  );
  assert.deepEqual(
    check({}, fromMercadoPago(mercadoPagoPayment({ transaction_amount: 330 }))),
    mismatch(['amount_mismatch'], 165, 330, 'above')
  );
});

test('taxa nula ou ausente: o esperado é só o total_paid', () => {
  for (const serviceFeeAmount of [null, undefined, 0]) {
    assert.deepEqual(check({ serviceFeeAmount }, fromMercadoPago(mercadoPagoPayment({ transaction_amount: 150 }))), { ok: true });
    assert.deepEqual(
      check({ serviceFeeAmount }, fromMercadoPago(mercadoPagoPayment({ transaction_amount: 165 }))),
      mismatch(['amount_mismatch'], 150, 165, 'above')
    );
  }
  const withoutFeeField = { id: REG_ID, totalPaid: 150, currency: 'BRL' };
  assert.deepEqual(
    checkPaymentAgainstRegistration({ registration: withoutFeeField, payment: fromMercadoPago(mercadoPagoPayment({ transaction_amount: 150 })) }),
    { ok: true }
  );
});

test('moeda: diferente é divergência; comparação sem diferenciar maiúsculas; sem moeda informada não acusa', () => {
  assert.deepEqual(
    check({}, fromMercadoPago(mercadoPagoPayment({ currency_id: 'USD' }))),
    mismatch(['currency_mismatch'], 165, 165, null)
  );
  assert.deepEqual(check({ currency: 'brl' }, fromMercadoPago(mercadoPagoPayment({ currency_id: 'BRL' }))), { ok: true });
  assert.deepEqual(check({ currency: ' BRL ' }, fromMercadoPago(mercadoPagoPayment({ currency_id: 'brl' }))), { ok: true });
  for (const currency_id of [undefined, null, '']) {
    assert.deepEqual(check({}, fromMercadoPago(mercadoPagoPayment({ currency_id }))), { ok: true }, String(currency_id));
  }
  // Moeda da inscrição desconhecida: também não acusa.
  for (const currency of [undefined, null, '']) {
    assert.deepEqual(check({ currency }, fromMercadoPago(mercadoPagoPayment({ currency_id: 'USD' }))), { ok: true }, String(currency));
  }
});

test('vínculo: registration_id informado e diferente é divergência; ausente não acusa', () => {
  assert.deepEqual(
    check({}, fromMercadoPago(mercadoPagoPayment({ metadata: { registration_id: OTHER_REG_ID, event_id: EVENT_ID } }))),
    mismatch(['registration_mismatch'], 165, 165, null)
  );
  for (const metadata of [undefined, null, {}, { event_id: EVENT_ID }, { registration_id: '' }, { registration_id: null }]) {
    assert.deepEqual(check({}, fromMercadoPago(mercadoPagoPayment({ metadata }))), { ok: true }, JSON.stringify(metadata));
  }
  assert.deepEqual(check({}, fromMercadoPago(mercadoPagoPayment({ metadata: { registration_id: ` ${REG_ID} ` } }))), { ok: true });
  // Inscrição sem id e pagamento que informa um: não corresponde.
  assert.deepEqual(
    check({ id: undefined }, fromMercadoPago(mercadoPagoPayment())),
    mismatch(['registration_mismatch'], 165, 165, null)
  );
});

test('vários motivos ao mesmo tempo saem na ordem valor, moeda, vínculo', () => {
  const payment = fromMercadoPago(mercadoPagoPayment({
    transaction_amount: 100,
    currency_id: 'USD',
    metadata: { registration_id: OTHER_REG_ID }
  }));
  assert.deepEqual(check({}, payment), mismatch(['amount_mismatch', 'currency_mismatch', 'registration_mismatch'], 165, 100, 'below'));
});

test('pagamento não aprovado não é conferido, mesmo com valores divergentes ou inválidos', () => {
  for (const status of ['pending', 'in_process', 'authorized', 'rejected', 'cancelled', 'refunded', 'charged_back', 'succeeded', undefined]) {
    assert.deepEqual(
      check({ totalPaid: Number.NaN }, fromMercadoPago(mercadoPagoPayment({ status, transaction_amount: 1, currency_id: 'USD' }))),
      { ok: true, skipped: true },
      String(status)
    );
  }
  for (const status of ['processing', 'requires_payment_method', 'requires_action', 'canceled', 'approved']) {
    assert.deepEqual(check({}, fromStripe(stripeIntent({ status, amount_received: 1 }))), { ok: true, skipped: true }, status);
  }
  assert.deepEqual(check({}, { ...fromMercadoPago(mercadoPagoPayment()), gateway: 'paypal' }), { ok: true, skipped: true });
});

test('valores inválidos não quebram: divergência de valor com o lado inválido em null', () => {
  for (const totalPaid of [Number.NaN, undefined, null, '', 'abc', '1e3', '150,00', -150, Number.POSITIVE_INFINITY, {}, [], true]) {
    assert.deepEqual(
      check({ totalPaid }, fromMercadoPago(mercadoPagoPayment())),
      mismatch(['amount_mismatch'], null, 165, null),
      `totalPaid ${String(totalPaid)}`
    );
  }
  for (const serviceFeeAmount of [Number.NaN, 'abc', -15, Number.NEGATIVE_INFINITY]) {
    assert.deepEqual(
      check({ serviceFeeAmount }, fromMercadoPago(mercadoPagoPayment())),
      mismatch(['amount_mismatch'], null, 165, null),
      `serviceFeeAmount ${String(serviceFeeAmount)}`
    );
  }
  for (const transaction_amount of [Number.NaN, undefined, null, '', 'abc', -165, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(
      check({}, fromMercadoPago(mercadoPagoPayment({ transaction_amount }))),
      mismatch(['amount_mismatch'], 165, null, null),
      `transaction_amount ${String(transaction_amount)}`
    );
  }
  // Entradas ausentes ou malformadas também não lançam.
  assert.deepEqual(checkPaymentAgainstRegistration(undefined), { ok: true, skipped: true });
  assert.deepEqual(checkPaymentAgainstRegistration({}), { ok: true, skipped: true });
  assert.deepEqual(
    checkPaymentAgainstRegistration({ payment: fromMercadoPago(mercadoPagoPayment({ metadata: null })) }),
    mismatch(['amount_mismatch'], null, 165, null)
  );
  assert.deepEqual(
    checkPaymentAgainstRegistration({ registration: registration(), payment: { gateway: 'mercadopago', status: 'approved' } }),
    mismatch(['amount_mismatch'], 165, null, null)
  );
});

test('centavos: valores como 33,33 e somas inexatas em ponto flutuante comparam exatos', () => {
  assert.deepEqual(check({ totalPaid: 33.33, serviceFeeAmount: 3.33 }, fromMercadoPago(mercadoPagoPayment({ transaction_amount: 36.66 }))), { ok: true });
  // 110,70 + 11,07 em ponto flutuante dá 121,77000000000001.
  assert.notEqual(110.7 + 11.07, 121.77);
  assert.deepEqual(check({ totalPaid: 110.7, serviceFeeAmount: 11.07 }, fromMercadoPago(mercadoPagoPayment({ transaction_amount: 121.77 }))), { ok: true });
  assert.deepEqual(
    check({ totalPaid: 110.7, serviceFeeAmount: 11.07 }, fromMercadoPago(mercadoPagoPayment({ transaction_amount: 110.7 }))),
    mismatch(['amount_mismatch'], 121.77, 110.7, 'below')
  );
  assert.deepEqual(check({ totalPaid: 0.1, serviceFeeAmount: 0.2 }, fromMercadoPago(mercadoPagoPayment({ transaction_amount: 0.3 }))), { ok: true });
  // Os valores devolvidos saem em duas casas, sem resíduo.
  assert.deepEqual(
    check({ totalPaid: 33.33, serviceFeeAmount: 3.33 }, fromMercadoPago(mercadoPagoPayment({ transaction_amount: 33.33 }))),
    mismatch(['amount_mismatch'], 36.66, 33.33, 'below')
  );
  // Fração de centavo vinda do gateway é arredondada antes de comparar.
  assert.deepEqual(check({ totalPaid: 33.33, serviceFeeAmount: 3.33 }, fromMercadoPago(mercadoPagoPayment({ transaction_amount: 36.664 }))), { ok: true });
});

test('valores grandes comparam em centavos inteiros; valor fora da faixa segura é inválido', () => {
  assert.deepEqual(
    check({ totalPaid: 99999.99, serviceFeeAmount: 9999.99 }, fromMercadoPago(mercadoPagoPayment({ transaction_amount: 109999.98 }))),
    { ok: true }
  );
  assert.deepEqual(
    check({ totalPaid: 99999.99, serviceFeeAmount: 9999.99 }, fromMercadoPago(mercadoPagoPayment({ transaction_amount: 109999.87 }))),
    mismatch(['amount_mismatch'], 109999.98, 109999.87, 'below')
  );
  assert.deepEqual(
    check({ totalPaid: 12345678.9, serviceFeeAmount: 1234567.89 }, fromMercadoPago(mercadoPagoPayment({ transaction_amount: 13580246.79 }))),
    { ok: true }
  );
  assert.deepEqual(
    check({ totalPaid: 1e20, serviceFeeAmount: 0 }, fromMercadoPago(mercadoPagoPayment({ transaction_amount: 1e20 }))),
    mismatch(['amount_mismatch'], null, null, null)
  );
});

// ---------------------------------------------------------------------------
// Stripe
// ---------------------------------------------------------------------------

const euroRegistration = { currency: 'EUR' };

test('Stripe: o Checkout cobra o total_paid e retém a taxa dele; amount_received igual corresponde', () => {
  assert.deepEqual(check(euroRegistration, fromStripe(stripeIntent())), { ok: true });
  // amount ausente em amount_received (0) cai no amount, como no webhook.
  assert.deepEqual(check(euroRegistration, fromStripe(stripeIntent({ amount_received: 0 }))), { ok: true });
  assert.deepEqual(check({ ...euroRegistration, serviceFeeAmount: null }, fromStripe(stripeIntent())), { ok: true });
});

test('Stripe: tolerância de 10 unidades menores e divergência para cima ou para baixo', () => {
  assert.deepEqual(check(euroRegistration, fromStripe(stripeIntent({ amount_received: 15010 }))), { ok: true });
  assert.deepEqual(check(euroRegistration, fromStripe(stripeIntent({ amount_received: 14990 }))), { ok: true });
  assert.deepEqual(
    check(euroRegistration, fromStripe(stripeIntent({ amount_received: 15011 }))),
    mismatch(['amount_mismatch'], 150, 150.11, 'above')
  );
  assert.deepEqual(
    check(euroRegistration, fromStripe(stripeIntent({ amount_received: 10000 }))),
    mismatch(['amount_mismatch'], 150, 100, 'below')
  );
  // Total com a taxa somada não é o que o Checkout cobra.
  assert.deepEqual(
    check(euroRegistration, fromStripe(stripeIntent({ amount_received: 16500 }))),
    mismatch(['amount_mismatch'], 150, 165, 'above')
  );
});

test('Stripe: moeda em minúsculas confere com a da inscrição; outra moeda e outra inscrição divergem', () => {
  assert.deepEqual(check({ currency: 'GBP' }, fromStripe(stripeIntent({ currency: 'gbp' }))), { ok: true });
  assert.deepEqual(
    check(euroRegistration, fromStripe(stripeIntent({ currency: 'gbp' }))),
    mismatch(['currency_mismatch'], 150, 150, null)
  );
  assert.deepEqual(
    check(euroRegistration, fromStripe(stripeIntent({ metadata: { registration_id: OTHER_REG_ID } }))),
    mismatch(['registration_mismatch'], 150, 150, null)
  );
  assert.deepEqual(check(euroRegistration, fromStripe(stripeIntent({ metadata: {} }))), { ok: true });
});

// ---------------------------------------------------------------------------
// Decisão e aviso
// ---------------------------------------------------------------------------

const reviewInput = (mode, payment = fromMercadoPago(mercadoPagoPayment({ transaction_amount: 150 }))) => ({
  mode,
  source: 'mp-webhook',
  eventId: EVENT_ID,
  registration: registration(),
  payment
});

test('off não confere; observe só avisa; enforce segura a aprovação; valor desconhecido de modo vale observe', () => {
  assert.deepEqual(reviewPaymentIntegrity(reviewInput('off')), { hold: false, warning: null });

  const observed = reviewPaymentIntegrity(reviewInput('observe'));
  assert.equal(observed.hold, false);
  assert.match(observed.warning, /^\[Payment Integrity\] \{/);

  const enforced = reviewPaymentIntegrity(reviewInput('enforce'));
  assert.equal(enforced.hold, true);
  assert.match(enforced.warning, /"mode":"enforce"/);

  for (const mode of [undefined, '', 'ENFORCE', 'bloquear']) {
    const review = reviewPaymentIntegrity(reviewInput(mode));
    assert.equal(review.hold, false, String(mode));
    assert.match(review.warning, /"mode":"observe"/, String(mode));
  }
});

test('pagamento correspondente ou não aprovado não gera aviso em nenhum modo', () => {
  for (const mode of ['off', 'observe', 'enforce', undefined]) {
    assert.deepEqual(reviewPaymentIntegrity(reviewInput(mode, fromMercadoPago(mercadoPagoPayment()))), { hold: false, warning: null });
    assert.deepEqual(
      reviewPaymentIntegrity(reviewInput(mode, fromMercadoPago(mercadoPagoPayment({ status: 'pending', transaction_amount: 1 })))),
      { hold: false, warning: null }
    );
  }
});

test('o aviso é uma linha de JSON com os campos previstos e sem dados pessoais', () => {
  const { warning } = reviewPaymentIntegrity({
    ...reviewInput('observe'),
    // Campos extras da inscrição não vão para o aviso.
    registration: { ...registration(), athleteEmail: 'ana@example.com', athleteName: 'Ana Souza' }
  });
  assert.ok(warning.startsWith(`${PAYMENT_INTEGRITY_LOG_PREFIX} `));
  assert.doesNotMatch(warning, /\n/);
  assert.doesNotMatch(warning, /@|Ana Souza/);
  assert.deepEqual(JSON.parse(warning.slice(PAYMENT_INTEGRITY_LOG_PREFIX.length + 1)), {
    mode: 'observe',
    source: 'mp-webhook',
    registrationId: REG_ID,
    eventId: EVENT_ID,
    paymentId: '1324567890',
    reasons: ['amount_mismatch'],
    expected: 165,
    paid: 150,
    currency: 'BRL'
  });
});

test('o aviso continua em uma linha com identificadores estranhos e campos ausentes', () => {
  const line = formatPaymentIntegrityWarning({
    mode: 'enforce',
    source: 'stripe-webhook',
    registrationId: 'reg-a\nb',
    eventId: undefined,
    paymentId: { nested: true },
    reasons: ['currency_mismatch'],
    expected: null,
    paid: null,
    currency: 'eur'
  });
  assert.doesNotMatch(line, /\n/);
  assert.deepEqual(JSON.parse(line.slice(PAYMENT_INTEGRITY_LOG_PREFIX.length + 1)), {
    mode: 'enforce',
    source: 'stripe-webhook',
    registrationId: 'reg-a\nb',
    eventId: null,
    paymentId: null,
    reasons: ['currency_mismatch'],
    expected: null,
    paid: null,
    currency: 'EUR'
  });
});

// ---------------------------------------------------------------------------
// Regressão estática: onde a conferência roda e onde não roda
// ---------------------------------------------------------------------------

const routes = {
  card: read('../src/app/api/checkout/card/route.ts'),
  pix: read('../src/app/api/checkout/pix/route.ts'),
  preference: read('../src/app/api/checkout/preference/route.ts'),
  coupon: read('../src/app/api/checkout/coupon/route.ts'),
  config: read('../src/app/api/checkout/config/route.ts'),
  status: read('../src/app/api/checkout/status/route.ts'),
  mercadopagoWebhook: read('../src/app/api/webhooks/mercadopago/route.ts'),
  stripeWebhook: read('../src/app/api/webhooks/stripe/route.ts'),
  stripeReturn: read('../src/app/api/stripe/return/route.ts')
};

test('rotas de criação de pagamento (cartão, Pix, preferência) não conhecem a conferência', () => {
  for (const name of ['card', 'pix', 'preference', 'coupon', 'config']) {
    assert.doesNotMatch(routes[name], /payment_?integrity|PAYMENT_INTEGRITY|reviewPaymentBeforeApproval/i, `rota ${name}`);
  }
});

test('o retorno do Stripe Connect só sincroniza a conta conectada: não aprova inscrição', () => {
  assert.doesNotMatch(routes.stripeReturn, /registrations|payment_status|applyCouponUsage|triggerRegistrationApprovedEmail/);
  assert.match(routes.stripeReturn, /from\('stripe_accounts'\)/);
});

test('as rotas que aprovam a partir de um pagamento passam pela conferência antes de gravar', () => {
  for (const name of ['status', 'mercadopagoWebhook', 'stripeWebhook']) {
    const source = routes[name];
    assert.match(source, /import \{ PAYMENT_INTEGRITY_STATUS_DETAIL \} from '@\/lib\/paymentIntegrity';/, name);
    assert.match(source, /import \{ reviewPaymentBeforeApproval \} from '@\/lib\/serverPaymentIntegrity';/, name);
    const reviewAt = source.indexOf('await reviewPaymentBeforeApproval(');
    const updateAt = source.search(/\.from\('registrations'\)\s*\.update\(/);
    assert.ok(reviewAt > 0 && updateAt > reviewAt, `${name}: conferência antes do update`);
    assert.match(source, /holdForReview \? PAYMENT_INTEGRITY_STATUS_DETAIL : /, name);
  }
});

// A regra de valor por gateway acompanha como cada rota de criação cobra.
test('a regra de valor segue a cobrança: Mercado Pago soma a taxa; Stripe cobra o total e retém a taxa', () => {
  assert.match(routes.card, /transaction_amount: serviceFee\.amountCollected,/);
  assert.match(routes.pix, /transaction_amount: serviceFee\.amountCollected,/);
  assert.match(routes.preference, /unit_price: transactionAmount\n[\s\S]*?id: 'wodarena-service-fee',[\s\S]*?unit_price: serviceFee\.serviceFeeAmount/);
  assert.match(routes.preference, /unit_amount: toMinorUnits\(serviceFee\.baseAmount, paymentContext\.currency\),/);
  assert.match(routes.preference, /application_fee_amount: serviceFeeMinorUnits/);
  assert.match(moduleSource, /if \(gateway === 'stripe'\) return totalCents;/);
});

test('.env.example documenta PAYMENT_INTEGRITY_MODE com observe como padrão', () => {
  const envExample = read('../.env.example');
  assert.match(envExample, /# Conferência do pagamento antes de aprovar a inscrição: off \| observe \| enforce \(padrão: observe\)\./);
  assert.match(envExample, /^PAYMENT_INTEGRITY_MODE=observe$/m);
});
