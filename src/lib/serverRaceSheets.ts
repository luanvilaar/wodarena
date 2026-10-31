import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import { RACE_SLED_SECTION_METERS, isRaceStationKey, lastRaceStation, raceStationKeysOf, resolveRaceStageConference } from '@/lib/raceCourseStructure';
import { RACE_RULE_PRESETS, type RaceRulePresetId } from '@/lib/raceRulePresets';
import {
  RACE_ACTIVE_ATTEMPT_STATUSES,
  RACE_JUDGE_MAX_ACTIVE,
  RACE_JUDGE_MAX_ACTIVE_SOLO,
  RACE_SOLO_RELEASE_MESSAGE,
  isRaceAttemptActive,
  isSoloRaceStation,
  raceJudgeCapacity,
  type RaceJudgeCard
} from '@/lib/raceStation';
import {
  checkRaceEvent,
  computeOfficialSeconds,
  evaluateRaceRun,
  evaluateRaceStation,
  sumConfirmedPenaltySeconds,
  toRaceCourseStage,
  type RaceCourseStage,
  type RaceEvent,
  type RaceRuleset,
  type RaceStationKind,
  type RaceStationResult,
  type RaceStationState
} from '@/lib/raceRules';
import {
  RACE_DEFAULT_TIME_ZONE,
  buildRaceWaves,
  findRaceHeatItem,
  formatRaceClock,
  type RaceWaveAthlete,
  type RaceWaveMark
} from '@/lib/raceWaves';
import type { SessionUser } from '@/lib/serverSecurity';
import type { CourseStage } from '@/types';

// Súmula Fitness Race gravada no servidor (Story 1.94, fase F1). Mesmo modelo
// da súmula de Functional Fitness (serverScoresheets.ts), com o algoritmo
// copiado e não importado: a unidade de registro é a tentativa do atleta numa
// estação, com um árbitro escrevendo por vez; o log chega em lotes com
// sequência contígua por tentativa, a partir de 0 (é a posição que o motor usa
// em `undo.of` e na chave das infrações), e o reenvio do mesmo lote não
// duplica. A cada lote o servidor recalcula a corrida inteira com o motor
// (evaluateRaceRun, para a contagem de infrações gerais atravessar as
// estações) e reconcilia as infrações por `source_key`, sem desfazer o que o
// organizador decidiu (D2). O acesso é conferido antes, em
// serverRaceSheetAccess.ts. O fechamento do tempo da corrida (Story 1.97) roda
// no mesmo `append`, quando a tentativa da última estação do percurso vai a
// `released` (Story 1.101, D34; antes, só o Wall Ball fechava: D1, D22).

export class RaceSheetError extends Error {
  constructor(message: string, readonly status = 400, readonly extra: Record<string, unknown> = {}) {
    super(message);
    this.name = 'RaceSheetError';
  }
}

export const RACE_SHEETS_MIGRATION = '20261030120000_race_sheets.sql';
const UNAVAILABLE_MESSAGE = `A súmula Fitness Race ainda não está disponível neste ambiente. Aplique a migration ${RACE_SHEETS_MIGRATION} antes de usar.`;

/** Preset do regulamento criado quando o organizador ainda não escolheu (AUTO-DECISION da story; D6: ponto de partida editável). */
export const RACE_DEFAULT_PRESET: RaceRulePresetId = '2026_27';
/**
 * Tipos de estação que a súmula abre (Story 1.102, D33): os cinco tipos do
 * motor. Na F1 era só o Wall Ball. Corrida (`run`) nunca tem tentativa.
 */
export const RACE_OPENABLE_STATION_KINDS: readonly RaceStationKind[] = ['ergometer', 'sled', 'sections', 'generic', 'wall_ball'];
/** Eventos por lote enviados pelo aparelho. */
export const RACE_MAX_EVENTS_PER_BATCH = 200;
/** Eventos por tentativa (100 reps de Wall Ball com no-reps, desfazer e infrações cabem com folga). */
export const RACE_MAX_EVENTS_PER_ATTEMPT = 2000;
/** Trecho do Sled: 50 m = 4 trechos de 12,5 m (gate da Story 1.93, REL-001). O valor mora em raceCourseStructure.ts (Story 1.100). */
export { RACE_SLED_SECTION_METERS };
// Janela aceita para o horário de um evento em relação ao horário do aparelho no envio do lote.
const MAX_DEVICE_LAG_MS = 24 * 3600 * 1000;
const MAX_DEVICE_LEAD_MS = 5000;

// Tabela ou coluna da súmula Race ainda não criada (migration não aplicada): 503 com a mensagem acima.
export const isMissingRaceSchema = (error: unknown) => {
  const details = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : null;
  const code = typeof details?.code === 'string' ? details.code : '';
  const message = typeof details?.message === 'string' ? details.message : '';
  return code === '42P01' || code === 'PGRST205' || ((code === '42703' || code === 'PGRST204') && /race_/.test(message));
};

const check = <T>(result: { data: T; error: unknown }) => {
  if (result.error) {
    if (isMissingRaceSchema(result.error)) throw new RaceSheetError(UNAVAILABLE_MESSAGE, 503);
    throw result.error;
  }
  return result.data;
};

const isDuplicate = (error: unknown) => Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === '23505');

const nowIso = () => new Date().toISOString();
const newId = (prefix: string) => `${prefix}_${randomUUID()}`;

type PlainObject = Record<string, unknown>;
const isPlainObject = (value: unknown): value is PlainObject => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

// ---------------------------------------------------------------------------
// Horário dos eventos (AC10)
// ---------------------------------------------------------------------------

/** Horário do aparelho: milissegundos desde 1970 ou texto ISO. null se não for um horário. */
const readDeviceTime = (value: unknown): number | null => {
  const ms = typeof value === 'number' ? value : typeof value === 'string' && value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(ms) && ms > 0 ? ms : null;
};

export type RaceEventTimeInput = {
  /** Horário do aparelho no evento (device_at). */
  deviceAt?: string | null;
  /** Desvio do relógio do aparelho para o do servidor no lote (clock_offset_ms = servidor - aparelho). */
  clockOffsetMs?: number | string | null;
  /** Horário do servidor ao receber (recorded_at): a reserva. */
  serverAt?: string | null;
};

/**
 * Horário de um evento da corrida (AC10): o do aparelho corrigido pelo desvio
 * do lote e, sem ele, o do servidor. O resultado nunca passa do horário em que
 * o servidor recebeu (o registro não pode ter acontecido depois de chegar).
 * Função única usada pela largada (1.96) e pelo fim (1.97).
 */
export const resolveEventTime = ({ deviceAt, clockOffsetMs, serverAt }: RaceEventTimeInput): string | null => {
  const server = serverAt ? Date.parse(serverAt) : Number.NaN;
  const device = deviceAt ? Date.parse(deviceAt) : Number.NaN;
  // BIGINT pode chegar como texto.
  const offset = typeof clockOffsetMs === 'string' ? Number(clockOffsetMs) : clockOffsetMs;
  if (Number.isFinite(device) && typeof offset === 'number' && Number.isFinite(offset)) {
    const corrected = device + offset;
    return new Date(Number.isFinite(server) ? Math.min(corrected, server) : corrected).toISOString();
  }
  return Number.isFinite(server) ? new Date(server).toISOString() : null;
};

const eventTimeOf = (row: StoredEvent) => resolveEventTime({ deviceAt: row.device_at, clockOffsetMs: row.clock_offset_ms, serverAt: row.recorded_at });

// ---------------------------------------------------------------------------
// Linhas do banco
// ---------------------------------------------------------------------------

/** Estação do snapshot do percurso: o CourseStage da categoria, com o tipo e a meta já resolvidos (D6). */
export type RaceSnapshotStage = Pick<CourseStage, 'id' | 'name' | 'type' | 'orderIndex' | 'distance' | 'reps' | 'maleWeight' | 'femaleWeight'> & {
  kind: RaceStationKind;
  expectedUnits?: number;
};

export type RaceCourseSnapshot = Record<string, RaceSnapshotStage[]>;

export type RaceRulesetRow = {
  id: string;
  event_id: string;
  version: number;
  preset: RaceRuleset['preset'];
  name: string;
  rules: RaceRuleset;
  course: RaceCourseSnapshot;
  locked_at: string | null;
  created_by: string | null;
  created_at: string;
};

export type RaceRunStatus = 'racing' | 'finished' | 'dnf' | 'cancelled';

export type RaceRunRow = {
  id: string;
  event_id: string;
  division_id: string | null;
  athlete_id: string;
  heat_id: string | null;
  ruleset_id: string;
  status: RaceRunStatus;
  started_at: string | null;
  finish_at: string | null;
  gross_seconds: number | null;
  penalty_seconds: number;
  official_seconds: number | null;
  time_source: 'sheet' | 'manual' | null;
  created_at: string;
  updated_at: string;
};

export type RaceAttemptStatus = 'waiting' | 'running' | 'done_pending_release' | 'released' | 'exited_incomplete' | 'redo' | 'cancelled';

export type RaceAttemptRow = {
  id: string;
  run_id: string;
  event_id: string;
  athlete_id: string;
  station_id: string;
  station_kind: RaceStationKind;
  lane: number | null;
  judge_user_id: string | null;
  judge_name: string;
  status: RaceAttemptStatus;
  progress: Record<string, unknown>;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
};

type StoredEvent = {
  attempt_id?: string;
  seq: number;
  client_event_id: string;
  event: RaceEvent;
  author_user_id?: string | null;
  device_at: string | null;
  clock_offset_ms: number | string | null;
  recorded_at: string | null;
};

export type RaceInfractionRow = {
  id: string;
  run_id: string;
  attempt_id: string | null;
  station_id: string | null;
  source_key: string;
  source_seq: number | null;
  code: string;
  label: string;
  kind: 'warning' | 'penalty' | 'redo';
  seconds: number;
  status: 'pending' | 'confirmed' | 'revoked' | 'cancelled';
  origin: 'engine' | 'judge' | 'manager';
  general: boolean;
  units: number | null;
  resolution: 'redone' | 'declined' | null;
  note: string | null;
  created_by_user_id: string | null;
  created_by_name: string | null;
  decided_by_user_id: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
};

