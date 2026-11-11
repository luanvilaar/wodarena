import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { importServerModule } from './support/serverModuleHarness.mjs';

// Story 1.134: inscrição em 3 etapas, em tela cheia (P6 de
// docs/design/mobile-competitivo/).

const { sanitizeRegistrationDraft, readRegistrationDraft, writeRegistrationDraft, clearRegistrationDraft, registrationDraftKey } =
  await importServerModule('lib/registrationDraft.ts');

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const modal = read('../src/components/RegisterModal.tsx');
const messages = Object.fromEntries(['pt-br', 'pt-pt', 'en-gb'].map((l) => [l, JSON.parse(read(`../src/messages/${l}.json`))]));

const memoryStorage = () => {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k), data };
};

test('rascunho guarda só categoria, equipe, box e atletas; nunca senha ou CPF', () => {
  const storage = memoryStorage();
  writeRegistrationDraft(storage, 'evt-1', {
    divisionId: 'div-1', teamName: 'Trio Sertão', box: 'Box Bravos',
    participants: [{ name: 'Ana', email: 'ana@x.com', phone: '1', gender: 'female', instagram: '', shirtSize: 'M', birthDate: '', city: '', state: '', password: 'segredo', cpf: '123' }],
    athletePassword: 'segredo', cpf: '12345678900'
  });
  const raw = storage.data.get(registrationDraftKey('evt-1'));
  assert.doesNotMatch(raw, /segredo|12345678900|"cpf"|password/i);
  const back = readRegistrationDraft(storage, 'evt-1');
  assert.equal(back.divisionId, 'div-1');
  assert.equal(back.participants[0].name, 'Ana');
  assert.equal(back.participants[0].gender, 'female');
  clearRegistrationDraft(storage, 'evt-1');
  assert.equal(readRegistrationDraft(storage, 'evt-1'), null);
});

test('rascunho tolera armazenamento ausente, JSON quebrado e lixo', () => {
  assert.equal(readRegistrationDraft(null, 'evt'), null);
  assert.equal(readRegistrationDraft({ getItem: () => '{quebrado' }, 'evt'), null);
  assert.equal(readRegistrationDraft({ getItem: () => { throw new Error('bloqueado'); } }, 'evt'), null);
  assert.doesNotThrow(() => writeRegistrationDraft({ setItem: () => { throw new Error('cheio'); } }, 'evt', { divisionId: '', teamName: '', box: '', participants: [] }));
  assert.equal(sanitizeRegistrationDraft('x'), null);
  assert.equal(sanitizeRegistrationDraft({ participants: new Array(20).fill({}) }).participants.length, 6);
});

test('o modal guarda o rascunho na sessão, restaura ao abrir e limpa depois da inscrição', () => {
  assert.match(modal, /window\.sessionStorage/);
  assert.doesNotMatch(modal, /localStorage/);
  assert.match(modal, /const draft = isOpen \? readRegistrationDraft\(getSessionStorage\(\), event\.id\) : null;/);
  assert.match(modal, /if \(isSuccess \|\| confirmedVoucher\) clearRegistrationDraft\(getSessionStorage\(\), event\.id\);/);
});

test('tela cheia no celular, tema escuro e QR do Pix em fundo branco', () => {
  assert.doesNotMatch(modal, /transactional-surface/);
  assert.match(modal, /relative flex h-\[100dvh\] w-full flex-col overflow-hidden bg-background text-foreground sm:h-auto/);
  assert.match(modal, /flex justify-center items-center p-4 bg-white rounded-xl/);
});

test('três etapas com progresso, voltar, validação por tela e rodapé com total', () => {
  assert.match(modal, /const \[step, setStep\] = useState<CheckoutStep>\(1\);/);
  assert.match(modal, /\{step === 1 && \(/);
  assert.match(modal, /\{step === 2 && \(/);
  assert.match(modal, /\{step === 3 && \(/);
  assert.match(modal, /if \(!field\.checkValidity\(\)\) \{\s*field\.reportValidity\(\);/);
  assert.match(modal, /t\('stepCounter', \{ current: step, total: 3 \}\)/);
  assert.match(modal, /onClick=\{goBack\}/);
  assert.match(modal, /\{step < 3 \? \(\s*<button\s+type="button"\s+onClick=\{goNext\}/);
  assert.match(modal, /type="radio"\s+name="division"/);
  // Um atleta por vez: só o atleta da tela atual é renderizado.
  assert.match(modal, /const index = athleteStep;/);
  assert.doesNotMatch(modal, /visibleParticipants\.map\(\(participant, index\) =>/);
});

test('Instagram opcional no formulário e na checagem do envio', () => {
  const instagramInput = modal.match(/<input\s+id=\{`athlete-\$\{index\}-instagram`\}[\s\S]*?\/>/)[0];
  assert.doesNotMatch(instagramInput, /required/);
  assert.doesNotMatch(modal, /!participant\.instagram\)/);
  assert.equal(messages['pt-br'].Checkout.instagramLabel, 'Instagram (opcional)');
});

test('textos das etapas nos três idiomas', () => {
  for (const [locale, json] of Object.entries(messages)) {
    for (const key of ['stepCategory', 'stepAthletes', 'stepPayment', 'stepCounter', 'stepProgress', 'backStepAria', 'continue', 'stepCategoryTitle', 'athleteStepTitle', 'captainHint', 'stepPaymentTitle', 'typeIndividual', 'typeDuo', 'typeTrio', 'typeTeam', 'typeTeam4', 'typeTeam6', 'slotsLimit']) {
      assert.ok(json.Checkout[key], `${locale}: Checkout.${key}`);
    }
  }
});
