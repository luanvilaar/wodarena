'use client';

import { AlertTriangle, ChevronRight, Clock3, Info } from 'lucide-react';
import type { OwnerAttentionAction, OwnerAttentionItem, OwnerOverviewPayload, OwnerPeriodKey } from '@/lib/ownerOverview';
import { pickPrimaryCurrencyTotals, OWNER_EVENT_SITUATION_LABELS, OWNER_EVENT_SITUATION_TONES } from '@/lib/ownerFinance';
import { OwnerRevenueChart } from '@/components/owner/OwnerRevenueChart';
import { OwnerRecentSignups } from '@/components/owner/OwnerRecentSignups';
import { formatOwnerInteger, formatOwnerMoney, OWNER_TONE_CLASSES, ownerCardClassName } from '@/components/owner/ownerUi';

// Visão geral do painel do proprietário (Story 1.124, decisões D4 e E2 de
// docs/design/painel-proprietario/): quatro números da moeda principal no período,
// as outras moedas numa nota à parte, a receita por mês, a fila "Precisa de
// atenção", os eventos à venda e os cadastros recentes com busca. Os números vêm
// prontos de GET /api/owner/overview.

export const OWNER_PERIOD_LABELS = (year: number): Record<OwnerPeriodKey, string> => ({
  month: 'Mês atual',
  '30d': '30 dias',
  year: String(year),
  all: 'Tudo'
});

const DELTA_CONTEXT = (period: OwnerPeriodKey, year: number) => ({
  month: 'sobre o mesmo trecho do mês passado',
  '30d': 'sobre os 30 dias anteriores',
  year: `sobre o mesmo trecho de ${year - 1}`,
  all: 'desde o primeiro evento'
}[period]);

export const formatOwnerDelta = (delta: number | null) => {
  if (delta === null || !Number.isFinite(delta)) return '';
  const percent = Math.round(delta * 100);
  return `${percent > 0 ? '+' : ''}${percent}%`;
};

const SEVERITY_META = {
  crit: { label: 'Urgente', Icon: AlertTriangle, className: 'bg-red-950/40 text-red-300' },
  warn: { label: 'Atenção', Icon: Clock3, className: 'bg-amber-400/10 text-amber-300' },
  info: { label: 'Aviso', Icon: Info, className: 'bg-sky-400/10 text-sky-300' }
} as const;

type Props = {
  overview: OwnerOverviewPayload | null;
  status: 'loading' | 'ready' | 'error';
  error: string;
  onRetry: () => void;
  onAttentionAction: (action: OwnerAttentionAction) => void;
  onOpenEvents: () => void;
  signupsQuery: string;
  signupsQueryNonce: number;
};

