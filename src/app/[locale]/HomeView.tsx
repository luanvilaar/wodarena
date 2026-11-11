'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { useApp } from '@/context/AppContext';
import { EventCard } from '@/components/EventCard';
import { ProductStory } from '@/components/home/ProductStory';
import { HeroVideo } from '@/components/home/HeroVideo';
import { HomeFilterSheet } from '@/components/home/HomeFilterSheet';
import { Search, SlidersHorizontal } from 'lucide-react';
import type { AppLocale, Event } from '@/types';
import { toBcp47 } from '@/i18n/locales';
import { compareEventsByDateAsc, compareEventsByDateDesc, getEventStatus } from '@/lib/eventStatus';
import { isFeaturedHomeCandidate } from '@/lib/homeShowcase';
import {
  EMPTY_HOME_FILTERS,
  availableUfs,
  countActiveFilters,
  formatMonthLabel,
  groupByMonth,
  matchesHomeFilters,
  parseStatusParam,
  type HomeFilters,
  type HomeTab,
} from '@/lib/homeFilters';

// Home com o atleta primeiro (Story 1.132) e busca em chips, abas e meses
// (Story 1.133), P2 e P3 de docs/design/mobile-competitivo/. O vídeo
// institucional é o fundo do topo (Story 1.136); o restante do hero
// institucional e o formulário comercial ficam em /organizadores.

// Grade de cards: cada card leva a coluna em que cai para a cascata de entrada
// entre colunas (Story 1.65).
function EventGrid({ events, priorityFirst = false }: { events: Event[]; priorityFirst?: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
      {events.map((event, index) => (
        <div
          key={event.id}
          className="event-card-slot h-full"
          style={{ '--ec-col-sm': index % 2, '--ec-col-lg': index % 3 } as React.CSSProperties}
        >
          <EventCard event={event} priority={priorityFirst && index === 0} />
        </div>
      ))}
    </div>
  );
}

function GroupHeading({ id, title, count }: { id: string; title: string; count: string }) {
  return (
    <div className="flex items-center gap-3">
      <h2 id={id} className="text-base font-bold uppercase tracking-wide text-white">{title}</h2>
      <span className="h-px flex-1 bg-card-border" aria-hidden="true" />
      <span className="text-xs font-semibold text-muted">{count}</span>
    </div>
  );
}

const chipClass = (active: boolean) =>
  `inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition-colors ${
    active ? 'border-primary bg-primary text-ink' : 'border-card-border bg-transparent text-foreground hover:border-muted'
  }`;

