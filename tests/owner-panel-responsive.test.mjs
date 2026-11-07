import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const ownerPage = read('../src/app/owner/page.tsx');
const ownerShell = read('../src/components/owner/OwnerShell.tsx');

test('owner overview uses a consistent metric grid without compressing cards at laptop widths', () => {
  // Story 1.124: os quatro números da Visão geral nova (OwnerOverviewSection).
  const overviewSection = read('../src/components/owner/OwnerOverviewSection.tsx');
  assert.match(overviewSection, /grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4/);
  assert.equal((overviewSection.match(/\$\{ownerCardClassName\} space-y-1/g) || []).length, 4);
  // Comercial (Story 1.126): contadores em duas colunas no celular e quatro no computador.
  assert.match(read('../src/components/owner/OwnerCommercialSection.tsx'), /grid grid-cols-2 gap-3 lg:grid-cols-4/);
});

test('owner navigation and primary controls expose mobile-friendly touch and overflow behavior', () => {
  // Story 1.123: a navegação está na moldura própria (OwnerShell): faixa com rolagem
  // lateral no celular, barra lateral no computador, seção atual com aria-current.
  assert.match(ownerShell, /aria-label="Seções do painel do proprietário"/);
  assert.match(ownerShell, /snap-x snap-mandatory/);
  assert.match(ownerShell, /shrink-0 snap-start/);
  assert.match(ownerShell, /flex min-h-11 w-full items-center/);
  assert.match(ownerShell, /aria-current=\{isActive \? 'page' : undefined\}/);
  assert.match(ownerPage, /min-h-11 w-full.*sm:w-auto/);
});

test('owner operational tables provide complete mobile card views and retain desktop tables', () => {
  // Stories 1.125 e 1.126: Gestores, Eventos e Comercial são componentes, cada um com
  // cartões no celular e tabela no computador.
  const managersSection = read('../src/components/owner/OwnerManagersSection.tsx');
  const eventsSection = read('../src/components/owner/OwnerEventsSection.tsx');
  const commercialSection = read('../src/components/owner/OwnerCommercialSection.tsx');
  for (const source of [managersSection, eventsSection, commercialSection]) {
    assert.match(source, /<ul className="space-y-3 lg:hidden">/);
    assert.match(source, /hidden overflow-x-auto rounded-xl border border-card-border bg-card lg:block/);
  }
  // "Aguardando" (só pending/in_review), "Taxa WODArena" e quem paga a taxa também no celular.
  assert.match(managersSection, /Aprovadas \/ aguardando/);
  assert.match(managersSection, /Taxa WODArena<\/span>/);
  assert.match(managersSection, /Quem paga a taxa<\/span>/);
  assert.match(commercialSection, /Notificação/);
  assert.match(managersSection, /manager-validity-\$\{manager\.id\}/);
});
