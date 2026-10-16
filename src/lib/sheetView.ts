import { UNIT_WORDS, formatWorkoutTime, workUnitWord } from '@/lib/workoutStructure';
import type {
  MaxLoadSheetResult,
  MaxLoadSheetState,
  SheetEvent,
  SheetResult,
  SheetState,
  WorkoutSegmentUnit,
  WorkoutStructure
} from '@/lib/workoutStructure';

// Modelo de tela da súmula digital do judge (Story 1.44; unidades e novos
// desempates na 1.48, carga máxima na 1.47). Puro e sem DOM: pega a estrutura
// da prova, o estado e o resultado que o motor calculou e devolve o que a tela
// precisa mostrar. Nenhum score é calculado aqui; o texto é português fixo,
// como no restante da área do judge.

// Eventos que o judge pode desfazer. `undo` nunca é alvo (o motor não tem
// "refazer": desfazer um desfazer não tem efeito).
const UNDOABLE_EVENT_TYPES = new Set<string>(['rep', 'fill', 'set', 'adj', 'time', 'attempt']);

/**
 * Posição do último evento que ainda pode ser desfeito: um evento de contagem,
 * de ajuste de tempo ou uma tentativa que nenhum `undo` posterior anulou.
 * `null` quando não há o que desfazer.
 */
export const findUndoTarget = (events: readonly SheetEvent[]): number | null => {
  const undone = new Set<number>();
  events.forEach((event, index) => {
    if (event.t === 'undo' && Number.isInteger(event.of) && event.of >= 0 && event.of < index) undone.add(event.of);
  });
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (UNDOABLE_EVENT_TYPES.has(events[index].t) && !undone.has(index)) return index;
  }
  return null;
};

const formatKg = (kg: number) => String(kg).replace('.', ',');

const unitsOf = (structure: WorkoutStructure): WorkoutSegmentUnit[] => structure.segments.map((segment) => segment.unit ?? 'reps');

export type SheetRowStatus = 'done' | 'current' | 'pending';

export type SheetRow = {
  id: string;
  round: number;
  name: string;
  /** "43 kg", ou null quando o movimento não tem carga. */
  loadLabel: string | null;
  note: string;
  unit: WorkoutSegmentUnit;
  /** "reps", "cal" ou "m". */
  unitShort: string;
  /** "repetições", "calorias" ou "metros" (conforme a meta). */
  unitWord: string;
  target: number;
  done: number;
  remaining: number;
  /** 0 a 100. */
  percent: number;
  status: SheetRowStatus;
  mark: 'reps' | 'end';
  /** Etapa marcada para o desempate (marco fixo ou um dos marcos do último marco concluído). */
  isTieBreak: boolean;
  /** Tempo do desempate ("04:31"), só na etapa que vale como desempate agora. */
  tieBreakTimeLabel: string | null;
};

export type SheetRoundGroup = { round: number; title: string; rows: SheetRow[] };

export type SheetViewModel = {
  format: 'for_time' | 'amrap';
  groups: SheetRoundGroup[];
  /** O título do round só aparece quando a prova tem mais de um round. */
  showRoundTitles: boolean;
  current: SheetRow | null;
  progress: {
    label: string;
    /** 0 a 100 (no AMRAP, o progresso do round em andamento). */
    percent: number;
    done: number;
    /** Total previsto; `null` no AMRAP, que não tem total. */
    target: number | null;
  };
  /** AMRAP: "Round 8" (o round em andamento); For Time: null. */
  roundLabel: string | null;
  /** Desempate que não pertence a uma etapa (último round completo do AMRAP). */
  tieBreakNote: string | null;
  /** For Time com todo o trabalho feito. */
  completed: boolean;
  undoTarget: number | null;
  canUndo: boolean;
};

const clampPercent = (done: number, target: number) => (
  target > 0 ? Math.max(0, Math.min(100, Math.round((done / target) * 100))) : 0
);

const isMarked = (structure: WorkoutStructure, id: string) => {
  const tieBreak = structure.tieBreak;
  if (tieBreak?.kind === 'split_time') return tieBreak.at === id;
  if (tieBreak?.kind === 'last_split') return tieBreak.at.includes(id);
  return false;
};