export const toRaceAttemptDto = (row: RaceAttemptRow) => ({
  id: row.id,
  runId: row.run_id,
  eventId: row.event_id,
  athleteId: row.athlete_id,
  stationId: row.station_id,
  stationKind: row.station_kind,
  lane: row.lane,
  judgeUserId: row.judge_user_id,
  judgeName: row.judge_name,
  status: row.status,
  progress: row.progress || {},
  startedAt: row.started_at,
  endedAt: row.ended_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

export const toRaceInfractionDto = (row: RaceInfractionRow) => ({
  id: row.id,
  runId: row.run_id,
  attemptId: row.attempt_id,
  stationId: row.station_id,
  sourceKey: row.source_key,
  code: row.code,
  label: row.label,
  kind: row.kind,
  seconds: Number(row.seconds),
  status: row.status,
  origin: row.origin,
  general: Boolean(row.general),
  units: row.units ?? null,
  resolution: row.resolution ?? null,
  note: row.note ?? null,
  decided: Boolean(row.decided_at),
  decidedAt: row.decided_at ?? null,
  createdAt: row.created_at
});

export const toRaceRulesetDto = (row: RaceRulesetRow) => ({
  id: row.id,
  eventId: row.event_id,
  version: row.version,
  preset: row.preset,
  name: row.name,
  verified: Boolean(row.rules?.verified),
  lockedAt: row.locked_at,
  createdAt: row.created_at,
  rules: row.rules,
  course: row.course
});

// ---------------------------------------------------------------------------
// Regulamento e snapshot do percurso (AC5)
// ---------------------------------------------------------------------------

/**
 * Copia o percurso de uma categoria só com os campos do contrato, na ordem do
 * percurso, com o tipo e a meta resolvidos (Story 1.100, D33): o tipo de
 * conferência e a meta que o organizador definiu, com o fallback de antes
 * (tipo pelo nome; trenó = distância / 12,5 m; seções sem meta) para percurso
 * gravado sem os campos. Ver resolveRaceStageConference.
 */
export const toRaceSnapshotStages = (layout: unknown): RaceSnapshotStage[] => {
  const raw = typeof layout === 'string' ? (() => { try { return JSON.parse(layout) as unknown; } catch { return []; } })() : layout;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => isPlainObject(item) && typeof item.id === 'string' && item.id && typeof item.name === 'string' && (item.type === 'run' || item.type === 'station'))
    .map(({ item, index }) => {
      const stage = item as PlainObject;
      const type = stage.type as CourseStage['type'];
      const { kind, expectedUnits } = resolveRaceStageConference({
        id: stage.id as string,
        name: stage.name as string,
        type,
        distance: stage.distance,
        conferenceKind: stage.conferenceKind,
        units: stage.units
      });
      return {
        id: stage.id as string,
        name: stage.name as string,
        type,
        orderIndex: typeof stage.orderIndex === 'number' && Number.isFinite(stage.orderIndex) ? stage.orderIndex : index,
        ...(typeof stage.distance === 'string' ? { distance: stage.distance } : {}),
        ...(typeof stage.reps === 'number' && Number.isInteger(stage.reps) && stage.reps > 0 ? { reps: stage.reps } : {}),
        ...(typeof stage.maleWeight === 'string' ? { maleWeight: stage.maleWeight } : {}),
        ...(typeof stage.femaleWeight === 'string' ? { femaleWeight: stage.femaleWeight } : {}),
        kind,
        ...(expectedUnits !== undefined ? { expectedUnits } : {})
      } satisfies RaceSnapshotStage;
    })
    .sort((a, b) => a.orderIndex - b.orderIndex);
};

/** Snapshot do percurso de todas as categorias do evento ({ divisionId: estações }), lido de divisions.course_layout. */
export const buildRaceCourseSnapshot = async (supabaseAdmin: SupabaseClient, eventId: string): Promise<RaceCourseSnapshot> => {
  const divisions = (check(await supabaseAdmin.from('divisions').select('id, course_layout').eq('event_id', eventId)) || []) as { id: string; course_layout: unknown }[];
  return Object.fromEntries(divisions.map((division) => [division.id, toRaceSnapshotStages(division.course_layout)]));
};

/** Estação do snapshot pronta para o motor, com o tipo e a meta do snapshot. */
const toEngineStage = (stage: RaceSnapshotStage): RaceCourseStage => ({
  ...toRaceCourseStage(stage as CourseStage, stage.expectedUnits !== undefined ? { expectedUnits: stage.expectedUnits } : {}),
  kind: stage.kind
});

const STATION_KINDS = new Set<string>(['ergometer', 'sled', 'sections', 'wall_ball', 'generic']);

/** Percurso da categoria no snapshot do regulamento, como foi gravado (tipo e meta não são recalculados: o snapshot vale, D6). */
export const courseStagesOf = (ruleset: RaceRulesetRow, divisionId: string | null): RaceSnapshotStage[] => {
  const stored = divisionId && isPlainObject(ruleset.course) ? (ruleset.course as PlainObject)[divisionId] : null;
  if (!Array.isArray(stored)) return [];
  return stored.filter((item): item is RaceSnapshotStage => (
    isPlainObject(item)
    && typeof item.id === 'string'
    && typeof item.name === 'string'
    && (item.type === 'run' || item.type === 'station')
    && typeof item.kind === 'string'
    && STATION_KINDS.has(item.kind)
  ));
};

/** A estação que fecha o tempo da corrida (Story 1.101, D34): a última do percurso da categoria no snapshot. */
const closingStationOf = (ruleset: RaceRulesetRow, divisionId: string | null) => lastRaceStation(courseStagesOf(ruleset, divisionId));

const rulesOf = (ruleset: RaceRulesetRow): RaceRuleset => {
  const rules = ruleset.rules as unknown;
  if (!isPlainObject(rules) || !isPlainObject(rules.stations) || !isPlainObject(rules.wallBall) || !Array.isArray(rules.general)) {
    throw new RaceSheetError('O regulamento desta corrida está inválido. Fale com o organizador.', 409);
  }
  return rules as RaceRuleset;
};

const readRulesets = async (supabaseAdmin: SupabaseClient, eventId: string) => (
  (check(await supabaseAdmin.from('race_rulesets').select('*').eq('event_id', eventId)) || []) as RaceRulesetRow[]
);

/** Regulamento vigente do evento: a maior versão. */
export const readCurrentRaceRuleset = async (supabaseAdmin: SupabaseClient, eventId: string) => (
  (await readRulesets(supabaseAdmin, eventId)).sort((a, b) => b.version - a.version)[0] ?? null
);

const readRulesetById = async (supabaseAdmin: SupabaseClient, rulesetId: string) => (
  check(await supabaseAdmin.from('race_rulesets').select('*').eq('id', rulesetId).maybeSingle()) as RaceRulesetRow | null
);

const newRulesetRow = (eventId: string, version: number, preset: RaceRulePresetId, course: RaceCourseSnapshot, actor: SessionUser | null): RaceRulesetRow => {
  const rules = structuredClone(RACE_RULE_PRESETS[preset]);
  return {
    id: newId('ruleset'),
    event_id: eventId,
    version,
    preset,
    name: rules.name,
    rules,
    course,
    locked_at: null,
    created_by: actor?.id ?? null,
    created_at: nowIso()
  };
};

/**
 * Regulamento vigente do evento. Sem nenhum, cria a versão 1 com o preset
 * 2026/27 e o snapshot do percurso de cada categoria (D6). Com dois pedidos ao
 * mesmo tempo, o segundo encontra o do primeiro (UNIQUE event_id + version).
 */
export const ensureRaceRuleset = async (supabaseAdmin: SupabaseClient, eventId: string, actor: SessionUser | null = null) => {
  const current = await readCurrentRaceRuleset(supabaseAdmin, eventId);
  if (current) return current;
  const row = newRulesetRow(eventId, 1, RACE_DEFAULT_PRESET, await buildRaceCourseSnapshot(supabaseAdmin, eventId), actor);
  const inserted = await supabaseAdmin.from('race_rulesets').insert(row);
  if (inserted.error) {
    if (isDuplicate(inserted.error)) {
      const raced = await readCurrentRaceRuleset(supabaseAdmin, eventId);
      if (raced) return raced;
    }
    check(inserted);
  }
  return row;
};

// ---------------------------------------------------------------------------
// Corrida, tentativa e log
// ---------------------------------------------------------------------------

/** A corrida não cancelada do atleta no evento (o índice único garante no máximo uma). */
const findActiveRun = async (supabaseAdmin: SupabaseClient, eventId: string, athleteId: string) => {
  const rows = (check(await supabaseAdmin
    .from('race_runs')
    .select('*')
    .eq('event_id', eventId)
    .eq('athlete_id', athleteId)
    .neq('status', 'cancelled')) || []) as RaceRunRow[];
  return rows[0] ?? null;
};

const readRunRow = async (supabaseAdmin: SupabaseClient, runId: string) => (
  check(await supabaseAdmin.from('race_runs').select('*').eq('id', runId).maybeSingle()) as RaceRunRow | null
);

/** A tentativa não cancelada da corrida nesta estação (o índice único garante no máximo uma). */
const findActiveAttempt = async (supabaseAdmin: SupabaseClient, runId: string, stationId: string) => {
  const rows = (check(await supabaseAdmin.from('race_attempts').select('*').eq('run_id', runId).eq('station_id', stationId)) || []) as RaceAttemptRow[];
  return rows.find((row) => row.status !== 'cancelled') ?? null;
};

const readAttemptRow = async (supabaseAdmin: SupabaseClient, attemptId: unknown) => {
  if (typeof attemptId !== 'string' || !attemptId) throw new RaceSheetError('Informe a tentativa.', 400);
  const row = check(await supabaseAdmin.from('race_attempts').select('*').eq('id', attemptId).maybeSingle()) as RaceAttemptRow | null;
  if (!row) throw new RaceSheetError('Tentativa não encontrada.', 404);
  return row;
};

/** Evento da tentativa, para conferir o acesso antes de qualquer outra coisa. */
export const readRaceAttemptEventId = async (supabaseAdmin: SupabaseClient, attemptId: unknown) => (await readAttemptRow(supabaseAdmin, attemptId)).event_id;

const readEvents = async (supabaseAdmin: SupabaseClient, attemptId: string) => {
  const rows = (check(await supabaseAdmin
    .from('race_attempt_events')
    .select('attempt_id, seq, client_event_id, event, author_user_id, device_at, clock_offset_ms, recorded_at')
    .eq('attempt_id', attemptId)
    .order('seq', { ascending: true })) || []) as StoredEvent[];
  return [...rows].sort((a, b) => a.seq - b.seq);
};

/** Categoria da corrida: a gravada na largada ou, sem ela, a atual do atleta. */
const runDivisionId = async (supabaseAdmin: SupabaseClient, run: RaceRunRow) => {
  if (run.division_id) return run.division_id;
  const athlete = check(await supabaseAdmin.from('athletes').select('division_id').eq('id', run.athlete_id).maybeSingle()) as { division_id?: string } | null;
  return athlete?.division_id ?? null;
};

const readRunRuleset = async (supabaseAdmin: SupabaseClient, run: RaceRunRow) => {
  const ruleset = await readRulesetById(supabaseAdmin, run.ruleset_id);
  if (!ruleset) throw new RaceSheetError('Regulamento da corrida não encontrado.', 409);
  return ruleset;
};

/** Id da estação que fecha o tempo da corrida (Story 1.101, D34), lido do snapshot que ela usa. null sem estação. */
export const readRaceClosingStationId = async (supabaseAdmin: SupabaseClient, run: RaceRunRow) => (
  closingStationOf(await readRunRuleset(supabaseAdmin, run), await runDivisionId(supabaseAdmin, run))?.id ?? null
);

const otherJudgeError = (row: RaceAttemptRow) => new RaceSheetError(
  `Esta tentativa está com ${row.judge_name}. Peça ao gestor para liberar antes de arbitrar.`,
  409,
  { attemptId: row.id, judgeName: row.judge_name }
);

// ---------------------------------------------------------------------------
// Capacidade do judge (Story 1.103; D31, D32, D39)
// ---------------------------------------------------------------------------

type ActiveJudgeAttempt = { row: RaceAttemptRow; run: RaceRunRow; closesTime: boolean; solo: boolean };

const attemptOrder = (a: RaceAttemptRow, b: RaceAttemptRow) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);

