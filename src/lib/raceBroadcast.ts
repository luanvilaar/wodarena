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
/** Linhas por página da torre da categoria (ranking único, R3): mais compactas que a torre de uma onda. */
export const RACE_DIVISION_PAGE_SIZE = 15;

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
  /**
   * Largada da corrida (`race_runs.started_at`): a base do tempo de prova do ranking único (R1), a mesma
   * do tempo oficial e da correção de largada (Story 1.107). Sem ela, vale a largada da onda.
   */
  startedAt?: string | null;
};

/**
 * Escala de judges (`race_judge_assignments`): a estação (`raceStationKey`) tem judge na onda
 * (`waveKey`) ou no evento todo (`waveKey: null`). Só serve à checagem de certeza do ranking único (R1).
 */
export type RaceBroadcastCoverage = { stationKey: string; waveKey: string | null };

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
  /** Escala de judges do evento; vazia ou ausente quando o evento não usa escala. */
  coverage?: RaceBroadcastCoverage[];
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

/** Ponto de leitura como a tela escreve: entrada ou saída da estação, ou a chegada (tempo final). */
export type RacePointRef = { stationName: string; side: 'in' | 'out' | 'finish' };

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
  /** Onda do atleta (selo "O3" da torre da categoria). */
  waveKey: string | null;
  waveTitle: string;
  waveNumber: number | null;
  /** Largada da corrida do atleta: a tela conta o relógio dele (tempo de prova) com a hora do servidor. */
  startedAt: string | null;
  /** Tempo de prova no último ponto lido, em segundos inteiros (o tempo final para quem chegou). */
  pointSeconds: number | null;
  lastPointRef: RacePointRef | null;
  /** Ponto em que a diferença para o 1º foi medida. */
  gapPoint: RacePointRef | null;
  /** O relógio do atleta já passou do tempo do 1º num ponto que ele ainda não alcançou (R1, checagem 3). */
  gapCounting: boolean;
  /** Com `gapCounting`: o tempo do 1º naquele ponto, em segundos; a diferença é o relógio do atleta menos isto. */
  gapBaseSeconds: number | null;
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
  /** Ponto em que os dois foram comparados. */
  point: RacePointRef | null;
  /** Os dois são de ondas diferentes (selo "entre ondas" na torre da categoria). */
  crossWave: boolean;
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
  /** Largada da corrida e penalidade vigente: a tela conta o relógio do atleta para o tempo a bater. */
  raceStartedAt: string | null;
  penaltySeconds: number;
  waveNumber: number | null;
};

export type RaceBoard = {
  /** `division`: a torre da categoria com todas as ondas largadas (ranking único); `wave`: a torre de uma onda (mesa). */
  scope: 'division' | 'wave';
  /** Só na torre de uma onda. */
  waveKey: string | null;
  waveTitle: string | null;
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
  /**
   * Ao vivo. `scope: 'division'`: uma torre por categoria em `divisionKeys`, com todas as ondas largadas; `waveKeys`
   * são as ondas na pista (relógios e faixa). `scope: 'wave'`: a torre da onda fixada na mesa, por categoria.
   */
  | { screen: 'live'; reason: 'auto' | 'pinned'; scope: 'division' | 'wave'; waveKeys: string[]; divisionKeys: string[] }
  | { screen: 'grid'; reason: 'auto' | 'pinned'; waveKey: string }
  | { screen: 'class'; reason: 'auto' | 'pinned'; divisionKeys: string[]; gridWaveKey: string | null }
  | { screen: 'standby'; reason: 'auto' | 'pinned' };

/** Passo do rodízio da torre: a categoria (torre da categoria, `waveKey` nulo) ou onda × categoria (onda fixada). */
export type RaceLiveStep = { waveKey: string | null; divisionKey: string };

/** Primeira leitura de um atleta (faixa da direção de prova: "entra no ranking em Nº"). */
export type RaceRankingEntry = { athleteKey: string; divisionKey: string; waveKey: string | null; at: string; point: RacePointRef };

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
  waveByKey: Map<string, RaceBroadcastWave>;
  /** Posição da onda na lista de entrada (ordem de largada prevista). */
  waveOrder: Map<string, number>;
  runs: Map<string, RaceBroadcastRun>;
  results: Map<string, RaceBroadcastResult>;
  attempts: Map<string, RaceBroadcastAttempt[]>;
  penalties: Map<string, RaceBroadcastPenalty[]>;
  /** Escala: `estação|onda` e `estação|*` (evento todo). Vazia quando o evento não usa escala. */
  coverage: Set<string>;
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
  const coverage = new Set<string>();
  for (const item of input.coverage ?? []) if (item.stationKey) coverage.add(`${item.stationKey}|${item.waveKey ?? '*'}`);
  return {
    input,
    courses,
    stationIndexById,
    divisions: new Map(input.divisions.map((division) => [division.key, division])),
    athletes,
    waveOfAthlete,
    waveByKey: new Map(input.waves.map((wave) => [wave.key, wave])),
    waveOrder: new Map(input.waves.map((wave, index) => [wave.key, index])),
    runs,
    results,
    attempts,
    penalties,
    coverage
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
  /** Onda da corrida do atleta (ou a primeira do cronograma em que ele aparece). */
  wave: RaceBroadcastWave | null;
  /** Largada da corrida (`startedAt` da corrida, senão a da onda): base do tempo de prova. */
  startMs: number | null;
  startIso: string | null;
};

const buildState = (p: Prepared, athleteKey: string, scheduleIndex: number): AthleteState => {
  const athlete = p.athletes.get(athleteKey) as RaceBroadcastAthlete;
  const course = p.courses.get(athlete.divisionKey) ?? EMPTY_COURSE;
  const indexById = p.stationIndexById.get(athlete.divisionKey);
  const run = p.runs.get(athleteKey) ?? null;
  const result = p.results.get(athleteKey) ?? null;
  const wave = (run?.waveKey ? p.waveByKey.get(run.waveKey) : undefined) ?? p.waveOfAthlete.get(athleteKey) ?? null;
  const runStartMs = toMs(run?.startedAt);
  const startIso = runStartMs !== null ? (run?.startedAt as string) : (toMs(wave?.startedAt) !== null ? (wave?.startedAt as string) : null);

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
    cardStationIndexes,
    wave,
    startMs: toMs(startIso),
    startIso
  };
};

