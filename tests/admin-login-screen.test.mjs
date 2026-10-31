import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { importServerModule } from './support/serverModuleHarness.mjs';

// Story 1.92: nova tela de login, proposta C de docs/design/login-novo/
// (um login só, a área vem da conta; as três áreas ao lado só informam).

const { AdminLoginScreen } = await importServerModule('components/admin/AdminLoginScreen.tsx');
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const screenSource = read('../src/components/admin/AdminLoginScreen.tsx');
const fontSource = read('../src/components/admin/loginFont.ts');
const adminPage = read('../src/app/admin/page.tsx');

const noop = () => {};
const baseProps = (overrides = {}) => ({
  mode: 'login',
  notice: null,
  login: {
    email: '', password: '', remember: false, submitting: false,
    onEmailChange: noop, onPasswordChange: noop, onRememberChange: noop, onSubmit: noop, onForgotPassword: noop
  },
  forgot: { email: '', submitting: false, onEmailChange: noop, onSubmit: noop, onBack: noop },
  reset: { password: '', confirm: '', submitting: false, onPasswordChange: noop, onConfirmChange: noop, onSubmit: noop },
  ...overrides
});
const render = (overrides) => renderToStaticMarkup(createElement(AdminLoginScreen, baseProps(overrides)));

test('login: um formulário só, com e-mail, lembrar e-mail, senha e recuperação', () => {
  const html = render();

  assert.match(html, /<h1[^>]*>Bem-vindo<\/h1>/);
  assert.match(html, /A WODArena abre a área certa para a sua conta/);
  assert.match(html, /id="admin-email"[^>]*type="email"|type="email"[^>]*id="admin-email"/);
  assert.match(html, /id="admin-password"/);
  assert.match(html, /autoComplete="current-password"|autocomplete="current-password"/i);
  assert.match(html, /Lembrar meu e-mail/);
  assert.doesNotMatch(html, /Manter conectado/);
  assert.match(html, /Esqueci minha senha/);
  assert.match(html, /<span>Entrar<\/span>/);
  assert.equal((html.match(/<form/g) || []).length, 1);
});

test('login: a criação de conta explica a regra real e leva aos eventos', () => {
  const html = render();

  assert.match(html, /Ainda não tem conta\? Ela é criada na sua primeira inscrição\./);
  assert.match(html, /<a[^>]*href="\/#eventos"[^>]*>Ver eventos<\/a>/);
  assert.doesNotMatch(html, /Criar conta gratuita/);
});

test('as três áreas aparecem ao lado só como informação, sem link nem botão', () => {
  const html = render();
  const aside = html.slice(html.indexOf('<aside'), html.indexOf('</aside>'));

  assert.match(aside, /Depois de entrar, você vai para/);
  for (const name of ['Área administrativa', 'Área do judge', 'Área do atleta']) {
    assert.ok(aside.includes(name), `falta ${name}`);
  }
  assert.match(aside, /Se você organiza eventos/);
  assert.match(aside, /Se você arbitra um evento/);
  assert.match(aside, /Se você compete/);
  assert.doesNotMatch(aside, /<a[\s>]|<button[\s>]|onClick/);
});

test('recuperar senha usa o mesmo painel, com o mesmo bloco de áreas', () => {
  const html = render({ mode: 'forgot' });

  assert.match(html, /<h1[^>]*>Recuperar senha<\/h1>/);
  assert.match(html, /id="forgot-password-email"/);
  assert.match(html, /Enviar link de recuperação/);
  assert.match(html, /Voltar para o login/);
  assert.doesNotMatch(html, /id="admin-password"/);
  assert.match(html, /Depois de entrar, você vai para/);
});

test('redefinir senha pede duas senhas com no mínimo 6 caracteres', () => {
  const html = render({ mode: 'reset' });

  assert.match(html, /<h1[^>]*>Nova senha<\/h1>/);
  assert.match(html, /id="reset-password-new"/);
  assert.match(html, /id="reset-password-confirm"/);
  assert.equal((html.match(/minLength="6"|minlength="6"/gi) || []).length, 2);
  assert.match(html, /Redefinir senha/);
  assert.match(html, /new-password/);
});

test('o tom do aviso define o papel: erro é alert, sucesso é status', () => {
  const error = render({ notice: { text: 'E-mail ou senha inválidos.', tone: 'error' } });
  const success = render({ mode: 'forgot', notice: { text: 'Enviamos o link.', tone: 'success' } });

  assert.match(error, /role="alert"[^>]*>E-mail ou senha inválidos\./);
  assert.match(error, /text-trading-down/);
  assert.match(success, /role="status"[^>]*>Enviamos o link\./);
  assert.match(success, /text-trading-up/);
  assert.doesNotMatch(render(), /role="alert"|role="status"/);
});

