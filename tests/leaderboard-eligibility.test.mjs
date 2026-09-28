import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appContext = readFileSync(new URL('../src/context/AppContext.tsx', import.meta.url), 'utf8');
const persistenceRoute = readFileSync(new URL('../src/app/api/admin/persistence/route.ts', import.meta.url), 'utf8');
const admin = readFileSync(new URL('../src/app/admin/page.tsx', import.meta.url), 'utf8');

const sliceBetween = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `marker not found: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `marker not found after ${startMarker}: ${endMarker}`);
  return source.slice(start, end);
};

const getLeaderboardEligibility = sliceBetween(
  appContext,
  'const getLeaderboard = (eventId: string, divisionId: string)',
  "if (event.eventType === 'fitness_racing')"
);

const confirmManualPaymentCase = sliceBetween(
  persistenceRoute,
  "case 'confirmManualPayment':",
  "case 'cancelRegistration':"
);

test('leaderboard never falls back to showing every athlete of a division', () => {
  assert.doesNotMatch(appContext, /!hasLeaderboardEntries \|\|/);
  assert.doesNotMatch(appContext, /hasLeaderboardEntries/);
  // Todos os filtros de atletas exigem pertencer a um conjunto de elegíveis (aprovados/sincronizados)
  assert.match(getLeaderboardEligibility, /a\.divisionId === divisionId && approvedAthleteIds\.has\(a\.id\)/);
  assert.match(getLeaderboardEligibility, /a\.divisionId === divisionId && leaderboardAthleteIds\.has\(a\.id\)/);
});

test('registrations are trusted as eligibility source only for platform owner or the event manager', () => {
  assert.match(getLeaderboardEligibility, /const canTrustRegistrationsForEvent =/);
  assert.match(getLeaderboardEligibility, /currentUser\.role === 'owner'/);
  assert.match(getLeaderboardEligibility, /currentUser\.role === 'manager' && event\.organizerId === currentUser\.id/);
  assert.match(getLeaderboardEligibility, /if \(canTrustRegistrationsForEvent\)/);
  // Não basta haver inscrições carregadas (atleta logado só recebe as próprias)
  assert.doesNotMatch(getLeaderboardEligibility, /registrations\.some\(r => r\.eventId === eventId\)/);
  assert.match(getLeaderboardEligibility, /r\.paymentStatus === 'payment_approved'/);
});

test('manager can confirm a manual box-office payment with ownership and concurrency guards', () => {
  assert.match(confirmManualPaymentCase, /await ensureEventOwner\(supabaseAdmin, actor, eventId\)/);

  const updateStart = confirmManualPaymentCase.indexOf('.update(');
  assert.notEqual(updateStart, -1);
  const updateClause = confirmManualPaymentCase.slice(updateStart, confirmManualPaymentCase.indexOf('.maybeSingle()', updateStart));
  assert.match(updateClause, /payment_status: 'payment_approved'/);
  assert.match(updateClause, /\.eq\('payment_status', 'payment_pending'\)/);
  assert.match(updateClause, /\.eq\('payment_method', 'manual'\)/);

  // Corrida perdida (0 linhas) responde 409, não 500 genérico
  assert.match(confirmManualPaymentCase, /status: 409/);

  // Uso de cupom só é contabilizado depois da aprovação efetiva
  const couponUsageIndex = confirmManualPaymentCase.indexOf('applyCouponUsageForApprovedRegistration(supabaseAdmin, registrationId)');
  assert.notEqual(couponUsageIndex, -1);
  assert.ok(couponUsageIndex > updateStart, 'coupon usage must be applied after the approval update');
});

test('admin panel exposes manual payment confirmation only for pending manual registrations', () => {
  assert.match(admin, /const canConfirmManualPayment = reg\.paymentMethod === 'manual' && reg\.paymentStatus === 'payment_pending'/);
  assert.match(admin, /const canSync = reg\.paymentMethod !== 'manual' &&/);
  assert.match(admin, /await confirmManualPayment\(registration\.id, registration\.eventId\)/);
});
