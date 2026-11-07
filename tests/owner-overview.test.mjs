import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createFakeSupabase } from './support/fakeSupabase.mjs';
import { importServerModule, setActiveSupabaseClient } from './support/serverModuleHarness.mjs';

// Story 1.122 (decisões D3, E2 e E3, docs/design/painel-proprietario/): números do
// /owner somados no servidor com leitura paginada, cadastros recentes com busca e a
// data de cadastro em users (pelo id enquanto a migration não for aplicada).

process.env.SUPABASE_URL = 'http://supabase.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';
process.env.WODA_SESSION_SECRET = 'segredo-de-teste-story-1-122-overview';

let database = createFakeSupabase();
let clientOverride = null;
setActiveSupabaseClient({
  from: (table) => (clientOverride ? clientOverride(table) : database.client.from(table)),
  rpc: (name, args) => database.client.rpc(name, args)
});

const { buildOwnerOverview, resolveOwnerPeriod, readCreatedAtFromId, normalizeOwnerPeriod } = await importServerModule('lib/ownerOverview.ts');
const { GET: getOverview } = await importServerModule('app/api/owner/overview/route.ts');
const { GET: getSignups } = await importServerModule('app/api/owner/signups/route.ts');
const { sanitizeOwnerSearch } = await importServerModule('lib/serverOwnerSignups.ts');
const { createSessionToken } = await importServerModule('lib/serverSecurity.ts');

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase/migrations/20261107120000_users_created_at.sql');
const overviewRoute = read('../src/app/api/owner/overview/route.ts');
const signupsRoute = read('../src/app/api/owner/signups/route.ts');
const serverOverview = read('../src/lib/serverOwnerOverview.ts');

const NOW = new Date('2026-11-07T12:00:00.000Z'); // 09:00 em Fortaleza
const isoDaysFromNow = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

const OWNER = { id: 'owner-1', name: 'Dono', email: 'dono@exemplo.com', role: 'owner' };
const cookieFor = (user) => `woda_session=${createSessionToken(user)}`;
const getWith = (handler, url, user = OWNER) => handler(new Request(url, { headers: user ? { cookie: cookieFor(user) } : {} }));

test('periods compare with the same stretch of the previous period', () => {
  const month = resolveOwnerPeriod('month', NOW);
  assert.equal(month.start, '2026-11-01T03:00:00.000Z');
  assert.equal(month.previousStart, '2026-10-01T03:00:00.000Z');
  assert.equal(month.previousEnd, '2026-10-07T12:00:00.000Z');

  const days = resolveOwnerPeriod('30d', NOW);
  assert.equal(days.start, '2026-10-08T12:00:00.000Z');
  assert.equal(days.previousStart, '2026-09-08T12:00:00.000Z');
  assert.equal(days.previousEnd, days.start);

  const year = resolveOwnerPeriod('year', NOW);
  assert.equal(year.start, '2026-01-01T03:00:00.000Z');
  assert.equal(year.previousStart, '2025-01-01T03:00:00.000Z');
  assert.equal(year.previousEnd, '2025-11-07T12:00:00.000Z');

  const all = resolveOwnerPeriod('all', NOW);
  assert.equal(all.start, null);
  assert.equal(all.previousStart, null);

  assert.equal(normalizeOwnerPeriod('ano'), '30d');
  assert.equal(normalizeOwnerPeriod('year'), 'year');
});

test('signup date comes from the id while users.created_at does not exist', () => {
  assert.equal(readCreatedAtFromId('org-1762516800000'), '2025-11-07T12:00:00.000Z');
  assert.equal(readCreatedAtFromId('ath-user-1762516800000'), '2025-11-07T12:00:00.000Z');
  assert.equal(readCreatedAtFromId('owner-1'), null);
});

const makeEvent = (overrides = {}) => ({
  id: 'evt-1', name: 'Desafio Exemplo', date: '20/12/2099', startDate: isoDaysFromNow(30), endDate: isoDaysFromNow(31),
  timeZone: 'America/Fortaleza', status: 'upcoming', organizerId: 'org-1', divisions: [], isTicketingActive: true,
  currency: 'BRL', logoUrl: '', isFeatured: false, ...overrides
});

