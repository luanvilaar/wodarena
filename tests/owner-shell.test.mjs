import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { importServerModule } from './support/serverModuleHarness.mjs';

// Story 1.123 (decisões D1, D2 e D6 de docs/design/painel-proprietario/): cinco
// seções numa moldura própria, sem o menu e o rodapé do site, seção no endereço,
// um único <main> e a tela de login aprovada na variante do proprietário.

const { parseOwnerSection, buildOwnerSectionSearch, OWNER_SECTION_IDS } = await importServerModule('lib/ownerSections.ts');
const { isStandalonePanelPath } = await importServerModule('lib/panelChrome.ts');
const { AdminLoginScreen } = await importServerModule('components/admin/AdminLoginScreen.tsx');
const { OwnerShell } = await importServerModule('components/owner/OwnerShell.tsx');

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const ownerPage = read('../src/app/owner/page.tsx');
const navbar = read('../src/components/Navbar.tsx');
const footer = read('../src/components/Footer.tsx');

const noop = () => {};

test('the open section lives in the address and unknown values open the overview', () => {
  assert.deepEqual(OWNER_SECTION_IDS, ['visao-geral', 'gestores', 'eventos', 'comercial', 'configuracoes']);
  assert.equal(parseOwnerSection('gestores'), 'gestores');
  assert.equal(parseOwnerSection('leaderboards'), 'visao-geral');
  assert.equal(parseOwnerSection(null), 'visao-geral');

  assert.equal(buildOwnerSectionSearch('', 'gestores'), '?secao=gestores');
  assert.equal(buildOwnerSectionSearch('?secao=gestores&x=1', 'visao-geral'), '?x=1');
  assert.equal(buildOwnerSectionSearch('?secao=gestores', 'visao-geral'), '');
});

test('the owner route drops the public site menu and footer', () => {
  assert.equal(isStandalonePanelPath('/owner'), true);
  assert.equal(isStandalonePanelPath('/owner/qualquer'), true);
  assert.equal(isStandalonePanelPath('/ownership'), false);
  assert.equal(isStandalonePanelPath('/admin'), false);
  assert.equal(isStandalonePanelPath(null), false);

  for (const source of [navbar, footer]) {
    assert.match(source, /const pathname = usePathname\(\);/);
    assert.match(source, /if \(isStandalonePanelPath\(pathname\)\) return null;/);
  }
});

test('owner login reuses the approved screen without remember, recovery or signup', () => {
  const html = renderToStaticMarkup(createElement(AdminLoginScreen, {
    variant: 'owner',
    mode: 'login',
    notice: { text: 'Credenciais inválidas.', tone: 'error' },
    login: { email: '', password: '', submitting: false, onEmailChange: noop, onPasswordChange: noop, onSubmit: noop }
  }));

  assert.match(html, /<h1[^>]*>Painel do proprietário<\/h1>/);
  assert.match(html, /Acesso restrito à conta proprietária da WODArena\./);
  assert.match(html, /id="owner-email"/);
  assert.match(html, /id="owner-password"/);
  assert.match(html, /role="alert"[^>]*>Credenciais inválidas\.</);
  assert.match(html, /Neste painel/);
  assert.match(html, /Números da plataforma/);
  for (const absent of ['Lembrar meu e-mail', 'Esqueci minha senha', 'Ainda não tem conta', 'Root', 'Senha Mestra', 'Super Admin']) {
    assert.ok(!html.includes(absent), `não deveria aparecer: ${absent}`);
  }
  assert.doesNotMatch(html, /<main/, 'o <main> é o do layout');

  // A variante padrão (/admin) continua igual.
  const panel = renderToStaticMarkup(createElement(AdminLoginScreen, {
    mode: 'login',
    notice: null,
    login: {
      email: '', password: '', remember: false, submitting: false, onEmailChange: noop, onPasswordChange: noop,
      onRememberChange: noop, onSubmit: noop, onForgotPassword: noop
    },
    forgot: { email: '', submitting: false, onEmailChange: noop, onSubmit: noop, onBack: noop },
    reset: { password: '', confirm: '', submitting: false, onPasswordChange: noop, onConfirmChange: noop, onSubmit: noop }
  }));
  assert.match(panel, /<main/);
  assert.match(panel, /id="admin-email"/);
  assert.match(panel, /Lembrar meu e-mail/);
  assert.match(panel, /Depois de entrar, você vai para/);
});

test('owner shell lists five sections, marks the current one and shows counters', () => {
  const html = renderToStaticMarkup(createElement(OwnerShell, {
    active: 'gestores',
    onNavigate: noop,
    badges: { gestores: { count: 3, tone: 'warn', label: '3 gestores expirados ou vencendo' }, comercial: { count: 0, tone: 'neutral', label: '0 leads novos' } },
    userName: 'Dono',
    onLogout: noop
  }, createElement('p', null, 'conteúdo')));

  for (const label of ['Visão geral', 'Gestores', 'Eventos', 'Comercial', 'Configurações']) assert.match(html, new RegExp(`>${label}<`));
  assert.equal((html.match(/aria-current="page"/g) || []).length, 1);
  assert.match(html, /aria-current="page"[^>]*>.*?Gestores/s);
  assert.match(html, /aria-label="3 gestores expirados ou vencendo"[^>]*>3</);
  assert.doesNotMatch(html, /0 leads novos/, 'contador zerado não aparece');
  assert.match(html, /<h1[^>]*>Gestores<\/h1>/);
  assert.doesNotMatch(html, /<main/);
  assert.match(html, /conteúdo/);
});

test('owner page uses the shell, keeps the section in the URL and has no nested <main>', () => {
  assert.doesNotMatch(ownerPage, /<main/);
  assert.match(ownerPage, /<OwnerShell\n\s+active=\{activeSection\}/);
  assert.match(ownerPage, /window\.history\.pushState\(null, '', `\$\{window\.location\.pathname\}\$\{search\}\$\{window\.location\.hash\}`\)/);
  assert.match(ownerPage, /window\.addEventListener\('popstate', syncFromLocation\)/);
  assert.match(ownerPage, /variant="owner"/);
  assert.match(ownerPage, /login\(email, password, \{ ownerOnly: true \}\)/);
  // A taxa de serviço e a vitrine da home ficam em Configurações.
  const settings = ownerPage.slice(ownerPage.indexOf("activeSection === 'configuracoes' && ("));
  assert.match(settings.slice(0, 4000), />Taxa de serviço<\/p>/);
  assert.match(settings, /<OwnerHomeShowcase /);
  assert.match(read('../src/components/owner/OwnerHomeShowcase.tsx'), /owner-featured-home-event/);
});
