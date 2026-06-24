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
const adminPage = read('../src/app/admin/page.tsx');
const relaxMercadoPagoUserMigration = read('../supabase/migrations/20260607230131_relax_mercadopago_user_unique.sql');
const oauthStatesMigration = read('../supabase/migrations/20260624140000_create_mercadopago_oauth_states.sql');
const registerModal = read('../src/components/RegisterModal.tsx');
const appContext = read('../src/context/AppContext.tsx');
const eventPage = read('../src/app/event/[id]/page.tsx');

test('Mercado Pago checkout resolves credentials from organizer secrets', () => {
  assert.match(helper, /from\('events'\)[\s\S]*select\('organizer_id'\)/);
  assert.match(helper, /mercadopago_secrets/);
  assert.match(helper, /source: 'organizer_secret'/);
  assert.doesNotMatch(helper, /mp_access_token/);
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
  assert.match(registerModal, /paymentAttemptStarted \? `\$\{baseMessage\}\\n\\n\$\{paymentFailureGuidance\}` : baseMessage/);
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
  assert.match(statusRoute, /assertRegistrationAccess/);
  assert.match(statusRoute, /getRequestSession\(request\)/);
  assert.match(statusRoute, /registrationData: registrationPayload\?\.registrationData \|\| null/);
  assert.match(statusRoute, /athleteProfile: registrationPayload\?\.athleteProfile \|\| null/);
  assert.match(registerModal, /let registrationPayload = data\.registrationData \|\| null/);
  assert.match(registerModal, /let athletePayload = data\.athleteProfile \|\| null/);
  assert.match(registerModal, /createdReg = registerTicket\(registrationPayload, athletePayload\)/);
});

test('status route prefers persisted payment_id before fallback reconciliation', () => {
  assert.match(statusRoute, /const persistedPaymentId = typeof registration\.payment_id === 'string'/);
  assert.match(statusRoute, /const shouldLookupPersistedPaymentDirectly = Boolean\(persistedPaymentId\) && registration\.payment_method !== 'mercadopago_preference'/);
  assert.match(statusRoute, /Tentando pagamento persistido/);
  assert.match(statusRoute, /fetchMercadoPagoPaymentById\(checkoutConfig\.accessToken, persistedPaymentId\)/);
});

test('status route preserves fallback search for mercadopago preference and legacy records', () => {
  assert.match(statusRoute, /registration\.payment_method !== 'mercadopago_preference'/);
  assert.match(statusRoute, /Consulta pagamentos recentes no Mercado Pago apenas para fluxos sem payment_id real ou legados/);
  assert.match(statusRoute, /p\.metadata\?\.registration_id === registrationIdParam/);
  assert.match(statusRoute, /const payerEmail = p\.payer\?\.email\?\.trim\(\)\.toLowerCase\(\)/);
});

test('checkout payment routes apply rate limits by registration and method', () => {
  assert.match(cardRoute, /checkRateLimit/);
  assert.match(cardRoute, /checkout:\$\{getClientIp\(request\)\}:\$\{registrationData\.id\}:card/);
  assert.match(pixRoute, /checkRateLimit/);
  assert.match(pixRoute, /checkout:\$\{getClientIp\(request\)\}:\$\{registrationData\.id\}:pix/);
});

test('public checkout propagates the signed registration access token through polling and follow-up endpoints', () => {
  assert.match(registerModal, /accessToken: activeRegistrationData\.accessToken/);
  assert.match(registerModal, /registration_id: pixData\.registrationId/);
  assert.match(registerModal, /statusParams\.set\('access_token', pixData\.accessToken\)/);
  assert.match(registerModal, /body: JSON\.stringify\(\{[\s\S]*accessToken: createdReg\.accessToken \|\| registrationPayload\?\.accessToken/);
  assert.match(pixRoute, /const \{ registrationData, cpf, accessToken \} = body/);
  assert.match(cardRoute, /const \{ registrationData, token, payment_method_id, installments, cpf, deviceId, accessToken \} = body/);
  assert.match(preferenceRoute, /const \{ registrationData, origin, accessToken \} = body/);
});

test('payment failures surface athlete-area recovery guidance', () => {
  assert.match(registerModal, /paymentFailureGuidance/);
  assert.match(registerModal, /Área do Atleta/);
  assert.match(registerModal, /recuperação de senha/);
  assert.match(registerModal, /paymentAttemptStarted/);
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

test('Mercado Pago OAuth uses single-use state and same-origin callback completion', () => {
  assert.match(adminMercadoPagoRoute, /randomUUID\(\)/);
  assert.match(adminMercadoPagoRoute, /from\('mercadopago_oauth_states'\)/);
  // Resolucao do redirect_uri centralizada no helper e compartilhada entre autorizacao e troca de token.
  assert.match(adminMercadoPagoRoute, /resolveMercadoPagoRedirectUri\(origin\)/);
  assert.match(oauthCallback, /resolveMercadoPagoRedirectUri\(origin\)/);
  assert.match(helper, /export const resolveMercadoPagoRedirectUri/);
  assert.match(helper, /process\.env\.MERCADOPAGO_REDIRECT_URI/);
  assert.match(helper, /`\$\{origin\}\/admin`/);
  // Blindagem: falha cedo quando aponta para localhost em producao.
  assert.match(helper, /isProduction && isLocalhost/);
  assert.match(oauthStatesMigration, /CREATE TABLE IF NOT EXISTS public\.mercadopago_oauth_states/);
  assert.match(oauthStatesMigration, /expires_at TIMESTAMPTZ NOT NULL DEFAULT \(NOW\(\) \+ INTERVAL '10 minutes'\)/);
  assert.match(oauthCallback, /export async function POST/);
  assert.match(oauthCallback, /from\('mercadopago_oauth_states'\)/);
  assert.match(oauthCallback, /delete\(\)\.eq\('state', state\)/);
  assert.match(adminPage, /const code = params\.get\('code'\)/);
  assert.match(adminPage, /window\.history\.replaceState\(\{\}, '', newUrl\)/);
  assert.match(adminPage, /fetch\('\/api\/mercadopago\/oauth\/callback', \{[\s\S]*method: 'POST'/);
});

test('Mercado Pago callbacks sanitize production URLs and fall back to secure API validation', () => {
  assert.match(preferenceRoute, /const sanitizedOrigin = isLocalhost \? origin : origin\.replace\(/);
  assert.match(preferenceRoute, /success: `\$\{sanitizedOrigin\}\/event\/\$\{checkoutSnapshot\.eventId\}\?payment=success`/);
  assert.match(preferenceRoute, /notification_url: `\$\{sanitizedOrigin\}\/api\/webhooks\/mercadopago\?event_id=\$\{checkoutSnapshot\.eventId\}`/);
  assert.match(webhookRoute, /Assinatura HMAC invalida/);
  assert.match(webhookRoute, /Continuando validacao por canal seguro/);
  assert.match(webhookRoute, /Assinatura Mercado Pago invalida e transacao nao pode ser confirmada\./);
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