const makeRegistration = (overrides = {}) => ({
  id: `reg-${Math.random().toString(36).slice(2)}`, eventId: 'evt-1', quantity: 1, totalPaid: 100, serviceFeeAmount: 10,
  serviceFeePayer: 'athlete', amountCollected: 110, applicationFeeCharged: 0, paymentStatus: 'payment_approved',
  paymentGateway: 'mercadopago', createdAt: '2026-11-03T15:00:00.000Z', ...overrides
});

const baseSource = (overrides = {}) => ({
  events: [makeEvent()],
  registrations: [],
  users: [
    { id: 'owner-1', name: 'Dono', email: 'dono@exemplo.com', role: 'owner', createdAt: null },
    { id: 'org-1', name: 'Gestor Um', email: 'um@exemplo.com', role: 'manager', serviceValidUntil: isoDaysFromNow(120), createdAt: '2026-01-10T12:00:00.000Z' }
  ],
  connectedPaymentUserIds: new Set(['org-1']),
  feePayers: {},
  leads: [],
  ...overrides
});

test('overview totals follow the period by registration date, with the delta of the main currency', () => {
  const source = baseSource({
    events: [makeEvent(), makeEvent({ id: 'evt-eur', currency: 'EUR', name: 'Throwdown Lisboa' })],
    registrations: [
      makeRegistration({ id: 'now-1', createdAt: '2026-11-03T15:00:00.000Z' }),
      makeRegistration({ id: 'now-2', createdAt: '2026-11-06T15:00:00.000Z', serviceFeePayer: 'organizer', amountCollected: 100 }),
      makeRegistration({ id: 'prev-1', createdAt: '2026-10-05T15:00:00.000Z' }),
      // Depois do "mesmo trecho" de outubro: fica fora da comparação do mês.
      makeRegistration({ id: 'prev-out', createdAt: '2026-10-20T15:00:00.000Z' }),
      makeRegistration({ id: 'eur-1', eventId: 'evt-eur', createdAt: '2026-11-04T15:00:00.000Z', totalPaid: 50, serviceFeeAmount: 5, amountCollected: 55 }),
      makeRegistration({ id: 'pend', createdAt: '2026-11-05T15:00:00.000Z', paymentStatus: 'payment_pending' })
    ]
  });

  const overview = buildOwnerOverview(source, { period: 'month', now: NOW });
  const brl = overview.totals.find(total => total.currency === 'BRL');
  assert.deepEqual(
    { collected: brl.collected, serviceFee: brl.serviceFee, netRevenue: brl.netRevenue, paidCount: brl.paidCount, pendingCount: brl.pendingCount },
    { collected: 210, serviceFee: 20, netRevenue: 190, paidCount: 2, pendingCount: 1 }
  );
  assert.deepEqual(overview.totals.map(total => total.currency), ['BRL', 'EUR']);
  assert.equal(overview.previousTotals.find(total => total.currency === 'BRL').serviceFee, 10);
  assert.equal(overview.serviceFeeDelta, 1, '+100% sobre o mesmo trecho de outubro');

  const all = buildOwnerOverview(source, { period: 'all', now: NOW });
  assert.equal(all.totals.find(total => total.currency === 'BRL').paidCount, 4);
  assert.equal(all.serviceFeeDelta, null);
  assert.deepEqual(all.previousTotals, []);

  // Série mensal: 12 meses, o atual parcial, moedas separadas.
  assert.equal(all.monthly.length, 12);
  assert.equal(all.monthly.at(-1).month, '2026-11');
  assert.equal(all.monthly.at(-1).partial, true);
  assert.deepEqual(all.monthly.at(-1).serviceFee, { BRL: 20, EUR: 5 });
  assert.deepEqual(all.monthly.at(-2).serviceFee, { BRL: 20 });
  assert.equal(all.monthly[0].month, '2025-12');
});

