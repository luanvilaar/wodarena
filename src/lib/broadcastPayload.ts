import type { BroadcastMode } from '@/lib/broadcastMode';
import {
  formatWorkoutTime,
  intervalPhaseAt,
  type AmrapScoreDisplay,
  type IntervalPhase,
  type WorkoutSegmentUnit,
  type WorkoutStructure,
  type WorkoutStructureFormat
} from '@/lib/workoutStructure';

// O que o telão recebe de GET /api/telao/[token] (Stories 1.56 e 1.57). Só o
// que a tela mostra: nome sanitizado, box, raia, progresso e resultados. Sem
// e-mail, telefone, id de usuário ou de inscrição.

/**
 * Tela do telão. Atenção: `'interval'` aqui é a **tela de intervalo** entre
 * baterias (o geral da categoria), não o formato de prova Intervalado, cujo
 * bloco é `BroadcastWorkout.intervalSpec` (Story 1.63).
 */
export type BroadcastScreen = 'live' | 'call' | 'interval' | 'standby';

/**
 * Bloco do formato Intervalado na prova do telão (Story 1.63): rounds, tempo
 * de trabalho (ON), tempo de descanso (OFF) e o movimento máximo. Nome próprio
 * para não confundir com a tela de intervalo (`BroadcastPayload.interval`).
 */
export type BroadcastIntervalSpec = {
  rounds: number;
  onSeconds: number;
  offSeconds: number;
  max: { id: string; name: string; loadKg: number | null };
};

export type BroadcastWorkout = {
  name: string;
  code: string;
  format: WorkoutStructureFormat;
  timeCapSeconds: number | null;
  /** "21-15-9" quando a prova tem esquema de repetições; senão null. */
  scheme: string | null;
  /** Linhas da prova para a chamada ("Thruster 43 kg", "500 m Row"). */
  lines: string[];
  segments: { id: string; name: string; reps: number; unit: WorkoutSegmentUnit; label: string }[];
  lifts: { id: string; name: string }[];
  totalReps: number;
  scoreDisplay: AmrapScoreDisplay | null;
  /** Só no formato Intervalado; null nos outros. */
  intervalSpec: BroadcastIntervalSpec | null;
};

export type BroadcastHeat = {
  key: string;
  title: string;
  heatNumber: number | null;
  heatCount: number | null;
  divisionNames: string[];
  time: string;
  workout: BroadcastWorkout | null;
};

export type BroadcastLiveEntry = {
  key: string;
  position: number | null;
  lane: number | null;
  name: string;
  box: string;
  divisionName: string;
  status: 'waiting' | 'in_progress' | 'submitted' | 'returned';
  repsDone: number;
  roundsCompleted: number;
  segments: number[];
  currentSegmentId: string | null;
  completedAt: number | null;
  scoreKg: number | null;
  officialResult: string | null;
  /** Só no Intervalado: o round a que `segments` e `currentSegmentId` se referem (do resumo ao vivo); null nos outros formatos e sem registro. */
  round: number | null;
};

export type BroadcastCallLane = { lane: number | null; name: string; box: string; divisionName: string; sheetOpened: boolean };

export type BroadcastStandingRow = {
  position: number;
  delta: number;
  name: string;
  box: string;
  fresh: boolean;
  cells: ({ rank: number; result: string } | null)[];
  points: number;
};

export type BroadcastStandingsBoard = {
  divisionName: string;
  athleteCount: number;
  columns: { label: string; fresh: boolean }[];
  rows: BroadcastStandingRow[];
};

export type BroadcastNext = { title: string; divisionNames: string[]; time: string; workoutName: string };

export type BroadcastPayload = {
  version: string;
  appVersion: string;
  serverTime: string;
  event: { name: string; logoUrl: string };
  mode: BroadcastMode;
  screen: BroadcastScreen;
  live: null | {
    heat: BroadcastHeat;
    /** Largada marcada pelo gestor ou estimada pelas súmulas; null antes do primeiro registro. */
    startedAt: string | null;
    finished: boolean;
    entries: BroadcastLiveEntry[];
  };
  call: null | { heat: BroadcastHeat; lanes: BroadcastCallLane[] };
  interval: null | { boards: BroadcastStandingsBoard[]; afterTitle: string };
  standby: null | { upcoming: BroadcastNext[] };
  next: BroadcastNext | null;
};

