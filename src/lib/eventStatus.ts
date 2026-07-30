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

type EventOrderInput = Pick<Event, 'name' | 'date'>;

const EVENT_NAME_COLLATOR = new Intl.Collator('pt-BR', { sensitivity: 'base' });

const compareEventsByDate = (a: EventOrderInput, b: EventOrderInput, direction: 1 | -1): number => {
  const dateA = parseEventDate(a.date);
  const dateB = parseEventDate(b.date);

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

export function getEventStatus(event: Pick<Event, 'status' | 'date' | 'registrationDeadline'>): EventLifecycle {
  if (event.status === 'finished') return 'finished';

  if (hasEventDatePassed(event.date)) return 'finished';

  if (event.registrationDeadline) {
    const deadline = new Date(event.registrationDeadline);
    const now = new Date();
    const hoursUntilDeadline = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (!Number.isNaN(hoursUntilDeadline) && hoursUntilDeadline < 0) return 'finished';
    if (hoursUntilDeadline <= CLOSING_THRESHOLD_HOURS) return 'closing';
  }

  return 'active';
}

export function getRegistrationAvailability(
  event: Pick<Event, 'status' | 'date' | 'registrationDeadline' | 'isTicketingActive'>,
): RegistrationAvailability {
  const lifecycle = getEventStatus(event);

  if (lifecycle === 'finished') {
    return { isAvailable: false, lifecycle, reason: 'event_finished' };
  }

  if (event.isTicketingActive === false) {
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
