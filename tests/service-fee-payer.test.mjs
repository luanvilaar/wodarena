import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

import {
  calculateServiceFee,
  defaultServiceFeePayer,
  normalizeServiceFeePayer,
  resolveServiceFeePayer,
  splitRegistrationAmounts
} from '../src/lib/serviceFee.ts';
import { checkPaymentAgainstRegistration } from '../src/lib/paymentIntegrity.ts';
import {
  buildEventFinanceRow,
  resolveCollectedAmount,
  resolveManagerReceived,
  resolveRegistrationFeePayer
} from '../src/lib/managerFinance.ts';

// Stories 1.82 a 1.85: o gestor escolhe se a taxa da plataforma é paga pelo atleta
// (somada ao valor da inscrição) ou absorvida por ele (dentro do valor).

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('atleta paga a taxa: o total cobrado soma 10% ao valor da inscrição (comportamento de sempre)', () => {
  assert.deepEqual(calculateServiceFee(100, 10, true, 'athlete'), {
    baseAmount: 100, serviceFeePercent: 10, serviceFeeAmount: 10, amountCollected: 110
  });
  // Sem o quarto argumento o resultado é o de antes da escolha existir.
  assert.deepEqual(calculateServiceFee(100, 10, true), calculateServiceFee(100, 10, true, 'athlete'));
});

test('gestor absorve a taxa: o atleta paga só a inscrição e a plataforma retém os mesmos 10%', () => {
  assert.deepEqual(calculateServiceFee(100, 10, true, 'organizer'), {
    baseAmount: 100, serviceFeePercent: 10, serviceFeeAmount: 10, amountCollected: 100
  });
  assert.deepEqual(calculateServiceFee(199.9, 10, true, 'organizer'), {
    baseAmount: 199.9, serviceFeePercent: 10, serviceFeeAmount: 19.99, amountCollected: 199.9
  });
});

test('taxa desligada ou inscrição gratuita não cobram nada em nenhum dos modos', () => {
  for (const payer of ['athlete', 'organizer']) {
    assert.equal(calculateServiceFee(100, 10, false, payer).serviceFeeAmount, 0);
    assert.equal(calculateServiceFee(100, 10, false, payer).amountCollected, 100);
    assert.equal(calculateServiceFee(0, 10, true, payer).serviceFeeAmount, 0);
    assert.equal(calculateServiceFee(0, 10, true, payer).amountCollected, 0);
  }
});

test('a escolha vazia ou inválida vale o padrão do gateway: Mercado Pago atleta, Stripe gestor', () => {
  assert.equal(normalizeServiceFeePayer('athlete'), 'athlete');
  assert.equal(normalizeServiceFeePayer('organizer'), 'organizer');
  for (const bad of [null, undefined, '', 'manager', 1, {}]) assert.equal(normalizeServiceFeePayer(bad), null);
  assert.equal(defaultServiceFeePayer('mercadopago'), 'athlete');
  assert.equal(defaultServiceFeePayer('stripe'), 'organizer');
  assert.equal(defaultServiceFeePayer(undefined), 'athlete');
  assert.equal(resolveServiceFeePayer(null, 'stripe'), 'organizer');
  assert.equal(resolveServiceFeePayer('athlete', 'stripe'), 'athlete');
  assert.equal(resolveServiceFeePayer('organizer', 'mercadopago'), 'organizer');
});

test('splitRegistrationAmounts separa o que o gestor recebe do que o atleta paga', () => {
  assert.deepEqual(splitRegistrationAmounts(100, 10, 'athlete'), { organizerReceives: 100, athletePays: 110 });
  assert.deepEqual(splitRegistrationAmounts(100, 10, 'organizer'), { organizerReceives: 90, athletePays: 100 });
  assert.deepEqual(splitRegistrationAmounts(0, 0, 'organizer'), { organizerReceives: 0, athletePays: 0 });
});

// --- conferência do pagamento (achado A1) ---

const paid = (amount, gateway) => ({ status: gateway === 'stripe' ? 'succeeded' : 'approved', amount, currency: 'BRL', gateway });

test('conferência: atleta paga a taxa, o esperado é inscrição + taxa nos dois gateways', () => {
  const registration = { id: 'r', totalPaid: 100, serviceFeeAmount: 10, serviceFeePayer: 'athlete', currency: 'BRL' };
  assert.equal(checkPaymentAgainstRegistration({ registration, payment: paid(110, 'mercadopago') }).ok, true);
  assert.equal(checkPaymentAgainstRegistration({ registration, payment: paid(110, 'stripe') }).ok, true);
  assert.equal(checkPaymentAgainstRegistration({ registration, payment: paid(100, 'mercadopago') }).ok, false);
});

