import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { importServerModule } from './support/serverModuleHarness.mjs';

// Story 1.125 (docs/design/painel-proprietario/): seções Gestores e Eventos com
// filtros e busca, painel lateral do gestor (renovação rápida, números, eventos),
// cadastro de gestor no painel e detalhe do evento com a divisão do dinheiro e o ranking.

const { OwnerManagersSection, filterOwnerManagers, getOwnerFeePayerLabel } = await importServerModule('components/owner/OwnerManagersSection.tsx');
const { OwnerEventsSection, filterOwnerEvents } = await importServerModule('components/owner/OwnerEventsSection.tsx');
const { renewServiceValidity } = await importServerModule('lib/ownerFinance.ts');

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const ownerPage = read('../src/app/owner/page.tsx');
const drawer = read('../src/components/owner/OwnerDrawer.tsx');
const eventsSource = read('../src/components/owner/OwnerEventsSection.tsx');

const noop = () => {};
const money = (currency, collected, serviceFee, netRevenue) => ({ currency, collected, serviceFee, netRevenue, paidCount: 0, pendingCount: 0, eventsCount: 1 });

const managers = [
  { id: 'm1', name: 'Carlos Roberto', email: 'carlos@exemplo.com', organization: 'Box Sul', serviceValidUntil: '2099-03-31', accessStatus: 'active', createdAt: '2026-01-10T12:00:00.000Z', eventsCount: 2, paidCount: 40, pendingCount: 3, money: [money('BRL', 4400, 400, 4000), money('EUR', 550, 50, 500)], feePayer: 'athlete', hasPaymentAccount: true },
  { id: 'm2', name: 'Marina Alves', email: 'marina@exemplo.com', organization: 'Arena', serviceValidUntil: '2026-11-10', accessStatus: 'expiring_soon', createdAt: null, eventsCount: 1, paidCount: 10, pendingCount: 0, money: [money('BRL', 1100, 100, 1000)], feePayer: 'organizer', hasPaymentAccount: true },
  { id: 'm3', name: 'Rafael Lima', email: 'rafael@exemplo.com', organization: 'Box Norte', serviceValidUntil: '2026-11-01', accessStatus: 'expired', createdAt: null, eventsCount: 1, paidCount: 0, pendingCount: 0, money: [], feePayer: null, hasPaymentAccount: false },
  { id: 'm4', name: 'Pedro Nunes', email: 'pedro@exemplo.com', organization: '', serviceValidUntil: null, accessStatus: 'unconfigured', createdAt: null, eventsCount: 0, paidCount: 0, pendingCount: 0, money: [], feePayer: null, hasPaymentAccount: false }
];

const events = [
  { id: 'e1', name: 'Desafio Litoral', logoUrl: '', date: '15/11/2026', organizerId: 'm1', managerName: 'Carlos Roberto', currency: 'BRL', situation: 'open', isFeatured: false, paidCount: 30, pendingCount: 3, staleReviewCount: 1, ticketsSold: 30, slotsLimit: 40, collected: 3300, serviceFee: 300, netRevenue: 3000 },
  { id: 'e2', name: 'Throwdown Lisboa', logoUrl: '', date: '13/12/2026', organizerId: 'm1', managerName: 'Carlos Roberto', currency: 'EUR', situation: 'closing', isFeatured: false, paidCount: 10, pendingCount: 0, staleReviewCount: 0, ticketsSold: 10, slotsLimit: 0, collected: 550, serviceFee: 50, netRevenue: 500 },
  { id: 'e3', name: 'Copa Sertão', logoUrl: '', date: '06/12/2026', organizerId: 'm3', managerName: 'Rafael Lima', currency: 'BRL', situation: 'blocked', isFeatured: false, paidCount: 0, pendingCount: 0, staleReviewCount: 0, ticketsSold: 0, slotsLimit: 100, collected: 0, serviceFee: 0, netRevenue: 0 },
  { id: 'e4', name: 'Festival Verão', logoUrl: '', date: '19/10/2026', organizerId: 'm2', managerName: 'Marina Alves', currency: 'BRL', situation: 'finished', isFeatured: false, paidCount: 10, pendingCount: 0, staleReviewCount: 0, ticketsSold: 10, slotsLimit: 10, collected: 1100, serviceFee: 100, netRevenue: 1000 }
];

const renderManagers = (props = {}) => renderToStaticMarkup(createElement(OwnerManagersSection, {
  managers, events, filter: 'all', onFilterChange: noop, focusedManagerId: null, onFocusManager: noop,
  onSaveValidity: async () => {}, savingManagerId: null, notice: { text: '', isError: false },
  onCreateManager: async () => ({ success: true }), ...props
}));

