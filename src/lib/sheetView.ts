import {
  UNIT_WORDS,
  WORKOUT_STRUCTURE_LIMITS,
  checkIntervalEntry,
  formatWorkoutTime,
  intervalPhaseAt,
  workUnitWord
} from '@/lib/workoutStructure';
import type {
  IntervalPhase,
  IntervalSheetResult,
  IntervalSheetState,
  MaxLoadSheetResult,
  MaxLoadSheetState,
  SheetEvent,
  SheetResult,
  SheetState,
  WorkoutSegmentUnit,
  WorkoutStructure
} from '@/lib/workoutStructure';

// Modelo de tela da súmula digital do judge (Story 1.44; unidades e novos
// desempates na 1.48, carga máxima na 1.47, intervalado na 1.62). Puro e sem
// DOM: pega a estrutura da prova, o estado e o resultado que o motor calculou
// e devolve o que a tela precisa mostrar. Nenhum score é calculado aqui; o texto é português fixo,
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

// ---------------------------------------------------------------------------
// Intervalado (Story 1.62, Maquete 2 de docs/design/intervalado/)
// ---------------------------------------------------------------------------

export type IntervalClockPhase = 'work' | 'rest' | 'ended';

/** O movimento da vez (o alvo grande de toque), ou o estado do tile no descanso e no fim. */
export type IntervalTile =
  | {
    kind: 'fixed';
    id: string;
    round: number;
    /** "Thruster · 43 kg". */
    label: string;
    done: number;
    target: number;
    remaining: number;
    /** "de 6 repetições". */
    targetLabel: string;
    mark: 'reps' | 'end';
    /** "Toque +1 · Segure para concluir" ou, marcado por bloco, "Segure para concluir o movimento". */
    hint: string;
  }
  | { kind: 'max'; id: string; round: number; label: string; done: number; targetLabel: string; hint: string }
  | { kind: 'rest'; round: number; label: string; done: number; targetLabel: string; hint: string }
  | { kind: 'ended'; label: string; done: number; targetLabel: string; hint: string };

export type IntervalTableColumn = {
  id: string;
  kind: 'fixed' | 'max';
  /** Sigla do fixo ("RMU") ou o nome inteiro do máximo ("Squat Clean"). */
  short: string;
  /** Nome completo, para leitores de tela e para o título da coluna. */
  name: string;
};

export type IntervalTableRow = {
  round: number;
  /** "feito/meta" de cada fixo, na ordem das colunas. */
  fixed: string[];
  /** Contagem bruta do máximo. */
  maxRaw: number;
  /** O que entra no resultado: o máximo se os fixos estão completos, senão 0. */
  counted: number;
  /** Round em andamento (relógio rodando, na janela de trabalho). */
  current: boolean;
  /** Fixo incompleto com máximo bruto maior que zero: o máximo não conta. */
  flagged: boolean;
};

export type IntervalCorrectionControl = {
  id: string;
  kind: 'fixed' | 'max';
  name: string;
  value: number;
  /** Meta do fixo; null no máximo. */
  target: number | null;
  /** "11/15" no fixo; "9" no máximo. */
  valueLabel: string;
  unit: WorkoutSegmentUnit;
  unitShort: string;
  unitWord: string;
  canDecrease: boolean;
  canIncrease: boolean;
};

export type IntervalCorrectionCard = {
  round: number;
  scored: boolean;
  /** "Trabalho fixo completo" ou "Fixo incompleto"; null numa prova sem fixos. */
  statusLabel: string | null;
  max: IntervalCorrectionControl;
  /** Todos os fixos, na ordem da prova. */
  fixed: IntervalCorrectionControl[];
  /** Fixos abaixo da meta: abertos, como na maquete. */
  openFixed: IntervalCorrectionControl[];
  /** Fixos já na meta: recolhidos em "Ajustar fixos" (AUTO-DECISION 5). */
  collapsedFixed: IntervalCorrectionControl[];
  /** "O Squat Clean deste round só conta se os fixos chegarem à meta." no round que não pontua. */
  warning: string | null;
};

