import type { Event, EventCurrency, Registration, User } from '@/types';
import { compareEventsByDateAsc, compareEventsByDateDesc } from '@/lib/eventStatus';
import { MANAGER_EXPIRING_SOON_DAYS, type ManagerAccessStatus } from '@/lib/managerAccess';
import { resolveServiceFee } from '@/lib/managerFinance';
import { findFeaturedHomeEventOffAir } from '@/lib/homeShowcase';
import {
  buildOwnerFinance,
  buildOwnerManagerRows,
  formatOwnerDate,
  getOwnerEventSituation,
  pickPrimaryCurrencyTotals,
  sumEventRowsByCurrency,
  type OwnerCurrencyTotals,
  type OwnerEventSituation
} from '@/lib/ownerFinance';

// Números do painel do proprietário calculados no servidor (Story 1.122, decisão
// D3 em docs/design/painel-proprietario/). Este módulo é puro: recebe o que a rota
// leu do banco (já paginado) e monta a resposta de GET /api/owner/overview. O
// dinheiro segue ownerFinance.ts → managerFinance.ts, por moeda.

export type OwnerPeriodKey = 'month' | '30d' | 'year' | 'all';
export const OWNER_PERIOD_KEYS: OwnerPeriodKey[] = ['month', '30d', 'year', 'all'];

export const normalizeOwnerPeriod = (value: unknown): OwnerPeriodKey =>
  OWNER_PERIOD_KEYS.includes(value as OwnerPeriodKey) ? value as OwnerPeriodKey : '30d';

// O negócio roda no fuso de Fortaleza (managerAccess.ts), que não tem horário de
// verão desde 2001: o deslocamento é fixo.
const BUSINESS_UTC_OFFSET = '-03:00';
const BUSINESS_OFFSET_MS = -3 * 3_600_000;
const DAY_MS = 86_400_000;
const STALE_REVIEW_HOURS = 48;

type BusinessDateParts = { year: number; month: number; day: number };

