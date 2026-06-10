import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const migration = read('../supabase/migrations/20260609100000_coupon_usage_tracking.sql');
const serverCheckout = read('../src/lib/serverCheckout.ts');
const webhookRoute = read('../src/app/api/webhooks/mercadopago/route.ts');
const cardRoute = read('../src/app/api/checkout/card/route.ts');
const pixRoute = read('../src/app/api/checkout/pix/route.ts');
const statusRoute = read('../src/app/api/checkout/status/route.ts');
const startRoute = read('../src/app/api/registrations/start/route.ts');
const registerModal = read('../src/components/RegisterModal.tsx');
const eventPage = read('../src/app/event/[id]/page.tsx');

test('migration adds idempotency flag, atomic RPC and a backfill that fixes existing counters', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS coupon_counted BOOLEAN DEFAULT false/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION apply_coupon_usage\(p_registration_id TEXT\)/);
  // A reivindicação atômica só conta inscrições aprovadas e ainda não contabilizadas.
  assert.match(migration, /UPDATE registrations[\s\S]*SET coupon_counted = true[\s\S]*payment_status = 'payment_approved'[\s\S]*COALESCE\(coupon_counted, false\) = false/);
  assert.match(migration, /SET usage_count = COALESCE\(usage_count, 0\) \+ 1/);
  // Backfill corrige os contadores zerados sem descartar contagens manuais existentes.
  assert.match(migration, /SET usage_count = COALESCE\(c\.usage_count, 0\) \+ sub\.cnt/);
});

test('serverCheckout exposes an atomic, non-throwing coupon usage helper backed by the RPC', () => {
  assert.match(serverCheckout, /export const applyCouponUsageForApprovedRegistration = async/);
  assert.match(serverCheckout, /supabaseAdmin\.rpc\('apply_coupon_usage', \{/);
  assert.match(serverCheckout, /p_registration_id: id/);
  // Nunca lança: falha na contabilização não pode interromper a confirmação do pagamento.
  assert.match(serverCheckout, /try \{[\s\S]*catch \(err\) \{[\s\S]*console\.warn/);
});

test('every server-side approval path contabilizes coupon usage', () => {
  for (const [label, source] of [
    ['webhook', webhookRoute],
    ['card', cardRoute],
    ['pix', pixRoute],
    ['status', statusRoute],
    ['registrations/start', startRoute]
  ]) {
    assert.match(source, /applyCouponUsageForApprovedRegistration/, `${label} should import the helper`);
  }

  // Cada um só contabiliza na transição/condição de aprovação.
  assert.match(cardRoute, /paymentStatus === 'payment_approved'\)\s*\{\s*await applyCouponUsageForApprovedRegistration/);
  assert.match(pixRoute, /paymentData\.status === 'approved'\)\s*\{\s*await applyCouponUsageForApprovedRegistration/);
  assert.match(statusRoute, /paymentData\.status === 'approved'\)\s*\{\s*await applyCouponUsageForApprovedRegistration/);
  assert.match(startRoute, /paymentStatus === 'payment_approved'\)\s*\{\s*await applyCouponUsageForApprovedRegistration/);
});

test('webhook no longer increments the coupon manually (delegates to the idempotent helper)', () => {
  assert.doesNotMatch(webhookRoute, /usage_count: \(couponData\.usage_count \|\| 0\) \+ 1/);
});

test('athlete-side flows do not try to increment coupons from the client anymore', () => {
  // Esses caminhos rodam como atleta (sem sessão de gestor) e falhavam com 403.
  assert.doesNotMatch(registerModal, /incrementCouponUsage/);
  assert.doesNotMatch(eventPage, /incrementCouponUsage/);
});
