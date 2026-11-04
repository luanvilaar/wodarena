import { INTERVAL_MIN_MS, type BroadcastMode } from '@/lib/broadcastMode';
import { sortDivisions } from '@/lib/divisionOrder';
import { lastRaceStation, raceStationKeysOf, resolveRaceStageConference } from '@/lib/raceCourseStructure';
import { RACE_NO_RESULT_VALUE, raceOfficialScore } from '@/lib/raceOfficialScore';
import type { RaceStationKind } from '@/lib/raceRules';
import { isRaceAttemptActive } from '@/lib/raceStation';

// Motor puro do telão ao vivo do Fitness Race (Story 1.111; desenho aprovado em
// docs/design/telao-fitness-race/). Sem React, Supabase, fetch nem relógio
// próprio: o instante entra por `nowMs`, a mesma entrada dá a mesma saída e o
// resultado é JSON simples (sem undefined, Map ou Set).
//
// Recebe dados já lidos e já sanitizados: nome e box prontos, chaves opacas no
// lugar dos ids de atleta, categoria e onda. Não calcula chegada prevista,
// ritmo nem chance de ultrapassagem (Regra 8) e nunca devolve tempo de corrida:
// os pontos de leitura são o início e a saída de cada cartão de estação com
// judge (Regra 2). O motivo de uma penalidade nem entra aqui (D2: só segundos).
//
// Saída estável: instantes absolutos em vez de "há N s", para o payload mudar só
// quando um dado muda e duas TVs mostrarem o mesmo passo do rodízio.

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Teto de uma onda na pista desde a largada: tira do ar a onda esquecida (AUTO-DECISION 1, risco R2). */
export const RACE_LIVE_MAX_MS = 3 * 60 * 60_000;
/** Sem leitura por tanto tempo, o rodapé avisa "sem leitura há N min". A tela não sai do ar por isso (AUTO-DECISION 1). */
export const RACE_QUIET_NOTICE_MS = 10 * 60_000;
/** Depois que a última corrida fecha pela súmula, a onda fica na pista por mais isto (o mesmo intervalo mínimo do telão de Functional Fitness). */
export const RACE_CLOSING_HOLD_MS = INTERVAL_MIN_MS;
/** Disputa: diferença máxima, já arredondada em segundos, entre dois vizinhos no mesmo ponto (10,4 vale, 10,5 não). */
export const RACE_BATTLE_MAX_SECONDS = 10;
/** Variação mínima, em segundos, para a tendência da disputa dizer "caiu" ou "subiu". */
export const RACE_TREND_MIN_SECONDS = 0.5;
/** Quantos atletas a reta final mostra, por posição. */
export const RACE_FINALISTS_MAX = 3;
/** Linhas por página da torre, da classificação e do grid. */
export const RACE_PAGE_SIZE = 10;
/** Cada passo do rodízio da torre (onda × categoria). */
export const RACE_LIVE_STEP_MS = 20_000;
/** Cada página da torre de uma categoria com mais de 10 atletas. */
export const RACE_TOWER_PAGE_MS = 8_000;
/** Cada passo da classificação (categoria × página) e do grid quando alterna com ela. */
export const RACE_CLASS_STEP_MS = 12_000;

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

/** Etapa do percurso da categoria (o snapshot do regulamento); a ordem é `orderIndex`, ou a posição na lista. */
export type RaceBroadcastStage = {
  id: string;
  name: string;
  type: 'run' | 'station';
  orderIndex?: number;
  distance?: string;
  reps?: number;
  conferenceKind?: string;
  units?: number;
};

export type RaceBroadcastDivision = {
  key: string;
  name: string;
  orderIndex?: number | null;
  stages: RaceBroadcastStage[];
};

/** Nome já sanitizado (nome da equipe nas equipes) e box. */
export type RaceBroadcastAthlete = { key: string; name: string; box: string; divisionKey: string };

/**
 * Onda = item `kind: 'heat'` do cronograma; `startedAt` é a marca de largada. A lista de ondas
 * vem na ordem de largada prevista (data, horário e número, como `buildRaceWaves`): é ela que
 * define a "próxima onda sem largada". `athleteKeys` na ordem do cronograma, sem vagas vazias.
 */
export type RaceBroadcastWave = {
  key: string;
  title: string;
  date: string;
  time: string;
  heatNumber: number | null;
  athleteKeys: string[];
  startedAt: string | null;
};

export type RaceBroadcastRun = {
  athleteKey: string;
  waveKey: string | null;
  /** `racing`, `finished`, `dnf`, `cancelled` (ou `disqualified`, sem uso desde a D27: vale como sem tempo). */
  status: string;
  officialSeconds: number | null;
  timeSource: 'sheet' | 'manual' | null;
  /** Instante em que a corrida fechou pela súmula (`finish_at`). */
  finishAt: string | null;
  /** Instante da decisão de DNF (não o `updated_at` da corrida, que muda em qualquer ajuste posterior). */
  dnfAt: string | null;
};

export type RaceBroadcastAttempt = {
  athleteKey: string;
  stationId: string;
  /** `waiting`, `running`, `done_pending_release`, `released`, `exited_incomplete`, `redo` ou `cancelled`. */
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  units: number | null;
  expectedUnits: number | null;
  validReps: number | null;
  targetReps: number | null;
};

/** Penalidade vigente (`penalty` e `confirmed`): só os segundos, a estação e o instante. Sem motivo. */
export type RaceBroadcastPenalty = { athleteKey: string; seconds: number; stationId: string | null; at: string | null };

/** Resultado publicado na prova TOTAL da categoria (`value` = segundos; `splits` por id de etapa, D37). */
export type RaceBroadcastResult = {
  athleteKey: string;
  divisionKey: string;
  value: number;
  resultStatus: string | null;
  splits: Record<string, string>;
  /** Instante em que a corrida fechou, quando se sabe (ordena o roxo vindo dos splits). */
  at: string | null;
};

export type RaceBroadcastInput = {
  divisions: RaceBroadcastDivision[];
  athletes: RaceBroadcastAthlete[];
  waves: RaceBroadcastWave[];
  runs: RaceBroadcastRun[];
  attempts: RaceBroadcastAttempt[];
  penalties: RaceBroadcastPenalty[];
  results: RaceBroadcastResult[];
  nowMs: number;
};

/** O que a mesa do gestor e a classificação já calculada dizem; `standings` na ordem em que as categorias devem aparecer. */
export type RaceBroadcastView = {
  mode: BroadcastMode;
  pinnedWaveKey: string | null;
  pinnedDivisionKey: string | null;
  standings: { divisionKey: string; rows: number }[];
};