// ---------------------------------------------------------------------------
// Formato Intervalado na tela do telão (Story 1.63). Puro: o BroadcastScreen
// usa estas funções a cada passo do relógio local, sem chamada de rede nova.
// ---------------------------------------------------------------------------

/** Esquema da chamada: "5 rounds · 02:00 ON / 02:00 OFF". */
export const intervalSchemeText = (spec: BroadcastIntervalSpec) => (
  `${spec.rounds} ${spec.rounds === 1 ? 'round' : 'rounds'} · ${formatWorkoutTime(spec.onSeconds)} ON / ${formatWorkoutTime(spec.offSeconds)} OFF`
);

/** Linha do movimento máximo na chamada: "Máx. Squat Clean 80 kg". */
export const intervalMaxLine = (max: BroadcastIntervalSpec['max']) => (
  `Máx. ${max.name}${max.loadKg !== null ? ` ${max.loadKg} kg` : ''}`
);

/**
 * Fase da prova no segundo `elapsed` do relógio da bateria, pela mesma função
 * da súmula do judge (`intervalPhaseAt`, Story 1.60), sem conta própria.
 * `intervalPhaseAt` lê só o bloco `interval` (rounds, ON e OFF) da estrutura.
 */
export const broadcastIntervalPhase = (spec: BroadcastIntervalSpec, elapsed: number): IntervalPhase => {
  const structure = {
    interval: {
      rounds: spec.rounds,
      onSeconds: spec.onSeconds,
      offSeconds: spec.offSeconds,
      max: { id: spec.max.id, name: spec.max.name, load: null, note: '' }
    }
  } as Pick<WorkoutStructure, 'interval'> as WorkoutStructure;
  return intervalPhaseAt(structure, Math.max(0, elapsed));
};

export type BroadcastIntervalClock = {
  /** "Round 2 de 5 · Trabalho", "Depois do round 2 de 5 · Descanso" ou "Prova encerrada". */
  line: string;
  /** "Restam no round" ou "Próximo round em"; null depois do fim. */
  countdownCaption: string | null;
  /** Tempo que falta (MM:SS); null depois do fim. */
  countdown: string | null;
};

/** Textos do relógio da bateria para a fase (os mesmos da súmula do judge). */
export const describeIntervalClock = (spec: BroadcastIntervalSpec, phase: IntervalPhase): BroadcastIntervalClock => {
  if (phase.phase === 'work') {
    return { line: `Round ${phase.round} de ${spec.rounds} · Trabalho`, countdownCaption: 'Restam no round', countdown: formatWorkoutTime(phase.secondsLeft) };
  }
  if (phase.phase === 'rest') {
    return { line: `Depois do round ${phase.round} de ${spec.rounds} · Descanso`, countdownCaption: 'Próximo round em', countdown: formatWorkoutTime(phase.secondsLeft) };
  }
  return { line: 'Prova encerrada', countdownCaption: null, countdown: null };
};

/**
 * Barra e movimento da vez de uma raia do Intervalado na fase do relógio da
 * bateria. Se o resumo da raia é de um round anterior ao da fase (trabalho ou
 * descanso), a contagem dele não é a do round atual: a barra fica vazia e o
 * movimento da vez é o primeiro do round (o primeiro fixo ou, sem fixos, o
 * máximo). No descanso, com o resumo do round que acabou de fechar, e depois
 * do fim, a raia fica como o resumo diz.
 */
export const intervalLaneProgress = (
  entry: Pick<BroadcastLiveEntry, 'segments' | 'currentSegmentId' | 'round'>,
  workout: Pick<BroadcastWorkout, 'segments' | 'intervalSpec'>,
  phase: IntervalPhase | null
) => {
  const previousRound = phase !== null && phase.phase !== 'ended' && entry.round !== null && entry.round < phase.round;
  if (!previousRound) return { segments: entry.segments, currentSegmentId: entry.currentSegmentId, previousRound };
  return {
    segments: workout.segments.map(() => 0),
    currentSegmentId: workout.segments[0]?.id ?? workout.intervalSpec?.max.id ?? null,
    previousRound
  };
};
