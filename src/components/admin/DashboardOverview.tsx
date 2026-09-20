'use client';

import React from 'react';
import Image from 'next/image';
import {
  Calendar, ChevronRight, ClipboardCheck, DollarSign, Ticket, Users
} from 'lucide-react';

import { formatMoney } from '@/lib/intl/format';
import type { CurrencyFinanceGroup, EventFinanceRow, ManagerFinanceSummary } from '@/lib/managerFinance';
import type { Event, EventCurrency, Registration } from '@/types';

type PaymentStatusTone = 'success' | 'danger' | 'warning';

export type DashboardStats = {
  totalEventsCount: number;
  activeEventsCount: number;
  finishedEventsCount: number;
  totalAthletes: number;
  totalTeams: number;
  upcomingEvents: Event[];
  latestRegistrations: Registration[];
};

type DashboardOverviewProps = {
  stats: DashboardStats;
  finance: ManagerFinanceSummary;
  onSelectEvent: (event: Event) => void;
  onCreateEvent: () => void;
  getPaymentStatusMeta: (status?: Registration['paymentStatus']) => { label: string; tone: PaymentStatusTone };
  getPaymentStatusClassName: (tone: PaymentStatusTone) => string;
};

const percentFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  maximumFractionDigits: 0
});

const money = (value: number, currency: EventCurrency) => formatMoney(value, currency, 'pt-br');

const CURRENCY_LABELS: Record<EventCurrency, string> = {
  BRL: 'Real',
  EUR: 'Euro',
  GBP: 'Libra'
};

const eventStatusChip = (status: Event['status']) => {
  if (status === 'live') return { label: 'Ao vivo', className: 'border-trading-up/30 bg-trading-up/10 text-trading-up' };
  if (status === 'finished') return { label: 'Finalizado', className: 'border-card-border bg-dark-gray text-muted' };
  return { label: 'Em breve', className: 'border-primary/30 bg-primary/10 text-primary' };
};

const cardClassName = 'rounded-xl border border-card-border bg-card';
const labelClassName = 'text-[11px] font-bold uppercase tracking-wider text-muted font-sans';

/** Logo do evento com recuo para as iniciais quando não há imagem. */
const EventMark = ({ event, size }: { event: Event; size: number }) => (
  <span
    className="flex shrink-0 items-center justify-center overflow-hidden rounded border border-card-border bg-dark-gray"
    style={{ width: size, height: size }}
  >
    {event.logoUrl ? (
      <Image src={event.logoUrl} alt="" width={size} height={size} unoptimized className="h-full w-full object-cover" />
    ) : (
      <span className="text-[11px] font-black uppercase text-primary">{event.name.substring(0, 2)}</span>
    )}
  </span>
);

/** Barra de ocupação: proporção real de vagas preenchidas, nunca decorativa. */
const OccupancyMeter = ({ rate }: { rate: number | null }) => {
  if (rate === null) {
    return <span className="text-muted-soft">Sem limite</span>;
  }

  return (
    <span className="flex flex-col gap-1.5">
      <span className="font-number font-bold text-white">{percentFormatter.format(rate)}</span>
      <span aria-hidden="true" className="block h-1 w-full max-w-24 overflow-hidden rounded-full bg-dark-gray">
        <span
          className="block h-full rounded-full bg-primary"
          style={{ width: `${Math.max(2, Math.round(rate * 100))}%` }}
        />
      </span>
    </span>
  );
};

