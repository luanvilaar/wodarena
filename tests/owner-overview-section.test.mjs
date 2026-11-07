import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { importServerModule } from './support/serverModuleHarness.mjs';

// Story 1.124 (decisões D4 e E2 de docs/design/painel-proprietario/): Visão geral
// nova com período, números da moeda principal, outras moedas à parte, receita por
// mês, fila de atenção, eventos à venda e cadastros recentes com busca.

const { OwnerOverviewSection, formatOwnerDelta, OWNER_PERIOD_LABELS } = await importServerModule('components/owner/OwnerOverviewSection.tsx');
const { OwnerRevenueChart, resolveChartCeiling } = await importServerModule('components/owner/OwnerRevenueChart.tsx');
const { buildOwnerOverview } = await importServerModule('lib/ownerOverview.ts');

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const ownerPage = read('../src/app/owner/page.tsx');
const shell = read('../src/components/owner/OwnerShell.tsx');
const signups = read('../src/components/owner/OwnerRecentSignups.tsx');

const NOW = new Date('2026-11-07T12:00:00.000Z');
const isoDaysFromNow = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const noop = () => {};

const makeEvent = (overrides = {}) => ({
  id: 'evt-1', name: 'Desafio Litoral', date: '20/12/2099', startDate: isoDaysFromNow(30), endDate: isoDaysFromNow(31),
  timeZone: 'America/Fortaleza', status: 'upcoming', organizerId: 'org-1', isTicketingActive: true, currency: 'BRL',
  logoUrl: '', isFeatured: false, divisions: [{ id: 'd1', slotsLimit: 10, isActive: true }], ...overrides
});

const makeRegistration = (overrides = {}) => ({
  id: `reg-${Math.random().toString(36).slice(2)}`, eventId: 'evt-1', quantity: 1, totalPaid: 100, serviceFeeAmount: 10,
  serviceFeePayer: 'athlete', amountCollected: 110, applicationFeeCharged: 0, paymentStatus: 'payment_approved',
  paymentGateway: 'mercadopago', createdAt: '2026-11-03T15:00:00.000Z', ...overrides
});

const overview = buildOwnerOverview({
  events: [
    makeEvent(),
    makeEvent({ id: 'evt-eur', name: 'Throwdown Lisboa', currency: 'EUR' }),
    makeEvent({ id: 'evt-done', name: 'Festival Verão', startDate: isoDaysFromNow(-20), endDate: isoDaysFromNow(-19) })
  ],
  registrations: [
    makeRegistration({ id: 'a', createdAt: '2026-11-02T15:00:00.000Z' }),
    makeRegistration({ id: 'b', createdAt: '2026-11-05T15:00:00.000Z' }),
    makeRegistration({ id: 'p', createdAt: '2026-11-05T15:00:00.000Z', paymentStatus: 'payment_pending' }),
    makeRegistration({ id: 'prev', createdAt: '2026-10-05T15:00:00.000Z' }),
    makeRegistration({ id: 'eur', eventId: 'evt-eur', createdAt: '2026-11-04T15:00:00.000Z', totalPaid: 50, serviceFeeAmount: 5, amountCollected: 55 })
  ],
  users: [
    { id: 'owner-1', name: 'Dono', email: 'd@exemplo.com', role: 'owner', createdAt: null },
    { id: 'org-1', name: 'Carlos Roberto', email: 'c@exemplo.com', role: 'manager', serviceValidUntil: isoDaysFromNow(3), createdAt: '2026-01-01T00:00:00.000Z' }
  ],
  connectedPaymentUserIds: new Set(['org-1']),
  feePayers: {},
  leads: []
}, { period: 'month', now: NOW });

const render = (props = {}) => renderToStaticMarkup(createElement(OwnerOverviewSection, {
  overview, status: 'ready', error: '', onRetry: noop, onAttentionAction: noop, onOpenEvents: noop,
  signupsQuery: '', signupsQueryNonce: 0, ...props
}));

