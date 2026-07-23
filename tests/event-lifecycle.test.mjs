import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const eventStatus = read('../src/lib/eventStatus.ts');
const eventCard = read('../src/components/EventCard.tsx');
const homePage = read('../src/app/page.tsx');
const featuredBanner = read('../src/components/home/FeaturedEventBanner.tsx');
const eventPage = read('../src/app/event/[id]/page.tsx');
const serverCheckout = read('../src/lib/serverCheckout.ts');
const registrationStart = read('../src/app/api/registrations/start/route.ts');
const pixCheckout = read('../src/app/api/checkout/pix/route.ts');
const cardCheckout = read('../src/app/api/checkout/card/route.ts');
const preferenceCheckout = read('../src/app/api/checkout/preference/route.ts');
const checkoutStatus = read('../src/app/api/checkout/status/route.ts');
const paymentWebhook = read('../src/app/api/webhooks/mercadopago/route.ts');
const eventStatusModule = await import(`data:text/javascript;base64,${Buffer.from(
  ts.transpileModule(eventStatus, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText,
).toString('base64')}`);

const formatDate = (date) => date.toLocaleDateString('pt-BR');

test('event lifecycle derives finished state from manual status, deadline and event date', () => {
  assert.match(eventStatus, /export function getEventStatus\(event: Pick<Event, 'status' \| 'date' \| 'registrationDeadline'>\)/);
  assert.match(eventStatus, /if \(event\.status === 'finished'\) return 'finished';/);
  assert.match(eventStatus, /if \(hasEventDatePassed\(event\.date\)\) return 'finished';/);
  assert.match(eventStatus, /if \(!Number\.isNaN\(hoursUntilDeadline\) && hoursUntilDeadline < 0\) return 'finished';/);
  assert.match(eventStatus, /hoursUntilDeadline <= CLOSING_THRESHOLD_HOURS/);
});

test('event lifecycle classifies past, future, invalid and current-day dates correctly', () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);

  assert.equal(eventStatusModule.getEventStatus({ status: 'upcoming', date: formatDate(yesterday) }), 'finished');
  assert.equal(eventStatusModule.getEventStatus({ status: 'upcoming', date: formatDate(today) }), 'active');
  assert.equal(eventStatusModule.getEventStatus({ status: 'upcoming', date: formatDate(tomorrow) }), 'active');
  assert.equal(eventStatusModule.getEventStatus({ status: 'upcoming', date: formatDate(nextWeek), registrationDeadline: new Date(Date.now() - 1_000).toISOString() }), 'finished');
  assert.equal(eventStatusModule.getEventStatus({ status: 'upcoming', date: 'data indefinida' }), 'active');
  assert.equal(eventStatusModule.getEventStatus({ status: 'finished', date: formatDate(tomorrow) }), 'finished');
});

test('event date parsing accepts supported formats without treating invalid dates as past', () => {
  assert.match(eventStatus, /export function parseEventDate\(dateText\?: string\): Date \| null/);
  assert.match(eventStatus, /const isoMatch = normalized\.match/);
  assert.match(eventStatus, /const slashMatch = normalized\.match/);
  assert.match(eventStatus, /if \(!eventDate\) return false;/);
  assert.match(eventStatus, /eventDate\.getDate\(\) \+ 1/);
});

test('public surfaces consistently hide registration for derived finished events', () => {
  assert.match(eventCard, /const registrationAvailability = getRegistrationAvailability\(event\)/);
  assert.match(eventCard, /!registrationAvailability\.isAvailable/);
  assert.match(eventCard, /Evento Encerrado/);
  assert.match(eventCard, /Este evento não está mais disponível para inscrição\./);
  assert.match(homePage, /statusFilter === 'finished' && lifecycle === 'finished'/);
  assert.match(homePage, /statusFilter === 'upcoming' && event\.status === 'upcoming' && lifecycle !== 'finished'/);
  assert.match(featuredBanner, /getEventStatus\(event\) !== 'finished'/);
  assert.match(eventPage, /const registrationsAvailable = event\.status === 'upcoming'/);
  assert.match(eventPage, /disabled=\{!registrationsAvailable\}/);
});

test('server rejects registrations for derived finished events before persistence', () => {
  assert.match(serverCheckout, /select\('id, name, status, date, registration_deadline, ticket_price, ticket_slots, is_ticketing_active'\)/);
  assert.match(serverCheckout, /throw new RegistrationAccessError\('Este evento esta encerrado e nao aceita novas inscricoes\.', 409\)/);
  assert.match(registrationStart, /RegistrationAccessError/);
  assert.match(registrationStart, /status: err\.status/);
});

test('manual ticketing closure has one public signal and blocks only new checkout starts', () => {
  assert.deepEqual(
    eventStatusModule.getRegistrationAvailability({
      status: 'upcoming',
      date: formatDate(new Date(Date.now() + 86_400_000)),
      isTicketingActive: false,
    }),
    { isAvailable: false, lifecycle: 'active', reason: 'sales_closed' },
  );
  assert.match(eventCard, /getRegistrationAvailability\(event\)/);
  assert.match(eventCard, /Vendas Encerradas/);
  assert.match(featuredBanner, /const registrationAvailability = getRegistrationAvailability\(featuredEvent\)/);
  assert.match(featuredBanner, /Vendas encerradas/);
  assert.match(eventPage, /const registrationAvailability = getRegistrationAvailability\(event\)/);
  assert.match(eventPage, /Vendas Encerradas/);
  assert.match(serverCheckout, /export const assertEventRegistrationAvailable/);
  for (const checkoutRoute of [pixCheckout, cardCheckout, preferenceCheckout]) {
    assert.match(checkoutRoute, /assertEventRegistrationAvailable\(supabaseAdmin, checkoutSnapshot\.eventId\)/);
  }
  assert.doesNotMatch(checkoutStatus, /assertEventRegistrationAvailable/);
  assert.doesNotMatch(paymentWebhook, /assertEventRegistrationAvailable/);
});