const EventFinanceCard = ({
  row,
  onSelectEvent
}: {
  row: EventFinanceRow;
  onSelectEvent: (event: Event) => void;
}) => {
  const chip = eventStatusChip(row.event.status);

  return (
    <article className="rounded-xl border border-card-border bg-dark-gray/30 p-4">
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => onSelectEvent(row.event)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <EventMark event={row.event} size={36} />
          <span className="min-w-0">
            <span className="block truncate text-xs font-bold uppercase tracking-wider text-white">{row.event.name}</span>
            <span className="mt-0.5 block truncate text-[11px] text-muted">{row.event.date}</span>
          </span>
        </button>
        <span className={`shrink-0 whitespace-nowrap rounded border px-2 py-1 text-[10px] font-bold uppercase tracking-wider font-sans ${chip.className}`}>
          {chip.label}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-card-border pt-3">
        <div>
          <dt className={labelClassName}>Pagas / pendentes</dt>
          <dd className="mt-1 font-number text-sm font-bold text-white">
            {row.paidCount} <span className="text-muted-soft">/</span> {row.pendingCount}
          </dd>
        </div>
        <div>
          <dt className={labelClassName}>Ocupação</dt>
          <dd className="mt-1 text-sm"><OccupancyMeter rate={row.occupancyRate} /></dd>
        </div>
        <div className="col-span-2">
          <dt className={labelClassName}>Ticket médio</dt>
          <dd className="mt-1 font-number text-sm font-bold text-white">
            {row.averageTicket === null ? '—' : money(row.averageTicket, row.currency)}
          </dd>
        </div>
        <div className="col-span-2 border-t border-card-border/60 pt-3">
          <dt className={labelClassName}>Você recebe</dt>
          <dd className="mt-1 font-number text-lg font-bold text-primary">{money(row.netRevenue, row.currency)}</dd>
        </div>
      </dl>
    </article>
  );
};

