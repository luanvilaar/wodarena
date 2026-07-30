import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { calculateServiceFee } from '../src/lib/serviceFee.ts';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const fee = read('../src/lib/serviceFee.ts');
const migration = read('../supabase/migrations/20260729120000_service_fee_split_payments.sql');
const startRoute = read('../src/app/api/registrations/start/route.ts');
const preferenceRoute = read('../src/app/api/checkout/preference/route.ts');
const statusRoute = read('../src/app/api/checkout/status/route.ts');
const webhookRoute = read('../src/app/api/webhooks/mercadopago/route.ts');
const ownerRoute = read('../src/app/api/owner/service-fee/route.ts');
const ownerPage = read('../src/app/owner/page.tsx');
const registerModal = read('../src/components/RegisterModal.tsx');
const types = read('../src/types/index.ts');
const bootstrap = read('../src/app/api/app/bootstrap/route.ts');

test('service fee uses integer cents and applies 10% only to paid registrations', () => {
  assert.match(fee, /DEFAULT_SERVICE_FEE_PERCENT = 10/);
  assert.match(fee, /Math\.round\(\(amount \+ Number\.EPSILON\) \* 100\)/);
  assert.match(fee, /baseCents \* percent/);
  assert.match(fee, /enabled && baseCents > 0/);

  assert.deepEqual(calculateServiceFee(80, 10, true), {
    baseAmount: 80,
    serviceFeePercent: 10,
    serviceFeeAmount: 8,
    amountCollected: 88
  });
  assert.deepEqual(calculateServiceFee(199.9, 10, true), {
    baseAmount: 199.9,
    serviceFeePercent: 10,
    serviceFeeAmount: 19.99,
    amountCollected: 219.89
  });
  assert.deepEqual(calculateServiceFee(80, 10, false), {
    baseAmount: 80,
    serviceFeePercent: 0,
    serviceFeeAmount: 0,
    amountCollected: 80
  });
  assert.deepEqual(calculateServiceFee(0, 10, true), {
    baseAmount: 0,
    serviceFeePercent: 10,
    serviceFeeAmount: 0,
    amountCollected: 0
  });
});

test('migration persists a global switch and financial audit fields without altering historic totals', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.platform_settings/);
  assert.match(migration, /service_fee_percent NUMERIC NOT NULL DEFAULT 10/);
  assert.match(migration, /service_fee_enabled BOOLEAN NOT NULL DEFAULT TRUE/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS service_fee_amount NUMERIC/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS amount_collected NUMERIC/);
  assert.match(migration, /amount_collected = COALESCE\(amount_collected, total_paid\)/);
});

test('registration start computes the split server-side before persisting a paid registration', () => {
  assert.match(startRoute, /resolveMercadoPagoCheckoutConfig\(secureSnapshot\.eventId\)/);
  assert.match(startRoute, /calculateServiceFee\(/);
  assert.match(startRoute, /service_fee_amount: serviceFee\.serviceFeeAmount/);
  assert.match(startRoute, /amount_collected: serviceFee\.amountCollected/);
});

test('Checkout Pro includes a transparent service fee item and marketplace fee', () => {
  assert.match(preferenceRoute, /Taxa de serviço \(\$\{serviceFee\.serviceFeePercent\}%\)/);
  assert.match(preferenceRoute, /marketplace_fee: serviceFee\.serviceFeeAmount/);
  assert.match(preferenceRoute, /amount_collected: serviceFee\.amountCollected/);
});

test('payment reconciliation stores charged amounts and matches the amount collected', () => {
  assert.match(statusRoute, /registration\.amount_collected \?\? registration\.total_paid/);
  assert.match(statusRoute, /application_fee_charged: applicationFeeCharged/);
  assert.match(webhookRoute, /amount_collected: amountCollected/);
  assert.match(webhookRoute, /application_fee_charged: applicationFeeCharged/);
});

test('owner controls the global switch and checkout shows the fee breakdown', () => {
  assert.match(ownerRoute, /requireSession\(request, \['owner'\]\)/);
  assert.match(ownerRoute, /service_fee_enabled: enabled/);
  assert.match(ownerPage, /Taxa de serviço WODArena/);
  assert.match(ownerPage, /Receita Real de Taxas/);
  assert.match(registerModal, /Taxa de serviço \(\{serviceFeeConfig\.percent\}%\)/);
  assert.match(registerModal, /calculateServiceFee\(totalPaid, serviceFeeConfig\.percent, serviceFeeConfig\.enabled\)/);
  assert.match(registerModal, /amountCollectedPreview/);
});

test('private registration payload exposes split fields without making them public', () => {
  assert.match(types, /serviceFeeAmount\?: number/);
  assert.match(types, /amountCollected\?: number/);
  assert.match(bootstrap, /service_fee_amount, amount_collected, application_fee_charged/);
});
