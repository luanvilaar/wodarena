import { Contestation, ContestationStatus, EventScheduleItem } from '@/types';

export const CONTESTATION_CREDITS_LIMIT = 2;

export const CONTESTATION_SUCCESS_MESSAGE = 'Sua contestacao foi registrada com sucesso. A organizacao analisara as informacoes enviadas e avaliara o caso. Fique atento ao e-mail cadastrado, pois todas as atualizacoes sobre este recurso serao comunicadas por ele. Obrigado pela sua colaboracao.';

type ContestationDbRow = Record<string, unknown>;

const optionalString = (value: unknown) => typeof value === 'string' && value.length > 0 ? value : undefined;

const optionalNumber = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

export const getContestationStatusLabel = (status: ContestationStatus) => {
  if (status === 'approved') return 'Deferida';
  if (status === 'rejected') return 'Indeferida';
  return 'Em analise';
};

export const mapContestationFromDb = (row: ContestationDbRow): Contestation => ({
  id: String(row.id),
  eventId: String(row.event_id),
  registrationId: String(row.registration_id),
  userId: String(row.user_id),
  athleteId: optionalString(row.athlete_id),
  workoutId: String(row.workout_id),
  heatId: optionalString(row.heat_id),
  heatNumber: optionalNumber(row.heat_number),
  lane: String(row.lane || ''),
  description: String(row.description || ''),
  status: String(row.status || 'under_review') as ContestationStatus,
  creditConsumed: row.credit_consumed !== false,
  creditRefunded: row.credit_refunded === true,
  managerNote: optionalString(row.manager_note),
  createdAt: String(row.created_at),
  updatedAt: optionalString(row.updated_at),
  resolvedAt: optionalString(row.resolved_at)
});

export const calculateContestationCredits = (contestations: Contestation[]) => {
  const used = contestations.filter(contestation => contestation.creditConsumed).length;
  const refunded = contestations.filter(contestation => contestation.creditRefunded).length;
  const available = Math.max(0, CONTESTATION_CREDITS_LIMIT - used + refunded);
  const rejected = contestations.filter(contestation => contestation.status === 'rejected').length;

  return {
    limit: CONTESTATION_CREDITS_LIMIT,
    available,
    used,
    refunded,
    rejected
  };
};

export const parseScheduleItems = (value: unknown): EventScheduleItem[] => {
  if (Array.isArray(value)) return value as EventScheduleItem[];
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed as EventScheduleItem[] : [];
    } catch {
      return [];
    }
  }
  return [];
};

export const findWorkoutHeat = (scheduleItems: EventScheduleItem[], workoutId: string, heatId: string) => (
  scheduleItems.find(item => (
    item.kind === 'heat'
    && item.workoutId === workoutId
    && item.id === heatId
  ))
);
