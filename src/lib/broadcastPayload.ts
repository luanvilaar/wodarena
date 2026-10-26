import type { BroadcastMode } from '@/lib/broadcastMode';
import {
  formatMeters,
  formatTonnageKg,
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
  /** Só na Tonelagem (Story 1.81): o nome do exercício que conta; null nos outros formatos. */
  tonnageLift: string | null;
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

// ---------------------------------------------------------------------------
// Formato Distância na tela do telão (Story 1.69). Puro: o BroadcastScreen usa
// estas funções para a raia e para a vantagem do líder. Os metros vêm do resumo
// ao vivo (`repsDone`, Story 1.66) ou do resultado oficial da súmula.
// ---------------------------------------------------------------------------

export type BroadcastDistanceEntry = {
  /** "6.330", ou "–" enquanto o judge não lançou o total. */
  value: string;
  /** "m" com total; vazio sem. */
  unit: string;
  line: string;
  lineStrong: string;
  official: boolean;
};

/**
 * A raia da distância: o total em metros com a unidade, o texto auxiliar e o
 * selo "Oficial". Sem lançamento (e sem resultado oficial) o valor é "–": o
 * resumo ao vivo não separa "nenhum lançamento" de "0 lançado".
 */
export const describeDistanceEntry = (entry: Pick<BroadcastLiveEntry, 'status' | 'repsDone' | 'officialResult'>): BroadcastDistanceEntry => {
  const official = entry.status === 'submitted' && Boolean(entry.officialResult);
  const meters = official ? Number(entry.officialResult) : entry.repsDone;
  const hasTotal = entry.status !== 'waiting' && Number.isFinite(meters) && (official || meters > 0);
  let line = '';
  let lineStrong = '';
  if (entry.status === 'waiting') line = 'Aguardando o primeiro registro';
  else if (official) lineStrong = 'Oficial';
  else if (entry.status === 'returned') line = 'Súmula em correção';
  else if (entry.status === 'submitted') line = 'Enviada';
  else line = meters > 0 ? 'Total lançado pelo judge' : 'Sem lançamento ainda';
  return { value: hasTotal ? formatMeters(meters) : '–', unit: hasTotal ? 'm' : '', line, lineStrong, official };
};

/** Vantagem do líder sobre o 2º, em metros: "+1.200 m". */
export const distanceGapText = (leaderMeters: number, secondMeters: number) => `+${formatMeters(Math.max(0, leaderMeters - secondMeters))} m`;

// ---------------------------------------------------------------------------
// Formato Tonelagem na tela do telão (Story 1.81). Puro: o BroadcastScreen usa
// estas funções para a raia e para a vantagem do líder. Os kg vêm do resumo ao
// vivo (`scoreKg`, Story 1.77) ou do resultado oficial da súmula.
// ---------------------------------------------------------------------------

export type BroadcastTonnageEntry = {
  /** "830" ou "1.652,5", ou "–" enquanto não houver repetição que conte. */
  value: string;
  /** "kg" com tonelagem; vazio sem. */
  unit: string;
  line: string;
  lineStrong: string;
  official: boolean;
};

/**
 * A raia da tonelagem: a tonelagem em kg com a unidade, o texto auxiliar (a
 * liberação da vez, ou o exercício que conta com as repetições) e o selo
 * "Oficial". Sem repetição (e sem resultado oficial) o valor é "–": o resumo
 * ao vivo não separa "nenhuma repetição" de "0 kg".
 */
export const describeTonnageEntry = (
  entry: Pick<BroadcastLiveEntry, 'status' | 'repsDone' | 'scoreKg' | 'officialResult' | 'currentSegmentId' | 'segments'>,
  workout: Pick<BroadcastWorkout, 'segments' | 'tonnageLift'> | null
): BroadcastTonnageEntry => {
  const official = entry.status === 'submitted' && Boolean(entry.officialResult);
  const kg = official ? Number(entry.officialResult) : entry.scoreKg ?? 0;
  const hasTotal = entry.status !== 'waiting' && Number.isFinite(kg) && (official || kg > 0);
  let line = '';
  let lineStrong = '';
  const segmentIndex = workout?.segments.findIndex((segment) => segment.id === entry.currentSegmentId) ?? -1;
  const segment = segmentIndex >= 0 ? workout?.segments[segmentIndex] : undefined;
  if (entry.status === 'waiting') line = 'Aguardando o primeiro registro';
  else if (official) lineStrong = 'Oficial';
  else if (entry.status === 'returned') line = 'Súmula em correção';
  else if (entry.status === 'submitted') line = 'Enviada';
  else if (segment) {
    // Ainda na liberação: o exercício da vez, com o que falta.
    lineStrong = segment.label;
    line = ` · faltam ${Math.max(0, segment.reps - (entry.segments[segmentIndex] ?? 0))}`;
  } else {
    lineStrong = workout?.tonnageLift ?? 'Tonelagem';
    line = entry.repsDone > 0 ? ` · ${entry.repsDone} ${entry.repsDone === 1 ? 'repetição' : 'repetições'}` : ' · sem repetição ainda';
  }
  return { value: hasTotal ? formatTonnageKg(kg) : '–', unit: hasTotal ? 'kg' : '', line, lineStrong, official };
};

/** Vantagem do líder sobre o 2º, em kg: "+120 kg". */
export const tonnageGapText = (leaderKg: number, secondKg: number) => `+${formatTonnageKg(Math.max(0, leaderKg - secondKg))} kg`;