test('attention queue lists what needs action, most urgent first', () => {
  // Um relógio só para as datas das análises e o corte de 48 h da rota.
  const now = new Date();
  const staleDate = new Date(now.getTime() - 72 * 3_600_000).toISOString();
  const source = baseSource({
    events: [
      makeEvent({ id: 'evt-blocked', name: 'Copa Sertão', organizerId: 'org-expired' }),
      makeEvent({ id: 'evt-open', name: 'Desafio Litoral', organizerId: 'org-1' }),
      makeEvent({ id: 'evt-done', name: 'Festival Verão', organizerId: 'org-1', isFeatured: true, startDate: isoDaysFromNow(-20), endDate: isoDaysFromNow(-19) })
    ],
    registrations: [
      makeRegistration({ id: 'stale-1', eventId: 'evt-open', paymentStatus: 'payment_in_review', createdAt: staleDate }),
      makeRegistration({ id: 'fresh-review', eventId: 'evt-open', paymentStatus: 'payment_in_review', createdAt: now.toISOString() })
    ],
    users: [
      ...baseSource().users,
      { id: 'org-expired', name: 'Rafael Lima', email: 'r@exemplo.com', role: 'manager', serviceValidUntil: isoDaysFromNow(-3), createdAt: null },
      { id: 'org-soon', name: 'Marina Alves', email: 'm@exemplo.com', role: 'manager', serviceValidUntil: isoDaysFromNow(3), createdAt: null }
    ],
    connectedPaymentUserIds: new Set(['org-1', 'org-expired']),
    leads: [
      { id: 'l1', managerName: 'Thiago', eventName: 'Games', leadStatus: 'new', emailStatus: 'sent', submittedAt: '2026-11-05T10:00:00.000Z' },
      { id: 'l2', managerName: 'Larissa', eventName: 'Copa', leadStatus: 'new', emailStatus: 'failed', submittedAt: '2026-11-04T10:00:00.000Z' }
    ]
  });

  const overview = buildOwnerOverview(source, { period: '30d', now });
  const ids = overview.attention.map(item => item.id);
  assert.deepEqual(ids, ['expired-org-expired', 'expiring-soon', 'stale-reviews', 'featured-off-air', 'new-leads', 'lead-email-failed', 'no-payment-account']);
  assert.equal(overview.attention[0].severity, 'crit');
  assert.equal(overview.attention[0].title, 'Rafael Lima está expirado com evento à venda');
  assert.deepEqual(overview.attention[0].action, { kind: 'manager', managerId: 'org-expired' });
  assert.equal(overview.attention[2].title, '1 pagamento em análise há mais de 48 h');
  assert.equal(overview.attention[4].detail, 'O mais antigo chegou em 04/11/2026.');
  assert.equal(overview.attention[6].title, 'Marina Alves não tem conta de recebimento');

  const blocked = overview.events.find(event => event.id === 'evt-blocked');
  assert.equal(blocked.situation, 'blocked');
  assert.equal(overview.events.at(-1).id, 'evt-done', 'encerrados no fim');
  assert.equal(overview.events.find(event => event.id === 'evt-open').staleReviewCount, 1);
  assert.equal(overview.counts.eventsForSale, 1);
  assert.equal(overview.counts.newLeads, 2);
});

test('featured event with sales closed but still on the carousel is not flagged', () => {
  // CodeRabbit (Story 1.126): a fila usa a mesma regra do carrossel da home.
  const source = baseSource({ events: [makeEvent({ id: 'evt-closed', isFeatured: true, isTicketingActive: false })] });
  const overview = buildOwnerOverview(source, { period: '30d', now: new Date() });
  assert.equal(overview.events[0].situation, 'sales_closed');
  assert.ok(!overview.attention.some(item => item.id === 'featured-off-air'));

  const ended = buildOwnerOverview(baseSource({
    events: [makeEvent({ id: 'evt-ended', isFeatured: true, startDate: isoDaysFromNow(-10), endDate: isoDaysFromNow(-9) })]
  }), { period: '30d', now: new Date() });
  assert.ok(ended.attention.some(item => item.id === 'featured-off-air'));
});

