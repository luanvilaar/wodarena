import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createFakeSupabase } from './support/fakeSupabase.mjs';
import { importServerModule, setActiveSupabaseClient } from './support/serverModuleHarness.mjs';

// Stories 1.71 e 1.72: datas estruturadas do evento (start_date/end_date), a
// regra de "já aconteceu" no fuso do evento e os três estados do card.

process.env.SUPABASE_URL = 'http://supabase.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';
process.env.WODA_SESSION_SECRET = 'segredo-de-teste-story-1-71-datas';

let database = createFakeSupabase();
setActiveSupabaseClient({
  from: (table) => database.client.from(table),
  rpc: (name, args) => database.client.rpc(name, args)
});

const eventStatus = await importServerModule('lib/eventStatus.ts');
const eventDates = await importServerModule('lib/eventDates.ts');
const { selectEventWithDates, toEventLifecycleInput } = await importServerModule('lib/serverEventLifecycle.ts');
const { readEventsWithFeaturedFallback, PUBLIC_EVENT_SELECT, PUBLIC_EVENT_SELECT_WITHOUT_DATES } = await importServerModule('lib/bootstrapPayload.ts');
const { POST: postPersistence } = await importServerModule('app/api/admin/persistence/route.ts');
const { createSessionToken } = await importServerModule('lib/serverSecurity.ts');

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase/migrations/20261026120000_event_dates.sql');
const appContext = read('../src/context/AppContext.tsx');
const adminPage = read('../src/app/admin/page.tsx');
const eventCard = read('../src/components/EventCard.tsx');
const messages = Object.fromEntries(['pt-br', 'pt-pt', 'en-gb'].map((locale) => [
  locale,
  JSON.parse(read(`../src/messages/${locale}.json`))
]));

// 26/10/2026 às 12:00 em Fortaleza (UTC-3).
const NOW = new Date('2026-10-26T15:00:00Z');

test('hasEventEnded: com datas, o evento termina na meia-noite seguinte ao último dia, no fuso do evento', () => {
  const event = { date: '17 e 18 de outubro', startDate: '2026-10-17', endDate: '2026-10-18', timeZone: 'America/Fortaleza' };
  assert.equal(eventStatus.hasEventEnded(event, new Date('2026-10-19T02:59:00Z')), false, '18/10 23:59 em Fortaleza');
  assert.equal(eventStatus.hasEventEnded(event, new Date('2026-10-19T03:00:00Z')), true, '19/10 00:00 em Fortaleza');
  // Mesmo instante, outro fuso: em Lisboa já é 19/10.
  assert.equal(eventStatus.hasEventEnded({ ...event, timeZone: 'Europe/Lisbon' }, new Date('2026-10-19T02:59:00Z')), true);
  // Fuso inválido cai no padrão da plataforma em vez de quebrar.
  assert.equal(eventStatus.hasEventEnded({ ...event, timeZone: 'Fuso/Inexistente' }, new Date('2026-10-19T02:59:00Z')), false);
});

test('os três eventos sem ano no texto viram realizados com as datas; sem datas, segue a leitura antiga', () => {
  const cases = [
    { date: '17 e 18 de outubro', startDate: '2026-10-17', endDate: '2026-10-18' },
    { date: '17 E 18 DE OUTUBRO', startDate: '2026-10-17', endDate: '2026-10-18' },
    { date: '05 a 20 de Outubro ', startDate: '2026-10-05', endDate: '2026-10-20' }
  ];
  for (const event of cases) {
    assert.equal(eventStatus.hasEventEnded(event, NOW), true, event.date);
    assert.equal(eventStatus.hasEventEnded({ date: event.date }, NOW), false, `${event.date} sem datas: texto ilegível não conta como passado`);
  }
  // Sem datas, o texto com ano continua valendo.
  assert.equal(eventStatus.hasEventEnded({ date: '10/10/2026' }, NOW), true);
  assert.equal(eventStatus.hasEventEnded({ date: '14/11/2026' }, NOW), false);
});

