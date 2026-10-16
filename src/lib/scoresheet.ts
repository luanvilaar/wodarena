import {
  WORKOUT_STRUCTURE_LIMITS,
  computeMaxLoadResult,
  computeSheetResult,
  deriveMaxLoadState,
  deriveSheetState,
  formatWorkoutTime
} from '@/lib/workoutStructure';
import type { SheetEvent, WorkoutStructure } from '@/lib/workoutStructure';

// Súmula gravada (Stories 1.49 a 1.52, etapa E3). Puro e sem DOM: o servidor
// valida cada evento que chega do aparelho e calcula o resultado a publicar
// com o mesmo motor da súmula (Stories 1.43 e 1.47); a tela usa os mesmos
// rótulos de estado. O resultado do aparelho nunca é aceito como está.

export type ScoresheetStatus = 'in_progress' | 'submitted' | 'returned' | 'cancelled';
export type ScoresheetReviewAction = 'opened' | 'submitted' | 'returned' | 'corrected' | 'cancelled' | 'manual_override';

/** Rótulos da seção 7 do documento da súmula ("Enviada" já é publicada: decisão 3 da E3). */
export const SCORESHEET_STATUS_LABELS: Record<ScoresheetStatus | 'not_started', string> = {
  not_started: 'Não iniciada',
  in_progress: 'Em andamento',
  submitted: 'Publicada',
  returned: 'Devolvida para correção',
  cancelled: 'Cancelada'
};

export const SCORESHEET_REVIEW_LABELS: Record<ScoresheetReviewAction, string> = {
  opened: 'Súmula aberta',
  submitted: 'Enviada e publicada',
  returned: 'Devolvida para correção',
  corrected: 'Resultado corrigido pelo gestor',
  cancelled: 'Súmula cancelada',
  manual_override: 'Resultado lançado à mão por cima da súmula'
};

/** Eventos por lote enviados pelo aparelho. */
export const MAX_EVENTS_PER_BATCH = 200;
/** Eventos por súmula (um For Time de 30 etapas com 99 repetições cabe com folga). */
export const MAX_EVENTS_PER_SHEET = 5000;
/** Maior instante aceito num evento: 6 horas de relógio. */
export const MAX_EVENT_SECONDS = 6 * 3600;

const CLIENT_EVENT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_AMOUNT = WORKOUT_STRUCTURE_LIMITS.maxMetersPerSegment;

export type ClientEventInput = { id: string; event: SheetEvent };
export type ClientEventCheck = { ok: true; id: string; event: SheetEvent } | { ok: false; error: string };

type PlainObject = Record<string, unknown>;
const isPlainObject = (value: unknown): value is PlainObject => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);
const isInt = (value: unknown, min: number, max: number): value is number => (
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
);
const isKg = (value: unknown): value is number => (
  typeof value === 'number'
  && Number.isFinite(value)
  && value >= WORKOUT_STRUCTURE_LIMITS.minLoadKg
  && value <= WORKOUT_STRUCTURE_LIMITS.maxLoadKg
  && Math.abs(Math.round(value * 100) - value * 100) < 1e-6
);

/**
 * Confere um evento vindo do aparelho contra a estrutura da súmula e devolve a
 * forma normalizada (só os campos do contrato) que vai para o log. `position`
 * é a posição que ele vai ocupar no log: um `undo` só pode apontar para trás.
 */