export type IntervalTimelineBlock = { kind: 'work' | 'rest'; seconds: number };

export type IntervalViewModel = {
  rounds: number;
  durationSeconds: number;
  durationLabel: string;
  /** O mesmo segundo que o registro grava (Math.floor). */
  at: number;
  clockLabel: string;
  clockPhase: IntervalClockPhase;
  /** Round da janela (trabalho) ou do round que acabou (descanso); null depois do fim. */
  phaseRound: number | null;
  phaseLabel: string;
  roundLabel: string;
  countdownCaption: string;
  countdownLabel: string;
  /** Fase e round para leitores de tela (muda só quando a fase ou o round mudam). */
  announcement: string;
  timeline: {
    blocks: IntervalTimelineBlock[];
    ticks: { at: number; label: string }[];
    markerPercent: number;
    ariaLabel: string;
  };
  maxName: string;
  tile: IntervalTile;
  columns: IntervalTableColumn[];
  rows: IntervalTableRow[];
  total: number;
  cards: IntervalCorrectionCard[];
  undoTarget: number | null;
  canUndo: boolean;
};

/**
 * Sigla de um movimento fixo para o cabeçalho do quadro dos rounds
 * (AUTO-DECISION 4): sem o trecho entre parênteses e sem as palavras que não
 * começam por letra ("24/20", "#24/20in"); com mais de uma palavra, as
 * iniciais (até 4 letras); com uma só, a palavra inteira.
 */
export const intervalColumnShort = (name: string) => {
  const words = name
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s+/)
    .filter((word) => /^\p{L}/u.test(word));
  if (words.length === 0) return name.trim();
  if (words.length === 1) return words[0];
  return words.map((word) => word[0].toUpperCase()).join('').slice(0, 4);
};

const loadText = (load: { value: number; unit: string } | null | undefined) => (
  load ? `${formatKg(load.value)} ${load.unit}` : null
);

const intervalDuration = (rounds: number, on: number, off: number) => rounds * on + Math.max(0, rounds - 1) * off;

/**
 * Modelo de tela da súmula do intervalado. `seconds` é o relógio da súmula; a
 * fase e o round vêm de intervalPhaseAt (a função do motor), e o estado e as
 * contagens vêm do motor (deriveIntervalState). Nada é recalculado aqui além
 * de rótulos.
 */
