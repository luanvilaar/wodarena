import { Event } from '@/types';

export type EventLifecycle = 'active' | 'closing' | 'finished';
export type RegistrationAvailabilityReason = 'sales_closed' | 'event_finished' | null;

export type RegistrationAvailability = {
  isAvailable: boolean;
  lifecycle: EventLifecycle;
  reason: RegistrationAvailabilityReason;
};

const CLOSING_THRESHOLD_HOURS = 72;

const MONTHS: Record<string, number> = {
  JANEIRO: 0, JAN: 0,
  FEVEREIRO: 1, FEV: 1, FEB: 1,
  MARCO: 2, MAR: 2,
  ABRIL: 3, ABR: 3, APR: 3,
  MAIO: 4, MAI: 4, MAY: 4,
  JUNHO: 5, JUN: 5,
  JULHO: 6, JUL: 6,
  AGOSTO: 7, AGO: 7, AUG: 7,
  SETEMBRO: 8, SET: 8, SEP: 8,
  OUTUBRO: 9, OUT: 9, OCT: 9,
  NOVEMBRO: 10, NOV: 10,
  DEZEMBRO: 11, DEZ: 11, DEC: 11,
};

const createLocalDate = (year: number, month: number, day: number): Date | null => {
  const date = new Date(year, month, day);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day
    ? date
    : null;
};

export function parseEventDate(dateText?: string): Date | null {
  if (!dateText?.trim()) return null;

  const normalized = dateText.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const isoMatch = normalized.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) {
    return createLocalDate(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
  }

  const slashMatch = normalized.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (slashMatch) {
    const year = Number(slashMatch[3].length === 2 ? `20${slashMatch[3]}` : slashMatch[3]);
    return createLocalDate(year, Number(slashMatch[2]) - 1, Number(slashMatch[1]));
  }

  const monthEntry = Object.entries(MONTHS)
    .filter(([month]) => normalized.includes(month))
    .sort(([a], [b]) => b.length - a.length)[0];
  const yearMatch = normalized.match(/\b(20\d{2})\b/);

  if (monthEntry && yearMatch) {
    const monthIndex = normalized.indexOf(monthEntry[0]);
    const days = [...normalized.slice(0, monthIndex).matchAll(/\b(\d{1,2})\b/g)]
      .map((match) => Number(match[1]));
    const day = days.at(-1);
    if (day) return createLocalDate(Number(yearMatch[1]), monthEntry[1], day);
  }

  const parsed = new Date(dateText);
  return Number.isNaN(parsed.getTime())
    ? null
    : createLocalDate(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

export function hasEventDatePassed(dateText?: string, now = new Date()): boolean {
  const eventDate = parseEventDate(dateText);
  if (!eventDate) return false;

  const endOfEventDay = new Date(
    eventDate.getFullYear(),
    eventDate.getMonth(),
    eventDate.getDate() + 1,
  );
  return now >= endOfEventDay;
}

// Datas estruturadas do evento (Story 1.71). Sem elas, as regras abaixo caem
// na leitura do texto livre de `date`, como antes da migration.
type EventDatesInput = Pick<Event, 'date'> & Partial<Pick<Event, 'startDate' | 'endDate' | 'timeZone'>>;

const DEFAULT_EVENT_TIME_ZONE = 'America/Fortaleza';
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Devolve a data YYYY-MM-DD quando é um dia de calendário válido; senão null. */
export function readIsoDate(value?: string | null): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().slice(0, 10);
  const match = text.match(ISO_DATE_PATTERN);
  if (!match) return null;
  return createLocalDate(Number(match[1]), Number(match[2]) - 1, Number(match[3])) ? text : null;
}

const isoToUtcDay = (isoDate: string) => {
  const [year, month, day] = isoDate.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
};

const daysBetween = (fromIso: string, toIso: string) =>
  Math.round((isoToUtcDay(toIso) - isoToUtcDay(fromIso)) / DAY_MS);

/** Dia de hoje (YYYY-MM-DD) no fuso do evento; fuso inválido cai no padrão da plataforma. */
export function getEventToday(timeZone?: string, now = new Date()): string {
  const format = (zone: string) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  };

  try {
    return format(timeZone || DEFAULT_EVENT_TIME_ZONE);
  } catch {
    return format(DEFAULT_EVENT_TIME_ZONE);
  }
}

/** Primeiro e último dia estruturados; um só preenchido vale para os dois. */
export function getEventDateRange(event: Partial<Pick<Event, 'startDate' | 'endDate'>>): { start: string; end: string } | null {
  const start = readIsoDate(event.startDate);
  const end = readIsoDate(event.endDate);
  if (!start && !end) return null;
  return { start: start ?? end!, end: end ?? start! };
}

/**
 * O evento já aconteceu quando, no fuso dele, o dia de hoje passou do último
 * dia. Sem datas estruturadas, vale a leitura do texto (hasEventDatePassed).
 */
export function hasEventEnded(event: EventDatesInput, now = new Date()): boolean {
  const range = getEventDateRange(event);
  if (range) return getEventToday(event.timeZone, now) > range.end;
  return hasEventDatePassed(event.date, now);
}

export type EventTiming =
  | { kind: 'upcoming'; days: number }
  | { kind: 'today' }
  | { kind: 'ongoing' }
  | { kind: 'ended'; days: number };

