import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { importServerModule } from './support/serverModuleHarness.mjs';

// Story 1.120: o /owner somava cada aba de um jeito (amountCollected ?? totalPaid,
// totalPaid das aprovadas, totalPaid de todas, "Taxa Split" fixa), misturava moedas
// e contava recusadas como pendentes. Agora tudo passa por ownerFinance.ts, que usa
// a regra do painel do gestor (managerFinance.ts). Desenho em
// docs/design/painel-proprietario/.

const {
  buildOwnerFinance,
  buildOwnerManagerRows,
  formatOwnerDate,
  getOwnerEventSituation,
  pickPrimaryCurrencyTotals,
  OWNER_EVENT_SITUATION_LABELS
} = await importServerModule('lib/ownerFinance.ts');
const { buildEventFinanceRow } = await importServerModule('lib/managerFinance.ts');

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const ownerPage = read('../src/app/owner/page.tsx');
const ownerFinanceSource = read('../src/lib/ownerFinance.ts');

const isoDaysFromNow = (days) => {
  const date = new Date(Date.now() + days * 86_400_000);
  return date.toISOString().slice(0, 10);
};

const makeEvent = (overrides = {}) => ({
  id: 'evt-brl',
  name: 'Desafio Exemplo',
  date: '20/12/2099',
  startDate: isoDaysFromNow(30),
  endDate: isoDaysFromNow(31),
  timeZone: 'America/Fortaleza',
  location: 'Fortaleza - CE',
  description: '',
  logoUrl: '',
  bannerUrl: '',
  status: 'upcoming',
  organizerId: 'mgr-1',
  sponsors: [],
  workouts: [],
  format: 'individual',
  ticketPrice: 100,
  ticketSlots: 100,
  isTicketingActive: true,
  divisions: [],
  currency: 'BRL',
  ...overrides
});

const makeRegistration = (overrides = {}) => ({
  id: `reg-${Math.random().toString(36).slice(2)}`,
  eventId: 'evt-brl',
  divisionId: 'div-1',
  athleteId: 'ath-1',
  quantity: 1,
  totalPaid: 100,
  paymentStatus: 'payment_approved',
  serviceFeeAmount: 10,
  serviceFeePayer: 'athlete',
  paymentGateway: 'mercadopago',
  ...overrides
});

// Exemplo da proposta: aprovada com taxa por cima, aprovada com taxa absorvida, recusada.
const proposalRegistrations = () => [
  makeRegistration({ id: 'r1', amountCollected: 110, serviceFeePayer: 'athlete' }),
  makeRegistration({ id: 'r2', amountCollected: 100, serviceFeePayer: 'organizer' }),
  makeRegistration({ id: 'r3', paymentStatus: 'payment_failed' })
];

test('owner finance reproduces the proposal example with the manager panel rule', () => {
  const event = makeEvent();
  const finance = buildOwnerFinance([event], proposalRegistrations());
  const row = finance.rowsByEventId.get('evt-brl');

  assert.equal(row.collected, 210);
  assert.equal(row.serviceFee, 20);
  assert.equal(row.netRevenue, 190);
  assert.equal(row.paidCount, 2);
  assert.equal(row.pendingCount, 0, 'recusada não é pendente');

  // O mesmo número do painel do gestor para o mesmo evento.
  assert.deepEqual(
    { collected: row.collected, serviceFee: row.serviceFee, netRevenue: row.netRevenue },
    (({ collected, serviceFee, netRevenue }) => ({ collected, serviceFee, netRevenue }))(buildEventFinanceRow(event, proposalRegistrations()))
  );

  assert.deepEqual(finance.totals, [{
    currency: 'BRL', collected: 210, serviceFee: 20, netRevenue: 190, paidCount: 2, pendingCount: 0, eventsCount: 1
  }]);
});