export const buildIntervalViewModel = (
  structure: WorkoutStructure,
  state: IntervalSheetState,
  events: readonly SheetEvent[],
  seconds: number,
  phase: IntervalPhase
): IntervalViewModel => {
  const interval = structure.interval;
  const rounds = interval?.rounds ?? state.rounds.length;
  const on = interval?.onSeconds ?? 0;
  const off = interval?.offSeconds ?? 0;
  const durationSeconds = structure.timeCapSeconds ?? intervalDuration(rounds, on, off);
  const at = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const fixedDefs = structure.segments;
  const maxName = interval?.max.name ?? 'Máximo';
  const maxId = interval?.max.id ?? '';
  const maxLoad = loadText(interval?.max.load);
  const roundState = (round: number) => state.rounds[round - 1];

  let phaseLabel: string;
  let roundLabel: string;
  let countdownCaption: string;
  let countdownLabel: string;
  let phaseRound: number | null = null;
  if (phase.phase === 'work') {
    phaseRound = phase.round;
    phaseLabel = 'Trabalho';
    roundLabel = `Round ${phase.round} de ${rounds}`;
    countdownCaption = 'Restam no round';
    countdownLabel = formatWorkoutTime(phase.secondsLeft);
  } else if (phase.phase === 'rest') {
    phaseRound = phase.round;
    phaseLabel = 'Descanso';
    roundLabel = `Depois do round ${phase.round} de ${rounds}`;
    countdownCaption = 'Próximo round em';
    countdownLabel = formatWorkoutTime(phase.secondsLeft);
  } else {
    phaseLabel = 'Prova encerrada';
    roundLabel = `${rounds} ${plural(rounds, 'round feito', 'rounds feitos')}`;
    countdownCaption = 'Pare o relógio';
    countdownLabel = '00:00';
  }

  const repsWord = (count: number) => plural(count, 'repetição', 'repetições');
  let tile: IntervalTile;
  if (phase.phase === 'work') {
    const current = roundState(phase.round);
    const fixedIndex = current ? fixedDefs.findIndex((segment) => segment.id === current.currentId) : -1;
    if (current && fixedIndex >= 0) {
      const segment = fixedDefs[fixedIndex];
      const unit = segment.unit ?? 'reps';
      const done = current.fixed[fixedIndex] ?? 0;
      const segmentLoad = loadText(segment.load);
      tile = {
        kind: 'fixed',
        id: segment.id,
        round: phase.round,
        label: segmentLoad ? `${segment.name} · ${segmentLoad}` : segment.name,
        done,
        target: segment.reps,
        remaining: Math.max(0, segment.reps - done),
        targetLabel: `de ${segment.reps} ${segment.reps === 1 ? UNIT_WORDS[unit].one : UNIT_WORDS[unit].many}`,
        mark: segment.mark,
        hint: segment.mark === 'end' ? 'Segure para concluir o movimento' : 'Toque +1 · Segure para concluir'
      };
    } else {
      const done = current?.maxRaw ?? 0;
      tile = {
        kind: 'max',
        id: maxId,
        round: phase.round,
        label: maxLoad ? `Máx. ${maxName} · ${maxLoad}` : `Máx. ${maxName}`,
        done,
        targetLabel: `${repsWord(done)} neste round`,
        hint: 'Sem meta · conte até o fim da janela'
      };
    }
  } else if (phase.phase === 'rest') {
    const done = roundState(phase.round)?.maxCounted ?? 0;
    tile = {
      kind: 'rest',
      round: phase.round,
      label: 'Descanso',
      done,
      targetLabel: `${repsWord(done)} ${plural(done, 'contada', 'contadas')} no round ${phase.round}`,
      hint: 'Os registros agora não contam'
    };
  } else {
    tile = {
      kind: 'ended',
      label: 'Tempo esgotado',
      done: state.total,
      targetLabel: `${repsWord(state.total)} no total`,
      hint: 'Toque em Parar para revisar'
    };
  }

  const columns: IntervalTableColumn[] = [
    ...fixedDefs.map((segment) => ({ id: segment.id, kind: 'fixed' as const, short: intervalColumnShort(segment.name), name: segment.name })),
    { id: maxId, kind: 'max', short: maxName, name: maxName }
  ];

  const rows: IntervalTableRow[] = state.rounds.map((round) => ({
    round: round.round,
    fixed: fixedDefs.map((segment, index) => `${round.fixed[index] ?? 0}/${segment.reps}`),
    maxRaw: round.maxRaw,
    counted: round.maxCounted,
    current: phase.phase === 'work' && phase.round === round.round,
    flagged: !round.scored && round.maxRaw > 0
  }));

  const control = (
    id: string,
    kind: 'fixed' | 'max',
    name: string,
    value: number,
    target: number | null,
    unit: WorkoutSegmentUnit
  ): IntervalCorrectionControl => ({
    id,
    kind,
    name,
    value,
    target,
    valueLabel: target === null ? String(value) : `${value}/${target}`,
    unit,
    unitShort: UNIT_WORDS[unit].short,
    unitWord: UNIT_WORDS[unit].many,
    canDecrease: value > 0,
    canIncrease: value < (target ?? WORKOUT_STRUCTURE_LIMITS.maxIntervalMaxRepsPerRound)
  });

  const cards: IntervalCorrectionCard[] = state.rounds.map((round) => {
    const fixedControls = fixedDefs.map((segment, index) => control(
      segment.id,
      'fixed',
      segment.name,
      round.fixed[index] ?? 0,
      segment.reps,
      segment.unit ?? 'reps'
    ));
    return {
      round: round.round,
      scored: round.scored,
      statusLabel: fixedDefs.length === 0 ? null : round.scored ? 'Trabalho fixo completo' : 'Fixo incompleto',
      max: control(maxId, 'max', maxName, round.maxRaw, null, 'reps'),
      fixed: fixedControls,
      openFixed: fixedControls.filter((item) => item.value < (item.target ?? 0)),
      collapsedFixed: fixedControls.filter((item) => item.value >= (item.target ?? 0)),
      warning: round.scored ? null : `O ${maxName} deste round só conta se os fixos chegarem à meta.`
    };
  });

  const cycle = on + off;
  const every = Math.max(1, Math.ceil(rounds / 8));
  const ticks: { at: number; label: string }[] = [];
  for (let round = 1; round <= rounds; round += every) ticks.push({ at: (round - 1) * cycle, label: formatWorkoutTime((round - 1) * cycle) });
  const blocks: IntervalTimelineBlock[] = [];
  for (let round = 1; round <= rounds; round += 1) {
    blocks.push({ kind: 'work', seconds: on });
    if (round < rounds && off > 0) blocks.push({ kind: 'rest', seconds: off });
  }
  const rest = off > 0 ? `${formatWorkoutTime(off)} de descanso entre eles` : 'sem descanso entre eles';
  const undoTarget = findUndoTarget(events);

  return {
    rounds,
    durationSeconds,
    durationLabel: formatWorkoutTime(durationSeconds),
    at,
    clockLabel: formatWorkoutTime(at),
    clockPhase: phase.phase,
    phaseRound,
    phaseLabel,
    roundLabel,
    countdownCaption,
    countdownLabel,
    announcement: `${phaseLabel}. ${roundLabel}.`,
    timeline: {
      blocks,
      ticks,
      markerPercent: durationSeconds > 0 ? Math.max(0, Math.min(100, (Math.min(at, durationSeconds) / durationSeconds) * 100)) : 0,
      ariaLabel: `${rounds} rounds de ${formatWorkoutTime(on)} de trabalho, ${rest}, ${formatWorkoutTime(durationSeconds)} no total`
    },
    maxName,
    tile,
    columns,
    rows,
    total: state.total,
    cards,
    undoTarget,
    canUndo: undoTarget !== null
  };
};