/**
 * Distância em dias de calendário entre hoje (no fuso do evento) e o evento,
 * para o marcador do card ("Em 5 dias", "Há 8 dias"). Só com datas estruturadas.
 */
export function getEventTiming(event: Partial<Pick<Event, 'startDate' | 'endDate' | 'timeZone'>>, now = new Date()): EventTiming | null {
  const range = getEventDateRange(event);
  if (!range) return null;

  const today = getEventToday(event.timeZone, now);
  if (today < range.start) return { kind: 'upcoming', days: daysBetween(today, range.start) };
  if (today > range.end) return { kind: 'ended', days: daysBetween(range.end, today) };
  return today === range.start ? { kind: 'today' } : { kind: 'ongoing' };
}

type EventOrderInput = Pick<Event, 'name' | 'date'> & Partial<Pick<Event, 'startDate' | 'endDate'>>;

const EVENT_NAME_COLLATOR = new Intl.Collator('pt-BR', { sensitivity: 'base' });

// Próximos em ordem de início; passados pelo último dia (quem terminou por
// último vem primeiro, mesmo que tenha começado antes).
const getEventOrderDate = (event: EventOrderInput, direction: 1 | -1): Date | null => {
  const range = getEventDateRange(event);
  if (!range) return parseEventDate(event.date);
  const [year, month, day] = (direction === 1 ? range.start : range.end).split('-').map(Number);
  return createLocalDate(year, month - 1, day);
};

const compareEventsByDate = (a: EventOrderInput, b: EventOrderInput, direction: 1 | -1): number => {
  const dateA = getEventOrderDate(a, direction);
  const dateB = getEventOrderDate(b, direction);

  // Eventos sem data legível ficam sempre no fim, independente da direção.
  if (!dateA && !dateB) return EVENT_NAME_COLLATOR.compare(a.name ?? '', b.name ?? '');
  if (!dateA) return 1;
  if (!dateB) return -1;

  const diff = dateA.getTime() - dateB.getTime();
  if (diff !== 0) return diff * direction;

  return EVENT_NAME_COLLATOR.compare(a.name ?? '', b.name ?? '');
};

/** Ordem cronológica crescente: o evento que acontece primeiro vem primeiro. */
export function compareEventsByDateAsc(a: EventOrderInput, b: EventOrderInput): number {
  return compareEventsByDate(a, b, 1);
}

/** Ordem cronológica decrescente: o evento encerrado mais recente vem primeiro. */
export function compareEventsByDateDesc(a: EventOrderInput, b: EventOrderInput): number {
  return compareEventsByDate(a, b, -1);
}

const getHoursUntilDeadline = (registrationDeadline?: string): number | null => {
  if (!registrationDeadline) return null;
  const hours = (new Date(registrationDeadline).getTime() - Date.now()) / (1000 * 60 * 60);
  return Number.isNaN(hours) ? null : hours;
};

/** Prazo de inscrição vencido: fecha a inscrição, mas o evento continua por acontecer. */
export function hasRegistrationDeadlinePassed(registrationDeadline?: string): boolean {
  const hoursUntilDeadline = getHoursUntilDeadline(registrationDeadline);
  return hoursUntilDeadline !== null && hoursUntilDeadline < 0;
}

type EventLifecycleInput = Pick<Event, 'status' | 'date' | 'registrationDeadline'> & Partial<Pick<Event, 'startDate' | 'endDate' | 'timeZone'>>;

export function getEventStatus(event: EventLifecycleInput): EventLifecycle {
  if (event.status === 'finished') return 'finished';

  if (hasEventEnded(event)) return 'finished';

  const hoursUntilDeadline = getHoursUntilDeadline(event.registrationDeadline);
  if (hoursUntilDeadline !== null && hoursUntilDeadline >= 0 && hoursUntilDeadline <= CLOSING_THRESHOLD_HOURS) {
    return 'closing';
  }

  return 'active';
}

export function getRegistrationAvailability(
  event: EventLifecycleInput & Pick<Event, 'isTicketingActive'>,
): RegistrationAvailability {
  const lifecycle = getEventStatus(event);

  if (lifecycle === 'finished') {
    return { isAvailable: false, lifecycle, reason: 'event_finished' };
  }

  if (event.isTicketingActive === false || hasRegistrationDeadlinePassed(event.registrationDeadline)) {
    return { isAvailable: false, lifecycle, reason: 'sales_closed' };
  }

  return { isAvailable: true, lifecycle, reason: null };
}

export function formatDeadlineCountdown(registrationDeadline: string): string {
  const deadline = new Date(registrationDeadline);
  const now = new Date();
  const hoursLeft = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60);

  if (hoursLeft <= 24) return 'Últimas 24h';
  if (hoursLeft <= 48) return 'Últimas 48h';
  return 'Últimos 3 dias';
}

export function formatDeadlineDate(registrationDeadline: string): string {
  return new Date(registrationDeadline).toLocaleDateString('pt-BR', {
    day: 'numeric',
    month: 'long',
  });
}

export function formatTimeUntilDeadline(registrationDeadline: string): string {
  const deadline = new Date(registrationDeadline);
  const now = new Date();
  const hoursLeft = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60));

  if (hoursLeft <= 24) return 'menos de 24 horas';
  const daysLeft = Math.ceil(hoursLeft / 24);
  return `${daysLeft} dia${daysLeft > 1 ? 's' : ''}`;
}
