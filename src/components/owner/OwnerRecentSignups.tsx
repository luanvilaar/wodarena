'use client';

import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type { OwnerSignupItem, OwnerSignupKind } from '@/lib/serverOwnerSignups';
import { formatOwnerDateTime } from '@/components/owner/ownerUi';

// Cartão "Cadastros recentes" da Visão geral (Story 1.124, decisão E2): gestores,
// contas de atleta, inscrições e leads, do mais novo para o mais antigo, com busca
// por nome ou e-mail e "Carregar mais", tudo paginado no servidor
// (GET /api/owner/signups). A busca do topo do painel preenche o mesmo campo.

export const OWNER_SIGNUP_KIND_LABELS: Record<OwnerSignupKind, string> = {
  manager: 'Gestor',
  athlete_account: 'Conta de atleta',
  registration: 'Inscrição',
  lead: 'Lead'
};

const KIND_FILTERS: Array<{ id: OwnerSignupKind | 'all'; label: string }> = [
  { id: 'all', label: 'Todos' },
  { id: 'manager', label: 'Gestores' },
  { id: 'athlete_account', label: 'Contas de atleta' },
  { id: 'registration', label: 'Inscrições' },
  { id: 'lead', label: 'Leads' }
];

const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 300;

type Props = {
  /** Termo vindo da busca do topo; muda o campo e refaz a busca. */
  externalQuery: string;
  /** Muda a cada busca do topo, para focar o cartão mesmo com o mesmo termo. */
  externalQueryNonce: number;
};

export function OwnerRecentSignups({ externalQuery, externalQueryNonce }: Props) {
  const [query, setQuery] = useState(externalQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(externalQuery);
  const [kind, setKind] = useState<OwnerSignupKind | 'all'>('all');
  const [items, setItems] = useState<OwnerSignupItem[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const requestRef = useRef(0);
  const cardRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // A busca do topo remonta o cartão com o termo (key no pai) e o traz para a tela.
  useEffect(() => {
    if (externalQueryNonce === 0) return;
    cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    inputRef.current?.focus({ preventScroll: true });
  }, [externalQueryNonce]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const buildUrl = (before?: string | null) => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (debouncedQuery.trim()) params.set('q', debouncedQuery.trim());
    if (kind !== 'all') params.set('kind', kind);
    if (before) params.set('before', before);
    return `/api/owner/signups?${params.toString()}`;
  };

  useEffect(() => {
    const requestId = ++requestRef.current;
    const load = async () => {
      setStatus('loading');
      setError('');
      try {
        const response = await fetch(buildUrl());
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Não foi possível carregar os cadastros.');
        if (requestId !== requestRef.current) return;
        setItems(data.items || []);
        setNextBefore(data.nextBefore || null);
        setStatus('ready');
      } catch (cause) {
        if (requestId !== requestRef.current) return;
        setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os cadastros.');
        setStatus('error');
      }
    };
    void load();
    // buildUrl lê só debouncedQuery e kind.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, kind]);

  const loadMore = async () => {
    if (!nextBefore || loadingMore) return;
    const requestId = requestRef.current;
    setLoadingMore(true);
    try {
      const response = await fetch(buildUrl(nextBefore));
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Não foi possível carregar mais cadastros.');
      if (requestId !== requestRef.current) return;
      setItems(previous => {
        const seen = new Set(previous.map(item => `${item.kind}:${item.id}`));
        return [...previous, ...(data.items || []).filter((item: OwnerSignupItem) => !seen.has(`${item.kind}:${item.id}`))];
      });
      setNextBefore(data.nextBefore || null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar mais cadastros.');
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <section ref={cardRef} aria-labelledby="owner-signups-title" className="scroll-mt-4 space-y-4 rounded-xl border border-card-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="owner-signups-title" className="text-sm font-bold text-white">Cadastros recentes</h2>
        <p className="text-xs text-muted">Gestores, contas de atleta, inscrições e leads, do mais novo para o mais antigo</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="flex min-h-11 flex-1 items-center gap-2 rounded-lg border border-card-border bg-dark-gray px-3 text-muted focus-within:border-primary/50">
          <Search className="h-4 w-4 shrink-0" aria-hidden />
          <span className="sr-only">Buscar cadastro por nome ou e-mail</span>
          <input
            ref={inputRef}
            id="owner-signups-search"
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Buscar por nome ou e-mail"
            className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder:text-muted focus:outline-none"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tipo de cadastro">
        {KIND_FILTERS.map(filter => (
          <button
            key={filter.id}
            type="button"
            onClick={() => setKind(filter.id)}
            aria-pressed={kind === filter.id}
            className={`min-h-9 rounded-full border px-3 text-xs font-semibold transition-colors ${
              kind === filter.id ? 'border-primary/50 bg-primary/10 text-white' : 'border-card-border bg-dark-gray text-muted hover:text-white'
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-950/20 px-3 py-2 text-xs text-red-300">{error}</p>}

      {status === 'loading' ? (
        <p className="py-6 text-center text-sm text-muted" aria-live="polite">Carregando cadastros…</p>
      ) : status === 'ready' && items.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">
          {debouncedQuery.trim() ? `Nenhum cadastro encontrado para "${debouncedQuery.trim()}".` : 'Nenhum cadastro ainda.'}
        </p>
      ) : (
        <ul className="divide-y divide-card-border" aria-live="polite">
          {items.map(item => (
            <li key={`${item.kind}:${item.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 py-3 first:pt-0">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{item.name || 'Sem nome'}</p>
                <p className="truncate text-xs text-muted">
                  {[item.contact, item.detail].filter(Boolean).join(' · ') || '—'}
                </p>
              </div>
              <div className="text-right">
                <span className="inline-flex rounded-full bg-dark-gray px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted">
                  {OWNER_SIGNUP_KIND_LABELS[item.kind]}
                </span>
                <p className="mt-1 whitespace-nowrap font-number text-[11px] text-muted">{formatOwnerDateTime(item.createdAt)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {nextBefore && status === 'ready' && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          className="min-h-11 w-full rounded-md border border-card-border bg-dark-gray text-xs font-bold uppercase tracking-wider text-white transition-colors hover:border-primary/50 disabled:cursor-wait disabled:opacity-60"
        >
          {loadingMore ? 'Carregando…' : 'Carregar mais'}
        </button>
      )}
    </section>
  );
}