/**
 * Tentativas que ocupam a vaga do judge no evento (AC2): estado `waiting`,
 * `running`, `done_pending_release` ou `redo`, com a corrida em `racing` ou
 * `finished`, na ordem em que foram criadas, cada uma marcada se é estação de
 * 1 atleta (reps ou a última do percurso da categoria no snapshot, AC3).
 * Sem migration: o limite é regra de aplicação.
 */
const readJudgeActiveAttempts = async (supabaseAdmin: SupabaseClient, eventId: string, judgeUserId: string): Promise<ActiveJudgeAttempt[]> => {
  const attempts = (check(await supabaseAdmin
    .from('race_attempts')
    .select('*')
    .eq('event_id', eventId)
    .eq('judge_user_id', judgeUserId)
    .in('status', [...RACE_ACTIVE_ATTEMPT_STATUSES])) || []) as RaceAttemptRow[];
  if (attempts.length === 0) return [];
  const runs = (check(await supabaseAdmin.from('race_runs').select('*').in('id', [...new Set(attempts.map((row) => row.run_id))])) || []) as RaceRunRow[];
  const runById = new Map(runs.map((row) => [row.id, row]));
  const rulesetById = new Map((await readRulesets(supabaseAdmin, eventId)).map((row) => [row.id, row]));
  const active: ActiveJudgeAttempt[] = [];
  for (const row of [...attempts].sort(attemptOrder)) {
    const run = runById.get(row.run_id);
    if (!run || !isRaceAttemptActive(row.status, run.status)) continue;
    const ruleset = rulesetById.get(run.ruleset_id);
    const closesTime = Boolean(ruleset) && closingStationOf(ruleset as RaceRulesetRow, await runDivisionId(supabaseAdmin, run))?.id === row.station_id;
    active.push({ row, run, closesTime, solo: isSoloRaceStation(row.station_kind, closesTime) });
  }
  return active;
};

const toJudgeCard = (item: ActiveJudgeAttempt): RaceJudgeCard => ({ attemptId: item.row.id, stationKind: item.row.station_kind, solo: item.solo });

/** A estação da tentativa é de 1 atleta por judge (AC3): reps ou a última do percurso da corrida. */
const readAttemptSolo = async (supabaseAdmin: SupabaseClient, row: RaceAttemptRow) => {
  if (row.station_kind === 'wall_ball') return true;
  const run = await readRunRow(supabaseAdmin, row.run_id);
  if (!run) return false;
  return isSoloRaceStation(row.station_kind, (await readRaceClosingStationId(supabaseAdmin, run)) === row.station_id);
};

/** 409 da capacidade (AC2, AC3), com as tentativas que ocupam a vaga e o nome do atleta, para a tela citar. */
const capacityError = async (supabaseAdmin: SupabaseClient, capacity: Extract<ReturnType<typeof raceJudgeCapacity>, { ok: false }>, active: ActiveJudgeAttempt[]) => {
  const blocking = active.filter((item) => capacity.blocking.some((card) => card.attemptId === item.row.id));
  const ids = blocking.map((item) => item.row.athlete_id);
  const athletes = ids.length
    ? (check(await supabaseAdmin.from('athletes').select('id, name').in('id', ids)) || []) as { id: string; name?: string }[]
    : [];
  return new RaceSheetError(capacity.message, 409, {
    capacity: capacity.reason,
    openAttempts: blocking.map((item) => ({
      attemptId: item.row.id,
      athleteId: item.row.athlete_id,
      athleteName: athletes.find((athlete) => athlete.id === item.row.athlete_id)?.name ?? '',
      stationId: item.row.station_id,
      solo: item.solo
    }))
  });
};

/** Confere a vaga antes de gravar: com o limite batido, 409 (AC2, AC3). */
const assertJudgeCapacity = async (supabaseAdmin: SupabaseClient, eventId: string, judgeUserId: string, target: RaceJudgeCard) => {
  const active = await readJudgeActiveAttempts(supabaseAdmin, eventId, judgeUserId);
  const capacity = raceJudgeCapacity(active.map(toJudgeCard), target);
  if (!capacity.ok) throw await capacityError(supabaseAdmin, capacity, active);
};

/**
 * Reconta depois de gravar (AC4): dois pedidos ao mesmo tempo passam pela
 * conferência de antes e gravam juntos. `ordered` (tentativa nova) só conta
 * as criadas antes dela, na mesma ordem para os dois pedidos: fica a primeira,
 * a outra é desfeita. Sem ordem (assumir), qualquer excesso desfaz a gravação.
 */
const recheckJudgeCapacity = async (supabaseAdmin: SupabaseClient, eventId: string, judgeUserId: string, row: RaceAttemptRow, target: RaceJudgeCard, ordered: boolean) => {
  const active = await readJudgeActiveAttempts(supabaseAdmin, eventId, judgeUserId);
  const counted = ordered ? active.filter((item) => attemptOrder(item.row, row) < 0) : active;
  const capacity = raceJudgeCapacity(counted.map(toJudgeCard), target);
  return capacity.ok ? null : capacityError(supabaseAdmin, capacity, counted);
};

/**
 * O árbitro assume a tentativa sem árbitro. A gravação só vale enquanto ela
 * continua sem árbitro: com dois abrindo ao mesmo tempo, o segundo recebe 409.
 * Só assume quem ainda tem vaga (Story 1.103, AC2, AC3, AC6); depois de
 * gravar, reconta e, passando do limite, devolve a tentativa sem árbitro.
 * O log não muda: os registros anteriores seguem com o autor e o horário de
 * quem os fez (D35); só o `judge_name` passa a ser o de agora.
 */
const claimAttemptRow = async (supabaseAdmin: SupabaseClient, actor: SessionUser, row: RaceAttemptRow, solo: boolean) => {
  const target: RaceJudgeCard = { attemptId: row.id, stationKind: row.station_kind, solo };
  await assertJudgeCapacity(supabaseAdmin, row.event_id, actor.id, target);
  check(await supabaseAdmin
    .from('race_attempts')
    .update({ judge_user_id: actor.id, judge_name: actor.name, updated_at: nowIso() })
    .eq('id', row.id)
    .is('judge_user_id', null));
  const claimed = await readAttemptRow(supabaseAdmin, row.id);
  if (claimed.judge_user_id !== actor.id) throw otherJudgeError(claimed);
  const exceeded = await recheckJudgeCapacity(supabaseAdmin, row.event_id, actor.id, claimed, target, false);
  if (exceeded) {
    check(await supabaseAdmin
      .from('race_attempts')
      .update({ judge_user_id: null, judge_name: '', updated_at: nowIso() })
      .eq('id', row.id)
      .eq('judge_user_id', actor.id));
    throw exceeded;
  }
  return claimed;
};

type OpenInput = { eventId: string; athleteId: unknown; stationId: unknown; lane?: unknown };

/**
 * Abre (ou retoma) a tentativa do atleta numa estação da corrida dele (AC6).
 * Só com a corrida em andamento (a onda largou, Story 1.96) e só em estação do
 * percurso (os cinco tipos, Story 1.102). Uma tentativa ativa por corrida e estação: quem arbitra
 * retoma a dela (não conta como nova); sem árbitro, o judge que abre assume;
 * com outro árbitro, 409. Tentativa nova e assumir respeitam a vaga do judge
 * (Story 1.103): até 2 cartões, e a estação de 1 atleta sozinha.
 */
export const openRaceAttempt = async (supabaseAdmin: SupabaseClient, actor: SessionUser, input: OpenInput) => {
  if (typeof input.athleteId !== 'string' || !input.athleteId || typeof input.stationId !== 'string' || !input.stationId) {
    throw new RaceSheetError('Informe o atleta e a estação.');
  }
  const athlete = check(await supabaseAdmin
    .from('athletes')
    .select('id, name, division_id')
    .eq('id', input.athleteId)
    .maybeSingle()) as { id: string; division_id: string } | null;
  if (!athlete) throw new RaceSheetError('Atleta não encontrado.', 404);
  const division = check(await supabaseAdmin
    .from('divisions')
    .select('id, event_id')
    .eq('id', athlete.division_id)
    .maybeSingle()) as { id: string; event_id: string } | null;
  if (!division || division.event_id !== input.eventId) throw new RaceSheetError('Este atleta não pertence ao evento.', 400);

  const run = await findActiveRun(supabaseAdmin, input.eventId, athlete.id);
  if (!run) throw new RaceSheetError('A onda ainda não largou.', 409);
  const ruleset = await readRunRuleset(supabaseAdmin, run);
  const stages = courseStagesOf(ruleset, run.division_id ?? athlete.division_id);
  const stage = stages.find((item) => item.id === input.stationId);
  if (!stage) throw new RaceSheetError('Esta estação não existe no percurso da categoria do atleta.', 400);
  if (stage.type !== 'station' || !RACE_OPENABLE_STATION_KINDS.includes(stage.kind)) {
    throw new RaceSheetError('Esta etapa não tem súmula digital: corrida não abre tentativa, só as estações.', 400);
  }
  const solo = isSoloRaceStation(stage.kind, lastRaceStation(stages)?.id === stage.id);

  const resume = async (row: RaceAttemptRow) => {
    if (row.judge_user_id === actor.id) return row;
    if (row.judge_user_id === null) return actor.role === 'judge' ? claimAttemptRow(supabaseAdmin, actor, row, solo) : row;
    throw otherJudgeError(row);
  };

  const current = await findActiveAttempt(supabaseAdmin, run.id, stage.id);
  if (current) return resume(current);
  if (run.status !== 'racing') throw new RaceSheetError('A corrida deste atleta já foi encerrada.', 409);

  const created = nowIso();
  const lane = Number.isInteger(input.lane) && (input.lane as number) > 0 && (input.lane as number) < 100 ? input.lane as number : null;
  const row: RaceAttemptRow = {
    id: newId('attempt'),
    run_id: run.id,
    event_id: input.eventId,
    athlete_id: athlete.id,
    station_id: stage.id,
    station_kind: stage.kind,
    lane,
    judge_user_id: actor.id,
    judge_name: actor.name,
    status: 'waiting',
    progress: {},
    started_at: null,
    ended_at: null,
    created_at: created,
    updated_at: created
  };
  const target: RaceJudgeCard = { attemptId: row.id, stationKind: stage.kind, solo };
  await assertJudgeCapacity(supabaseAdmin, input.eventId, actor.id, target);
  const inserted = await supabaseAdmin.from('race_attempts').insert(row);
  if (inserted.error) {
    // Outra pessoa abriu no mesmo instante (índice único da tentativa ativa).
    if (isDuplicate(inserted.error)) {
      const raced = await findActiveAttempt(supabaseAdmin, run.id, stage.id);
      if (raced) return resume(raced);
    }
    check(inserted);
  }
  // AC4: outro pedido do mesmo judge gravou junto; a mais nova é cancelada.
  const exceeded = await recheckJudgeCapacity(supabaseAdmin, input.eventId, actor.id, row, target, true);
  if (exceeded) {
    check(await supabaseAdmin.from('race_attempts').update({ status: 'cancelled', updated_at: nowIso() }).eq('id', row.id).eq('status', 'waiting'));
    throw exceeded;
  }
  return row;
};