const toBusinessParts = (instant: Date): BusinessDateParts => {
  const shifted = new Date(instant.getTime() + BUSINESS_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
};

const pad = (value: number) => String(value).padStart(2, '0');

const businessMidnight = (year: number, month: number, day = 1) =>
  new Date(`${year}-${pad(month)}-${pad(day)}T00:00:00${BUSINESS_UTC_OFFSET}`);

export type OwnerPeriod = {
  key: OwnerPeriodKey;
  /** Início do período (ISO) ou null em "tudo". */
  start: string | null;
  end: string;
  /** Mesmo trecho do período anterior, para a comparação; null em "tudo". */
  previousStart: string | null;
  previousEnd: string | null;
};

/**
 * Períodos da decisão D4, pela data da inscrição. Mês e ano comparam com o mesmo
 * trecho do mês e do ano anteriores (do dia 1 até o mesmo momento), para não
 * comparar um mês pela metade com um mês inteiro.
 */
export const resolveOwnerPeriod = (key: OwnerPeriodKey, now = new Date()): OwnerPeriod => {
  const end = now.toISOString();
  if (key === 'all') return { key, start: null, end, previousStart: null, previousEnd: null };

  if (key === '30d') {
    const start = new Date(now.getTime() - 30 * DAY_MS);
    const previousStart = new Date(now.getTime() - 60 * DAY_MS);
    return { key, start: start.toISOString(), end, previousStart: previousStart.toISOString(), previousEnd: start.toISOString() };
  }

  const today = toBusinessParts(now);
  const start = key === 'month' ? businessMidnight(today.year, today.month) : businessMidnight(today.year, 1);
  const previousStart = key === 'month'
    ? businessMidnight(today.month === 1 ? today.year - 1 : today.year, today.month === 1 ? 12 : today.month - 1)
    : businessMidnight(today.year - 1, 1);
  const elapsed = now.getTime() - start.getTime();
  const previousEnd = new Date(Math.min(previousStart.getTime() + elapsed, start.getTime()));

  return { key, start: start.toISOString(), end, previousStart: previousStart.toISOString(), previousEnd: previousEnd.toISOString() };
};

/** Data dentro de [início, fim]; o fim só entra quando `inclusiveEnd` (o "agora" do período atual). */
const isWithin = (value: string | undefined, start: string | null, end: string | null, inclusiveEnd = true) => {
  if (!start) return true;
  if (!value) return false;
  const time = Date.parse(value);
  if (!Number.isFinite(time) || time < Date.parse(start)) return false;
  if (end === null) return true;
  return inclusiveEnd ? time <= Date.parse(end) : time < Date.parse(end);
};

/** "org-1717000000000" → data do cadastro pelo horário do id; null sem horário. */
export const readCreatedAtFromId = (id: string): string | null => {
  const match = /(\d{13})$/.exec(id);
  if (!match) return null;
  const time = Number(match[1]);
  return Number.isFinite(time) && time > 0 ? new Date(time).toISOString() : null;
};

export const resolveUserCreatedAt = (id: string, createdAt?: string | null): string | null =>
  (createdAt && Number.isFinite(Date.parse(createdAt)) ? new Date(createdAt).toISOString() : null) || readCreatedAtFromId(id);

export type OwnerSourceUser = Pick<User, 'id' | 'name' | 'email' | 'role' | 'organization' | 'serviceValidUntil' | 'managerAccessStatus'> & {
  createdAt: string | null;
};

export type OwnerSourceLead = {
  id: string;
  managerName: string;
  eventName: string;
  leadStatus: string;
  emailStatus: string;
  submittedAt: string;
};

export type OwnerOverviewSource = {
  events: Event[];
  registrations: Registration[];
  users: OwnerSourceUser[];
  /** Gestores com conta de recebimento conectada (Mercado Pago ou Stripe). */
  connectedPaymentUserIds: Set<string>;
  feePayers: Record<string, 'athlete' | 'organizer'>;
  leads: OwnerSourceLead[];
};

export type OwnerMonthlyPoint = {
  /** "2026-11" */
  month: string;
  partial: boolean;
  serviceFee: Partial<Record<EventCurrency, number>>;
};

export type OwnerOverviewEvent = {
  id: string;
  name: string;
  logoUrl: string;
  date: string;
  organizerId: string;
  managerName: string;
  currency: EventCurrency;
  situation: OwnerEventSituation;
  isFeatured: boolean;
  paidCount: number;
  pendingCount: number;
  /** Pagamentos em análise há mais de 48 h. */
  staleReviewCount: number;
  ticketsSold: number;
  slotsLimit: number;
  collected: number;
  serviceFee: number;
  netRevenue: number;
};

export type OwnerOverviewManager = {
  id: string;
  name: string;
  email: string;
  organization: string;
  serviceValidUntil: string | null;
  accessStatus: ManagerAccessStatus;
  createdAt: string | null;
  eventsCount: number;
  paidCount: number;
  pendingCount: number;
  money: OwnerCurrencyTotals[];
  feePayer: 'athlete' | 'organizer' | null;
  hasPaymentAccount: boolean;
};

export type OwnerAttentionSeverity = 'crit' | 'warn' | 'info';

export type OwnerAttentionAction =
  | { kind: 'manager'; managerId: string }
  | { kind: 'managers'; filter: 'expiring_soon' | 'expired' | 'no_account' }
  | { kind: 'section'; section: 'eventos' | 'comercial' | 'configuracoes' };

export type OwnerAttentionItem = {
  id: string;
  severity: OwnerAttentionSeverity;
  title: string;
  detail: string;
  actionLabel: string;
  action: OwnerAttentionAction;
};

export type OwnerRecentSignup = {
  id: string;
  name: string;
  email: string;
  organization: string;
  createdAt: string;
};

export type OwnerOverviewPayload = {
  generatedAt: string;
  period: OwnerPeriod;
  /** Totais do período por moeda (BRL primeiro). */
  totals: OwnerCurrencyTotals[];
  /** Totais do mesmo trecho anterior, por moeda; vazio em "tudo". */
  previousTotals: OwnerCurrencyTotals[];
  /** Variação da taxa WODArena da moeda principal sobre o período anterior (0,14 = +14%); null sem base. */
  serviceFeeDelta: number | null;
  /** Taxa WODArena por mês, últimos 12 meses (o atual é parcial). */
  monthly: OwnerMonthlyPoint[];
  events: OwnerOverviewEvent[];
  managers: OwnerOverviewManager[];
  attention: OwnerAttentionItem[];
  recentSignups: OwnerRecentSignup[];
  counts: { managers: number; events: number; eventsForSale: number; newLeads: number };
};

const FOR_SALE: OwnerEventSituation[] = ['live', 'open', 'closing'];
const RECENT_SIGNUPS_LIMIT = 8;
const SEVERITY_ORDER: Record<OwnerAttentionSeverity, number> = { crit: 0, warn: 1, info: 2 };

const listNames = (names: string[], max = 3) => {
  if (names.length <= max) return names.join(', ').replace(/, ([^,]*)$/, ' e $1');
  return `${names.slice(0, max).join(', ')} e mais ${names.length - max}`;
};

const plural = (count: number, singular: string, pluralText: string) => (count === 1 ? singular : pluralText);

const buildMonthly = (events: Event[], registrations: Registration[], now: Date): OwnerMonthlyPoint[] => {
  const currencyByEvent = new Map(events.map(event => [event.id, event.currency || 'BRL'] as const));
  const today = toBusinessParts(now);
  const months: OwnerMonthlyPoint[] = [];
  for (let offset = 11; offset >= 0; offset -= 1) {
    const monthIndex = today.year * 12 + (today.month - 1) - offset;
    const year = Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    months.push({ month: `${year}-${pad(month)}`, partial: offset === 0, serviceFee: {} });
  }
  const byKey = new Map(months.map(point => [point.month, point]));

  registrations.forEach(registration => {
    if (registration.paymentStatus !== 'payment_approved' || !registration.createdAt) return;
    const currency = currencyByEvent.get(registration.eventId);
    if (!currency) return;
    const time = Date.parse(registration.createdAt);
    if (!Number.isFinite(time)) return;
    const parts = toBusinessParts(new Date(time));
    const point = byKey.get(`${parts.year}-${pad(parts.month)}`);
    if (!point) return;
    // Mesma taxa do resto do painel (managerFinance.resolveServiceFee).
    point.serviceFee[currency] = (point.serviceFee[currency] || 0) + resolveServiceFee(registration);
  });

  return months;
};

const buildAttention = (
  source: OwnerOverviewSource,
  events: OwnerOverviewEvent[],
  managers: OwnerOverviewManager[]
): OwnerAttentionItem[] => {
  const items: OwnerAttentionItem[] = [];

  // Gestor expirado com evento que ainda não aconteceu: as vendas estão paradas.
  managers.filter(manager => manager.accessStatus === 'expired').forEach(manager => {
    const blocked = events.filter(event => event.organizerId === manager.id && event.situation === 'blocked');
    if (blocked.length === 0) return;
    items.push({
      id: `expired-${manager.id}`,
      severity: 'crit',
      title: `${manager.name} está expirado com evento à venda`,
      detail: `${listNames(blocked.map(event => event.name))} não ${plural(blocked.length, 'vende', 'vendem')} desde ${formatOwnerDate(manager.serviceValidUntil)}.`,
      actionLabel: 'Renovar',
      action: { kind: 'manager', managerId: manager.id }
    });
  });

  const expiring = managers.filter(manager => manager.accessStatus === 'expiring_soon');
  if (expiring.length > 0) {
    items.push({
      id: 'expiring-soon',
      severity: 'warn',
      title: expiring.length === 1
        ? `${expiring[0].name} vence nos próximos ${MANAGER_EXPIRING_SOON_DAYS} dias`
        : `${expiring.length} gestores vencem nos próximos ${MANAGER_EXPIRING_SOON_DAYS} dias`,
      detail: listNames(expiring.map(manager => `${manager.name} (${formatOwnerDate(manager.serviceValidUntil)})`)) + '.',
      actionLabel: 'Ver gestores',
      action: { kind: 'managers', filter: 'expiring_soon' }
    });
  }

  const staleEvents = events.filter(event => event.staleReviewCount > 0);
  const staleTotal = staleEvents.reduce((sum, event) => sum + event.staleReviewCount, 0);
  if (staleTotal > 0) {
    items.push({
      id: 'stale-reviews',
      severity: 'warn',
      title: `${staleTotal} ${plural(staleTotal, 'pagamento em análise', 'pagamentos em análise')} há mais de ${STALE_REVIEW_HOURS} h`,
      detail: listNames([...staleEvents].sort((a, b) => b.staleReviewCount - a.staleReviewCount).map(event => `${event.name} (${event.staleReviewCount})`)) + '.',
      actionLabel: 'Ver eventos',
      action: { kind: 'section', section: 'eventos' }
    });
  }

  // Mesma regra do carrossel da home (homeShowcase.ts), lida do evento salvo.
  const featuredSource = findFeaturedHomeEventOffAir(source.events);
  const featuredOffAir = featuredSource ? events.find(event => event.id === featuredSource.id) : undefined;
  if (featuredOffAir) {
    items.push({
      id: 'featured-off-air',
      severity: 'warn',
      title: 'O destaque da home saiu do carrossel',
      detail: `${featuredOffAir.name} encerrou e não aparece mais no carrossel. Escolha outro destaque ou volte para a seleção automática.`,
      actionLabel: 'Trocar destaque',
      action: { kind: 'section', section: 'configuracoes' }
    });
  }

  const newLeads = source.leads.filter(lead => lead.leadStatus === 'new');
  if (newLeads.length > 0) {
    const oldest = newLeads.reduce((min, lead) => (lead.submittedAt < min ? lead.submittedAt : min), newLeads[0].submittedAt);
    items.push({
      id: 'new-leads',
      severity: 'info',
      title: `${newLeads.length} ${plural(newLeads.length, 'lead novo', 'leads novos')} sem resposta`,
      detail: `O mais antigo chegou em ${formatOwnerDate(oldest.slice(0, 10))}.`,
      actionLabel: 'Abrir comercial',
      action: { kind: 'section', section: 'comercial' }
    });
  }

  const failedLeads = source.leads.filter(lead => lead.emailStatus === 'failed');
  if (failedLeads.length > 0) {
    items.push({
      id: 'lead-email-failed',
      severity: 'info',
      title: `${failedLeads.length} ${plural(failedLeads.length, 'aviso de lead não chegou', 'avisos de lead não chegaram')} por e-mail`,
      detail: listNames(failedLeads.map(lead => lead.managerName || 'Sem nome')) + '.',
      actionLabel: 'Abrir comercial',
      action: { kind: 'section', section: 'comercial' }
    });
  }

  // Sem conta Mercado Pago ou Stripe conectada, o evento do gestor não vende.
  const withoutAccount = managers.filter(manager => manager.accessStatus !== 'expired' && !manager.hasPaymentAccount);
  if (withoutAccount.length > 0) {
    items.push({
      id: 'no-payment-account',
      severity: 'info',
      title: withoutAccount.length === 1
        ? `${withoutAccount[0].name} não tem conta de recebimento`
        : `${withoutAccount.length} gestores sem conta de recebimento`,
      detail: withoutAccount.length === 1
        ? 'Sem conta Mercado Pago ou Stripe conectada, os eventos dele não vendem.'
        : `${listNames(withoutAccount.map(manager => manager.name))}: sem conta Mercado Pago ou Stripe conectada, os eventos não vendem.`,
      actionLabel: withoutAccount.length === 1 ? 'Ver gestor' : 'Ver gestores',
      action: withoutAccount.length === 1
        ? { kind: 'manager', managerId: withoutAccount[0].id }
        : { kind: 'managers', filter: 'no_account' }
    });
  }

  return items.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
};

export const buildOwnerOverview = (
  source: OwnerOverviewSource,
  options: { period: OwnerPeriodKey; now?: Date }
): OwnerOverviewPayload => {
  const now = options.now || new Date();
  const period = resolveOwnerPeriod(options.period, now);

  const allTime = buildOwnerFinance(source.events, source.registrations);
  const users = source.users as unknown as User[];
  const managerRows = buildOwnerManagerRows(users, allTime);
  const managerRowsById = new Map(managerRows.map(row => [row.manager.id, row]));
  const sourceUsersById = new Map(source.users.map(user => [user.id, user]));

  const staleCutoff = now.getTime() - STALE_REVIEW_HOURS * 3_600_000;
  const staleByEvent = new Map<string, number>();
  source.registrations.forEach(registration => {
    if (registration.paymentStatus !== 'payment_in_review' || !registration.createdAt) return;
    const time = Date.parse(registration.createdAt);
    if (Number.isFinite(time) && time < staleCutoff) {
      staleByEvent.set(registration.eventId, (staleByEvent.get(registration.eventId) || 0) + 1);
    }
  });

  // Próximos primeiro (do mais perto ao mais longe), encerrados no fim (o mais recente primeiro).
  const orderedEvents = [
    ...source.events.filter(event => getOwnerEventSituation(event, managerRowsById.get(event.organizerId)?.accessStatus, now) !== 'finished').sort(compareEventsByDateAsc),
    ...source.events.filter(event => getOwnerEventSituation(event, managerRowsById.get(event.organizerId)?.accessStatus, now) === 'finished').sort(compareEventsByDateDesc)
  ];

  const events: OwnerOverviewEvent[] = orderedEvents.map(event => {
    const row = allTime.rowsByEventId.get(event.id)!;
    const managerRow = managerRowsById.get(event.organizerId);
    return {
      id: event.id,
      name: event.name,
      logoUrl: event.logoUrl || '',
      date: event.date || '',
      organizerId: event.organizerId,
      managerName: managerRow?.manager.name || 'Gestor não encontrado',
      currency: row.currency,
      situation: getOwnerEventSituation(event, managerRow?.accessStatus, now),
      isFeatured: Boolean(event.isFeatured),
      paidCount: row.paidCount,
      pendingCount: row.pendingCount,
      staleReviewCount: staleByEvent.get(event.id) || 0,
      ticketsSold: row.ticketsSold,
      slotsLimit: row.slotsLimit,
      collected: row.collected,
      serviceFee: row.serviceFee,
      netRevenue: row.netRevenue
    };
  });

  const managers: OwnerOverviewManager[] = managerRows.map(row => ({
    id: row.manager.id,
    name: row.manager.name,
    email: row.manager.email,
    organization: row.manager.organization || '',
    serviceValidUntil: row.manager.serviceValidUntil || null,
    accessStatus: row.accessStatus,
    createdAt: sourceUsersById.get(row.manager.id)?.createdAt || null,
    eventsCount: row.eventsCount,
    paidCount: row.paidCount,
    pendingCount: row.pendingCount,
    money: row.money,
    feePayer: source.feePayers[row.manager.id] || null,
    hasPaymentAccount: source.connectedPaymentUserIds.has(row.manager.id)
  }));

  const inPeriod = source.registrations.filter(registration => isWithin(registration.createdAt, period.start, period.end));
  const totals = sumEventRowsByCurrency(buildOwnerFinance(source.events, inPeriod).eventRows);
  const previousTotals = period.previousStart
    ? sumEventRowsByCurrency(buildOwnerFinance(
      source.events,
      source.registrations.filter(registration => isWithin(registration.createdAt, period.previousStart, period.previousEnd, false))
    ).eventRows)
    : [];

  const primary = pickPrimaryCurrencyTotals(totals);
  const previousPrimary = primary ? previousTotals.find(total => total.currency === primary.currency) : undefined;
  const serviceFeeDelta = primary && previousPrimary && previousPrimary.serviceFee > 0
    ? (primary.serviceFee - previousPrimary.serviceFee) / previousPrimary.serviceFee
    : null;

  const recentSignups: OwnerRecentSignup[] = source.users
    .filter(user => user.role === 'manager' && user.createdAt)
    .sort((a, b) => Date.parse(b.createdAt!) - Date.parse(a.createdAt!))
    .slice(0, RECENT_SIGNUPS_LIMIT)
    .map(user => ({ id: user.id, name: user.name, email: user.email, organization: user.organization || '', createdAt: user.createdAt! }));

  return {
    generatedAt: now.toISOString(),
    period,
    totals,
    previousTotals,
    serviceFeeDelta,
    monthly: buildMonthly(source.events, source.registrations, now),
    events,
    managers,
    attention: buildAttention(source, events, managers),
    recentSignups,
    counts: {
      managers: managers.length,
      events: events.length,
      eventsForSale: events.filter(event => FOR_SALE.includes(event.situation)).length,
      newLeads: source.leads.filter(lead => lead.leadStatus === 'new').length
    }
  };
};
