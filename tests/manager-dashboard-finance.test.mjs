import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildEventFinanceRow,
  buildManagerFinanceSummary,
  resolveCollectedAmount,
  resolveEventSlotsLimit,
  resolveServiceFee
} from '../src/lib/managerFinance.ts';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const makeEvent = (overrides = {}) => ({
  id: 'evt-1',
  name: 'Híbrido Race',
  date: '14/11/2026',
  location: 'João Pessoa - PB',
  description: '',
  logoUrl: '',
  bannerUrl: '',
  status: 'upcoming',
  organizerId: 'mgr-1',
  sponsors: [],
  workouts: [],
  format: 'individual',
  ticketPrice: 150,
  ticketSlots: 100,
  isTicketingActive: true,
  divisions: [
    { id: 'div-1', name: 'RX', category: 'rx', type: 'individual', slotsLimit: 40, price: 180, isActive: true },
    { id: 'div-2', name: 'Scale', category: 'scale', type: 'individual', slotsLimit: 10, price: 150, isActive: false }
  ],
  ...overrides
});

const makeRegistration = (overrides = {}) => ({
  id: 'reg-1',
  eventId: 'evt-1',
  divisionId: 'div-1',
  athleteName: 'Atleta',
  athleteEmail: 'a@b.com',
  athletePhone: '',
  box: '',
  gender: 'male',
  ticketType: 'RX',
  ticketPrice: 180,
  quantity: 1,
  totalPaid: 180,
  createdAt: '2026-09-01T12:00:00.000Z',
  paymentStatus: 'payment_approved',
  ...overrides
});

test('a taxa de serviço é cobrada por fora: o gestor recebe o ingresso integral', () => {
  const event = makeEvent();
  const registrations = [
    makeRegistration({ id: 'r1', totalPaid: 180, serviceFeeAmount: 18, amountCollected: 198 }),
    makeRegistration({ id: 'r2', totalPaid: 180, serviceFeeAmount: 18, amountCollected: 198 })
  ];

  const row = buildEventFinanceRow(event, registrations);

  assert.equal(row.netRevenue, 360, 'recebido deve ser a soma integral dos ingressos, sem desconto de 10%');
  assert.equal(row.serviceFee, 36);
  assert.equal(row.collected, 396);
  assert.equal(row.paidCount, 2);
  assert.equal(row.averageTicket, 180);
});

test('a taxa efetivamente retida pelo gateway tem precedência sobre a calculada', () => {
  assert.equal(resolveServiceFee(makeRegistration({ serviceFeeAmount: 18, applicationFeeCharged: 17.5 })), 17.5);
  assert.equal(resolveServiceFee(makeRegistration({ serviceFeeAmount: 18, applicationFeeCharged: 0 })), 18);
  assert.equal(resolveServiceFee(makeRegistration({})), 0);
});

test('inscrições antigas sem amount_collected reconstroem o total cobrado', () => {
  // A migration preencheu `amount_collected = total_paid` no histórico.
  assert.equal(resolveCollectedAmount(makeRegistration({ totalPaid: 180, amountCollected: 180, serviceFeeAmount: 18 })), 198);
  assert.equal(resolveCollectedAmount(makeRegistration({ totalPaid: 180, amountCollected: 198, serviceFeeAmount: 18 })), 198);
  assert.equal(resolveCollectedAmount(makeRegistration({ totalPaid: 180 })), 180);
});

test('somente inscrições aprovadas entram no faturamento; canceladas e falhas ficam de fora', () => {
  const event = makeEvent();
  const registrations = [
    makeRegistration({ id: 'r1', totalPaid: 180, serviceFeeAmount: 18 }),
    makeRegistration({ id: 'r2', totalPaid: 180, paymentStatus: 'payment_cancelled', refundStatus: 'manual_refunded', refundAmount: 180 }),
    makeRegistration({ id: 'r3', totalPaid: 180, paymentStatus: 'payment_failed' }),
    makeRegistration({ id: 'r4', totalPaid: 180, paymentStatus: 'payment_pending' }),
    makeRegistration({ id: 'r5', totalPaid: 180, paymentStatus: 'payment_in_review' })
  ];

  const row = buildEventFinanceRow(event, registrations);

  assert.equal(row.netRevenue, 180);
  assert.equal(row.paidCount, 1);
  assert.equal(row.pendingCount, 2, 'pendente e em análise contam como pendentes; falha e cancelada não');
});

test('ocupação usa apenas o limite das categorias ativas', () => {
  const event = makeEvent();
  assert.equal(resolveEventSlotsLimit(event), 40, 'a categoria inativa não entra na capacidade');

  const registrations = [
    makeRegistration({ id: 'r1', quantity: 4 }),
    makeRegistration({ id: 'r2', quantity: 6 })
  ];
  const row = buildEventFinanceRow(event, registrations);

  assert.equal(row.ticketsSold, 10);
  assert.equal(row.occupancyRate, 0.25);

  const semLimite = buildEventFinanceRow(makeEvent({ divisions: [] }), registrations);
  assert.equal(semLimite.occupancyRate, null);
  assert.equal(semLimite.slotsLimit, 0);
});

test('ocupação nunca ultrapassa 100% mesmo com vendas acima do limite', () => {
  const row = buildEventFinanceRow(makeEvent(), [makeRegistration({ quantity: 60 })]);
  assert.equal(row.occupancyRate, 1);
});

test('evento sem venda não divide por zero no ticket médio', () => {
  const row = buildEventFinanceRow(makeEvent(), []);
  assert.equal(row.averageTicket, null);
  assert.equal(row.netRevenue, 0);
  assert.equal(row.occupancyRate, 0);
});

