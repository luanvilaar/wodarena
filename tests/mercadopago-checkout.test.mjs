import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const helper = read('../src/lib/mercadopagoServer.ts');
const pixRoute = read('../src/app/api/checkout/pix/route.ts');
const cardRoute = read('../src/app/api/checkout/card/route.ts');
const statusRoute = read('../src/app/api/checkout/status/route.ts');
const preferenceRoute = read('../src/app/api/checkout/preference/route.ts');
const configRoute = read('../src/app/api/checkout/config/route.ts');
const webhookRoute = read('../src/app/api/webhooks/mercadopago/route.ts');
const oauthCallback = read('../src/app/api/mercadopago/oauth/callback/route.ts');
const adminMercadoPagoRoute = read('../src/app/api/admin/mercadopago/route.ts');
const relaxMercadoPagoUserMigration = read('../supabase/migrations/20260607230131_relax_mercadopago_user_unique.sql');
const registerModal = read('../src/components/RegisterModal.tsx');
const appContext = read('../src/context/AppContext.tsx');
const eventPage = read('../src/app/event/[id]/page.tsx');

test('Mercado Pago checkout resolves credentials from organizer secrets', () => {
  assert.match(helper, /from\('events'\)[\s\S]*select\('organizer_id, mp_access_token'\)/);
  assert.match(helper, /mercadopago_secrets/);
  assert.match(helper, /source: 'organizer_secret'/);
});

test('event payment routes use the centralized Mercado Pago credential resolver', () => {
  for (const route of [pixRoute, cardRoute, statusRoute, preferenceRoute, webhookRoute]) {
    assert.match(route, /resolveMercadoPagoCheckoutConfig/);
    assert.doesNotMatch(route, /let accessToken = process\.env\.MERCADOPAGO_ACCESS_TOKEN/);
  }
});

test('card checkout resolves public key from the event owner instead of global fallback', () => {
  assert.match(helper, /resolveMercadoPagoPublicConfig/);
  assert.match(configRoute, /resolveMercadoPagoPublicConfig/);
  assert.match(registerModal, /resolveCheckoutPublicKey\(event\.id, event\.mpPublicKey\)/);
  assert.doesNotMatch(registerModal, /NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY/);
  assert.doesNotMatch(registerModal, /APP_USR-0d64556d/);
});

test('checkout surfaces backend payment errors instead of generic alerts', () => {
  assert.match(registerModal, /getCheckoutErrorMessage/);
  assert.match(registerModal, /throw new Error\(await getCheckoutErrorMessage\(response, 'Erro ao criar cobrança Pix\.'\)\)/);
  assert.match(registerModal, /throw new Error\(await getCheckoutErrorMessage\(response, 'Erro ao processar pagamento com cartão\.'\)\)/);
  assert.match(registerModal, /alert\(err instanceof Error \? err\.message :/);
});

test('transparent checkout sends payer CPF and does not send application fee', () => {
  assert.doesNotMatch(pixRoute, /application_fee:/);
  assert.doesNotMatch(cardRoute, /application_fee:/);
  assert.match(cardRoute, /identification:[\s\S]*type: 'CPF'[\s\S]*number: cleanCpf/);
  assert.match(cardRoute, /metadata:[\s\S]*registration_id: checkoutSnapshot\.registrationId/);
  assert.match(pixRoute, /metadata:[\s\S]*registration_id: checkoutSnapshot\.registrationId/);
  assert.doesNotMatch(cardRoute, /payer_cpf: cleanCpf/);
  assert.doesNotMatch(pixRoute, /payer_cpf: cleanCpf/);
  assert.match(registerModal, /installments: 1,\s*cpf/);
  assert.match(registerModal, /paymentMethodsResponse\?\.results/);
});

test('Pix approval can render voucher without relying only on sessionStorage', () => {
  assert.match(statusRoute, /loadRegistrationCheckoutSnapshot/);
  assert.match(statusRoute, /canReadRegistrationSnapshot/);
  assert.match(statusRoute, /getRequestSession\(request\)/);
  assert.match(statusRoute, /registrationData: registrationPayload\?\.registrationData \|\| null/);
  assert.match(statusRoute, /athleteProfile: registrationPayload\?\.athleteProfile \|\| null/);
  assert.match(registerModal, /let registrationPayload = data\.registrationData \|\| null/);
  assert.match(registerModal, /let athletePayload = data\.athleteProfile \|\| null/);
  assert.match(registerModal, /createdReg = registerTicket\(registrationPayload, athletePayload\)/);
});

test('checkout payment routes apply rate limits by registration and method', () => {
  assert.match(cardRoute, /checkRateLimit/);
  assert.match(cardRoute, /checkout:\$\{getClientIp\(request\)\}:\$\{registrationData\.id\}:card/);
  assert.match(pixRoute, /checkRateLimit/);
  assert.match(pixRoute, /checkout:\$\{getClientIp\(request\)\}:\$\{registrationData\.id\}:pix/);
});

test('local registration preserves checkout identifiers for webhook and voucher consistency', () => {
  assert.match(appContext, /const regId = registrationData\.id \|\| `reg-\$\{Date\.now\(\)\}`/);
  assert.match(appContext, /createdAt: registrationData\.createdAt \|\| new Date\(\)\.toISOString\(\)/);
  assert.match(appContext, /const newAthleteId = athleteProfile\?\.id \|\| `ath-\$\{Date\.now\(\)\}`/);
});

test('approved Mercado Pago redirect does not overwrite registration as pending', () => {
  assert.match(eventPage, /approvedRegistrationData/);
  assert.match(eventPage, /paymentStatus: 'payment_approved' as const/);
  assert.match(eventPage, /const createdReg = registerTicket\(approvedRegistrationData, athleteProfile\)/);
});

test('Mercado Pago OAuth callback persists secrets with Supabase service role', () => {
  assert.match(oauthCallback, /requireSession\(request, \['manager', 'owner'\]\)/);
  assert.match(oauthCallback, /canActOnUser\(auth\.user, userId\)/);
  assert.match(oauthCallback, /createSupabaseAdmin\(\)/);
  assert.match(oauthCallback, /from\('mercadopago_secrets'\)/);
});

test('manual Mercado Pago credentials are validated and store the real collector id', () => {
  assert.match(adminMercadoPagoRoute, /https:\/\/api\.mercadopago\.com\/users\/me/);
  assert.match(adminMercadoPagoRoute, /Access Token Mercado Pago inválido/);
  assert.match(adminMercadoPagoRoute, /const mercadopagoUserId = mpUserData\?\.id \? String\(mpUserData\.id\)/);
  assert.match(adminMercadoPagoRoute, /mercadopago_user_id: mercadopagoUserId/);
});

test('manual Mercado Pago credentials do not require a globally unique collector id', () => {
  assert.match(relaxMercadoPagoUserMigration, /DROP CONSTRAINT IF EXISTS mercadopago_accounts_mercadopago_user_id_key/);
  assert.match(relaxMercadoPagoUserMigration, /idx_mercadopago_accounts_mercadopago_user_id/);
  assert.match(adminMercadoPagoRoute, /isMercadoPagoUserIdUniqueError/);
  assert.match(adminMercadoPagoRoute, /Aplique a migration mais recente do Supabase/);
});
