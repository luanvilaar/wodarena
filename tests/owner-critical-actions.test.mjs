import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createFakeSupabase } from './support/fakeSupabase.mjs';
import { importServerModule, setActiveSupabaseClient } from './support/serverModuleHarness.mjs';

// Story 1.121: desligar a taxa era um clique sem confirmação e a rota regravava o
// percentual como 10; uma validade no passado bloqueava o gestor na hora; o cadastro
// de gestor aceitava qualquer senha, não travava no duplo clique e escondia a
// mensagem real da API. Desenho em docs/design/painel-proprietario/.

process.env.SUPABASE_URL = 'http://supabase.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';
process.env.WODA_SESSION_SECRET = 'segredo-de-teste-story-1-121-acoes-criticas';

let database = createFakeSupabase();
setActiveSupabaseClient({
  from: (table) => database.client.from(table),
  rpc: (name, args) => database.client.rpc(name, args)
});

const { PUT: putServiceFee } = await importServerModule('app/api/owner/service-fee/route.ts');
const { POST: createUser } = await importServerModule('app/api/admin/create-user/route.ts');
const { createSessionToken } = await importServerModule('lib/serverSecurity.ts');
const { MANAGER_PASSWORD_MIN_LENGTH } = await importServerModule('lib/managerAccess.ts');

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const ownerPage = read('../src/app/owner/page.tsx');
const context = read('../src/context/AppContext.tsx');
const dialog = read('../src/components/owner/OwnerConfirmDialog.tsx');

const OWNER = { id: 'owner-1', name: 'Dono', email: 'dono@exemplo.com', role: 'owner' };
const ownerCookie = () => `woda_session=${createSessionToken(OWNER)}`;

const jsonRequest = (url, method, body) => new Request(url, {
  method,
  headers: { cookie: ownerCookie(), 'content-type': 'application/json' },
  body: JSON.stringify(body)
});

test('turning the service fee off keeps the stored percent', async () => {
  database = createFakeSupabase({
    platform_settings: [{ id: true, service_fee_enabled: true, service_fee_percent: 12, updated_at: '2026-11-01T00:00:00.000Z' }]
  });

  const response = await putServiceFee(jsonRequest('http://localhost/api/owner/service-fee', 'PUT', { enabled: false }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { enabled: false, percent: 12 });

  const [row] = database.rows('platform_settings');
  assert.equal(row.service_fee_enabled, false);
  assert.equal(row.service_fee_percent, 12, 'o percentual não é regravado como 10');
});

test('service fee toggle still rejects a non-boolean payload', async () => {
  database = createFakeSupabase({ platform_settings: [] });
  const response = await putServiceFee(jsonRequest('http://localhost/api/owner/service-fee', 'PUT', { enabled: 'no' }));
  assert.equal(response.status, 400);
  assert.equal(database.rows('platform_settings').length, 0);
});

test('manager signup requires a password with the minimum length', async () => {
  database = createFakeSupabase({ users: [OWNER], users_secrets: [] });
  const body = { name: 'Gestor Novo', email: 'novo@exemplo.com', organization: 'Box Exemplo' };

  const short = await createUser(jsonRequest('http://localhost/api/admin/create-user', 'POST', {
    ...body, password: 'x'.repeat(MANAGER_PASSWORD_MIN_LENGTH - 1)
  }));
  assert.equal(short.status, 400);
  assert.match((await short.json()).error, /pelo menos 8 caracteres/);
  assert.equal(database.rows('users').length, 1, 'nenhum gestor criado com senha curta');

  const ok = await createUser(jsonRequest('http://localhost/api/admin/create-user', 'POST', {
    ...body, password: 'x'.repeat(MANAGER_PASSWORD_MIN_LENGTH)
  }));
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).user.email, 'novo@exemplo.com');
  assert.equal(database.rows('users').length, 2);

  const duplicate = await createUser(jsonRequest('http://localhost/api/admin/create-user', 'POST', {
    ...body, password: 'y'.repeat(MANAGER_PASSWORD_MIN_LENGTH)
  }));
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).error, 'Este e-mail já está cadastrado.');
});

test('manager signup rejects blank fields with a readable message', async () => {
  database = createFakeSupabase({ users: [OWNER], users_secrets: [] });
  const response = await createUser(jsonRequest('http://localhost/api/admin/create-user', 'POST', {
    name: '   ', email: 'novo@exemplo.com', password: 'senha-forte', organization: 'Box'
  }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'Preencha nome, e-mail, senha e organização do gestor.');
});

test('owner panel asks before changing the fee or saving a past validity', () => {
  // A taxa: o botão só abre a confirmação; a gravação sai do diálogo.
  assert.match(ownerPage, /const handleServiceFeeToggle = \(\) => \{\n\s+setPendingConfirm\(\{ kind: 'service-fee', enabled: !serviceFeeConfig\.enabled \}\);/);
  assert.match(ownerPage, /title=\{pendingConfirm\.enabled \? 'Ligar a taxa de serviço\?' : 'Desligar a taxa de serviço\?'\}/);
  assert.match(ownerPage, /Inscrições já pagas não mudam\./);
  // Erro em vermelho, sucesso no amarelo.
  assert.match(ownerPage, /serviceFeeNotice\.isError \? 'text-red-400' : 'text-primary'/);

  // Validade no passado: confirmação antes de bloquear.
  assert.match(ownerPage, /if \(value && getManagerAccessStatus\(value\) === 'expired'\) \{\n\s+setPendingConfirm\(\{ kind: 'past-validity', managerId: manager\.id, managerName: manager\.name, value \}\);/);
  assert.match(ownerPage, /confirmText="Salvar e bloquear"/);
  // Salvar fica travado sem mudança (painel lateral do gestor, Story 1.125).
  const managersSection = read('../src/components/owner/OwnerManagersSection.tsx');
  assert.match(managersSection, /const changed = draft !== \(manager\.serviceValidUntil \|\| ''\);/);
  assert.match(managersSection, /disabled=\{saving \|\| !changed\}/);

  assert.match(dialog, /role="alertdialog"/);
  assert.match(dialog, /cancelRef\.current\?\.focus\(\)/);
  assert.match(dialog, /event\.key === 'Escape' && !busyRef\.current/);
});

test('manager signup form locks while sending and shows the API message', () => {
  // Story 1.125: o formulário foi para o painel lateral (OwnerNewManagerForm).
  const form = read('../src/components/owner/OwnerNewManagerForm.tsx');
  assert.match(form, /if \(createManagerPendingRef\.current\) return;/);
  assert.match(form, /disabled=\{isCreatingManager\}/);
  assert.match(form, /minLength=\{MANAGER_PASSWORD_MIN_LENGTH\}/);
  assert.match(form, /setMessage\(\{ text: result\.error, isError: true \}\)/);
  assert.doesNotMatch(form, /O e-mail já existe ou houve um problema/);
  assert.doesNotMatch(ownerPage, /O e-mail já existe ou houve um problema/);
  assert.match(context, /return \{ success: false, error: data\.error \|\| 'Não foi possível cadastrar o gestor\.' \};/);
});