// ---------------------------------------------------------------------------
// Saída
// ---------------------------------------------------------------------------

export type RaceCourseStageInfo = {
  id: string;
  /** Chave da estação entre categorias (`raceStationKey`); null em corrida. */
  key: string | null;
  name: string;
  type: 'run' | 'station';
  kind: RaceStationKind | null;
  expectedUnits: number | null;
  targetReps: number | null;
  stageIndex: number;
  /** Posição entre as estações (0 é a primeira); null em corrida. */
  stationIndex: number | null;
  /** A estação que fecha o tempo da prova (a última do percurso, D34). */
  closesTime: boolean;
};

export type RaceCourse = {
  stages: RaceCourseStageInfo[];
  stations: RaceCourseStageInfo[];
  closingStationId: string | null;
};

export type RaceProgress =
  | { type: 'reps'; done: number; target: number | null }
  | { type: 'units'; unit: 'trecho' | 'volta'; done: number; target: number }
  | { type: 'time' };

export type RaceRowWhere =
  | {
      kind: 'station';
      stationId: string;
      stationKey: string;
      stationName: string;
      stationKind: RaceStationKind;
      /** Cartão aberto e ainda sem início: não é leitura, só "aguardando início". */
      waiting: boolean;
      startedAt: string | null;
      progress: RaceProgress;
    }
  | {
      kind: 'track';
      afterStationId: string | null;
      afterStationName: string | null;
      /** Saída da última estação (ou a largada); a tela calcula o "tempo desde" com a hora do servidor. */
      sinceAt: string | null;
      /** Última estação encerrada em saída incompleta (D44): fica na pista, sem tempo fechado. */
      closedWithoutTime: boolean;
    }
  | { kind: 'finished' }
  | { kind: 'dnf' };

export type RaceRowPenalty = { seconds: number; stationId: string | null; at: string | null };

export type RaceBoardRow = {
  athleteKey: string;
  name: string;
  box: string;
  /** 1 a N, parcial; null no DNF. */
  position: number | null;
  status: 'racing' | 'finished' | 'dnf';
  isLeader: boolean;
  where: RaceRowWhere;
  /** Casa do mapa: índice em `stages`; null em quem chegou ou desistiu. */
  slot: number | null;
  /** A casa é estimada (entre estações ou antes da primeira leitura), não um cartão aberto. */
  slotEstimated: boolean;
  /** Último ponto de leitura: 2 × índice da estação + 0 no início, + 1 na saída. */
  point: number | null;
  pointAt: string | null;
  /** Segundos inteiros para o líder da categoria no ponto comum; null quando não há o que comparar. */
  gapSeconds: number | null;
  finalSeconds: number | null;
  finalText: string | null;
  finishedBy: 'run' | 'published' | null;
  penaltySeconds: number;
  lastPenalty: RaceRowPenalty | null;
};

export type RaceBoardStage = {
  id: string;
  key: string | null;
  name: string;
  type: 'run' | 'station';
  kind: RaceStationKind | null;
  closesTime: boolean;
  /** Ninguém da onda e categoria teve cartão aqui e alguém já tem cartão mais adiante (AUTO-DECISION 5). */
  semJudge: boolean;
};

export type RaceBattle = {
  /** Posição do que está à frente (a disputa é pelo lugar dele). */
  position: number;
  aheadKey: string;
  backKey: string;
  intervalSeconds: number;
  trend: 'closing' | 'widening' | 'steady' | null;
  trendSeconds: number | null;
  /** Leitura anterior em que os dois já tinham passado. */
  since: { stationName: string; side: 'in' | 'out' } | null;
};

export type RaceFinalist = {
  athleteKey: string;
  position: number | null;
  name: string;
  box: string;
  stationName: string;
  waiting: boolean;
  startedAt: string | null;
  progress: RaceProgress;
};

export type RaceBoard = {
  waveKey: string;
  waveTitle: string;
  startedAt: string | null;
  divisionKey: string;
  divisionName: string;
  stages: RaceBoardStage[];
  rows: RaceBoardRow[];
  battle: RaceBattle | null;
  finalists: RaceFinalist[];
  /** Há líder com leitura (senão a tela mostra "aguardando a primeira leitura"). */
  hasLeaderReading: boolean;
};

export type RaceWaveState = {
  key: string;
  title: string;
  order: number;
  startedAt: string | null;
  started: boolean;
  /** Na pista: corrida `racing` sem resultado (até o teto) ou até 90 s depois de a última fechar pela súmula. */
  onTrack: boolean;
  /** Toda corrida com tempo, DNF ou resultado publicado. */
  finished: boolean;
  /** Fim da última corrida fechada pela súmula (ou o instante da última decisão de DNF); null enquanto alguém corre e quando a onda só terminou por resultado lançado à mão. */
  closedAt: string | null;
  /** Instante da última leitura (maior início ou saída); sem nenhuma, a largada. */
  lastReadingAt: string | null;
  athleteCount: number;
  racingCount: number;
  divisionKeys: string[];
};

export type RaceArrival = {
  athleteKey: string;
  name: string;
  box: string;
  divisionKey: string;
  divisionName: string;
  waveKey: string | null;
  finishAt: string;
  finalSeconds: number;
  finalText: string;
};

export type RaceStationBest = {
  divisionKey: string;
  stationId: string;
  stationKey: string | null;
  stationName: string;
  seconds: number;
  athleteKey: string;
  name: string;
  box: string;
  waveTitle: string;
};

export type RaceStationRecord = RaceStationBest & {
  /** Instante do recorde (fim da tentativa); null quando veio de split publicado sem instante conhecido. */
  at: string | null;
  previous: { seconds: number; name: string; box: string; waveTitle: string } | null;
};

export type RaceScreenResolution =
  | { screen: 'live'; reason: 'auto' | 'pinned'; waveKeys: string[] }
  | { screen: 'grid'; reason: 'auto' | 'pinned'; waveKey: string }
  | { screen: 'class'; reason: 'auto' | 'pinned'; divisionKeys: string[]; gridWaveKey: string | null }
  | { screen: 'standby'; reason: 'auto' | 'pinned' };

export type RaceLiveStep = { waveKey: string; divisionKey: string };

export type RaceClassStep =
  | { kind: 'class'; divisionKey: string; page: number; pageCount: number }
  | { kind: 'grid'; waveKey: string; page: number; pageCount: number };