export const buildSheetViewModel = (
  structure: WorkoutStructure,
  state: SheetState,
  events: readonly SheetEvent[]
): SheetViewModel => {
  const stateById = new Map(state.segments.map((segment) => [segment.id, segment]));
  const rows: SheetRow[] = structure.segments.map((segment) => {
    const segmentState = stateById.get(segment.id);
    const target = segmentState?.target ?? segment.reps;
    const done = segmentState?.done ?? 0;
    const unit = segment.unit ?? 'reps';
    const isCurrent = state.currentSegmentId === segment.id;
    const status: SheetRowStatus = isCurrent ? 'current' : done >= target ? 'done' : 'pending';
    return {
      id: segment.id,
      round: segment.round,
      name: segment.name,
      loadLabel: segment.load ? `${formatKg(segment.load.value)} ${segment.load.unit}` : null,
      note: segment.note,
      unit,
      unitShort: UNIT_WORDS[unit].short,
      unitWord: target === 1 ? UNIT_WORDS[unit].one : UNIT_WORDS[unit].many,
      target,
      done,
      remaining: Math.max(0, target - done),
      percent: clampPercent(done, target),
      status,
      mark: segment.mark,
      isTieBreak: isMarked(structure, segment.id),
      tieBreakTimeLabel: state.tieBreakSegmentId === segment.id && state.tieBreakAt !== null
        ? formatWorkoutTime(state.tieBreakAt)
        : null
    };
  });

  const groups: SheetRoundGroup[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.round === row.round) last.rows.push(row);
    else groups.push({ round: row.round, title: `Round ${row.round}`, rows: [row] });
  }

  const isAmrap = state.format === 'amrap';
  const completed = !isAmrap && state.repsTarget > 0 && state.repsRemaining === 0;
  const undoTarget = findUndoTarget(events);
  const units = unitsOf(structure);

  return {
    format: state.format,
    groups,
    showRoundTitles: groups.length > 1,
    current: rows.find((row) => row.status === 'current') ?? null,
    progress: isAmrap
      ? {
        label: `${state.repsDone} ${workUnitWord(units, state.repsDone)}`,
        percent: clampPercent(state.repsTarget - state.repsRemaining, state.repsTarget),
        done: state.repsDone,
        target: null
      }
      : {
        label: `${state.repsDone}/${state.repsTarget} ${workUnitWord(units, state.repsTarget)}`,
        percent: clampPercent(state.repsDone, state.repsTarget),
        done: state.repsDone,
        target: state.repsTarget
      },
    roundLabel: isAmrap ? `Round ${state.roundsCompleted + 1}` : null,
    tieBreakNote: structure.tieBreak?.kind === 'last_round' && state.tieBreakAt !== null
      ? `Último round completo: ${formatWorkoutTime(state.tieBreakAt)}`
      : null,
    completed,
    undoTarget,
    canUndo: undoTarget !== null
  };
};

export type ResultSummary = {
  /** O resultado principal: "09:41", "10:08", "7 rounds + 12 reps" ou "405 kg". */
  headline: string;
  caption: string;
  details: string[];
  /** Aviso que o judge precisa ver antes de enviar; null quando não há. */
  warning: string | null;
};

const plural = (count: number, singular: string, pluralForm: string) => (count === 1 ? singular : pluralForm);

const TIE_BREAK_LABELS: Record<string, string> = {
  split_time: 'Tie-break',
  last_split: 'Tie-break (último marco)',
  last_round: 'Tie-break (último round completo)'
};

