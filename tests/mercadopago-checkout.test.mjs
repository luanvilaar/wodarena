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
const registerModal = read('../src/components/RegisterModal.tsx');
const appContext = read('../src/context/AppContext.tsx');

test('Mercado Pago checkout resolves credentials from organizer secrets', () => {
  assert.match(helper, /from\('events'\)[\s\S]*select\('organizer_id, marketplace_fee, mp_access_token'\)/);
  assert.match(helper, /from\('mercadopago_secrets'\)[\s\S]*eq\('user_id', dbEvent\.organizer_id\)/);
  assert.match(helper, /source: 'organizer_secret'/);
  assert.match(helper, /source: 'event_legacy'/);
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

test('transparent checkout sends marketplace application fee and payer CPF', () => {
  assert.match(pixRoute, /application_fee: getMercadoPagoApplicationFee/);
  assert.match(cardRoute, /application_fee: getMercadoPagoApplicationFee/);
  assert.match(cardRoute, /identification:[\s\S]*type: 'CPF'[\s\S]*number: cleanCpf/);
  assert.match(cardRoute, /payer_cpf: cleanCpf/);
  assert.match(pixRoute, /payer_cpf: cleanCpf/);
  assert.match(registerModal, /installments: 1,\s*cpf/);
  assert.match(registerModal, /paymentMethodsResponse\?\.results/);
});

test('Pix approval can render voucher without relying only on sessionStorage', () => {
  assert.match(statusRoute, /registrationData: registrationPayload\?\.registrationData \|\| null/);
  assert.match(statusRoute, /athleteProfile: registrationPayload\?\.athleteProfile \|\| null/);
  assert.match(registerModal, /let registrationPayload = data\.registrationData \|\| null/);
  assert.match(registerModal, /let athletePayload = data\.athleteProfile \|\| null/);
  assert.match(registerModal, /createdReg = registerTicket\(registrationPayload, athletePayload\)/);
});

test('local registration preserves checkout identifiers for webhook and voucher consistency', () => {
  assert.match(appContext, /const regId = registrationData\.id \|\| `reg-\$\{Date\.now\(\)\}`/);
  assert.match(appContext, /createdAt: registrationData\.createdAt \|\| new Date\(\)\.toISOString\(\)/);
  assert.match(appContext, /const newAthleteId = athleteProfile\?\.id \|\| `ath-\$\{Date\.now\(\)\}`/);
});

test('Mercado Pago OAuth callback persists secrets with Supabase service role', () => {
  assert.match(oauthCallback, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(oauthCallback, /createClient\(supabaseUrl, supabaseServiceKey/);
  assert.match(oauthCallback, /from\('mercadopago_secrets'\)/);
});