test('recent signups list managers from the newest', () => {
  const source = baseSource({
    users: [
      ...baseSource().users,
      { id: 'org-new', name: 'Gestor Novo', email: 'novo@exemplo.com', role: 'manager', createdAt: '2026-11-06T12:00:00.000Z' },
      { id: 'org-undated', name: 'Sem Data', email: 'sd@exemplo.com', role: 'manager', createdAt: null }
    ]
  });
  const overview = buildOwnerOverview(source, { period: '30d', now: NOW });
  assert.deepEqual(overview.recentSignups.map(item => item.id), ['org-new', 'org-1']);
});

const seedPlatform = () => {
  const users = [OWNER];
  for (let index = 0; index < 1500; index += 1) {
    users.push({ id: `ath-user-${1760000000000 + index}`, name: `Atleta ${index}`, email: `atleta${index}@exemplo.com`, role: 'athlete' });
  }
  users.push({ id: 'org-1762430400000', name: 'Gestor Recente', email: 'recente@exemplo.com', role: 'manager', organization: 'Box Novo', service_valid_until: isoDaysFromNow(90) });
  const registrations = [];
  for (let index = 0; index < 1250; index += 1) {
    registrations.push({
      id: `reg-${String(index).padStart(5, '0')}`, event_id: 'evt-1', division_id: 'div-1', athlete_id: `ath-${index}`,
      athlete_name: `Atleta ${index}`, athlete_email: `atleta${index}@exemplo.com`, quantity: 1, total_paid: 100,
      service_fee_amount: 10, service_fee_payer: 'athlete', amount_collected: 110, application_fee_charged: 10,
      payment_status: 'payment_approved', payment_gateway: 'mercadopago',
      created_at: new Date(Date.parse('2026-10-01T00:00:00.000Z') + index * 60_000).toISOString()
    });
  }
  return createFakeSupabase({
    events: [{
      id: 'evt-1', name: 'Desafio Exemplo', status: 'upcoming', date: '20/12/2099', start_date: isoDaysFromNow(30), end_date: isoDaysFromNow(31),
      organizer_id: 'org-1762430400000', currency: 'BRL', time_zone: 'America/Fortaleza', is_ticketing_active: true, is_featured: false, logo_url: ''
    }],
    divisions: [{ id: 'div-1', event_id: 'evt-1', slots_limit: 2000, is_active: true }],
    registrations,
    users,
    mercadopago_accounts: [{ user_id: 'org-1762430400000', status: 'connected' }],
    stripe_accounts: [],
    manager_payment_settings: [{ user_id: 'org-1762430400000', service_fee_payer: 'athlete' }],
    commercial_leads: [{ id: 'lead-1', manager_name: 'Thiago Lead', event_name: 'Games', phone: '85999990101', lead_status: 'new', owner_email_notification_status: 'sent', submitted_at: '2026-11-05T10:00:00.000Z' }]
  }, { maxRows: 1000 });
};

test('overview route is owner-only, reads every page and computes on the server', async () => {
  database = seedPlatform();
  clientOverride = null;

  assert.equal((await getWith(getOverview, 'http://localhost/api/owner/overview', null)).status, 401);
  assert.equal((await getWith(getOverview, 'http://localhost/api/owner/overview', { id: 'org-1762430400000', name: 'G', email: 'g@exemplo.com', role: 'manager' })).status, 403);

  const response = await getWith(getOverview, 'http://localhost/api/owner/overview?period=all');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();

  const brl = body.totals.find(total => total.currency === 'BRL');
  assert.equal(brl.paidCount, 1250, 'inscrições acima de 1.000 entram inteiras');
  assert.equal(brl.serviceFee, 12500);
  assert.equal(body.managers.length, 1, 'contas de atleta não entram');
  assert.equal(body.managers[0].name, 'Gestor Recente');
  assert.equal(body.managers[0].hasPaymentAccount, true);
  assert.equal(body.managers[0].feePayer, 'athlete');
  assert.equal(body.managers[0].createdAt, '2025-11-06T12:00:00.000Z', 'data do id enquanto a coluna não existe');
  assert.equal(body.events[0].managerName, 'Gestor Recente');
  assert.equal(body.recentSignups[0].id, 'org-1762430400000');
  assert.equal(body.period.key, 'all');
});

