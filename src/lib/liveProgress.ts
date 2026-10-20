import { deriveMaxLoadState, deriveSheetState } from '@/lib/workoutStructure';
import type { WorkoutStructure } from '@/lib/workoutStructure';

// Progresso ao vivo da súmula para o telão (Story 1.54). Puro e sem DOM: o
// servidor resume o log com o mesmo motor da súmula a cada lote gravado e guarda
// o resumo em scoresheets.live_progress; o telão lê uma linha por raia. Nada
// aqui vem do aparelho: o resumo é sempre recalculado do log validado.

export type LiveProgress = {
  /** Registros no log quando o resumo foi feito. */
  seq: number;
  /** Total feito (no AMRAP, rounds completos × round + parcial). */
  repsDone: number;
  roundsCompleted: number;
  /** Feito em cada segmento (no AMRAP, no round em andamento), na ordem da prova. */
  segments: number[];
  currentSegmentId: string | null;
  /** For Time concluído: segundos do relógio da súmula. */
  completedAt: number | null;
  /** Instante (s) do último registro que conta: a "chegada" para desempatar o parcial. */
  lastMarkAt: number | null;
  /** Carga máxima: score em kg e tentativas usadas. */
  scoreKg: number | null;
  attemptsUsed: number | null;
  currentLiftId: string | null;
  /** Início estimado do relógio da súmula (ISO): o menor "gravado em − instante" entre os registros. */
  clockStartAt: string | null;
};

type TimedEvent = { at?: unknown; t?: unknown };

const MARK_TYPES = new Set(['rep', 'fill', 'set', 'adj', 'attempt']);

/**
 * Menor estimativa do início do relógio entre a anterior e a deste lote. O
 * registro chega ao servidor um pouco depois do toque, então a menor diferença
 * entre "gravado em" e o instante do relógio é a mais próxima do "Iniciar".
 */
export const estimateClockStart = (previous: string | null, recordedAtMs: number, events: readonly TimedEvent[]) => {
  let best = previous ? Date.parse(previous) : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(best)) best = Number.POSITIVE_INFINITY;
  for (const event of events) {
    const at = Number(event?.at);
    if (!Number.isFinite(at) || at < 0) continue;
    best = Math.min(best, recordedAtMs - at * 1000);
  }
  return Number.isFinite(best) ? new Date(best).toISOString() : null;
};

const lastMark = (events: readonly TimedEvent[]) => {
  let last: number | null = null;
  for (const event of events) {
    if (!MARK_TYPES.has(String(event?.t))) continue;
    const at = Number(event?.at);
    if (Number.isFinite(at) && at >= 0) last = last === null ? at : Math.max(last, at);
  }
  return last === null ? null : Math.floor(last);
};

export const summarizeLiveProgress = (
  structure: WorkoutStructure,
  events: readonly unknown[],
  clockStartAt: string | null
): LiveProgress => {
  const timed = events as readonly TimedEvent[];
  const base = { seq: events.length, lastMarkAt: lastMark(timed), clockStartAt };
  if (structure?.format === 'max_load') {
    const state = deriveMaxLoadState(structure, events);
    return {
      ...base,
      repsDone: 0,
      roundsCompleted: 0,
      segments: [],
      currentSegmentId: null,
      completedAt: null,
      scoreKg: state.scoreKg,
      attemptsUsed: state.attemptsUsed,
      currentLiftId: state.currentLiftId
    };
  }
  const state = deriveSheetState(structure, events);
  return {
    ...base,
    repsDone: state.repsDone,
    roundsCompleted: state.roundsCompleted,
    segments: state.segments.map((segment) => segment.done),
    currentSegmentId: state.currentSegmentId,
    completedAt: state.completedAt,
    scoreKg: null,
    attemptsUsed: null,
    currentLiftId: null
  };
};

const isNumberOrNull = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value));

/** Lê o JSON gravado; devolve null se faltar campo ou o formato não bater (o telão recalcula do log). */
export const readLiveProgress = (raw: unknown): LiveProgress | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const numbers = ['seq', 'repsDone', 'roundsCompleted'];
  if (!numbers.every((key) => typeof value[key] === 'number' && Number.isFinite(value[key] as number))) return null;
  if (!Array.isArray(value.segments) || !value.segments.every((item) => typeof item === 'number')) return null;
  if (!['completedAt', 'lastMarkAt', 'scoreKg', 'attemptsUsed'].every((key) => isNumberOrNull(value[key] ?? null))) return null;
  return {
    seq: value.seq as number,
    repsDone: value.repsDone as number,
    roundsCompleted: value.roundsCompleted as number,
    segments: value.segments as number[],
    currentSegmentId: typeof value.currentSegmentId === 'string' ? value.currentSegmentId : null,
    completedAt: (value.completedAt ?? null) as number | null,
    lastMarkAt: (value.lastMarkAt ?? null) as number | null,
    scoreKg: (value.scoreKg ?? null) as number | null,
    attemptsUsed: (value.attemptsUsed ?? null) as number | null,
    currentLiftId: typeof value.currentLiftId === 'string' ? value.currentLiftId : null,
    clockStartAt: typeof value.clockStartAt === 'string' ? value.clockStartAt : null
  };
};