export type RaceBroadcastComputation = {
  waves: RaceWaveState[];
  resolution: RaceScreenResolution;
  /** Passos do rodízio da torre (só na tela ao vivo). */
  liveSteps: RaceLiveStep[];
  /** Uma torre por passo, na ordem de `liveSteps`. */
  boards: RaceBoard[];
  /** Passos da classificação, com o grid no fim quando alterna (só na tela de classificação). */
  classSteps: RaceClassStep[];
  bests: RaceStationBest[];
  records: RaceStationRecord[];
  arrivals: RaceArrival[];
};

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const toMs = (iso: string | null | undefined): number | null => {
  if (typeof iso !== 'string' || iso === '') return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
};

/** Diferença de milissegundos em segundos inteiros: arredonda para o mais próximo (0,5 sobe), nunca trunca; sem -0. */
const roundedSeconds = (ms: number) => Math.round(ms / 1000) || 0;

const nonNegative = (value: number | null | undefined) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);

/** "mm:ss" ou "h:mm:ss" em segundos; null se não for um tempo. */
export const parseSplitSeconds = (text: unknown): number | null => {
  if (typeof text !== 'string') return null;
  const match = text.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = match[1] ? Number(match[1]) : 0;
  const seconds = hours * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
};

/** Minutos de silêncio quando passaram `RACE_QUIET_NOTICE_MS` sem leitura; null quando não há aviso. */
export const raceQuietMs = (lastReadingAt: string | null, nowMs: number): number | null => {
  const last = toMs(lastReadingAt);
  if (last === null) return null;
  const quiet = nowMs - last;
  return quiet >= RACE_QUIET_NOTICE_MS ? quiet : null;
};

// ---------------------------------------------------------------------------
// Percurso
// ---------------------------------------------------------------------------

const orderStages = <T extends { orderIndex?: number }>(stages: readonly T[]): T[] => stages
  .map((stage, index) => ({ stage, order: typeof stage.orderIndex === 'number' && Number.isFinite(stage.orderIndex) ? stage.orderIndex : index, index }))
  .sort((a, b) => a.order - b.order || a.index - b.index)
  .map((item) => item.stage);

/**
 * Percurso da categoria na ordem da prova, com o tipo e a meta de cada estação
 * (`resolveRaceStageConference`), a chave entre categorias (`raceStationKeysOf`)
 * e a estação que fecha o tempo (`lastRaceStation`, D34).
 */
export const buildRaceCourse = (stages: readonly RaceBroadcastStage[]): RaceCourse => {
  const ordered = orderStages(stages);
  const keys = raceStationKeysOf(ordered);
  const closing = lastRaceStation(ordered);
  let stationIndex = 0;
  const infos: RaceCourseStageInfo[] = ordered.map((stage, stageIndex) => {
    if (stage.type !== 'station') {
      return { id: stage.id, key: null, name: stage.name, type: 'run', kind: null, expectedUnits: null, targetReps: null, stageIndex, stationIndex: null, closesTime: false };
    }
    const conference = resolveRaceStageConference({ id: stage.id, name: stage.name, type: stage.type, distance: stage.distance, conferenceKind: stage.conferenceKind, units: stage.units });
    const reps = typeof stage.reps === 'number' && Number.isInteger(stage.reps) && stage.reps > 0 ? stage.reps : null;
    const info: RaceCourseStageInfo = {
      id: stage.id,
      key: keys.get(stage.id) ?? null,
      name: stage.name,
      type: 'station',
      kind: conference.kind,
      expectedUnits: conference.expectedUnits ?? null,
      targetReps: conference.kind === 'wall_ball' ? reps : null,
      stageIndex,
      stationIndex,
      closesTime: closing?.id === stage.id
    };
    stationIndex += 1;
    return info;
  });
  return { stages: infos, stations: infos.filter((info) => info.type === 'station'), closingStationId: closing?.id ?? null };
};

const EMPTY_COURSE: RaceCourse = { stages: [], stations: [], closingStationId: null };

// ---------------------------------------------------------------------------
// Modelo preparado (índices da entrada)
// ---------------------------------------------------------------------------

type Prepared = {
  input: RaceBroadcastInput;
  courses: Map<string, RaceCourse>;
  stationIndexById: Map<string, Map<string, number>>;
  divisions: Map<string, RaceBroadcastDivision>;
  athletes: Map<string, RaceBroadcastAthlete>;
  waveOfAthlete: Map<string, RaceBroadcastWave>;
  runs: Map<string, RaceBroadcastRun>;
  results: Map<string, RaceBroadcastResult>;
  attempts: Map<string, RaceBroadcastAttempt[]>;
  penalties: Map<string, RaceBroadcastPenalty[]>;
};

const prepare = (input: RaceBroadcastInput): Prepared => {
  const courses = new Map<string, RaceCourse>();
  const stationIndexById = new Map<string, Map<string, number>>();
  for (const division of input.divisions) {
    const course = buildRaceCourse(division.stages);
    courses.set(division.key, course);
    stationIndexById.set(division.key, new Map(course.stations.map((station, index) => [station.id, index])));
  }
  const athletes = new Map(input.athletes.map((athlete) => [athlete.key, athlete]));
  const waveOfAthlete = new Map<string, RaceBroadcastWave>();
  for (const wave of input.waves) for (const key of wave.athleteKeys) if (!waveOfAthlete.has(key)) waveOfAthlete.set(key, wave);
  const runs = new Map<string, RaceBroadcastRun>();
  for (const run of input.runs) if (run.status !== 'cancelled' && !runs.has(run.athleteKey)) runs.set(run.athleteKey, run);
  const results = new Map(input.results.map((result) => [result.athleteKey, result]));
  const attempts = new Map<string, RaceBroadcastAttempt[]>();
  for (const attempt of input.attempts) attempts.set(attempt.athleteKey, [...(attempts.get(attempt.athleteKey) ?? []), attempt]);
  const penalties = new Map<string, RaceBroadcastPenalty[]>();
  for (const penalty of input.penalties) penalties.set(penalty.athleteKey, [...(penalties.get(penalty.athleteKey) ?? []), penalty]);
  return {
    input,
    courses,
    stationIndexById,
    divisions: new Map(input.divisions.map((division) => [division.key, division])),
    athletes,
    waveOfAthlete,
    runs,
    results,
    attempts,
    penalties
  };
};

/**
 * Atletas de uma onda largada, na ordem do cronograma: quem tem corrida desta
 * onda, quem está na lista da onda com resultado publicado e sem corrida
 * (lançamento manual, AUTO-DECISION 3) e quem tem corrida da onda mas o
 * cronograma já não lista.
 */