test('overview cards show the main currency for the period and the delta', () => {
  const html = render();
  assert.match(html, /Receita WODArena<\/p><p[^>]*>R\$\s20,00<\/p>/);
  assert.match(html, /\+100%<\/b> sobre o mesmo trecho do mês passado/);
  assert.match(html, /Pago pelos atletas<\/p><p[^>]*>R\$\s220,00</);
  assert.match(html, /Repassado aos gestores<\/p><p[^>]*>R\$\s200,00</);
  assert.match(html, /Inscrições aprovadas<\/p><p[^>]*>2</);
  assert.match(html, /1 aguardando pagamento/);
  // Outra moeda fica numa nota, fora da soma em reais.
  assert.match(html, /Em EUR no período: €\s?55,00 pagos e €\s?5,00 de taxa\. Ficam fora da soma em BRL\./);
});

test('attention queue, events for sale and the chart come from the overview payload', () => {
  const html = render();
  assert.match(html, /Precisa de atenção/);
  assert.match(html, /Carlos Roberto vence nos próximos 7 dias/);
  assert.match(html, / Atenção<\/span>/);
  assert.match(html, /Ver gestores/);

  const forSale = html.slice(html.indexOf('Eventos à venda'), html.indexOf('Cadastros recentes'));
  assert.match(forSale, /Desafio Litoral/);
  assert.match(forSale, /Throwdown Lisboa/);
  assert.doesNotMatch(forSale, /Festival Verão/, 'encerrado não está à venda');
  assert.match(forSale, /3 de 10 · 30%/, 'ocupação de todo o período, não só do filtro');

  assert.match(html, /últimos 12 meses, em BRL/);
  assert.match(html, /<caption>Receita WODArena por mês em BRL<\/caption>/);
  assert.match(html, /Cadastros recentes/);
  assert.match(html, /placeholder="Buscar por nome ou e-mail"/);
});

test('error state offers a retry and loading never shows zeros', () => {
  const error = render({ overview: null, status: 'error', error: 'Falhou.' });
  assert.match(error, /role="alert"[^>]*><span>Falhou\.<\/span>/);
  assert.match(error, /Tentar de novo/);
  const loading = render({ overview: null, status: 'loading' });
  assert.doesNotMatch(loading, /R\$\s0,00/);
  assert.match(loading, /aria-busy="true"/);
});

test('chart: one bar per month, partial month hatched, round axis ceiling', () => {
  assert.equal(resolveChartCeiling(0), 4);
  assert.equal(resolveChartCeiling(10180), 12000);
  assert.equal(resolveChartCeiling(95), 100);
  const html = renderToStaticMarkup(createElement(OwnerRevenueChart, { points: overview.monthly, currency: 'BRL' }));
  assert.equal((html.match(/<path /g) || []).length, 2, 'outubro e novembro têm valor');
  assert.match(html, /fill="url\(#owner-hatch-/);
  assert.match(html, />parcial</);
  assert.equal((html.match(/tabindex="0"/g) || []).length, 12);
  assert.match(html, /aria-label="nov\/2026: R\$\s20,00 \(parcial\)"/);
});

test('period labels and delta formatting', () => {
  assert.deepEqual(OWNER_PERIOD_LABELS(2026), { month: 'Mês atual', '30d': '30 dias', year: '2026', all: 'Tudo' });
  assert.equal(formatOwnerDelta(0.14), '+14%');
  assert.equal(formatOwnerDelta(-0.2), '-20%');
  assert.equal(formatOwnerDelta(null), '');
});

test('page wires period, top search and refresh after changes', () => {
  assert.match(ownerPage, /fetch\(`\/api\/owner\/overview\?period=\$\{overviewPeriod\}`\)/);
  assert.match(ownerPage, /aria-label="Período dos números"/);
  assert.match(ownerPage, /onSearch=\{handleTopSearch\}/);
  assert.equal((ownerPage.match(/reloadOverview\(\);/g) || []).length, 4, 'taxa, validade, novo gestor e destaque');
  assert.match(shell, /role="search"/);
  assert.match(shell, /id="owner-top-search"/);
  assert.match(signups, /\/api\/owner\/signups\?/);
  assert.match(signups, /Carregar mais/);
});
