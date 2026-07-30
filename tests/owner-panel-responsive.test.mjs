import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const ownerPage = read('../src/app/owner/page.tsx');

test('owner dashboard uses a consistent metric grid without compressing cards at laptop widths', () => {
  const metricGrid = 'grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4';

  assert.ok(ownerPage.split(metricGrid).length - 1 >= 3);
  assert.match(ownerPage, /min-h-\[116px\]/);
  assert.match(ownerPage, /min-w-0 space-y-1/);
  assert.match(ownerPage, /shrink-0 rounded-lg/);
});

test('owner navigation and primary controls expose mobile-friendly touch and overflow behavior', () => {
  assert.match(ownerPage, /aria-label="Navegação do painel do proprietário"/);
  assert.match(ownerPage, /snap-x snap-mandatory/);
  assert.match(ownerPage, /min-h-11 shrink-0 snap-start/);
  assert.match(ownerPage, /Deslize para acessar todas as seções/);
  assert.match(ownerPage, /min-h-11 w-full.*sm:w-auto/);
});

test('owner operational tables provide complete mobile card views and retain desktop tables', () => {
  assert.ok(ownerPage.split('space-y-3 lg:hidden').length - 1 >= 4);
  assert.ok(ownerPage.split('hidden overflow-x-auto lg:block').length - 1 >= 4);
  assert.match(ownerPage, /Pagos \/ pendentes/);
  assert.match(ownerPage, /Taxa devida/);
  assert.match(ownerPage, /Notificação/);
  assert.match(ownerPage, /Taxa split/);
  assert.match(ownerPage, /manager-validity-\$\{item\.manager\.id\}/);
});
