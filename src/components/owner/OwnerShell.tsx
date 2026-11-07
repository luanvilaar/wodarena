'use client';

import { useState, type ComponentType, type FormEvent, type ReactNode } from 'react';
import { Calendar, Inbox, LayoutDashboard, LogOut, Search, SlidersHorizontal, Users } from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import { OWNER_SECTION_IDS, OWNER_SECTION_LABELS, type OwnerSectionId } from '@/lib/ownerSections';

// Moldura do painel do proprietário (Story 1.123, decisões D1 e D2 de
// docs/design/painel-proprietario/): barra lateral no computador, faixa de seções
// no celular, sem o menu e o rodapé do site público. O conteúdo da seção fica num
// <div>: o <main> é o do layout.

const SECTION_ICONS: Record<OwnerSectionId, ComponentType<{ className?: string; 'aria-hidden'?: boolean }>> = {
  'visao-geral': LayoutDashboard,
  gestores: Users,
  eventos: Calendar,
  comercial: Inbox,
  configuracoes: SlidersHorizontal
};

export type OwnerSectionBadge = { count: number; tone: 'warn' | 'neutral'; label: string };

type Props = {
  active: OwnerSectionId;
  onNavigate: (section: OwnerSectionId) => void;
  badges: Partial<Record<OwnerSectionId, OwnerSectionBadge>>;
  userName: string;
  onLogout: () => void;
  /** Controles do topo da seção (ex.: o período da Visão geral). */
  toolbar?: ReactNode;
  /** Busca de cadastros no topo (Story 1.124, E2): leva aos "Cadastros recentes" da Visão geral. */
  onSearch?: (term: string) => void;
  children: ReactNode;
};

export function OwnerShell({ active, onNavigate, badges, userName, onLogout, toolbar, onSearch, children }: Props) {
  const [searchDraft, setSearchDraft] = useState('');
  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSearch?.(searchDraft.trim());
  };

  return (
    <div className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="border-b border-card-border bg-dark-gray lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-3 px-4 pt-4 lg:px-5 lg:pt-5">
          <BrandLogo className="h-9 w-9 shrink-0 rounded-sm border border-card-border" priority />
          <div className="min-w-0">
            <p className="text-sm font-bold text-white">WODArena</p>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Proprietário</p>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-md border border-card-border px-3 text-xs font-bold text-muted transition-colors hover:border-red-500/40 hover:text-white lg:hidden"
          >
            Sair <LogOut className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>

        <nav aria-label="Seções do painel do proprietário" className="mt-3 overflow-x-auto px-2 pb-2 scrollbar-none lg:mt-6 lg:flex-1 lg:overflow-visible lg:px-3">
          <ul className="flex snap-x snap-mandatory gap-1 lg:flex-col lg:gap-1">
            {OWNER_SECTION_IDS.map(section => {
              const Icon = SECTION_ICONS[section];
              const badge = badges[section];
              const isActive = section === active;
              return (
                <li key={section} className="shrink-0 snap-start lg:shrink">
                  <button
                    type="button"
                    onClick={() => onNavigate(section)}
                    aria-current={isActive ? 'page' : undefined}
                    className={`flex min-h-11 w-full items-center gap-2.5 whitespace-nowrap rounded-md px-3 text-[13.5px] font-semibold transition-colors ${
                      isActive ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-card hover:text-white'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden />
                    <span className="flex-1 text-left">{OWNER_SECTION_LABELS[section]}</span>
                    {badge && badge.count > 0 && (
                      <span
                        className={`grid h-5 min-w-5 place-items-center rounded-full px-1.5 font-number text-[11px] font-bold ${
                          badge.tone === 'warn' ? 'bg-amber-400/15 text-amber-300' : 'bg-card text-white'
                        }`}
                        aria-label={badge.label}
                      >
                        {badge.count}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="hidden border-t border-card-border px-5 py-4 lg:block">
          <p className="truncate text-xs text-muted">{userName}</p>
          <button
            type="button"
            onClick={onLogout}
            className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-md border border-card-border px-3 text-xs font-bold text-muted transition-colors hover:border-red-500/40 hover:text-white"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden /> Sair
          </button>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-card-border px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted">Painel do proprietário</p>
            <h1 className="text-xl font-bold text-white">{OWNER_SECTION_LABELS[active]}</h1>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            {onSearch && (
              <form role="search" onSubmit={submitSearch} className="flex min-h-11 w-full items-center gap-2 rounded-lg border border-card-border bg-dark-gray px-3 text-muted focus-within:border-primary/50 sm:w-64">
                <Search className="h-4 w-4 shrink-0" aria-hidden />
                <label htmlFor="owner-top-search" className="sr-only">Buscar cadastro por nome ou e-mail</label>
                <input
                  id="owner-top-search"
                  type="search"
                  value={searchDraft}
                  onChange={event => setSearchDraft(event.target.value)}
                  placeholder="Buscar cadastro"
                  className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder:text-muted focus:outline-none"
                />
              </form>
            )}
            {toolbar}
          </div>
        </header>
        <div className="space-y-6 px-4 py-6 sm:px-6">{children}</div>
      </div>
    </div>
  );
}
