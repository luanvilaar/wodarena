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
const adminMercadoPagoRoute = read('../src/app/api/admin/mercadopago/route.ts');
const cardRoute = read('../src/app/api/checkout/card/route.ts');
const pixRoute = read('../src/app/api/checkout/pix/route.ts');
const preferenceRoute = read('../src/app/api/checkout/preference/route.ts');
const statusRoute = read('../src/app/api/checkout/status/route.ts');
const webhookRoute = read('../src/app/api/webhooks/mercadopago/route.ts');
const oauthCallback = read('../src/app/api/mercadopago/oauth/callback/route.ts');
const adminPage = read('../src/app/admin/page.tsx');
const mockData = read('../src/data/mockData.ts');
const supabaseClient = read('../src/lib/supabase.ts');
const rlsMigration = read('../supabase/migrations/20260608120000_reenable_rls_security_baseline.sql');
const schemaMigration = read('../supabase/migrations/20260602164100_supabase_schema.sql');

test('auth routes hash passwords and issue HttpOnly signed sessions', () => {
  assert.match(serverSecurity, /scryptSync/);
  assert.match(serverSecurity, /createHmac\('sha256'/);
  assert.match(serverSecurity, /HttpOnly/);
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
    assert.match(route, /loadRegistrationCheckoutSnapshot\(supabaseAdmin, registrationData\.id\)/);
    assert.match(route, /transactionAmount/);
    assert.match(route, /registration_id: checkoutSnapshot\.registrationId/);
    assert.match(route, /event_id: checkoutSnapshot\.eventId/);
    assert.doesNotMatch(route, /registration_json/);
    assert.doesNotMatch(route, /payer_cpf/);
  }
  assert.match(statusRoute, /metadata\?\.registration_id/);
  assert.match(statusRoute, /canReadRegistrationSnapshot/);
  assert.match(statusRoute, /getRequestSession\(request\)/);
  assert.doesNotMatch(statusRoute, /JSON\.parse\(p\.metadata\.registration_json\)/);
  assert.match(webhookRoute, /isValidMercadoPagoSignature/);
  assert.match(webhookRoute, /metadata\?\.registration_id/);
  assert.doesNotMatch(webhookRoute, /from\('registrations'\)\.upsert/);
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
  assert.match(bootstrapRoute, /const sanitizePublicAthlete/);
  assert.match(bootstrapRoute, /session\?\.role === 'owner'/);
  assert.match(bootstrapRoute, /\.eq\('id', session\.id\)/);
  assert.match(bootstrapRoute, /athletes: \(athletesResult\.data \|\| \[\]\)\.map\(sanitizePublicAthlete\)/);
  assert.doesNotMatch(bootstrapRoute.match(/const sanitizePublicAthlete[\s\S]*?\}\);/)?.[0] || '', /email|phone|shirt_size/);
});
