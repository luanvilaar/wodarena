import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const hardeningMigration = read('../supabase/migrations/20260621153000_api_surface_hardening.sql');
const story = read('../docs/stories/1.16.story.md');
const mercadopagoHelper = read('../src/lib/mercadopagoServer.ts');
const appContext = read('../src/context/AppContext.tsx');
const bootstrapPrivateRoute = read('../src/app/api/app/bootstrap/route.ts');
const bootstrapPublicRoute = read('../src/app/api/app/bootstrap/public/route.ts');
const bootstrapPayloadHelper = read('../src/lib/bootstrapPayload.ts');
const localStorageHook = read('../src/hooks/useLocalStorage.ts');
const types = read('../src/types/index.ts');

test('hardening migration enables RLS on the sensitive tables flagged by the audit', () => {
  assert.match(hardeningMigration, /ALTER TABLE contestations ENABLE ROW LEVEL SECURITY/);
  assert.match(hardeningMigration, /ALTER TABLE commercial_leads ENABLE ROW LEVEL SECURITY/);
  assert.match(hardeningMigration, /ALTER TABLE leaderboard_entries ENABLE ROW LEVEL SECURITY/);
  assert.match(hardeningMigration, /ALTER TABLE mercadopago_accounts ENABLE ROW LEVEL SECURITY/);
});

test('hardening migration closes direct public REST and RPC surfaces', () => {
  assert.match(hardeningMigration, /DROP POLICY IF EXISTS "Allow public select on mercadopago_accounts"/);
  assert.match(hardeningMigration, /DROP POLICY IF EXISTS "Public read connected Mercado Pago public keys"/);
  assert.match(hardeningMigration, /DROP POLICY IF EXISTS "Public read published events"/);
  assert.match(hardeningMigration, /DROP POLICY IF EXISTS "Public read event divisions"/);
  assert.match(hardeningMigration, /DROP POLICY IF EXISTS "Public read event workouts"/);
  assert.match(hardeningMigration, /DROP POLICY IF EXISTS "Public read scores"/);
  assert.match(hardeningMigration, /DROP POLICY IF EXISTS "Public read leaderboard entries"/);
  assert.match(hardeningMigration, /REVOKE ALL ON FUNCTION apply_coupon_usage\(TEXT\) FROM PUBLIC/);
  assert.match(hardeningMigration, /REVOKE ALL ON FUNCTION apply_coupon_usage\(TEXT\) FROM anon/);
  assert.match(hardeningMigration, /REVOKE ALL ON FUNCTION apply_coupon_usage\(TEXT\) FROM authenticated/);
  assert.match(hardeningMigration, /GRANT EXECUTE ON FUNCTION apply_coupon_usage\(TEXT\) TO service_role/);
});

test('Mercado Pago legacy event access tokens are retired from code and schema', () => {
  assert.match(hardeningMigration, /ALTER TABLE events DROP COLUMN IF EXISTS mp_access_token/);
  assert.match(mercadopagoHelper, /resolveMercadoPagoCheckoutConfig/);
  assert.match(mercadopagoHelper, /from\('events'\)[\s\S]*select\('organizer_id'\)/);
  assert.doesNotMatch(mercadopagoHelper, /mp_access_token/);
  assert.doesNotMatch(appContext, /mpAccessToken/);
  assert.doesNotMatch(types, /mpAccessToken/);
});

test('story 1.16 tracks the audit remediation scope and quality gates', () => {
  assert.match(story, /# Story 1\.16 - Hardening de APIs Expostas e Checkout Publico/);
  assert.match(story, /AC3: Rotas publicas de checkout, status e envio de comprovante exigem sessao valida ou token assinado de acesso a inscricao/);
  assert.match(story, /Criar migration de hardening para RLS, policies publicas e RPC sensivel/);
  assert.match(story, /Rodar `npm run lint`/);
  assert.match(story, /Rodar `npm run typecheck`/);
  assert.match(story, /Rodar `npm test`/);
});

test('bootstrap is split between a public endpoint and an authenticated endpoint', () => {
  assert.match(bootstrapPrivateRoute, /requireSession\(request, \['owner', 'manager', 'athlete'\]\)/);
  assert.match(bootstrapPublicRoute, /buildPublicBootstrapPayload/);
  assert.match(bootstrapPayloadHelper, /from\('registrations'\)\s*\.select\('id', \{ count: 'exact', head: true \}\)/);
  assert.match(bootstrapPayloadHelper, /users: \[\]/);
  assert.match(bootstrapPayloadHelper, /contestations: \[\]/);
  assert.match(bootstrapPayloadHelper, /coupons: \[\]/);
});

test('AppContext uses the public bootstrap for anonymous navigation and the private one for authenticated areas', () => {
  assert.match(appContext, /const PRIVATE_BOOTSTRAP_ENDPOINT = '\/api\/app\/bootstrap'/);
  assert.match(appContext, /const PUBLIC_BOOTSTRAP_ENDPOINT = '\/api\/app\/bootstrap\/public'/);
  assert.match(appContext, /const initialEndpoint = preferPrivate \? PRIVATE_BOOTSTRAP_ENDPOINT : PUBLIC_BOOTSTRAP_ENDPOINT/);
  assert.match(appContext, /if \(preferPrivate && response\.status === 401\)/);
  assert.match(appContext, /response = await fetch\(PUBLIC_BOOTSTRAP_ENDPOINT\)/);
  assert.match(appContext, /const response = await fetch\(PRIVATE_BOOTSTRAP_ENDPOINT\)/);
});

test('local storage setter remains stable so bootstrap effects do not enter an infinite render loop', () => {
  assert.match(localStorageHook, /import \{ useState, useEffect, useCallback \} from 'react'/);
  assert.match(localStorageHook, /const setValue = useCallback\(\(value: T \| \(\(val: T\) => T\)\) => \{/);
  assert.match(localStorageHook, /setStoredValue\(\(currentValue\) => \{/);
  assert.match(localStorageHook, /\}, \[key\]\);/);
});
