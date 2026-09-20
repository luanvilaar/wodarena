import type { Event, EventCurrency, Registration } from '@/types';

// Consolida o faturamento que o gestor enxerga no painel administrativo.
//
// Modelo financeiro (ver `serviceFee.ts` e as rotas de checkout): a taxa da
// plataforma é cobrada POR CIMA do ingresso — o atleta paga
// `amount_collected = total_paid + service_fee_amount` e o `application_fee`
// retido pelo gateway equivale à taxa. O gestor recebe `total_paid` integral.
// Por isso "recebido" nunca aplica desconto percentual sobre o total pago.
//
// Inscrições canceladas viram `payment_cancelled` (ver
// `/api/admin/persistence` → cancelRegistration), então já saem do faturamento
// sem precisar subtrair reembolso.

const APPROVED: Registration['paymentStatus'] = 'payment_approved';
const PENDING_STATUSES: Registration['paymentStatus'][] = ['payment_pending', 'payment_in_review'];

export type EventFinanceRow = {
  event: Event;
  currency: EventCurrency;
  /** Inscrições aprovadas (registros, não vagas). */
  paidCount: number;
  /** Inscrições aguardando confirmação de pagamento. */
  pendingCount: number;
  /** Vagas preenchidas por inscrições aprovadas. */
  ticketsSold: number;
  /** Soma dos limites das categorias ativas; 0 quando não há limite definido. */
  slotsLimit: number;
  /** Vagas preenchidas / limite, ou null quando não há limite para comparar. */
  occupancyRate: number | null;
  /** Valor que fica com o gestor. */
  netRevenue: number;
  /** Taxa WODArena paga pelo atleta por fora do ingresso. */
  serviceFee: number;
  /** Total desembolsado pelos atletas (ingresso + taxa). */
  collected: number;
  /** Ticket médio por vaga vendida, ou null sem vendas. */
  averageTicket: number | null;
  /** Participação deste evento no faturamento da mesma moeda (0–1). */
  revenueShare: number;
};

export type CurrencyFinanceGroup = {
  currency: EventCurrency;
  rows: EventFinanceRow[];
  totals: {
    paidCount: number;
    pendingCount: number;
    ticketsSold: number;
    slotsLimit: number;
    netRevenue: number;
    serviceFee: number;
    collected: number;
    /** Ocupação agregada do grupo, ou null sem limite declarado. */
    occupancyRate: number | null;
    /** Ticket médio ponderado pelo total de vagas vendidas. */
    averageTicket: number | null;
  };
};

export type ManagerFinanceSummary = {
  /** Um grupo por moeda, ordenado do maior faturamento para o menor. */
  groups: CurrencyFinanceGroup[];
  /** Grupo de maior faturamento — alimenta os cartões de topo. */
  primary: CurrencyFinanceGroup | null;
  /** Grupos além do principal, para a nota de moedas adicionais. */
  secondary: CurrencyFinanceGroup[];
};

const toNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const resolveEventCurrency = (event: Pick<Event, 'currency'>): EventCurrency => event.currency || 'BRL';

/**
 * A taxa efetivamente retida pelo gateway tem precedência sobre a calculada na
 * criação da inscrição — só ela reflete o que a plataforma realmente cobrou.
 */
export const resolveServiceFee = (registration: Registration): number => {
  const charged = toNumber(registration.applicationFeeCharged);
  return charged > 0 ? charged : toNumber(registration.serviceFeeAmount);
};

/**
 * Inscrições anteriores ao split guardam `amount_collected = total_paid`, então
 * o fallback reconstrói o total a partir do ingresso mais a taxa conhecida.
 */
export const resolveCollectedAmount = (registration: Registration): number => {
  const collected = toNumber(registration.amountCollected);
  const base = toNumber(registration.totalPaid);
  const fee = resolveServiceFee(registration);
  return collected >= base + fee ? collected : base + fee;
};