const waveStates = (p: Prepared, wave: RaceBroadcastWave): AthleteState[] => {
  const scheduleIndex = new Map(wave.athleteKeys.map((key, index) => [key, index]));
  return waveMemberKeys(p, wave).map((key, index) => buildState(p, key, scheduleIndex.get(key) ?? wave.athleteKeys.length + index));
};

// ---------------------------------------------------------------------------
// Onde está cada atleta e ordem da torre de uma onda
// ---------------------------------------------------------------------------

const progressOf = (station: RaceCourseStageInfo, attempt: RaceBroadcastAttempt): RaceProgress => {
  if (station.kind === 'wall_ball') return { type: 'reps', done: nonNegative(attempt.validReps), target: attempt.targetReps ?? station.targetReps };
  if (station.kind === 'sled' || station.kind === 'sections') {
    const target = attempt.expectedUnits ?? station.expectedUnits;
    if (typeof target === 'number' && target > 0) return { type: 'units', unit: station.kind === 'sled' ? 'trecho' : 'volta', done: nonNegative(attempt.units), target };
  }
  return { type: 'time' };
};

const whereOf = (state: AthleteState, course: RaceCourse, sinceStart: string | null): RaceRowWhere => {
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
  return { kind: 'track', afterStationId: null, afterStationName: null, sinceAt: sinceStart, closedWithoutTime: false };
};

const slotOf = (state: AthleteState, course: RaceCourse): { slot: number | null; estimated: boolean } => {
  if (state.outcome !== 'racing') return { slot: null, estimated: false };
  if (state.active) return { slot: course.stations[state.active.stationIndex].stageIndex, estimated: false };
  const lastStage = Math.max(0, course.stages.length - 1);
  if (state.lastOut) return { slot: Math.min(course.stations[state.lastOut.stationIndex].stageIndex + 1, lastStage), estimated: true };
  return { slot: 0, estimated: true };
};

/** O maior ponto que os dois mapas têm, até `upTo`; -1 quando não há. */
const commonPointOf = (a: ReadonlyMap<number, number>, b: ReadonlyMap<number, number>, upTo = Infinity) => {
  let common = -1;
  for (const point of a.keys()) if (point <= upTo && point > common && b.has(point)) common = point;
  return common;
};