test('conferência: gestor absorve a taxa, o esperado é só a inscrição e somar a taxa vira divergência', () => {
  const registration = { id: 'r', totalPaid: 100, serviceFeeAmount: 10, serviceFeePayer: 'organizer', currency: 'BRL' };
  assert.equal(checkPaymentAgainstRegistration({ registration, payment: paid(100, 'mercadopago') }).ok, true);
  assert.equal(checkPaymentAgainstRegistration({ registration, payment: paid(100, 'stripe') }).ok, true);
  const overcharged = checkPaymentAgainstRegistration({ registration, payment: paid(110, 'mercadopago') });
  assert.equal(overcharged.ok, false);
  assert.equal(overcharged.direction, 'above');
});

test('conferência: inscrição sem a escolha gravada segue o padrão antigo de cada gateway', () => {
  const registration = { id: 'r', totalPaid: 100, serviceFeeAmount: 10, currency: 'BRL' };
  assert.equal(checkPaymentAgainstRegistration({ registration, payment: paid(110, 'mercadopago') }).ok, true);
  assert.equal(checkPaymentAgainstRegistration({ registration, payment: paid(100, 'stripe') }).ok, true);
  assert.equal(checkPaymentAgainstRegistration({ registration: { ...registration, serviceFeePayer: null }, payment: paid(100, 'stripe') }).ok, true);
});

// --- finanças do gestor (achado A2) ---

const reg = (overrides = {}) => ({
  id: 'r1', eventId: 'evt-1', divisionId: 'd', athleteName: 'A', athleteEmail: 'a@b.com', athletePhone: '', box: '',
  gender: 'male', ticketType: 'RX', ticketPrice: 100, quantity: 1, totalPaid: 100, createdAt: '2026-10-01T12:00:00.000Z',
  paymentStatus: 'payment_approved', ...overrides
});

test('finanças: atleta paga a taxa, o gestor recebe o ingresso inteiro e o atleta desembolsa ingresso + taxa', () => {
  const r = reg({ serviceFeePayer: 'athlete', serviceFeeAmount: 10, amountCollected: 110 });
  assert.equal(resolveManagerReceived(r), 100);
  assert.equal(resolveCollectedAmount(r), 110);
});

test('finanças: gestor absorve a taxa, recebe ingresso menos taxa e o atleta desembolsa só o ingresso', () => {
  const r = reg({ serviceFeePayer: 'organizer', serviceFeeAmount: 10, amountCollected: 100 });
  assert.equal(resolveManagerReceived(r), 90);
  assert.equal(resolveCollectedAmount(r), 100);
  // A taxa efetivamente retida pelo gateway tem precedência sobre a calculada.
  assert.equal(resolveManagerReceived({ ...r, applicationFeeCharged: 9.5 }), 90.5);
});

test('finanças: sem escolha gravada vale o padrão do gateway (Stripe antigo não soma taxa ao total)', () => {
  assert.equal(resolveRegistrationFeePayer(reg({ paymentGateway: 'mercadopago' })), 'athlete');
  assert.equal(resolveRegistrationFeePayer(reg({ paymentGateway: 'stripe' })), 'organizer');
  const stripeLegacy = reg({ paymentGateway: 'stripe', serviceFeeAmount: 10, amountCollected: 110 });
  assert.equal(resolveManagerReceived(stripeLegacy), 90);
  assert.equal(resolveCollectedAmount(stripeLegacy), 100);
});

test('finanças: a linha do evento soma os dois modos juntos', () => {
  const event = { id: 'evt-1', name: 'Arena', divisions: [], currency: 'BRL' };
  const row = buildEventFinanceRow(event, [
    reg({ id: 'a', serviceFeePayer: 'athlete', serviceFeeAmount: 10, amountCollected: 110 }),
    reg({ id: 'b', serviceFeePayer: 'organizer', serviceFeeAmount: 10, amountCollected: 100 })
  ]);
  assert.equal(row.netRevenue, 190);
  assert.equal(row.serviceFee, 20);
  assert.equal(row.collected, 210);
});

// --- migration e rotas ---

const migrationFile = readdirSync(new URL('../supabase/migrations/', import.meta.url)).find(f => f.endsWith('_service_fee_payer.sql'));
const migration = read(`../supabase/migrations/${migrationFile}`);

test('a migration é aditiva: tabela de escolhas com RLS e coluna na inscrição, sem editar nada aplicado', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.manager_payment_settings/);
  assert.match(migration, /service_fee_payer TEXT NOT NULL CHECK \(service_fee_payer IN \('athlete', 'organizer'\)\)/);
  assert.match(migration, /ALTER TABLE public\.manager_payment_settings ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS service_fee_payer TEXT/);
  assert.match(migration, /service_fee_payer IS NULL OR service_fee_payer IN \('athlete', 'organizer'\)/);
  assert.doesNotMatch(migration, /^\s*(UPDATE|DELETE FROM|DROP TABLE|DROP COLUMN)/m);
  assert.match(migration, /ANTES de publicar o código/);
});

