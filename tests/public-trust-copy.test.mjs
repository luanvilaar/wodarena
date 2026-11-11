import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { importServerModule } from './support/serverModuleHarness.mjs';

// Story 1.127: correções de confiança e texto nas telas públicas (Q1–Q6 do
// comparativo mobile, docs/design/mobile-competitivo/).

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const locales = ['pt-br', 'pt-pt', 'en-gb'];
const messages = Object.fromEntries(locales.map((l) => [l, JSON.parse(read(`../src/messages/${l}.json`))]));
const eventView = read('../src/app/[locale]/event/[id]/EventView.tsx');
const footer = read('../src/components/Footer.tsx');
const eventCard = read('../src/components/EventCard.tsx');
const navbar = read('../src/components/Navbar.tsx');
const globals = read('../src/app/globals.css');
const admin = read('../src/app/admin/page.tsx');

test('Q1: nenhuma tela pública fala em sandbox', () => {
  for (const locale of locales) {
    const text = JSON.stringify(messages[locale]);
    assert.doesNotMatch(text, /sandbox/i, `${locale} ainda tem "sandbox"`);
    const sidebar = messages[locale].Event.sidebar;
    assert.ok(sidebar.securePayment && sidebar.gatewayMercadoPago && sidebar.gatewayStripe, locale);
    assert.equal(sidebar.secureGateway, undefined);
    assert.ok(messages[locale].Footer.paymentMethods, locale);
  }
  assert.equal(messages['pt-br'].Event.sidebar.gatewayMercadoPago, 'Mercado Pago · Pix e cartão');
  assert.equal(messages['pt-br'].Footer.paymentMethods, 'Pagamentos via Mercado Pago e Stripe');
  assert.doesNotMatch(eventView, /tSidebar\('sandbox'\)/);
  assert.match(eventView, /resolveGateway\(event\) === 'stripe' \? tSidebar\('gatewayStripe'\) : tSidebar\('gatewayMercadoPago'\)/);
  assert.doesNotMatch(footer, /sandboxPayments/);
  assert.match(footer, /t\('paymentMethods'\)/);
});

test('Q2: a animação do título não recorta os acentos acima da caixa', () => {
  const keyframes = globals.match(/@keyframes home-broadcast-title \{[\s\S]*?\n\}/)[0];
  assert.doesNotMatch(keyframes, /clip-path: inset\(0 /, 'recorte começando no topo da caixa corta o til');
  assert.match(keyframes, /clip-path: inset\(-0\.3em 0 0 0\)/);
});

test('Q3: "Sem descrição cadastrada." não aparece em público nem é mais gravado', async () => {
  const { publicDescription, LEGACY_EMPTY_DESCRIPTION } = await importServerModule('lib/publicText.ts');
  assert.equal(publicDescription(LEGACY_EMPTY_DESCRIPTION), '');
  assert.equal(publicDescription('  Sem descrição cadastrada.  '), '');
  assert.equal(publicDescription(undefined), '');
  assert.equal(publicDescription(' Prova em trios '), 'Prova em trios');
  // Story 1.130: o card deixou de mostrar a descrição.
  assert.doesNotMatch(eventCard, /event\.description/);
  assert.match(eventView, /publicDescription\(event\.description\)/);
  assert.doesNotMatch(admin, /\|\| 'Sem descrição cadastrada\.'/);
});

test('Q4: a senha do atleta não cita /admin', () => {
  for (const locale of locales) {
    const register = JSON.stringify(messages[locale]);
    assert.doesNotMatch(register, /2ª via em \/admin|duplicate proof at \/admin/, locale);
  }
  const pt = JSON.stringify(messages['pt-br']);
  assert.match(pt, /"athleteAccessDescription":"Crie uma senha para ver suas inscrições e o comprovante\."/);
  assert.match(pt, /"panelPasswordLabel":"Senha da sua conta \*"/);
});

test('Q6: o topo mostra um logotipo só', () => {
  assert.doesNotMatch(navbar, /<BrandLogo/);
  assert.equal((navbar.match(/Ativo_1\.svg/g) || []).length, 1);
});