const CLOSED_ATTEMPT_MESSAGE = 'Esta tentativa já foi encerrada. Correção de tempo ou de penalidade é com o organizador.';

/**
 * Assumir ou liberar a tentativa (AC7 da 1.94). Assumir: só a tentativa sem
 * árbitro, com vaga (Story 1.103); com outro árbitro, 409 com o nome dele.
 * Liberar (`release`): gestor dono ou owner tiram o árbitro de qualquer
 * tentativa, para outro assumir (a rota confere o acesso de gestor). O judge
 * dono "solta" o próprio cartão (Story 1.103, AC5): a tentativa fica sem
 * árbitro, com estado e log intactos; só nas estações de 2 cartões (D39) e
 * nunca numa tentativa encerrada.
 */
export const claimRaceAttempt = async (supabaseAdmin: SupabaseClient, actor: SessionUser, attemptId: unknown, input: { release?: unknown } = {}) => {
  const row = await readAttemptRow(supabaseAdmin, attemptId);
  if (row.status === 'cancelled') throw new RaceSheetError('Esta tentativa foi cancelada.', 409);
  if (input.release === true) {
    if (actor.role === 'manager' || actor.role === 'owner') {
      const patch = { judge_user_id: null, judge_name: '', updated_at: nowIso() };
      check(await supabaseAdmin.from('race_attempts').update(patch).eq('id', row.id));
      return { ...row, ...patch };
    }
    if (row.judge_user_id !== actor.id) throw new RaceSheetError('Só o judge dono do cartão ou o organizador soltam a tentativa.', 403);
    if (!(RACE_ACTIVE_ATTEMPT_STATUSES as readonly string[]).includes(row.status)) throw new RaceSheetError(CLOSED_ATTEMPT_MESSAGE, 409);
    if (await readAttemptSolo(supabaseAdmin, row)) throw new RaceSheetError(RACE_SOLO_RELEASE_MESSAGE, 409);
    check(await supabaseAdmin
      .from('race_attempts')
      .update({ judge_user_id: null, judge_name: '', updated_at: nowIso() })
      .eq('id', row.id)
      .eq('judge_user_id', actor.id));
    return readAttemptRow(supabaseAdmin, row.id);
  }
  if (row.judge_user_id === actor.id) return row;
  if (row.judge_user_id !== null) throw otherJudgeError(row);
  return claimAttemptRow(supabaseAdmin, actor, row, await readAttemptSolo(supabaseAdmin, row));
};

const countAttemptEvents = async (supabaseAdmin: SupabaseClient, attemptId: string) => {
  const counted = await supabaseAdmin.from('race_attempt_events').select('seq', { count: 'exact', head: true }).eq('attempt_id', attemptId);
  check(counted);
  return counted.count ?? 0;
};

/**
 * Dispensar o cartão (Story 1.103, AC5): o judge dono cancela a tentativa
 * aberta por engano, sem nenhum registro no log. Com registros, 409 (o
 * caminho é soltar). Só nas estações de 2 cartões (D39). Se um registro
 * chegar no meio, a tentativa volta ao estado de antes e responde 409.
 */
export const dismissRaceAttempt = async (supabaseAdmin: SupabaseClient, actor: SessionUser, attemptId: unknown) => {
  const row = await readAttemptRow(supabaseAdmin, attemptId);
  if (row.judge_user_id !== actor.id) throw new RaceSheetError('Só o judge dono do cartão dispensa a tentativa.', 403);
  if (row.status === 'cancelled') throw new RaceSheetError('Esta tentativa já foi cancelada.', 409);
  if (!(RACE_ACTIVE_ATTEMPT_STATUSES as readonly string[]).includes(row.status)) throw new RaceSheetError(CLOSED_ATTEMPT_MESSAGE, 409);
  if (await readAttemptSolo(supabaseAdmin, row)) throw new RaceSheetError(RACE_SOLO_RELEASE_MESSAGE, 409);
  const hasRecordsError = () => new RaceSheetError('Este cartão já tem registros: solte o cartão para outro judge assumir.', 409);
  if (await countAttemptEvents(supabaseAdmin, row.id) > 0) throw hasRecordsError();
  check(await supabaseAdmin
    .from('race_attempts')
    .update({ status: 'cancelled', updated_at: nowIso() })
    .eq('id', row.id)
    .eq('judge_user_id', actor.id)
    .eq('status', row.status));
  if (await countAttemptEvents(supabaseAdmin, row.id) > 0) {
    check(await supabaseAdmin.from('race_attempts').update({ status: row.status, updated_at: nowIso() }).eq('id', row.id).eq('status', 'cancelled'));
    throw hasRecordsError();
  }
  const dismissed = await readAttemptRow(supabaseAdmin, row.id);
  if (dismissed.status !== 'cancelled') throw new RaceSheetError('Esta tentativa mudou em outro aparelho. Recarregue para continuar.', 409);
  return dismissed;
};

const assertAttemptWriter = (row: RaceAttemptRow, actor: SessionUser) => {
  if (row.judge_user_id !== actor.id) {
    throw new RaceSheetError(row.judge_user_id ? `Esta tentativa está com ${row.judge_name}.` : 'Assuma a tentativa antes de registrar.', 403);
  }
  if (row.status === 'cancelled') throw new RaceSheetError('Esta tentativa foi cancelada.', 409);
};

// Contrato dos eventos do aparelho: o tipo e só os campos que o motor lê.
const CLIENT_EVENT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const REASON_CODE = /^[a-z0-9_]{1,80}$/;
const SIMPLE_EVENT_TYPES = new Set([
  'start', 'section', 'rep', 'chalk', 'return_wrong', 'return_corrected', 'leave_roxzone',
  'wrong_load', 'redo_done', 'redo_declined', 'exit', 'release', 'abandon'
]);

type RaceClientEventCheck = { ok: true; id: string; event: RaceEvent; deviceAt: string | null } | { ok: false; error: string };

/**
 * Confere um evento do aparelho e devolve a forma normalizada que vai para o
 * log. `position` é a posição que ele vai ocupar (seq, a partir de 0). O
 * `deviceAt` (horário do aparelho no toque) é opcional; quando vem, tem de
 * estar perto do `clientNow` do lote. As regras de jogo (contador travado,
 * desfazer válido, motivo do regulamento) são do motor (checkRaceEvent).
 */
export const normalizeRaceClientEvent = (raw: unknown, position: number, clientNowMs: number): RaceClientEventCheck => {
  const fail = (error: string): RaceClientEventCheck => ({ ok: false, error: `Registro ${position + 1}: ${error}` });
  if (!isPlainObject(raw)) return fail('formato inválido.');
  if (typeof raw.id !== 'string' || !CLIENT_EVENT_ID.test(raw.id)) return fail('identificador do aparelho inválido.');
  const event = raw.event;
  if (!isPlainObject(event) || typeof event.t !== 'string') return fail('formato inválido.');

  let normalized: RaceEvent;
  if (event.t === 'norep') {
    if (typeof event.reason !== 'string' || !REASON_CODE.test(event.reason)) return fail('motivo de no-rep inválido.');
    normalized = { t: 'norep', reason: event.reason };
  } else if (event.t === 'infraction') {
    if (typeof event.code !== 'string' || !REASON_CODE.test(event.code)) return fail('motivo inválido.');
    normalized = { t: 'infraction', code: event.code };
  } else if (event.t === 'undo') {
    if (typeof event.of !== 'number' || !Number.isInteger(event.of) || event.of < 0) return fail('o desfazer aponta para um registro inexistente.');
    normalized = { t: 'undo', of: event.of };
  } else if (SIMPLE_EVENT_TYPES.has(event.t)) {
    normalized = { t: event.t } as RaceEvent;
  } else {
    return fail('tipo de registro desconhecido.');
  }

  let deviceAt: string | null = null;
  if (raw.deviceAt !== undefined && raw.deviceAt !== null) {
    const ms = readDeviceTime(raw.deviceAt);
    if (ms === null) return fail('horário do aparelho inválido.');
    if (ms > clientNowMs + MAX_DEVICE_LEAD_MS || ms < clientNowMs - MAX_DEVICE_LAG_MS) return fail('horário do aparelho fora do lote.');
    deviceAt = new Date(ms).toISOString();
  }
  return { ok: true, id: raw.id, event: normalized, deviceAt };
};

/**
 * Grava um lote de eventos (AC8 e AC10). `fromSeq` é quantos eventos o
 * aparelho já sabe que estão no servidor. Se o servidor tem mais, eles
 * precisam ser o começo deste mesmo lote (resposta perdida e reenvio): esses
 * são ignorados e o resto entra em seguida. Qualquer outra diferença é
 * conflito (409 com `serverCount`). Cada evento passa pelo motor antes de
 * gravar; o lote leva o horário do aparelho (`clientNow`) para o desvio do
 * relógio. Depois, a corrida inteira é recalculada (AC9), inclusive no
 * reenvio, que assim refaz um recálculo que tenha falhado no meio.
 */