test('renewal counts from the current validity, or from today when it already expired', () => {
  assert.equal(renewServiceValidity('2026-12-01', '30d', '2026-11-07'), '2026-12-31');
  assert.equal(renewServiceValidity('2026-11-01', '30d', '2026-11-07'), '2026-12-07', 'vencida: a partir de hoje');
  assert.equal(renewServiceValidity(null, '90d', '2026-11-07'), '2027-02-05');
  assert.equal(renewServiceValidity('2027-03-31', '1y', '2026-11-07'), '2028-03-31');
  assert.equal(renewServiceValidity('2028-02-29', '1y', '2026-11-07'), '2029-03-01');
});

test('manager filters count and search by name, e-mail or box', () => {
  assert.deepEqual(filterOwnerManagers(managers, 'expiring_soon', '').map(manager => manager.id), ['m2']);
  assert.deepEqual(filterOwnerManagers(managers, 'no_account', '').map(manager => manager.id), ['m3', 'm4']);
  assert.deepEqual(filterOwnerManagers(managers, 'all', 'NORTE').map(manager => manager.id), ['m3']);
  assert.deepEqual(filterOwnerManagers(managers, 'all', 'marina@').map(manager => manager.id), ['m2']);
  assert.equal(getOwnerFeePayerLabel('organizer'), 'Gestor absorve');
  assert.equal(getOwnerFeePayerLabel(null), 'Padrão do gateway');

  const html = renderManagers();
  assert.match(html, /aria-pressed="true"[^>]*>Todos<span[^>]*>4</);
  assert.match(html, />Vencendo<span[^>]*>1</);
  assert.match(html, />Sem conta de recebimento<span[^>]*>2</);
  assert.match(html, /R\$\s400,00 · €\s?50,00/, 'um valor por moeda');
  assert.match(html, /Novo gestor/);
  assert.doesNotMatch(html, /role="dialog"/, 'painel fechado');
});

test('manager drawer shows access, quick renewal, numbers, account and events', () => {
  const html = renderManagers({ focusedManagerId: 'm3' });
  assert.match(html, /role="dialog"/);
  assert.match(html, /id="owner-drawer-title"[^>]*>Rafael Lima</);
  assert.match(html, /Painel e vendas bloqueados/);
  assert.match(html, /Válido até 01\/11\/2026/);
  for (const label of ['+30 dias', '+90 dias', '+1 ano']) assert.match(html, new RegExp(`>\\${label}<`.replace('\\+', '\\+')));
  assert.match(html, /id="manager-validity-m3"[^>]*value="2026-11-01"/);
  assert.match(html, /disabled=""[^>]*>Salvar validade</, 'sem mudança, Salvar fica desligado');
  assert.match(html, /Conta de recebimento<\/dt><dd[^>]*>Não conectada</);
  assert.match(html, /Copa Sertão/);
  assert.match(html, />Vendas bloqueadas</);
});

test('event filters, table and money split', () => {
  assert.deepEqual(filterOwnerEvents(events, 'sale', '').map(event => event.id), ['e1', 'e2']);
  assert.deepEqual(filterOwnerEvents(events, 'blocked', '').map(event => event.id), ['e3']);
  assert.deepEqual(filterOwnerEvents(events, 'finished', '').map(event => event.id), ['e4']);
  assert.deepEqual(filterOwnerEvents(events, 'all', 'rafael').map(event => event.id), ['e3']);

  const html = renderToStaticMarkup(createElement(OwnerEventsSection, { events, renderRanking: () => null }));
  assert.match(html, />À venda<span[^>]*>2</);
  assert.match(html, /30 de 40 · 75%/);
  assert.match(html, /10 vendidas · sem limite/);
  assert.match(html, /€\s?550,00/);
  assert.match(html, /A situação segue o ciclo de vida do site/);

  // O detalhe abre no painel lateral, com as abas Dinheiro e Ranking.
  assert.match(eventsSource, /role="tablist" aria-label="Detalhe do evento"/);
  assert.match(eventsSource, /Repassado ao gestor/);
  assert.match(eventsSource, /Em análise há mais de 48 h/);
});

test('drawer closes on Esc, background or X and gives focus back', () => {
  assert.match(drawer, /role="dialog"/);
  assert.match(drawer, /aria-modal="true"/);
  assert.match(drawer, /event\.key === 'Escape' && !busyRef\.current && !document\.querySelector\('\[role="alertdialog"\]'\)/);
  assert.match(drawer, /opener\?\.focus\?\.\(\)/);
});

test('page feeds both sections from the overview route and keeps the confirmation rules', () => {
  assert.match(ownerPage, /<OwnerManagersSection\n\s+managers=\{overview\?\.managers \?\? null\}/);
  assert.match(ownerPage, /<OwnerEventsSection\n\s+events=\{overview\?\.events \?\? null\}/);
  assert.match(ownerPage, /onCreateManager=\{handleCreateManager\}/);
  assert.match(ownerPage, /if \(result\.success\) reloadOverview\(\);/);
  assert.doesNotMatch(ownerPage, /buildOwnerFinance\(events, registrations\)/, 'nada de somar no navegador');
});
