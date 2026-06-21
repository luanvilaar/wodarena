import { Event } from '@/types';

export type EventLifecycle = 'active' | 'closing' | 'finished';

const CLOSING_THRESHOLD_HOURS = 72;

export function getEventStatus(event: Pick<Event, 'status' | 'registrationDeadline'>): EventLifecycle {
  if (event.status === 'finished') return 'finished';

  if (event.registrationDeadline) {
    const deadline = new Date(event.registrationDeadline);
    const now = new Date();
    const hoursUntilDeadline = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (hoursUntilDeadline < 0) return 'finished';
    if (hoursUntilDeadline <= CLOSING_THRESHOLD_HOURS) return 'closing';
  }

  return 'active';
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