export const appendRaceEvents = async (
  supabaseAdmin: SupabaseClient,
  actor: SessionUser,
  attemptId: unknown,
  input: { fromSeq?: unknown; events?: unknown; clientNow?: unknown }
) => {
  const attempt = await readAttemptRow(supabaseAdmin, attemptId);
  assertAttemptWriter(attempt, actor);
  if (!Number.isInteger(input.fromSeq) || (input.fromSeq as number) < 0) throw new RaceSheetError('Informe de onde o lote começa.');
  if (!Array.isArray(input.events) || input.events.length === 0 || input.events.length > RACE_MAX_EVENTS_PER_BATCH) {
    throw new RaceSheetError(`Envie de 1 a ${RACE_MAX_EVENTS_PER_BATCH} registros por vez.`);
  }
  const clientNow = readDeviceTime(input.clientNow);
  if (clientNow === null) throw new RaceSheetError('Informe o horário do aparelho no envio do lote.');
  const receivedAt = Date.now();
  const clockOffsetMs = Math.round(receivedAt - clientNow);

  const run = await readRunRow(supabaseAdmin, attempt.run_id);
  if (!run) throw new RaceSheetError('A corrida desta tentativa não existe mais.', 409);
  if (run.status === 'cancelled') throw new RaceSheetError('Esta corrida foi cancelada.', 409);

  const fromSeq = input.fromSeq as number;
  const batch = input.events as unknown[];
  const stored = await readEvents(supabaseAdmin, attempt.id);
  const count = stored.length;
  const batchIds = batch.map((item) => (isPlainObject(item) ? item.id : undefined));

  const tail = stored.filter((item) => item.seq >= fromSeq);
  const replayed = fromSeq <= count && tail.length <= batch.length && tail.every((item, index) => item.client_event_id === batchIds[index]);
  if (!replayed) {
    throw new RaceSheetError('Esta tentativa foi alterada em outro aparelho. Recarregue para continuar.', 409, { serverCount: count });
  }
  const pending = batch.slice(tail.length);
  if (count + pending.length > RACE_MAX_EVENTS_PER_ATTEMPT) throw new RaceSheetError('Esta tentativa chegou ao limite de registros.', 409);

  const ruleset = await readRunRuleset(supabaseAdmin, run);
  const rules = rulesOf(ruleset);
  const divisionId = await runDivisionId(supabaseAdmin, run);
  const snapshotStage = courseStagesOf(ruleset, divisionId).find((item) => item.id === attempt.station_id);
  const stage = snapshotStage ? toEngineStage(snapshotStage) : null;
  if (!stage) throw new RaceSheetError('Esta estação não existe no percurso da corrida.', 409);

  const isWallBall = stage.kind === 'wall_ball';
  const closingStationId = closingStationOf(ruleset, divisionId)?.id ?? null;
  const closesTime = closingStationId === attempt.station_id;
  // Reps liberado não aceita mais registro, nem o desfazer da liberação (Story 1.97, AC10).
  let released = isWallBall && evaluateRaceStation(rules, stage, stored.map((item) => item.event)).state === 'released';
  // Corrida encerrada: nada novo entra pelo árbitro em DNF (REQ-001 do gate da
  // 1.94, decidido na 1.97) nem na estação que fechou o tempo; correção é do
  // organizador. Com o tempo fechado (`finished`), o registro tardio de uma
  // estação anterior que ficou na fila do aparelho é aceito (Story 1.101, AC5,
  // D9) e o resultado é republicado. O reenvio puro (pending vazio) segue, para
  // refazer um recálculo interrompido.
  const lateRecord = run.status === 'finished' && !closesTime;
  if (pending.length > 0 && run.status !== 'racing' && !lateRecord && !released) {
    throw new RaceSheetError('A corrida deste atleta já foi encerrada. Correções são com o organizador.', 409);
  }

  const recordedAt = new Date(receivedAt).toISOString();
  const rows: StoredEvent[] = [];
  for (const [index, raw] of pending.entries()) {
    const seq = count + index;
    if (released) throw new RaceSheetError('Esta tentativa já foi encerrada. Correção de tempo ou de penalidade é com o organizador.', 409);
    const checked = normalizeRaceClientEvent(raw, seq, clientNow);
    if (!checked.ok) throw new RaceSheetError(checked.error);
    // Sair antes das reps não fecha o tempo no tipo reps, em qualquer posição (AC8, D22; Story 1.101, AC4): o lote inteiro é recusado.
    if (isWallBall && checked.event.t === 'exit') {
      throw new RaceSheetError('Sair antes das reps não fecha o tempo; o atleta precisa completar as reps.', 400);
    }
    const history = [...stored.map((item) => item.event), ...rows.map((item) => item.event)];
    const gate = checkRaceEvent(rules, stage, history, checked.event);
    if (!gate.ok) throw new RaceSheetError(gate.error);
    if (isWallBall && checked.event.t === 'release') released = true;
    rows.push({
      attempt_id: attempt.id,
      seq,
      client_event_id: checked.id,
      event: checked.event,
      author_user_id: actor.id,
      device_at: checked.deviceAt,
      clock_offset_ms: clockOffsetMs,
      recorded_at: recordedAt
    });
  }
  let finalCount = count + rows.length;
  if (rows.length > 0) {
    const inserted = await supabaseAdmin.from('race_attempt_events').insert(rows);
    if (inserted.error) {
      if (!isDuplicate(inserted.error)) check(inserted);
      // Outro pedido gravou no mesmo instante. Se foi este mesmo lote (reenvio em
      // paralelo), o lote já está no log e segue como reenvio; senão, 409 com a
      // contagem de agora.
      const fresh = await readEvents(supabaseAdmin, attempt.id);
      const freshTail = fresh.filter((item) => item.seq >= fromSeq);
      const sameBatch = freshTail.length >= batch.length && batchIds.every((id, index) => freshTail[index]?.client_event_id === id);
      if (!sameBatch) {
        throw new RaceSheetError('Esta tentativa foi alterada em outro aparelho. Recarregue para continuar.', 409, { serverCount: fresh.length });
      }
      finalCount = fresh.length;
    }
  }

  const recalculated = await recalculateRaceRun(supabaseAdmin, run, ruleset);
  const updated = recalculated.attempts.find((item) => item.id === attempt.id) ?? attempt;
  const closedRun = await closeRaceRunOnRelease(supabaseAdmin, run, updated, recalculated.infractions, closingStationId);
  // Registro tardio (AC5): com o tempo já fechado, um lote novo (ou um reenvio
  // cujas penalidades ainda não chegaram à corrida) refaz penalidades, oficial e
  // a publicação pelo ponto único (republishAfterRaceClose, na rota).
  const lateTotalsStale = run.status === 'finished'
    && sumConfirmedPenaltySeconds(recalculated.infractions.map((row) => ({ kind: row.kind, status: row.status, seconds: Number(row.seconds) }))) !== Number(run.penalty_seconds ?? 0);
  return {
    count: finalCount,
    attempt: { ...toRaceAttemptDto(updated), closesTime },
    infractions: recalculated.infractions.filter((item) => item.attempt_id === attempt.id).map(toRaceInfractionDto),
    run: toRaceRunDto(closedRun ?? run),
    // Story 1.99: a corrida fechou neste lote; a rota publica pelo ponto único de republicação.
    closedRunId: run.status === 'racing' && closedRun?.status === 'finished' ? closedRun.id : null,
    // Story 1.101, AC5: registro tardio numa corrida já fechada; a rota republica pelo mesmo ponto.
    republishRunId: run.status === 'finished' && (rows.length > 0 || lateTotalsStale) ? run.id : null
  };
};

export const toRaceRunDto = (row: RaceRunRow) => ({
  id: row.id,
  status: row.status,
  heatId: row.heat_id,
  startedAt: row.started_at,
  finishAt: row.finish_at,
  grossSeconds: row.gross_seconds === null || row.gross_seconds === undefined ? null : Number(row.gross_seconds),
  penaltySeconds: Number(row.penalty_seconds ?? 0),
  officialSeconds: row.official_seconds === null || row.official_seconds === undefined ? null : Number(row.official_seconds),
  timeSource: row.time_source
});

/**
 * Fecha o tempo da corrida quando a tentativa da última estação do percurso foi
 * liberada (Story 1.101, D34; Story 1.97, AC7), de qualquer tipo:
 * `closingStationId` é a estação de fechamento do snapshot (closingStationOf).
 * Saída incompleta (`exited_incomplete`, trenó ou seções) não fecha, nem na
 * última estação: a corrida fica em "Sem tempo fechado" e o organizador decide
 * (D44). Fim = horário do `release` (aparelho corrigido pelo desvio, reserva no
 * servidor: o `ended_at` do recálculo), bruto = fim - largada da onda,
 * penalidades = infrações vigentes (`confirmed`, inclusive as que o
 * organizador manteve), oficial = bruto + penalidades (D2). Só vale com a
 * corrida `racing` (gravação condicional: o reenvio não fecha duas vezes). Sem
 * largada ou com o fim antes dela, a corrida fica `racing`, sem tempo
 * inventado (AC11). O `abandon` nunca chega aqui: a tentativa segue `running`.
 */
export const closeRaceRunOnRelease = async (
  supabaseAdmin: SupabaseClient,
  run: RaceRunRow,
  attempt: RaceAttemptRow,
  infractions: RaceInfractionRow[],
  closingStationId: string | null
) => {
  if (!closingStationId || attempt.station_id !== closingStationId || attempt.status !== 'released' || !attempt.ended_at) return null;
  const current = await readRunRow(supabaseAdmin, run.id);
  if (!current || current.status !== 'racing') return current;
  const start = current.started_at ? Date.parse(current.started_at) : Number.NaN;
  const finish = Date.parse(attempt.ended_at);
  if (!Number.isFinite(start) || !Number.isFinite(finish) || finish <= start) return current;
  const gross = Math.round(finish - start) / 1000;
  const vigentes = infractions.map((row) => ({ kind: row.kind, status: row.status, seconds: Number(row.seconds) }));
  const patch = {
    status: 'finished' as const,
    finish_at: new Date(finish).toISOString(),
    gross_seconds: gross,
    penalty_seconds: sumConfirmedPenaltySeconds(vigentes),
    official_seconds: computeOfficialSeconds(gross, vigentes),
    time_source: 'sheet' as const,
    updated_at: nowIso()
  };
  check(await supabaseAdmin.from('race_runs').update(patch).eq('id', current.id).eq('status', 'racing'));
  return readRunRow(supabaseAdmin, current.id);
};

// ---------------------------------------------------------------------------
// Recálculo da corrida (AC9)
// ---------------------------------------------------------------------------

const ATTEMPT_STATUS_BY_STATE: Record<RaceStationState, RaceAttemptStatus> = {
  waiting: 'waiting',
  in_progress: 'running',
  completed: 'done_pending_release',
  redo: 'redo',
  released: 'released',
  left_incomplete: 'exited_incomplete'
};

const summarizeProgress = (station: RaceStationResult, eventCount: number) => ({
  state: station.state,
  started: station.started,
  validReps: station.validReps,
  targetReps: station.targetReps,
  noReps: station.noReps.length,
  units: station.units,
  expectedUnits: station.expectedUnits,
  missing: station.missing,
  roxzoneLeft: station.roxzoneLeft,
  penaltySeconds: station.penaltySeconds,
  eventCount,
  voided: station.voided,
  // Saída registrada no Wall Ball (D24): o painel (1.98) acha o horário pelo evento da posição.
  abandoned: station.abandoned,
  abandonSeq: station.abandonSeq
});

/** Primeiro evento aceito e não desfeito do tipo pedido (ou o último, com `last`). */
const findEffectiveEvent = (events: StoredEvent[], station: RaceStationResult, types: string[], last = false) => {
  const rejected = new Set(station.rejected.map((item) => item.seq));
  const voided = new Set(station.voided);
  const effective = events.filter((item, index) => !rejected.has(index) && !voided.has(index) && types.includes(item.event?.t));
  return (last ? effective[effective.length - 1] : effective[0]) ?? null;
};

