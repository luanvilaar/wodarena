import type { Event, EventCurrency, Registration, User } from '@/types';
import { buildEventFinanceRow, type EventFinanceRow } from '@/lib/managerFinance';
import { getEventTiming, getRegistrationAvailability } from '@/lib/eventStatus';
import { getManagerAccessStatus, isManagerAccessBlocked, type ManagerAccessStatus } from '@/lib/managerAccess';

// Números do painel do proprietário (/owner). Toda conta de dinheiro passa por
// `buildEventFinanceRow` (managerFinance.ts), a mesma regra do painel do gestor:
// para o mesmo evento, proprietário e gestor leem o mesmo pago, a mesma taxa e o
// mesmo repasse. Moedas nunca somam juntas (Story 1.120,
// docs/design/painel-proprietario/).

/** Valores de uma moeda: pago pelos atletas, taxa WODArena e repasse ao gestor. */
export type OwnerCurrencyTotals = {
  currency: EventCurrency;
  /** Total desembolsado pelos atletas nas inscrições aprovadas (ingresso + taxa). */
  collected: number;
  /** Taxa WODArena das inscrições aprovadas. */
  serviceFee: number;
  /** O que fica com os gestores. */
  netRevenue: number;
  /** Inscrições aprovadas. */
  paidCount: number;
  /** Inscrições aguardando pagamento (`payment_pending` e `payment_in_review`). */
  pendingCount: number;
  eventsCount: number;
};

export type OwnerFinance = {
  /** Uma linha por evento, na ordem recebida. */
  eventRows: EventFinanceRow[];
  rowsByEventId: Map<string, EventFinanceRow>;
  /** Totais da plataforma, um por moeda (BRL primeiro). */
  totals: OwnerCurrencyTotals[];
};

export type OwnerManagerRow = {
  manager: User;
  accessStatus: ManagerAccessStatus;
  eventsCount: number;
  paidCount: number;
  pendingCount: number;
  /** Valores dos eventos do gestor, um por moeda; vazio sem eventos. */
  money: OwnerCurrencyTotals[];
};

const CURRENCY_ORDER: EventCurrency[] = ['BRL', 'EUR', 'GBP'];

const compareCurrencies = (a: EventCurrency, b: EventCurrency) => {
  const indexA = CURRENCY_ORDER.indexOf(a);
  const indexB = CURRENCY_ORDER.indexOf(b);
  return (indexA === -1 ? CURRENCY_ORDER.length : indexA) - (indexB === -1 ? CURRENCY_ORDER.length : indexB)
    || a.localeCompare(b);
};

/** Soma linhas de evento por moeda, sem nunca misturar BRL, EUR e GBP. */
export const sumEventRowsByCurrency = (rows: EventFinanceRow[]): OwnerCurrencyTotals[] => {
  const byCurrency = new Map<EventCurrency, OwnerCurrencyTotals>();

  rows.forEach(row => {
    const current = byCurrency.get(row.currency) || {
      currency: row.currency,
      collected: 0,
      serviceFee: 0,
      netRevenue: 0,
      paidCount: 0,
      pendingCount: 0,
      eventsCount: 0
    };
    byCurrency.set(row.currency, {
      currency: row.currency,
      collected: current.collected + row.collected,
      serviceFee: current.serviceFee + row.serviceFee,
      netRevenue: current.netRevenue + row.netRevenue,
      paidCount: current.paidCount + row.paidCount,
      pendingCount: current.pendingCount + row.pendingCount,
      eventsCount: current.eventsCount + 1
    });
  });

  return [...byCurrency.values()].sort((a, b) => compareCurrencies(a.currency, b.currency));
};

const groupRegistrationsByEvent = (registrations: Registration[]) => {
  const byEvent = new Map<string, Registration[]>();
  registrations.forEach(registration => {
    const bucket = byEvent.get(registration.eventId);
    if (bucket) bucket.push(registration);
    else byEvent.set(registration.eventId, [registration]);
  });
  return byEvent;
};

export const buildOwnerFinance = (events: Event[], registrations: Registration[]): OwnerFinance => {
  const registrationsByEvent = groupRegistrationsByEvent(registrations);
  const eventRows = events.map(event => buildEventFinanceRow(event, registrationsByEvent.get(event.id) || []));

  return {
    eventRows,
    rowsByEventId: new Map(eventRows.map(row => [row.event.id, row])),
    totals: sumEventRowsByCurrency(eventRows)
  };
};

