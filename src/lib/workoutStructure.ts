// Estrutura da prova e motor de cálculo da súmula digital (Story 1.43, etapa
// E1a; versão 2 do contrato nas Stories 1.47 e 1.48). Módulo puro, sem
// imports: o servidor (persistência), o construtor da súmula e a súmula do
// judge usam as mesmas funções, e o node --test importa este arquivo direto.
// Não importa scoring.ts nem os tipos do app: o formatador de tempo é uma
// cópia de secondsToTime, com a paridade travada por teste
// (tests/workout-structure.test.mjs).
//
// For Time e AMRAP são uma lista explícita de segmentos (o construtor gera a
// lista a partir das linhas de repetições, movimento e carga). Carga máxima é
// uma lista de movimentos com tentativas. O estado da súmula é derivado de um
// log de eventos (rep, fill, set, adj, undo, time e attempt), sem nunca
// apagar nada.
//
// Versões: a 1 (Story 1.43) e a 2 (Stories 1.47 e 1.48) continuam aceitas na
// entrada e são normalizadas para a 3. A 2 acrescentou carga máxima
// (max_load), a unidade de cada segmento (repetições, calorias ou metros), os
// desempates "último marco concluído" e "último round completo" e a forma de
// exibir o score do AMRAP. A 3 (Story 1.60) acrescenta o Intervalado
// (`interval`): rounds de trabalho (ON) e descanso (OFF), de 0 a 9 movimentos
// fixos por round em `segments` e um movimento máximo no campo `interval`; o
// resultado é a soma das repetições do máximo nos rounds que pontuaram. A 4
// (Story 1.66) acrescenta a Distância (`distance`): a prova tem só a duração, o
// judge soma por fora e lança um total em metros (evento `dist`, vale o último
// não desfeito); o resultado é esse total.

// ---------------------------------------------------------------------------
// Contrato
// ---------------------------------------------------------------------------

export const WORKOUT_STRUCTURE_VERSION = 4;

export const WORKOUT_STRUCTURE_LIMITS = {
  minSegments: 1,
  maxSegments: 30,
  minRound: 1,
  maxRound: 9,
  minReps: 1,
  maxReps: 99,
  maxCaloriesPerSegment: 999,
  maxMetersPerSegment: 10000,
  minLoadKg: 0,
  maxLoadKg: 500,
  minTimeCapSeconds: 30,
  maxTimeCapSeconds: 5999,
  minPenaltySecondsPerRep: 0,
  maxPenaltySecondsPerRep: 60,
  maxIdLength: 40,
  maxNameLength: 60,
  maxNoteLength: 300,
  minGeneratorItems: 1,
  maxGeneratorItems: 9,
  minLifts: 1,
  maxLifts: 5,
  minLiftReps: 1,
  maxLiftReps: 10,
  maxLiftAttempts: 3,
  minLoadStepKg: 0.25,
  maxLoadStepKg: 25,
  // Intervalado (Story 1.60). A duração total (rounds × ON + descansos entre
  // rounds) fica até maxTimeCapSeconds (99:59).
  minIntervalRounds: 2,
  maxIntervalRounds: 20,
  minIntervalOnSeconds: 30,
  maxIntervalOnSeconds: 1800,
  minIntervalOffSeconds: 0,
  maxIntervalOffSeconds: 1800,
  maxIntervalFixedSegments: 9,
  /** Teto de segurança das repetições do movimento máximo num round. */
  maxIntervalMaxRepsPerRound: 999,
  /** Distância (Story 1.66): o total lançado pelo judge, em metros inteiros. Fica abaixo do 999999 que a tabela pública usa como "sem resultado". */
  maxDistanceMeters: 99999
} as const;

export type WorkoutStructureFormat = 'for_time' | 'amrap' | 'max_load' | 'interval' | 'distance';
/** Formatos contados por segmentos (toque e segure). */
export type SegmentWorkoutFormat = 'for_time' | 'amrap';
export type WorkoutSegmentMark = 'reps' | 'end';
export type WorkoutSegmentUnit = 'reps' | 'cal' | 'm';

export type WorkoutSegmentLoad = { value: number; unit: 'kg' };

export type WorkoutSegment = {
  id: string;
  round: number;
  name: string;
  /** Quantidade do segmento, na unidade dele (repetições, calorias ou metros). */
  reps: number;
  unit: WorkoutSegmentUnit;
  load: WorkoutSegmentLoad | null;
  note: string;
  required: boolean;
  mark: WorkoutSegmentMark;
};

export type WorkoutIncompleteRule = { rule: 'penalty_per_rep'; secondsPerRep: number; base: 'time_cap' };

/**
 * Desempate, sempre "menor vence":
 * - `split_time`: instante em que um segmento foi concluído (no AMRAP, no 1º round);
 * - `last_split`: instante do último marco concluído entre vários (For Time);
 * - `last_round`: instante em que o último round completo fechou (AMRAP);
 * - `finish_time`: instante da última tentativa (carga máxima);
 * - `fewest_attempts`: menos tentativas usadas (carga máxima).
 */
export type WorkoutTieBreak =
  | { kind: 'split_time'; at: string; order: 'asc' }
  | { kind: 'last_split'; at: string[]; order: 'asc' }
  | { kind: 'last_round'; order: 'asc' }
  | { kind: 'finish_time'; order: 'asc' }
  | { kind: 'fewest_attempts'; order: 'asc' };
export type WorkoutTieBreakKind = WorkoutTieBreak['kind'];

export type WorkoutGeneratorKind = 'fixed' | 'descending' | 'ascending';
export type WorkoutGenerator = { kind: WorkoutGeneratorKind; reps: number[] };
export type WorkoutEntry = {
  mode: 'manual' | 'sheet' | 'both';
  marking: 'reps' | 'segments';
  publish: 'after_review' | 'auto';
};

export type WorkoutLift = {
  id: string;
  name: string;
  /** Repetições por tentativa: 1 = 1RM, 3 = 3RM. */
  reps: number;
  /** Tentativas permitidas; null = ilimitadas (dentro da janela, se houver). */
  maxAttempts: number | null;
  /** Carga da primeira tentativa; null = livre. */
  startLoadKg: number | null;
  note: string;
};

export type WorkoutMaxLoad = {
  lifts: WorkoutLift[];
  /** `fixed`: na ordem da lista, sem voltar a um movimento; `free`: qualquer ordem. */
  order: 'fixed' | 'free';
  /** `sum`: soma da maior carga válida de cada movimento; `best`: a maior carga válida. */
  scoring: 'sum' | 'best';
  /** Passo do ajuste de carga na súmula do judge. */
  loadStepKg: number;
};

export type AmrapScoreDisplay = 'rounds_reps' | 'total';

/** Movimento máximo do intervalado: sem meta, contado em repetições até o fim da janela. */
export type WorkoutIntervalMax = {
  id: string;
  name: string;
  load: WorkoutSegmentLoad | null;
  note: string;
};

export type WorkoutInterval = {
  rounds: number;
  /** Janela de trabalho de cada round, em segundos. */
  onSeconds: number;
  /** Descanso entre rounds, em segundos (0 = sem descanso; não há descanso depois do último). */
  offSeconds: number;
  max: WorkoutIntervalMax;
};

/** Distância (Story 1.66): a única unidade desta versão é o metro; o resumo é um texto livre opcional para o judge. */
export type WorkoutDistance = {
  unit: 'm';
  note: string;
};

export type WorkoutStructure = {
  version: 4;
  format: WorkoutStructureFormat;
  /** Soma das quantidades dos segmentos (no AMRAP e no intervalado, as de um round; em carga máxima, 0). */
  totalReps: number;
  /** Time cap, duração do AMRAP ou do intervalado, ou janela da carga máxima; null só em carga máxima sem janela. */
  timeCapSeconds: number | null;
  incomplete: WorkoutIncompleteRule | null;
  tieBreak: WorkoutTieBreak | null;
  generator: WorkoutGenerator | null;
  customized: boolean;
  entry: WorkoutEntry;
  /** For Time e AMRAP; no intervalado, os movimentos fixos de um round (de 0 a 9); vazia em carga máxima. */
  segments: WorkoutSegment[];
  /** Só em carga máxima. */
  maxLoad: WorkoutMaxLoad | null;
  /** Só no AMRAP: como a súmula mostra o score (o valor guardado é sempre o total). */
  scoreDisplay: AmrapScoreDisplay | null;
  /** Só no intervalado. */
  interval: WorkoutInterval | null;
  /** Só na distância. */
  distance: WorkoutDistance | null;
};

export type WorkoutStructureValidation =
  | { ok: true; structure: WorkoutStructure }
  | { ok: false; error: string };

/** Campos legados da linha de `workouts` derivados da estrutura (camelCase). */
export type LegacyWorkoutFields = { type: 'fortime' | 'amrap' | 'maxweight' | 'reps' | 'distance'; timeCap: string; tieBreaker: '' | 'Tempo' };

export type SheetTimeTarget = 'final' | 'tiebreak';

/**
 * Evento do log da súmula. `seg` é o id do segmento e `lift` o do movimento de
 * carga; `at` são segundos do relógio da prova (o motor aplica Math.floor);
 * `undo.of` é a posição de um evento anterior no array. O `time` é o ajuste
 * manual com o cronômetro oficial (REQ-9), sem justificativa; `attempt` é uma
 * tentativa de carga máxima (carga em kg, válida ou não). No intervalado,
 * `set` e `adj` levam `rd`, o round corrigido (a correção é feita com o
 * relógio parado, então o `at` não diz o round). Na distância, `dist` é o total
 * acumulado em metros lançado pelo judge (vale o último não desfeito). Campos
 * extras são ignorados.
 */
export type SheetEvent =
  | { t: 'rep'; seg: string; at: number }
  | { t: 'fill'; seg: string; n: number; at: number }
  | { t: 'set'; seg: string; v: number; at: number; rd?: number }
  | { t: 'adj'; seg: string; d: number; at: number; rd?: number }
  | { t: 'undo'; of: number; at: number }
  | { t: 'time'; target: SheetTimeTarget; v: number; at: number }
  | { t: 'attempt'; lift: string; load: number; ok: boolean; at: number }
  | { t: 'dist'; v: number; at: number };

export type SheetSegmentState = {
  id: string;
  /** Meta do segmento, na unidade dele. */
  target: number;
  /** Quantidade feita (no AMRAP, a do round em andamento). */
  done: number;
  /** Instante capturado pela súmula em que o segmento foi concluído (no AMRAP, só o do primeiro round). */
  completedAt: number | null;
};

export type SheetState = {
  format: SegmentWorkoutFormat;
  segments: SheetSegmentState[];
  /** Total previsto (no AMRAP, o de um round). */
  repsTarget: number;
  /** Total feito (no AMRAP, rounds completos × total do round + parcial). */
  repsDone: number;
  /** Restantes (no AMRAP, as que faltam para fechar o round em andamento). */
  repsRemaining: number;
  roundsCompleted: number;
  currentSegmentId: string | null;
  /** Tempo final efetivo (For Time concluído): o oficial, se ajustado; senão o capturado. */
  completedAt: number | null;
  capturedCompletedAt: number | null;
  finalAdjusted: boolean;
  finalDeltaSeconds: number | null;
  /** Tempo do desempate efetivo: o oficial, se ajustado; senão o capturado. */
  tieBreakAt: number | null;
  tieBreakCapturedAt: number | null;
  tieBreakAdjusted: boolean;
  tieBreakDeltaSeconds: number | null;
  /** Segmento cujo tempo vale como desempate agora (marco fixo ou último marco concluído). */
  tieBreakSegmentId: string | null;
  /** Desempate efetivo maior que o fim da prova (sinal para a publicação bloquear). */
  tieBreakAfterEnd: boolean;
};

type SheetTieBreakResult = {
  tieBreakSeconds: number | null;
  tieBreakDisplay: string | null;
  tieBreakCapturedSeconds: number | null;
  tieBreakAdjusted: boolean;
  tieBreakDeltaSeconds: number | null;
  tieBreakAfterEnd: boolean;
};

export type ForTimeSheetResult = SheetTieBreakResult & {
  format: 'for_time';
  completed: boolean;
  actualSeconds: number;
  adjustedSeconds: number;
  value: number;
  display: string | null;
  repsDone: number;
  repsRemaining: number;
  penaltySeconds: number;
  capturedSeconds: number | null;
  finalAdjusted: boolean;
  finalDeltaSeconds: number | null;
};