test('as rotas de pagamento cobram e gravam conforme a escolha do gestor', () => {
  const routes = {
    start: read('../src/app/api/registrations/start/route.ts'),
    card: read('../src/app/api/checkout/card/route.ts'),
    pix: read('../src/app/api/checkout/pix/route.ts'),
    preference: read('../src/app/api/checkout/preference/route.ts')
  };
  for (const [name, source] of Object.entries(routes)) {
    assert.match(source, /serviceFeePayer/, `rota ${name} lê quem paga a taxa`);
    assert.match(source, /service_fee_payer/, `rota ${name} grava quem pagou a taxa`);
  }
  assert.match(routes.card, /checkoutConfig\.serviceFeeEnabled,\s*checkoutConfig\.serviceFeePayer/);
  assert.match(routes.pix, /checkoutConfig\.serviceFeeEnabled,\s*checkoutConfig\.serviceFeePayer/);
  // A comissão do marketplace é a mesma nos dois modos.
  assert.match(routes.card, /application_fee: serviceFee\.serviceFeeAmount/);
  assert.match(routes.pix, /application_fee: serviceFee\.serviceFeeAmount/);
  assert.match(routes.preference, /marketplace_fee: serviceFee\.serviceFeeAmount/);
});

test('os resolvedores de configuração leem a escolha do gestor do evento, com o padrão de cada gateway', () => {
  const mp = read('../src/lib/mercadopagoServer.ts');
  const stripe = read('../src/lib/stripeServer.ts');
  const helper = read('../src/lib/serverServiceFeePayer.ts');
  assert.match(helper, /from\('manager_payment_settings'\)/);
  assert.match(mp, /resolveServiceFeePayer\([\s\S]*?'mercadopago'\)/);
  assert.match(stripe, /resolveServiceFeePayer\(payer, 'stripe'\)/);
  assert.match(read('../src/app/api/checkout/config/route.ts'), /serviceFeePayer: checkoutConfig\.serviceFeePayer/);
});

// --- rota do gestor, aba Pagamentos, checkout e painel do dono (Stories 1.84 e 1.85) ---

test('a rota do gestor exige sessão de gestor/dono, acesso operacional e só aceita athlete ou organizer', () => {
  const route = read('../src/app/api/admin/payment-settings/route.ts');
  assert.match(route, /requireSession\(request, \['manager', 'owner'\]\)/);
  assert.match(route, /assertManagerOperationalAccess\(supabaseAdmin, actor\)/);
  assert.match(route, /canActOnUser\(actor, userId\)/);
  assert.match(route, /normalizeServiceFeePayer\(body\?\.serviceFeePayer\)/);
  assert.match(route, /status: 400/);
  assert.match(route, /\.from\('manager_payment_settings'\)\s*\.upsert\(/);
});

test('a aba Pagamentos mostra o cartão só com a taxa da plataforma ligada, e salva pela rota', () => {
  const admin = read('../src/app/admin/page.tsx');
  assert.match(admin, /fetch\('\/api\/admin\/payment-settings'\)/);
  assert.match(admin, /feeSettings\?\.platformFee\.enabled/);
  assert.match(admin, /Repassar ao atleta/);
  assert.match(admin, /Absorver no valor da inscrição/);
  assert.match(admin, /method: 'PUT'[\s\S]*?serviceFeePayer: selectedFeePayer/);
  // Sem escolha salva, a tela mostra o que vale hoje: Stripe tira do gestor, Mercado Pago soma ao atleta.
  assert.match(admin, /resolveServiceFeePayer\(null, stripeOnly \? 'stripe' : 'mercadopago'\)/);
});

test('o resumo do pedido do atleta esconde a linha de taxa quando o gestor a absorve', () => {
  const modal = read('../src/components/RegisterModal.tsx');
  assert.match(modal, /serviceFeePreview > 0 && serviceFeeConfig\.payer === 'athlete'/);
  assert.match(modal, /data\.serviceFeePayer === 'organizer' \? 'organizer' : 'athlete'/);
});

test('o painel do dono só lê quem paga a taxa e o saldo do gestor desconta a taxa absorvida', () => {
  const ownerRoute = read('../src/app/api/owner/service-fee/route.ts');
  const ownerPage = read('../src/app/owner/page.tsx');
  assert.match(ownerRoute, /requireSession\(request, \['owner'\]\)/);
  assert.match(ownerRoute, /\.from\('manager_payment_settings'\)\s*\.select\(/);
  assert.match(ownerPage, /Quem paga a taxa/);
  assert.match(ownerPage, /resolveManagerReceived\(r\)/);
  assert.doesNotMatch(ownerPage, /manager_payment_settings/);
});
