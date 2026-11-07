'use client';

import { useMemo, useState } from 'react';
import { ChevronRight, Clock3, Plus, Search, ShieldAlert } from 'lucide-react';
import { getCurrentBusinessDate, getManagerAccessStatusLabel, type ManagerAccessStatus } from '@/lib/managerAccess';
import {
  formatOwnerDate,
  OWNER_EVENT_SITUATION_LABELS,
  OWNER_EVENT_SITUATION_TONES,
  OWNER_RENEWAL_LABELS,
  renewServiceValidity,
  type OwnerRenewalOption
} from '@/lib/ownerFinance';
import type { OwnerOverviewEvent, OwnerOverviewManager } from '@/lib/ownerOverview';
import { OwnerDrawer } from '@/components/owner/OwnerDrawer';
import { OwnerNewManagerForm, type NewManagerInput } from '@/components/owner/OwnerNewManagerForm';
import { formatMoneyByCurrency, formatOwnerDateTime, formatOwnerInteger, OWNER_TONE_CLASSES } from '@/components/owner/ownerUi';

// Seção Gestores (Story 1.125, docs/design/painel-proprietario/): filtros com
// contagem, busca, tabela enxuta e painel lateral do gestor (validade com
// renovação rápida, números, conta de recebimento e eventos). O cadastro de gestor
// abre no mesmo painel. Os dados vêm de GET /api/owner/overview.

export type OwnerManagerFilter = 'all' | 'active' | 'expiring_soon' | 'expired' | 'unconfigured' | 'no_account';

const FILTERS: Array<{ id: OwnerManagerFilter; label: string; test: (manager: OwnerOverviewManager) => boolean }> = [
  { id: 'all', label: 'Todos', test: () => true },
  { id: 'active', label: 'Ativos', test: manager => manager.accessStatus === 'active' },
  { id: 'expiring_soon', label: 'Vencendo', test: manager => manager.accessStatus === 'expiring_soon' },
  { id: 'expired', label: 'Expirados', test: manager => manager.accessStatus === 'expired' },
  { id: 'unconfigured', label: 'Sem prazo', test: manager => manager.accessStatus === 'unconfigured' },
  { id: 'no_account', label: 'Sem conta de recebimento', test: manager => !manager.hasPaymentAccount }
];

const ACCESS_TONES: Record<ManagerAccessStatus, keyof typeof OWNER_TONE_CLASSES> = {
  active: 'ok',
  expiring_soon: 'warn',
  expired: 'crit',
  unconfigured: 'mute'
};

export const FEE_PAYER_LABELS = { athlete: 'Atleta paga', organizer: 'Gestor absorve' } as const;
export const getOwnerFeePayerLabel = (payer: 'athlete' | 'organizer' | null) => (payer ? FEE_PAYER_LABELS[payer] : 'Padrão do gateway');

export const filterOwnerManagers = (managers: OwnerOverviewManager[], filter: OwnerManagerFilter, query: string) => {
  const test = FILTERS.find(item => item.id === filter)?.test || (() => true);
  const needle = query.trim().toLocaleLowerCase('pt-BR');
  return managers.filter(manager => test(manager) && (
    !needle || `${manager.name} ${manager.email} ${manager.organization}`.toLocaleLowerCase('pt-BR').includes(needle)
  ));
};

type Props = {
  managers: OwnerOverviewManager[] | null;
  events: OwnerOverviewEvent[];
  filter: OwnerManagerFilter;
  onFilterChange: (filter: OwnerManagerFilter) => void;
  focusedManagerId: string | null;
  onFocusManager: (managerId: string | null) => void;
  /** Salva a validade; a página pede confirmação quando a data já passou. */
  onSaveValidity: (manager: OwnerOverviewManager, value: string) => Promise<void>;
  savingManagerId: string | null;
  notice: { text: string; isError: boolean };
  onCreateManager: (input: NewManagerInput) => Promise<{ success: true } | { success: false; error: string }>;
};

