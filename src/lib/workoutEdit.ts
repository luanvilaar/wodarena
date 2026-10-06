import type { Workout, WorkoutType } from '@/types';

/**
 * Regras de edição de provas de eventos Qualifier depois que já existem
 * submissões. A autoridade final é o trigger `qualifier_protect_workout_after_submission`
 * (migration 20261006120000); este módulo existe para devolver mensagens claras
 * na API e para desabilitar os campos travados no formulário do gestor.
 */

export type QualifierWorkoutLock = {
  submissionCount: number;
  // Submissões com resultado ativo (validated/penalized/rejected). Revisões já
  // desfeitas por pedido de reenvio não contam: não geram score.
  reviewedCount: number;
};

// Tipos numéricos em que o maior valor vence e o score é lido da mesma forma.
// 'fortime' fica de fora: converter de/para tempo muda a leitura do resultado.
export const QUALIFIER_RETYPABLE_SCORE_TYPES: readonly WorkoutType[] = ['amrap', 'reps', 'maxweight', 'distance', 'points'];

export type QualifierLockedField = 'type' | 'divisionId' | 'submissionOpensAt' | 'submissionClosesAt';

export type QualifierLockViolation = { field: QualifierLockedField; message: string };

type WorkoutEditableState = Pick<Workout, 'type' | 'divisionId' | 'submissionOpensAt' | 'submissionClosesAt'>;

const toTime = (value?: string | null) => {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
};

export const isQualifierWorkoutLocked = (lock?: QualifierWorkoutLock | null) => Boolean(lock && lock.submissionCount > 0);

export const canChangeQualifierWorkoutType = (
  from: WorkoutType,
  to: WorkoutType,
  lock?: QualifierWorkoutLock | null
): { allowed: true } | { allowed: false; message: string } => {
  if (from === to || !isQualifierWorkoutLocked(lock)) return { allowed: true };
  if (!QUALIFIER_RETYPABLE_SCORE_TYPES.includes(from) || !QUALIFIER_RETYPABLE_SCORE_TYPES.includes(to)) {
    return {
      allowed: false,
      message: 'O tipo de score não pode ser trocado de ou para Tempo depois que a prova recebeu submissões.'
    };
  }
  if ((lock?.reviewedCount ?? 0) > 0) {
    return {
      allowed: false,
      message: 'O tipo de score não pode ser alterado enquanto houver resultados revisados. Solicite o reenvio desses resultados antes de corrigir o tipo.'
    };
  }
  return { allowed: true };
};

/**
 * Compara a edição pretendida com o estado atual da prova e devolve cada campo
 * travado que mudaria. Só campos presentes em `next` são avaliados.
 */
export const getQualifierWorkoutLockViolations = (
  current: WorkoutEditableState,
  next: Partial<WorkoutEditableState>,
  lock?: QualifierWorkoutLock | null
): QualifierLockViolation[] => {
  if (!isQualifierWorkoutLocked(lock)) return [];
  const violations: QualifierLockViolation[] = [];

  if (Object.hasOwn(next, 'divisionId') && (next.divisionId || null) !== (current.divisionId || null)) {
    violations.push({
      field: 'divisionId',
      message: 'A categoria da prova não pode ser alterada depois que ela recebeu submissões.'
    });
  }

  if (next.type !== undefined && next.type !== current.type) {
    const typeChange = canChangeQualifierWorkoutType(current.type, next.type, lock);
    if (!typeChange.allowed) violations.push({ field: 'type', message: typeChange.message });
  }

  if (Object.hasOwn(next, 'submissionOpensAt') && toTime(next.submissionOpensAt) !== toTime(current.submissionOpensAt)) {
    violations.push({
      field: 'submissionOpensAt',
      message: 'A abertura do envio não pode ser alterada depois que a prova recebeu submissões.'
    });
  }

  if (Object.hasOwn(next, 'submissionClosesAt')) {
    const nextClose = toTime(next.submissionClosesAt);
    const currentClose = toTime(current.submissionClosesAt);
    if (nextClose !== currentClose && (nextClose === null || (currentClose !== null && nextClose < currentClose))) {
      violations.push({
        field: 'submissionClosesAt',
        message: 'Depois que a prova recebeu submissões, o prazo final só pode ser estendido para uma data posterior.'
      });
    }
  }

  return violations;
};

type WorkoutFormValues = Omit<Workout, 'id'>;

/**
 * Reduz o formulário de edição aos campos que realmente mudaram, para que um
 * campo travado e inalterado não derrube o salvamento dos demais. Campos
 * opcionais limpos entram como `undefined` (o AppContext usa `Object.hasOwn`
 * para gravar NULL).
 */
export const getWorkoutChanges = (original: Workout, next: WorkoutFormValues): Partial<WorkoutFormValues> => {
  const changes: Partial<WorkoutFormValues> = {};

  if (next.name !== original.name) changes.name = next.name;
  if (next.description !== original.description) changes.description = next.description;
  if (next.type !== original.type) changes.type = next.type;
  if (next.code !== original.code) changes.code = next.code;
  if (next.orderIndex !== original.orderIndex) changes.orderIndex = next.orderIndex;
  if ((next.timeCap || '') !== (original.timeCap || '')) changes.timeCap = next.timeCap;
  if ((next.divisionId || '') !== (original.divisionId || '')) changes.divisionId = next.divisionId;
  if ((next.tieBreaker || '') !== (original.tieBreaker || '')) changes.tieBreaker = next.tieBreaker;
  if (toTime(next.submissionOpensAt) !== toTime(original.submissionOpensAt)) changes.submissionOpensAt = next.submissionOpensAt;
  if (toTime(next.submissionClosesAt) !== toTime(original.submissionClosesAt)) changes.submissionClosesAt = next.submissionClosesAt;

  return changes;
};