const waveMemberKeys = (p: Prepared, wave: RaceBroadcastWave): string[] => {
  const keys: string[] = [];
  const seen = new Set<string>();
  const add = (key: string) => {
    if (seen.has(key) || !p.athletes.has(key)) return;
    seen.add(key);
    keys.push(key);
  };
  for (const key of wave.athleteKeys) {
    const run = p.runs.get(key);
    if (run ? run.waveKey === wave.key || run.waveKey === null : p.results.has(key)) add(key);
  }
  for (const run of p.runs.values()) if (run.waveKey === wave.key) add(run.athleteKey);
  return keys;
};

// ---------------------------------------------------------------------------
// Estado de cada atleta
// ---------------------------------------------------------------------------

type Reading = { point: number; ms: number; iso: string };

type AthleteState = {
  athlete: RaceBroadcastAthlete;
  scheduleIndex: number;
  outcome: 'racing' | 'finished' | 'dnf';
  finishedBy: 'run' | 'published' | null;
  finalSeconds: number | null;
  /** Instante em que a corrida fechou (`finish_at` ou decisão de DNF); null quando não se sabe (resultado lançado à mão). */
  closeAtMs: number | null;
  pointTimes: Map<number, number>;
  last: Reading | null;
  lastOut: (Reading & { stationIndex: number }) | null;
  active: { attempt: RaceBroadcastAttempt; stationIndex: number } | null;
  closedWithoutTime: boolean;
  hasAnyCard: boolean;
  cardStationIndexes: number[];
};

const buildState = (p: Prepared, athleteKey: string, scheduleIndex: number): AthleteState => {
  const athlete = p.athletes.get(athleteKey) as RaceBroadcastAthlete;
  const course = p.courses.get(athlete.divisionKey) ?? EMPTY_COURSE;
  const indexById = p.stationIndexById.get(athlete.divisionKey);
  const run = p.runs.get(athleteKey) ?? null;
  const result = p.results.get(athleteKey) ?? null;

  let outcome: AthleteState['outcome'] = 'racing';
  let finishedBy: AthleteState['finishedBy'] = null;
  let finalSeconds: number | null = null;
  let closeAtMs: number | null = null;
  if (run && run.status === 'finished' && typeof run.officialSeconds === 'number' && Number.isFinite(run.officialSeconds)) {
    outcome = 'finished';
    finishedBy = 'run';
    finalSeconds = raceOfficialScore(run.officialSeconds).value;
    closeAtMs = toMs(run.finishAt);
  } else if (run && (run.status === 'dnf' || run.status === 'disqualified')) {
    // `disqualified` não é mais gravado desde a D27, mas o CHECK ainda o aceita: vale como sem tempo e sem posição, nunca derruba.
    outcome = 'dnf';
    closeAtMs = toMs(run.dnfAt);
  } else if (result) {
    if (result.resultStatus === 'dnf' || result.resultStatus === 'absent') {
      outcome = 'dnf';
    } else if (Number.isFinite(result.value) && result.value > 0 && result.value < RACE_NO_RESULT_VALUE) {
      outcome = 'finished';
      finishedBy = 'published';
      finalSeconds = Math.round(result.value);
    }
  }

  const readings: Reading[] = [];
  const pointTimes = new Map<number, number>();
  let active: AthleteState['active'] = null;
  let closedWithoutTime = false;
  const cardStationIndexes: number[] = [];
  for (const attempt of p.attempts.get(athleteKey) ?? []) {
    if (attempt.status === 'cancelled') continue;
    const stationIndex = indexById?.get(attempt.stationId);
    if (stationIndex === undefined) continue;
    cardStationIndexes.push(stationIndex);
    const startMs = toMs(attempt.startedAt);
    if (startMs !== null) readings.push({ point: 2 * stationIndex, ms: startMs, iso: attempt.startedAt as string });
    const endMs = toMs(attempt.endedAt);
    if ((attempt.status === 'released' || attempt.status === 'exited_incomplete') && endMs !== null) {
      readings.push({ point: 2 * stationIndex + 1, ms: endMs, iso: attempt.endedAt as string });
    }
    if (isRaceAttemptActive(attempt.status, run?.status ?? 'racing') && (!active || stationIndex > active.stationIndex)) {
      active = { attempt, stationIndex };
    }
    if (attempt.status === 'exited_incomplete' && course.stations[stationIndex]?.id === course.closingStationId) closedWithoutTime = true;
  }
  for (const reading of readings) {
    const current = pointTimes.get(reading.point);
    if (current === undefined || reading.ms < current) pointTimes.set(reading.point, reading.ms);
  }
  let last: Reading | null = null;
  let lastOut: AthleteState['lastOut'] = null;
  for (const reading of readings) {
    if (!last || reading.point > last.point || (reading.point === last.point && reading.ms > last.ms)) last = reading;
    if (reading.point % 2 === 1 && (!lastOut || reading.point > lastOut.point || (reading.point === lastOut.point && reading.ms > lastOut.ms))) {
      lastOut = { ...reading, stationIndex: (reading.point - 1) / 2 };
    }
  }
  return {
    athlete,
    scheduleIndex,
    outcome,
    finishedBy,
    finalSeconds,
    closeAtMs,
    pointTimes,
    last,
    lastOut,
    active,
    closedWithoutTime: outcome === 'racing' && closedWithoutTime,
    hasAnyCard: cardStationIndexes.length > 0,
    cardStationIndexes
  };
};

const waveStates = (p: Prepared, wave: RaceBroadcastWave): AthleteState[] => {
  const scheduleIndex = new Map(wave.athleteKeys.map((key, index) => [key, index]));
  return waveMemberKeys(p, wave).map((key, index) => buildState(p, key, scheduleIndex.get(key) ?? wave.athleteKeys.length + index));
};

// ---------------------------------------------------------------------------
// Torre de uma onda e categoria
// ---------------------------------------------------------------------------

const progressOf = (station: RaceCourseStageInfo, attempt: RaceBroadcastAttempt): RaceProgress => {
  if (station.kind === 'wall_ball') return { type: 'reps', done: nonNegative(attempt.validReps), target: attempt.targetReps ?? station.targetReps };
  if (station.kind === 'sled' || station.kind === 'sections') {
    const target = attempt.expectedUnits ?? station.expectedUnits;
    if (typeof target === 'number' && target > 0) return { type: 'units', unit: station.kind === 'sled' ? 'trecho' : 'volta', done: nonNegative(attempt.units), target };
  }
  return { type: 'time' };
};