export function HomeView() {
  const t = useTranslations('Home');
  const locale = useLocale() as AppLocale;
  const { events } = useApp();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<HomeTab>('upcoming');
  const [filters, setFilters] = useState<HomeFilters>(EMPTY_HOME_FILTERS);
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);
  const closeFilterSheet = useCallback(() => setIsFilterSheetOpen(false), []);

  // Links antigos do rodapé e de campanhas ("/?organizar=1") abriam o modal de
  // contato comercial; o formulário agora mora em /organizadores.
  const wantsOrganizers = searchParams.get('organizar') === '1';
  useEffect(() => {
    if (wantsOrganizers) router.replace('/organizadores#contato');
  }, [wantsOrganizers, router]);

  // "Ao vivo" da barra do rodapé (Story 1.129) chega como "/?status=live#eventos".
  const statusParam = searchParams.get('status');
  useEffect(() => {
    const parsed = parseStatusParam(statusParam);
    if (!parsed) return;
    const timer = setTimeout(() => {
      setTab(parsed.tab);
      setFilters((current) => ({ ...current, live: parsed.live }));
    }, 0);
    return () => clearTimeout(timer);
  }, [statusParam]);

  const setFilter = <K extends keyof HomeFilters>(key: K, value: HomeFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));
  const clearFilters = () => setFilters((current) => ({ ...EMPTY_HOME_FILTERS, query: current.query }));

  // Próximos em ordem cronológica crescente; realizados (aba Resultados) do mais
  // recente para o mais antigo. Os filtros valem para as duas abas.
  const { upcomingEvents, pastEvents } = useMemo(() => {
    const upcoming: Event[] = [];
    const past: Event[] = [];

    events.forEach((event) => {
      if (!matchesHomeFilters(event, filters)) return;
      const lifecycle = getEventStatus(event);
      if (lifecycle === 'finished') {
        past.push(event);
      } else {
        upcoming.push(event);
      }
    });

    return {
      upcomingEvents: upcoming.sort(compareEventsByDateAsc),
      pastEvents: past.sort(compareEventsByDateDesc)
    };
  }, [events, filters]);

  // O destaque escolhido pelo dono (vitrine da home) abre a aba de próximos,
  // com a mesma regra de candidato do painel; os demais seguem por mês.
  const featuredEvent = upcomingEvents.find((event) => event.isFeatured && isFeaturedHomeCandidate(event)) ?? null;
  const listedUpcoming = featuredEvent ? upcomingEvents.filter((event) => event.id !== featuredEvent.id) : upcomingEvents;
  const shownEvents = tab === 'upcoming' ? listedUpcoming : pastEvents;
  const monthGroups = groupByMonth(shownEvents, tab === 'upcoming' ? 'asc' : 'desc');
  const shownCount = shownEvents.length + (tab === 'upcoming' && featuredEvent ? 1 : 0);
  const activeFilterCount = countActiveFilters(filters);
  const ufs = useMemo(() => availableUfs(events), [events]);
  const bcp47 = toBcp47(locale);

  return (
    <div className="min-h-screen bg-background">
      <section id="eventos" aria-labelledby="home-title" className="scroll-mt-16">
        {/* Topo com o vídeo institucional de fundo (Story 1.136,
            docs/design/mobile-competitivo/hero-com-video/): sem raias, mesma
            altura de antes; o espaço dos rótulos de raia passou para o vídeo. */}
        <div className="relative overflow-hidden border-b border-card-border">
          <HeroVideo
            alt={t('heroVideoAlt')}
            ariaLabel={t('heroVideoAriaLabel')}
            sizes="100vw"
            priority
            mediaClassName="absolute inset-0 object-[50%_40%] lg:object-[50%_45%]"
            toggle={{ pauseLabel: t('pauseVideo'), playLabel: t('playVideo'), className: 'home-hero-toggle' }}
          />
          <div className="home-hero-shade pointer-events-none absolute inset-0" aria-hidden="true" />
          <div className="relative mx-auto max-w-7xl px-4 pb-7 pt-14 sm:px-6 sm:pb-10 sm:pt-20 lg:px-8">
            <h1 id="home-title" className="type-display max-w-3xl text-balance text-[1.75rem] text-white sm:text-5xl lg:text-[3.5rem]">
              {t('heroTitle')}
            </h1>
            <p className="mt-3 max-w-xl text-base leading-7 text-foreground/80">{t('heroSubtitle')}</p>
          </div>
        </div>

        <div className="mx-auto w-full max-w-7xl space-y-8 px-4 pb-12 pt-5 sm:px-6 sm:pt-8 lg:px-8">
          <div className="space-y-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="relative w-full md:max-w-md">
                <label htmlFor="event-search" className="sr-only">{t('searchLabel')}</label>
                <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" aria-hidden="true" />
                <input
                  id="event-search"
                  name="event-search"
                  type="search"
                  placeholder={t('searchPlaceholder')}
                  value={filters.query}
                  onChange={(e) => setFilter('query', e.target.value)}
                  className="h-12 w-full rounded-xl border border-card-border bg-card pl-12 pr-4 text-base text-white placeholder:text-muted focus:border-primary focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 rounded-xl border border-card-border bg-card p-1 md:w-72" role="group" aria-label={t('tabsLabel')}>
                {(['upcoming', 'results'] as const).map((id) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={tab === id}
                    onClick={() => setTab(id)}
                    className={`min-h-10 rounded-lg text-sm font-bold transition-colors ${tab === id ? 'bg-primary text-ink' : 'text-muted hover:text-white'}`}
                  >
                    {id === 'upcoming' ? t('tabUpcoming') : t('tabResults')}
                  </button>
                ))}
              </div>
            </div>

            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none sm:mx-0 sm:px-0">
              <button type="button" onClick={() => setIsFilterSheetOpen(true)} className={chipClass(filters.uf !== null)}>
                <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                {filters.uf ?? t('chipFilters')}
              </button>
              {tab === 'upcoming' && (
                <>
                  <button type="button" aria-pressed={filters.live} onClick={() => setFilter('live', !filters.live)} className={chipClass(filters.live)}>
                    <span className="h-2 w-2 rounded-full bg-trading-down" aria-hidden="true" />
                    {t('chipLive')}
                  </button>
                  <button type="button" aria-pressed={filters.time === 'week'} onClick={() => setFilter('time', filters.time === 'week' ? null : 'week')} className={chipClass(filters.time === 'week')}>
                    {t('chipWeek')}
                  </button>
                  <button type="button" aria-pressed={filters.time === 'month'} onClick={() => setFilter('time', filters.time === 'month' ? null : 'month')} className={chipClass(filters.time === 'month')}>
                    {t('chipMonth')}
                  </button>
                </>
              )}
              <button type="button" aria-pressed={filters.modality === 'functional'} onClick={() => setFilter('modality', filters.modality === 'functional' ? null : 'functional')} className={chipClass(filters.modality === 'functional')}>
                {t('chipFunctional')}
              </button>
              <button type="button" aria-pressed={filters.modality === 'race'} onClick={() => setFilter('modality', filters.modality === 'race' ? null : 'race')} className={chipClass(filters.modality === 'race')}>
                {t('chipRace')}
              </button>
            </div>

            <div className="flex items-center gap-3 text-sm text-muted" aria-live="polite">
              <span>{t('eventCount', { count: shownCount })}</span>
              {activeFilterCount > 0 && (
                <button type="button" onClick={clearFilters} className="min-h-10 font-semibold text-primary hover:underline">
                  {t('clearFilters')}
                </button>
              )}
            </div>
          </div>

          {tab === 'upcoming' && featuredEvent && (
            <div className="space-y-4" aria-labelledby="home-featured-title">
              <GroupHeading id="home-featured-title" title={t('featuredTitle')} count={t('eventCount', { count: 1 })} />
              <EventCard event={featuredEvent} priority featured wide />
            </div>
          )}

          {monthGroups.map((group, index) => (
            <div key={group.key} className="space-y-4" aria-labelledby={`home-month-${group.key}`}>
              <GroupHeading
                id={`home-month-${group.key}`}
                title={group.key === 'tbd' ? t('dateTbd') : group.key === 'now' ? t('happeningNow') : formatMonthLabel(group.key, bcp47)}
                count={t('eventCount', { count: group.events.length })}
              />
              <EventGrid events={group.events} priorityFirst={index === 0 && !featuredEvent} />
            </div>
          ))}

          {shownCount === 0 && (
            <div className="home-broadcast-empty space-y-4 rounded-xl border border-dashed border-card-border bg-card px-4 py-14 text-center">
              <Search className="mx-auto h-10 w-10 text-muted" aria-hidden="true" />
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-white">{tab === 'upcoming' ? t('emptyUpcoming') : t('emptyResults')}</h3>
                <p className="text-sm text-muted">{t('emptySubtitle')}</p>
              </div>
              {activeFilterCount > 0 && (
                <button type="button" onClick={clearFilters} className="min-h-11 rounded-md border border-card-border px-5 text-sm font-bold text-white hover:border-primary">
                  {t('clearFilters')}
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      <ProductStory withCta />

      <HomeFilterSheet
        open={isFilterSheetOpen}
        ufs={ufs}
        selectedUf={filters.uf}
        labels={{
          title: t('filterSheetTitle'),
          state: t('stateLabel'),
          allStates: t('allStates'),
          apply: t('applyFilters'),
          close: t('closeFilters'),
          clear: t('clearFilters')
        }}
        onSelectUf={(uf) => setFilter('uf', uf)}
        onClear={() => { clearFilters(); closeFilterSheet(); }}
        onClose={closeFilterSheet}
      />
    </div>
  );
}