const INFRACTION_FIELDS = ['station_id', 'source_seq', 'code', 'label', 'kind', 'seconds', 'status', 'general', 'units', 'resolution', 'note'] as const;

/**
 * Recalcula a corrida inteira com o motor: as tentativas não canceladas, na
 * ordem do percurso, por evaluateRaceRun (a contagem de infrações gerais, como
 * "estação fora de ordem", atravessa as estações). Atualiza estado, progresso,
 * início e fim de cada tentativa e reconcilia as infrações por `source_key`
 * (`{tentativa}:{chave do motor}`):
 * - infração nova entra (penalidade e advertência `confirmed`, REFAZER
 *   `pending`, como o motor devolve);
 * - infração existente acompanha o motor (o mesmo evento pode virar 15 s ou
 *   advertência depois de um desfazer mais antigo);
 * - infração do motor que sumiu (o evento foi desfeito) fica `cancelled`, só
 *   se o evento de origem estava no log lido;
 * - infração que o organizador decidiu (`decided_at`) não é tocada, nem
 *   cancelada pelo desfazer do árbitro.
 */
export const recalculateRaceRun = async (supabaseAdmin: SupabaseClient, run: RaceRunRow, ruleset: RaceRulesetRow) => {
  const rules = rulesOf(ruleset);
  const course = courseStagesOf(ruleset, await runDivisionId(supabaseAdmin, run));
  const order = new Map(course.map((stage, index) => [stage.id, index]));
  const attempts = ((check(await supabaseAdmin.from('race_attempts').select('*').eq('run_id', run.id)) || []) as RaceAttemptRow[])
    .filter((row) => row.status !== 'cancelled')
    .sort((a, b) => (order.get(a.station_id) ?? course.length) - (order.get(b.station_id) ?? course.length) || a.created_at.localeCompare(b.created_at));
  const logs = await Promise.all(attempts.map((attempt) => readEvents(supabaseAdmin, attempt.id)));
  const stages = attempts.map((attempt) => {
    const stage = course.find((item) => item.id === attempt.station_id);
    // Estação fora do snapshot (não deveria acontecer: o snapshot usado não muda) vira genérica.
    return stage ? toEngineStage(stage) : { id: attempt.station_id, name: attempt.station_id, kind: attempt.station_kind };
  });
  const result = evaluateRaceRun(rules, attempts.map((attempt, index) => ({ stage: stages[index], events: logs[index].map((item) => item.event) })));

  const at = nowIso();
  const updatedAttempts: RaceAttemptRow[] = [];
  for (const [index, attempt] of attempts.entries()) {
    const station = result.stations[index];
    const events = logs[index];
    const start = findEffectiveEvent(events, station, ['start']);
    const closed = station.state === 'released' || station.state === 'left_incomplete';
    const end = closed ? findEffectiveEvent(events, station, ['release', 'exit'], true) : null;
    const patch = {
      status: ATTEMPT_STATUS_BY_STATE[station.state],
      progress: summarizeProgress(station, events.length),
      started_at: start ? eventTimeOf(start) : null,
      ended_at: end ? eventTimeOf(end) : null,
      updated_at: at
    };
    // Guarda mínima contra dois recálculos da mesma corrida ao mesmo tempo
    // (a serialização por RPC com FOR UPDATE fica para a F2): só grava estado e
    // progresso se o log ainda tem os eventos que foram lidos; senão, o
    // recálculo do lote mais novo grava.
    const counted = await supabaseAdmin.from('race_attempt_events').select('seq', { count: 'exact', head: true }).eq('attempt_id', attempt.id);
    check(counted);
    if (counted.count !== events.length) {
      updatedAttempts.push(await readAttemptRow(supabaseAdmin, attempt.id));
      continue;
    }
    check(await supabaseAdmin.from('race_attempts').update(patch).eq('id', attempt.id));
    updatedAttempts.push({ ...attempt, ...patch });
  }

  const existing = (check(await supabaseAdmin.from('race_infractions').select('*').eq('run_id', run.id)) || []) as RaceInfractionRow[];
  const byKey = new Map(existing.map((row) => [row.source_key, row]));
  const computedKeys = new Set<string>();
  for (const [index, attempt] of attempts.entries()) {
    for (const infraction of result.stations[index].infractions) {
      const sourceKey = `${attempt.id}:${infraction.sourceKey}`;
      computedKeys.add(sourceKey);
      const fields = {
        station_id: infraction.stageId,
        source_seq: infraction.sourceSeq,
        code: infraction.code,
        label: infraction.label,
        kind: infraction.kind,
        seconds: infraction.seconds,
        status: infraction.status,
        general: infraction.general,
        units: infraction.units ?? null,
        resolution: infraction.resolution ?? null,
        note: infraction.note ?? null
      };
      const current = byKey.get(sourceKey);
      if (current) {
        if (current.decided_at) continue;
        const changed = INFRACTION_FIELDS.some((field) => (field === 'seconds' ? Number(current.seconds) !== fields.seconds : (current[field] ?? null) !== fields[field]));
        if (changed) check(await supabaseAdmin.from('race_infractions').update({ ...fields, updated_at: at }).eq('id', current.id).is('decided_at', null));
        continue;
      }
      const author = logs[index][infraction.sourceSeq]?.author_user_id ?? null;
      const inserted = await supabaseAdmin.from('race_infractions').insert({
        id: newId('infraction'),
        run_id: run.id,
        attempt_id: attempt.id,
        source_key: sourceKey,
        ...fields,
        origin: 'engine',
        created_by_user_id: author,
        created_by_name: author && author === attempt.judge_user_id ? attempt.judge_name : null,
        decided_by_user_id: null,
        decided_by_name: null,
        decided_at: null,
        created_at: at,
        updated_at: at
      });
      // Outro lote da mesma corrida gravou a mesma infração no mesmo instante: ela já existe.
      if (inserted.error && !isDuplicate(inserted.error)) check(inserted);
    }
  }

  // Tamanho do log lido por tentativa: só some (e vira `cancelled`) a infração
  // cujo evento de origem estava no log lido; uma criada por um recálculo que
  // já viu mais eventos fica como está.
  const logLength = new Map(attempts.map((attempt, index) => [attempt.id, logs[index].length]));
  for (const row of existing) {
    const vanished = row.origin !== 'manager'
      && row.attempt_id !== null
      && logLength.has(row.attempt_id)
      && row.source_seq !== null
      && row.source_seq < (logLength.get(row.attempt_id) ?? 0)
      && !row.decided_at
      && !computedKeys.has(row.source_key)
      && row.status !== 'cancelled';
    if (vanished) check(await supabaseAdmin.from('race_infractions').update({ status: 'cancelled', updated_at: at }).eq('id', row.id).is('decided_at', null));
  }

  const infractions = (check(await supabaseAdmin.from('race_infractions').select('*').eq('run_id', run.id)) || []) as RaceInfractionRow[];
  return { attempts: updatedAttempts, infractions, penaltySeconds: result.penaltySeconds };
};

// ---------------------------------------------------------------------------
// Largada da onda (Story 1.96)
// ---------------------------------------------------------------------------

export const RACE_START_HEAT_MIGRATION = '20261030140000_race_start_heat.sql';
const START_HEAT_UNAVAILABLE = `A largada da onda ainda não está disponível neste ambiente. Aplique a migration ${RACE_START_HEAT_MIGRATION} antes de usar.`;

// Função do banco ainda não criada (migration da largada não aplicada).
const isMissingFunction = (error: unknown) => {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  return code === '42883' || code === 'PGRST202';
};