test('getEventStatus e getRegistrationAvailability: datas decidem o fim; prazo vencido só fecha a inscrição', () => {
  const past = { status: 'upcoming', date: '17 e 18 de outubro', startDate: '2020-10-17', endDate: '2020-10-18', isTicketingActive: true };
  assert.equal(eventStatus.getEventStatus(past), 'finished');
  assert.deepEqual(eventStatus.getRegistrationAvailability(past), { isAvailable: false, lifecycle: 'finished', reason: 'event_finished' });

  const future = { status: 'upcoming', date: 'texto qualquer', startDate: '2099-11-14', endDate: '2099-11-14', isTicketingActive: true };
  assert.equal(eventStatus.getEventStatus(future), 'active');
  assert.deepEqual(eventStatus.getRegistrationAvailability(future), { isAvailable: true, lifecycle: 'active', reason: null });

  const salesClosed = { ...future, isTicketingActive: false };
  assert.deepEqual(eventStatus.getRegistrationAvailability(salesClosed), { isAvailable: false, lifecycle: 'active', reason: 'sales_closed' });

  const deadlinePassed = { ...future, registrationDeadline: new Date(Date.now() - 60_000).toISOString() };
  assert.equal(eventStatus.getEventStatus(deadlinePassed), 'active', 'prazo vencido não transforma o evento em realizado');
  assert.deepEqual(eventStatus.getRegistrationAvailability(deadlinePassed), { isAvailable: false, lifecycle: 'active', reason: 'sales_closed' });

  const deadlineSoon = { ...future, registrationDeadline: new Date(Date.now() + 3_600_000).toISOString() };
  assert.equal(eventStatus.getEventStatus(deadlineSoon), 'closing');
});

test('getEventTiming conta dias de calendário no fuso do evento', () => {
  const at = (startDate, endDate) => eventStatus.getEventTiming({ startDate, endDate, timeZone: 'America/Fortaleza' }, NOW);
  assert.deepEqual(at('2026-10-31', '2026-10-31'), { kind: 'upcoming', days: 5 });
  assert.deepEqual(at('2026-10-27', '2026-10-27'), { kind: 'upcoming', days: 1 });
  assert.deepEqual(at('2026-10-26', '2026-10-26'), { kind: 'today' });
  assert.deepEqual(at('2026-10-25', '2026-10-27'), { kind: 'ongoing' });
  assert.deepEqual(at('2026-10-17', '2026-10-18'), { kind: 'ended', days: 8 });
  assert.deepEqual(at('2026-10-25', '2026-10-25'), { kind: 'ended', days: 1 });
  assert.equal(eventStatus.getEventTiming({}, NOW), null, 'sem datas, sem marcador');
  // Um só lado preenchido vale para os dois.
  assert.deepEqual(eventStatus.getEventDateRange({ startDate: '2026-11-14' }), { start: '2026-11-14', end: '2026-11-14' });
  assert.equal(eventStatus.getEventDateRange({ startDate: '2026-02-30', endDate: 'ontem' }), null);
});

test('a ordem cronológica usa start_date e põe o evento sem data legível no fim', () => {
  const events = [
    { name: 'Sem data', date: 'a definir' },
    { name: 'Hero Games', date: '07 e 08 de Novembro', startDate: '2026-11-07', endDate: '2026-11-08' },
    { name: 'Simulado', date: '31/10/2026' },
    { name: 'WOD BASE', date: '20 e 21 de Novembro', startDate: '2026-11-20', endDate: '2026-11-21' }
  ];
  assert.deepEqual(
    [...events].sort(eventStatus.compareEventsByDateAsc).map((event) => event.name),
    ['Simulado', 'Hero Games', 'WOD BASE', 'Sem data']
  );

  // Passados: quem terminou por último vem primeiro, mesmo tendo começado antes.
  const past = [
    { name: 'Simulado Haus', date: '10/10/2026', startDate: '2026-10-10', endDate: '2026-10-10' },
    { name: 'Qualifier SELVA', date: '05 a 20 de Outubro', startDate: '2026-10-05', endDate: '2026-10-20' },
    { name: 'X-Games', date: '17 e 18 de outubro', startDate: '2026-10-17', endDate: '2026-10-18' }
  ];
  assert.deepEqual(
    [...past].sort(eventStatus.compareEventsByDateDesc).map((event) => event.name),
    ['Qualifier SELVA', 'X-Games', 'Simulado Haus']
  );
});