test('pending counts only payment_pending and payment_in_review', () => {
  const finance = buildOwnerFinance([makeEvent()], [
    makeRegistration({ id: 'p1', paymentStatus: 'payment_pending' }),
    makeRegistration({ id: 'p2', paymentStatus: 'payment_in_review' }),
    makeRegistration({ id: 'p3', paymentStatus: 'payment_failed' }),
    makeRegistration({ id: 'p4', paymentStatus: 'payment_cancelled' })
  ]);
  assert.equal(finance.totals[0].pendingCount, 2);
  assert.equal(finance.totals[0].paidCount, 0);
  assert.equal(finance.totals[0].collected, 0);
});

test('currencies never sum together and BRL opens the cards', () => {
  const events = [
    makeEvent({ id: 'evt-eur', currency: 'EUR', organizerId: 'mgr-1' }),
    makeEvent({ id: 'evt-brl', currency: 'BRL', organizerId: 'mgr-1' }),
    makeEvent({ id: 'evt-gbp', currency: 'GBP', organizerId: 'mgr-2' })
  ];
  const registrations = [
    makeRegistration({ id: 'b1', eventId: 'evt-brl', amountCollected: 110 }),
    makeRegistration({ id: 'e1', eventId: 'evt-eur', paymentGateway: 'stripe', serviceFeePayer: undefined, totalPaid: 50, serviceFeeAmount: 5 }),
    makeRegistration({ id: 'g1', eventId: 'evt-gbp', paymentGateway: 'stripe', serviceFeePayer: undefined, totalPaid: 40, serviceFeeAmount: 4 })
  ];
  const finance = buildOwnerFinance(events, registrations);

  assert.deepEqual(finance.totals.map(total => total.currency), ['BRL', 'EUR', 'GBP']);
  assert.deepEqual(finance.totals.map(total => total.collected), [110, 50, 40]);
  assert.equal(pickPrimaryCurrencyTotals(finance.totals).currency, 'BRL');
  assert.equal(pickPrimaryCurrencyTotals(finance.totals.slice(1)).currency, 'EUR');
  assert.equal(pickPrimaryCurrencyTotals([]), null);

  const users = [
    { id: 'owner-1', role: 'owner', name: 'Dono', email: 'dono@exemplo.com' },
    { id: 'mgr-1', role: 'manager', name: 'Gestor Um', email: 'um@exemplo.com', serviceValidUntil: isoDaysFromNow(60) },
    { id: 'mgr-2', role: 'manager', name: 'Gestor Dois', email: 'dois@exemplo.com' },
    { id: 'mgr-3', role: 'manager', name: 'Sem Evento', email: 'tres@exemplo.com', serviceValidUntil: isoDaysFromNow(-1) }
  ];
  const rows = buildOwnerManagerRows(users, finance);
  assert.deepEqual(rows.map(row => row.manager.id), ['mgr-1', 'mgr-2', 'mgr-3'], 'só gestores');

  const [first, second, third] = rows;
  assert.equal(first.eventsCount, 2);
  assert.deepEqual(first.money.map(item => [item.currency, item.collected]), [['BRL', 110], ['EUR', 50]]);
  assert.equal(first.accessStatus, 'active');
  assert.deepEqual(second.money.map(item => item.currency), ['GBP']);
  assert.equal(second.accessStatus, 'unconfigured');
  assert.deepEqual(third.money, []);
  assert.equal(third.accessStatus, 'expired');
});

test('event situation follows the site lifecycle in Portuguese', () => {
  assert.equal(getOwnerEventSituation(makeEvent()), 'open');
  assert.equal(
    getOwnerEventSituation(makeEvent({ status: 'upcoming', startDate: isoDaysFromNow(-10), endDate: isoDaysFromNow(-9) })),
    'finished',
    'evento que passou e ficou salvo como upcoming aparece encerrado'
  );
  assert.equal(getOwnerEventSituation(makeEvent({ startDate: isoDaysFromNow(-1), endDate: isoDaysFromNow(1) })), 'live');
  assert.equal(getOwnerEventSituation(makeEvent({ isTicketingActive: false })), 'sales_closed');
  assert.equal(getOwnerEventSituation(makeEvent(), 'expired'), 'blocked');
  assert.equal(
    getOwnerEventSituation(makeEvent({ registrationDeadline: new Date(Date.now() + 24 * 3_600_000).toISOString() })),
    'closing'
  );
  assert.deepEqual(Object.values(OWNER_EVENT_SITUATION_LABELS), [
    'Em andamento', 'Vendas abertas', 'Vendas acabam em breve', 'Vendas encerradas', 'Vendas bloqueadas', 'Encerrado'
  ]);
});