const errorText = (error: unknown) => (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string' ? (error as { message: string }).message : '');

type HeatMarkRow = {
  event_id: string;
  heat_id: string;
  started_at: string;
  started_by_user_id: string | null;
  started_by_name: string | null;
};

type RaceEventScheduleRow = { id: string; name?: string; event_schedule?: unknown; time_zone?: string | null };

export const readRaceEventSchedule = async (supabaseAdmin: SupabaseClient, eventId: string) => {
  const row = check(await supabaseAdmin.from('events').select('id, name, event_schedule, time_zone').eq('id', eventId).maybeSingle()) as RaceEventScheduleRow | null;
  if (!row) throw new RaceSheetError('Evento não encontrado.', 404);
  return row;
};

/** Atletas do evento pelo id (só os de categorias do evento), com a categoria. */
const readEventAthletes = async (supabaseAdmin: SupabaseClient, eventId: string, athleteIds?: string[]) => {
  const divisions = (check(await supabaseAdmin.from('divisions').select('id, name').eq('event_id', eventId)) || []) as { id: string; name?: string }[];
  const divisionName = new Map(divisions.map((division) => [division.id, division.name ?? '']));
  if (divisions.length === 0 || (athleteIds && athleteIds.length === 0)) return new Map<string, RaceWaveAthlete>();
  let query = supabaseAdmin.from('athletes').select('id, name, box, division_id').in('division_id', divisions.map((division) => division.id));
  if (athleteIds) query = query.in('id', athleteIds);
  const rows = (check(await query) || []) as { id: string; name?: string; box?: string; division_id: string }[];
  return new Map(rows
    .filter((row) => divisionName.has(row.division_id))
    .map((row) => [row.id, { id: row.id, name: row.name ?? '', box: row.box ?? '', divisionId: row.division_id, divisionName: divisionName.get(row.division_id) ?? '' }]));
};

const readHeatMark = async (supabaseAdmin: SupabaseClient, eventId: string, heatId: string) => (
  check(await supabaseAdmin.from('race_heat_marks').select('*').eq('event_id', eventId).eq('heat_id', heatId).maybeSingle()) as HeatMarkRow | null
);

const alreadyStarted = (startedAt: string, timeZone?: string | null) => new RaceSheetError(
  `Largada já registrada às ${formatRaceClock(startedAt, timeZone || undefined)}.`,
  409,
  { startedAt }
);

/**
 * Ondas do evento para a tela de largada e para a seção "Ondas" do painel
 * (AC1, AC8): itens `kind: 'heat'` do cronograma com ao menos um atleta, com
 * as categorias, os atletas (nome, box e categoria; sem e-mail), o estado da
 * largada e quantas corridas a onda tem.
 */
export const readRaceWaves = async (supabaseAdmin: SupabaseClient, eventId: string) => {
  const event = await readRaceEventSchedule(supabaseAdmin, eventId);
  const [athletes, marks, runs] = await Promise.all([
    readEventAthletes(supabaseAdmin, eventId),
    supabaseAdmin.from('race_heat_marks').select('*').eq('event_id', eventId),
    supabaseAdmin.from('race_runs').select('heat_id, status').eq('event_id', eventId)
  ]);
  const markRows = (check(marks) || []) as HeatMarkRow[];
  const runsByHeat = new Map<string, number>();
  for (const run of (check(runs) || []) as { heat_id: string | null; status: RaceRunStatus }[]) {
    if (!run.heat_id || run.status === 'cancelled') continue;
    runsByHeat.set(run.heat_id, (runsByHeat.get(run.heat_id) ?? 0) + 1);
  }
  const markMap = new Map<string, RaceWaveMark>(markRows.map((row) => [row.heat_id, { startedAt: row.started_at, startedByName: row.started_by_name }]));
  return {
    event: { id: event.id, name: event.name ?? '', timeZone: event.time_zone || RACE_DEFAULT_TIME_ZONE },
    waves: buildRaceWaves(event.event_schedule, athletes, markMap, runsByHeat)
  };
};

type StartHeatInput = { heatId?: unknown; deviceAt?: unknown; clientNow?: unknown };

/**
 * Largada da onda (AC3, AC4, AC6). O horário é o do aparelho no toque
 * (`deviceAt`, guardado na fila local quando a conexão cai), corrigido pelo
 * desvio calculado no envio (`clientNow`), por resolveEventTime. Garante o
 * regulamento (ensureRaceRuleset) e, numa transação só no banco
 * (race_start_heat): grava a marca da onda (uma por onda: a segunda responde
 * 409 com o horário que vale), trava o regulamento com o snapshot do percurso
 * do primeiro uso (D6) e cria uma corrida `racing` para cada atleta da onda,
 * com `started_at` igual ao horário da largada; quem já tem corrida ativa no
 * evento não é duplicado.
 */
export const startRaceHeat = async (supabaseAdmin: SupabaseClient, actor: SessionUser, eventId: string, input: StartHeatInput) => {
  const heatId = typeof input.heatId === 'string' ? input.heatId.trim() : '';
  if (!heatId || heatId.length > 120) throw new RaceSheetError('Informe a onda.');
  const clientNow = readDeviceTime(input.clientNow);
  if (clientNow === null) throw new RaceSheetError('Informe o horário do aparelho no envio.');
  let deviceAtMs = clientNow;
  if (input.deviceAt !== undefined && input.deviceAt !== null) {
    const ms = readDeviceTime(input.deviceAt);
    if (ms === null) throw new RaceSheetError('Horário do toque inválido.');
    if (ms > clientNow + MAX_DEVICE_LEAD_MS || ms < clientNow - MAX_DEVICE_LAG_MS) throw new RaceSheetError('Horário do toque fora do envio.');
    deviceAtMs = ms;
  }

  const event = await readRaceEventSchedule(supabaseAdmin, eventId);
  const heat = findRaceHeatItem(event.event_schedule, heatId);
  if (!heat) throw new RaceSheetError('Onda não encontrada no cronograma do evento.', 404);
  const athletes = [...(await readEventAthletes(supabaseAdmin, eventId, heat.athleteIds)).values()];
  if (athletes.length === 0) throw new RaceSheetError('Esta onda não tem atletas. Monte a onda na aba Cronograma antes de largar.');

  const existing = await readHeatMark(supabaseAdmin, eventId, heatId);
  if (existing) throw alreadyStarted(existing.started_at, event.time_zone);

  const ruleset = await ensureRaceRuleset(supabaseAdmin, eventId, actor);
  // Regulamento ainda não usado: o snapshot do percurso é tirado agora, no primeiro uso (D6).
  const course = ruleset.locked_at ? ruleset.course : await buildRaceCourseSnapshot(supabaseAdmin, eventId);
  const withoutCourse = athletes.find((athlete) => courseStagesOf({ ...ruleset, course }, athlete.divisionId).length === 0);
  if (withoutCourse) {
    throw new RaceSheetError(`O percurso da categoria ${withoutCourse.divisionName || 'do atleta'} não está montado. Monte o percurso na construção da prova antes de largar.`);
  }

  const receivedAt = Date.now();
  const clockOffsetMs = Math.round(receivedAt - clientNow);
  const deviceAt = new Date(deviceAtMs).toISOString();
  const startedAt = resolveEventTime({ deviceAt, clockOffsetMs, serverAt: new Date(receivedAt).toISOString() }) as string;

  const result = await supabaseAdmin.rpc('race_start_heat', {
    p_event_id: eventId,
    p_heat_id: heatId,
    p_ruleset_id: ruleset.id,
    p_course: ruleset.locked_at ? null : course,
    p_started_at: startedAt,
    p_device_at: deviceAt,
    p_clock_offset_ms: clockOffsetMs,
    p_actor_id: actor.id,
    p_actor_name: actor.name,
    p_runs: athletes.map((athlete) => ({ id: newId('run'), athlete_id: athlete.id }))
  });
  if (result.error) {
    if (isMissingFunction(result.error) || isMissingRaceSchema(result.error)) throw new RaceSheetError(START_HEAT_UNAVAILABLE, 503);
    if (/race_event_required/.test(errorText(result.error))) throw new RaceSheetError('A súmula Fitness Race é exclusiva de eventos Fitness Race.', 400);
    if (/race_ruleset_not_found/.test(errorText(result.error))) throw new RaceSheetError('O regulamento do evento mudou agora. Tente largar de novo.', 409);
    throw result.error;
  }
  const data = (result.data || {}) as { started?: boolean; started_at?: string; runs_created?: number };
  if (data.started === false) throw alreadyStarted(data.started_at || startedAt, event.time_zone);
  const runsCreated = Number(data.runs_created ?? 0);
  return {
    heatId,
    startedAt: data.started_at || startedAt,
    runsCreated,
    // Atletas que já tinham corrida ativa no evento (não duplicados).
    alreadyRacing: athletes.length - runsCreated
  };
};

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

/** A tentativa para a tela do árbitro: log, infrações, estação do snapshot, regulamento e nomes (sem e-mail). */
export const readRaceAttemptForActor = async (supabaseAdmin: SupabaseClient, attemptId: unknown) => {
  const attempt = await readAttemptRow(supabaseAdmin, attemptId);
  const run = await readRunRow(supabaseAdmin, attempt.run_id);
  if (!run) throw new RaceSheetError('A corrida desta tentativa não existe mais.', 409);
  const [ruleset, events, infractions, athleteResult, eventResult] = await Promise.all([
    readRunRuleset(supabaseAdmin, run),
    readEvents(supabaseAdmin, attempt.id),
    supabaseAdmin.from('race_infractions').select('*').eq('attempt_id', attempt.id),
    supabaseAdmin.from('athletes').select('id, name, box, division_id').eq('id', attempt.athlete_id).maybeSingle(),
    supabaseAdmin.from('events').select('id, name, time_zone').eq('id', attempt.event_id).maybeSingle()
  ]);
  const athlete = check(athleteResult) as { name?: string; box?: string; division_id?: string } | null;
  const event = check(eventResult) as { name?: string; time_zone?: string | null } | null;
  const divisionId = run.division_id ?? athlete?.division_id ?? null;
  const division = divisionId
    ? check(await supabaseAdmin.from('divisions').select('id, name, type, category').eq('id', divisionId).maybeSingle()) as { name?: string; type?: string; category?: string } | null
    : null;
  const stages = courseStagesOf(ruleset, divisionId);
  const stage = stages.find((item) => item.id === attempt.station_id) ?? null;
  const closesTime = lastRaceStation(stages)?.id === attempt.station_id;
  return {
    // closesTime (Story 1.101, AC8; D39): a estação fecha o tempo e é de 1 atleta por judge.
    // solo (Story 1.103, AC3): estação de 1 atleta (reps ou final), fora da tela de dois cartões.
    // stationKey (Story 1.102, AC2): a estação física, para a lista da onda.
    attempt: {
      ...toRaceAttemptDto(attempt),
      closesTime,
      solo: isSoloRaceStation(attempt.station_kind, closesTime),
      stationKey: raceStationKeysOf(stages).get(attempt.station_id) ?? null
    },
    run: { ...toRaceRunDto(run), divisionId },
    stage,
    ruleset: { id: ruleset.id, version: ruleset.version, preset: ruleset.preset, name: ruleset.name, verified: Boolean(ruleset.rules?.verified), rules: ruleset.rules },
    events: events.map((item) => ({ id: item.client_event_id, event: item.event, deviceAt: item.device_at })),
    infractions: ((check(infractions) || []) as RaceInfractionRow[]).map(toRaceInfractionDto),
    context: {
      athleteName: athlete?.name ?? '',
      box: athlete?.box ?? '',
      divisionName: division?.name ?? '',
      // Dupla e equipe: um cartão só, reps contadas juntas (AC12).
      team: isTeamDivision(division?.type),
      category: division?.category ?? null,
      stationName: stage?.name ?? attempt.station_id,
      eventName: event?.name ?? '',
      timeZone: event?.time_zone || RACE_DEFAULT_TIME_ZONE
    }
  };
};

/**
 * Cartões abertos de quem pede (Story 1.103, AC7, AC10; `view=my_cards`): as
 * tentativas ativas dele no evento (as que ocupam a vaga), na ordem em que
 * foram abertas, cada uma no formato da leitura `attempt` (estação, atleta,
 * estado, trechos e log, de onde a tela tira as recusas do motor). A tela de
 * dois cartões volta igual depois de recarregar. Cada cartão leva o `viewer`
 * de quem pede, como na leitura `attempt`: o cartão decide por ele se é o
 * judge dono (sem ele a tela caía).
 */
export const readRaceJudgeCards = async (supabaseAdmin: SupabaseClient, eventId: string, actor: SessionUser) => {
  const event = await readRaceEventSchedule(supabaseAdmin, eventId);
  const active = await readJudgeActiveAttempts(supabaseAdmin, eventId, actor.id);
  const viewer = { id: actor.id, name: actor.name, role: actor.role };
  const cards = await Promise.all(active.map(async (item) => ({ ...(await readRaceAttemptForActor(supabaseAdmin, item.row.id)), viewer })));
  const solo = active.some((item) => item.solo);
  return {
    event: { id: event.id, name: event.name ?? '', timeZone: event.time_zone || RACE_DEFAULT_TIME_ZONE },
    cards,
    capacity: { max: solo ? RACE_JUDGE_MAX_ACTIVE_SOLO : RACE_JUDGE_MAX_ACTIVE, active: active.length, solo }
  };
};

const isTeamDivision = (type: unknown) => typeof type === 'string' && type !== '' && type !== 'individual';

/**
 * Lista da onda para o árbitro do Wall Ball (Story 1.97, AC1): as ondas que
 * largaram, com cada atleta que tem corrida (nome, box, categoria, dupla), a
 * estação de Wall Ball do percurso dele, se ela fecha o tempo (`closesTime`,
 * Story 1.101: é a última estação do percurso) e a tentativa, se houver
 * (estado, árbitro, reps, saída registrada). Sem e-mail.
 */
/**
 * O que as listas da onda dos árbitros leem (Wall Ball, Story 1.97; estação,
 * Story 1.102): evento, atletas, largadas, corridas não canceladas,
 * tentativas não canceladas, regulamentos e categorias de dupla/equipe.
 */
export const readRaceBoardSources = async (supabaseAdmin: SupabaseClient, eventId: string) => {
  const event = await readRaceEventSchedule(supabaseAdmin, eventId);
  const [athletes, marks, runsResult, attemptsResult, rulesets, divisionsResult] = await Promise.all([
    readEventAthletes(supabaseAdmin, eventId),
    supabaseAdmin.from('race_heat_marks').select('*').eq('event_id', eventId),
    supabaseAdmin.from('race_runs').select('*').eq('event_id', eventId),
    supabaseAdmin.from('race_attempts').select('*').eq('event_id', eventId),
    readRulesets(supabaseAdmin, eventId),
    supabaseAdmin.from('divisions').select('id, type').eq('event_id', eventId)
  ]);
  const markMap = new Map<string, RaceWaveMark>(((check(marks) || []) as HeatMarkRow[]).map((row) => [row.heat_id, { startedAt: row.started_at, startedByName: row.started_by_name }]));
  const runs = ((check(runsResult) || []) as RaceRunRow[]).filter((row) => row.status !== 'cancelled');
  return {
    event,
    athletes,
    markMap,
    runByAthlete: new Map(runs.map((row) => [row.athlete_id, row])),
    attempts: ((check(attemptsResult) || []) as RaceAttemptRow[]).filter((row) => row.status !== 'cancelled'),
    rulesetById: new Map(rulesets.map((row) => [row.id, row])),
    teamDivisions: new Set(((check(divisionsResult) || []) as { id: string; type?: string }[]).filter((row) => isTeamDivision(row.type)).map((row) => row.id))
  };
};

export const readRaceWallBallBoard = async (supabaseAdmin: SupabaseClient, eventId: string) => {
  const sources = await readRaceBoardSources(supabaseAdmin, eventId);
  const { event, athletes, markMap, runByAthlete, rulesetById, teamDivisions } = sources;
  const attempts = sources.attempts.filter((row) => row.station_kind === 'wall_ball');

  const waves = buildRaceWaves(event.event_schedule, athletes, markMap, new Map())
    .filter((wave) => wave.startedAt)
    .map((wave) => ({
      id: wave.id,
      title: wave.title,
      time: wave.time,
      startedAt: wave.startedAt,
      athletes: wave.athletes.flatMap((athlete) => {
        const run = runByAthlete.get(athlete.id);
        if (!run) return [];
        const ruleset = rulesetById.get(run.ruleset_id);
        const stages = ruleset ? courseStagesOf(ruleset, run.division_id ?? athlete.divisionId) : [];
        const stage = stages.find((item) => item.kind === 'wall_ball' && item.type === 'station');
        const attempt = attempts.find((row) => row.run_id === run.id && (!stage || row.station_id === stage.id)) ?? null;
        const progress = (attempt?.progress || {}) as { validReps?: unknown; targetReps?: unknown; abandoned?: unknown };
        return [{
          athleteId: athlete.id,
          name: athlete.name,
          box: athlete.box,
          divisionName: athlete.divisionName,
          team: teamDivisions.has(run.division_id ?? athlete.divisionId),
          runStatus: run.status,
          stationId: stage?.id ?? null,
          // Story 1.101, AC8: a liberação desta estação fecha o tempo (última do percurso) ou o atleta segue.
          closesTime: Boolean(stage) && lastRaceStation(stages)?.id === stage?.id,
          attempt: attempt ? {
            id: attempt.id,
            status: attempt.status,
            judgeUserId: attempt.judge_user_id,
            judgeName: attempt.judge_name,
            validReps: typeof progress.validReps === 'number' ? progress.validReps : 0,
            targetReps: typeof progress.targetReps === 'number' ? progress.targetReps : stage?.reps ?? null,
            abandoned: progress.abandoned === true
          } : null
        }];
      })
    }))
    .filter((wave) => wave.athletes.length > 0);
  return { event: { id: event.id, name: event.name ?? '', timeZone: event.time_zone || RACE_DEFAULT_TIME_ZONE }, waves };
};

// ---------------------------------------------------------------------------
// Estações para o judge (Story 1.102)
// ---------------------------------------------------------------------------

/** Estação de uma categoria na lista `view=stations` (AC3). */
export type RaceStationDivision = {
  divisionId: string;
  divisionName: string;
  stationId: string;
  kind: RaceStationKind;
  expectedUnits: number | null;
  reps: number | null;
  distance: string | null;
  maleWeight: string | null;
  femaleWeight: string | null;
  /** A estação é a última do percurso desta categoria e fecha o tempo (Story 1.101, D34; 1 atleta por judge, D39). */
  closesTime: boolean;
};

export type RaceEventStation = {
  key: string;
  name: string;
  kind: RaceStationKind;
  /** Fecha o tempo em ao menos uma categoria. */
  closesTime: boolean;
  divisions: RaceStationDivision[];
};

/**
 * Estações do evento para o judge escolher onde está (AC3; D3: a súmula
 * funciona onde houver judge): a mesma estação física das categorias agrupada
 * pela chave (raceStationKeysOf), na ordem do percurso, com o tipo, a meta, a
 * carga e se fecha o tempo em cada categoria. Lê o snapshot do regulamento
 * vigente (D6) e, antes da primeira largada, o percurso atual das categorias.
 */
export const readRaceStations = async (supabaseAdmin: SupabaseClient, eventId: string) => {
  const event = await readRaceEventSchedule(supabaseAdmin, eventId);
  const [ruleset, divisionsResult] = await Promise.all([
    readCurrentRaceRuleset(supabaseAdmin, eventId),
    supabaseAdmin.from('divisions').select('id, name').eq('event_id', eventId)
  ]);
  const divisions = ((check(divisionsResult) || []) as { id: string; name?: string }[]);
  // Igual à escala e à cobertura: o snapshot só vale depois de travado (primeira
  // largada); antes disso a lista acompanha o percurso que o organizador editou.
  const course = ruleset?.locked_at ? ruleset.course : await buildRaceCourseSnapshot(supabaseAdmin, eventId);
  return { event: { id: event.id, name: event.name ?? '', timeZone: event.time_zone || RACE_DEFAULT_TIME_ZONE }, stations: groupRaceEventStations(divisions, course) };
};

/**
 * Estações do evento agrupadas pela chave (raceStationKeysOf), na ordem do
 * percurso, a partir de um snapshot do percurso por categoria (Story 1.102,
 * AC3). A escala de judges (Story 1.104) usa o mesmo agrupamento.
 */
export const groupRaceEventStations = (divisions: readonly { id: string; name?: string }[], course: unknown): RaceEventStation[] => {
  const holder = { course } as RaceRulesetRow;
  const byKey = new Map<string, RaceEventStation & { position: number }>();
  for (const division of divisions) {
    const stages = courseStagesOf(holder, division.id);
    const keys = raceStationKeysOf(stages);
    const closingId = lastRaceStation(stages)?.id ?? null;
    stages.filter((stage) => stage.type === 'station').forEach((stage, position) => {
      const key = keys.get(stage.id);
      if (!key) return;
      const entry = byKey.get(key) ?? { key, name: stage.name, kind: stage.kind, closesTime: false, divisions: [], position };
      entry.position = Math.min(entry.position, position);
      const closesTime = closingId === stage.id;
      entry.closesTime = entry.closesTime || closesTime;
      entry.divisions.push({
        divisionId: division.id,
        divisionName: division.name ?? '',
        stationId: stage.id,
        kind: stage.kind,
        expectedUnits: stage.expectedUnits ?? null,
        reps: stage.reps ?? null,
        distance: stage.distance ?? null,
        maleWeight: stage.maleWeight ?? null,
        femaleWeight: stage.femaleWeight ?? null,
        closesTime
      });
      byKey.set(key, entry);
    });
  }
  return [...byKey.values()]
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'pt-BR'))
    .map((entry) => ({ key: entry.key, name: entry.name, kind: entry.kind, closesTime: entry.closesTime, divisions: entry.divisions }));
};