export type AmrapSheetResult = SheetTieBreakResult & {
  format: 'amrap';
  rounds: number;
  extraReps: number;
  totalReps: number;
  value: number;
  display: string;
};

export type SheetResult = ForTimeSheetResult | AmrapSheetResult;

export type OfficialTimeCheck = { ok: true } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Formatador de tempo (cópia de secondsToTime em scoring.ts; paridade por teste)
// ---------------------------------------------------------------------------

/** Segundos em "MM:SS" (ou "H:MM:SS" a partir de uma hora), como secondsToTime. */
export const formatWorkoutTime = (seconds: number) => {
  const rounded = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainingSeconds = rounded % 60;
  const paddedMinutes = String(minutes).padStart(2, '0');
  const paddedSeconds = String(remainingSeconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${paddedMinutes}:${paddedSeconds}` : `${paddedMinutes}:${paddedSeconds}`;
};

/** Palavras de cada unidade (singular, plural e abreviada), para os textos da súmula e do construtor. */
export const UNIT_WORDS: Record<WorkoutSegmentUnit, { one: string; many: string; short: string }> = {
  reps: { one: 'repetição', many: 'repetições', short: 'reps' },
  cal: { one: 'caloria', many: 'calorias', short: 'cal' },
  m: { one: 'metro', many: 'metros', short: 'm' }
};

/** "repetições", "calorias" ou "metros" quando a prova usa uma só unidade; senão "unidades de trabalho". */
export const workUnitWord = (units: readonly WorkoutSegmentUnit[], count: number) => {
  const distinct = [...new Set(units)];
  if (distinct.length === 1) return count === 1 ? UNIT_WORDS[distinct[0]].one : UNIT_WORDS[distinct[0]].many;
  if (distinct.length === 0) return count === 1 ? UNIT_WORDS.reps.one : UNIT_WORDS.reps.many;
  return count === 1 ? 'unidade de trabalho' : 'unidades de trabalho';
};

/** Maior quantidade de um segmento na unidade dele. */
export const maxSegmentAmount = (unit: WorkoutSegmentUnit) => (
  unit === 'm' ? WORKOUT_STRUCTURE_LIMITS.maxMetersPerSegment
    : unit === 'cal' ? WORKOUT_STRUCTURE_LIMITS.maxCaloriesPerSegment
      : WORKOUT_STRUCTURE_LIMITS.maxReps
);

// ---------------------------------------------------------------------------
// Validação (servidor e construtor)
// ---------------------------------------------------------------------------

type PlainObject = Record<string, unknown>;

const STRUCTURE_KEYS_V1 = [
  'version', 'format', 'totalReps', 'timeCapSeconds', 'incomplete', 'tieBreak',
  'generator', 'customized', 'entry', 'segments'
] as const;
const STRUCTURE_KEYS_V2 = [...STRUCTURE_KEYS_V1, 'maxLoad', 'scoreDisplay'] as const;
const STRUCTURE_KEYS_V3 = [...STRUCTURE_KEYS_V2, 'interval'] as const;
const STRUCTURE_KEYS_V4 = [...STRUCTURE_KEYS_V3, 'distance'] as const;
const DISTANCE_KEYS = ['unit', 'note'] as const;
const INTERVAL_KEYS = ['rounds', 'onSeconds', 'offSeconds', 'max'] as const;
const INTERVAL_MAX_KEYS = ['id', 'name', 'load', 'note'] as const;
const SEGMENT_KEYS_V1 = ['id', 'round', 'name', 'reps', 'load', 'note', 'required', 'mark'] as const;
const SEGMENT_KEYS_V2 = [...SEGMENT_KEYS_V1, 'unit'] as const;
const LOAD_KEYS = ['value', 'unit'] as const;
const INCOMPLETE_KEYS = ['rule', 'secondsPerRep', 'base'] as const;
const SPLIT_TIE_BREAK_KEYS = ['kind', 'at', 'order'] as const;
const PLAIN_TIE_BREAK_KEYS = ['kind', 'order'] as const;
const GENERATOR_KEYS = ['kind', 'reps'] as const;
const ENTRY_KEYS = ['mode', 'marking', 'publish'] as const;
const MAX_LOAD_KEYS = ['lifts', 'order', 'scoring', 'loadStepKg'] as const;
const LIFT_KEYS = ['id', 'name', 'reps', 'maxAttempts', 'startLoadKg', 'note'] as const;

const FORMATS: readonly string[] = ['for_time', 'amrap', 'max_load', 'interval', 'distance'];
const MARKS: readonly string[] = ['reps', 'end'];
const UNITS: readonly string[] = ['reps', 'cal', 'm'];
const GENERATOR_KINDS: readonly string[] = ['fixed', 'descending', 'ascending'];
const ENTRY_MODES: readonly string[] = ['manual', 'sheet', 'both'];
const ENTRY_MARKINGS: readonly string[] = ['reps', 'segments'];
const ENTRY_PUBLISH: readonly string[] = ['after_review', 'auto'];
const SCORE_DISPLAYS: readonly string[] = ['rounds_reps', 'total'];
const LIFT_ORDERS: readonly string[] = ['fixed', 'free'];
const LIFT_SCORINGS: readonly string[] = ['sum', 'best'];

const SEGMENT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
// O JSONB do Postgres recusa U+0000: sem esta checagem a gravação viraria 500.
const NULL_CHARACTER = '\u0000';

const L = WORKOUT_STRUCTURE_LIMITS;

const MESSAGES = {
  notObject: 'A estrutura da prova deve ser um objeto.',
  unknownKey: 'A estrutura da prova tem um campo que não faz parte do contrato.',
  version: 'A versão da estrutura da prova deve ser 1, 2, 3 ou 4.',
  format: 'O formato da prova deve ser for_time (For Time), amrap (AMRAP), max_load (Carga máxima), interval (Intervalado) ou distance (Distância).',
  formatV1: 'A versão 1 da estrutura só aceita for_time (For Time) ou amrap (AMRAP); carga máxima exige a versão 2.',
  intervalVersion: 'O formato intervalado (interval) e o campo interval exigem a versão 3 da estrutura.',
  intervalShape: 'No intervalado, informe o campo interval com os rounds (rounds), o tempo de trabalho (onSeconds), o tempo de descanso (offSeconds) e o movimento máximo (max).',
  intervalUnknownKey: 'O campo interval tem um campo que não faz parte do contrato.',
  intervalRounds: `No intervalado, os rounds devem ser um número inteiro entre ${L.minIntervalRounds} e ${L.maxIntervalRounds}.`,
  intervalOn: `No intervalado, o tempo de trabalho (onSeconds) deve ser um número inteiro de segundos entre ${L.minIntervalOnSeconds} e ${L.maxIntervalOnSeconds} (de 00:30 a 30:00).`,
  intervalOff: `No intervalado, o tempo de descanso (offSeconds) deve ser um número inteiro de segundos entre ${L.minIntervalOffSeconds} e ${L.maxIntervalOffSeconds} (de 00:00 a 30:00).`,
  intervalDuration: `No intervalado, a duração total (rounds × trabalho + descansos entre os rounds) deve ser de até ${L.maxTimeCapSeconds} segundos (99:59).`,
  intervalOnlyThere: 'O campo interval só existe em provas intervaladas: fora delas fica vazio (null).',
  distanceVersion: 'O formato distância (distance) e o campo distance exigem a versão 4 da estrutura.',
  distanceShape: 'Na distância, informe o campo distance com a unidade (unit, m de metros) e o resumo da prova (note, pode ficar vazio).',
  distanceUnknownKey: 'O campo distance tem um campo que não faz parte do contrato.',
  distanceUnit: 'Na distância, a unidade (unit) deve ser m (metros).',
  distanceNote: `Na distância, o resumo da prova (note) deve ser um texto de até ${L.maxNoteLength} caracteres (pode ficar vazio).`,
  distanceOnlyThere: 'O campo distance só existe em provas de distância: fora delas fica vazio (null).',
  distanceSegments: 'Na distância a prova não tem movimentos: a lista de segmentos fica vazia.',
  incompleteDistance: 'Na distância, a regra de não conclusão deve ficar vazia (null).',
  tieBreakDistance: 'A distância não tem desempate nesta versão: o campo fica vazio (null).',
  generatorDistance: 'Na distância o gerador deve ficar vazio (null).',
  intervalSegments: `No intervalado, a prova tem de 0 a ${L.maxIntervalFixedSegments} movimentos fixos por round.`,
  incompleteInterval: 'No intervalado, a regra de não conclusão deve ficar vazia (null).',
  tieBreakInterval: 'O intervalado não tem desempate nesta versão: o campo fica vazio (null).',
  generatorInterval: 'No intervalado o gerador deve ficar vazio (null).',
  timeCap: `O time cap da prova deve ser um número inteiro de segundos entre ${L.minTimeCapSeconds} e ${L.maxTimeCapSeconds}.`,
  window: `A janela da prova de carga máxima deve ficar vazia (null) ou ser um número inteiro de segundos entre ${L.minTimeCapSeconds} e ${L.maxTimeCapSeconds}.`,
  segmentsCount: `A prova deve ter entre ${L.minSegments} e ${L.maxSegments} segmentos.`,
  maxLoadSegments: 'Em carga máxima a prova não tem segmentos: a lista de segmentos fica vazia.',
  totalRepsInteger: 'O total de repetições da prova deve ser um número inteiro.',
  incompleteForTime: `Em For Time, a regra de não conclusão deve ser a penalidade por repetição faltante (penalty_per_rep), de ${L.minPenaltySecondsPerRep} a ${L.maxPenaltySecondsPerRep} segundos inteiros por repetição, somada ao time cap (time_cap).`,
  incompleteAmrap: 'Em AMRAP, a regra de não conclusão deve ficar vazia (null).',
  incompleteMaxLoad: 'Em carga máxima, a regra de não conclusão deve ficar vazia (null).',
  tieBreakShape: 'O desempate deve ser vazio (null) ou o tempo de um segmento (split_time), em ordem crescente (asc).',
  tieBreakForTime: 'O desempate de For Time deve ser vazio (null), o tempo de um segmento (split_time) ou o tempo do último marco concluído (last_split), em ordem crescente (asc).',
  tieBreakAmrap: 'O desempate de AMRAP deve ser vazio (null), o tempo de um segmento do 1º round (split_time) ou o tempo do último round completo (last_round), em ordem crescente (asc).',
  tieBreakMaxLoad: 'O desempate de carga máxima deve ser vazio (null), o tempo da última tentativa (finish_time) ou o menor número de tentativas (fewest_attempts), em ordem crescente (asc).',
  tieBreakTarget: 'O desempate aponta para um segmento que não existe na prova.',
  tieBreakMarks: `O desempate pelo último marco precisa de 1 a ${L.maxSegments} marcos diferentes, cada um apontando para um segmento da prova.`,
  generator: `O gerador deve ser vazio (null) ou ter tipo fixed, descending ou ascending e de ${L.minGeneratorItems} a ${L.maxGeneratorItems} repetições inteiras entre ${L.minReps} e ${L.maxReps}.`,
  generatorMaxLoad: 'Em carga máxima o gerador deve ficar vazio (null).',
  customized: 'O campo customized deve ser verdadeiro ou falso.',
  customizedCoherence: 'Estrutura personalizada (customized verdadeiro) não tem gerador, e estrutura gerada (customized falso) precisa do gerador.',
  entry: 'A forma de lançamento deve ter modo manual, sheet ou both, marcação reps ou segments e publicação after_review ou auto.',
  maxLoadShape: `Em carga máxima, informe de ${L.minLifts} a ${L.maxLifts} movimentos, a ordem (fixed ou free), o score (sum ou best) e o incremento de carga entre ${L.minLoadStepKg} e ${L.maxLoadStepKg} kg.`,
  maxLoadOnlyThere: 'Os movimentos de carga só existem em provas de carga máxima: fora delas o campo fica vazio (null).',
  scoreDisplay: 'No AMRAP, o score aparece como rounds + repetições (rounds_reps) ou total (total); nos outros formatos o campo fica vazio (null).',
  nullCharacter: 'Os textos da estrutura da prova não podem conter o caractere nulo (U+0000).',
  unexpected: 'A estrutura da prova é inválida.'
} as const;

const segmentMessage = (position: number, text: string) => `Segmento ${position}: ${text}`;
const liftMessage = (position: number, text: string) => `Movimento de carga ${position}: ${text}`;

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

const isPlainObject = (value: unknown): value is PlainObject => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

// Inclui chaves como "__proto__" vindas do JSON.parse, que viram propriedade própria.
const hasOnlyKeys = (value: PlainObject, allowed: readonly string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));

const isIntegerBetween = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

const isFiniteBetween = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

const hasNullCharacter = (value: unknown) => typeof value === 'string' && value.includes(NULL_CHARACTER);

const isOneOf = (value: unknown, allowed: readonly string[]): value is string =>
  typeof value === 'string' && allowed.includes(value);

const AMOUNT_MESSAGES: Record<WorkoutSegmentUnit, string> = {
  reps: `as repetições devem ser um número inteiro entre ${L.minReps} e ${L.maxReps}.`,
  cal: `as calorias devem ser um número inteiro entre ${L.minReps} e ${L.maxCaloriesPerSegment}.`,
  m: `os metros devem ser um número inteiro entre ${L.minReps} e ${L.maxMetersPerSegment}.`
};

type SegmentCheck = { ok: true; segment: WorkoutSegment } | { ok: false; error: string };

const validateSegment = (input: unknown, position: number, legacy: boolean): SegmentCheck => {
  const say = (text: string) => fail(segmentMessage(position, text));
  if (!isPlainObject(input)) return say('o segmento deve ser um objeto.');
  if (!hasOnlyKeys(input, legacy ? SEGMENT_KEYS_V1 : SEGMENT_KEYS_V2)) return say('o segmento tem um campo que não faz parte do contrato.');

  for (const key of ['id', 'name', 'note'] as const) {
    if (hasNullCharacter(input[key])) return say('o texto não pode conter o caractere nulo (U+0000).');
  }

  const id = typeof input.id === 'string' ? input.id.trim() : '';
  if (!id || id.length > L.maxIdLength || !SEGMENT_ID_PATTERN.test(id)) {
    return say(`o identificador deve ter de 1 a ${L.maxIdLength} caracteres, só letras sem acento, números, _ e -.`);
  }
  if (!isIntegerBetween(input.round, L.minRound, L.maxRound)) {
    return say(`a rodada deve ser um número inteiro entre ${L.minRound} e ${L.maxRound}.`);
  }
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > L.maxNameLength) {
    return say(`informe o nome do movimento, com até ${L.maxNameLength} caracteres.`);
  }
  // A versão 1 só conhecia repetições.
  if (!legacy && !isOneOf(input.unit, UNITS)) return say('a unidade (unit) deve ser reps, cal ou m.');
  const unit = (legacy ? 'reps' : input.unit) as WorkoutSegmentUnit;
  if (!isIntegerBetween(input.reps, L.minReps, maxSegmentAmount(unit))) return say(AMOUNT_MESSAGES[unit]);

  let load: WorkoutSegmentLoad | null = null;
  if (input.load !== null) {
    const raw = input.load;
    const valid = isPlainObject(raw)
      && hasOnlyKeys(raw, LOAD_KEYS)
      && raw.unit === 'kg'
      && isFiniteBetween(raw.value, L.minLoadKg, L.maxLoadKg);
    if (!valid) return say(`a carga deve ser vazia (null) ou um valor entre ${L.minLoadKg} e ${L.maxLoadKg} kg.`);
    load = { value: raw.value as number, unit: 'kg' };
  }

  if (typeof input.note !== 'string' || input.note.trim().length > L.maxNoteLength) {
    return say(`a observação deve ser um texto de até ${L.maxNoteLength} caracteres (pode ficar vazia).`);
  }
  if (typeof input.required !== 'boolean') return say('o campo required deve ser verdadeiro ou falso.');
  if (!isOneOf(input.mark, MARKS)) return say('a marcação (mark) deve ser reps ou end.');
  // Ninguém conta metro a metro: em metros o judge só conclui o bloco (segurar).
  if (unit === 'm' && input.mark !== 'end') return say('em metros, o judge só conclui o bloco: a marcação (mark) deve ser end.');

  return {
    ok: true,
    segment: {
      id,
      round: input.round,
      name,
      reps: input.reps,
      unit,
      load,
      note: input.note.trim(),
      required: input.required,
      mark: input.mark as WorkoutSegmentMark
    }
  };
};

type LiftCheck = { ok: true; lift: WorkoutLift } | { ok: false; error: string };

const validateLift = (input: unknown, position: number): LiftCheck => {
  const say = (text: string) => fail(liftMessage(position, text));
  if (!isPlainObject(input)) return say('o movimento deve ser um objeto.');
  if (!hasOnlyKeys(input, LIFT_KEYS)) return say('o movimento tem um campo que não faz parte do contrato.');
  for (const key of ['id', 'name', 'note'] as const) {
    if (hasNullCharacter(input[key])) return say('o texto não pode conter o caractere nulo (U+0000).');
  }
  const id = typeof input.id === 'string' ? input.id.trim() : '';
  if (!id || id.length > L.maxIdLength || !SEGMENT_ID_PATTERN.test(id)) {
    return say(`o identificador deve ter de 1 a ${L.maxIdLength} caracteres, só letras sem acento, números, _ e -.`);
  }
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > L.maxNameLength) return say(`informe o nome do movimento, com até ${L.maxNameLength} caracteres.`);
  if (!isIntegerBetween(input.reps, L.minLiftReps, L.maxLiftReps)) {
    return say(`as repetições por tentativa devem ser um número inteiro entre ${L.minLiftReps} e ${L.maxLiftReps}.`);
  }
  if (input.maxAttempts !== null && !isIntegerBetween(input.maxAttempts, 1, L.maxLiftAttempts)) {
    return say(`as tentativas devem ser de 1 a ${L.maxLiftAttempts} ou ilimitadas (null).`);
  }
  if (input.startLoadKg !== null && !isFiniteBetween(input.startLoadKg, L.minLoadKg, L.maxLoadKg)) {
    return say(`a carga inicial deve ficar vazia (null) ou entre ${L.minLoadKg} e ${L.maxLoadKg} kg.`);
  }
  if (typeof input.note !== 'string' || input.note.trim().length > L.maxNoteLength) {
    return say(`a observação deve ser um texto de até ${L.maxNoteLength} caracteres (pode ficar vazia).`);
  }
  return {
    ok: true,
    lift: {
      id,
      name,
      reps: input.reps,
      maxAttempts: input.maxAttempts as number | null,
      startLoadKg: input.startLoadKg as number | null,
      note: input.note.trim()
    }
  };
};

type MaxLoadCheck = { ok: true; maxLoad: WorkoutMaxLoad } | { ok: false; error: string };

const validateMaxLoad = (input: unknown): MaxLoadCheck => {
  if (!isPlainObject(input) || !hasOnlyKeys(input, MAX_LOAD_KEYS)) return fail(MESSAGES.maxLoadShape);
  const rawLifts = input.lifts;
  if (!Array.isArray(rawLifts) || rawLifts.length < L.minLifts || rawLifts.length > L.maxLifts) return fail(MESSAGES.maxLoadShape);
  const lifts: WorkoutLift[] = [];
  const ids = new Set<string>();
  for (const [index, rawLift] of rawLifts.entries()) {
    const checked = validateLift(rawLift, index + 1);
    if (!checked.ok) return checked;
    if (ids.has(checked.lift.id)) return fail(liftMessage(index + 1, 'o identificador repete o de outro movimento.'));
    ids.add(checked.lift.id);
    lifts.push(checked.lift);
  }
  if (!isOneOf(input.order, LIFT_ORDERS) || !isOneOf(input.scoring, LIFT_SCORINGS)
    || !isFiniteBetween(input.loadStepKg, L.minLoadStepKg, L.maxLoadStepKg)) {
    return fail(MESSAGES.maxLoadShape);
  }
  return {
    ok: true,
    maxLoad: {
      lifts,
      order: input.order as WorkoutMaxLoad['order'],
      scoring: input.scoring as WorkoutMaxLoad['scoring'],
      loadStepKg: input.loadStepKg as number
    }
  };
};

const intervalMaxMessage = (text: string) => `Movimento máximo: ${text}`;

type IntervalCheck = { ok: true; interval: WorkoutInterval } | { ok: false; error: string };

/** Duração do intervalado: sem descanso depois do último round. */
const intervalDurationSeconds = (rounds: number, onSeconds: number, offSeconds: number) =>
  rounds * onSeconds + (rounds - 1) * offSeconds;

const validateIntervalMax = (input: unknown): { ok: true; max: WorkoutIntervalMax } | { ok: false; error: string } => {
  const say = (text: string) => fail(intervalMaxMessage(text));
  if (!isPlainObject(input)) return say('o movimento máximo deve ser um objeto.');
  if (!hasOnlyKeys(input, INTERVAL_MAX_KEYS)) return say('o movimento tem um campo que não faz parte do contrato.');
  for (const key of ['id', 'name', 'note'] as const) {
    if (hasNullCharacter(input[key])) return say('o texto não pode conter o caractere nulo (U+0000).');
  }
  const id = typeof input.id === 'string' ? input.id.trim() : '';
  if (!id || id.length > L.maxIdLength || !SEGMENT_ID_PATTERN.test(id)) {
    return say(`o identificador deve ter de 1 a ${L.maxIdLength} caracteres, só letras sem acento, números, _ e -.`);
  }
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > L.maxNameLength) return say(`informe o nome do movimento, com até ${L.maxNameLength} caracteres.`);
  let load: WorkoutSegmentLoad | null = null;
  if (input.load !== null) {
    const raw = input.load;
    const valid = isPlainObject(raw)
      && hasOnlyKeys(raw, LOAD_KEYS)
      && raw.unit === 'kg'
      && isFiniteBetween(raw.value, L.minLoadKg, L.maxLoadKg);
    if (!valid) return say(`a carga deve ser vazia (null) ou um valor entre ${L.minLoadKg} e ${L.maxLoadKg} kg.`);
    load = { value: raw.value as number, unit: 'kg' };
  }
  if (typeof input.note !== 'string' || input.note.trim().length > L.maxNoteLength) {
    return say(`a observação deve ser um texto de até ${L.maxNoteLength} caracteres (pode ficar vazia).`);
  }
  return { ok: true, max: { id, name, load, note: input.note.trim() } };
};

const validateInterval = (input: unknown): IntervalCheck => {
  if (!isPlainObject(input)) return fail(MESSAGES.intervalShape);
  if (!hasOnlyKeys(input, INTERVAL_KEYS)) return fail(MESSAGES.intervalUnknownKey);
  if (!isIntegerBetween(input.rounds, L.minIntervalRounds, L.maxIntervalRounds)) return fail(MESSAGES.intervalRounds);
  if (!isIntegerBetween(input.onSeconds, L.minIntervalOnSeconds, L.maxIntervalOnSeconds)) return fail(MESSAGES.intervalOn);
  if (!isIntegerBetween(input.offSeconds, L.minIntervalOffSeconds, L.maxIntervalOffSeconds)) return fail(MESSAGES.intervalOff);
  if (intervalDurationSeconds(input.rounds, input.onSeconds, input.offSeconds) > L.maxTimeCapSeconds) return fail(MESSAGES.intervalDuration);
  const max = validateIntervalMax(input.max);
  if (!max.ok) return max;
  return { ok: true, interval: { rounds: input.rounds, onSeconds: input.onSeconds, offSeconds: input.offSeconds, max: max.max } };
};

type DistanceCheck = { ok: true; distance: WorkoutDistance } | { ok: false; error: string };

const validateDistance = (input: unknown): DistanceCheck => {
  if (!isPlainObject(input)) return fail(MESSAGES.distanceShape);
  if (!hasOnlyKeys(input, DISTANCE_KEYS)) return fail(MESSAGES.distanceUnknownKey);
  if (input.unit !== 'm') return fail(MESSAGES.distanceUnit);
  if (hasNullCharacter(input.note)) return fail(MESSAGES.nullCharacter);
  if (typeof input.note !== 'string' || input.note.trim().length > L.maxNoteLength) return fail(MESSAGES.distanceNote);
  return { ok: true, distance: { unit: 'm', note: input.note.trim() } };
};

type TieBreakCheck = { ok: true; tieBreak: WorkoutTieBreak | null } | { ok: false; error: string };

const TIE_BREAK_MESSAGES: Record<WorkoutStructureFormat, string> = {
  for_time: MESSAGES.tieBreakForTime,
  amrap: MESSAGES.tieBreakAmrap,
  max_load: MESSAGES.tieBreakMaxLoad,
  interval: MESSAGES.tieBreakInterval,
  distance: MESSAGES.tieBreakDistance
};
// O intervalado e a distância não têm desempate nesta versão (decisão 7 do Intervalado e decisão 5 da Distância): nenhum tipo é aceito.
const TIE_BREAK_KINDS: Record<WorkoutStructureFormat, readonly string[]> = {
  for_time: ['split_time', 'last_split'],
  amrap: ['split_time', 'last_round'],
  max_load: ['finish_time', 'fewest_attempts'],
  interval: [],
  distance: []
};

const validateTieBreak = (
  raw: unknown,
  format: WorkoutStructureFormat,
  segments: readonly WorkoutSegment[],
  legacy: boolean
): TieBreakCheck => {
  if (raw === null) return { ok: true, tieBreak: null };
  const shapeError = legacy ? MESSAGES.tieBreakShape : TIE_BREAK_MESSAGES[format];
  if (!isPlainObject(raw) || raw.order !== 'asc') return fail(shapeError);
  const allowed = legacy ? ['split_time'] : TIE_BREAK_KINDS[format];
  if (!isOneOf(raw.kind, allowed)) return fail(shapeError);
  const ids = new Set(segments.map((segment) => segment.id));

  if (raw.kind === 'split_time') {
    if (!hasOnlyKeys(raw, SPLIT_TIE_BREAK_KEYS) || typeof raw.at !== 'string') return fail(shapeError);
    if (hasNullCharacter(raw.at)) return fail(MESSAGES.nullCharacter);
    const at = raw.at.trim();
    if (!ids.has(at)) return fail(MESSAGES.tieBreakTarget);
    return { ok: true, tieBreak: { kind: 'split_time', at, order: 'asc' } };
  }

  if (raw.kind === 'last_split') {
    if (!hasOnlyKeys(raw, SPLIT_TIE_BREAK_KEYS) || !Array.isArray(raw.at)) return fail(shapeError);
    const list: unknown[] = raw.at;
    if (list.some(hasNullCharacter)) return fail(MESSAGES.nullCharacter);
    const marks = list.map((value) => (typeof value === 'string' ? value.trim() : ''));
    if (marks.length < 1 || marks.length > L.maxSegments || new Set(marks).size !== marks.length) return fail(MESSAGES.tieBreakMarks);
    if (marks.some((mark) => !ids.has(mark))) return fail(MESSAGES.tieBreakTarget);
    // Guardados na ordem da prova: o último marco concluído é o de maior posição.
    const ordered = segments.map((segment) => segment.id).filter((id) => marks.includes(id));
    return { ok: true, tieBreak: { kind: 'last_split', at: ordered, order: 'asc' } };
  }

  if (!hasOnlyKeys(raw, PLAIN_TIE_BREAK_KEYS)) return fail(shapeError);
  return { ok: true, tieBreak: { kind: raw.kind as 'last_round' | 'finish_time' | 'fewest_attempts', order: 'asc' } };
};

const validateStructureObject = (input: unknown): WorkoutStructureValidation => {
  if (!isPlainObject(input)) return fail(MESSAGES.notObject);
  if (!hasOnlyKeys(input, STRUCTURE_KEYS_V4)) return fail(MESSAGES.unknownKey);
  if (input.version !== 1 && input.version !== 2 && input.version !== 3 && input.version !== 4) return fail(MESSAGES.version);
  const version: 1 | 2 | 3 | 4 = input.version;
  const legacy = version === 1;
  // A versão 1 e a 2 não conhecem o intervalado, nem no formato nem na chave.
  if (version < 3 && (Object.prototype.hasOwnProperty.call(input, 'interval') || input.format === 'interval')) {
    return fail(MESSAGES.intervalVersion);
  }
  // A versão 1, a 2 e a 3 não conhecem a distância, nem no formato nem na chave.
  if (version < 4 && (Object.prototype.hasOwnProperty.call(input, 'distance') || input.format === 'distance')) {
    return fail(MESSAGES.distanceVersion);
  }
  if (legacy && !hasOnlyKeys(input, STRUCTURE_KEYS_V1)) return fail(MESSAGES.unknownKey);
  if (!isOneOf(input.format, FORMATS)) return fail(MESSAGES.format);
  const format = input.format as WorkoutStructureFormat;
  if (legacy && format === 'max_load') return fail(MESSAGES.formatV1);
  const isMaxLoad = format === 'max_load';
  const isInterval = format === 'interval';
  const isDistance = format === 'distance';

  let interval: WorkoutInterval | null = null;
  if (isInterval) {
    const checked = validateInterval(input.interval);
    if (!checked.ok) return checked;
    interval = checked.interval;
  } else if (version >= 3 && input.interval !== null) {
    return fail(MESSAGES.intervalOnlyThere);
  }

  let distance: WorkoutDistance | null = null;
  if (isDistance) {
    const checked = validateDistance(input.distance);
    if (!checked.ok) return checked;
    distance = checked.distance;
  } else if (version === 4 && input.distance !== null) {
    return fail(MESSAGES.distanceOnlyThere);
  }

  let timeCapSeconds: number | null = null;
  if (isMaxLoad) {
    if (input.timeCapSeconds !== null && !isIntegerBetween(input.timeCapSeconds, L.minTimeCapSeconds, L.maxTimeCapSeconds)) {
      return fail(MESSAGES.window);
    }
    timeCapSeconds = input.timeCapSeconds as number | null;
  } else if (interval) {
    // A duração é derivada dos rounds e precisa bater com o time cap gravado.
    const expected = intervalDurationSeconds(interval.rounds, interval.onSeconds, interval.offSeconds);
    if (input.timeCapSeconds !== expected) {
      return fail(`No intervalado, o time cap deve ser igual à duração da prova (${formatWorkoutTime(expected)}): rounds × trabalho + (rounds − 1) × descanso, sem descanso depois do último round.`);
    }
    timeCapSeconds = expected;
  } else {
    if (!isIntegerBetween(input.timeCapSeconds, L.minTimeCapSeconds, L.maxTimeCapSeconds)) return fail(MESSAGES.timeCap);
    timeCapSeconds = input.timeCapSeconds;
  }

  const rawSegments = input.segments;
  const segments: WorkoutSegment[] = [];
  if (isMaxLoad) {
    if (!Array.isArray(rawSegments) || rawSegments.length !== 0) return fail(MESSAGES.maxLoadSegments);
  } else if (isDistance) {
    if (!Array.isArray(rawSegments) || rawSegments.length !== 0) return fail(MESSAGES.distanceSegments);
  } else {
    const [minSegments, maxSegments] = isInterval ? [0, L.maxIntervalFixedSegments] : [L.minSegments, L.maxSegments];
    if (!Array.isArray(rawSegments) || rawSegments.length < minSegments || rawSegments.length > maxSegments) {
      return fail(isInterval ? MESSAGES.intervalSegments : MESSAGES.segmentsCount);
    }
    const ids = new Set<string>();
    for (const [index, rawSegment] of rawSegments.entries()) {
      const checked = validateSegment(rawSegment, index + 1, legacy);
      if (!checked.ok) return checked;
      if (ids.has(checked.segment.id)) {
        return fail(segmentMessage(index + 1, 'o identificador repete o de outro segmento.'));
      }
      // No intervalado os fixos descrevem um round só (o mesmo trabalho em todos os rounds).
      if (isInterval && checked.segment.round !== 1) {
        return fail(segmentMessage(index + 1, 'no intervalado os movimentos fixos descrevem um round: a rodada (round) deve ser 1.'));
      }
      ids.add(checked.segment.id);
      segments.push(checked.segment);
    }
    if (interval && ids.has(interval.max.id)) {
      return fail(intervalMaxMessage('o identificador repete o de um movimento fixo.'));
    }
  }

  const repsSum = segments.reduce((sum, segment) => sum + segment.reps, 0);
  if (typeof input.totalReps !== 'number' || !Number.isInteger(input.totalReps)) return fail(MESSAGES.totalRepsInteger);
  if (input.totalReps !== repsSum) {
    return fail(`O total de repetições da prova deve ser igual à soma das repetições dos segmentos (${repsSum}).`);
  }

  let incomplete: WorkoutIncompleteRule | null = null;
  if (format === 'for_time') {
    const raw = input.incomplete;
    const valid = isPlainObject(raw)
      && hasOnlyKeys(raw, INCOMPLETE_KEYS)
      && raw.rule === 'penalty_per_rep'
      && raw.base === 'time_cap'
      && isIntegerBetween(raw.secondsPerRep, L.minPenaltySecondsPerRep, L.maxPenaltySecondsPerRep);
    if (!valid) return fail(MESSAGES.incompleteForTime);
    incomplete = { rule: 'penalty_per_rep', secondsPerRep: raw.secondsPerRep as number, base: 'time_cap' };
  } else if (input.incomplete !== null) {
    return fail(isMaxLoad ? MESSAGES.incompleteMaxLoad : isInterval ? MESSAGES.incompleteInterval : isDistance ? MESSAGES.incompleteDistance : MESSAGES.incompleteAmrap);
  }

  const tieBreakCheck = validateTieBreak(input.tieBreak, format, segments, legacy);
  if (!tieBreakCheck.ok) return tieBreakCheck;

  let generator: WorkoutGenerator | null = null;
  if (input.generator !== null) {
    if (isMaxLoad) return fail(MESSAGES.generatorMaxLoad);
    if (isInterval) return fail(MESSAGES.generatorInterval);
    if (isDistance) return fail(MESSAGES.generatorDistance);
    const raw = input.generator;
    const valid = isPlainObject(raw)
      && hasOnlyKeys(raw, GENERATOR_KEYS)
      && isOneOf(raw.kind, GENERATOR_KINDS)
      && Array.isArray(raw.reps)
      && raw.reps.length >= L.minGeneratorItems
      && raw.reps.length <= L.maxGeneratorItems
      && raw.reps.every((reps: unknown) => isIntegerBetween(reps, L.minReps, L.maxReps));
    if (!valid) return fail(MESSAGES.generator);
    generator = { kind: raw.kind as WorkoutGeneratorKind, reps: [...(raw.reps as number[])] };
  }

  if (typeof input.customized !== 'boolean') return fail(MESSAGES.customized);
  if (input.customized !== (generator === null)) return fail(MESSAGES.customizedCoherence);

  const rawEntry = input.entry;
  if (!isPlainObject(rawEntry) || !hasOnlyKeys(rawEntry, ENTRY_KEYS)
    || !isOneOf(rawEntry.mode, ENTRY_MODES)
    || !isOneOf(rawEntry.marking, ENTRY_MARKINGS)
    || !isOneOf(rawEntry.publish, ENTRY_PUBLISH)) {
    return fail(MESSAGES.entry);
  }

  // Versão 1: sem carga máxima e com o AMRAP mostrado em rounds + repetições.
  let maxLoad: WorkoutMaxLoad | null = null;
  let scoreDisplay: AmrapScoreDisplay | null = format === 'amrap' ? 'rounds_reps' : null;
  if (!legacy) {
    if (isMaxLoad) {
      const checked = validateMaxLoad(input.maxLoad);
      if (!checked.ok) return checked;
      maxLoad = checked.maxLoad;
    } else if (input.maxLoad !== null) {
      return fail(MESSAGES.maxLoadOnlyThere);
    }
    if (format === 'amrap' ? !isOneOf(input.scoreDisplay, SCORE_DISPLAYS) : input.scoreDisplay !== null) {
      return fail(MESSAGES.scoreDisplay);
    }
    scoreDisplay = input.scoreDisplay as AmrapScoreDisplay | null;
  }

  return {
    ok: true,
    structure: {
      version: WORKOUT_STRUCTURE_VERSION,
      format,
      totalReps: repsSum,
      timeCapSeconds,
      incomplete,
      tieBreak: tieBreakCheck.tieBreak,
      generator,
      customized: input.customized,
      entry: {
        mode: rawEntry.mode as WorkoutEntry['mode'],
        marking: rawEntry.marking as WorkoutEntry['marking'],
        publish: rawEntry.publish as WorkoutEntry['publish']
      },
      segments,
      maxLoad,
      scoreDisplay,
      interval,
      distance
    }
  };
};

/**
 * Valida a estrutura recebida (do cliente ou do banco) e devolve um objeto
 * novo e normalizado na versão 4 (textos sem espaços nas pontas, só as chaves
 * do contrato), nunca a referência recebida. A versão 1 é aceita e convertida
 * (segmentos em repetições, sem carga máxima, AMRAP em rounds + repetições), e
 * a 2 e a 3 também; a 1 e a 2 saem com `interval: null` e as três com
 * `distance: null`.
 * Nunca lança: a mensagem diz o campo e o limite, sem devolver o JSON enviado.
 * Não reconcilia: total diferente da soma ou desempate num segmento inexistente
 * são recusados.
 */
export const validateWorkoutStructure = (input: unknown): WorkoutStructureValidation => {
  try {
    return validateStructureObject(input);
  } catch {
    return fail(MESSAGES.unexpected);
  }
};

const copyTieBreak = (tieBreak: WorkoutTieBreak): WorkoutTieBreak => (
  tieBreak.kind === 'last_split' ? { ...tieBreak, at: [...tieBreak.at] } : { ...tieBreak }
);

/**
 * Auxiliar para a estrutura editada: recalcula `totalReps` como a soma dos
 * segmentos e tira do desempate os segmentos removidos (sem nenhum, o
 * desempate zera). Devolve um objeto novo; não valida (quem grava passa por
 * validateWorkoutStructure).
 */
export const reconcileWorkoutStructure = (structure: WorkoutStructure): WorkoutStructure => {
  const segments = structure.segments.map((segment) => ({
    ...segment,
    load: segment.load ? { ...segment.load } : null
  }));
  const ids = new Set(segments.map((segment) => segment.id));
  let tieBreak: WorkoutTieBreak | null = structure.tieBreak ? copyTieBreak(structure.tieBreak) : null;
  if (tieBreak?.kind === 'split_time' && !ids.has(tieBreak.at)) tieBreak = null;
  if (tieBreak?.kind === 'last_split') {
    const marks = tieBreak.at.filter((id) => ids.has(id));
    tieBreak = marks.length > 0 ? { ...tieBreak, at: marks } : null;
  }
  return {
    ...structure,
    incomplete: structure.incomplete ? { ...structure.incomplete } : null,
    tieBreak,
    generator: structure.generator ? { ...structure.generator, reps: [...structure.generator.reps] } : null,
    entry: { ...structure.entry },
    totalReps: segments.reduce((sum, segment) => sum + segment.reps, 0),
    segments,
    maxLoad: structure.maxLoad
      ? { ...structure.maxLoad, lifts: structure.maxLoad.lifts.map((lift) => ({ ...lift })) }
      : null,
    interval: structure.interval
      ? {
        ...structure.interval,
        max: { ...structure.interval.max, load: structure.interval.max.load ? { ...structure.interval.max.load } : null }
      }
      : null,
    distance: structure.distance ? { ...structure.distance } : null
  };
};

const LEGACY_TYPES: Record<WorkoutStructureFormat, LegacyWorkoutFields['type']> = {
  for_time: 'fortime',
  amrap: 'amrap',
  max_load: 'maxweight',
  interval: 'reps',
  distance: 'distance'
};

/**
 * Campos legados da prova (`type`, `time_cap`, `tie_breaker`) derivados da
 * estrutura, no formato que scoring.ts e o painel atual já entendem. Carga
 * máxima sem janela não tem time cap (''). O desempate por menos tentativas
 * não é um tempo, então o legado fica sem desempate (''). O intervalado é
 * `reps` ("maior vence"), com a duração da prova como time cap e sem desempate.
 * A distância é `distance` ("maior vence"), com a duração como time cap e sem
 * desempate.
 */
export const deriveLegacyWorkoutFields = (structure: WorkoutStructure): LegacyWorkoutFields => ({
  type: LEGACY_TYPES[structure.format] ?? 'fortime',
  timeCap: typeof structure.timeCapSeconds === 'number' ? formatWorkoutTime(structure.timeCapSeconds) : '',
  tieBreaker: structure.tieBreak && structure.tieBreak.kind !== 'fewest_attempts' ? 'Tempo' : ''
});

// ---------------------------------------------------------------------------
// Motor da súmula (For Time e AMRAP)
// ---------------------------------------------------------------------------

type CountEventType = 'rep' | 'fill' | 'set' | 'adj';

type UndoEvent = { kind: 'undo'; of: number; at: number };

type ParsedEvent =
  | { kind: 'count'; t: CountEventType; segment: number; amount: number; at: number }
  | UndoEvent
  | { kind: 'time'; target: SheetTimeTarget; value: number; at: number };

const TIME_TARGETS: readonly string[] = ['final', 'tiebreak'];

const readAt = (value: unknown) =>
  (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null);

const readUndo = (event: PlainObject, at: number): UndoEvent | null => (
  Number.isInteger(event.of) ? { kind: 'undo', of: event.of as number, at } : null
);

// Evento malformado é ignorado por inteiro (null): segmento inexistente, tipo
// desconhecido, n/v/d não inteiros, at inválido, time fora de 1..timeCap.
const parseEvent = (raw: unknown, segmentIndexById: Map<string, number>, timeCapSeconds: number): ParsedEvent | null => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const event = raw as PlainObject;
  const at = readAt(event.at);
  if (at === null) return null;

  if (event.t === 'undo') return readUndo(event, at);
  if (event.t === 'time') {
    if (!isOneOf(event.target, TIME_TARGETS) || !isIntegerBetween(event.v, 1, timeCapSeconds)) return null;
    return { kind: 'time', target: event.target as SheetTimeTarget, value: event.v as number, at };
  }

  if (event.t !== 'rep' && event.t !== 'fill' && event.t !== 'set' && event.t !== 'adj') return null;
  const segment = typeof event.seg === 'string' ? segmentIndexById.get(event.seg) : undefined;
  if (segment === undefined) return null;
  if (event.t === 'rep') return { kind: 'count', t: 'rep', segment, amount: 1, at };

  const amount = event.t === 'fill' ? event.n : event.t === 'set' ? event.v : event.d;
  if (!Number.isInteger(amount)) return null;
  return { kind: 'count', t: event.t, segment, amount: amount as number, at };
};

// `undo` anula um evento anterior (posição menor que a dele); undo de undo não
// tem efeito e dois undo do mesmo alvo equivalem a um. Nada é apagado: o
// estado é sempre recalculado do log inteiro sem os eventos anulados.
const collectVoided = (events: readonly ({ kind: string; of?: number } | null)[]) => {
  const voided = new Set<number>();
  events.forEach((event, index) => {
    if (!event || event.kind !== 'undo' || typeof event.of !== 'number') return;
    if (event.of < 0 || event.of >= index) return;
    if (events[event.of]?.kind === 'undo') return;
    voided.add(event.of);
  });
  return voided;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Estado da súmula derivado do log de eventos (REQ-4, REQ-9). Função pura e
 * determinística: aplica os eventos na ordem do array, não muta as entradas e
 * não lança. Cada segmento fica em 0..meta depois de cada evento.
 *
 * For Time: a prova conclui quando todos os segmentos chegam à meta; o tempo
 * capturado é o `at` do evento que concluiu. AMRAP: os segmentos descrevem um
 * round; quando todos chegam à meta o round fecha e a contagem volta a zero (o
 * instante de conclusão de cada segmento vale só para o primeiro round).
 *
 * Desempate: o marco fixo (`split_time`), o último marco concluído
 * (`last_split`) ou o fechamento do último round completo (`last_round`).
 *
 * Ajuste manual (`time`): `final` só vale em For Time concluído no momento do
 * evento; `tiebreak` só com o marco do desempate alcançado. Vale o último
 * válido e não anulado de cada alvo; o ajuste cai se depois a respectiva
 * conclusão for perdida ou se o desempate passar a outro marco. O capturado é
 * sempre preservado ao lado do efetivo.
 */
export const deriveSheetState = (structure: WorkoutStructure, events: readonly unknown[]): SheetState => {
  const isAmrap = structure?.format === 'amrap';
  const format: SegmentWorkoutFormat = isAmrap ? 'amrap' : 'for_time';
  const definitions = Array.isArray(structure?.segments) ? structure.segments : [];
  const timeCapSeconds = typeof structure?.timeCapSeconds === 'number' ? structure.timeCapSeconds : 0;

  const segmentIndexById = new Map<string, number>();
  definitions.forEach((segment, index) => {
    if (typeof segment?.id === 'string' && !segmentIndexById.has(segment.id)) segmentIndexById.set(segment.id, index);
  });
  const targets = definitions.map((segment) => (Number.isInteger(segment?.reps) && segment.reps > 0 ? segment.reps : 0));
  const roundTarget = targets.reduce((sum, target) => sum + target, 0);
  const done = targets.map(() => 0);
  const completedAt: (number | null)[] = targets.map(() => null);

  const tieBreak = structure?.tieBreak as WorkoutTieBreak | null | undefined;
  const splitIndex = tieBreak?.kind === 'split_time' && typeof tieBreak.at === 'string' && segmentIndexById.has(tieBreak.at)
    ? segmentIndexById.get(tieBreak.at) as number
    : -1;
  const markIndexes: number[] = !isAmrap && tieBreak?.kind === 'last_split' && Array.isArray(tieBreak.at)
    ? [...new Set(tieBreak.at.map((id) => segmentIndexById.get(id)).filter((index): index is number => index !== undefined))]
      .sort((a, b) => a - b)
    : [];
  const byLastRound = isAmrap && tieBreak?.kind === 'last_round';

  const parsed = (Array.isArray(events) ? events : []).map((event) => parseEvent(event, segmentIndexById, timeCapSeconds));
  const voided = collectVoided(parsed);

  let roundsCompleted = 0;
  let lastRoundAt: number | null = null;
  let capturedFinal: number | null = null;
  let officialFinal: number | null = null;
  let officialTieBreak: { value: number; key: number } | null = null;

  // O marco que vale como desempate agora: `key` identifica o marco (posição do
  // segmento ou número do round) e `at` é o instante capturado.
  const currentTie = (): { key: number; at: number } | null => {
    if (splitIndex >= 0) {
      const at = completedAt[splitIndex];
      return at === null ? null : { key: splitIndex, at };
    }
    for (let position = markIndexes.length - 1; position >= 0; position -= 1) {
      const at = completedAt[markIndexes[position]];
      if (at !== null) return { key: markIndexes[position], at };
    }
    if (byLastRound && roundsCompleted > 0 && lastRoundAt !== null) return { key: roundsCompleted, at: lastRoundAt };
    return null;
  };

  for (const [index, event] of parsed.entries()) {
    if (!event || event.kind === 'undo' || voided.has(index)) continue;

    if (event.kind === 'time') {
      if (event.target === 'final') {
        if (!isAmrap && capturedFinal !== null) officialFinal = event.value;
      } else {
        const tie = currentTie();
        if (tie) officialTieBreak = { value: event.value, key: tie.key };
      }
      continue;
    }

    const segment = event.segment;
    const current = done[segment];
    const raw = event.t === 'set' ? event.amount : current + event.amount;
    const next = clamp(raw, 0, targets[segment]);
    done[segment] = next;

    if (roundsCompleted === 0) {
      if (next === targets[segment]) {
        if (completedAt[segment] === null) completedAt[segment] = event.at;
      } else {
        completedAt[segment] = null;
      }
    }

    const roundDone = done.reduce((sum, value) => sum + value, 0);
    if (isAmrap) {
      if (roundTarget > 0 && roundDone === roundTarget) {
        roundsCompleted += 1;
        lastRoundAt = event.at;
        done.fill(0);
      }
    } else if (roundDone === roundTarget) {
      if (capturedFinal === null) capturedFinal = event.at;
    } else {
      capturedFinal = null;
    }

    // O tempo oficial vale para a conclusão (ou o marco) em que foi informado.
    if (capturedFinal === null) officialFinal = null;
    const tie = currentTie();
    if (officialTieBreak && (!tie || tie.key !== officialTieBreak.key)) officialTieBreak = null;
  }

  const roundDone = done.reduce((sum, value) => sum + value, 0);
  const currentIndex = done.findIndex((value, index) => value < targets[index]);

  const effectiveFinal: number | null = officialFinal ?? capturedFinal;
  const tie = currentTie();
  const tieBreakCapturedAt = tie ? tie.at : null;
  const tieBreakAt: number | null = officialTieBreak && tie && officialTieBreak.key === tie.key
    ? officialTieBreak.value
    : tieBreakCapturedAt;
  const tieBreakAdjusted = Boolean(officialTieBreak && tie && officialTieBreak.key === tie.key);
  const tieSegmentIndex = tie && (splitIndex >= 0 || markIndexes.length > 0) ? tie.key : -1;
  // Fim da prova: o tempo final efetivo (For Time concluído) ou o time cap.
  const end = !isAmrap && effectiveFinal !== null ? effectiveFinal : timeCapSeconds;

  return {
    format,
    segments: definitions.map((segment, index) => ({
      id: String(segment?.id ?? ''),
      target: targets[index],
      done: done[index],
      completedAt: completedAt[index]
    })),
    repsTarget: roundTarget,
    repsDone: isAmrap ? roundsCompleted * roundTarget + roundDone : roundDone,
    repsRemaining: roundTarget - roundDone,
    roundsCompleted,
    currentSegmentId: currentIndex >= 0 ? String(definitions[currentIndex]?.id ?? '') : null,
    completedAt: isAmrap ? null : effectiveFinal,
    capturedCompletedAt: isAmrap ? null : capturedFinal,
    finalAdjusted: officialFinal !== null,
    finalDeltaSeconds: officialFinal !== null && capturedFinal !== null ? officialFinal - capturedFinal : null,
    tieBreakAt,
    tieBreakCapturedAt,
    tieBreakAdjusted,
    tieBreakDeltaSeconds: tieBreakAdjusted && tieBreakAt !== null && tieBreakCapturedAt !== null ? tieBreakAt - tieBreakCapturedAt : null,
    tieBreakSegmentId: tieSegmentIndex >= 0 ? String(definitions[tieSegmentIndex]?.id ?? '') : null,
    tieBreakAfterEnd: tieBreakAt !== null && tieBreakAt > end
  };
};

// Maior tempo que timeToSeconds (scoring.ts) aceita: H:MM:SS com horas de até
// dois dígitos, 99:59:59.
const MAX_PARSEABLE_SECONDS = 99 * 3600 + 59 * 60 + 59;

// Tempo menor ou igual a zero, ou acima do que o parser aceita, não vira texto:
// parseScoreForWorkout e compareTimeTieBreaker recusam tempo zero e horas com
// mais de dois dígitos. O valor numérico continua no resultado.
const timeDisplay = (seconds: number | null) => (
  seconds !== null && seconds > 0 && seconds <= MAX_PARSEABLE_SECONDS ? formatWorkoutTime(seconds) : null
);

const tieBreakResult = (state: SheetState): SheetTieBreakResult => ({
  tieBreakSeconds: state.tieBreakAt,
  tieBreakDisplay: timeDisplay(state.tieBreakAt),
  tieBreakCapturedSeconds: state.tieBreakCapturedAt,
  tieBreakAdjusted: state.tieBreakAdjusted,
  tieBreakDeltaSeconds: state.tieBreakDeltaSeconds,
  tieBreakAfterEnd: state.tieBreakAfterEnd
});

/**
 * Resultado da súmula (REQ-3) de For Time e AMRAP. For Time concluído: tempo =
 * tempo final efetivo. Não concluído: timeCap + restantes × penalidade. AMRAP:
 * total de repetições (o valor guardado é sempre o total, qualquer que seja a
 * forma de exibir). `display` segue o formato aceito por parseScoreForWorkout e
 * o `tieBreakDisplay` (efetivo) é o texto que a publicação grava em
 * splits.tieBreaker. Carga máxima usa computeMaxLoadResult.
 */
export const computeSheetResult = (structure: WorkoutStructure, state: SheetState): SheetResult => {
  if (structure.format === 'amrap') {
    const extraReps = state.segments.reduce((sum, segment) => sum + segment.done, 0);
    return {
      format: 'amrap',
      rounds: state.roundsCompleted,
      extraReps,
      totalReps: state.repsDone,
      value: state.repsDone,
      display: String(state.repsDone),
      ...tieBreakResult(state)
    };
  }

  const timeCapSeconds = structure.timeCapSeconds ?? 0;
  const completed = state.repsRemaining === 0 && state.completedAt !== null;
  const secondsPerRep = structure.incomplete ? structure.incomplete.secondsPerRep : 0;
  const actualSeconds = completed ? state.completedAt as number : timeCapSeconds;
  const penaltySeconds = completed ? 0 : state.repsRemaining * secondsPerRep;
  const adjustedSeconds = actualSeconds + penaltySeconds;
  return {
    format: 'for_time',
    completed,
    actualSeconds,
    adjustedSeconds,
    value: adjustedSeconds,
    display: timeDisplay(adjustedSeconds),
    repsDone: state.repsDone,
    repsRemaining: state.repsRemaining,
    penaltySeconds,
    capturedSeconds: completed ? state.capturedCompletedAt : null,
    finalAdjusted: state.finalAdjusted,
    finalDeltaSeconds: state.finalDeltaSeconds,
    ...tieBreakResult(state)
  };
};

const OFFICIAL_TIME_MESSAGES = {
  target: 'Informe qual tempo ajustar: o tempo final (final) ou o tempo do desempate (tiebreak).',
  integer: 'O tempo oficial deve ser um número inteiro de segundos.',
  maxLoad: 'O ajuste manual do tempo ainda não vale para provas de carga máxima.',
  interval: 'O ajuste manual do tempo não vale para provas intervaladas: o resultado são as repetições e o tempo é o dos rounds.',
  distance: 'O ajuste manual do tempo não vale para provas de distância: o resultado são os metros lançados pelo judge.',
  finalAmrap: 'O ajuste do tempo final não se aplica a provas AMRAP: o tempo da prova é a duração.',
  finalNotCompleted: 'O tempo final só pode ser ajustado em prova concluída. Sem concluir, o tempo é o time cap.',
  noTieBreak: 'Esta prova não tem desempate por tempo.',
  tieBreakNotCompleted: 'O tempo do desempate só pode ser ajustado depois que o segmento do desempate for concluído.',
  tieBreakNoRound: 'O tempo do desempate só pode ser ajustado depois que o primeiro round for concluído.',
  invalid: 'Não foi possível conferir o tempo oficial.'
} as const;

/**
 * Porta que a tela usa antes de gravar um evento `time` (REQ-9): recusa com
 * mensagem em português o que o motor ignoraria e, no desempate, o tempo
 * maior que o fim da prova. Não recusa um tempo final que deixe o desempate
 * depois do fim (o estado fica sinalizado). Nunca lança.
 */
export const checkOfficialTime = (
  structure: WorkoutStructure,
  state: SheetState,
  target: unknown,
  seconds: unknown
): OfficialTimeCheck => {
  try {
    if (target !== 'final' && target !== 'tiebreak') return fail(OFFICIAL_TIME_MESSAGES.target);
    if (typeof seconds !== 'number' || !Number.isInteger(seconds)) return fail(OFFICIAL_TIME_MESSAGES.integer);
    // O intervalado tem time cap numérico (a duração), mas não tem tempo a ajustar.
    if (structure.format === 'interval') return fail(OFFICIAL_TIME_MESSAGES.interval);
    // A distância também tem time cap numérico (a duração), mas não tem tempo a ajustar.
    if (structure.format === 'distance') return fail(OFFICIAL_TIME_MESSAGES.distance);
    if (structure.format === 'max_load' || typeof structure.timeCapSeconds !== 'number') return fail(OFFICIAL_TIME_MESSAGES.maxLoad);
    const timeCap = structure.timeCapSeconds;
    if (seconds < 1 || seconds > timeCap) {
      return fail(`O tempo oficial deve ficar entre 00:01 e o time cap da prova (${formatWorkoutTime(timeCap)}).`);
    }

    const isAmrap = structure.format === 'amrap';
    const completed = !isAmrap && state.repsRemaining === 0 && state.completedAt !== null;
    if (target === 'final') {
      if (isAmrap) return fail(OFFICIAL_TIME_MESSAGES.finalAmrap);
      if (!completed) return fail(OFFICIAL_TIME_MESSAGES.finalNotCompleted);
      return { ok: true };
    }

    if (!structure.tieBreak) return fail(OFFICIAL_TIME_MESSAGES.noTieBreak);
    if (state.tieBreakCapturedAt === null) {
      return fail(structure.tieBreak.kind === 'last_round' ? OFFICIAL_TIME_MESSAGES.tieBreakNoRound : OFFICIAL_TIME_MESSAGES.tieBreakNotCompleted);
    }
    const end = completed ? state.completedAt as number : timeCap;
    if (seconds > end) {
      return fail(`O tempo do desempate não pode passar do fim da prova (${formatWorkoutTime(end)}).`);
    }
    return { ok: true };
  } catch {
    return fail(OFFICIAL_TIME_MESSAGES.invalid);
  }
};

// ---------------------------------------------------------------------------
// Motor da súmula de carga máxima (Story 1.47)
// ---------------------------------------------------------------------------

export type MaxLoadAttempt = {
  /** Posição do evento no log (o alvo de um `undo`). */
  position: number;
  liftId: string;
  loadKg: number;
  ok: boolean;
  at: number;
};

export type MaxLoadLiftState = {
  id: string;
  /** Tentativas que contaram, na ordem do log. */
  attempts: MaxLoadAttempt[];
  used: number;
  /** Tentativas que faltam; null = ilimitadas. */
  remaining: number | null;
  /** Maior carga válida; null sem tentativa válida. */
  bestKg: number | null;
  bestAt: number | null;
  /** Todas as tentativas permitidas já foram usadas. */
  exhausted: boolean;
};

export type MaxLoadSheetState = {
  format: 'max_load';
  lifts: MaxLoadLiftState[];
  /** Movimento em que o judge está agora (a súmula pode deixar escolher outro, conforme a ordem). */
  currentLiftId: string | null;
  attemptsUsed: number;
  /** Posições de tentativas que não contaram: depois da janela, acima do limite ou fora da ordem fixa. */
  ignored: number[];
  /** Instante da última tentativa que contou (o tempo de "terminou o último movimento"). */
  lastAttemptAt: number | null;
  /** Score em kg: soma das maiores cargas válidas (sum) ou a maior delas (best). */
  scoreKg: number;
};

export type MaxLoadSheetResult = {
  format: 'max_load';
  scoring: 'sum' | 'best';
  /** Em kg; o mesmo número que vai para `scores.value`. */
  value: number;
  /** Texto aceito por parseScoreForWorkout('maxweight', …), sem unidade (ex.: "405" ou "152.5"). */
  display: string;
  lifts: { id: string; bestKg: number | null }[];
  attemptsUsed: number;
  /** Desempate por tempo (finish_time): a última tentativa; null nos outros casos ou sem tentativa. */
  tieBreakSeconds: number | null;
  tieBreakDisplay: string | null;
  /** Desempate por menos tentativas (fewest_attempts); null nos outros casos ou sem tentativa. */
  tieBreakAttempts: number | null;
};

export type AttemptCheck = { ok: true } | { ok: false; error: string };

const roundKg = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

type ParsedAttempt = { kind: 'attempt'; lift: number; load: number; ok: boolean; at: number };

const parseMaxLoadEvent = (raw: unknown, liftIndexById: Map<string, number>): ParsedAttempt | UndoEvent | null => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const event = raw as PlainObject;
  const at = readAt(event.at);
  if (at === null) return null;
  if (event.t === 'undo') return readUndo(event, at);
  if (event.t !== 'attempt' || typeof event.ok !== 'boolean') return null;
  const lift = typeof event.lift === 'string' ? liftIndexById.get(event.lift) : undefined;
  if (lift === undefined || !isFiniteBetween(event.load, L.minLoadKg, L.maxLoadKg)) return null;
  return { kind: 'attempt', lift, load: roundKg(event.load as number), ok: event.ok, at };
};

/**
 * Estado da súmula de carga máxima derivado do log. Pura, determinística e
 * sem lançar. Conta as tentativas na ordem do log; não conta (fica em
 * `ignored`) a tentativa depois da janela, além do limite do movimento ou, em
 * ordem fixa, num movimento que já ficou para trás. `undo` anula uma
 * tentativa, como nos outros formatos.
 */
export const deriveMaxLoadState = (structure: WorkoutStructure, events: readonly unknown[]): MaxLoadSheetState => {
  const maxLoad = structure?.maxLoad;
  const definitions = Array.isArray(maxLoad?.lifts) ? maxLoad.lifts : [];
  const fixedOrder = maxLoad?.order !== 'free';
  const windowSeconds = typeof structure?.timeCapSeconds === 'number' ? structure.timeCapSeconds : null;

  const liftIndexById = new Map<string, number>();
  definitions.forEach((lift, index) => {
    if (typeof lift?.id === 'string' && !liftIndexById.has(lift.id)) liftIndexById.set(lift.id, index);
  });
  const limits = definitions.map((lift) => (Number.isInteger(lift?.maxAttempts) && (lift.maxAttempts as number) > 0 ? lift.maxAttempts as number : null));

  const parsed = (Array.isArray(events) ? events : []).map((event) => parseMaxLoadEvent(event, liftIndexById));
  const voided = collectVoided(parsed);

  const attempts: MaxLoadAttempt[][] = definitions.map(() => []);
  const ignored: number[] = [];
  let furthest = -1;
  let lastLift = -1;
  let lastAttemptAt: number | null = null;

  for (const [position, event] of parsed.entries()) {
    if (!event || event.kind === 'undo' || voided.has(position)) continue;
    const limit = limits[event.lift];
    const tooLate = windowSeconds !== null && event.at > windowSeconds;
    const overLimit = limit !== null && attempts[event.lift].length >= limit;
    const goesBack = fixedOrder && furthest > event.lift;
    if (tooLate || overLimit || goesBack) {
      ignored.push(position);
      continue;
    }
    attempts[event.lift].push({
      position,
      liftId: String(definitions[event.lift]?.id ?? ''),
      loadKg: event.load,
      ok: event.ok,
      at: event.at
    });
    furthest = Math.max(furthest, event.lift);
    lastLift = event.lift;
    lastAttemptAt = event.at;
  }

  const lifts: MaxLoadLiftState[] = definitions.map((lift, index) => {
    let bestKg: number | null = null;
    let bestAt: number | null = null;
    for (const attempt of attempts[index]) {
      if (attempt.ok && (bestKg === null || attempt.loadKg > bestKg)) {
        bestKg = attempt.loadKg;
        bestAt = attempt.at;
      }
    }
    const limit = limits[index];
    const used = attempts[index].length;
    return {
      id: String(lift?.id ?? ''),
      attempts: attempts[index],
      used,
      remaining: limit === null ? null : Math.max(0, limit - used),
      bestKg,
      bestAt,
      exhausted: limit !== null && used >= limit
    };
  });

  let currentIndex = -1;
  if (fixedOrder) {
    if (furthest < 0) currentIndex = lifts.length > 0 ? 0 : -1;
    else if (!lifts[furthest].exhausted) currentIndex = furthest;
    else currentIndex = furthest + 1 < lifts.length ? furthest + 1 : -1;
  } else if (lastLift >= 0 && !lifts[lastLift].exhausted) {
    currentIndex = lastLift;
  } else {
    currentIndex = lifts.findIndex((lift) => !lift.exhausted);
  }

  const bests = lifts.map((lift) => lift.bestKg ?? 0);
  const scoreKg = maxLoad?.scoring === 'best'
    ? roundKg(Math.max(0, ...bests))
    : roundKg(bests.reduce((sum, value) => sum + value, 0));

  return {
    format: 'max_load',
    lifts,
    currentLiftId: currentIndex >= 0 ? lifts[currentIndex].id : null,
    attemptsUsed: lifts.reduce((sum, lift) => sum + lift.used, 0),
    ignored,
    lastAttemptAt,
    scoreKg
  };
};

/**
 * Resultado da carga máxima: o score em kg (soma das maiores cargas válidas
 * ou a maior delas) e o desempate configurado. Quem não tem tentativa não tem
 * desempate (perde para quem tem, como em compareTimeTieBreaker).
 */
export const computeMaxLoadResult = (structure: WorkoutStructure, state: MaxLoadSheetState): MaxLoadSheetResult => {
  const kind = structure?.tieBreak?.kind;
  const hasAttempts = state.attemptsUsed > 0;
  const tieBreakSeconds = kind === 'finish_time' && hasAttempts ? state.lastAttemptAt : null;
  return {
    format: 'max_load',
    scoring: structure?.maxLoad?.scoring === 'best' ? 'best' : 'sum',
    value: state.scoreKg,
    display: String(state.scoreKg),
    lifts: state.lifts.map((lift) => ({ id: lift.id, bestKg: lift.bestKg })),
    attemptsUsed: state.attemptsUsed,
    tieBreakSeconds,
    tieBreakDisplay: timeDisplay(tieBreakSeconds),
    tieBreakAttempts: kind === 'fewest_attempts' && hasAttempts ? state.attemptsUsed : null
  };
};

const ATTEMPT_MESSAGES = {
  format: 'Esta prova não é de carga máxima.',
  lift: 'Escolha um movimento da prova.',
  load: `A carga deve ficar entre ${L.minLoadKg} e ${L.maxLoadKg} kg.`,
  window: 'A janela de tempo terminou: levantamento depois dela não conta.',
  invalid: 'Não foi possível conferir a tentativa.'
} as const;

/**
 * Porta que a súmula usa antes de registrar uma tentativa: recusa com
 * mensagem em português o que o motor não contaria (movimento inexistente,
 * carga fora da faixa, depois da janela, além do limite ou, em ordem fixa, num
 * movimento que ficou para trás). Nunca lança.
 */
export const checkAttempt = (
  structure: WorkoutStructure,
  state: MaxLoadSheetState,
  liftId: unknown,
  loadKg: unknown,
  at: unknown
): AttemptCheck => {
  try {
    if (structure.format !== 'max_load' || !structure.maxLoad) return fail(ATTEMPT_MESSAGES.format);
    const index = structure.maxLoad.lifts.findIndex((lift) => lift.id === liftId);
    if (index < 0) return fail(ATTEMPT_MESSAGES.lift);
    if (!isFiniteBetween(loadKg, L.minLoadKg, L.maxLoadKg)) return fail(ATTEMPT_MESSAGES.load);
    const seconds = readAt(at);
    if (seconds !== null && typeof structure.timeCapSeconds === 'number' && seconds > structure.timeCapSeconds) {
      return fail(ATTEMPT_MESSAGES.window);
    }
    const lift = structure.maxLoad.lifts[index];
    const liftState = state.lifts[index];
    if (liftState?.exhausted) {
      return fail(`${lift.maxAttempts === 1 ? 'A tentativa' : `As ${lift.maxAttempts} tentativas`} de ${lift.name} já ${lift.maxAttempts === 1 ? 'foi usada' : 'foram usadas'}.`);
    }
    if (structure.maxLoad.order === 'fixed') {
      const furthest = state.lifts.reduce((max, item, position) => (item.used > 0 ? position : max), -1);
      if (furthest > index) return fail(`A ordem é fixa: ${lift.name} já ficou para trás.`);
    }
    return { ok: true };
  } catch {
    return fail(ATTEMPT_MESSAGES.invalid);
  }
};

// ---------------------------------------------------------------------------
// Motor da súmula do intervalado (Story 1.60)
// ---------------------------------------------------------------------------

export type IntervalRoundState = {
  /** Número do round (1 a `rounds`). */
  round: number;
  /** Feito em cada movimento fixo, na ordem de `segments` (de 0 à meta). */
  fixed: number[];
  /** Repetições do máximo registradas no round (contagem bruta, de 0 ao teto). */
  maxRaw: number;
  /** Todos os fixos chegaram à meta no estado final (sem fixos, todo round pontua). */
  scored: boolean;
  /** O máximo que conta: o bruto se o round pontuou; senão 0. */
  maxCounted: number;
  /** Movimento da vez no round: o primeiro fixo abaixo da meta ou, com os fixos feitos, o máximo. */
  currentId: string;
};

export type IntervalSheetState = {
  format: 'interval';
  rounds: IntervalRoundState[];
  /** Posições de `rep` e `fill` fora da janela de trabalho: não contaram (aviso "N registros fora da janela"). */
  ignored: number[];
  roundsScored: number;
  /** Soma do máximo dos rounds que pontuaram. */
  total: number;
  /** Round do último registro que contou, na ordem do log; null sem registro. */
  lastRound: number | null;
  /** Maior instante entre os registros que contaram; null sem registro. */
  lastCountedAt: number | null;
};

export type IntervalSheetResult = {
  format: 'interval';
  /** Repetições do máximo somadas nos rounds que pontuaram; o mesmo número que vai para `scores.value`. */
  value: number;
  /** Texto aceito por parseScoreForWorkout('reps', …): o número (ex.: "23"). */
  display: string;
  /** Sem desempate nesta versão (decisão 7 do README). */
  tieBreak: null;
  roundsScored: number;
  /** Detalhe por round, para a súmula e o resumo. */
  rounds: { round: number; fixed: number[]; maxRaw: number; maxCounted: number; scored: boolean }[];
  ignoredCount: number;
};

/**
 * Fase da prova num segundo do relógio: `work` com o round e os segundos que
 * faltam para a janela fechar; `rest` com o round que acabou de fechar e os
 * segundos até o próximo; `ended` a partir da duração.
 */
export type IntervalPhase =
  | { phase: 'work'; round: number; secondsLeft: number }
  | { phase: 'rest'; round: number; secondsLeft: number }
  | { phase: 'ended' };

export type IntervalEntryCheck = { ok: true; round: number } | { ok: false; error: string };

type IntervalClock = { rounds: number; on: number; cycle: number; end: number };

// Lê rounds, ON e OFF da estrutura sem confiar nela: com valores que não fazem
// sentido, nenhum registro conta e a prova está encerrada.
const readIntervalClock = (structure: WorkoutStructure | null | undefined): IntervalClock | null => {
  const interval = structure?.interval;
  if (!interval || typeof interval !== 'object') return null;
  const { rounds, onSeconds, offSeconds } = interval;
  if (!Number.isInteger(rounds) || rounds < 1 || !Number.isInteger(onSeconds) || onSeconds < 1
    || !Number.isInteger(offSeconds) || offSeconds < 0) {
    return null;
  }
  return { rounds, on: onSeconds, cycle: onSeconds + offSeconds, end: intervalDurationSeconds(rounds, onSeconds, offSeconds) };
};

/** Round cuja janela [início, início + ON) contém o segundo `at`; null no descanso ou depois do fim. */
const windowRound = (clock: IntervalClock, at: number) => {
  const index = Math.floor(at / clock.cycle);
  if (index >= clock.rounds) return null;
  return at - index * clock.cycle < clock.on ? index + 1 : null;
};

type ParsedIntervalCount = { kind: 'count'; t: CountEventType; item: number; amount: number; at: number; round: number | null };

// `item` é a posição do fixo em `segments` ou, para o máximo, o número de
// fixos. Evento malformado é ignorado por inteiro (null): movimento
// inexistente, `fill` no máximo, n/v/d não inteiros, `set`/`adj` sem `rd` de
// 1 a `rounds`, `at` inválido, e `time`, `attempt` e tipos desconhecidos.
// `rep` e `fill` fora da janela ficam com `round: null`.
const parseIntervalEvent = (
  raw: unknown,
  itemIndexById: Map<string, number>,
  maxIndex: number,
  clock: IntervalClock
): ParsedIntervalCount | UndoEvent | null => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const event = raw as PlainObject;
  const at = readAt(event.at);
  if (at === null) return null;
  if (event.t === 'undo') return readUndo(event, at);
  if (event.t !== 'rep' && event.t !== 'fill' && event.t !== 'set' && event.t !== 'adj') return null;
  const item = typeof event.seg === 'string' ? itemIndexById.get(event.seg) : undefined;
  if (item === undefined) return null;
  if (event.t === 'rep') return { kind: 'count', t: 'rep', item, amount: 1, at, round: windowRound(clock, at) };
  if (event.t === 'fill') {
    if (item === maxIndex || !Number.isInteger(event.n)) return null;
    return { kind: 'count', t: 'fill', item, amount: event.n as number, at, round: windowRound(clock, at) };
  }
  const amount = event.t === 'set' ? event.v : event.d;
  if (!Number.isInteger(amount) || !isIntegerBetween(event.rd, 1, clock.rounds)) return null;
  return { kind: 'count', t: event.t, item, amount: amount as number, at, round: event.rd as number };
};

/**
 * Estado da súmula do intervalado derivado do log. Pura, determinística, sem
 * lançar e sem mutar as entradas. `rep` e `fill` valem no round da janela que
 * contém o `at` (round = ⌊at ÷ (ON + OFF)⌋ + 1, se at mod (ON + OFF) < ON e o
 * round existe); fora da janela vão para `ignored`. `set` e `adj` valem no
 * round `rd`. Cada fixo fica entre 0 e a meta e o máximo entre 0 e o teto por
 * round; `undo` anula um evento, como nos outros formatos. O round pontua se
 * os fixos estão todos na meta no estado final; senão o máximo vale 0, e a
 * contagem bruta fica guardada.
 */
export const deriveIntervalState = (structure: WorkoutStructure, events: readonly unknown[]): IntervalSheetState => {
  const clock = readIntervalClock(structure);
  const definitions = Array.isArray(structure?.segments) ? structure.segments : [];
  const maxIndex = definitions.length;
  const maxId = String(structure?.interval?.max?.id ?? '');
  const targets = definitions.map((segment) => (Number.isInteger(segment?.reps) && segment.reps > 0 ? segment.reps : 0));

  const itemIndexById = new Map<string, number>();
  definitions.forEach((segment, index) => {
    if (typeof segment?.id === 'string' && !itemIndexById.has(segment.id)) itemIndexById.set(segment.id, index);
  });
  if (maxId && !itemIndexById.has(maxId)) itemIndexById.set(maxId, maxIndex);

  const parsed = clock
    ? (Array.isArray(events) ? events : []).map((event) => parseIntervalEvent(event, itemIndexById, maxIndex, clock))
    : [];
  const voided = collectVoided(parsed);

  // Por round: os fixos na ordem de `segments` e, na última posição, o máximo.
  const counts = Array.from({ length: clock ? clock.rounds : 0 }, () => [...targets.map(() => 0), 0]);
  const ignored: number[] = [];
  let lastRound: number | null = null;
  let lastCountedAt: number | null = null;

  for (const [position, event] of parsed.entries()) {
    if (!event || event.kind === 'undo' || voided.has(position)) continue;
    if (event.round === null) {
      ignored.push(position);
      continue;
    }
    const row = counts[event.round - 1];
    const cap = event.item === maxIndex ? L.maxIntervalMaxRepsPerRound : targets[event.item];
    const raw = event.t === 'set' ? event.amount : row[event.item] + event.amount;
    row[event.item] = clamp(raw, 0, cap);
    lastRound = event.round;
    lastCountedAt = lastCountedAt === null ? event.at : Math.max(lastCountedAt, event.at);
  }

  const rounds: IntervalRoundState[] = counts.map((row, index) => {
    const fixed = row.slice(0, maxIndex);
    const pending = fixed.findIndex((done, position) => done < targets[position]);
    const scored = pending < 0;
    const maxRaw = row[maxIndex];
    return {
      round: index + 1,
      fixed,
      maxRaw,
      scored,
      maxCounted: scored ? maxRaw : 0,
      currentId: pending >= 0 ? String(definitions[pending]?.id ?? '') : maxId
    };
  });

  return {
    format: 'interval',
    rounds,
    ignored,
    roundsScored: rounds.filter((round) => round.scored).length,
    total: rounds.reduce((sum, round) => sum + round.maxCounted, 0),
    lastRound,
    lastCountedAt
  };
};

/**
 * Resultado do intervalado: a soma do máximo dos rounds que pontuaram, como
 * número (`value`) e como texto (`display`), sem desempate, com o detalhe por
 * round. Sem registros, 0.
 */
export const computeIntervalResult = (state: IntervalSheetState): IntervalSheetResult => ({
  format: 'interval',
  value: state.total,
  display: String(state.total),
  tieBreak: null,
  roundsScored: state.roundsScored,
  rounds: state.rounds.map((round) => ({
    round: round.round,
    fixed: [...round.fixed],
    maxRaw: round.maxRaw,
    maxCounted: round.maxCounted,
    scored: round.scored
  })),
  ignoredCount: state.ignored.length
});

/**
 * Fase da prova intervalada no segundo `seconds` do relógio da súmula (o motor
 * aplica Math.floor; negativo vale 0). Com OFF = 0 nunca há descanso. Estrutura
 * sem intervalado válido: `ended`. Nunca lança.
 */
export const intervalPhaseAt = (structure: WorkoutStructure, seconds: unknown): IntervalPhase => {
  const clock = readIntervalClock(structure);
  if (!clock) return { phase: 'ended' };
  const at = readAt(seconds) ?? 0;
  if (at >= clock.end) return { phase: 'ended' };
  const index = Math.floor(at / clock.cycle);
  const within = at - index * clock.cycle;
  return within < clock.on
    ? { phase: 'work', round: index + 1, secondsLeft: clock.on - within }
    : { phase: 'rest', round: index + 1, secondsLeft: clock.cycle - within };
};

const INTERVAL_ENTRY_MESSAGES = {
  format: 'Esta prova não é intervalada.',
  rest: 'Descanso: o toque não foi aceito.',
  ended: 'Prova encerrada: o toque não foi aceito.',
  invalid: 'Não foi possível conferir o toque.'
} as const;

/**
 * Porta que a súmula usa antes de gravar um toque (`rep` ou `fill`) no
 * intervalado: aceita só dentro da janela de trabalho, com o round, e recusa
 * no descanso e depois do fim com a mensagem para a tela. Aceita se, e
 * somente se, deriveIntervalState contaria o registro. Nunca lança.
 */
export const checkIntervalEntry = (structure: WorkoutStructure, at: unknown): IntervalEntryCheck => {
  try {
    if (structure?.format !== 'interval' || !readIntervalClock(structure)) return fail(INTERVAL_ENTRY_MESSAGES.format);
    if (readAt(at) === null) return fail(INTERVAL_ENTRY_MESSAGES.invalid);
    const phase = intervalPhaseAt(structure, at);
    if (phase.phase === 'work') return { ok: true, round: phase.round };
    return fail(phase.phase === 'rest' ? INTERVAL_ENTRY_MESSAGES.rest : INTERVAL_ENTRY_MESSAGES.ended);
  } catch {
    return fail(INTERVAL_ENTRY_MESSAGES.invalid);
  }
};

// ---------------------------------------------------------------------------
// Motor da súmula da distância (Story 1.66)
// ---------------------------------------------------------------------------

export type DistanceEntry = {
  /** Posição do evento no log (o alvo de um `undo`). */
  position: number;
  meters: number;
  at: number;
};

export type DistanceSheetState = {
  format: 'distance';
  /** O último total lançado que conta; null sem lançamento válido. */
  meters: number | null;
  /** Lançamentos que contam (não desfeitos), na ordem do log. */
  entries: number;
  /** Instante (s) do último lançamento que conta; null sem lançamento. */
  lastEntryAt: number | null;
  /** Os lançamentos que contam, na ordem do log. */
  history: DistanceEntry[];
};

export type DistanceSheetResult = {
  format: 'distance';
  /** O total em metros; o mesmo número que vai para `scores.value`. */
  value: number;
  /** Texto aceito por parseScoreForWorkout('distance', …): o número (ex.: "6330"). */
  display: string;
  /** Sem desempate nesta versão (decisão 5 do README). */
  tieBreak: null;
  /** Houve ao menos um lançamento (sem ele a súmula não pode ser enviada). */
  entered: boolean;
  entries: number;
};

type ParsedDistanceEvent = { kind: 'dist'; meters: number; at: number } | UndoEvent;

// Evento malformado é ignorado por inteiro (null): `v` não inteiro, negativo ou
// acima do teto, `at` inválido, e `rep`, `fill`, `set`, `adj`, `time`,
// `attempt` e tipos desconhecidos.
const parseDistanceEvent = (raw: unknown): ParsedDistanceEvent | null => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const event = raw as PlainObject;
  const at = readAt(event.at);
  if (at === null) return null;
  if (event.t === 'undo') return readUndo(event, at);
  if (event.t !== 'dist' || !isIntegerBetween(event.v, 0, L.maxDistanceMeters)) return null;
  return { kind: 'dist', meters: event.v as number, at };
};

/**
 * Estado da súmula da distância derivado do log. Pura, determinística, sem
 * lançar e sem mutar as entradas. O estado é o último `dist` não anulado;
 * `undo` anula o evento apontado (undo de undo não tem efeito), como nos outros
 * formatos, e nada é apagado. Sem janela de tempo: o judge pode lançar durante
 * e depois do relógio. Estrutura que não é de distância não tem lançamentos.
 */
export const deriveDistanceState = (structure: WorkoutStructure, events: readonly unknown[]): DistanceSheetState => {
  const parsed = structure?.format === 'distance' && Array.isArray(events) ? events.map(parseDistanceEvent) : [];
  const voided = collectVoided(parsed);
  const history: DistanceEntry[] = [];
  for (const [position, event] of parsed.entries()) {
    if (!event || event.kind !== 'dist' || voided.has(position)) continue;
    history.push({ position, meters: event.meters, at: event.at });
  }
  const last = history.length > 0 ? history[history.length - 1] : null;
  return {
    format: 'distance',
    meters: last ? last.meters : null,
    entries: history.length,
    lastEntryAt: last ? last.at : null,
    history
  };
};

/**
 * Resultado da distância: o total lançado, como número (`value`) e como texto
 * (`display`), sem desempate. Sem lançamento, `value` é 0 e `entered` é falso.
 */
export const computeDistanceResult = (state: DistanceSheetState): DistanceSheetResult => {
  const value = state.meters ?? 0;
  return { format: 'distance', value, display: String(value), tieBreak: null, entered: state.meters !== null, entries: state.entries };
};

/** Metros com o ponto de milhar (6330 → "6.330"), sem depender de Intl. */
export const formatMeters = (meters: number) => {
  const whole = Math.max(0, Math.floor(Number.isFinite(meters) ? meters : 0));
  return String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

export type MetersInputResult = { ok: true; meters: number } | { ok: false; error: string };

const METERS_INPUT_MESSAGES = {
  empty: 'Informe o total em metros.',
  format: 'Use só metros inteiros (ex.: 3250).',
  max: `O total passa de ${formatMeters(L.maxDistanceMeters)} m. Confira o número.`
} as const;

/**
 * O total que o judge digitou, em metros inteiros de 0 a 99.999. Aceita só
 * dígitos ("3250") e o ponto de milhar ("3.250": um a três dígitos e depois
 * grupos de exatamente três), ignorando espaços. Recusa vazio, vírgula, ponto
 * que não é de milhar ("3.25"), sinal, letras e o que passa do teto, com a
 * mensagem para a tela. Nunca lança, qualquer que seja a entrada.
 */
export const parseMetersInput = (text: unknown): MetersInputResult => {
  if (typeof text !== 'string') return fail(METERS_INPUT_MESSAGES.empty);
  const typed = text.replace(/\s/g, '');
  if (!typed) return fail(METERS_INPUT_MESSAGES.empty);
  let digits: string | null = null;
  if (/^\d+$/.test(typed)) digits = typed;
  else if (/^\d{1,3}(\.\d{3})+$/.test(typed)) digits = typed.replace(/\./g, '');
  if (digits === null) return fail(METERS_INPUT_MESSAGES.format);
  const meters = Number(digits);
  if (meters > L.maxDistanceMeters) return fail(METERS_INPUT_MESSAGES.max);
  return { ok: true, meters };
};