/** Diferença no ponto comum mais adiante entre os dois (torre de uma onda); null sem ponto comum ou com o atleta à frente do líder. */
const gapAtCommonPoint = (state: AthleteState, leader: AthleteState): { seconds: number; point: number } | null => {
  const common = commonPointOf(state.pointTimes, leader.pointTimes);
  if (common < 0) return null;
  const diff = (state.pointTimes.get(common) as number) - (leader.pointTimes.get(common) as number);
  return diff < 0 ? null : { seconds: roundedSeconds(diff), point: common };
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

// ---------------------------------------------------------------------------
// Tempo de prova (ranking único, R1 e R2)
// ---------------------------------------------------------------------------

/** O ponto da chegada: depois de qualquer leitura (2 × índice da estação + 0 ou 1). Só quem fechou o tempo tem. */
const finishPointOf = (course: RaceCourse) => 2 * course.stations.length;

const closingStationIndex = (course: RaceCourse) => course.stations.findIndex((station) => station.id === course.closingStationId);

/** O ponto como a tela escreve: entrada ou saída da estação, ou a chegada. */
const pointRefOf = (course: RaceCourse, point: number | null): RacePointRef | null => {
  if (point === null || point < 0) return null;
  if (point >= finishPointOf(course)) {
    const closing = course.stations[closingStationIndex(course)];
    return { stationName: closing?.name ?? '', side: 'finish' };
  }
  const station = course.stations[Math.floor(point / 2)];
  return station ? { stationName: station.name, side: point % 2 === 0 ? 'in' : 'out' } : null;
};

/** Penalidades vigentes lançadas até `atMs`, em ms (R2: contam a partir do lançamento; sem instante, contam sempre). */
const penaltyMsUpTo = (p: Prepared, athleteKey: string, atMs: number) => {
  let total = 0;
  for (const penalty of p.penalties.get(athleteKey) ?? []) {
    if (!Number.isFinite(penalty.seconds) || penalty.seconds <= 0) continue;
    const at = toMs(penalty.at);
    if (at === null || at <= atMs) total += penalty.seconds * 1000;
  }
  return total;
};

type Timed = {
  state: AthleteState;
  /** Tempo de prova (ms) em cada ponto lido; quem fechou tem também o ponto da chegada, com o tempo final. */
  times: Map<number, number>;
  /** O ponto mais adiantado (a chegada para quem fechou); -1 sem leitura. */
  last: number;
  /** Relógio de quem ainda corre: tempo de prova agora, com as penalidades já lançadas. */
  clockMs: number | null;
  finished: boolean;
};

const timedOf = (p: Prepared, state: AthleteState, course: RaceCourse): Timed => {
  const key = state.athlete.key;
  const times = new Map<number, number>();
  if (state.startMs !== null) {
    for (const [point, ms] of state.pointTimes) times.set(point, ms - state.startMs + penaltyMsUpTo(p, key, ms));
  }
  const finished = state.outcome === 'finished' && state.finalSeconds !== null;
  if (finished) times.set(finishPointOf(course), (state.finalSeconds as number) * 1000);
  let last = -1;
  for (const point of times.keys()) if (point > last) last = point;
  const clockMs = state.outcome === 'racing' && state.startMs !== null
    ? p.input.nowMs - state.startMs + penaltyMsUpTo(p, key, p.input.nowMs)
    : null;
  return { state, times, last, clockMs, finished };
};

type Coverage = (point: number, waveKey: string | null) => boolean;

/**
 * A estação do ponto tem judge na onda (R1, checagem 3): pela escala da onda ou do evento todo, ou porque
 * alguém da onda nesta categoria já tem cartão nela. Evento sem escala nenhuma: vale a estação com cartão
 * de qualquer onda da categoria (AUTO-DECISION T6-2).
 */
const coverageOf = (p: Prepared, course: RaceCourse, cardWaves: ReadonlyMap<number, ReadonlySet<string>>): Coverage => (point, waveKey) => {
  const index = point >= finishPointOf(course) ? closingStationIndex(course) : Math.floor(point / 2);
  const station = course.stations[index];
  if (!station) return false;
  if (station.key && (p.coverage.has(`${station.key}|*`) || (waveKey !== null && p.coverage.has(`${station.key}|${waveKey}`)))) return true;
  const waves = cardWaves.get(index);
  if (!waves || waves.size === 0) return false;
  if (waves.has(waveKey ?? '')) return true;
  return p.coverage.size === 0;
};

/**
 * Confronto de dois atletas pelo tempo de prova (R1): < 0 quando `a` está à frente, > 0 quando `b`
 * está, 0 sem decisão. (2) Mesmo ponto mais adiantado: menos tempo de prova. (3) Um passou por um
 * ponto que o outro não alcançou e o relógio do outro já passou daquele tempo (com judge na onda do
 * outro): o outro está atrás com certeza. (4) Senão, o último ponto que os dois já passaram.
 */
const confront = (a: Timed, b: Timed, covered: Coverage): number => {
  if (a.last === b.last) return (a.times.get(a.last) as number) - (b.times.get(b.last) as number);
  const aFurther = a.last > b.last;
  const ahead = aFurther ? a : b;
  const behind = aFurther ? b : a;
  const aheadTime = ahead.times.get(ahead.last) as number;
  if (!behind.finished && behind.clockMs !== null && aheadTime < behind.clockMs && covered(ahead.last, behind.state.wave?.key ?? null)) {
    return aFurther ? -1 : 1;
  }
  const common = commonPointOf(a.times, b.times, Math.min(a.last, b.last));
  if (common < 0) return 0;
  return (a.times.get(common) as number) - (b.times.get(common) as number);
};

const waveOrderOf = (p: Prepared, state: AthleteState) => (state.wave ? p.waveOrder.get(state.wave.key) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER);

const byWaveThenSchedule = (p: Prepared) => (a: Timed, b: Timed) => (
  (waveOrderOf(p, a.state) - waveOrderOf(p, b.state)) || (a.state.scheduleIndex - b.state.scheduleIndex) || a.state.athlete.key.localeCompare(b.state.athlete.key)
);

/**
 * Ordem da torre da categoria: quem vence mais confrontos vem antes (em casos raros os confrontos formam
 * um ciclo, e a contagem resolve). Confronto sem decisão vai para quem está mais adiante. Empate: mais
 * adiante, menos tempo de prova no próprio ponto, a onda que largou antes, a ordem do cronograma.
 */
const rankByConfrontation = (p: Prepared, list: readonly Timed[], covered: Coverage): Timed[] => {
  const wins = new Map<Timed, number>(list.map((item) => [item, 0]));
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      let result = confront(list[i], list[j], covered);
      if (result === 0) result = list[j].last - list[i].last;
      if (result < 0) wins.set(list[i], (wins.get(list[i]) as number) + 1);
      else if (result > 0) wins.set(list[j], (wins.get(list[j]) as number) + 1);
    }
  }
  const tie = byWaveThenSchedule(p);
  return [...list].sort((a, b) => (
    ((wins.get(b) as number) - (wins.get(a) as number))
    || (b.last - a.last)
    || ((a.times.get(a.last) as number) - (b.times.get(b.last) as number))
    || tie(a, b)
  ));
};

