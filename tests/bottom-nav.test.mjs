import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { importServerModule } from './support/serverModuleHarness.mjs';

// Story 1.129: barra de navegação no rodapé do celular (P1 de
// docs/design/mobile-competitivo/).

const {
  stripLocalePrefix,
  shouldShowBottomNav,
  getActiveBottomTab,
  getLiveHref,
  getAccountDestination,
  REGISTRATIONS_HREF,
} = await importServerModule('lib/bottomNav.ts');

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const bottomNav = read('../src/components/BottomNav.tsx');
const navbar = read('../src/components/Navbar.tsx');
const layout = read('../src/app/layout.tsx');
const localeLayout = read('../src/app/[locale]/layout.tsx');
const home = read('../src/app/[locale]/HomeView.tsx');

test('tira o prefixo de idioma do caminho', () => {
  assert.equal(stripLocalePrefix('/pt-br'), '/');
  assert.equal(stripLocalePrefix('/en-gb/event/abc'), '/event/abc');
  assert.equal(stripLocalePrefix('/pt-pt/event/abc/leaderboard/'), '/event/abc/leaderboard');
  assert.equal(stripLocalePrefix('/admin'), '/admin');
});

test('a barra aparece só nas páginas públicas que não ocupam a tela toda', () => {
  for (const path of ['/pt-br', '/pt-br/event/abc', '/en-gb/event/abc/leaderboard', '/pt-br/termos']) {
    assert.equal(shouldShowBottomNav(path), true, path);
  }
  for (const path of ['/admin', '/owner', '/owner/x', '/judge', '/pt-br/telao/tok', '/pt-br/sumula-preview', '/pt-br/sumula-preview/editor', null]) {
    assert.equal(shouldShowBottomNav(path), false, String(path));
  }
});

test('destino ativo: Eventos na home e no evento, Ao vivo no ranking', () => {
  assert.equal(getActiveBottomTab('/pt-br'), 'events');
  assert.equal(getActiveBottomTab('/pt-br/event/abc'), 'events');
  assert.equal(getActiveBottomTab('/pt-br/event/abc/leaderboard'), 'live');
  assert.equal(getActiveBottomTab('/pt-br/termos'), null);
});

test('Ao vivo leva ao ranking quando há um só evento ao vivo', () => {
  assert.equal(getLiveHref(['evt-1']), '/event/evt-1/leaderboard');
  assert.equal(getLiveHref([]), '/?status=live#eventos');
  assert.equal(getLiveHref(['a', 'b']), '/?status=live#eventos');
});

test('o 4º destino segue a sessão', () => {
  assert.deepEqual(getAccountDestination(null), { label: 'tabSignIn', href: '/admin' });
  assert.deepEqual(getAccountDestination('athlete'), { label: 'tabAccount', href: '/admin#perfil' });
  assert.deepEqual(getAccountDestination('manager'), { label: 'tabPanel', href: '/admin' });
  assert.deepEqual(getAccountDestination('owner'), { label: 'tabPanel', href: '/owner' });
  assert.deepEqual(getAccountDestination('judge'), { label: 'tabPanel', href: '/judge' });
  assert.equal(REGISTRATIONS_HREF, '/admin#inscricoes');
});

test('a barra é fixa, some a partir de 768 px, soma a área segura e reserva o espaço', () => {
  assert.match(bottomNav, /fixed inset-x-0 bottom-0 z-40[^"]*pb-\[env\(safe-area-inset-bottom\)\] md:hidden/);
  assert.match(bottomNav, /aria-hidden="true" className="h-\[calc\(3\.5rem\+1px\+env\(safe-area-inset-bottom\)\)\] md:hidden"/);
  assert.match(bottomNav, /min-h-14/);
  assert.equal((bottomNav.match(/aria-current=\{active === '(events|live)' \? 'page' : undefined\}/g) ?? []).length, 2);
  assert.match(bottomNav, /event\.status === 'live' && getEventStatus\(event\) !== 'finished'/);
  assert.match(layout, /<Footer \/>\s*<BottomNav \/>/);
  assert.match(localeLayout, /viewportFit: 'cover'/);
});

test('no celular público o topo troca o menu pelo idioma; o painel mantém o menu', () => {
  assert.match(navbar, /const hasBottomNav = shouldShowBottomNav\(pathname\);/);
  assert.match(navbar, /\{hasBottomNav \? \(\s*<div className="flex min-h-11 items-center md:hidden">\s*<LocaleSwitcher variant="mobile" \/>/);
  assert.match(navbar, /\{isMenuOpen && !hasBottomNav && \(/);
});

test('a home aplica o filtro que chega por ?status=', () => {
  assert.match(home, /const statusParam = searchParams\.get\('status'\);/);
  // Story 1.133: "?status=" vira aba e chip (parseStatusParam).
  assert.match(home, /const parsed = parseStatusParam\(statusParam\);/);
  assert.match(home, /setFilters\(\(current\) => \(\{ \.\.\.current, live: parsed\.live \}\)\);/);
});

test('rótulos nos três idiomas', () => {
  for (const locale of ['pt-br', 'pt-pt', 'en-gb']) {
    const nav = JSON.parse(read(`../src/messages/${locale}.json`)).Nav;
    for (const key of ['bottomNavigation', 'tabEvents', 'tabLive', 'tabRegistrations', 'tabSignIn', 'tabAccount', 'tabPanel', 'liveCount']) {
      assert.ok(nav[key], `${locale}.Nav.${key}`);
    }
  }
});