/** Texto do resultado que o motor calculou (nada é recalculado aqui). */
export const buildResultSummary = (structure: WorkoutStructure, result: SheetResult): ResultSummary => {
  const details: string[] = [];
  const units = unitsOf(structure);
  const onlyReps = units.every((unit) => unit === 'reps');
  let headline: string;
  let caption: string;

  if (result.format === 'amrap') {
    const extraWord = onlyReps ? plural(result.extraReps, 'rep', 'reps') : workUnitWord(units, result.extraReps);
    if (structure.scoreDisplay === 'total') {
      headline = `${result.totalReps} ${onlyReps ? plural(result.totalReps, 'rep', 'reps') : workUnitWord(units, result.totalReps)}`;
    } else {
      headline = result.rounds > 0
        ? `${result.rounds} ${plural(result.rounds, 'round', 'rounds')} + ${result.extraReps} ${extraWord}`
        : `${result.extraReps} ${extraWord}`;
    }
    caption = 'Resultado';
    details.push(`Total: ${result.totalReps} ${workUnitWord(units, result.totalReps)}`);
    if (structure.scoreDisplay === 'total' && result.rounds > 0) {
      details.push(`${result.rounds} ${plural(result.rounds, 'round', 'rounds')} + ${result.extraReps} ${extraWord}`);
    }
  } else {
    headline = result.display ?? formatWorkoutTime(result.value);
    if (result.completed) {
      caption = result.finalAdjusted ? 'Tempo oficial' : 'Tempo final';
      details.push(`${result.repsDone} de ${structure.totalReps} ${workUnitWord(units, structure.totalReps)}`);
      if (result.finalAdjusted && result.capturedSeconds !== null) {
        details.push(`Tempo da súmula: ${formatWorkoutTime(result.capturedSeconds)}`);
      }
    } else {
      caption = 'Tempo ajustado pelo time cap';
      const perRep = structure.incomplete?.secondsPerRep ?? 0;
      details.push(`${result.repsDone} de ${structure.totalReps} ${workUnitWord(units, structure.totalReps)}`);
      details.push(
        `${result.repsRemaining} ${plural(result.repsRemaining, 'restante', 'restantes')} × ${perRep} s = +${result.penaltySeconds} s sobre o time cap (${formatWorkoutTime(structure.timeCapSeconds ?? 0)})`
      );
    }
  }

  if (structure.tieBreak) {
    const label = TIE_BREAK_LABELS[structure.tieBreak.kind] ?? 'Tie-break';
    if (result.tieBreakDisplay) {
      details.push(`${label}: ${result.tieBreakDisplay}${result.tieBreakAdjusted ? ' (ajustado)' : ''}`);
    } else {
      details.push(`${label}: sem tempo`);
    }
  }

  return {
    headline,
    caption,
    details,
    warning: result.tieBreakAfterEnd
      ? 'O tempo do tie-break ficou depois do fim da prova. Ajuste antes de enviar.'
      : null
  };
};

// ---------------------------------------------------------------------------
// Carga máxima (Story 1.47)
// ---------------------------------------------------------------------------

export type MaxLoadAttemptChip = {
  /** Posição no log (alvo de um `undo`). */
  position: number;
  /** 1, 2, 3... dentro do movimento. */
  number: number;
  loadLabel: string;
  ok: boolean;
  atLabel: string;
};

export type MaxLoadLiftStatus = 'current' | 'done' | 'pending' | 'locked';

export type MaxLoadLiftRow = {
  id: string;
  name: string;
  /** "1RM", "3RM". */
  repsLabel: string;
  /** "abre com 100 kg", ou null sem carga inicial. */
  startLoadLabel: string | null;
  note: string;
  attempts: MaxLoadAttemptChip[];
  /** Tentativas permitidas; null = ilimitadas. */
  slots: number | null;
  remainingLabel: string;
  bestKg: number | null;
  bestLabel: string | null;
  status: MaxLoadLiftStatus;
  /** O judge pode registrar uma tentativa neste movimento. */
  selectable: boolean;
};

export type MaxLoadViewModel = {
  lifts: MaxLoadLiftRow[];
  current: MaxLoadLiftRow | null;
  order: 'fixed' | 'free';
  /** Carga sugerida para a próxima tentativa do movimento atual. */
  suggestedLoadKg: number;
  stepKg: number;
  scoreLabel: string;
  scoreCaption: string;
  ignoredCount: number;
  undoTarget: number | null;
  canUndo: boolean;
};

const remainingText = (slots: number | null, used: number) => {
  if (slots === null) return used === 0 ? 'Tentativas ilimitadas' : `${used} ${plural(used, 'tentativa', 'tentativas')} · ilimitadas`;
  const left = Math.max(0, slots - used);
  if (left === 0) return 'Tentativas encerradas';
  return `${left} de ${slots} ${plural(slots, 'tentativa restante', 'tentativas restantes')}`;
};

/**
 * Modelo de tela da súmula de carga máxima. `selectedLiftId` é a escolha do
 * judge na tela (ordem livre, ou avançar na ordem fixa); quando a escolha não
 * vale mais, vale o movimento atual do motor.
 */