test('formatEventDateRange escreve a data curta do card no idioma da página', () => {
  assert.equal(eventDates.formatEventDateRange('2026-10-31', '2026-10-31', 'pt-br'), 'sáb, 31 out 2026');
  assert.equal(eventDates.formatEventDateRange('2026-10-17', '2026-10-18', 'pt-br'), '17–18 out 2026');
  assert.equal(eventDates.formatEventDateRange('2026-10-30', '2026-11-01', 'pt-br'), '30 out – 1 nov 2026');
  assert.equal(eventDates.formatEventDateRange('2026-12-30', '2027-01-02', 'pt-br'), '30 dez 2026 – 2 jan 2027');
  assert.equal(eventDates.formatEventDateRange('2026-10-17', '2026-10-18', 'en-gb'), '17–18 Oct 2026');
  assert.equal(eventDates.formatEventDateRange('2026-10-31', '2026-10-31', 'pt-br', { withWeekday: false }), '31 out 2026');
  assert.equal(eventDates.formatEventDateRange('2026-02-30', '2026-03-01', 'pt-br'), '');
});

test('buildEventDateLabel e resolveEventDateForm montam o texto e validam o formulário do painel', () => {
  assert.equal(eventDates.buildEventDateLabel('2026-10-31', '2026-10-31'), '31 de outubro de 2026');
  assert.equal(eventDates.buildEventDateLabel('2026-10-17', '2026-10-18'), '17 e 18 de outubro de 2026');
  assert.equal(eventDates.buildEventDateLabel('2026-10-05', '2026-10-20'), '5 a 20 de outubro de 2026');
  assert.equal(eventDates.buildEventDateLabel('2026-10-30', '2026-11-01'), '30 de outubro a 1 de novembro de 2026');
  assert.equal(eventDates.buildEventDateLabel('2026-12-30', '2027-01-02'), '30 de dezembro de 2026 a 2 de janeiro de 2027');

  assert.deepEqual(
    eventDates.resolveEventDateForm({ startDate: '2026-10-17', endDate: '', label: '' }),
    { ok: true, startDate: '2026-10-17', endDate: '2026-10-17', label: '17 de outubro de 2026' }
  );
  assert.deepEqual(
    eventDates.resolveEventDateForm({ startDate: '2026-10-17', endDate: '2026-10-18', label: '  17 E 18 DE OUTUBRO ' }),
    { ok: true, startDate: '2026-10-17', endDate: '2026-10-18', label: '17 E 18 DE OUTUBRO' }
  );
  assert.equal(eventDates.resolveEventDateForm({ startDate: '', endDate: '', label: 'x' }).ok, false);
  assert.match(eventDates.resolveEventDateForm({ startDate: '2026-10-18', endDate: '2026-10-17', label: '' }).error, /término não pode ser antes/);
});

const MANAGER = { id: 'mgr-datas', name: 'Gestora Datas', email: 'datas@example.com', role: 'manager', service_valid_until: '2099-12-31' };

const newEventRow = (overrides = {}) => ({
  id: 'evt-datas',
  name: 'Evento com datas',
  logo_url: '',
  banner_url: '',
  status: 'upcoming',
  location: 'Arena',
  date: '17 e 18 de outubro de 2026',
  description: '',
  organizer_id: MANAGER.id,
  sponsors: [],
  format: 'individual',
  ticket_price: 150,
  ticket_slots: 100,
  is_ticketing_active: true,
  event_type: 'functional_fitness',
  event_schedule: [],
  ...overrides
});

const persist = async (action, payload) => {
  const response = await postPersistence(new Request('http://localhost/api/admin/persistence', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `woda_session=${createSessionToken({ id: MANAGER.id, name: MANAGER.name, email: MANAGER.email, role: MANAGER.role })}`
    },
    body: JSON.stringify({ action, payload })
  }));
  return { status: response.status, body: await response.json() };
};

const quietConsole = (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'info', () => {});
};