test('overview route falls back to the id date when users.created_at is missing', async () => {
  database = seedPlatform();
  // Simula o banco sem a migration: o select com created_at devolve 42703.
  clientOverride = (table) => {
    const query = database.client.from(table);
    if (table !== 'users') return query;
    const originalSelect = query.select.bind(query);
    query.select = (columns, options) => {
      if (String(columns).includes('created_at')) {
        return { range: async () => ({ data: null, error: { code: '42703', message: 'column users.created_at does not exist' } }) };
      }
      return originalSelect(columns, options);
    };
    return query;
  };

  const response = await getWith(getOverview, 'http://localhost/api/owner/overview?period=30d');
  clientOverride = null;
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.managers[0].createdAt, '2025-11-06T12:00:00.000Z');
});

test('signups route merges managers, athlete accounts, registrations and leads with search and cursor', async () => {
  database = seedPlatform();
  clientOverride = null;

  assert.equal((await getWith(getSignups, 'http://localhost/api/owner/signups', null)).status, 401);

  const first = await (await getWith(getSignups, 'http://localhost/api/owner/signups?limit=5')).json();
  assert.equal(first.items.length, 5);
  const dates = first.items.map(item => Date.parse(item.createdAt));
  assert.deepEqual(dates, [...dates].sort((a, b) => b - a), 'do mais novo para o mais antigo');
  // O lead de 05/11 é o mais novo; depois vêm as inscrições, com o nome do evento.
  assert.equal(first.items[0].kind, 'lead');
  assert.equal(first.items[1].kind, 'registration');
  assert.equal(first.items[1].detail, 'Desafio Exemplo');
  assert.ok(first.nextBefore);

  const second = await (await getWith(getSignups, `http://localhost/api/owner/signups?limit=5&before=${encodeURIComponent(first.nextBefore)}`)).json();
  assert.ok(second.items.every(item => item.createdAt < first.nextBefore));
  assert.equal(new Set([...first.items, ...second.items].map(item => `${item.kind}:${item.id}`)).size, 10, 'sem repetição entre páginas');

  const manager = await (await getWith(getSignups, 'http://localhost/api/owner/signups?q=recente&kind=manager')).json();
  assert.deepEqual(manager.items.map(item => [item.kind, item.name, item.detail]), [['manager', 'Gestor Recente', 'Box Novo']]);
  assert.equal(manager.nextBefore, null);

  const byEmail = await (await getWith(getSignups, 'http://localhost/api/owner/signups?q=atleta1499%40exemplo.com&kind=athlete_account')).json();
  assert.deepEqual(byEmail.items.map(item => item.id), ['ath-user-1760000001499']);

  const leads = await (await getWith(getSignups, 'http://localhost/api/owner/signups?kind=lead')).json();
  assert.deepEqual(leads.items.map(item => [item.kind, item.name, item.contact]), [['lead', 'Thiago Lead', '85999990101']]);
});

test('search text never carries PostgREST filter syntax', () => {
  assert.equal(sanitizeOwnerSearch('joão,name.eq.x)(*"'), 'joão name.eq.x');
  assert.equal(sanitizeOwnerSearch('  ana@box.com  '), 'ana@box.com');
  assert.equal(sanitizeOwnerSearch('x'.repeat(200)).length, 80);
});

test('users.created_at migration backfills from the id and defaults to now', () => {
  assert.match(migration, /ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;/);
  assert.match(migration, /SET created_at = to_timestamp\(substring\(id from '\(\[0-9\]\{13\}\)\$'\)::bigint \/ 1000\.0\)/);
  assert.match(migration, /WHERE created_at IS NULL/);
  assert.match(migration, /ALTER TABLE users ALTER COLUMN created_at SET DEFAULT NOW\(\);/);
  assert.doesNotMatch(migration, /DROP|DELETE|NOT NULL/);
});

test('owner routes stay read-only and owner-only', () => {
  for (const source of [overviewRoute, signupsRoute]) {
    assert.match(source, /requireSession\(request, \['owner'\]\)/);
    assert.doesNotMatch(source, /\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
  }
  assert.doesNotMatch(serverOverview, /\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
  assert.match(serverOverview, /readBootstrapPages\('inscrições do painel do proprietário'/);
});