type GapToLeader = { seconds: number; point: number; counting: boolean; baseMs: number | null };

/**
 * Diferença para o 1º da torre da categoria, no ponto em que se comparam: o mesmo ponto; o "contando"
 * (relógio do atleta menos o tempo do 1º num ponto que ele ainda não alcançou, R1 checagem 3); senão o
 * último ponto comum. Entre dois que fecharam, os tempos finais. Pode ser negativa. Null sem ponto comum.
 */
const gapToLeader = (x: Timed, leader: Timed, covered: Coverage): GapToLeader | null => {
  if (x === leader) return null;
  if (x.finished && leader.finished) {
    return { seconds: (x.state.finalSeconds as number) - (leader.state.finalSeconds as number), point: x.last, counting: false, baseMs: null };
  }
  if (x.last === leader.last) {
    return { seconds: roundedSeconds((x.times.get(x.last) as number) - (leader.times.get(leader.last) as number)), point: x.last, counting: false, baseMs: null };
  }
  if (leader.last > x.last && !x.finished && x.clockMs !== null) {
    const leaderTime = leader.times.get(leader.last) as number;
    if (leaderTime < x.clockMs && covered(leader.last, x.state.wave?.key ?? null)) {
      return { seconds: roundedSeconds(x.clockMs - leaderTime), point: leader.last, counting: true, baseMs: leaderTime };
    }
  }
  const common = commonPointOf(x.times, leader.times, Math.min(x.last, leader.last));
  if (common < 0) return null;
  return { seconds: roundedSeconds((x.times.get(common) as number) - (leader.times.get(common) as number)), point: common, counting: false, baseMs: null };
};

// ---------------------------------------------------------------------------
// Linhas, disputa e reta final
// ---------------------------------------------------------------------------

const makeRow = (
  p: Prepared,
  timed: Timed,
  course: RaceCourse,
  options: { position: number | null; isLeader: boolean; gap: GapToLeader | null; sinceStart: string | null }
): RaceBoardRow => {
  const state = timed.state;
  const penalty = penaltyOf(p, state.athlete.key);
  const { slot, estimated } = slotOf(state, course);
  const gap = options.gap;
  return {
    athleteKey: state.athlete.key,
    name: state.athlete.name,
    box: state.athlete.box,
    position: options.position,
    status: state.outcome,
    isLeader: options.isLeader,
    where: whereOf(state, course, options.sinceStart),
    slot,
    slotEstimated: estimated,
    point: state.last ? state.last.point : null,
    pointAt: state.last ? state.last.iso : null,
    gapSeconds: gap ? gap.seconds : null,
    finalSeconds: state.finalSeconds,
    finalText: state.finalSeconds === null ? null : raceOfficialScore(state.finalSeconds).result,
    finishedBy: state.finishedBy,
    penaltySeconds: penalty.seconds,
    lastPenalty: penalty.last,
    waveKey: state.wave?.key ?? null,
    waveTitle: state.wave?.title ?? '',
    waveNumber: state.wave?.heatNumber ?? null,
    startedAt: state.startIso,
    pointSeconds: timed.last >= 0 ? Math.round((timed.times.get(timed.last) as number) / 1000) : null,
    lastPointRef: pointRefOf(course, timed.last >= 0 ? timed.last : null),
    gapPoint: gap ? pointRefOf(course, gap.point) : null,
    gapCounting: gap ? gap.counting : false,
    gapBaseSeconds: gap && gap.baseMs !== null ? gap.baseMs / 1000 : null
  };
};

