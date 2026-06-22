import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const serverSecurity = read('../src/lib/serverSecurity.ts');
const loginRoute = read('../src/app/api/auth/login/route.ts');
const createUserRoute = read('../src/app/api/admin/create-user/route.ts');
const changePasswordRoute = read('../src/app/api/auth/change-password/route.ts');
const resetPasswordRoute = read('../src/app/api/auth/reset-password/route.ts');
const registrationStartRoute = read('../src/app/api/registrations/start/route.ts');
const bootstrapRoute = read('../src/app/api/app/bootstrap/route.ts');
const bootstrapPublicRoute = read('../src/app/api/app/bootstrap/public/route.ts');
const bootstrapPayloadHelper = read('../src/lib/bootstrapPayload.ts');
const adminMercadoPagoRoute = read('../src/app/api/admin/mercadopago/route.ts');
const cardRoute = read('../src/app/api/checkout/card/route.ts');
const pixRoute = read('../src/app/api/checkout/pix/route.ts');
const preferenceRoute = read('../src/app/api/checkout/preference/route.ts');
const couponRoute = read('../src/app/api/checkout/coupon/route.ts');
const statusRoute = read('../src/app/api/checkout/status/route.ts');
const webhookRoute = read('../src/app/api/webhooks/mercadopago/route.ts');
const oauthCallback = read('../src/app/api/mercadopago/oauth/callback/route.ts');
const adminPage = read('../src/app/admin/page.tsx');
const ownerPage = read('../src/app/owner/page.tsx');
const mockData = read('../src/data/mockData.ts');
const supabaseClient = read('../src/lib/supabase.ts');
const rlsMigration = read('../supabase/migrations/20260608120000_reenable_rls_security_baseline.sql');
const schemaMigration = read('../supabase/migrations/20260602164100_supabase_schema.sql');