/** Capacidade total do evento: soma dos limites das categorias ativas. */
export const resolveEventSlotsLimit = (event: Pick<Event, 'divisions'>): number =>
  (event.divisions || [])
    .filter(division => division.isActive)
    .reduce((sum, division) => sum + Math.max(0, toNumber(division.slotsLimit)), 0);

export const buildEventFinanceRow = (event: Event, registrations: Registration[]): EventFinanceRow => {
  const eventRegistrations = registrations.filter(registration => registration.eventId === event.id);
  const approved = eventRegistrations.filter(registration => registration.paymentStatus === APPROVED);
  const pending = eventRegistrations.filter(registration => PENDING_STATUSES.includes(registration.paymentStatus));

  const netRevenue = approved.reduce((sum, registration) => sum + toNumber(registration.totalPaid), 0);
  const serviceFee = approved.reduce((sum, registration) => sum + resolveServiceFee(registration), 0);
  const collected = approved.reduce((sum, registration) => sum + resolveCollectedAmount(registration), 0);
  const ticketsSold = approved.reduce((sum, registration) => sum + Math.max(0, toNumber(registration.quantity)), 0);
  const slotsLimit = resolveEventSlotsLimit(event);

  return {
    event,
    currency: resolveEventCurrency(event),
    paidCount: approved.length,
    pendingCount: pending.length,
    ticketsSold,
    slotsLimit,
    occupancyRate: slotsLimit > 0 ? Math.min(1, ticketsSold / slotsLimit) : null,
    netRevenue,
    serviceFee,
    collected,
    averageTicket: ticketsSold > 0 ? netRevenue / ticketsSold : null,
    revenueShare: 0
  };
};

export const buildManagerFinanceSummary = (
  events: Event[],
  registrations: Registration[]
): ManagerFinanceSummary => {
  const groupsByCurrency = new Map<EventCurrency, EventFinanceRow[]>();

  events.forEach(event => {
    const row = buildEventFinanceRow(event, registrations);
    const bucket = groupsByCurrency.get(row.currency);
    if (bucket) {
      bucket.push(row);
    } else {
      groupsByCurrency.set(row.currency, [row]);
    }
  });

  const groups: CurrencyFinanceGroup[] = [...groupsByCurrency.entries()].map(([currency, rows]) => {
    const sums = rows.reduce(
      (acc, row) => ({
        paidCount: acc.paidCount + row.paidCount,
        pendingCount: acc.pendingCount + row.pendingCount,
        ticketsSold: acc.ticketsSold + row.ticketsSold,
        slotsLimit: acc.slotsLimit + row.slotsLimit,
        netRevenue: acc.netRevenue + row.netRevenue,
        serviceFee: acc.serviceFee + row.serviceFee,
        collected: acc.collected + row.collected
      }),
      { paidCount: 0, pendingCount: 0, ticketsSold: 0, slotsLimit: 0, netRevenue: 0, serviceFee: 0, collected: 0 }
    );

    const totals = {
      ...sums,
      occupancyRate: sums.slotsLimit > 0 ? Math.min(1, sums.ticketsSold / sums.slotsLimit) : null,
      averageTicket: sums.ticketsSold > 0 ? sums.netRevenue / sums.ticketsSold : null
    };

    // Eventos que faturaram vêm primeiro; o desempate por nome mantém a ordem
    // estável quando ninguém vendeu ainda.
    const orderedRows = [...rows]
      .map(row => ({
        ...row,
        revenueShare: totals.netRevenue > 0 ? row.netRevenue / totals.netRevenue : 0
      }))
      .sort((a, b) => b.netRevenue - a.netRevenue || a.event.name.localeCompare(b.event.name, 'pt-BR'));

    return { currency, rows: orderedRows, totals };
  });

  groups.sort((a, b) => b.totals.netRevenue - a.totals.netRevenue || a.currency.localeCompare(b.currency));

  return {
    groups,
    primary: groups[0] || null,
    secondary: groups.slice(1)
  };
};