/** Tendência de uma disputa desde a leitura anterior em que os dois já tinham passado. */
const battleTrend = (aheadTimes: ReadonlyMap<number, number>, backTimes: ReadonlyMap<number, number>, point: number, intervalMs: number, course: RaceCourse) => {
  for (let previous = point - 1; previous >= 0; previous -= 1) {
    if (!aheadTimes.has(previous) || !backTimes.has(previous)) continue;
    const deltaMs = intervalMs - ((backTimes.get(previous) as number) - (aheadTimes.get(previous) as number));
    let trend: RaceBattle['trend'];
    let trendSeconds: number;
    if (deltaMs <= -RACE_TREND_MIN_SECONDS * 1000) { trend = 'closing'; trendSeconds = roundedSeconds(-deltaMs); }
    else if (deltaMs >= RACE_TREND_MIN_SECONDS * 1000) { trend = 'widening'; trendSeconds = roundedSeconds(deltaMs); }
    else { trend = 'steady'; trendSeconds = 0; }
    const station = course.stations[Math.floor(previous / 2)];
    const since: RaceBattle['since'] = station ? { stationName: station.name, side: previous % 2 === 0 ? 'in' : 'out' } : null;
    return { trend, trendSeconds, since };
  }
  return { trend: null, trendSeconds: null, since: null };
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
    const { trend, trendSeconds, since } = battleTrend(sa.pointTimes, sb.pointTimes, point, intervalMs, course);
    return { position: ahead.position as number, aheadKey: ahead.athleteKey, backKey: back.athleteKey, intervalSeconds: interval, trend, trendSeconds, since, point: pointRefOf(course, point), crossWave: false };
  }
  return null;
};

/**
 * Disputa da torre da categoria: dois vizinhos com posição, não os dois com tempo fechado, comparados pelo
 * tempo de prova no último ponto do menos adiantado, a até 10 s (Regra 4). Pode ser entre ondas.
 */
const buildDivisionBattle = (rows: RaceBoardRow[], timedByKey: Map<string, Timed>, course: RaceCourse): RaceBattle | null => {
  for (let index = 0; index < rows.length - 1; index += 1) {
    const ahead = rows[index];
    const back = rows[index + 1];
    if (ahead.position === null || back.position === null) break;
    if (ahead.status === 'finished' && back.status === 'finished') continue;
    const ta = timedByKey.get(ahead.athleteKey) as Timed;
    const tb = timedByKey.get(back.athleteKey) as Timed;
    const point = Math.min(ta.last, tb.last);
    if (!ta.times.has(point) || !tb.times.has(point)) continue;
    const intervalMs = (tb.times.get(point) as number) - (ta.times.get(point) as number);
    const interval = roundedSeconds(intervalMs);
    if (intervalMs < 0 || interval > RACE_BATTLE_MAX_SECONDS) continue;
    const { trend, trendSeconds, since } = battleTrend(ta.times, tb.times, point, intervalMs, course);
    return {
      position: ahead.position,
      aheadKey: ahead.athleteKey,
      backKey: back.athleteKey,
      intervalSeconds: interval,
      trend,
      trendSeconds,
      since,
      point: pointRefOf(course, point),
      crossWave: ahead.waveKey !== back.waveKey
    };
  }
  return null;
};

const finalistsOf = (rows: readonly RaceBoardRow[], course: RaceCourse): RaceFinalist[] => rows
  .filter((row) => row.where.kind === 'station' && row.where.stationId === course.closingStationId)
  .slice(0, RACE_FINALISTS_MAX)
  .map((row) => {
    const where = row.where as Extract<RaceRowWhere, { kind: 'station' }>;
    return {
      athleteKey: row.athleteKey,
      position: row.position,
      name: row.name,
      box: row.box,
      stationName: where.stationName,
      waiting: where.waiting,
      startedAt: where.startedAt,
      progress: where.progress,
      raceStartedAt: row.startedAt,
      penaltySeconds: row.penaltySeconds,
      waveNumber: row.waveNumber
    };
  });

const boardStages = (course: RaceCourse, cardStations: ReadonlySet<number>): RaceBoardStage[] => {
  const furthestCard = cardStations.size ? Math.max(...cardStations) : -1;
  return course.stages.map((stage) => ({
    id: stage.id,
    key: stage.key,
    name: stage.name,
    type: stage.type,
    kind: stage.kind,
    closesTime: stage.closesTime,
    semJudge: stage.stationIndex !== null && !cardStations.has(stage.stationIndex) && furthestCard > stage.stationIndex
  }));
};

// ---------------------------------------------------------------------------
// Torre de uma onda e categoria (mesa: "Fixar uma onda")
// ---------------------------------------------------------------------------