test('auth routes hash passwords and issue HttpOnly signed sessions', () => {
  assert.match(serverSecurity, /scryptSync/);
  assert.match(serverSecurity, /createHmac\('sha256'/);
  assert.match(serverSecurity, /HttpOnly/);
  assert.match(serverSecurity, /process\.env\.WODA_SESSION_SECRET\?\.trim\(\)/);
  assert.match(serverSecurity, /Variavel de ambiente obrigatoria ausente: WODA_SESSION_SECRET/);
  assert.doesNotMatch(serverSecurity.match(/const getSessionSecret[\s\S]*?\n};/)?.[0] || '', /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(serverSecurity, /createRegistrationAccessToken/);
  assert.match(serverSecurity, /verifyRegistrationAccessToken/);
  assert.match(loginRoute, /verifyPassword/);
  assert.match(loginRoute, /hashPassword\(String\(password\)\)/);
  assert.match(loginRoute, /getSessionCookieHeader\(token\)/);
  assert.match(createUserRoute, /requireSession\(request, \['owner'\]\)/);
  assert.match(createUserRoute, /password: hashPassword\(String\(password\)\)/);
  assert.match(changePasswordRoute, /requireSession\(request\)/);
  assert.match(changePasswordRoute, /verifyPassword\(String\(currentPassword\)/);
  assert.match(changePasswordRoute, /hashPassword\(String\(newPassword\)\)/);
  assert.match(resetPasswordRoute, /password: hashPassword\(password\)/);
  assert.match(registrationStartRoute, /password: hashPassword\(String\(password\)\)/);
  assert.match(registrationStartRoute, /verifyPassword\(String\(password\), existingSecret\.password\)/);
  assert.match(registrationStartRoute, /Este e-mail já possui painel do atleta/);
  assert.match(registrationStartRoute, /accessToken: registrationAccessToken/);
  assert.doesNotMatch(registrationStartRoute, /from\('users_secrets'\)\s*\.\s*upsert/);
  assert.match(mockData, /email: 'l\.vilaar@gmail\.com'/);
  assert.match(schemaMigration, /'l\.vilaar@gmail\.com'/);
});

test('Mercado Pago admin credentials are scoped to the authenticated session', () => {
  assert.match(adminMercadoPagoRoute, /requireSession\(request, \['manager', 'owner'\]\)/);
  assert.match(adminMercadoPagoRoute, /export async function GET\(request: Request\)/);
  assert.match(adminMercadoPagoRoute, /const userId = actor\.id/);
  assert.match(adminMercadoPagoRoute, /canActOnUser\(actor, userId\)/);
  assert.doesNotMatch(adminMercadoPagoRoute, /const \{ userId, publicKey, accessToken \} = body/);
  assert.match(adminPage, /fetch\('\/api\/admin\/mercadopago'\)/);
  assert.doesNotMatch(adminPage, /mercadopago_accounts/);
  assert.match(oauthCallback, /requireSession\(request, \['manager', 'owner'\]\)/);
  assert.match(oauthCallback, /canActOnUser\(auth\.user, userId\)/);
});

test('checkout uses persisted registration snapshots and opaque Mercado Pago metadata', () => {
  for (const route of [cardRoute, pixRoute, preferenceRoute]) {
    assert.match(route, /assertRegistrationAccess/);
    assert.match(route, /loadRegistrationCheckoutSnapshot\(supabaseAdmin, registrationData\.id\)/);
    assert.match(route, /transactionAmount/);
    assert.match(route, /registration_id: checkoutSnapshot\.registrationId/);
    assert.match(route, /event_id: checkoutSnapshot\.eventId/);
    assert.doesNotMatch(route, /registration_json/);
    assert.doesNotMatch(route, /payer_cpf/);
  }
  assert.match(statusRoute, /metadata\?\.registration_id/);
  assert.match(statusRoute, /assertRegistrationAccess/);
  assert.match(statusRoute, /getRequestSession\(request\)/);
  assert.match(statusRoute, /registration_id obrigatório para consultar o status sem sessão autenticada/);
  assert.doesNotMatch(statusRoute, /JSON\.parse\(p\.metadata\.registration_json\)/);
  assert.match(webhookRoute, /isValidMercadoPagoSignature/);
  assert.match(webhookRoute, /metadata\?\.registration_id/);
  assert.doesNotMatch(webhookRoute, /from\('registrations'\)\.upsert/);
  assert.match(couponRoute, /validateCheckoutCoupon/);
  assert.doesNotMatch(couponRoute, /select\('\*'\)/);
});

test('Supabase hardcoded fallbacks are removed and RLS baseline is present', () => {
  assert.doesNotMatch(supabaseClient, /momigbtnsswoldqnadmc/);
  assert.doesNotMatch(supabaseClient, /mock_key/);
  assert.match(supabaseClient, /NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY sao obrigatorias/);
  assert.match(rlsMigration, /ALTER TABLE registrations ENABLE ROW LEVEL SECURITY/);
  assert.match(rlsMigration, /ALTER TABLE athletes ENABLE ROW LEVEL SECURITY/);
  assert.match(rlsMigration, /ALTER TABLE users ENABLE ROW LEVEL SECURITY/);
  assert.match(rlsMigration, /Deny anon registrations/);
});

test('bootstrap API does not expose full athlete PII to anonymous clients', () => {
  assert.match(bootstrapRoute, /requireSession\(request, \['owner', 'manager', 'athlete'\]\)/);
  assert.match(bootstrapPublicRoute, /buildPublicBootstrapPayload/);
  assert.match(bootstrapPublicRoute, /createSupabaseAdmin/);
  assert.match(serverSecurity, /getRequestSession/);
  assert.match(bootstrapPayloadHelper, /export const sanitizePublicAthlete/);
  assert.match(bootstrapPayloadHelper, /export const sanitizeLeaderboardEntry/);
  assert.match(bootstrapRoute, /session\?\.role === 'owner'/);
  assert.match(bootstrapRoute, /\.eq\('id', session\.id\)/);
  assert.match(bootstrapPayloadHelper, /athletes: \(athletesResult\.data \|\| \[\]\)\.map\(sanitizePublicAthlete\)/);
  assert.doesNotMatch(
    bootstrapPayloadHelper.match(/export const sanitizePublicAthlete[\s\S]*?\}\);/)?.[0] || '',
    /birth_date|city|state|instagram|photo_url|team_members|email|phone|shirt_size/
  );
  assert.doesNotMatch(
    bootstrapPayloadHelper.match(/export const sanitizeLeaderboardEntry[\s\S]*?\}\);/)?.[0] || '',
    /birth_date|team_members|instagram/
  );
});

test('bootstrap API gives anonymous clients only an aggregate registration count', () => {
  assert.match(bootstrapPublicRoute, /buildPublicBootstrapPayload/);
  assert.match(bootstrapPayloadHelper, /registrations: \[\]/);
  assert.match(bootstrapPayloadHelper, /registrationsCount: registrationsCountResult\.count \|\| 0/);
  assert.match(bootstrapPayloadHelper, /currentUser: null/);
});

test('owner login card does not show demo credentials guidance', () => {
  assert.doesNotMatch(ownerPage, /Dica rápida de demonstração/);
  assert.doesNotMatch(ownerPage, /Use <strong className="text-primary font-bold">l\.vilaar@gmail\.com<\/strong>/);
});
