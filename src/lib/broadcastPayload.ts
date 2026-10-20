import type { BroadcastMode } from '@/lib/broadcastMode';
import type { AmrapScoreDisplay, WorkoutSegmentUnit, WorkoutStructureFormat } from '@/lib/workoutStructure';

// O que o telão recebe de GET /api/telao/[token] (Stories 1.56 e 1.57). Só o
// que a tela mostra: nome sanitizado, box, raia, progresso e resultados. Sem
// e-mail, telefone, id de usuário ou de inscrição.

export type BroadcastScreen = 'live' | 'call' | 'interval' | 'standby';

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