const buildBoard = (p: Prepared, wave: RaceBroadcastWave, divisionKey: string): RaceBoard | null => {
  const course = p.courses.get(divisionKey) ?? EMPTY_COURSE;
  const states = waveStates(p, wave).filter((state) => state.athlete.divisionKey === divisionKey).sort(compareStates);
  if (states.length === 0) return null;

  const cardStations = new Set<number>();
  for (const state of states) for (const index of state.cardStationIndexes) cardStations.add(index);

  const leader = states.find((state) => state.outcome !== 'dnf') ?? null;
  const stateByKey = new Map(states.map((state) => [state.athlete.key, state]));
  let position = 0;
  const rows: RaceBoardRow[] = states.map((state) => {
    if (state.outcome !== 'dnf') position += 1;
    const isLeader = state === leader && (state.outcome === 'finished' || state.last !== null);
    let gap: GapToLeader | null = null;
    if (leader && state !== leader && state.outcome !== 'dnf') {
      if (state.outcome === 'finished' && leader.outcome === 'finished') {
        gap = { seconds: (state.finalSeconds as number) - (leader.finalSeconds as number), point: finishPointOf(course), counting: false, baseMs: null };
      } else {
        const common = gapAtCommonPoint(state, leader);
        gap = common ? { seconds: common.seconds, point: common.point, counting: false, baseMs: null } : null;
      }
    }
    return makeRow(p, timedOf(p, state, course), course, { position: state.outcome === 'dnf' ? null : position, isLeader, gap, sinceStart: wave.startedAt });
  });

  return {
    scope: 'wave',
    waveKey: wave.key,
    waveTitle: wave.title,
    startedAt: wave.startedAt,
    divisionKey,
    divisionName: p.divisions.get(divisionKey)?.name ?? '',
    stages: boardStages(course, cardStations),
    rows,
    battle: buildBattle(rows, stateByKey, course),
    finalists: finalistsOf(rows, course),
    hasLeaderReading: rows.length > 0 && rows[0].isLeader
  };
};

// ---------------------------------------------------------------------------
// Torre da categoria (ranking único, R1 a R3)
// ---------------------------------------------------------------------------

/** Atletas da categoria em todas as ondas já largadas, na ordem das ondas e do cronograma, sem repetir. */
const divisionMembers = (p: Prepared, divisionKey: string) => {
  const seen = new Set<string>();
  const members: { key: string; scheduleIndex: number }[] = [];
  for (const wave of p.input.waves) {
    if (toMs(wave.startedAt) === null) continue;
    const scheduleIndex = new Map(wave.athleteKeys.map((key, index) => [key, index]));
    waveMemberKeys(p, wave).forEach((key, index) => {
      if (seen.has(key) || p.athletes.get(key)?.divisionKey !== divisionKey) return;
      seen.add(key);
      members.push({ key, scheduleIndex: scheduleIndex.get(key) ?? wave.athleteKeys.length + index });
    });
  }
  return members;
};

/**
 * A torre da categoria (R1): todos os atletas das ondas largadas, ordenados pelo confronto de tempo de
 * prova. Posição só para quem tem leitura ou tempo final; quem largou e não tem leitura vem depois, sem
 * posição; DNF por último. Null quando nenhuma onda da categoria largou.
 */
