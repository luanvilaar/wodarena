import {
  WORKOUT_STRUCTURE_LIMITS,
  computeIntervalResult,
  computeMaxLoadResult,
  computeSheetResult,
  deriveIntervalState,
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
export type ScoresheetReviewAction = 'opened' | 'submitted' | 'returned' | 'corrected' | 'cancelled' | 'manual_override' | 'absent';

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
  manual_override: 'Resultado lançado à mão por cima da súmula',
  absent: 'Atleta ausente'
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
 * No intervalado, `set` e `adj` exigem `rd` (o round corrigido) e o levam no
 * evento normalizado; nos outros formatos o `rd` recebido é descartado. `rep` e
 * `fill` fora da janela de trabalho são aceitos e gravados: o motor os ignora
 * e a súmula avisa (decisão 6 do intervalado).
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
  const isInterval = structure.format === 'interval';
  const maxId = isInterval ? structure.interval?.max.id ?? null : null;
  const segmentIds = new Set(structure.segments.map((segment) => segment.id));
  if (maxId) segmentIds.add(maxId);
  const liftIds = new Set((structure.maxLoad?.lifts ?? []).map((lift) => lift.id));
  const segment = (value: unknown) => typeof value === 'string' && segmentIds.has(value);
  const rounds = structure.interval?.rounds ?? 0;
  // Round da correção no intervalado; nos outros formatos não existe.
  const correctionRound = (): { ok: true; rd?: number } | { ok: false } => {
    if (!isInterval) return { ok: true };
    return isInt(event.rd, 1, rounds) ? { ok: true, rd: event.rd } : { ok: false };
  };
  const roundError = `informe o round da correção (de 1 a ${rounds}).`;

  switch (event.t) {
    case 'rep':
      if (isMaxLoad || !segment(event.seg)) return fail('etapa inexistente na prova.');
      return { ok: true, id: raw.id, event: { t: 'rep', seg: event.seg as string, at } };
    case 'fill':
      if (isMaxLoad || !segment(event.seg)) return fail('etapa inexistente na prova.');
      if (event.seg === maxId) return fail('o movimento máximo não tem meta a concluir.');
      if (!isInt(event.n, 0, MAX_AMOUNT)) return fail('quantidade inválida.');
      return { ok: true, id: raw.id, event: { t: 'fill', seg: event.seg as string, n: event.n, at } };
    case 'set': {
      if (isMaxLoad || !segment(event.seg)) return fail('etapa inexistente na prova.');
      if (!isInt(event.v, 0, MAX_AMOUNT)) return fail('quantidade inválida.');
      const round = correctionRound();
      if (!round.ok) return fail(roundError);
      return { ok: true, id: raw.id, event: { t: 'set', seg: event.seg as string, v: event.v, at, ...(round.rd ? { rd: round.rd } : {}) } };
    }
    case 'adj': {
      if (isMaxLoad || !segment(event.seg)) return fail('etapa inexistente na prova.');
      if (!isInt(event.d, -MAX_AMOUNT, MAX_AMOUNT) || event.d === 0) return fail('correção inválida.');
      const round = correctionRound();
      if (!round.ok) return fail(roundError);
      return { ok: true, id: raw.id, event: { t: 'adj', seg: event.seg as string, d: event.d, at, ...(round.rd ? { rd: round.rd } : {}) } };
    }
    case 'undo':
      if (!isInt(event.of, 0, position - 1)) return fail('o desfazer aponta para um registro inexistente.');
      return { ok: true, id: raw.id, event: { t: 'undo', of: event.of, at } };
    case 'time': {
      const cap = structure.timeCapSeconds;
      if (isMaxLoad || isInterval || typeof cap !== 'number') return fail('o ajuste do tempo não vale para esta prova.');
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
 * ser publicado, com a mensagem para o judge. No intervalado, o total de
 * repetições do máximo nos rounds que pontuaram, sem desempate; enviar sem
 * registros publica 0.
 */
export const computeSheetOutcome = (structure: WorkoutStructure, events: readonly SheetEvent[]): SheetOutcome => {
  if (structure.format === 'interval') {
    const result = computeIntervalResult(deriveIntervalState(structure, events));
    const rounds = result.rounds.length;
    return {
      ok: true,
      result: result.display,
      value: result.value,
      tieBreak: null,
      summary: `${result.value} ${plural(result.value, 'repetição', 'repetições')} em ${rounds} ${plural(rounds, 'round', 'rounds')} (${result.roundsScored} ${plural(result.roundsScored, 'pontuou', 'pontuaram')})`
    };
  }
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

/** Erro do resultado de ausência que não cabe no formato de tempo publicável (acima de 99:59:59). */
export const ABSENT_OUTCOME_TOO_LONG = 'O resultado de ausência desta prova passa do maior tempo que o ranking aceita (99:59:59). Confira o time cap e a penalidade por repetição na estrutura da prova.';

/**
 * Resultado atribuído ao atleta ausente (Story 1.59), calculado só da estrutura
 * copiada na súmula, nunca do aparelho. For Time e AMRAP saem do motor com o
 * log vazio (o mesmo de computeSheetOutcome(structure, [])): For Time = time
 * cap + total de repetições × segundos por repetição; AMRAP = 0 repetições.
 * Carga máxima = 0 kg. Intervalado = 0 repetições (o motor com o log vazio).
 * Sem desempate em nenhum formato. O ranking põe o ausente depois de qualquer
 * resultado real (result_status = 'absent').
 */
export const computeAbsentOutcome = (structure: WorkoutStructure): SheetOutcome => {
  if (structure.format === 'max_load') {
    return { ok: true, result: '0', value: 0, tieBreak: null, summary: 'Atleta ausente · 0 kg' };
  }
  if (structure.format === 'interval') {
    const result = computeIntervalResult(deriveIntervalState(structure, []));
    return { ok: true, result: result.display, value: result.value, tieBreak: null, summary: `Atleta ausente · ${result.display} repetições` };
  }
  const result = computeSheetResult(structure, deriveSheetState(structure, []));
  if (result.format === 'amrap') {
    return { ok: true, result: result.display, value: result.value, tieBreak: null, summary: `Atleta ausente · ${result.display} repetições` };
  }
  if (result.display === null) return { ok: false, error: ABSENT_OUTCOME_TOO_LONG };
  return { ok: true, result: result.display, value: result.value, tieBreak: null, summary: `Atleta ausente · ${result.display}` };
};