const whereOf = (state: AthleteState, course: RaceCourse, wave: RaceBroadcastWave): RaceRowWhere => {
  if (state.outcome === 'finished') return { kind: 'finished' };
  if (state.outcome === 'dnf') return { kind: 'dnf' };
  if (state.active) {
    const station = course.stations[state.active.stationIndex];
    return {
      kind: 'station',
      stationId: station.id,
      stationKey: station.key ?? '',
      stationName: station.name,
      stationKind: station.kind ?? 'generic',
      waiting: state.active.attempt.status === 'waiting',
      startedAt: state.active.attempt.startedAt ?? null,
      progress: progressOf(station, state.active.attempt)
    };
  }
  if (state.lastOut) {
    const station = course.stations[state.lastOut.stationIndex];
    return { kind: 'track', afterStationId: station.id, afterStationName: station.name, sinceAt: state.lastOut.iso, closedWithoutTime: state.closedWithoutTime };
  }
  return { kind: 'track', afterStationId: null, afterStationName: null, sinceAt: wave.startedAt, closedWithoutTime: false };
};

const slotOf = (state: AthleteState, course: RaceCourse): { slot: number | null; estimated: boolean } => {
  if (state.outcome !== 'racing') return { slot: null, estimated: false };
  if (state.active) return { slot: course.stations[state.active.stationIndex].stageIndex, estimated: false };
  const lastStage = Math.max(0, course.stages.length - 1);
  if (state.lastOut) return { slot: Math.min(course.stations[state.lastOut.stationIndex].stageIndex + 1, lastStage), estimated: true };
  return { slot: 0, estimated: true };
};

/** Diferença no ponto comum mais adiante entre os dois; null sem ponto comum ou com o atleta à frente do líder. */
const gapAtCommonPoint = (state: AthleteState, leader: AthleteState): number | null => {
  let common = -1;
  for (const point of state.pointTimes.keys()) if (leader.pointTimes.has(point) && point > common) common = point;
  if (common < 0) return null;
  const diff = (state.pointTimes.get(common) as number) - (leader.pointTimes.get(common) as number);
  return diff < 0 ? null : roundedSeconds(diff);
};

const penaltyOf = (p: Prepared, athleteKey: string) => {
  const list = p.penalties.get(athleteKey) ?? [];
  let seconds = 0;
  let latest: RaceBroadcastPenalty | null = null;
  let latestMs = -Infinity;
  for (const penalty of list) {
    if (!Number.isFinite(penalty.seconds) || penalty.seconds <= 0) continue;
    seconds += penalty.seconds;
    const at = toMs(penalty.at);
    const atMs = at === null ? -Infinity : at;
    if (!latest || atMs >= latestMs) { latest = penalty; latestMs = atMs; }
  }
  return { seconds, last: latest ? { seconds: latest.seconds, stationId: latest.stationId, at: latest.at } : null };
};

const compareStates = (a: AthleteState, b: AthleteState) => {
  const group = (state: AthleteState) => (state.outcome === 'finished' ? 0 : state.outcome === 'racing' ? 1 : 2);
  const ga = group(a);
  const gb = group(b);
  if (ga !== gb) return ga - gb;
  if (ga === 0) return ((a.finalSeconds as number) - (b.finalSeconds as number)) || (a.scheduleIndex - b.scheduleIndex);
  if (ga === 1) {
    const pa = a.last ? a.last.point : -1;
    const pb = b.last ? b.last.point : -1;
    if (pa !== pb) return pb - pa;
    if (a.last && b.last && a.last.ms !== b.last.ms) return a.last.ms - b.last.ms;
  }
  return a.scheduleIndex - b.scheduleIndex;
};

const buildBattle = (rows: RaceBoardRow[], states: Map<string, AthleteState>, course: RaceCourse): RaceBattle | null => {
  for (let index = 0; index < rows.length - 1; index += 1) {
    const ahead = rows[index];
    const back = rows[index + 1];
    if (ahead.status !== 'racing' || back.status !== 'racing' || ahead.point === null || back.point === null || ahead.point !== back.point) continue;
    const sa = states.get(ahead.athleteKey) as AthleteState;
    const sb = states.get(back.athleteKey) as AthleteState;
    const point = ahead.point;
    const intervalMs = (sb.pointTimes.get(point) as number) - (sa.pointTimes.get(point) as number);
    const interval = roundedSeconds(intervalMs);
    if (intervalMs < 0 || interval > RACE_BATTLE_MAX_SECONDS) continue;
    let trend: RaceBattle['trend'] = null;
    let trendSeconds: number | null = null;
    let since: RaceBattle['since'] = null;
    for (let previous = point - 1; previous >= 0; previous -= 1) {
      if (!sa.pointTimes.has(previous) || !sb.pointTimes.has(previous)) continue;
      const deltaMs = intervalMs - ((sb.pointTimes.get(previous) as number) - (sa.pointTimes.get(previous) as number));
      if (deltaMs <= -RACE_TREND_MIN_SECONDS * 1000) { trend = 'closing'; trendSeconds = roundedSeconds(-deltaMs); }
      else if (deltaMs >= RACE_TREND_MIN_SECONDS * 1000) { trend = 'widening'; trendSeconds = roundedSeconds(deltaMs); }
      else { trend = 'steady'; trendSeconds = 0; }
      const station = course.stations[Math.floor(previous / 2)];
      since = station ? { stationName: station.name, side: previous % 2 === 0 ? 'in' : 'out' } : null;
      break;
    }
    return { position: ahead.position as number, aheadKey: ahead.athleteKey, backKey: back.athleteKey, intervalSeconds: interval, trend, trendSeconds, since };
  }
  return null;
};