const buildDivisionBoard = (p: Prepared, divisionKey: string): RaceBoard | null => {
  const course = p.courses.get(divisionKey) ?? EMPTY_COURSE;
  const members = divisionMembers(p, divisionKey);
  if (members.length === 0) return null;
  const states = members.map((member) => buildState(p, member.key, member.scheduleIndex));

  const cardStations = new Set<number>();
  const cardWaves = new Map<number, Set<string>>();
  for (const state of states) {
    for (const index of state.cardStationIndexes) {
      cardStations.add(index);
      const waves = cardWaves.get(index) ?? new Set<string>();
      waves.add(state.wave?.key ?? '');
      cardWaves.set(index, waves);
    }
  }
  const covered = coverageOf(p, course, cardWaves);
  const timed = states.map((state) => timedOf(p, state, course));
  const ranked = rankByConfrontation(p, timed.filter((item) => item.state.outcome !== 'dnf' && item.last >= 0), covered);
  const tie = byWaveThenSchedule(p);
  const unranked = timed.filter((item) => item.state.outcome !== 'dnf' && item.last < 0).sort(tie);
  const dnfs = timed.filter((item) => item.state.outcome === 'dnf').sort(tie);
  const leader = ranked[0] ?? null;

  const rows = [...ranked, ...unranked, ...dnfs].map((item, index) => {
    const isRanked = index < ranked.length;
    return makeRow(p, item, course, {
      position: isRanked ? index + 1 : null,
      isLeader: isRanked && index === 0,
      gap: isRanked && leader ? gapToLeader(item, leader, covered) : null,
      sinceStart: item.state.startIso
    });
  });

  return {
    scope: 'division',
    waveKey: null,
    waveTitle: null,
    startedAt: null,
    divisionKey,
    divisionName: p.divisions.get(divisionKey)?.name ?? '',
    stages: boardStages(course, cardStations),
    rows,
    battle: buildDivisionBattle(rows, new Map(timed.map((item) => [item.state.athlete.key, item])), course),
    finalists: finalistsOf(rows, course),
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
  /** Na ordem em que as categorias devem aparecer: é também a ordem das torres das categorias ao vivo. */
  standings: readonly { divisionKey: string; rows: number }[];
};

/** Próxima onda: a primeira do cronograma ainda sem largada (a regra de `nextRaceWaveId`) que tem atleta. */
export const nextRaceWave = (waves: readonly RaceWaveState[]) => waves.find((wave) => !wave.started && wave.athleteCount > 0) ?? null;

/** Categorias das ondas, sem repetir, na ordem das categorias de `standings` (as que não estão lá, no fim, na ordem das ondas). */
const divisionsOfWaves = (waves: readonly RaceWaveState[], standings: RaceScreenInput['standings']) => {
  const present = new Set(waves.flatMap((wave) => wave.divisionKeys));
  const ordered = standings.map((standing) => standing.divisionKey).filter((key) => present.has(key));
  const rest = [...present].filter((key) => !ordered.includes(key));
  return [...ordered, ...rest];
};

/**
 * Qual tela vai ao ar (AC8 da 1.111; R4 da 1.116). O gatilho é só o que a súmula registrou, nunca o
 * horário do cronograma. Mesa: espera; categoria fixada (a torre da categoria enquanto houver onda
 * dela na pista, senão a classificação dela); onda fixada (grid se não largou, a torre da onda se
 * largou, mesmo terminada); onda fixada que não existe cai no automático. Automático: ao vivo com
 * onda na pista, uma torre por categoria dessas ondas, com todas as ondas largadas (ranking único);
 * senão a classificação (com resultado publicado), alternando com o grid da próxima onda; senão o
 * grid sozinho (antes da primeira onda); senão a espera.
 */
export const resolveRaceScreen = (input: RaceScreenInput): RaceScreenResolution => {
  if (input.mode === 'standby') return { screen: 'standby', reason: 'pinned' };
  const onTrack = input.waves
    .filter((wave) => wave.onTrack)
    .sort((a, b) => ((toMs(a.startedAt) ?? 0) - (toMs(b.startedAt) ?? 0)) || (a.order - b.order));
  if (input.mode === 'pin_standings' && input.pinnedDivisionKey) {
    const divisionKey = input.pinnedDivisionKey;
    const live = onTrack.filter((wave) => wave.divisionKeys.includes(divisionKey));
    if (live.length > 0) return { screen: 'live', reason: 'pinned', scope: 'division', waveKeys: live.map((wave) => wave.key), divisionKeys: [divisionKey] };
    return { screen: 'class', reason: 'pinned', divisionKeys: [divisionKey], gridWaveKey: null };
  }
  if (input.mode === 'pin_heat' && input.pinnedWaveKey) {
    const pinned = input.waves.find((wave) => wave.key === input.pinnedWaveKey);
    if (pinned) {
      return pinned.started
        ? { screen: 'live', reason: 'pinned', scope: 'wave', waveKeys: [pinned.key], divisionKeys: [...pinned.divisionKeys] }
        : { screen: 'grid', reason: 'pinned', waveKey: pinned.key };
    }
  }

  if (onTrack.length > 0) {
    return { screen: 'live', reason: 'auto', scope: 'division', waveKeys: onTrack.map((wave) => wave.key), divisionKeys: divisionsOfWaves(onTrack, input.standings) };
  }

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

/** Passos da torre, na ordem em que as torres vieram: a categoria (torre da categoria) ou onda × categoria (onda fixada). */
export const buildRaceLiveSteps = (boards: readonly Pick<RaceBoard, 'scope' | 'waveKey' | 'divisionKey'>[]): RaceLiveStep[] => (
  boards.map((board) => ({ waveKey: board.scope === 'wave' ? board.waveKey : null, divisionKey: board.divisionKey }))
);

export const racePageCount = (rows: number, pageSize = RACE_PAGE_SIZE) => Math.max(1, Math.ceil(Math.max(0, rows) / Math.max(1, pageSize)));

/** Linhas por página da torre: 15 na torre da categoria (R3), 10 na torre de uma onda. */
export const raceBoardPageSize = (board: Pick<RaceBoard, 'scope'>) => (board.scope === 'division' ? RACE_DIVISION_PAGE_SIZE : RACE_PAGE_SIZE);

/**
 * Quanto cada passo da torre fica no ar: a torre de uma onda, 20 s (D1); a torre da categoria, o tempo
 * de mostrar todas as páginas de 15 linhas a 8 s cada, e pelo menos 20 s (R3).
 */
export const raceLiveStepDurations = (boards: readonly Pick<RaceBoard, 'scope' | 'rows'>[]) => boards.map((board) => (
  board.scope === 'division'
    ? Math.max(RACE_LIVE_STEP_MS, racePageCount(board.rows.length, RACE_DIVISION_PAGE_SIZE) * RACE_TOWER_PAGE_MS)
    : RACE_LIVE_STEP_MS
));

/**
 * Passo no ar quando cada passo tem a sua duração, pela hora do servidor (duas TVs mostram o mesmo):
 * o índice e quantos ms do passo já passaram. Um passo só não rodiza (`offsetMs` = `nowMs`).
 */
export const raceTimedStep = (nowMs: number, durations: readonly number[]): { index: number; offsetMs: number } => {
  const valid = durations.map((value) => (Number.isFinite(value) && value > 0 ? value : RACE_LIVE_STEP_MS));
  if (valid.length <= 1) return { index: 0, offsetMs: Math.max(0, nowMs) };
  const cycle = valid.reduce((sum, value) => sum + value, 0);
  let offset = ((nowMs % cycle) + cycle) % cycle;
  for (let index = 0; index < valid.length; index += 1) {
    if (offset < valid[index]) return { index, offsetMs: offset };
    offset -= valid[index];
  }
  return { index: valid.length - 1, offsetMs: 0 };
};

/**
 * Páginas da torre com mais atletas do que cabem (AC9b; 10 por página na torre de uma onda, 15 na da
 * categoria): o líder e quem está na reta final ficam em toda página e as demais vagas passam por
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
  if (resolution.screen === 'live' && resolution.scope === 'division') {
    for (const divisionKey of resolution.divisionKeys) {
      const board = buildDivisionBoard(p, divisionKey);
      if (board) boards.push(board);
    }
  } else if (resolution.screen === 'live') {
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

// ---------------------------------------------------------------------------
// Entrada no ranking (faixa da direção de prova)
// ---------------------------------------------------------------------------

/**
 * A entrada como ela era no instante `atMs`: leituras, chegadas, DNF, penalidades e resultados até
 * ali. Cartão que ainda não tinha saído volta a "na estação"; corrida que fechou ou virou DNF depois
 * volta a correr. Resultado sem instante só entra para quem não tem corrida (lançamento manual de
 * onda antiga). Serve para saber a posição de alguém quando ele entrou no ranking.
 */
export const sliceRaceInputAt = (input: RaceBroadcastInput, atMs: number): RaceBroadcastInput => {
  const after = (iso: string | null | undefined) => {
    const ms = toMs(iso);
    return ms === null || ms > atMs;
  };
  const withRun = new Set(input.runs.map((run) => run.athleteKey));
  return {
    ...input,
    nowMs: atMs,
    waves: input.waves.map((wave) => (after(wave.startedAt) ? { ...wave, startedAt: null } : wave)),
    runs: input.runs.map((run) => {
      if (run.status === 'finished' && after(run.finishAt)) return { ...run, status: 'racing', officialSeconds: null, timeSource: null, finishAt: null };
      if ((run.status === 'dnf' || run.status === 'disqualified') && after(run.dnfAt)) return { ...run, status: 'racing', dnfAt: null };
      return run;
    }),
    attempts: input.attempts
      .filter((attempt) => !after(attempt.startedAt))
      .map((attempt) => (after(attempt.endedAt) && attempt.endedAt !== null ? { ...attempt, status: 'running', endedAt: null } : attempt)),
    penalties: input.penalties.filter((penalty) => penalty.at === null || !after(penalty.at)),
    results: input.results.filter((result) => (result.at === null ? !withRun.has(result.athleteKey) : !after(result.at)))
  };
};

/**
 * Primeira leitura de cada atleta das categorias pedidas, nas ondas largadas: o instante e o ponto
 * (entrada da primeira estação com judge, em geral). Do mais antigo ao mais novo.
 */
export const raceRankingEntries = (input: RaceBroadcastInput, divisionKeys: readonly string[]): RaceRankingEntry[] => {
  const p = prepare(input);
  const entries: { entry: RaceRankingEntry; ms: number }[] = [];
  for (const divisionKey of divisionKeys) {
    const course = p.courses.get(divisionKey) ?? EMPTY_COURSE;
    for (const member of divisionMembers(p, divisionKey)) {
      const state = buildState(p, member.key, member.scheduleIndex);
      let first: { point: number; ms: number } | null = null;
      for (const [point, ms] of state.pointTimes) if (!first || ms < first.ms || (ms === first.ms && point < first.point)) first = { point, ms };
      const point = first ? pointRefOf(course, first.point) : null;
      if (!first || !point) continue;
      entries.push({ ms: first.ms, entry: { athleteKey: member.key, divisionKey, waveKey: state.wave?.key ?? null, at: new Date(first.ms).toISOString(), point } });
    }
  }
  return entries.sort((a, b) => a.ms - b.ms || a.entry.athleteKey.localeCompare(b.entry.athleteKey)).map((item) => item.entry);
};

/** Posição do atleta na torre da categoria no instante `atMs` (null sem posição ali). */
export const raceDivisionPositionAt = (input: RaceBroadcastInput, divisionKey: string, athleteKey: string, atMs: number): number | null => {
  const board = buildDivisionBoard(prepare(sliceRaceInputAt(input, atMs)), divisionKey);
  return board?.rows.find((row) => row.athleteKey === athleteKey)?.position ?? null;
};

/** A torre da categoria agora, fora da escolha de tela (prévia, testes e conferência visual). */
export const computeRaceDivisionBoard = (input: RaceBroadcastInput, divisionKey: string): RaceBoard | null => buildDivisionBoard(prepare(input), divisionKey);

