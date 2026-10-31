import assert from 'node:assert/strict';
import test from 'node:test';

import { importServerModule } from './support/serverModuleHarness.mjs';

// Story 1.92: token do link de redefinição e e-mail lembrado, lidos só no
// cliente (src/lib/loginPreferences.ts), sem divergir do HTML do servidor.

const {
  LOGIN_EMAIL_STORAGE_KEY,
  parseResetToken,
  readRememberedEmail,
  saveRememberedEmail,
  subscribeToLoginPreferences,
  getResetTokenServerSnapshot,
  getRememberedEmailServerSnapshot
} = await importServerModule('lib/loginPreferences.ts');

const memoryStorage = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
    data
  };
};

test('parseResetToken lê só o reset_token da URL', () => {
  assert.equal(parseResetToken('?reset_token=abc123'), 'abc123');
  assert.equal(parseResetToken('?tab=event&reset_token=xyz'), 'xyz');
  assert.equal(parseResetToken('?tab=event'), '');
  assert.equal(parseResetToken(''), '');
  assert.equal(parseResetToken('?reset_token='), '');
});

test('o servidor sempre responde vazio, então o HTML do servidor é sempre o login', () => {
  assert.equal(getResetTokenServerSnapshot(), '');
  assert.equal(getRememberedEmailServerSnapshot(), '');
});

test('não há o que assinar: assinar devolve uma função que não faz nada', () => {
  const unsubscribe = subscribeToLoginPreferences(() => {});
  assert.equal(typeof unsubscribe, 'function');
  assert.equal(unsubscribe(), undefined);
});

test('lembrar marcado grava o e-mail e a leitura o devolve', () => {
  const storage = memoryStorage();
  saveRememberedEmail(storage, 'ana@box.com', true);

  assert.equal(storage.data.get(LOGIN_EMAIL_STORAGE_KEY), 'ana@box.com');
  assert.equal(readRememberedEmail(storage), 'ana@box.com');
});

test('lembrar desmarcado apaga o e-mail que estava gravado', () => {
  const storage = memoryStorage({ [LOGIN_EMAIL_STORAGE_KEY]: 'ana@box.com' });
  saveRememberedEmail(storage, 'ana@box.com', false);

  assert.equal(storage.data.has(LOGIN_EMAIL_STORAGE_KEY), false);
  assert.equal(readRememberedEmail(storage), '');
});

test('e-mail vazio nunca é gravado, mesmo com lembrar marcado', () => {
  const storage = memoryStorage();
  saveRememberedEmail(storage, '', true);

  assert.equal(storage.data.has(LOGIN_EMAIL_STORAGE_KEY), false);
});

test('armazenamento ausente ou que lança não derruba o login', () => {
  const broken = {
    getItem: () => { throw new Error('SecurityError'); },
    setItem: () => { throw new Error('QuotaExceededError'); },
    removeItem: () => { throw new Error('SecurityError'); }
  };

  assert.equal(readRememberedEmail(null), '');
  assert.equal(readRememberedEmail(broken), '');
  assert.doesNotThrow(() => saveRememberedEmail(null, 'ana@box.com', true));
  assert.doesNotThrow(() => saveRememberedEmail(broken, 'ana@box.com', true));
  assert.doesNotThrow(() => saveRememberedEmail(broken, 'ana@box.com', false));
});
