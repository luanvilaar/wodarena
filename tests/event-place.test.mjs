import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { importServerModule } from './support/serverModuleHarness.mjs';

// Story 1.130: local curto do evento no card ("Cidade/UF").

const { toUf, formatCity, formatEventPlace, BRAZIL_UFS } = await importServerModule('lib/eventPlace.ts');
const eventCard = readFileSync(new URL('../src/components/EventCard.tsx', import.meta.url), 'utf8');

test('reconhece a UF nos formatos que o cadastro já tem', () => {
  assert.equal(toUf('PB'), 'PB');
  assert.equal(toUf('ce'), 'CE');
  assert.equal(toUf('PB - PARAÍBA'), 'PB');
  assert.equal(toUf('Rio grande do Norte'), 'RN');
  assert.equal(toUf('São Paulo'), 'SP');
  assert.equal(toUf('Pará'), 'PA');
  assert.equal(toUf('Paraná'), 'PR');
  assert.equal(toUf('Lisboa'), null);
  assert.equal(toUf(''), null);
  assert.equal(toUf(undefined), null);
  assert.equal(BRAZIL_UFS.length, 27);
});

test('capitaliza só cidade toda em maiúsculas', () => {
  assert.equal(formatCity('JOAO PESSOA'), 'Joao Pessoa');
  assert.equal(formatCity('SÃO GONÇALO DO AMARANTE'), 'São Gonçalo do Amarante');
  assert.equal(formatCity('João Pessoa '), 'João Pessoa');
  assert.equal(formatCity('Campina Grande'), 'Campina Grande');
});

test('monta Cidade/UF, cai para a cidade e por fim para o local cadastrado', () => {
  assert.equal(formatEventPlace({ city: 'Russas', state: 'CE', location: 'Box Bravos do Sertão' }), 'Russas/CE');
  assert.equal(formatEventPlace({ city: 'JOAO PESSOA', state: 'PB - PARAÍBA' }), 'Joao Pessoa/PB');
  assert.equal(formatEventPlace({ city: 'São Gonçalo do Amarante', state: 'Rio grande do Norte' }), 'São Gonçalo do Amarante/RN');
  assert.equal(formatEventPlace({ city: 'Lisboa', state: 'Lisboa' }), 'Lisboa');
  assert.equal(formatEventPlace({ city: '', state: 'CE', location: 'GINASIO ACILON GONÇALVES PINTO - AQUIRAZ' }), 'GINASIO ACILON GONÇALVES PINTO - AQUIRAZ');
});

test('o card compacto: local curto, sem logo, sem descrição, sem divisões e um botão por estado', () => {
  assert.match(eventCard, /const locationLabel = formatEventPlace\(event\);/);
  assert.doesNotMatch(eventCard, /event\.logoUrl|nextArenaLabel|event\.description|t\('viewEvent'\)/);
  assert.match(eventCard, /<Link href=\{eventHref\} tabIndex=\{-1\} aria-hidden="true" className=\{`relative block aspect-\[5\/2\]/);
  assert.match(eventCard, /<Link href=\{eventHref\} className="transition-colors hover:text-primary/);
});