/** Mensagem quando o segurar cai fora da janela (a porta do motor fala do toque). */
export const INTERVAL_HOLD_REFUSED = 'Fora da janela de trabalho: o toque não foi aceito.';

export type IntervalTouchDecision =
  | { ok: true; event: SheetEvent }
  /** `refused`: a mensagem da recusa (fora da janela); null quando não há o que registrar dentro dela. */
  | { ok: false; refused: string | null };

/**
 * O que um toque (`tap`) ou um segurar (`hold`) no tile vira, no segundo
 * `seconds` do relógio. Primeiro a porta da tela (checkIntervalEntry, a mesma
 * que o teste de paridade compara com o motor); fora da janela, recusa com a
 * mensagem e nada é emitido. Dentro dela, o movimento da vez do round aceito:
 * o toque soma 1 (`rep`) no fixo abaixo da meta ou, com os fixos feitos, no
 * máximo; o segurar conclui o fixo (`fill` com o que falta) e no máximo não faz
 * nada, porque o máximo não tem meta. Fixo marcado por bloco só conclui pelo
 * segurar.
 */
export const decideIntervalTouch = (
  structure: WorkoutStructure,
  state: IntervalSheetState,
  seconds: number,
  gesture: 'tap' | 'hold'
): IntervalTouchDecision => {
  const at = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const check = checkIntervalEntry(structure, at);
  if (!check.ok) return { ok: false, refused: gesture === 'hold' ? INTERVAL_HOLD_REFUSED : check.error };
  const round = state.rounds[check.round - 1];
  if (!round || !round.currentId) return { ok: false, refused: null };
  const index = structure.segments.findIndex((segment) => segment.id === round.currentId);
  const segment = index >= 0 ? structure.segments[index] : null;
  if (gesture === 'tap') {
    if (segment?.mark === 'end') return { ok: false, refused: null };
    return { ok: true, event: { t: 'rep', seg: round.currentId, at } };
  }
  if (!segment) return { ok: false, refused: null };
  const remaining = segment.reps - (round.fixed[index] ?? 0);
  return remaining > 0 ? { ok: true, event: { t: 'fill', seg: segment.id, n: remaining, at } } : { ok: false, refused: null };
};