/**
 * Lista da onda de uma estação (AC3): as ondas que largaram e, de cada uma, os
 * atletas com corrida cujo percurso contém a estação (pela chave), com nome,
 * box, categoria, dupla, estado da corrida, a estação da categoria (id, tipo,
 * meta, se fecha o tempo) e a tentativa, se houver (árbitro, trechos,
 * estado). Sem e-mail. Chave fora do percurso do evento: 404.
 */
export const readRaceStationBoard = async (supabaseAdmin: SupabaseClient, eventId: string, stationKey: unknown) => {
  if (!isRaceStationKey(stationKey)) throw new RaceSheetError('Informe a estação.', 400);
  const { stations } = await readRaceStations(supabaseAdmin, eventId);
  const station = stations.find((item) => item.key === stationKey);
  if (!station) throw new RaceSheetError('Esta estação não está no percurso do evento.', 404);
  const { event, athletes, markMap, runByAthlete, attempts, rulesetById, teamDivisions } = await readRaceBoardSources(supabaseAdmin, eventId);

  const waves = buildRaceWaves(event.event_schedule, athletes, markMap, new Map())
    .filter((wave) => wave.startedAt)
    .map((wave) => ({
      id: wave.id,
      title: wave.title,
      time: wave.time,
      startedAt: wave.startedAt,
      athletes: wave.athletes.flatMap((athlete) => {
        const run = runByAthlete.get(athlete.id);
        if (!run) return [];
        const ruleset = rulesetById.get(run.ruleset_id);
        const stages = ruleset ? courseStagesOf(ruleset, run.division_id ?? athlete.divisionId) : [];
        const keys = raceStationKeysOf(stages);
        const stage = stages.find((item) => item.type === 'station' && keys.get(item.id) === stationKey);
        if (!stage) return [];
        const attempt = attempts.find((row) => row.run_id === run.id && row.station_id === stage.id) ?? null;
        const progress = (attempt?.progress || {}) as { started?: unknown; units?: unknown; expectedUnits?: unknown; missing?: unknown; penaltySeconds?: unknown };
        const numberOr = (value: unknown, fallback: number | null) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
        return [{
          athleteId: athlete.id,
          name: athlete.name,
          box: athlete.box,
          divisionName: athlete.divisionName,
          team: teamDivisions.has(run.division_id ?? athlete.divisionId),
          runStatus: run.status,
          stationId: stage.id,
          kind: stage.kind,
          expectedUnits: stage.expectedUnits ?? null,
          closesTime: lastRaceStation(stages)?.id === stage.id,
          attempt: attempt ? {
            id: attempt.id,
            status: attempt.status,
            judgeUserId: attempt.judge_user_id,
            judgeName: attempt.judge_name,
            started: progress.started === true,
            units: numberOr(progress.units, 0) as number,
            expectedUnits: numberOr(progress.expectedUnits, stage.expectedUnits ?? null),
            missing: numberOr(progress.missing, 0) as number,
            penaltySeconds: numberOr(progress.penaltySeconds, 0) as number
          } : null
        }];
      })
    }))
    .filter((wave) => wave.athletes.length > 0);
  return {
    event: { id: event.id, name: event.name ?? '', timeZone: event.time_zone || RACE_DEFAULT_TIME_ZONE },
    station: { key: station.key, name: station.name, kind: station.kind, closesTime: station.closesTime },
    waves
  };
};