const EventFinanceGroup = ({
  group,
  showCurrencyHeading,
  onSelectEvent
}: {
  group: CurrencyFinanceGroup;
  showCurrencyHeading: boolean;
  onSelectEvent: (event: Event) => void;
}) => (
  <div className="space-y-4">
    {showCurrencyHeading && (
      <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted font-sans">
        <span className="rounded border border-primary/30 bg-primary/10 px-2 py-0.5 text-primary">{group.currency}</span>
        <span>{CURRENCY_LABELS[group.currency]} · {group.rows.length} {group.rows.length === 1 ? 'evento' : 'eventos'}</span>
      </p>
    )}

    {/* Abaixo de lg a tabela de 5 colunas fica ilegível: vira lista de cartões. */}
    <div className="space-y-3 lg:hidden">
      {group.rows.map(row => (
        <EventFinanceCard key={row.event.id} row={row} onSelectEvent={onSelectEvent} />
      ))}
    </div>

    <div className="hidden lg:block">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">
          Faturamento por evento em {CURRENCY_LABELS[group.currency]}
        </caption>
        <thead>
          <tr className="border-b border-card-border text-[10px] uppercase tracking-wider text-muted">
            <th scope="col" className="px-3 py-3 font-bold">Evento</th>
            <th scope="col" className="px-3 py-3 text-center font-bold">Pagas / pend.</th>
            <th scope="col" className="px-3 py-3 font-bold">Ocupação</th>
            <th scope="col" className="px-3 py-3 text-right font-bold">Ticket médio</th>
            <th scope="col" className="px-3 py-3 text-right font-bold text-primary">Você recebe</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-card-border/40">
          {group.rows.map(row => {
            const chip = eventStatusChip(row.event.status);
            return (
              <tr key={row.event.id} className="text-xs transition-colors hover:bg-dark-gray/30">
                <td className="px-3 py-3">
                  <button
                    type="button"
                    onClick={() => onSelectEvent(row.event)}
                    className="group flex w-full min-w-0 items-center gap-3 text-left"
                  >
                    <EventMark event={row.event} size={32} />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-bold uppercase tracking-wider text-white group-hover:text-primary" title={row.event.name}>
                          {row.event.name}
                        </span>
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-soft group-hover:text-primary" aria-hidden="true" />
                      </span>
                      <span className="mt-0.5 flex items-center gap-2">
                        <span className={`rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider font-sans ${chip.className}`}>
                          {chip.label}
                        </span>
                        <span className="truncate text-[11px] text-muted">{row.event.date}</span>
                      </span>
                    </span>
                  </button>
                </td>
                <td className="px-3 py-3 text-center font-number font-bold text-white">
                  {row.paidCount} <span className="text-muted-soft">/</span>{' '}
                  <span className={row.pendingCount > 0 ? 'text-primary' : 'text-muted-soft'}>{row.pendingCount}</span>
                </td>
                <td className="px-3 py-3"><OccupancyMeter rate={row.occupancyRate} /></td>
                <td className="px-3 py-3 text-right font-number text-white">
                  {row.averageTicket === null ? <span className="text-muted-soft">—</span> : money(row.averageTicket, row.currency)}
                </td>
                <td className="px-3 py-3 text-right font-number font-bold text-primary">{money(row.netRevenue, row.currency)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-card-border text-xs">
            <th scope="row" className="px-3 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-muted">
              Total em {group.currency}
            </th>
            <td className="px-3 py-3 text-center font-number font-bold text-white">
              {group.totals.paidCount} <span className="text-muted-soft">/</span>{' '}
              <span className={group.totals.pendingCount > 0 ? 'text-primary' : 'text-muted-soft'}>{group.totals.pendingCount}</span>
            </td>
            <td className="px-3 py-3 font-number font-bold text-muted">
              {group.totals.occupancyRate === null
                ? `${group.totals.ticketsSold} vagas`
                : `${percentFormatter.format(group.totals.occupancyRate)} de ${group.totals.slotsLimit}`}
            </td>
            <td className="px-3 py-3 text-right font-number text-muted">
              {group.totals.averageTicket === null ? '—' : money(group.totals.averageTicket, group.currency)}
            </td>
            <td className="px-3 py-3 text-right font-number text-base font-bold text-primary">{money(group.totals.netRevenue, group.currency)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
);

export const DashboardOverview = ({
  stats,
  finance,
  onSelectEvent,
  onCreateEvent,
  getPaymentStatusMeta,
  getPaymentStatusClassName
}: DashboardOverviewProps) => {
  const primary = finance.primary;
  const primaryCurrency: EventCurrency = primary?.currency || 'BRL';
  const netRevenue = primary?.totals.netRevenue || 0;
  const paidCount = primary?.totals.paidCount || 0;

  // Contagens de vagas somam entre moedas sem distorção — só valores não somam.
  const totalTicketsSold = finance.groups.reduce((sum, group) => sum + group.totals.ticketsSold, 0);
  const totalSlots = finance.groups.reduce((sum, group) => sum + group.totals.slotsLimit, 0);
  const globalOccupancy = totalSlots > 0 ? Math.min(1, totalTicketsSold / totalSlots) : null;

  const individualAthletes = Math.max(0, stats.totalAthletes - stats.totalTeams);
  const hasEvents = stats.totalEventsCount > 0;
  const hasRevenue = finance.groups.some(group => group.totals.netRevenue > 0);

  return (
    <div className="space-y-6 bg-background text-white">
      <div className="border-b border-card-border pb-4">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary font-sans">Painel de Controle</p>
        <h3 className="mt-1 text-2xl font-bold uppercase tracking-tight text-white">
          Resumo das Operações
        </h3>
      </div>

      {/* Indicadores principais. A receita ocupa duas colunas porque é o número
          que o gestor vem conferir. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className={`${cardClassName} col-span-2 flex flex-col p-5`}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-wider text-primary font-sans">Você recebe</p>
              <p className="mt-1 break-words font-number text-2xl font-bold text-primary sm:text-3xl">
                {money(netRevenue, primaryCurrency)}
              </p>
              <p className="mt-1 text-[11px] text-muted">
                {paidCount} {paidCount === 1 ? 'inscrição aprovada' : 'inscrições aprovadas'}
              </p>
            </div>
            <span className="shrink-0 rounded-lg border border-primary/20 bg-primary/10 p-3 text-primary">
              <DollarSign className="h-5 w-5" aria-hidden="true" />
            </span>
          </div>

          {finance.secondary.length > 0 && (
            <p className="mt-4 border-t border-card-border pt-4 text-[11px] text-muted">
              Outras moedas:{' '}
              {finance.secondary.map((group, index) => (
                <span key={group.currency}>
                  {index > 0 && ' · '}
                  <span className="font-number font-bold text-white">{money(group.totals.netRevenue, group.currency)}</span>
                </span>
              ))}
            </p>
          )}
        </div>

        {/* Abaixo de sm o selo de ícone roubaria a largura do rótulo, que é o
            que realmente identifica o cartão. */}
        <div className={`${cardClassName} flex flex-col p-5`}>
          <div className="flex items-start justify-between gap-3">
            <p className={labelClassName}>Vagas vendidas</p>
            <span className="hidden shrink-0 rounded-lg border border-card-border bg-dark-gray p-3 text-muted sm:inline-flex">
              <Ticket className="h-5 w-5" aria-hidden="true" />
            </span>
          </div>
          <div className="flex flex-1 flex-col justify-center">
            <p className="mt-1 font-number text-2xl font-bold text-white">{totalTicketsSold}</p>
            <p className="mt-1 text-[11px] text-muted">
              {totalSlots > 0
                ? `${percentFormatter.format(globalOccupancy || 0)} de ${totalSlots} vagas`
                : 'Em inscrições aprovadas'}
            </p>
          </div>
        </div>

        <div className={`${cardClassName} flex flex-col p-5`}>
          <div className="flex items-start justify-between gap-3">
            <p className={labelClassName}>Participantes</p>
            <span className="hidden shrink-0 rounded-lg border border-card-border bg-dark-gray p-3 text-muted sm:inline-flex">
              <Users className="h-5 w-5" aria-hidden="true" />
            </span>
          </div>
          <div className="flex flex-1 flex-col justify-center">
            <p className="mt-1 font-number text-2xl font-bold text-white">{stats.totalAthletes}</p>
            <p className="mt-1 text-[11px] text-muted">
              {individualAthletes} {individualAthletes === 1 ? 'individual' : 'individuais'} · {stats.totalTeams} {stats.totalTeams === 1 ? 'equipe' : 'equipes'}
            </p>
          </div>
        </div>
      </div>

      {/* Situação dos eventos: um cartão com três leituras, em vez de três
          cartões que se espremem entre 640px e 1024px. */}
      <div className={`${cardClassName} grid grid-cols-1 divide-y divide-card-border sm:grid-cols-3 sm:divide-x sm:divide-y-0`}>
        <div className="flex items-center justify-between gap-3 p-4 sm:flex-col sm:items-start">
          <p className={labelClassName}>Total de eventos</p>
          <p className="font-number text-xl font-bold text-white">{stats.totalEventsCount}</p>
        </div>
        <div className="flex items-center justify-between gap-3 p-4 sm:flex-col sm:items-start">
          <p className={`${labelClassName} flex items-center gap-1.5`}>
            {stats.activeEventsCount > 0 && (
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-trading-up motion-safe:animate-pulse" />
            )}
            <span>Ao vivo agora</span>
          </p>
          <p className={`font-number text-xl font-bold ${stats.activeEventsCount > 0 ? 'text-trading-up' : 'text-muted'}`}>
            {stats.activeEventsCount}
          </p>
        </div>
        <div className="flex items-center justify-between gap-3 p-4 sm:flex-col sm:items-start">
          <p className={labelClassName}>Finalizados</p>
          <p className="font-number text-xl font-bold text-muted">{stats.finishedEventsCount}</p>
        </div>
      </div>

      {/* Faturamento por evento */}
      <section className={`${cardClassName} space-y-5 p-5`}>
        <div className="flex flex-col gap-1 border-b border-card-border pb-3 sm:flex-row sm:items-end sm:justify-between">
          <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-white font-sans">
            <DollarSign className="h-4 w-4 text-primary" aria-hidden="true" />
            <span>Faturamento por Evento</span>
          </h4>
          <p className="text-[11px] text-muted">Somente inscrições com pagamento aprovado</p>
        </div>

        {!hasEvents ? (
          <div className="space-y-3 py-6 text-center">
            <Calendar className="mx-auto h-8 w-8 text-muted" aria-hidden="true" />
            <p className="text-sm font-bold uppercase tracking-wider text-white font-sans">Nenhum evento cadastrado</p>
            <p className="mx-auto max-w-sm text-xs leading-relaxed text-muted">
              O faturamento aparece aqui assim que você criar um evento e receber a primeira inscrição paga.
            </p>
            <button
              type="button"
              onClick={onCreateEvent}
              className="inline-flex min-h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-xs font-bold uppercase tracking-wider text-ink transition-colors hover:bg-primary-hover font-sans"
            >
              Criar primeiro evento
            </button>
          </div>
        ) : (
          <>
            {!hasRevenue && (
              <p className="rounded-lg border border-card-border bg-dark-gray/30 px-4 py-3 text-xs leading-relaxed text-muted">
                Ainda não há pagamento aprovado. Os valores abaixo são atualizados assim que a primeira inscrição for confirmada.
              </p>
            )}
            <div className="space-y-8">
              {finance.groups.map(group => (
                <EventFinanceGroup
                  key={group.currency}
                  group={group}
                  showCurrencyHeading={finance.groups.length > 1}
                  onSelectEvent={onSelectEvent}
                />
              ))}
            </div>
          </>
        )}
      </section>

      {/* Operação do dia a dia */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className={`${cardClassName} flex h-full flex-col p-5`}>
          <h4 className="flex items-center gap-1.5 border-b border-card-border pb-3 text-xs font-bold uppercase tracking-wider text-white font-sans">
            <ClipboardCheck className="h-4 w-4 text-primary" aria-hidden="true" />
            <span>Últimas inscrições</span>
          </h4>

          {stats.latestRegistrations.length === 0 ? (
            <p className="flex-1 py-8 text-center text-xs text-muted">Nenhuma inscrição registrada ainda.</p>
          ) : (
            <>
              {/* Quatro colunas não cabem em telas estreitas: lista empilhada. */}
              <ul className="mt-4 space-y-3 md:hidden">
                {stats.latestRegistrations.map(reg => {
                  const statusMeta = getPaymentStatusMeta(reg.paymentStatus);
                  return (
                    <li key={reg.id} className="rounded-lg border border-card-border/60 bg-dark-gray/25 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 flex-1 text-xs font-semibold text-white" title={reg.athleteName}>
                          {reg.athleteName}
                        </p>
                        <span className={`shrink-0 whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase font-sans ${getPaymentStatusClassName(statusMeta.tone)}`}>
                          {statusMeta.label}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-3 text-[11px]">
                        <span className="font-number font-bold text-primary">
                          {money(reg.totalPaid, reg.currency || 'BRL')}
                        </span>
                        <span className="font-number text-muted">{new Date(reg.createdAt).toLocaleDateString('pt-BR')}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div className="mt-2 hidden md:block">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-card-border/50 text-[10px] font-bold uppercase tracking-wider text-muted font-sans">
                      <th scope="col" className="w-full py-2 pr-3">Nome</th>
                      <th scope="col" className="px-3 py-2 text-right">Valor</th>
                      <th scope="col" className="px-3 py-2 text-right">Data</th>
                      <th scope="col" className="py-2 pl-3 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-card-border/30 text-xs">
                    {stats.latestRegistrations.map(reg => {
                      const statusMeta = getPaymentStatusMeta(reg.paymentStatus);
                      return (
                        <tr key={reg.id} className="transition-colors hover:bg-dark-gray/30">
                          <td className="w-full py-2.5 pr-3">
                            {/* Nomes de equipe são longos: duas linhas no máximo
                                mantêm a altura das linhas previsível. */}
                            <span className="line-clamp-2 font-semibold text-white" title={reg.athleteName}>
                              {reg.athleteName}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right font-number text-primary">
                            {money(reg.totalPaid, reg.currency || 'BRL')}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right font-number text-muted">
                            {new Date(reg.createdAt).toLocaleDateString('pt-BR')}
                          </td>
                          <td className="py-2.5 pl-3 text-right">
                            <span className={`whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase font-sans ${getPaymentStatusClassName(statusMeta.tone)}`}>
                              {statusMeta.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        <section className={`${cardClassName} flex h-full flex-col p-5`}>
          <h4 className="flex items-center gap-1.5 border-b border-card-border pb-3 text-xs font-bold uppercase tracking-wider text-white font-sans">
            <Calendar className="h-4 w-4 text-primary" aria-hidden="true" />
            <span>Próximas competições</span>
          </h4>

          {stats.upcomingEvents.length === 0 ? (
            <p className="flex-1 py-8 text-center text-xs text-muted">Nenhum evento agendado para breve.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {stats.upcomingEvents.map(evt => (
                <li key={evt.id}>
                  <button
                    type="button"
                    onClick={() => onSelectEvent(evt)}
                    className="group flex w-full items-center justify-between gap-3 rounded-lg border border-card-border/50 bg-dark-gray/30 p-3 text-left transition-colors hover:border-primary/30"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-bold uppercase tracking-wider text-white group-hover:text-primary">
                        {evt.name}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted" title={`${evt.location} · ${evt.date}`}>
                        {evt.location} · {evt.date}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-soft group-hover:text-primary" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
};