function AccessChip({ status }: { status: ManagerAccessStatus }) {
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${OWNER_TONE_CLASSES[ACCESS_TONES[status]]}`}>
      {getManagerAccessStatusLabel(status)}
    </span>
  );
}

function ManagerDetail({ manager, events, onSaveValidity, saving, notice }: {
  manager: OwnerOverviewManager;
  events: OwnerOverviewEvent[];
  onSaveValidity: Props['onSaveValidity'];
  saving: boolean;
  notice: Props['notice'];
}) {
  const [draft, setDraft] = useState(manager.serviceValidUntil || '');
  const today = getCurrentBusinessDate();
  const changed = draft !== (manager.serviceValidUntil || '');
  const managerEvents = events.filter(event => event.organizerId === manager.id);

  const stats: Array<[string, string]> = [
    ['Eventos', formatOwnerInteger(manager.eventsCount)],
    ['Inscrições aprovadas', formatOwnerInteger(manager.paidCount)],
    ['Aguardando pagamento', formatOwnerInteger(manager.pendingCount)],
    ['Pago pelos atletas', formatMoneyByCurrency(manager.money, 'collected')],
    ['Taxa WODArena', formatMoneyByCurrency(manager.money, 'serviceFee')],
    ['Repassado ao gestor', formatMoneyByCurrency(manager.money, 'netRevenue')]
  ];

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <AccessChip status={manager.accessStatus} />
        <span className="text-xs text-muted">{manager.serviceValidUntil ? `Válido até ${formatOwnerDate(manager.serviceValidUntil)}` : 'Sem prazo definido'}</span>
      </div>
      {manager.accessStatus === 'expired' && (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-red-300"><ShieldAlert className="h-3.5 w-3.5" aria-hidden /> Painel e vendas bloqueados</p>
      )}
      {manager.accessStatus === 'expiring_soon' && (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-300"><Clock3 className="h-3.5 w-3.5" aria-hidden /> Renovar em breve</p>
      )}

      <section aria-labelledby="owner-renew-title" className="space-y-3 rounded-xl border border-card-border bg-card p-4">
        <h3 id="owner-renew-title" className="text-sm font-bold">Renovar acesso</h3>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(OWNER_RENEWAL_LABELS) as OwnerRenewalOption[]).map(option => (
            <button
              key={option}
              type="button"
              onClick={() => setDraft(renewServiceValidity(manager.serviceValidUntil, option, today))}
              className="min-h-11 rounded-md border border-card-border bg-dark-gray px-3 text-xs font-bold text-white transition-colors hover:border-primary/50"
            >
              {OWNER_RENEWAL_LABELS[option]}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="sr-only" htmlFor={`manager-validity-${manager.id}`}>Validade de uso de {manager.name}</label>
          <input
            id={`manager-validity-${manager.id}`}
            type="date"
            value={draft}
            onChange={event => setDraft(event.target.value)}
            className="min-h-11 flex-1 rounded-lg border border-card-border bg-background px-3 text-sm text-white focus:border-primary/50 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void onSaveValidity(manager, draft)}
            disabled={saving || !changed}
            className="min-h-11 rounded-md bg-primary px-4 text-xs font-bold uppercase tracking-wider text-black transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Salvando…' : 'Salvar validade'}
          </button>
        </div>
        <p className="text-xs text-muted">As renovações contam a partir da validade atual, ou de hoje se ela já venceu. Uma data que já passou bloqueia o gestor e pede confirmação.</p>
        {notice.text && (
          <p role={notice.isError ? 'alert' : 'status'} className={`text-xs font-semibold ${notice.isError ? 'text-red-300' : 'text-primary'}`}>{notice.text}</p>
        )}
      </section>

      <dl className="grid grid-cols-2 gap-2">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-card-border bg-card px-3 py-2.5">
            <dt className="text-[10.5px] font-bold uppercase tracking-wider text-muted">{label}</dt>
            <dd className="mt-0.5 font-number text-sm font-bold">{value}</dd>
          </div>
        ))}
      </dl>

      <dl className="divide-y divide-card-border rounded-xl border border-card-border bg-card px-4 text-sm">
        <div className="flex justify-between gap-3 py-2.5"><dt className="text-muted">Quem paga a taxa</dt><dd className="font-semibold">{getOwnerFeePayerLabel(manager.feePayer)}</dd></div>
        <div className="flex justify-between gap-3 py-2.5">
          <dt className="text-muted">Conta de recebimento</dt>
          <dd className={`font-semibold ${manager.hasPaymentAccount ? 'text-primary' : 'text-amber-300'}`}>{manager.hasPaymentAccount ? 'Conectada' : 'Não conectada'}</dd>
        </div>
        <div className="flex justify-between gap-3 py-2.5"><dt className="text-muted">Cadastro</dt><dd className="font-semibold">{formatOwnerDateTime(manager.createdAt)}</dd></div>
      </dl>

      <section aria-labelledby="owner-manager-events-title" className="space-y-2">
        <h3 id="owner-manager-events-title" className="text-sm font-bold">Eventos</h3>
        {managerEvents.length === 0 ? (
          <p className="text-sm text-muted">Nenhum evento criado.</p>
        ) : (
          <ul className="divide-y divide-card-border rounded-xl border border-card-border bg-card px-4">
            {managerEvents.map(event => (
              <li key={event.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="min-w-0 truncate font-semibold">{event.name}</span>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${OWNER_TONE_CLASSES[OWNER_EVENT_SITUATION_TONES[event.situation]]}`}>
                  {OWNER_EVENT_SITUATION_LABELS[event.situation]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export function OwnerManagersSection(props: Props) {
  const { managers, events, filter, onFilterChange, focusedManagerId, onFocusManager, onSaveValidity, savingManagerId, notice, onCreateManager } = props;
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createdNotice, setCreatedNotice] = useState('');

  const visible = useMemo(() => filterOwnerManagers(managers || [], filter, query), [managers, filter, query]);
  const focused = managers?.find(manager => manager.id === focusedManagerId) || null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar gestores">
          {FILTERS.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => onFilterChange(item.id)}
              aria-pressed={filter === item.id}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors ${
                filter === item.id ? 'border-primary/50 bg-primary/10 text-white' : 'border-card-border bg-card text-muted hover:text-white'
              }`}
            >
              {item.label}
              <span className={`font-number ${filter === item.id ? 'text-primary' : 'text-muted'}`}>{(managers || []).filter(item.test).length}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="flex min-h-11 flex-1 items-center gap-2 rounded-lg border border-card-border bg-dark-gray px-3 text-muted focus-within:border-primary/50 sm:w-60 sm:flex-none">
            <Search className="h-4 w-4 shrink-0" aria-hidden />
            <span className="sr-only">Buscar gestor</span>
            <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Nome, e-mail ou box" className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder:text-muted focus:outline-none" />
          </label>
          <button
            type="button"
            onClick={() => { setCreatedNotice(''); setCreating(true); }}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-primary px-4 text-xs font-bold uppercase tracking-wider text-black transition-colors hover:bg-primary-hover"
          >
            <Plus className="h-4 w-4" aria-hidden /> Novo gestor
          </button>
        </div>
      </div>

      {createdNotice && <p role="status" className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary">{createdNotice}</p>}

      {managers === null ? (
        <p className="rounded-xl border border-card-border bg-card px-4 py-10 text-center text-sm text-muted">Carregando gestores…</p>
      ) : visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-card-border bg-card px-4 py-10 text-center text-sm text-muted">Nenhum gestor com esse filtro.</p>
      ) : (
        <>
          <ul className="space-y-3 lg:hidden">
            {visible.map(manager => (
              <li key={manager.id}>
                <button type="button" onClick={() => onFocusManager(manager.id)} className="w-full rounded-xl border border-card-border bg-card p-4 text-left transition-colors hover:border-primary/40">
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold text-white">{manager.name}</span>
                      <span className="block truncate text-xs text-muted">{manager.organization || manager.email}</span>
                    </span>
                    <AccessChip status={manager.accessStatus} />
                  </span>
                  <span className="mt-3 grid grid-cols-2 gap-2 border-t border-card-border pt-3 text-xs">
                    <span><span className="block text-[10px] uppercase tracking-wider text-muted">Validade</span><span className="text-white">{formatOwnerDate(manager.serviceValidUntil) || 'Não definido'}</span></span>
                    <span><span className="block text-[10px] uppercase tracking-wider text-muted">Eventos</span><span className="font-number text-white">{manager.eventsCount}</span></span>
                    <span><span className="block text-[10px] uppercase tracking-wider text-muted">Taxa WODArena</span><span className="font-number text-primary">{formatMoneyByCurrency(manager.money, 'serviceFee')}</span></span>
                    <span><span className="block text-[10px] uppercase tracking-wider text-muted">Quem paga a taxa</span><span className="text-white">{getOwnerFeePayerLabel(manager.feePayer)}</span></span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto rounded-xl border border-card-border bg-card lg:block">
            <table className="w-full border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-card-border text-[10.5px] uppercase tracking-wider text-muted">
                  <th className="px-4 py-3 font-bold">Gestor</th>
                  <th className="px-3 py-3 font-bold">Acesso</th>
                  <th className="px-3 py-3 text-right font-bold">Eventos</th>
                  <th className="px-3 py-3 text-right font-bold">Aprovadas / aguardando</th>
                  <th className="px-3 py-3 text-right font-bold">Taxa WODArena</th>
                  <th className="px-3 py-3 font-bold">Quem paga a taxa</th>
                  <th className="w-10 px-3 py-3"><span className="sr-only">Abrir</span></th>
                </tr>
              </thead>
              <tbody>
                {visible.map(manager => (
                  <tr
                    key={manager.id}
                    tabIndex={0}
                    onClick={() => onFocusManager(manager.id)}
                    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onFocusManager(manager.id); } }}
                    className="cursor-pointer border-b border-card-border/60 last:border-b-0 hover:bg-dark-gray/60 focus-visible:bg-dark-gray/60 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-info"
                  >
                    <td className="px-4 py-3">
                      <span className="block font-semibold text-white">{manager.name}</span>
                      <span className="block text-[11.5px] text-muted">{[manager.organization, manager.email].filter(Boolean).join(' · ')}</span>
                    </td>
                    <td className="px-3 py-3">
                      <AccessChip status={manager.accessStatus} />
                      <span className="mt-1 block text-[11.5px] text-muted">{formatOwnerDate(manager.serviceValidUntil) || 'Não definido'}</span>
                    </td>
                    <td className="px-3 py-3 text-right font-number text-white">{manager.eventsCount}</td>
                    <td className="px-3 py-3 text-right font-number text-white">
                      {formatOwnerInteger(manager.paidCount)} <span className="text-muted">/</span> <span className="text-amber-300">{formatOwnerInteger(manager.pendingCount)}</span>
                    </td>
                    <td className="px-3 py-3 text-right font-number font-bold text-primary">{formatMoneyByCurrency(manager.money, 'serviceFee')}</td>
                    <td className="px-3 py-3 text-muted">{getOwnerFeePayerLabel(manager.feePayer)}</td>
                    <td className="px-3 py-3 text-muted"><ChevronRight className="h-4 w-4" aria-hidden /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">Clique em um gestor para renovar o acesso, ver os eventos e o que já vendeu.</p>
        </>
      )}

      {focused && (
        <OwnerDrawer title={focused.name} subtitle={[focused.organization, focused.email].filter(Boolean).join(' · ')} onClose={() => onFocusManager(null)} busy={savingManagerId === focused.id}>
          <ManagerDetail
            key={`${focused.id}-${focused.serviceValidUntil || ''}`}
            manager={focused}
            events={events}
            onSaveValidity={onSaveValidity}
            saving={savingManagerId === focused.id}
            notice={notice}
          />
        </OwnerDrawer>
      )}

      {creating && (
        <OwnerDrawer title="Novo gestor" subtitle="Credenciais de acesso e prazo de uso" onClose={() => setCreating(false)} busy={createBusy}>
          <OwnerNewManagerForm
            onCreate={onCreateManager}
            onBusyChange={setCreateBusy}
            onCreated={name => {
              setCreating(false);
              setCreatedNotice(`Conta de gestor para "${name}" criada com sucesso.`);
            }}
          />
        </OwnerDrawer>
      )}
    </div>
  );
}
