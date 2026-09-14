import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const paymentGatewaySource = read('../src/lib/paymentGateway.ts');
const taxIdSource = read('../src/lib/taxId.ts');
const pixRoute = read('../src/app/api/checkout/pix/route.ts');
const cardRoute = read('../src/app/api/checkout/card/route.ts');
const checkoutGateway = read('../src/lib/checkoutGateway.ts');

const loadTsModule = async (source) => {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const tempUrl = new URL(`./.checkout-gateway-under-test.${Date.now()}.${Math.random().toString(36).slice(2)}.mjs`, import.meta.url);
  const { writeFileSync, unlinkSync } = await import('node:fs');
  writeFileSync(tempUrl, compiled, 'utf8');
  try {
    return await import(tempUrl.href);
  } finally {
    unlinkSync(tempUrl);
  }
};

test('resolveGateway maps BRL to mercadopago and EUR/GBP to stripe', async () => {
  const mod = await loadTsModule(paymentGatewaySource);
  assert.equal(mod.resolveGatewayForCurrency('BRL'), 'mercadopago');
  assert.equal(mod.resolveGatewayForCurrency('EUR'), 'stripe');
  assert.equal(mod.resolveGatewayForCurrency('GBP'), 'stripe');
  assert.equal(mod.resolveGateway({ currency: 'BRL' }), 'mercadopago');
  assert.equal(mod.resolveGateway({ currency: 'EUR' }), 'stripe');
  // events.payment_gateway é um escape hatch: quando presente, tem prioridade sobre a moeda.
  assert.equal(mod.resolveGateway({ currency: 'BRL', paymentGateway: 'stripe' }), 'stripe');
});

test('isPixSupported is true only for BRL', async () => {
  const mod = await loadTsModule(paymentGatewaySource);
  assert.equal(mod.isPixSupported('BRL'), true);
  assert.equal(mod.isPixSupported('EUR'), false);
  assert.equal(mod.isPixSupported('GBP'), false);
});

test('tax id requirement matrix: CPF required in BR, NIF optional in PT, none in GB', async () => {
  const mod = await loadTsModule(taxIdSource);
  assert.deepEqual(mod.getTaxIdRequirement('BR'), { field: 'cpf', required: true });
  assert.deepEqual(mod.getTaxIdRequirement('PT'), { field: 'nif', required: false });
  assert.deepEqual(mod.getTaxIdRequirement('GB'), { field: null, required: false });
});

test('nif checksum validates real Portuguese tax ids and rejects malformed ones', async () => {
  const mod = await loadTsModule(taxIdSource);
  assert.equal(mod.isValidNIF('123456789'), true);
  assert.equal(mod.isValidNIF('123456780'), false);
  assert.equal(mod.isValidNIF('12345'), false);
});

test('pix route rejects non-BRL events with a typed gateway_method_unavailable error', () => {
  assert.match(pixRoute, /resolveEventPaymentContext/);
  assert.match(pixRoute, /if \(!isPixSupported\(paymentContext\.currency\)\)/);
  assert.match(pixRoute, /code: 'gateway_method_unavailable'/);
  assert.match(pixRoute, /status: 409/);
});

test('card route (Mercado Pago-only token protocol) rejects non-mercadopago events explicitly', () => {
  assert.match(cardRoute, /paymentContext\.gateway !== 'mercadopago'/);
  assert.match(cardRoute, /code: 'gateway_method_unavailable'/);
});

test('resolveEventPaymentContext is the single source of truth used by every checkout route', () => {
  assert.match(checkoutGateway, /export const resolveEventPaymentContext/);
  assert.match(checkoutGateway, /resolveGateway\(\{ currency, paymentGateway: event\.payment_gateway \|\| undefined \}\)/);
  assert.match(checkoutGateway, /getTaxIdRequirement\(countryCode\)/);
  for (const route of [pixRoute, cardRoute]) {
    assert.match(route, /from '@\/lib\/checkoutGateway'/);
  }
});