const buildBoard = (p: Prepared, wave: RaceBroadcastWave, divisionKey: string): RaceBoard | null => {
  const course = p.courses.get(divisionKey) ?? EMPTY_COURSE;
  const states = waveStates(p, wave).filter((state) => state.athlete.divisionKey === divisionKey).sort(compareStates);
  if (states.length === 0) return null;

  const cardStations = new Set<number>();
  for (const state of states) for (const index of state.cardStationIndexes) cardStations.add(index);
  const furthestCard = cardStations.size ? Math.max(...cardStations) : -1;

  const leader = states.find((state) => state.outcome !== 'dnf') ?? null;
  const stateByKey = new Map(states.map((state) => [state.athlete.key, state]));
  let position = 0;
  const rows: RaceBoardRow[] = states.map((state) => {
    if (state.outcome !== 'dnf') position += 1;
    const penalty = penaltyOf(p, state.athlete.key);
    const { slot, estimated } = slotOf(state, course);
    const isLeader = state === leader && (state.outcome === 'finished' || state.last !== null);
    let gapSeconds: number | null = null;
    if (leader && state !== leader && state.outcome !== 'dnf') {
      gapSeconds = state.outcome === 'finished' && leader.outcome === 'finished'
        ? (state.finalSeconds as number) - (leader.finalSeconds as number)
        : gapAtCommonPoint(state, leader);
    }
    return {
      athleteKey: state.athlete.key,
      name: state.athlete.name,
      box: state.athlete.box,
      position: state.outcome === 'dnf' ? null : position,
      status: state.outcome,
      isLeader,
      where: whereOf(state, course, wave),
      slot,
      slotEstimated: estimated,
      point: state.last ? state.last.point : null,
      pointAt: state.last ? state.last.iso : null,
      gapSeconds,
      finalSeconds: state.finalSeconds,
      finalText: state.finalSeconds === null ? null : raceOfficialScore(state.finalSeconds).result,
      finishedBy: state.finishedBy,
      penaltySeconds: penalty.seconds,
      lastPenalty: penalty.last
    };
  });

  const finalists: RaceFinalist[] = rows
    .filter((row) => row.where.kind === 'station' && row.where.stationId === course.closingStationId)
    .slice(0, RACE_FINALISTS_MAX)
    .map((row) => {
      const where = row.where as Extract<RaceRowWhere, { kind: 'station' }>;
      return { athleteKey: row.athleteKey, position: row.position, name: row.name, box: row.box, stationName: where.stationName, waiting: where.waiting, startedAt: where.startedAt, progress: where.progress };
    });

  const stages: RaceBoardStage[] = course.stages.map((stage) => ({
    id: stage.id,
    key: stage.key,
    name: stage.name,
    type: stage.type,
    kind: stage.kind,
    closesTime: stage.closesTime,
    semJudge: stage.stationIndex !== null && !cardStations.has(stage.stationIndex) && furthestCard > stage.stationIndex
  }));

  return {
    waveKey: wave.key,
    waveTitle: wave.title,
    startedAt: wave.startedAt,
    divisionKey,
    divisionName: p.divisions.get(divisionKey)?.name ?? '',
    stages,
    rows,
    battle: buildBattle(rows, stateByKey, course),
    finalists,
    hasLeaderReading: rows.length > 0 && rows[0].isLeader
  };
};

// ---------------------------------------------------------------------------
// Ondas: na pista, terminada, silêncio
// ---------------------------------------------------------------------------

/** Atletas de uma onda que ainda não largou: os do cronograma que existem no evento (é o que o grid mostra). */
const waveMemberKeysForGrid = (p: Prepared, wave: RaceBroadcastWave) => [...new Set(wave.athleteKeys)].filter((key) => p.athletes.has(key));

/**
 * Estado de uma onda (AC7). Na pista = largou e (tem corrida `racing` sem resultado, até o teto de 3 h
 * desde a largada, ou fechou pela súmula há menos de 90 s). Onda que terminou só por resultado
 * lançado à mão não tem instante de fechamento (não há bandeirada a mostrar): sai da pista assim que
 * o último resultado aparece. Com chegadas fechadas pela súmula e outras lançadas à mão, os 90 s
 * contam a partir da última fechada pela súmula.
 */
const computeWave = (p: Prepared, wave: RaceBroadcastWave, order: number): RaceWaveState => {
  const startMs = toMs(wave.startedAt);
  const started = startMs !== null;
  const states = started ? waveStates(p, wave) : [];
  let racing = 0;
  let closedAtMs: number | null = null;
  let lastReadingMs: number | null = startMs;
  let lastReadingAt: string | null = started ? wave.startedAt : null;
  for (const state of states) {
    if (state.outcome === 'racing') racing += 1;
    else if (state.closeAtMs !== null) closedAtMs = closedAtMs === null ? state.closeAtMs : Math.max(closedAtMs, state.closeAtMs);
    for (const attempt of p.attempts.get(state.athlete.key) ?? []) {
      if (attempt.status === 'cancelled') continue;
      for (const iso of [attempt.startedAt, attempt.endedAt]) {
        const ms = toMs(iso);
        if (ms !== null && (lastReadingMs === null || ms > lastReadingMs)) { lastReadingMs = ms; lastReadingAt = iso; }
      }
    }
  }
  let onTrack = false;
  if (startMs !== null) {
    if (racing > 0) onTrack = p.input.nowMs - startMs < RACE_LIVE_MAX_MS;
    else if (states.length > 0 && closedAtMs !== null) onTrack = p.input.nowMs - closedAtMs < RACE_CLOSING_HOLD_MS;
  }
  const members = started ? states.map((state) => state.athlete) : waveMemberKeysForGrid(p, wave).map((key) => p.athletes.get(key) as RaceBroadcastAthlete);
  const divisionKeys = sortDivisions(
    [...new Set(members.map((athlete) => athlete.divisionKey))]
      .map((key) => ({ id: key, name: p.divisions.get(key)?.name ?? '', orderIndex: p.divisions.get(key)?.orderIndex ?? null }))
  ).map((division) => division.id);
  return {
    key: wave.key,
    title: wave.title,
    order,
    startedAt: started ? wave.startedAt : null,
    started,
    onTrack,
    finished: states.length > 0 && racing === 0,
    closedAt: racing === 0 && closedAtMs !== null ? new Date(closedAtMs).toISOString() : null,
    lastReadingAt,
    athleteCount: members.length,
    racingCount: racing,
    divisionKeys
  };
};

export const computeRaceWaveStates = (input: RaceBroadcastInput): RaceWaveState[] => {
  const p = prepare(input);
  return input.waves.map((wave, order) => computeWave(p, wave, order));
};

// ---------------------------------------------------------------------------
// Escolha da tela
// ---------------------------------------------------------------------------

export type RaceScreenInput = {
  mode: BroadcastMode;
  pinnedWaveKey: string | null;
  pinnedDivisionKey: string | null;
  waves: readonly RaceWaveState[];
  standings: readonly { divisionKey: string; rows: number }[];
};

/** Próxima onda: a primeira do cronograma ainda sem largada (a regra de `nextRaceWaveId`) que tem atleta. */
export const nextRaceWave = (waves: readonly RaceWaveState[]) => waves.find((wave) => !wave.started && wave.athleteCount > 0) ?? null;