export const validateClientEvent = (raw: unknown, structure: WorkoutStructure, position: number): ClientEventCheck => {
  const fail = (error: string): ClientEventCheck => ({ ok: false, error: `Registro ${position + 1}: ${error}` });
  if (!isPlainObject(raw)) return fail('formato inválido.');
  if (typeof raw.id !== 'string' || !CLIENT_EVENT_ID.test(raw.id)) return fail('identificador do aparelho inválido.');
  const event = raw.event;
  if (!isPlainObject(event)) return fail('formato inválido.');
  if (!isInt(event.at, 0, MAX_EVENT_SECONDS)) return fail('instante do relógio inválido.');
  const at = event.at;
  const isMaxLoad = structure.format === 'max_load';
  const segmentIds = new Set(structure.segments.map((segment) => segment.id));
  const liftIds = new Set((structure.maxLoad?.lifts ?? []).map((lift) => lift.id));
  const segment = (value: unknown) => typeof value === 'string' && segmentIds.has(value);

  switch (event.t) {
    case 'rep':
      if (isMaxLoad || !segment(event.seg)) return fail('etapa inexistente na prova.');
      return { ok: true, id: raw.id, event: { t: 'rep', seg: event.seg as string, at } };
    case 'fill':
      if (isMaxLoad || !segment(event.seg)) return fail('etapa inexistente na prova.');
      if (!isInt(event.n, 0, MAX_AMOUNT)) return fail('quantidade inválida.');
      return { ok: true, id: raw.id, event: { t: 'fill', seg: event.seg as string, n: event.n, at } };
    case 'set':
      if (isMaxLoad || !segment(event.seg)) return fail('etapa inexistente na prova.');
      if (!isInt(event.v, 0, MAX_AMOUNT)) return fail('quantidade inválida.');
      return { ok: true, id: raw.id, event: { t: 'set', seg: event.seg as string, v: event.v, at } };
    case 'adj':
      if (isMaxLoad || !segment(event.seg)) return fail('etapa inexistente na prova.');
      if (!isInt(event.d, -MAX_AMOUNT, MAX_AMOUNT) || event.d === 0) return fail('correção inválida.');
      return { ok: true, id: raw.id, event: { t: 'adj', seg: event.seg as string, d: event.d, at } };
    case 'undo':
      if (!isInt(event.of, 0, position - 1)) return fail('o desfazer aponta para um registro inexistente.');
      return { ok: true, id: raw.id, event: { t: 'undo', of: event.of, at } };
    case 'time': {
      const cap = structure.timeCapSeconds;
      if (isMaxLoad || typeof cap !== 'number') return fail('o ajuste do tempo não vale para esta prova.');
      if (event.target !== 'final' && event.target !== 'tiebreak') return fail('ajuste de tempo sem alvo.');
      if (!isInt(event.v, 1, cap)) return fail(`o tempo oficial deve ficar entre 00:01 e ${formatWorkoutTime(cap)}.`);
      return { ok: true, id: raw.id, event: { t: 'time', target: event.target, v: event.v, at } };
    }
    case 'attempt':
      if (!isMaxLoad || typeof event.lift !== 'string' || !liftIds.has(event.lift)) return fail('movimento inexistente na prova.');
      if (!isKg(event.load)) return fail(`a carga deve ficar entre ${WORKOUT_STRUCTURE_LIMITS.minLoadKg} e ${WORKOUT_STRUCTURE_LIMITS.maxLoadKg} kg.`);
      if (typeof event.ok !== 'boolean') return fail('a tentativa precisa ser válida ou no-rep.');
      return { ok: true, id: raw.id, event: { t: 'attempt', lift: event.lift, load: event.load, ok: event.ok, at } };
    default:
      return fail('tipo de registro desconhecido.');
  }
};

export type SheetOutcome =
  | { ok: true; result: string; value: number; tieBreak: string | null; summary: string }
  | { ok: false; error: string };

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/**
 * O resultado a publicar, calculado do log pelo motor: o texto no formato de
 * parseScoreForWorkout (tempo, total de repetições ou kg), o valor numérico e o
 * desempate por tempo (o que vai em splits.tieBreaker). Recusa o que não pode
 * ser publicado, com a mensagem para o judge.
 */
export const computeSheetOutcome = (structure: WorkoutStructure, events: readonly SheetEvent[]): SheetOutcome => {
  if (structure.format === 'max_load') {
    const state = deriveMaxLoadState(structure, events);
    if (state.attemptsUsed === 0) return { ok: false, error: 'Registre ao menos uma tentativa antes de enviar.' };
    const result = computeMaxLoadResult(structure, state);
    return {
      ok: true,
      result: result.display,
      value: result.value,
      tieBreak: result.tieBreakDisplay,
      summary: `${result.display.replace('.', ',')} kg em ${result.attemptsUsed} ${plural(result.attemptsUsed, 'tentativa', 'tentativas')}`
    };
  }

  const state = deriveSheetState(structure, events);
  const result = computeSheetResult(structure, state);
  if (result.tieBreakAfterEnd) {
    return { ok: false, error: 'O tempo do tie-break ficou depois do fim da prova. Ajuste antes de enviar.' };
  }
  if (result.format === 'amrap') {
    return {
      ok: true,
      result: result.display,
      value: result.value,
      tieBreak: result.tieBreakDisplay,
      summary: `${result.rounds} ${plural(result.rounds, 'round', 'rounds')} + ${result.extraReps} (total ${result.totalReps})`
    };
  }
  if (result.display === null) {
    return { ok: false, error: 'O tempo desta súmula não pode ser publicado. Confira o relógio e os registros.' };
  }
  return {
    ok: true,
    result: result.display,
    value: result.value,
    tieBreak: result.tieBreakDisplay,
    summary: result.completed
      ? `Concluída em ${result.display}`
      : `${result.repsDone} de ${result.repsDone + result.repsRemaining} no cap (${result.display})`
  };
};
