import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const migration = read('../supabase/migrations/20260723120000_registration_cancellation_refunds.sql');
const types = read('../src/types/index.ts');
const bootstrapRoute = read('../src/app/api/app/bootstrap/route.ts');
const persistenceRoute = read('../src/app/api/admin/persistence/route.ts');
const appContext = read('../src/context/AppContext.tsx');
const adminPage = read('../src/app/admin/page.tsx');
const termsPage = read('../src/app/termos/page.tsx');
const packageJson = read('../package.json');
const cli = read('../bin/registrations.mjs');

test('registration cancellation and manual refund fields are persisted', () => {
  for (const column of [
    'cancellation_reason',
    'cancelled_at',
    'cancelled_by',
    'refund_status',
    'refund_amount',
    'refund_method',
    'refund_note',
    'refund_processed_at',
    'refund_processed_by'
  ]) {
    assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`));
    assert.match(bootstrapRoute, new RegExp(column));
  }

  assert.match(migration, /CHECK \(refund_status IN \('not_requested', 'manual_pending', 'manual_refunded'\)\)/);
  assert.match(types, /export type RegistrationRefundStatus = 'not_requested' \| 'manual_pending' \| 'manual_refunded'/);
  assert.match(types, /cancellationReason\?: string/);
  assert.match(types, /refundStatus\?: RegistrationRefundStatus/);
});

test('admin persistence cancels registrations without Mercado Pago refund calls', () => {
  assert.match(persistenceRoute, /case 'cancelRegistration': \{/);
  assert.match(persistenceRoute, /await ensureEventOwner\(supabaseAdmin, actor, eventId\)/);
  assert.match(persistenceRoute, /payment_status: 'payment_cancelled'/);
  assert.match(persistenceRoute, /refund_status: 'manual_pending'/);
  assert.match(persistenceRoute, /case 'markRegistrationRefunded': \{/);
  assert.match(persistenceRoute, /refund_status: 'manual_refunded'/);
  assert.match(persistenceRoute, /Cancele a inscrição antes de marcar o reembolso manual/);
  assert.doesNotMatch(persistenceRoute, /api\.mercadopago\.com\/v1\/payments\/.*refunds|createMercadoPagoRefund|refund_payment/i);
});

test('CLI supports cancellation and manual refund completion', () => {
  assert.match(packageJson, /"registrations:cli": "node bin\/registrations\.mjs"/);
  assert.match(cli, /npm run registrations:cli -- cancel/);
  assert.match(cli, /npm run registrations:cli -- refund/);
  assert.match(cli, /payment_status: 'payment_cancelled'/);
  assert.match(cli, /refund_status: 'manual_pending'/);
  assert.match(cli, /refund_status: 'manual_refunded'/);
  assert.doesNotMatch(cli, /api\.mercadopago\.com\/v1\/payments\/.*refunds|createMercadoPagoRefund|refund_payment/i);
});

test('AppContext exposes cancellation and refund operations and removes cancelled registration from local leaderboard', () => {
  assert.match(appContext, /cancelRegistration: \(registrationId: string, eventId: string, data: RegistrationCancellationInput\) => Promise<void>/);
  assert.match(appContext, /markRegistrationRefunded: \(registrationId: string, eventId: string, data: RegistrationRefundInput\) => Promise<void>/);
  assert.match(appContext, /adminPersist\('cancelRegistration', \{ registrationId, eventId, data \}\)/);
  assert.match(appContext, /adminPersist\('markRegistrationRefunded', \{ registrationId, eventId, data \}\)/);
  assert.match(appContext, /removeRegistrationFromLeaderboardState/);
  assert.match(appContext, /updatedReg\.paymentStatus === 'payment_cancelled'/);
});

test('manager panel renders cancellation controls and manual refund status', () => {
  assert.match(adminPage, /handleCancelRegistration/);
  assert.match(adminPage, /handleMarkRegistrationRefunded/);
  assert.match(adminPage, /Cancelar inscrição/);
  assert.match(adminPage, /Marcar reembolso/);
  assert.match(adminPage, /Reembolso manual pendente/);
  assert.match(adminPage, /Nenhum estorno automático será enviado ao Mercado Pago/);
  assert.match(adminPage, /taxas de servico WODArena e Mercado Pago/);
});

test('terms communicate manual refund strategy and non-refundable credit fees', () => {
  assert.match(termsPage, /devolução será processada manualmente/);
  assert.match(termsPage, /pagamentos por crédito/);
  assert.match(termsPage, /taxas de serviço da WODArena/);
  assert.match(termsPage, /taxas cobradas pelo Mercado Pago/);
});