export const buildMaxLoadViewModel = (
  structure: WorkoutStructure,
  state: MaxLoadSheetState,
  events: readonly SheetEvent[],
  selectedLiftId: string | null = null
): MaxLoadViewModel => {
  const maxLoad = structure.maxLoad;
  const definitions = maxLoad?.lifts ?? [];
  const order = maxLoad?.order === 'free' ? 'free' : 'fixed';
  const furthest = state.lifts.reduce((max, lift, index) => (lift.used > 0 ? index : max), -1);
  const selectableAt = (index: number) => {
    const lift = state.lifts[index];
    if (!lift || lift.exhausted) return false;
    return order === 'free' || index >= furthest;
  };
  const selectedIndex = selectedLiftId ? definitions.findIndex((lift) => lift.id === selectedLiftId) : -1;
  const currentIndex = selectedIndex >= 0 && selectableAt(selectedIndex)
    ? selectedIndex
    : definitions.findIndex((lift) => lift.id === state.currentLiftId);

  const lifts: MaxLoadLiftRow[] = definitions.map((lift, index) => {
    const liftState = state.lifts[index];
    const used = liftState?.used ?? 0;
    const status: MaxLoadLiftStatus = index === currentIndex
      ? 'current'
      : liftState?.exhausted ? 'done'
        : order === 'fixed' && index < furthest ? 'locked' : 'pending';
    return {
      id: lift.id,
      name: lift.name,
      repsLabel: `${lift.reps}RM`,
      startLoadLabel: lift.startLoadKg === null ? null : `abre com ${formatKg(lift.startLoadKg)} kg`,
      note: lift.note,
      attempts: (liftState?.attempts ?? []).map((attempt, attemptIndex) => ({
        position: attempt.position,
        number: attemptIndex + 1,
        loadLabel: `${formatKg(attempt.loadKg)} kg`,
        ok: attempt.ok,
        atLabel: formatWorkoutTime(attempt.at)
      })),
      slots: lift.maxAttempts,
      remainingLabel: remainingText(lift.maxAttempts, used),
      bestKg: liftState?.bestKg ?? null,
      bestLabel: liftState?.bestKg != null ? `${formatKg(liftState.bestKg)} kg` : null,
      status,
      selectable: selectableAt(index)
    };
  });

  const current = currentIndex >= 0 ? lifts[currentIndex] : null;
  const stepKg = maxLoad?.loadStepKg ?? 2.5;
  let suggestedLoadKg = 0;
  if (current) {
    const attempts = state.lifts[currentIndex]?.attempts ?? [];
    const last = attempts[attempts.length - 1];
    const start = definitions[currentIndex]?.startLoadKg;
    suggestedLoadKg = last ? (last.ok ? last.loadKg + stepKg : last.loadKg) : start ?? 0;
    suggestedLoadKg = Math.min(500, Math.round((suggestedLoadKg + Number.EPSILON) * 100) / 100);
  }
  const undoTarget = findUndoTarget(events);

  return {
    lifts,
    current,
    order,
    suggestedLoadKg,
    stepKg,
    scoreLabel: `${formatKg(state.scoreKg)} kg`,
    scoreCaption: maxLoad?.scoring === 'best' ? 'Maior carga válida' : 'Soma das melhores cargas',
    ignoredCount: state.ignored.length,
    undoTarget,
    canUndo: undoTarget !== null
  };
};

/** Texto do resultado da carga máxima que o motor calculou. */
export const buildMaxLoadResultSummary = (structure: WorkoutStructure, result: MaxLoadSheetResult, state: MaxLoadSheetState): ResultSummary => {
  const definitions = structure.maxLoad?.lifts ?? [];
  const details = result.lifts.map((lift) => {
    const name = definitions.find((item) => item.id === lift.id)?.name ?? lift.id;
    return lift.bestKg === null ? `${name}: sem levantamento válido` : `${name}: ${formatKg(lift.bestKg)} kg`;
  });
  details.push(`${result.attemptsUsed} ${plural(result.attemptsUsed, 'tentativa', 'tentativas')}`);
  const kind = structure.tieBreak?.kind;
  if (kind === 'finish_time') details.push(`Tie-break (fim das tentativas): ${result.tieBreakDisplay ?? 'sem tempo'}`);
  if (kind === 'fewest_attempts') details.push(`Tie-break (menos tentativas): ${result.tieBreakAttempts ?? 'sem tentativas'}`);
  const ignored = state.ignored.length;
  return {
    headline: `${formatKg(result.value)} kg`,
    caption: result.scoring === 'best' ? 'Maior carga válida' : 'Soma das melhores cargas',
    details,
    warning: ignored > 0
      ? `${ignored} ${plural(ignored, 'tentativa não contou', 'tentativas não contaram')} (depois da janela, acima do limite ou fora da ordem).`
      : null
  };
};