test('durante o envio o botão avisa, bloqueia e marca ocupado', () => {
  const html = render({ login: { ...baseProps().login, submitting: true } });

  assert.match(html, /Entrando…/);
  assert.match(html, /disabled=""/);
  assert.match(html, /aria-busy="true"/);
});

test('o campo de senha tem botão de mostrar com nome acessível', () => {
  const html = render();

  assert.match(html, /aria-label="Mostrar senha"/);
  assert.match(html, /aria-pressed="false"/);
});

test('o componente segue as regras de estilo do app', () => {
  assert.doesNotMatch(screenSource, /\bshadow(?:-[a-z]+)?\b/, 'sem sombra');
  assert.doesNotMatch(screenSource, /gradient/, 'sem gradiente');
  assert.doesNotMatch(screenSource, /#[0-9a-f]{3,8}\b/i, 'sem cor literal');
  assert.doesNotMatch(screenSource, /\bborder-[lr]-(?:[2-9]|\[)/, 'sem faixa colorida de borda');
  assert.doesNotMatch(screenSource, /next\/font/, 'a fonte fica em loginFont.ts');
  assert.doesNotMatch(screenSource, /BrandLogo/, 'a Navbar já mostra a marca');
  assert.match(screenSource, /bg-primary/);
});

test('a fonte de display é só desta tela e o nome da variável bate com o componente', () => {
  assert.match(fontSource, /Anton/);
  assert.match(fontSource, /variable: '--font-login-display'/);
  assert.match(screenSource, /var\(--font-login-display\)/);
  assert.doesNotMatch(read('../src/app/layout.tsx'), /Anton|login-display/);
});

test('o painel usa a tela nova com o mesmo login e as mesmas rotas de senha', () => {
  assert.match(adminPage, /import \{ AdminLoginScreen \} from '@\/components\/admin\/AdminLoginScreen'/);
  assert.match(adminPage, /import \{ loginDisplayFont \} from '@\/components\/admin\/loginFont'/);
  assert.match(adminPage, /<AdminLoginScreen/);
  assert.match(adminPage, /loginDisplayFont\.variable/);
  assert.match(adminPage, /await login\(email, password\)/);
  assert.match(adminPage, /onSubmit: handleLogin/);
  assert.match(adminPage, /onSubmit: handleRequestPasswordReset/);
  assert.match(adminPage, /onSubmit: handleResetPasswordSubmit/);
  assert.match(adminPage, /\/api\/auth\/request-password-reset/);
  assert.match(adminPage, /\/api\/auth\/reset-password/);
  assert.match(adminPage, /window\.location\.replace\('\/judge'\)/);
});

test('o painel não guarda mais a tela antiga', () => {
  assert.doesNotMatch(adminPage, /selectedLoginProfile|profileOptions|loginBenefits|darkLoginInputClassName/);
  assert.doesNotMatch(adminPage, /CONECTE\.|Entrar na Arena|Criar conta gratuita/);
});

test('só os dois avisos de sucesso aparecem como sucesso, e o envio do login não duplica', () => {
  assert.match(adminPage, /const FORGOT_PASSWORD_SENT_NOTICE = /);
  assert.match(adminPage, /const RESET_PASSWORD_DONE_NOTICE = /);
  assert.match(adminPage, /setForgotPasswordNotice\(FORGOT_PASSWORD_SENT_NOTICE\)/);
  assert.match(adminPage, /setResetPasswordNotice\(RESET_PASSWORD_DONE_NOTICE\)/);
  assert.match(adminPage, /if \(loginSubmitting\) return;/);
});

test('o token do link de senha e o e-mail lembrado são lidos depois de hidratar, sem window no useState', () => {
  assert.match(adminPage, /useSyncExternalStore\(\s*subscribeToLoginPreferences,\s*getResetTokenSnapshot,\s*getResetTokenServerSnapshot/);
  assert.match(adminPage, /useSyncExternalStore\(\s*subscribeToLoginPreferences,\s*getRememberedEmailSnapshot,\s*getRememberedEmailServerSnapshot/);
  assert.match(adminPage, /const authMode = authModeChoice \?\? \(urlResetToken \? 'reset' : 'login'\)/);
  assert.match(adminPage, /saveBrowserRememberedEmail\(email, rememberLogin\)/);
  assert.doesNotMatch(adminPage, /initialPasswordResetToken/);
  assert.doesNotMatch(adminPage, /localStorage\.setItem\('wodarena_login_email'/);
});
