'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { ChevronRight, ExternalLink, Search } from 'lucide-react';
import { OWNER_EVENT_SITUATION_LABELS, OWNER_EVENT_SITUATION_TONES, type OwnerEventSituation } from '@/lib/ownerFinance';
import type { OwnerOverviewEvent } from '@/lib/ownerOverview';
import { OwnerDrawer } from '@/components/owner/OwnerDrawer';
import { formatOwnerInteger, formatOwnerMoney, OWNER_TONE_CLASSES } from '@/components/owner/ownerUi';

// Seção Eventos (Story 1.125, docs/design/painel-proprietario/): uma tabela só,
// com filtro por situação e busca; o detalhe do evento abre no painel lateral com
// a divisão do dinheiro e a aba Ranking. A situação segue o ciclo de vida do site
// (getEventStatus). Os números vêm de GET /api/owner/overview.

export type OwnerEventFilter = 'all' | 'sale' | 'closed' | 'blocked' | 'finished';

const FILTERS: Array<{ id: OwnerEventFilter; label: string; situations: OwnerEventSituation[] | null }> = [
  { id: 'all', label: 'Todos', situations: null },
  { id: 'sale', label: 'À venda', situations: ['live', 'open', 'closing'] },
  { id: 'closed', label: 'Vendas encerradas', situations: ['sales_closed'] },
  { id: 'blocked', label: 'Bloqueados', situations: ['blocked'] },
  { id: 'finished', label: 'Encerrados', situations: ['finished'] }
];

export const filterOwnerEvents = (events: OwnerOverviewEvent[], filter: OwnerEventFilter, query: string) => {
  const situations = FILTERS.find(item => item.id === filter)?.situations || null;
  const needle = query.trim().toLocaleLowerCase('pt-BR');
  return events.filter(event => (!situations || situations.includes(event.situation)) && (
    !needle || `${event.name} ${event.managerName}`.toLocaleLowerCase('pt-BR').includes(needle)
  ));
};

const occupancyOf = (event: OwnerOverviewEvent) => (event.slotsLimit > 0 ? Math.min(1, event.ticketsSold / event.slotsLimit) : null);

function SituationChip({ situation }: { situation: OwnerEventSituation }) {
  return (
    <span className={`inline-flex whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${OWNER_TONE_CLASSES[OWNER_EVENT_SITUATION_TONES[situation]]}`}>
      {OWNER_EVENT_SITUATION_LABELS[situation]}
    </span>
  );
}

function Occupancy({ event }: { event: OwnerOverviewEvent }) {
  const occupancy = occupancyOf(event);
  if (occupancy === null) return <span className="text-xs text-muted">{formatOwnerInteger(event.ticketsSold)} vendidas · sem limite</span>;
  return (
    <span className="grid min-w-[110px] gap-1">
      <span className="block h-1.5 overflow-hidden rounded-full bg-dark-gray"><span className="block h-full rounded-full bg-primary" style={{ width: `${Math.round(occupancy * 100)}%` }} /></span>
      <span className="font-number text-[11.5px] text-muted">{formatOwnerInteger(event.ticketsSold)} de {formatOwnerInteger(event.slotsLimit)} · {Math.round(occupancy * 100)}%</span>
    </span>
  );
}

type Props = {
  events: OwnerOverviewEvent[] | null;
  /** Ranking do evento (a página monta o Leaderboard com o evento completo do contexto); null sem ranking. */
  renderRanking: (eventId: string) => ReactNode;
};