export type IntervalResultSummary = {
  /** "Soma do Squat Clean nos 5 rounds". */
  caption: string;
  /** "23". */
  value: string;
  /** "repetições" (ou "repetição"). */
  unitWord: string;
  /** "23 repetições". */
  headline: string;
  /** "Round 1: 9 · Round 2: 8 · …" e uma linha por round que não contou. */
  details: string[];
  /** "1 registro fora da janela não contou (…)."; null sem registro ignorado. */
  warning: string | null;
  note: string;
};

/** Até quantos registros fora da janela o aviso detalha (AUTO-DECISION 6). */
export const INTERVAL_IGNORED_DETAIL_LIMIT = 3;

/**
 * Texto do resultado do intervalado que o motor calculou (nada é recalculado
 * aqui): a soma, o máximo contado de cada round, os rounds que não contaram
 * com os fixos abaixo da meta e o aviso dos registros fora da janela, com o
 * horário e o motivo de até 3 deles.
 */
export const buildIntervalResultSummary = (
  structure: WorkoutStructure,
  result: IntervalSheetResult,
  state: IntervalSheetState,
  events: readonly SheetEvent[]
): IntervalResultSummary => {
  const maxName = structure.interval?.max.name ?? 'máximo';
  const rounds = result.rounds.length;
  const unitWord = plural(result.value, 'repetição', 'repetições');
  const scoredLine = result.rounds
    .filter((round) => round.scored)
    .map((round) => `Round ${round.round}: ${round.maxCounted}`)
    .join(' · ');
  const missLines = result.rounds
    .filter((round) => !round.scored)
    .map((round) => {
      const missing = structure.segments
        .map((segment, index) => ({ segment, done: round.fixed[index] ?? 0 }))
        .filter((item) => item.done < item.segment.reps)
        .map((item) => `${item.segment.name} ${item.done}/${item.segment.reps}`);
      return `Round ${round.round}: 0 (${[...missing, 'o máximo não conta'].join(', ')})`;
    });
  const details = [...(scoredLine ? [scoredLine] : []), ...missLines];

  let warning: string | null = null;
  const ignored = state.ignored;
  if (ignored.length > 0) {
    const reasons = ignored.slice(0, INTERVAL_IGNORED_DETAIL_LIMIT).map((position) => {
      const raw = events[position] as { at?: unknown } | undefined;
      const at = Math.max(0, Math.floor(typeof raw?.at === 'number' && Number.isFinite(raw.at) ? raw.at : 0));
      const where = intervalPhaseAt(structure, at);
      const why = where.phase === 'rest' ? `depois do fim do round ${where.round}` : 'depois do fim da prova';
      return `às ${formatWorkoutTime(at)}, ${why}`;
    });
    const extra = ignored.length - reasons.length;
    const detail = `${plural(ignored.length, 'chegou', 'chegaram')} do aparelho ${reasons.join('; ')}${extra > 0 ? `; e mais ${extra}` : ''}`;
    warning = `${ignored.length} ${plural(ignored.length, 'registro fora da janela não contou', 'registros fora da janela não contaram')} (${detail}).`;
  }

  return {
    caption: `Soma do ${maxName} nos ${rounds} ${plural(rounds, 'round', 'rounds')}`,
    value: result.display,
    unitWord,
    headline: `${result.display} ${unitWord}`,
    details,
    warning,
    note: 'O servidor calcula o mesmo resultado a partir dos registros. O número do aparelho não é aceito como está.'
  };
};
