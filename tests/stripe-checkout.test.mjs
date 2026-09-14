import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const migration = read('../supabase/migrations/20260913120000_i18n_multi_currency_checkout.sql');
const stripeServer = read('../src/lib/stripeServer.ts');
const webhookRoute = read('../src/app/api/webhooks/stripe/route.ts');
const configRoute = read('../src/app/api/checkout/config/route.ts');
const preferenceRoute = read('../src/app/api/checkout/preference/route.ts');
const adminStripeRoute = read('../src/app/api/admin/stripe/route.ts');
const stripeReturnRoute = read('../src/app/api/stripe/return/route.ts');
const nextConfig = read('../next.config.ts');
const envExample = read('../.env.example');
const packageJson = read('../package.json');

test('stripe_accounts table is aditive, RLS-enabled and has no public read policy', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS stripe_accounts/);
  assert.match(migration, /stripe_account_id TEXT NOT NULL UNIQUE/);
  assert.match(migration, /country TEXT NOT NULL CHECK \(country IN \('PT', 'GB'\)\)/);
  assert.match(migration, /ALTER TABLE stripe_accounts ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /CREATE POLICY "Deny anon stripe_accounts"\s*\nON stripe_accounts FOR SELECT\s*\nUSING \(false\)/);
  assert.doesNotMatch(migration, /ON stripe_accounts FOR SELECT\s*\nUSING \(true\)/);
});

test('stripe SDK is installed and the secret key never carries the NEXT_PUBLIC_ prefix', () => {
  assert.match(packageJson, /"stripe":\s*"\^?\d/);
  assert.match(stripeServer, /process\.env\.STRIPE_SECRET_KEY/);
  assert.doesNotMatch(stripeServer, /NEXT_PUBLIC_STRIPE_SECRET_KEY/);
  assert.match(stripeServer, /process\.env\.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY/);
  assert.match(envExample, /STRIPE_SECRET_KEY=/);
  assert.match(envExample, /NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=/);
  assert.match(envExample, /STRIPE_WEBHOOK_SECRET=/);
});

test('stripe checkout config resolves per-event currency and connected account, never a per-manager secret table', () => {
  assert.match(stripeServer, /export const resolveStripeCheckoutConfig/);
  assert.match(stripeServer, /export const resolveStripePublicConfig/);
  assert.match(stripeServer, /from\('stripe_accounts'\)/);
  assert.doesNotMatch(stripeServer, /stripe_secrets/);
  assert.doesNotMatch(stripeServer, /refresh_token/);
  assert.match(stripeServer, /currency === 'BRL'/);
});

test('stripe webhook validates signature via webhooks.constructEvent and requires STRIPE_WEBHOOK_SECRET', () => {
  assert.match(webhookRoute, /request\.headers\.get\('stripe-signature'\)/);
  assert.match(webhookRoute, /getStripeClient\(\)\.webhooks\.constructEvent\(rawBody, signature, webhookSecret\)/);
  assert.match(webhookRoute, /if \(!webhookSecret\)/);
  assert.match(webhookRoute, /status: 401/);
  assert.match(webhookRoute, /payment_intent\.succeeded/);
  assert.match(webhookRoute, /checkout\.session\.completed/);
  assert.match(webhookRoute, /applyCouponUsageForApprovedRegistration/);
  assert.match(webhookRoute, /triggerRegistrationApprovedEmail/);
});

test('stripe checkout session carries application_fee_amount on the connected account', () => {
  assert.match(preferenceRoute, /transfer_data: \{ destination: checkoutConfig\.stripeAccountId \}/);
  assert.match(preferenceRoute, /application_fee_amount: serviceFeeMinorUnits/);
  assert.match(preferenceRoute, /idempotencyKey: buildStripeIdempotencyKey/);
});

test('checkout config route dispatches gateway by event currency', () => {
  assert.match(configRoute, /resolveEventPaymentContext/);
  assert.match(configRoute, /paymentContext\.gateway === 'stripe'/);
  assert.match(configRoute, /gateway: 'stripe'/);
  assert.match(configRoute, /gateway: 'mercadopago'/);
});

test('stripe connect onboarding is manager-authenticated and one account per country', () => {
  assert.match(adminStripeRoute, /requireSession\(request, \['manager', 'owner'\]\)/);
  assert.match(adminStripeRoute, /assertManagerOperationalAccess/);
  assert.match(adminStripeRoute, /stripe\.accounts\.create/);
  assert.match(adminStripeRoute, /type: 'express'/);
  assert.match(adminStripeRoute, /stripe\.accountLinks\.create/);
  assert.match(adminStripeRoute, /existing\.country !== country/);
  assert.match(stripeReturnRoute, /accounts\.retrieve/);
  assert.match(stripeReturnRoute, /charges_enabled: Boolean\(account\.charges_enabled\)/);
});

test('CSP allowlist covers the Stripe domains needed for Checkout/Elements/Connect', () => {
  assert.match(nextConfig, /https:\/\/js\.stripe\.com/);
  assert.match(nextConfig, /https:\/\/api\.stripe\.com/);
  assert.match(nextConfig, /https:\/\/hooks\.stripe\.com/);
  assert.match(nextConfig, /https:\/\/checkout\.stripe\.com/);
});
