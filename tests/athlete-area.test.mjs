import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const types = read('../src/types/index.ts');
const registerModal = read('../src/components/RegisterModal.tsx');
const startRoute = read('../src/app/api/registrations/start/route.ts');
const cardRoute = read('../src/app/api/checkout/card/route.ts');
const webhookRoute = read('../src/app/api/webhooks/mercadopago/route.ts');
const adminPage = read('../src/app/admin/page.tsx');
const voucher = read('../src/components/RegistrationVoucher.tsx');
const migration = read('../supabase/migrations/20260606110000_athlete_area_registrations.sql');

test('athlete role and registration payment state are part of the shared model', () => {
  assert.match(types, /role: 'owner' \| 'manager' \| 'athlete'/);
  assert.match(types, /export type RegistrationPaymentStatus/);
  assert.match(types, /paymentStatus\?: RegistrationPaymentStatus/);
  assert.match(migration, /role IN \('owner', 'manager', 'athlete'\)/);
  assert.match(migration, /payment_status TEXT DEFAULT 'payment_approved'/);
});

test('registration checkout collects athlete panel password before payment', () => {
  assert.match(registerModal, /athletePassword/);
  assert.match(registerModal, /athletePasswordConfirmation/);
  assert.match(registerModal, /\/api\/registrations\/start/);
  assert.match(registerModal, /Crie uma senha de pelo menos 6 caracteres/);
  assert.match(registerModal, /Informe um e-mail válido para criar o painel do atleta/);
});

test('registration start endpoint creates athlete user, secret, athlete and pending registration', () => {
  assert.match(startRoute, /role: 'athlete'/);
  assert.match(startRoute, /from\('users_secrets'\)[\s\S]*upsert/);
  assert.match(startRoute, /from\('athletes'\)[\s\S]*insert/);
  assert.match(startRoute, /from\('registrations'\)[\s\S]*upsert/);
  assert.match(startRoute, /payment_status: paymentStatus/);
});

test('credit card failures update existing registrations as failed', () => {
  assert.match(cardRoute, /paymentStatus: 'payment_failed'/);
  assert.match(cardRoute, /payment_status: payload\.paymentStatus/);
  assert.match(cardRoute, /payment_error_message/);
  assert.match(registerModal, /Pagamento não processado\. Sua inscrição foi registrada/);
});

test('webhook updates registration payment status by registration id', () => {
  assert.match(webhookRoute, /toRegistrationPaymentStatus/);
  assert.match(webhookRoute, /payment_status: nextPaymentStatus/);
  assert.match(webhookRoute, /metadataRegistrationId/);
  assert.match(webhookRoute, /\.eq\('id', metadataRegistrationId\)/);
  assert.match(webhookRoute, /\.eq\('event_id', eventId\)/);
  assert.doesNotMatch(webhookRoute, /from\('registrations'\)\.upsert/);
});

test('athlete area is rendered inside admin route without manager controls', () => {
  assert.match(adminPage, /isAthleteLoggedIn/);
  assert.match(adminPage, /Área do Atleta/);
  assert.match(adminPage, /Solicitar 2ª via/);
  assert.match(adminPage, /Pagamento não processado/);
  assert.match(adminPage, /currentUser\.role === 'manager' \|\| currentUser\.role === 'athlete'/);
  assert.doesNotMatch(adminPage, /Acesso negado\. Esta conta não possui privilégios de gestor/);
});

test('athlete area refreshes registrations to reflect Mercado Pago status updates', () => {
  assert.match(adminPage, /refreshRegistrations/);
  assert.match(adminPage, /pendingAthleteRegistrations/);
  assert.match(adminPage, /\/api\/checkout\/status\?payment_id=/);
  assert.match(adminPage, /window\.addEventListener\('focus', syncAthleteRegistrations\)/);
  assert.match(adminPage, /window\.setInterval\(syncAthleteRegistrations, 15000\)/);
});

test('voucher reflects non-approved payment status', () => {
  assert.match(voucher, /Pagamento não processado/);
  assert.match(voucher, /Inscrição registrada/);
  assert.match(voucher, /não confirma a vaga financeiramente/);
});