test('persistência grava start_date/end_date válidos e recusa datas soltas ou invertidas', async (t) => {
  quietConsole(t);
  database = createFakeSupabase({ users: [MANAGER], events: [] });

  assert.deepEqual(await persist('createEvent', { event: newEventRow({ start_date: '2026-10-17', end_date: '2026-10-18' }) }), { status: 200, body: { success: true } });
  const saved = database.rows('events').find((row) => row.id === 'evt-datas');
  assert.equal(saved.start_date, '2026-10-17');
  assert.equal(saved.end_date, '2026-10-18');

  for (const [dates, message] of [
    [{ start_date: '2026-10-17' }, /início e a de término/],
    [{ start_date: '2026-10-18', end_date: '2026-10-17' }, /não pode ser antes/],
    [{ start_date: '17/10/2026', end_date: '18/10/2026' }, /início e a de término/]
  ]) {
    const created = await persist('createEvent', { event: newEventRow({ id: `evt-${Math.random()}`, ...dates }) });
    assert.equal(created.status, 400, JSON.stringify(dates));
    assert.match(created.body.error, message);

    const updated = await persist('updateEvent', { eventId: 'evt-datas', data: dates });
    assert.equal(updated.status, 400, JSON.stringify(dates));
  }

  assert.equal((await persist('updateEvent', { eventId: 'evt-datas', data: { start_date: '2026-11-07', end_date: '2026-11-08' } })).status, 200);
  const updated = database.rows('events').find((row) => row.id === 'evt-datas');
  assert.equal(updated.start_date, '2026-11-07');
  assert.equal(updated.end_date, '2026-11-08');
});

test('bootstrap: sem as colunas de data, refaz o select completo sem elas e mantém destaque e mapa', async (t) => {
  quietConsole(t);
  assert.equal(PUBLIC_EVENT_SELECT, `${PUBLIC_EVENT_SELECT_WITHOUT_DATES}, start_date, end_date`);

  const selects = [];
  const rows = await readEventsWithFeaturedFallback(
    'eventos de teste',
    async (select) => {
      selects.push(select);
      return /start_date/.test(select)
        ? { data: null, error: { code: '42703', message: 'column events.start_date does not exist' } }
        : { data: [{ id: 'evt-1', is_featured: true, latitude: -7.1 }], error: null };
    },
    async () => { throw new Error('não deveria cair no legado'); }
  );
  assert.deepEqual(selects, [PUBLIC_EVENT_SELECT, PUBLIC_EVENT_SELECT_WITHOUT_DATES]);
  assert.deepEqual(rows, [{ id: 'evt-1', is_featured: true, latitude: -7.1 }]);
});

test('selectEventWithDates lê as datas e, sem a migration, lê sem elas', async (t) => {
  quietConsole(t);
  const calls = [];
  const fakeClient = (failDates) => ({
    from: () => ({
      select: (columns) => ({
        eq: () => ({
          maybeSingle: async () => {
            calls.push(columns);
            if (failDates && /start_date/.test(columns)) {
              return { data: null, error: { code: 'PGRST204', message: "Could not find the 'start_date' column of 'events'" } };
            }
            return { data: { id: 'evt-1', status: 'upcoming', date: '17 e 18 de outubro' }, error: null };
          }
        })
      })
    })
  });

  await selectEventWithDates(fakeClient(false), 'evt-1', 'id, status, date');
  assert.deepEqual(calls, ['id, status, date, start_date, end_date']);

  calls.length = 0;
  const { data, error } = await selectEventWithDates(fakeClient(true), 'evt-1', 'id, status, date');
  assert.deepEqual(calls, ['id, status, date, start_date, end_date', 'id, status, date']);
  assert.equal(error, null);
  assert.equal(data.id, 'evt-1');

  assert.deepEqual(
    toEventLifecycleInput({ status: 'upcoming', date: 'x', registration_deadline: null, is_ticketing_active: null, start_date: '2026-10-17', end_date: '2026-10-18', time_zone: 'America/Fortaleza' }),
    { status: 'upcoming', date: 'x', registrationDeadline: undefined, isTicketingActive: true, startDate: '2026-10-17', endDate: '2026-10-18', timeZone: 'America/Fortaleza' }
  );
});

