import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Regressão: no formulário de edição do evento, o campo do regulamento em PDF
// (Story 1.150) e o de patrocinadores (Story 1.151) eram irmãos com a mesma
// `key` (o id do evento). O React acusava "two children with the same key" e
// podia remontar um dos campos a cada render, perdendo o estado interno.

const admin = readFileSync(new URL('../src/app/admin/page.tsx', import.meta.url), 'utf8');

// Bloco do formulário de edição: da descrição do evento até a Identidade Visual.
const start = admin.indexOf('<RulesDocumentField key=');
const end = admin.indexOf('Identidade Visual (Mídia)', start);
const editBlock = admin.slice(start, end);

test('os campos de regulamento e de patrocinadores da edição têm chaves diferentes', () => {
  assert.ok(start > 0 && end > start, 'bloco de edição deve existir');
  const rules = editBlock.match(/<RulesDocumentField key=\{(`[^`]*`)\}/)?.[1];
  const sponsors = editBlock.match(/<SponsorSlotsField key=\{(`[^`]*`)\}/)?.[1];
  assert.ok(rules && sponsors, 'as duas chaves devem existir');
  assert.notEqual(rules, sponsors);
  // Cada chave continua ligada ao evento (trocar de evento remonta o campo).
  assert.match(rules, /selectedEventToManage\?\.id/);
  assert.match(sponsors, /selectedEventToManage\?\.id/);
});

test('nenhuma chave de campo do formulário de edição repete o id do evento sem sufixo', () => {
  const keys = [...editBlock.matchAll(/<\w+ key=\{(`[^`]*`|[^}]*)\}/g)].map((match) => match[1]);
  assert.ok(keys.length >= 2);
  assert.equal(new Set(keys).size, keys.length, `chaves repetidas: ${keys.join(' | ')}`);
  assert.doesNotMatch(editBlock, /key=\{selectedEventToManage\?\.id \?\? 'edit'\}/);
});