export function OwnerEventsSection({ events, renderRanking }: Props) {
  const [filter, setFilter] = useState<OwnerEventFilter>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<'money' | 'ranking'>('money');

  const visible = useMemo(() => filterOwnerEvents(events || [], filter, query), [events, filter, query]);
  const selected = events?.find(event => event.id === selectedId) || null;
  const ranking = selected && tab === 'ranking' ? renderRanking(selected.id) : null;

  const open = (eventId: string) => {
    setTab('money');
    setSelectedId(eventId);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar eventos">
          {FILTERS.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id)}
              aria-pressed={filter === item.id}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors ${
                filter === item.id ? 'border-primary/50 bg-primary/10 text-white' : 'border-card-border bg-card text-muted hover:text-white'
              }`}
            >
              {item.label}
              <span className={`font-number ${filter === item.id ? 'text-primary' : 'text-muted'}`}>{filterOwnerEvents(events || [], item.id, '').length}</span>
            </button>
          ))}
        </div>
        <label className="flex min-h-11 items-center gap-2 rounded-lg border border-card-border bg-dark-gray px-3 text-muted focus-within:border-primary/50 lg:w-64">
          <Search className="h-4 w-4 shrink-0" aria-hidden />
          <span className="sr-only">Buscar evento</span>
          <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Evento ou gestor" className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder:text-muted focus:outline-none" />
        </label>
      </div>

      {events === null ? (
        <p className="rounded-xl border border-card-border bg-card px-4 py-10 text-center text-sm text-muted">Carregando eventos…</p>
      ) : visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-card-border bg-card px-4 py-10 text-center text-sm text-muted">Nenhum evento com esse filtro.</p>
      ) : (
        <>
          <ul className="space-y-3 lg:hidden">
            {visible.map(event => (
              <li key={event.id}>
                <button type="button" onClick={() => open(event.id)} className="w-full rounded-xl border border-card-border bg-card p-4 text-left transition-colors hover:border-primary/40">
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold text-white">{event.name} <span className="font-number text-[10px] text-muted">{event.currency}</span></span>
                      <span className="block truncate text-xs text-muted">{event.managerName} · {event.date}</span>
                    </span>
                    <SituationChip situation={event.situation} />
                  </span>
                  <span className="mt-3 grid grid-cols-2 gap-2 border-t border-card-border pt-3 text-xs">
                    <span><span className="block text-[10px] uppercase tracking-wider text-muted">Pago pelos atletas</span><span className="font-number text-white">{formatOwnerMoney(event.collected, event.currency)}</span></span>
                    <span><span className="block text-[10px] uppercase tracking-wider text-muted">Taxa WODArena</span><span className="font-number text-primary">{formatOwnerMoney(event.serviceFee, event.currency)}</span></span>
                    <span className="col-span-2"><Occupancy event={event} /></span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto rounded-xl border border-card-border bg-card lg:block">
            <table className="w-full border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-card-border text-[10.5px] uppercase tracking-wider text-muted">
                  <th className="px-4 py-3 font-bold">Evento</th>
                  <th className="px-3 py-3 font-bold">Data</th>
                  <th className="px-3 py-3 font-bold">Situação</th>
                  <th className="px-3 py-3 font-bold">Ocupação</th>
                  <th className="px-3 py-3 text-right font-bold">Aguardando</th>
                  <th className="px-3 py-3 text-right font-bold">Pago pelos atletas</th>
                  <th className="px-3 py-3 text-right font-bold">Taxa WODArena</th>
                  <th className="w-10 px-3 py-3"><span className="sr-only">Abrir</span></th>
                </tr>
              </thead>
              <tbody>
                {visible.map(event => (
                  <tr
                    key={event.id}
                    tabIndex={0}
                    onClick={() => open(event.id)}
                    onKeyDown={keyEvent => { if (keyEvent.key === 'Enter' || keyEvent.key === ' ') { keyEvent.preventDefault(); open(event.id); } }}
                    className="cursor-pointer border-b border-card-border/60 last:border-b-0 hover:bg-dark-gray/60 focus-visible:bg-dark-gray/60 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-info"
                  >
                    <td className="px-4 py-3">
                      <span className="font-semibold text-white">{event.name}</span>{' '}
                      <span className="rounded border border-card-border px-1 font-number text-[10px] font-bold text-muted">{event.currency}</span>
                      <span className="block text-[11.5px] text-muted">{event.managerName}</span>
                    </td>
                    <td className="px-3 py-3 text-muted">{event.date}</td>
                    <td className="px-3 py-3"><SituationChip situation={event.situation} /></td>
                    <td className="px-3 py-3"><Occupancy event={event} /></td>
                    <td className="px-3 py-3 text-right font-number text-white">{formatOwnerInteger(event.pendingCount)}</td>
                    <td className="px-3 py-3 text-right font-number text-white">{formatOwnerMoney(event.collected, event.currency)}</td>
                    <td className="px-3 py-3 text-right font-number font-bold text-primary">{formatOwnerMoney(event.serviceFee, event.currency)}</td>
                    <td className="px-3 py-3 text-muted"><ChevronRight className="h-4 w-4" aria-hidden /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">A situação segue o ciclo de vida do site. Clique em um evento para ver a divisão do dinheiro e o ranking.</p>
        </>
      )}

      {selected && (
        <OwnerDrawer title={selected.name} subtitle={`${selected.managerName} · ${selected.date}`} onClose={() => setSelectedId(null)}>
          <div className="flex flex-wrap items-center gap-2">
            <SituationChip situation={selected.situation} />
            <span className="rounded border border-card-border px-1 font-number text-[10px] font-bold text-muted">{selected.currency}</span>
            <a href={`/event/${encodeURIComponent(selected.id)}`} target="_blank" rel="noreferrer" className="ml-auto inline-flex min-h-9 items-center gap-1 text-xs font-bold text-primary hover:underline">
              Página do evento <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          </div>

          <div role="tablist" aria-label="Detalhe do evento" className="flex gap-1 border-b border-card-border">
            {([['money', 'Dinheiro'], ['ranking', 'Ranking']] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`owner-event-tab-${id}`}
                aria-selected={tab === id}
                aria-controls={`owner-event-panel-${id}`}
                onClick={() => setTab(id)}
                className={`min-h-11 border-b-2 px-3 text-sm font-semibold transition-colors ${tab === id ? 'border-primary text-white' : 'border-transparent text-muted hover:text-white'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'money' ? (
            <div role="tabpanel" id="owner-event-panel-money" aria-labelledby="owner-event-tab-money" className="space-y-4">
              <dl className="divide-y divide-card-border rounded-xl border border-card-border bg-card px-4 text-sm">
                <div className="flex justify-between gap-3 py-3"><dt className="text-muted">Pago pelos atletas</dt><dd className="font-number font-bold">{formatOwnerMoney(selected.collected, selected.currency)}</dd></div>
                <div className="flex justify-between gap-3 py-3"><dt className="text-muted">Taxa WODArena</dt><dd className="font-number font-bold text-primary">{formatOwnerMoney(selected.serviceFee, selected.currency)}</dd></div>
                <div className="flex justify-between gap-3 py-3"><dt className="text-muted">Repassado ao gestor</dt><dd className="font-number font-bold">{formatOwnerMoney(selected.netRevenue, selected.currency)}</dd></div>
              </dl>
              <p className="text-xs text-muted">Só inscrições aprovadas, pela mesma regra do painel do gestor: pago = ingresso e taxa; repasse = ingresso, menos a taxa quando o gestor a absorve.</p>
              <dl className="grid grid-cols-2 gap-2">
                {([
                  ['Inscrições aprovadas', formatOwnerInteger(selected.paidCount)],
                  ['Aguardando pagamento', formatOwnerInteger(selected.pendingCount)],
                  ['Em análise há mais de 48 h', formatOwnerInteger(selected.staleReviewCount)],
                  ['Vagas vendidas', selected.slotsLimit > 0 ? `${formatOwnerInteger(selected.ticketsSold)} de ${formatOwnerInteger(selected.slotsLimit)}` : formatOwnerInteger(selected.ticketsSold)]
                ] as const).map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-card-border bg-card px-3 py-2.5">
                    <dt className="text-[10.5px] font-bold uppercase tracking-wider text-muted">{label}</dt>
                    <dd className="mt-0.5 font-number text-sm font-bold">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : (
            <div role="tabpanel" id="owner-event-panel-ranking" aria-labelledby="owner-event-tab-ranking">
              {ranking ?? <p className="text-sm text-muted">Ranking indisponível para este evento agora.</p>}
            </div>
          )}
        </OwnerDrawer>
      )}
    </div>
  );
}