/**
 * Qual tela vai ao ar (AC8). O gatilho é só o que a súmula registrou, nunca o
 * horário do cronograma. Mesa: espera, classificação de uma categoria ou onda
 * fixada (grid se não largou, ao vivo se largou, mesmo terminada); onda fixada
 * que não existe cai no automático. Automático: ao vivo com onda na pista;
 * senão a classificação (com resultado publicado), alternando com o grid da
 * próxima onda; senão o grid sozinho (antes da primeira onda); senão a espera.
 */
export const resolveRaceScreen = (input: RaceScreenInput): RaceScreenResolution => {
  if (input.mode === 'standby') return { screen: 'standby', reason: 'pinned' };
  if (input.mode === 'pin_standings' && input.pinnedDivisionKey) {
    return { screen: 'class', reason: 'pinned', divisionKeys: [input.pinnedDivisionKey], gridWaveKey: null };
  }
  if (input.mode === 'pin_heat' && input.pinnedWaveKey) {
    const pinned = input.waves.find((wave) => wave.key === input.pinnedWaveKey);
    if (pinned) return pinned.started ? { screen: 'live', reason: 'pinned', waveKeys: [pinned.key] } : { screen: 'grid', reason: 'pinned', waveKey: pinned.key };
  }

  const onTrack = input.waves
    .filter((wave) => wave.onTrack)
    .sort((a, b) => ((toMs(a.startedAt) ?? 0) - (toMs(b.startedAt) ?? 0)) || (a.order - b.order));
  if (onTrack.length > 0) return { screen: 'live', reason: 'auto', waveKeys: onTrack.map((wave) => wave.key) };

  const next = nextRaceWave(input.waves);
  const withResult = input.standings.filter((standing) => standing.rows > 0).map((standing) => standing.divisionKey);
  if (withResult.length > 0) return { screen: 'class', reason: 'auto', divisionKeys: withResult, gridWaveKey: next?.key ?? null };
  if (next) return { screen: 'grid', reason: 'auto', waveKey: next.key };
  return { screen: 'standby', reason: 'auto' };
};

// ---------------------------------------------------------------------------
// Rodízio e páginas
// ---------------------------------------------------------------------------

/** Passo do rodízio no instante `nowMs` (hora do servidor): duas TVs mostram o mesmo passo. Sem passos, 0. */
export const raceStepIndex = (nowMs: number, stepMs: number, count: number) => (count <= 1 ? 0 : Math.floor(nowMs / stepMs) % count);

/** Passos da torre: onda na pista × categoria com atleta na onda, na ordem em que as torres vieram. */
export const buildRaceLiveSteps = (boards: readonly Pick<RaceBoard, 'waveKey' | 'divisionKey'>[]): RaceLiveStep[] => (
  boards.map((board) => ({ waveKey: board.waveKey, divisionKey: board.divisionKey }))
);

export const racePageCount = (rows: number) => Math.max(1, Math.ceil(Math.max(0, rows) / RACE_PAGE_SIZE));

/**
 * Páginas da torre de uma categoria com mais de 10 atletas (AC9b): o líder e
 * quem está na reta final ficam em toda página e as demais vagas passam por
 * posição. Devolve as chaves dos atletas de cada página, na ordem da torre.
 */
export const raceTowerPages = (
  rows: readonly { athleteKey: string }[],
  fixedKeys: readonly string[],
  pageSize = RACE_PAGE_SIZE
): string[][] => {
  const keys = rows.map((row) => row.athleteKey);
  if (keys.length <= pageSize) return [keys];
  const fixed = new Set(keys.filter((key) => fixedKeys.includes(key)).slice(0, Math.max(0, pageSize - 1)));
  const rest = keys.filter((key) => !fixed.has(key));
  const slots = Math.max(1, pageSize - fixed.size);
  const pageCount = Math.max(1, Math.ceil(rest.length / slots));
  return Array.from({ length: pageCount }, (_, page) => {
    const chosen = new Set([...fixed, ...rest.slice(page * slots, (page + 1) * slots)]);
    return keys.filter((key) => chosen.has(key));
  });
};

/** Chaves fixas em toda página da torre: o líder e quem está na reta final. */
export const raceFixedKeys = (board: Pick<RaceBoard, 'rows' | 'finalists'>) => {
  const leader = board.rows.find((row) => row.isLeader);
  return [...new Set([...(leader ? [leader.athleteKey] : []), ...board.finalists.map((finalist) => finalist.athleteKey)])];
};

/**
 * Passos da classificação (AC9c): categoria × página de 10 linhas, 12 s cada, e,
 * quando alterna, o grid da próxima onda com um passo por página de 10 vagas.
 */
export const buildRaceClassSteps = (input: {
  divisionKeys: readonly string[];
  standings: readonly { divisionKey: string; rows: number }[];
  gridWaveKey: string | null;
  gridAthleteCount: number;
}): RaceClassStep[] => {
  const steps: RaceClassStep[] = [];
  for (const divisionKey of input.divisionKeys) {
    const rows = input.standings.find((standing) => standing.divisionKey === divisionKey)?.rows ?? 0;
    const pageCount = racePageCount(rows);
    for (let page = 0; page < pageCount; page += 1) steps.push({ kind: 'class', divisionKey, page, pageCount });
  }
  if (input.gridWaveKey) {
    const pageCount = racePageCount(input.gridAthleteCount);
    for (let page = 0; page < pageCount; page += 1) steps.push({ kind: 'grid', waveKey: input.gridWaveKey, page, pageCount });
  }
  return steps;
};

// ---------------------------------------------------------------------------
// Roxo de melhor estação
// ---------------------------------------------------------------------------

type Completion = {
  divisionKey: string;
  stationId: string;
  athleteKey: string;
  seconds: number;
  atMs: number | null;
  at: string | null;
  order: number;
};

const bestOf = (completion: Completion, p: Prepared): RaceStationBest => {
  const athlete = p.athletes.get(completion.athleteKey);
  const course = p.courses.get(completion.divisionKey) ?? EMPTY_COURSE;
  const station = course.stations.find((item) => item.id === completion.stationId);
  return {
    divisionKey: completion.divisionKey,
    stationId: completion.stationId,
    stationKey: station?.key ?? null,
    stationName: station?.name ?? '',
    seconds: completion.seconds,
    athleteKey: completion.athleteKey,
    name: athlete?.name ?? '',
    box: athlete?.box ?? '',
    waveTitle: p.waveOfAthlete.get(completion.athleteKey)?.title ?? ''
  };
};

