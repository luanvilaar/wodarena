// Busca, filtros em chips e agrupamento por mês da home (Story 1.133, P3 de
// docs/design/mobile-competitivo/). Regras puras para os testes.

import type { Event } from '@/types';
import { getEventDateRange, getEventStatus, getEventToday } from '@/lib/eventStatus';
import { toUf } from '@/lib/eventPlace';

export type HomeTab = 'upcoming' | 'results';
export type HomeTimeChip = 'week' | 'month' | null;
export type HomeModalityChip = 'functional' | 'race' | null;

export type HomeFilters = {
  query: string;
  time: HomeTimeChip;
  modality: HomeModalityChip;
  live: boolean;
  uf: string | null;
};

export const EMPTY_HOME_FILTERS: HomeFilters = { query: '', time: null, modality: null, live: false, uf: null };

type FilterableEvent = Pick<Event, 'name' | 'location' | 'status' | 'date'> &
  Partial<Pick<Event, 'city' | 'state' | 'eventType' | 'startDate' | 'endDate' | 'timeZone' | 'registrationDeadline'>>;

const fold = (value: string | null | undefined) =>
  (value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const addDays = (isoDate: string, days: number) => {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

// Nome, local, cidade e UF, sem diferença de acento ou maiúscula.
export function matchesQuery(event: FilterableEvent, query: string): boolean {
  const needle = fold(query).trim();
  if (!needle) return true;
  const uf = toUf(event.state) ?? '';
  return [event.name, event.location, event.city, event.state, uf].some((field) => fold(field).includes(needle));
}

// "Esta semana": começa nos próximos 7 dias ou já está acontecendo.
// "Este mês": começa no mês corrente (no fuso do evento) ou já está acontecendo.
export function matchesTime(event: FilterableEvent, time: HomeTimeChip, now = new Date()): boolean {
  if (!time) return true;
  const range = getEventDateRange(event);
  if (!range) return false;
  const today = getEventToday(event.timeZone, now);
  if (range.start <= today && today <= range.end) return true;
  if (time === 'week') return range.start >= today && range.start <= addDays(today, 6);
  return range.start >= today && range.start.slice(0, 7) === today.slice(0, 7);
}

// Qualifier online conta como Functional Fitness.
export function matchesModality(event: FilterableEvent, modality: HomeModalityChip): boolean {
  if (!modality) return true;
  const type = event.eventType ?? 'functional_fitness';
  return modality === 'race' ? type === 'fitness_racing' : type !== 'fitness_racing';
}

export function isLiveEvent(event: FilterableEvent): boolean {
  return event.status === 'live' && getEventStatus(event) !== 'finished';
}

export function matchesHomeFilters(event: FilterableEvent, filters: HomeFilters, now = new Date()): boolean {
  return matchesQuery(event, filters.query)
    && matchesTime(event, filters.time, now)
    && matchesModality(event, filters.modality)
    && (!filters.live || isLiveEvent(event))
    && (!filters.uf || toUf(event.state) === filters.uf);
}

export function countActiveFilters(filters: HomeFilters): number {
  return [filters.time, filters.modality, filters.live || null, filters.uf].filter(Boolean).length;
}

// UFs que aparecem nos eventos, para o filtro de estado.
export function availableUfs(events: readonly FilterableEvent[]): string[] {
  return [...new Set(events.map((event) => toUf(event.state)).filter((uf): uf is string => Boolean(uf)))].sort();
}

export type MonthGroup<T> = { key: string; events: T[] };

// Agrupa pelo mês de início ("2026-11"); sem data estruturada vai para "tbd",
// sempre por último. Na lista de próximos ('asc'), o que começou antes de hoje
// e ainda não acabou abre a lista em "now" (acontecendo agora), em vez de cair
// num mês que já passou. A ordem dentro do grupo é a da lista recebida.
export function groupByMonth<T extends FilterableEvent>(events: readonly T[], order: 'asc' | 'desc' = 'asc', now = new Date()): MonthGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const event of events) {
    const range = getEventDateRange(event);
    const ongoing = order === 'asc' && range !== null && range.start < getEventToday(event.timeZone, now);
    const key = !range ? 'tbd' : ongoing ? 'now' : range.start.slice(0, 7);
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  const keys = [...groups.keys()].filter((key) => key !== 'tbd' && key !== 'now').sort();
  if (order === 'desc') keys.reverse();
  if (groups.has('now')) keys.unshift('now');
  if (groups.has('tbd')) keys.push('tbd');
  return keys.map((key) => ({ key, events: groups.get(key)! }));
}

// "2026-11" -> "Novembro de 2026" no idioma da página.
export function formatMonthLabel(key: string, bcp47Locale: string): string {
  const label = new Intl.DateTimeFormat(bcp47Locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${key}-01T12:00:00Z`));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// "?status=" da URL (barra do rodapé, Story 1.129) para aba e chip.
export function parseStatusParam(param: string | null): { tab: HomeTab; live: boolean } | null {
  if (param === 'live') return { tab: 'upcoming', live: true };
  if (param === 'finished') return { tab: 'results', live: false };
  if (param === 'upcoming' || param === 'all') return { tab: 'upcoming', live: false };
  return null;
}

