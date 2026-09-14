import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const routing = read('../src/i18n/routing.ts');
const proxy = read('../src/proxy.ts');
const requestConfig = read('../src/i18n/request.ts');
const rootLayout = read('../src/app/layout.tsx');
const localeLayout = read('../src/app/[locale]/layout.tsx');
const nextConfig = read('../next.config.ts');

test('routing declares pt-br as default locale', () => {
  assert.match(routing, /defaultLocale:\s*DEFAULT_LOCALE/);
  assert.match(routing, /localePrefix:\s*'always'/);
});

test('proxy (middleware) matcher never lets /api, /admin, /owner or /judge receive a locale prefix', () => {
  // Este é o invariante mais crítico de toda a fundação de i18n: se /api
  // vazar para o matcher, o webhook do Mercado Pago (/api/webhooks/mercadopago)
  // passa a ser redirecionado com prefixo de locale e pagamentos param de confirmar.
  const matcherBlockMatch = proxy.match(/matcher:\s*\[([\s\S]*?)\]/);
  assert.ok(matcherBlockMatch, 'proxy.ts deve exportar um config.matcher');
  const matcherBlock = matcherBlockMatch[1];

  assert.match(matcherBlock, /\(\?!api\|admin\|owner\|judge\|_next\|_vercel/);

  const excludedPaths = ['/api/webhooks/mercadopago', '/admin', '/owner', '/judge'];
  for (const path of excludedPaths) {
    const negativeLookahead = /\(\?!(api\|admin\|owner\|judge\|_next\|_vercel\|\.\*\\\\\.\.\*)\)/;
    const match = matcherBlock.match(negativeLookahead);
    assert.ok(match, `matcher deve conter negative lookahead cobrindo ${path}`);
  }
});

test('next-intl plugin is wired into next.config.ts pointing at src/i18n/request.ts', () => {
  assert.match(nextConfig, /createNextIntlPlugin\(["']\.\/src\/i18n\/request\.ts["']\)/);
  assert.match(nextConfig, /export default withNextIntl\(nextConfig\)/);
});

test('request config falls back to the default locale for unsupported locales', () => {
  assert.match(requestConfig, /hasLocale\(routing\.locales, requested\)/);
  assert.match(requestConfig, /routing\.defaultLocale/);
});

test('root layout resolves html lang dynamically and provides only narrow namespaces', () => {
  assert.match(rootLayout, /await getLocale\(\)/);
  assert.match(rootLayout, /<html lang=\{toBcp47\(locale\)\}/);
  assert.match(rootLayout, /<NextIntlClientProvider/);
  // Narrowing: o provider do root só deve carregar Common/Nav/Footer/Errors,
  // nunca os namespaces de página (Home/Event/Checkout/...) — senão toda rota
  // pública carrega o dicionário inteiro no bundle client.
  assert.match(rootLayout, /messages=\{\{\s*Common:\s*messages\.Common,\s*Nav:\s*messages\.Nav,\s*Footer:\s*messages\.Footer,\s*Errors:\s*messages\.Errors,\s*Voucher:\s*messages\.Voucher\s*\}\}/);
});

test('[locale] layout guards against unsupported locale segments', () => {
  assert.match(localeLayout, /hasLocale\(routing\.locales, locale\)/);
  assert.match(localeLayout, /notFound\(\)/);
  assert.match(localeLayout, /setRequestLocale\(locale\)/);
});