/**
 * Melhor tempo da categoria por estação com judge, somando as ondas (D5):
 * tentativas `released` (fim menos início, segundo mais próximo) e, para quem
 * não tem tentativa na entrada, os `splits` publicados (D37). Recorde novo só
 * com tempo estritamente menor; o empate fica com quem fez antes.
 */
export const computeRaceStationRecords = (input: RaceBroadcastInput): { bests: RaceStationBest[]; records: RaceStationRecord[] } => {
  const p = prepare(input);
  const completions: Completion[] = [];
  let order = 0;
  const withAttempts = new Set<string>();
  for (const attempt of input.attempts) {
    if (attempt.status === 'cancelled') continue;
    withAttempts.add(attempt.athleteKey);
  }
  for (const attempt of input.attempts) {
    if (attempt.status !== 'released') continue;
    const athlete = p.athletes.get(attempt.athleteKey);
    const course = athlete ? p.courses.get(athlete.divisionKey) : null;
    const startMs = toMs(attempt.startedAt);
    const endMs = toMs(attempt.endedAt);
    if (!athlete || !course || startMs === null || endMs === null || endMs <= startMs) continue;
    if (!course.stations.some((station) => station.id === attempt.stationId)) continue;
    const seconds = roundedSeconds(endMs - startMs);
    if (seconds < 1) continue;
    completions.push({ divisionKey: athlete.divisionKey, stationId: attempt.stationId, athleteKey: athlete.key, seconds, atMs: endMs, at: attempt.endedAt, order: order++ });
  }
  for (const result of input.results) {
    if (withAttempts.has(result.athleteKey) || !p.athletes.has(result.athleteKey)) continue;
    const course = p.courses.get(result.divisionKey);
    if (!course) continue;
    const at = toMs(result.at);
    for (const [stationId, text] of Object.entries(result.splits ?? {})) {
      if (stationId.startsWith('race:') || !course.stations.some((station) => station.id === stationId)) continue;
      const seconds = parseSplitSeconds(text);
      if (seconds === null) continue;
      completions.push({ divisionKey: result.divisionKey, stationId, athleteKey: result.athleteKey, seconds, atMs: at, at: at === null ? null : result.at, order: order++ });
    }
  }
  // Do mais antigo ao mais novo; sem instante (split publicado) vem antes e o desempate é a ordem de entrada.
  completions.sort((a, b) => {
    const am = a.atMs ?? -Infinity;
    const bm = b.atMs ?? -Infinity;
    if (am === bm) return a.order - b.order;
    return am < bm ? -1 : 1;
  });

  const best = new Map<string, Completion>();
  const records: RaceStationRecord[] = [];
  for (const completion of completions) {
    const id = `${completion.divisionKey}\u0000${completion.stationId}`;
    const current = best.get(id);
    if (current && completion.seconds >= current.seconds) continue;
    const now = bestOf(completion, p);
    const previous = current ? bestOf(current, p) : null;
    records.push({ ...now, at: completion.at, previous: previous ? { seconds: previous.seconds, name: previous.name, box: previous.box, waveTitle: previous.waveTitle } : null });
    best.set(id, completion);
  }
  const bests = [...best.values()].map((completion) => bestOf(completion, p));
  return { bests, records };
};

// ---------------------------------------------------------------------------
// Chegadas fechadas pela súmula (bandeirada)
// ---------------------------------------------------------------------------

export const computeRaceArrivals = (input: RaceBroadcastInput): RaceArrival[] => {
  const p = prepare(input);
  const arrivals: { arrival: RaceArrival; ms: number }[] = [];
  for (const run of p.runs.values()) {
    if (run.status !== 'finished' || run.timeSource !== 'sheet' || typeof run.officialSeconds !== 'number' || !Number.isFinite(run.officialSeconds)) continue;
    const finishMs = toMs(run.finishAt);
    const athlete = p.athletes.get(run.athleteKey);
    if (finishMs === null || !athlete) continue;
    const score = raceOfficialScore(run.officialSeconds);
    arrivals.push({
      ms: finishMs,
      arrival: {
        athleteKey: athlete.key,
        name: athlete.name,
        box: athlete.box,
        divisionKey: athlete.divisionKey,
        divisionName: p.divisions.get(athlete.divisionKey)?.name ?? '',
        waveKey: run.waveKey,
        finishAt: run.finishAt as string,
        finalSeconds: score.value,
        finalText: score.result
      }
    });
  }
  return arrivals
    .sort((a, b) => a.ms - b.ms || a.arrival.athleteKey.localeCompare(b.arrival.athleteKey))
    .map((item) => item.arrival);
};

// ---------------------------------------------------------------------------
// Tudo junto
// ---------------------------------------------------------------------------

/**
 * Entrada pronta do servidor, saída pronta para a tela: estado das ondas, tela
 * escolhida, torres dos passos do rodízio (só na tela ao vivo), passos da
 * classificação (só nela), roxos e chegadas. Pura: o mesmo `input` e a mesma
 * `view` dão a mesma saída.
 */
export const computeRaceBroadcast = (input: RaceBroadcastInput, view: RaceBroadcastView): RaceBroadcastComputation => {
  const p = prepare(input);
  const waves = input.waves.map((wave, order) => computeWave(p, wave, order));
  const resolution = resolveRaceScreen({ mode: view.mode, pinnedWaveKey: view.pinnedWaveKey, pinnedDivisionKey: view.pinnedDivisionKey, waves, standings: view.standings });

  const boards: RaceBoard[] = [];
  if (resolution.screen === 'live') {
    for (const waveKey of resolution.waveKeys) {
      const wave = input.waves.find((item) => item.key === waveKey);
      const state = waves.find((item) => item.key === waveKey);
      if (!wave || !state) continue;
      for (const divisionKey of state.divisionKeys) {
        const board = buildBoard(p, wave, divisionKey);
        if (board) boards.push(board);
      }
    }
  }

  let classSteps: RaceClassStep[] = [];
  if (resolution.screen === 'class') {
    const grid = resolution.gridWaveKey ? waves.find((item) => item.key === resolution.gridWaveKey) ?? null : null;
    classSteps = buildRaceClassSteps({ divisionKeys: resolution.divisionKeys, standings: view.standings, gridWaveKey: grid ? grid.key : null, gridAthleteCount: grid ? grid.athleteCount : 0 });
  }

  const { bests, records } = computeRaceStationRecords(input);
  return { waves, resolution, liveSteps: buildRaceLiveSteps(boards), boards, classSteps, bests, records, arrivals: computeRaceArrivals(input) };
};