test('migration: colunas DATE, CHECK de intervalo e preenchimento sem sobrescrever ajuste do gestor', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS start_date DATE,\s*ADD COLUMN IF NOT EXISTS end_date DATE;/);
  assert.match(migration, /conname = 'events_date_range_check'/);
  assert.match(migration, /\(start_date IS NULL AND end_date IS NULL\)\s*OR \(start_date IS NOT NULL AND end_date IS NOT NULL AND end_date >= start_date\)/);
  assert.match(migration, /WHERE e\.id = v\.id\s*AND e\.start_date IS NULL;/);
  // Os três eventos que estavam "abertos" depois de acontecer.
  assert.match(migration, /'evt-org-1788227050436-x-games-2-0-mti0pt4w-k4ujvn', '2026-10-17', '2026-10-18'/);
  assert.match(migration, /'evt-org-1789233456519-cn-games-26-provins-ground-mu1la0r9-qop2rv', '2026-10-17', '2026-10-18'/);
  assert.match(migration, /'evt-org-1787075957072-qualifier-selva-2027-msyzn6mf-7u3ivc', '2026-10-05', '2026-10-20'/);
  assert.equal((migration.match(/^\s*\('evt-[^']+', '\d{4}-\d{2}-\d{2}', '\d{4}-\d{2}-\d{2}'\)/gm) || []).length, 22);
  // Fora dos comentários (o rollback documentado), nada destrutivo.
  const statements = migration.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
  assert.doesNotMatch(statements, /DROP|DELETE|TRUNCATE|DISABLE ROW LEVEL SECURITY/i);
});

test('AppContext e painel: datas mapeadas, enviadas juntas e formulário com início e término', () => {
  assert.match(appContext, /startDate: evt\.start_date \|\| undefined,\s*endDate: evt\.end_date \|\| undefined,/);
  assert.match(appContext, /dbPayload\.start_date = updatedData\.startDate \|\| null;\s*dbPayload\.end_date = updatedData\.endDate \|\| null;/);
  assert.match(appContext, /\{ start_date: newEvent\.startDate, end_date: newEvent\.endDate \}/);

  for (const id of ['event-start-date', 'event-end-date', 'edit-event-start-date', 'edit-event-end-date']) {
    assert.match(adminPage, new RegExp(`id="${id}"\\s*(name="${id}"\\s*)?type="date"\\s*required`), id);
  }
  assert.match(adminPage, /resolveEventDateForm\(\{ startDate: eventStartDate, endDate: eventEndDate, label: eventDate \}\)/);
  assert.match(adminPage, /resolveEventDateForm\(\{ startDate: editEventStartDate, endDate: editEventEndDate, label: editEventDate \}\)/);
  assert.match(adminPage, /Texto da data/);
  // Texto gerado das datas antigas é limpo quando as datas mudam; texto digitado fica.
  assert.match(adminPage, /if \(editEventDate\.trim\(\) === generated\) setEditEventDate\(''\);/);
  assert.equal((adminPage.match(/clearGeneratedEditEventDateLabel\(\);/g) || []).length, 2);
});

test('card: três estados com textos nos três idiomas', () => {
  const keys = [
    'registrationClosedBadge', 'realizedBadge', 'upcomingClosedAux', 'upcomingDeadlineAux', 'realizedAux',
    'timingToday', 'timingTomorrow', 'timingInDays', 'timingOngoing', 'timingYesterday', 'timingDaysAgo',
    'viewSchedule', 'viewResults'
  ];
  for (const [locale, json] of Object.entries(messages)) {
    for (const key of keys) assert.ok(json.EventCard[key], `${locale}: EventCard.${key}`);
    for (const removed of ['salesClosedBadge', 'eventEndedBadge', 'finishedAux', 'salesClosedButton']) {
      assert.equal(json.EventCard[removed], undefined, `${locale}: EventCard.${removed} saiu`);
    }
  }
  assert.equal(messages['pt-br'].EventCard.upcomingClosedAux, 'Evento confirmado. Inscrições online encerradas pelo organizador.');

  // Realizado: sem preço, sem divisões, botão de resultados; inscrição encerrada: "Ver programação".
  assert.match(eventCard, /\{priceLabel && !isPast && \(/);
  assert.match(eventCard, /const showDivisions = divisionCount > 0 && isRegistrationAvailable;/);
  assert.match(eventCard, /\{showDivisions && \(/);
  assert.match(eventCard, /href=\{isPast \? `\/event\/\$\{event\.id\}\/leaderboard` : `\/event\/\$\{event\.id\}`\}/);
  assert.match(eventCard, /\{isPast \? t\('viewResults'\) : t\('viewSchedule'\)\}/);
  assert.doesNotMatch(eventCard, /opacity-70 grayscale-\[30%\]/, 'o card inteiro não fica mais apagado');
  assert.match(eventCard, /const dateLabel = dateRange \? formatEventDateRange\(dateRange\.start, dateRange\.end, locale\) : event\.date;/);
});