export const resolveOwnerManagerAccessStatus = (manager: Pick<User, 'managerAccessStatus' | 'serviceValidUntil'>): ManagerAccessStatus =>
  manager.managerAccessStatus || getManagerAccessStatus(manager.serviceValidUntil);

export const buildOwnerManagerRows = (users: User[], finance: OwnerFinance): OwnerManagerRow[] => {
  const rowsByOrganizer = new Map<string, EventFinanceRow[]>();
  finance.eventRows.forEach(row => {
    const bucket = rowsByOrganizer.get(row.event.organizerId);
    if (bucket) bucket.push(row);
    else rowsByOrganizer.set(row.event.organizerId, [row]);
  });

  return users
    .filter(user => user.role === 'manager')
    .map(manager => {
      const rows = rowsByOrganizer.get(manager.id) || [];
      return {
        manager,
        accessStatus: resolveOwnerManagerAccessStatus(manager),
        eventsCount: rows.length,
        paidCount: rows.reduce((sum, row) => sum + row.paidCount, 0),
        pendingCount: rows.reduce((sum, row) => sum + row.pendingCount, 0),
        money: sumEventRowsByCurrency(rows)
      };
    });
};

/** Moeda que abre os cartões: BRL quando houver movimento nela, senão a primeira. */
export const pickPrimaryCurrencyTotals = (totals: OwnerCurrencyTotals[]): OwnerCurrencyTotals | null =>
  totals.find(total => total.currency === 'BRL') || totals[0] || null;

export type OwnerEventSituation = 'live' | 'open' | 'closing' | 'sales_closed' | 'blocked' | 'finished';

/**
 * Situação do evento pelo ciclo de vida do site (Story 1.71), não pelo campo
 * salvo: um evento que já passou aparece encerrado mesmo gravado como
 * "upcoming". Gestor expirado não vende (managerAccess), então o evento dele
 * aparece com as vendas bloqueadas.
 */
export const getOwnerEventSituation = (
  event: Event,
  organizerAccessStatus?: ManagerAccessStatus | null,
  now = new Date()
): OwnerEventSituation => {
  const availability = getRegistrationAvailability(event);
  if (availability.lifecycle === 'finished') return 'finished';

  const timing = getEventTiming(event, now);
  if (event.status === 'live' || timing?.kind === 'today' || timing?.kind === 'ongoing') return 'live';
  if (isManagerAccessBlocked(organizerAccessStatus)) return 'blocked';
  if (!availability.isAvailable) return 'sales_closed';
  return availability.lifecycle === 'closing' ? 'closing' : 'open';
};

export const OWNER_EVENT_SITUATION_LABELS: Record<OwnerEventSituation, string> = {
  live: 'Em andamento',
  open: 'Vendas abertas',
  closing: 'Vendas acabam em breve',
  sales_closed: 'Vendas encerradas',
  blocked: 'Vendas bloqueadas',
  finished: 'Encerrado'
};

export type OwnerTone = 'ok' | 'warn' | 'crit' | 'mute';

export const OWNER_EVENT_SITUATION_TONES: Record<OwnerEventSituation, OwnerTone> = {
  live: 'ok',
  open: 'ok',
  closing: 'warn',
  sales_closed: 'mute',
  blocked: 'crit',
  finished: 'mute'
};

/** "2026-12-31" → "31/12/2026"; texto fora do formato volta como veio. */
export const formatOwnerDate = (value?: string | null): string => {
  if (!value) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
};

export type OwnerRenewalOption = '30d' | '90d' | '1y';

export const OWNER_RENEWAL_LABELS: Record<OwnerRenewalOption, string> = {
  '30d': '+30 dias',
  '90d': '+90 dias',
  '1y': '+1 ano'
};

/**
 * Nova validade de uma renovação rápida (Story 1.125): conta a partir da validade
 * atual quando ela ainda não venceu, senão a partir de hoje. "+1 ano" cai no mesmo
 * dia do ano seguinte (29/02 vira 01/03).
 */
export const renewServiceValidity = (current: string | null | undefined, option: OwnerRenewalOption, today: string): string => {
  const base = current && /^\d{4}-\d{2}-\d{2}$/.test(current) && current >= today ? current : today;
  const date = new Date(`${base}T00:00:00Z`);
  if (option === '1y') date.setUTCFullYear(date.getUTCFullYear() + 1);
  else date.setUTCDate(date.getUTCDate() + (option === '30d' ? 30 : 90));
  return date.toISOString().slice(0, 10);
};
