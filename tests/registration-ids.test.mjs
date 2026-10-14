import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  createAthleteId,
  createRegistrationId,
  isServerAthleteId,
  isServerRegistrationId
} from '../src/lib/registrationIds.ts';

// Story 1.39: o servidor é a única fonte dos identificadores de inscrição e de
// atleta, gerados por um módulo puro.

const source = readFileSync(new URL('../src/lib/registrationIds.ts', import.meta.url), 'utf8');
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('registrationIds é um módulo puro: sem imports, sem relógio e sem Math.random', () => {
  assert.doesNotMatch(source, /^\s*import\s/m);
  assert.doesNotMatch(source, /\benum\b|\bnamespace\b/);
  assert.doesNotMatch(source, /Date\.now|new Date|Math\.random/);
  assert.match(source, /globalThis\.crypto/);
  assert.match(source, /\.randomUUID\(\)/);
});

test('createRegistrationId gera reg-<uuid v4>', () => {
  const id = createRegistrationId();
  assert.match(id, /^reg-/);
  assert.match(id.slice('reg-'.length), UUID_V4);
  assert.equal(isServerRegistrationId(id), true);
  assert.equal(isServerAthleteId(id), false);
});

test('createAthleteId gera ath-<uuid v4>', () => {
  const id = createAthleteId();
  assert.match(id, /^ath-/);
  assert.match(id.slice('ath-'.length), UUID_V4);
  assert.equal(isServerAthleteId(id), true);
  assert.equal(isServerRegistrationId(id), false);
});

test('10 mil gerações seguidas não repetem nenhum id', () => {
  const total = 10_000;
  const registrationIds = new Set(Array.from({ length: total }, createRegistrationId));
  const athleteIds = new Set(Array.from({ length: total }, createAthleteId));
  assert.equal(registrationIds.size, total);
  assert.equal(athleteIds.size, total);
  for (const id of registrationIds) assert.equal(isServerRegistrationId(id), true, id);
  for (const id of athleteIds) assert.equal(isServerAthleteId(id), true, id);
});

test('ids do formato antigo, baseado em milissegundos, não são ids do servidor', () => {
  for (const value of ['reg-1760000000000', 'reg-1', `reg-${Date.now()}`, 'WODA-REG-OK']) {
    assert.equal(isServerRegistrationId(value), false, value);
  }
  for (const value of ['ath-1760000000000', 'ath-1', `ath-${Date.now()}`]) {
    assert.equal(isServerAthleteId(value), false, value);
  }
});

test('isServer* exigem o formato exato', () => {
  const uuid = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
  assert.equal(isServerRegistrationId(`reg-${uuid}`), true);
  assert.equal(isServerAthleteId(`ath-${uuid}`), true);

  const invalidRegistrationIds = [
    undefined, null, 42, {}, [], '',
    uuid,
    `REG-${uuid}`,
    `reg-${uuid.toUpperCase()}`,
    ` reg-${uuid}`,
    `reg-${uuid} `,
    `reg-${uuid}\n`,
    `reg-${uuid}-extra`,
    `xreg-${uuid}`,
    // Versão diferente de 4 e variante fora de 8, 9, a ou b.
    'reg-3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    'reg-3f2504e0-4f89-41d3-7a0c-0305e82c3301',
    // Tamanho errado e caractere fora do hexadecimal.
    'reg-3f2504e0-4f89-41d3-9a0c-0305e82c330',
    'reg-3f2504e0-4f89-41d3-9a0c-0305e82c33zz'
  ];
  for (const value of invalidRegistrationIds) {
    assert.equal(isServerRegistrationId(value), false, String(value));
  }
  for (const value of [undefined, null, 7, '', uuid, `reg-${uuid}`, `ATH-${uuid}`, `ath-${uuid}x`]) {
    assert.equal(isServerAthleteId(value), false, String(value));
  }
});

test('sem gerador seguro disponível a geração falha em vez de improvisar', (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  t.after(() => Object.defineProperty(globalThis, 'crypto', descriptor));
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true, writable: true });
  assert.throws(() => createRegistrationId(), /Gerador seguro de identificadores indisponível/);
  assert.throws(() => createAthleteId(), /Gerador seguro de identificadores indisponível/);
});