test('validity dates read as dd/mm/aaaa', () => {
  assert.equal(formatOwnerDate('2026-12-31'), '31/12/2026');
  assert.equal(formatOwnerDate(''), '');
  assert.equal(formatOwnerDate(undefined), '');
  assert.equal(formatOwnerDate('31/12/2026'), '31/12/2026');
});

// Story 1.125: as seções viraram componentes e os números vêm da rota do servidor
// (ownerOverview.ts); as asserções olham o painel inteiro.
const ownerSources = ['../src/app/owner/page.tsx', ...[
  'OwnerOverviewSection', 'OwnerManagersSection', 'OwnerEventsSection', 'OwnerNewManagerForm', 'OwnerShell', 'OwnerRecentSignups'
].map(name => `../src/components/owner/${name}.tsx`)].map(read).join('\n');
const ownerOverviewSource = read('../src/lib/ownerOverview.ts');

test('owner panel reads every number through ownerFinance and formatMoney', () => {
  assert.match(ownerFinanceSource, /buildEventFinanceRow\(event, registrationsByEvent\.get\(event\.id\) \|\| \[\]\)/);
  assert.match(ownerOverviewSource, /buildOwnerFinance\(source\.events, source\.registrations\)/);
  assert.match(ownerOverviewSource, /buildOwnerManagerRows\(users, allTime\)/);
  assert.match(ownerOverviewSource, /getOwnerEventSituation\(event, managerRow\?\.accessStatus, now\)/);
  assert.match(read('../src/components/owner/ownerUi.ts'), /formatMoney\(amount, currency, 'pt-br'\)/);

  // Fórmulas antigas e a coluna fixa saem da tela.
  assert.doesNotMatch(ownerSources, /\.toFixed\(2\)/);
  assert.doesNotMatch(ownerSources, /amountCollected \?\? r\.totalPaid/);
  assert.doesNotMatch(ownerSources, /paymentStatus !== 'payment_approved'/);
  assert.doesNotMatch(ownerSources, /marketplace_fee/);
  assert.doesNotMatch(ownerSources, /Taxa Split/i);
  // Situação pelo ciclo de vida: sem os rótulos em inglês do campo salvo.
  assert.doesNotMatch(ownerSources, />Upcoming</);
  assert.doesNotMatch(ownerSources, />Finished</);
  assert.doesNotMatch(ownerSources, /'Em breve' : 'Encerrado'/);
  assert.doesNotMatch(ownerSources, /\{event\.organizerId\}/);
  assert.doesNotMatch(ownerSources, /<td className="[^"]*\bflex\b/);
});

test('owner ranking opens with the chosen event already loaded', () => {
  // B1: o seletor nascia de events[0] vazio. Desde a 1.125 o ranking abre no
  // detalhe do evento clicado, com o evento completo do contexto.
  const eventsSection = read('../src/components/owner/OwnerEventsSection.tsx');
  assert.match(eventsSection, /const ranking = selected && tab === 'ranking' \? renderRanking\(selected\.id\) : null;/);
  assert.match(ownerPage, /const event = events\.find\(item => item\.id === eventId\);\n\s+return event \? <Leaderboard event=\{event\} \/> : null;/);
});

test('owner panel copy has accents and no jargon', () => {
  for (const term of ['Root Access', 'Desconectar Root', 'Super Admin', 'Senha Mestra', 'Leaderboards', 'para Audit',
    'Nao definido', 'necessario', 'O prazo e opcional', 'operacao', 'Nao foi possivel', 'Notificacao', 'aparecerao']) {
    assert.ok(!ownerSources.includes(term), `texto antigo no /owner: ${term}`);
  }
  assert.match(ownerSources, /formatOwnerDate\(manager\.serviceValidUntil\) \|\| 'Não definido'/);
});