function AttentionList({ items, onAction }: { items: OwnerAttentionItem[]; onAction: (action: OwnerAttentionAction) => void }) {
  if (items.length === 0) {
    return <p className="py-4 text-sm text-muted">Nada pedindo ação agora.</p>;
  }
  return (
    <ul className="divide-y divide-card-border">
      {items.map(item => {
        const meta = SEVERITY_META[item.severity];
        return (
          <li key={item.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 py-3 first:pt-0 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
            <span className={`mt-0.5 inline-flex h-fit items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${meta.className}`}>
              <meta.Icon className="h-3 w-3" aria-hidden /> {meta.label}
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-white">{item.title}</p>
              <p className="text-xs text-muted">{item.detail}</p>
            </div>
            <button
              type="button"
              onClick={() => onAction(item.action)}
              className="col-start-2 inline-flex min-h-9 items-center gap-0.5 justify-self-start whitespace-nowrap text-xs font-bold text-primary hover:underline sm:col-start-auto sm:justify-self-end"
            >
              {item.actionLabel} <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function OwnerOverviewSection({ overview, status, error, onRetry, onAttentionAction, onOpenEvents, signupsQuery, signupsQueryNonce }: Props) {
  const year = overview ? Number(overview.generatedAt.slice(0, 4)) : new Date().getFullYear();
  const primary = overview ? pickPrimaryCurrencyTotals(overview.totals) : null;
  const primaryCurrency = primary?.currency || 'BRL';
  const secondary = overview ? overview.totals.filter(total => total !== primary) : [];
  const delta = overview ? formatOwnerDelta(overview.serviceFeeDelta) : '';
  const eventsForSale = overview
    ? overview.events.filter(event => event.situation === 'live' || event.situation === 'open' || event.situation === 'closing').slice(0, 6)
    : [];

  return (
    <div className="space-y-6">
      {status === 'error' && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-950/20 px-4 py-3 text-sm text-red-200">
          <span>{error || 'Não foi possível carregar os números do painel.'}</span>
          <button type="button" onClick={onRetry} className="min-h-11 rounded-md border border-primary/60 px-3 text-xs font-bold uppercase tracking-wider text-primary hover:bg-primary hover:text-ink">
            Tentar de novo
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-busy={status === 'loading'}>
        <div className={`${ownerCardClassName} space-y-1 border-primary/35 bg-primary/5`}>
          <p className="text-[11px] font-bold uppercase tracking-wider text-primary">Receita WODArena</p>
          <p className="font-number text-[28px] font-bold leading-tight text-primary">{overview ? formatOwnerMoney(primary?.serviceFee ?? 0, primaryCurrency) : '—'}</p>
          <p className="text-xs text-muted">
            {delta ? <><b className={overview && (overview.serviceFeeDelta ?? 0) < 0 ? 'text-red-300' : 'text-emerald-400'}>{delta}</b> {DELTA_CONTEXT(overview!.period.key, year)}</> : overview?.period.key === 'all' ? 'desde o primeiro evento' : 'sem base para comparar'}
          </p>
        </div>
        <div className={`${ownerCardClassName} space-y-1`}>
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted">Pago pelos atletas</p>
          <p className="font-number text-xl font-bold text-white">{overview ? formatOwnerMoney(primary?.collected ?? 0, primaryCurrency) : '—'}</p>
          <p className="text-xs text-muted">ingresso e taxa, só aprovadas</p>
        </div>
        <div className={`${ownerCardClassName} space-y-1`}>
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted">Repassado aos gestores</p>
          <p className="font-number text-xl font-bold text-white">{overview ? formatOwnerMoney(primary?.netRevenue ?? 0, primaryCurrency) : '—'}</p>
          <p className="text-xs text-muted">já sem a taxa WODArena</p>
        </div>
        <div className={`${ownerCardClassName} space-y-1`}>
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted">Inscrições aprovadas</p>
          <p className="font-number text-xl font-bold text-white">{overview ? formatOwnerInteger(primary?.paidCount ?? 0) : '—'}</p>
          <p className="text-xs text-muted">{overview ? `${formatOwnerInteger(primary?.pendingCount ?? 0)} aguardando pagamento` : ' '}</p>
        </div>
      </div>

      {secondary.length > 0 && (
        <p className="flex items-start gap-2 text-xs text-muted">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-300" aria-hidden />
          <span>
            {secondary.map(total => `Em ${total.currency} no período: ${formatOwnerMoney(total.collected, total.currency)} pagos e ${formatOwnerMoney(total.serviceFee, total.currency)} de taxa.`).join(' ')}
            {` Ficam fora da soma em ${primaryCurrency}.`}
          </span>
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <section aria-labelledby="owner-chart-title" className={`${ownerCardClassName} space-y-3`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="owner-chart-title" className="text-sm font-bold text-white">Receita WODArena por mês</h2>
            <p className="text-xs text-muted">últimos 12 meses, em {primaryCurrency}</p>
          </div>
          {overview ? <OwnerRevenueChart points={overview.monthly} currency={primaryCurrency} /> : <div className="h-48" aria-hidden />}
        </section>

        <section aria-labelledby="owner-attention-title" className={`${ownerCardClassName} space-y-3`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="owner-attention-title" className="text-sm font-bold text-white">Precisa de atenção</h2>
            <p className="text-xs text-muted">{overview ? `${overview.attention.length} ${overview.attention.length === 1 ? 'item' : 'itens'}` : ''}</p>
          </div>
          {overview ? <AttentionList items={overview.attention} onAction={onAttentionAction} /> : <p className="py-4 text-sm text-muted">Carregando…</p>}
        </section>
      </div>

      <section aria-labelledby="owner-for-sale-title" className={`${ownerCardClassName} space-y-3 p-0 sm:p-0`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4 sm:px-5 sm:pt-5">
          <h2 id="owner-for-sale-title" className="text-sm font-bold text-white">Eventos à venda</h2>
          <button type="button" onClick={onOpenEvents} className="inline-flex min-h-9 items-center gap-0.5 text-xs font-bold text-primary hover:underline">
            Ver todos os eventos <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
        {eventsForSale.length === 0 ? (
          <p className="px-4 pb-5 text-sm text-muted sm:px-5">{overview ? 'Nenhum evento à venda agora.' : 'Carregando…'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-card-border text-[10.5px] uppercase tracking-wider text-muted">
                  <th className="px-4 py-2.5 font-bold sm:px-5">Evento</th>
                  <th className="px-3 py-2.5 font-bold">Ocupação</th>
                  <th className="px-3 py-2.5 text-right font-bold">Aguardando</th>
                  <th className="px-3 py-2.5 text-right font-bold">Pago pelos atletas</th>
                  <th className="px-4 py-2.5 text-right font-bold sm:px-5">Taxa WODArena</th>
                </tr>
              </thead>
              <tbody>
                {eventsForSale.map(event => {
                  const occupancy = event.slotsLimit > 0 ? Math.min(1, event.ticketsSold / event.slotsLimit) : null;
                  return (
                    <tr key={event.id} className="border-b border-card-border/60 last:border-b-0">
                      <td className="px-4 py-3 sm:px-5">
                        <span className="font-semibold text-white">{event.name}</span>{' '}
                        <span className="rounded border border-card-border px-1 font-number text-[10px] font-bold text-muted">{event.currency}</span>
                        <span className="block text-[11.5px] text-muted">
                          {event.managerName} · <span className={`rounded px-1 ${OWNER_TONE_CLASSES[OWNER_EVENT_SITUATION_TONES[event.situation]]}`}>{OWNER_EVENT_SITUATION_LABELS[event.situation]}</span>
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        {occupancy === null ? (
                          <span className="text-xs text-muted">{formatOwnerInteger(event.ticketsSold)} vendidas · sem limite</span>
                        ) : (
                          <div className="grid min-w-[110px] gap-1">
                            <span className="block h-1.5 overflow-hidden rounded-full bg-dark-gray"><span className="block h-full rounded-full bg-primary" style={{ width: `${Math.round(occupancy * 100)}%` }} /></span>
                            <span className="font-number text-[11.5px] text-muted">{formatOwnerInteger(event.ticketsSold)} de {formatOwnerInteger(event.slotsLimit)} · {Math.round(occupancy * 100)}%</span>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right font-number text-white">{formatOwnerInteger(event.pendingCount)}</td>
                      <td className="px-3 py-3 text-right font-number text-white">{formatOwnerMoney(event.collected, event.currency)}</td>
                      <td className="px-4 py-3 text-right font-number font-bold text-primary sm:px-5">{formatOwnerMoney(event.serviceFee, event.currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <OwnerRecentSignups externalQuery={signupsQuery} externalQueryNonce={signupsQueryNonce} />
    </div>
  );
}