test('eventos são agrupados por moeda e ordenados por faturamento', () => {
  const brl = makeEvent({ id: 'evt-brl', name: 'Arena Cup', currency: 'BRL' });
  const brlMaior = makeEvent({ id: 'evt-brl2', name: 'Híbrido Race', currency: 'BRL' });
  const eur = makeEvent({ id: 'evt-eur', name: 'Lisboa Throwdown', currency: 'EUR' });

  const registrations = [
    makeRegistration({ id: 'r1', eventId: 'evt-brl', totalPaid: 100, serviceFeeAmount: 10 }),
    makeRegistration({ id: 'r2', eventId: 'evt-brl2', totalPaid: 900, serviceFeeAmount: 90 }),
    makeRegistration({ id: 'r3', eventId: 'evt-eur', totalPaid: 50, serviceFeeAmount: 5 })
  ];

  const summary = buildManagerFinanceSummary([brl, brlMaior, eur], registrations);

  assert.equal(summary.groups.length, 2);
  assert.equal(summary.primary.currency, 'BRL');
  assert.equal(summary.primary.totals.netRevenue, 1000);
  assert.equal(summary.primary.totals.serviceFee, 100);
  assert.equal(summary.primary.totals.collected, 1100);
  assert.equal(summary.primary.rows[0].event.id, 'evt-brl2', 'maior faturamento primeiro');
  assert.equal(summary.primary.rows[0].revenueShare, 0.9);
  assert.equal(summary.secondary.length, 1);
  assert.equal(summary.secondary[0].currency, 'EUR');
  assert.equal(summary.secondary[0].totals.netRevenue, 50);
});

test('evento sem moeda definida cai em BRL', () => {
  const summary = buildManagerFinanceSummary([makeEvent()], []);
  assert.equal(summary.primary.currency, 'BRL');
});

test('o dashboard do gestor não aplica mais desconto percentual sobre a receita', () => {
  const adminPage = read('../src/app/admin/page.tsx');
  const dashboard = read('../src/components/admin/DashboardOverview.tsx');

  assert.doesNotMatch(adminPage, /grossRevenue \* 0\.9/, 'a receita do gestor não sofre desconto de 10%');
  assert.doesNotMatch(dashboard, /\* 0\.9\b/);
  assert.doesNotMatch(dashboard, /Receita Líquida \(90%\)/);
  assert.match(dashboard, /Você recebe/);
});

test('o dashboard não expõe a taxa da plataforma como estatística do gestor', () => {
  // A taxa de serviço é cobrada do atleta por fora da inscrição (ex.: R$100 +
  // 10%) e não é ganho do gestor — não deve aparecer como número dele em
  // nenhum lugar do dashboard (card principal, tabela ou cartões mobile).
  const dashboard = read('../src/components/admin/DashboardOverview.tsx');

  assert.doesNotMatch(dashboard, /Taxa WODArena/);
  assert.doesNotMatch(dashboard, /Cobrado dos atletas/);
  assert.doesNotMatch(dashboard, /row\.serviceFee/);
  assert.doesNotMatch(dashboard, /group\.totals\.serviceFee/);
  assert.doesNotMatch(dashboard, /\bcollected\b/);
});

test('o dashboard não exibe métricas simuladas de acesso', () => {
  const adminPage = read('../src/app/admin/page.tsx');
  const dashboard = read('../src/components/admin/DashboardOverview.tsx');

  for (const source of [adminPage, dashboard]) {
    assert.doesNotMatch(source, /eventsByAccess/);
    assert.doesNotMatch(source, /regCount \* 3\.5/);
    assert.doesNotMatch(source, /Mais Acessados/i);
  }
});

test('o faturamento por evento formata cada evento na moeda dele', () => {
  const dashboard = read('../src/components/admin/DashboardOverview.tsx');

  // Toda quantia passa por formatMoney recebendo a moeda do evento — o
  // dashboard nunca instancia um formatador com moeda fixa.
  assert.match(dashboard, /currency: EventCurrency\) => formatMoney\(/);
  assert.doesNotMatch(dashboard, /style: 'currency'/);
  assert.match(dashboard, /money\(row\.netRevenue, row\.currency\)/);
  assert.match(dashboard, /Faturamento por Evento/);
});

test('o dashboard segue as regras visuais planas do projeto', () => {
  const dashboard = read('../src/components/admin/DashboardOverview.tsx');

  assert.doesNotMatch(dashboard, /\bshadow(?:-[a-z]+)?\b/);
  assert.doesNotMatch(dashboard, /bg-gradient/);
  assert.doesNotMatch(dashboard, /transition-all/);
  assert.doesNotMatch(dashboard, /#[0-9a-f]{3,8}/i);
  assert.doesNotMatch(dashboard, /\balert\(/);
});

test('o dashboard responde a telas estreitas sem tabelas espremidas', () => {
  const dashboard = read('../src/components/admin/DashboardOverview.tsx');

  // A tabela de faturamento só aparece a partir de lg; abaixo disso, cartões.
  assert.match(dashboard, /className="space-y-3 lg:hidden"/);
  assert.match(dashboard, /className="hidden lg:block"/);
  // Últimas inscrições: lista empilhada abaixo de md.
  assert.match(dashboard, /className="mt-4 space-y-3 md:hidden"/);
  assert.match(dashboard, /className="mt-2 hidden md:block"/);
});

test('o pulso de "ao vivo" só aparece com evento no ar e respeita reduced motion', () => {
  const dashboard = read('../src/components/admin/DashboardOverview.tsx');

  assert.match(dashboard, /stats\.activeEventsCount > 0 && \(\s*<span aria-hidden="true" className="[^"]*motion-safe:animate-pulse/);
  assert.doesNotMatch(dashboard, /(?<!motion-safe:)animate-pulse/);
});
