import type { SupabaseClient } from '@supabase/supabase-js';

import { sanitizeNamePII } from '@/lib/bootstrapPayload';
import type { BroadcastMode } from '@/lib/broadcastMode';
import { sortDivisions } from '@/lib/divisionOrder';
import { computeDivisionStandings } from '@/lib/leaderboardStandings';
import {
  buildRaceCourse,
  computeRaceBroadcast,
  computeRaceWaveStates,
  nextRaceWave,
  raceDivisionPositionAt,
  raceRankingEntries,
  resolveRaceScreen,
  type RaceBroadcastAttempt,
  type RaceBroadcastCoverage,
  type RaceBroadcastInput,
  type RaceBroadcastPenalty,
  type RaceBroadcastResult,
  type RaceBroadcastRun,
  type RaceBroadcastStage,
  type RaceBroadcastView
} from '@/lib/raceBroadcast';
import type {
  RaceArrivalView,
  RaceBroadcastPayload,
  RaceClassDivisionView,
  RaceClassPayload,
  RaceClassRowView,
  RaceGridPayload,
  RaceLivePayload,
  RaceStageView,
  RaceTickerEvent,
  RaceWaveBrief
} from '@/lib/raceBroadcastPayload';
import { toRaceConferenceKind } from '@/lib/raceCourseStructure';
import { RACE_NO_RESULT_VALUE, raceOfficialScore } from '@/lib/raceOfficialScore';
import { describeStationMeta } from '@/lib/raceStation';
import { RACE_DEFAULT_TIME_ZONE, formatRaceClock, raceWaveTitle, readRaceHeatItems } from '@/lib/raceWaves';
import {
  APP_VERSION,
  BroadcastError,
  SHEET_PAGE_SIZE,
  fingerprint,
  isMissingBroadcastSchema,
  readAllPages,
  readBroadcastConfig,
  readBroadcastEvent,
  type BroadcastConfig,
  type BroadcastEventRow
} from '@/lib/serverBroadcast';
import {
  RACE_SHEETS_MIGRATION,
  courseStagesOf,
  isMissingRaceSchema,
  toRaceSnapshotStages,
  type RaceRulesetRow,
  type RaceSnapshotStage
} from '@/lib/serverRaceSheets';
import { deriveOpaqueId } from '@/lib/serverSecurity';
import { getTeamDisplayName } from '@/lib/teamDisplay';
import type { Athlete, Score, Workout } from '@/types';

// Leitura do telão do Fitness Race (Story 1.112): lê só o que a súmula Race já
// grava, monta a entrada do motor (raceBroadcast.ts, Story 1.111) e devolve o
// payload que as telas das Stories 1.113 a 1.115 consomem. Só leitura.
//
// Em fases, com as consultas de cada fase em paralelo:
//   1. categorias, largadas e regulamentos (e a prova TOTAL de cada categoria);
//   2. corridas das ondas largadas, resultados publicados, elegibilidade e
//      atletas; e, para as corridas em DNF, o instante da decisão;
//   3. cartões e penalidades vigentes do que vai ao ar: na torre da categoria
//      (ranking único, Story 1.117), as corridas de todas as ondas largadas das
//      categorias no ar, porque quem já terminou é a referência em cada ponto, e
//      a escala de judges (checagem de certeza do R1); na torre de uma onda
//      fixada, só as corridas dela.
// A fase 3 só sabe o que vai ao ar depois de um primeiro passe do motor sem
// cartões (a escolha da tela e as ondas na pista dependem só das corridas, dos
// resultados e das largadas, não dos cartões).
//
// Toda leitura que pode passar de 1000 linhas (o corte silencioso do PostgREST)
// é paginada por uma ordem estável (`readAllPages`). Não usa `readRaceBoardSources`
// (serverRaceSheets.ts), que lê as tentativas do evento todo sem paginar (achado
// MEDIUM do gate da Story 1.105).
//
// O payload não leva dado pessoal nem o motivo de penalidade (README do telão,
// Regra 7 e D2): nome sanitizado e box, equipe pelo nome da equipe, chave opaca
// por atleta no lugar do id. As consultas escolhem colunas explícitas.

const UNAVAILABLE_MESSAGE = `O telão do Fitness Race ainda não está disponível neste ambiente. Aplique a migration ${RACE_SHEETS_MIGRATION} antes de usar.`;

/** Tabela ausente (migration da súmula Race pendente) vira 503 com a migration citada, nunca 500. */
const check = (result: { data: unknown; error: unknown }) => {
  if (result.error) {
    if (isMissingRaceSchema(result.error) || isMissingBroadcastSchema(result.error)) throw new BroadcastError(UNAVAILABLE_MESSAGE, 503);
    throw result.error;
  }
  return result.data;
};

/** Ids por consulta `in(...)`: acima disso a URL do PostgREST estoura. */
const IDS_PER_QUERY = 100;
/** Quantos eventos a faixa da direção de prova leva por categoria no ar (o cliente mostra o mais novo da torre no ar). */
const TICKER_MAX = 6;
/** Quantos recordes batidos o payload ao vivo leva (o cliente destaca o mais novo). */
const RECORDS_MAX = 12;
/** Próximas ondas na tela de espera. */
const UPCOMING_MAX = 4;

type PlainObject = Record<string, unknown>;
const isPlainObject = (value: unknown): value is PlainObject => value !== null && typeof value === 'object' && !Array.isArray(value);

const numberOrNull = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const chunk = <T>(items: readonly T[], size: number): T[][] => {
  const parts: T[][] = [];
  for (let index = 0; index < items.length; index += size) parts.push(items.slice(index, index + size));
  return parts;
};

const timeMs = (iso: string | null | undefined) => {
  const parsed = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

// ---------------------------------------------------------------------------
// Linhas lidas (colunas explícitas)
// ---------------------------------------------------------------------------

type DivisionRow = { id: string; name: string | null; order_index: number | null; category: string | null };
type MarkRow = { heat_id: string; started_at: string };
type RulesetRow = { id: string; version: number; course: unknown; locked_at: string | null };
type WorkoutRow = { id: string; division_id: string | null; code: string | null };
type RunRow = {
  id: string;
  division_id: string | null;
  athlete_id: string;
  heat_id: string | null;
  ruleset_id: string;
  status: string;
  started_at: string | null;
  finish_at: string | null;
  official_seconds: number | string | null;
  time_source: 'sheet' | 'manual' | null;
};
type ScoreRow = { athlete_id: string; workout_id: string; result: string | null; value: number | string | null; splits: Record<string, string> | null; result_status: string | null };
type EntryRow = { athlete_id: string; division_id: string };
type AthleteRow = { id: string; name: string | null; box: string | null; division_id: string; is_team: boolean | null };
type DecisionRow = { run_id: string | null; created_at: string };
type AttemptRow = {
  run_id: string;
  athlete_id: string;
  station_id: string;
  status: string;
  progress: unknown;
  started_at: string | null;
  ended_at: string | null;
};
type PenaltyRow = { run_id: string; station_id: string | null; seconds: number | string; created_at: string };
type AssignmentRow = { station_key: string; heat_id: string | null };

const RUN_COLUMNS = 'id, division_id, athlete_id, heat_id, ruleset_id, status, started_at, finish_at, official_seconds, time_source';
const ATTEMPT_COLUMNS = 'run_id, athlete_id, station_id, status, progress, started_at, ended_at';

export type RaceBroadcastReadOptions = {
  /** Relógio do servidor (para teste); o padrão é agora. */
  nowMs?: number;
  /** Linhas por página (para teste); o padrão é o corte do PostgREST. */
  pageSize?: number;
};

// ---------------------------------------------------------------------------
// Percurso
// ---------------------------------------------------------------------------

const toEngineStages = (stages: readonly RaceSnapshotStage[]): RaceBroadcastStage[] => stages.map((stage) => ({
  id: stage.id,
  name: stage.name,
  type: stage.type,
  orderIndex: stage.orderIndex,
  ...(stage.distance ? { distance: stage.distance } : {}),
  ...(stage.reps ? { reps: stage.reps } : {}),
  ...(stage.type === 'station'
    ? { conferenceKind: toRaceConferenceKind(stage.kind), ...(stage.expectedUnits !== undefined ? { units: stage.expectedUnits } : {}) }
    : {})
}));

/** Meta e carga da etapa como o telão mostra: "4 trechos · 50m", "100 reps", "1000m"; carga pela categoria. */
const describeStage = (stage: RaceSnapshotStage, category: string | null) => {
  if (stage.type === 'run') return { target: stage.distance ?? '', load: '' };
  const meta = describeStationMeta({
    kind: stage.kind,
    expectedUnits: stage.expectedUnits ?? null,
    distance: stage.distance ?? null,
    maleWeight: stage.maleWeight ?? null,
    femaleWeight: stage.femaleWeight ?? null
  }, category);
  const reps = stage.kind === 'wall_ball' && stage.reps ? `${stage.reps} reps` : '';
  return { target: [meta.target, reps].filter(Boolean).join(' · '), load: meta.load };
};

// ---------------------------------------------------------------------------
// Leitura e montagem
// ---------------------------------------------------------------------------

const displayName = (row: AthleteRow | undefined) => (
  row ? getTeamDisplayName({ name: sanitizeNamePII(row.name ?? ''), isTeam: Boolean(row.is_team) }) || 'Atleta' : 'Atleta'
);

const byPlannedStart = (a: { date: string; time: string; heatNumber: number | null }, b: { date: string; time: string; heatNumber: number | null }) => (
  a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || (a.heatNumber ?? 0) - (b.heatNumber ?? 0)
);

export const buildRaceBroadcastState = async (
  supabaseAdmin: SupabaseClient,
  eventRow: BroadcastEventRow,
  config: BroadcastConfig,
  options: RaceBroadcastReadOptions = {}
): Promise<RaceBroadcastPayload> => {
  const nowMs = options.nowMs ?? Date.now();
  const pageSize = options.pageSize ?? SHEET_PAGE_SIZE;
  const eventId = eventRow.id;
  const timeZone = eventRow.time_zone || RACE_DEFAULT_TIME_ZONE;
  const clock = (iso: string | null | undefined) => (iso ? formatRaceClock(iso, timeZone) : '');
  const pages = <T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>) => readAllPages<T>(fetchPage, pageSize, check);

  // Fase 1: categorias, largadas e regulamentos (e a prova TOTAL de cada categoria).
  const [divisionResult, markResult, rulesetResult, workoutResult] = await Promise.all([
    supabaseAdmin.from('divisions').select('id, name, order_index, category').eq('event_id', eventId),
    supabaseAdmin.from('race_heat_marks').select('heat_id, started_at').eq('event_id', eventId),
    supabaseAdmin.from('race_rulesets').select('id, version, course, locked_at').eq('event_id', eventId),
    supabaseAdmin.from('workouts').select('id, division_id, code').eq('event_id', eventId).eq('code', 'TOTAL')
  ]);
  const divisionRows = (check(divisionResult) || []) as DivisionRow[];
  const marks = (check(markResult) || []) as MarkRow[];
  const rulesets = (check(rulesetResult) || []) as RulesetRow[];
  const totalWorkouts = (check(workoutResult) || []) as WorkoutRow[];

  const divisions = sortDivisions(divisionRows.map((row) => ({ id: row.id, name: row.name ?? '', orderIndex: row.order_index, category: row.category })));
  const divisionById = new Map(divisions.map((division) => [division.id, division]));
  const startedHeatIds = marks.map((mark) => mark.heat_id);
  const divisionIds = divisions.map((division) => division.id);
  const workoutIds = totalWorkouts.map((workout) => workout.id);

  // Fase 2: corridas das ondas largadas, resultados publicados, elegibilidade e atletas.
  const [runRows, scoreRows, entryRows, athleteRows] = await Promise.all([
    startedHeatIds.length === 0
      ? Promise.resolve([] as RunRow[])
      : pages<RunRow>((from, to) => supabaseAdmin
        .from('race_runs')
        .select(RUN_COLUMNS)
        .eq('event_id', eventId)
        .in('heat_id', startedHeatIds)
        .neq('status', 'cancelled')
        .order('id', { ascending: true })
        .range(from, to)),
    workoutIds.length === 0
      ? Promise.resolve([] as ScoreRow[])
      : pages<ScoreRow>((from, to) => supabaseAdmin
        .from('scores')
        .select('athlete_id, workout_id, result, value, splits, result_status')
        .in('workout_id', workoutIds)
        .order('workout_id', { ascending: true })
        .order('athlete_id', { ascending: true })
        .range(from, to)),
    pages<EntryRow>((from, to) => supabaseAdmin
      .from('leaderboard_entries')
      .select('athlete_id, division_id')
      .eq('event_id', eventId)
      .order('id', { ascending: true })
      .range(from, to)),
    divisionIds.length === 0
      ? Promise.resolve([] as AthleteRow[])
      : pages<AthleteRow>((from, to) => supabaseAdmin
        .from('athletes')
        .select('id, name, box, division_id, is_team')
        .in('division_id', divisionIds)
        .order('id', { ascending: true })
        .range(from, to))
  ]);

  // Instante da decisão de DNF, só das corridas em DNF (a linha da corrida muda em qualquer ajuste posterior).
  const dnfRunIds = runRows.filter((run) => run.status === 'dnf').map((run) => run.id);
  const hasSnapshot = (divisionId: string) => rulesets.some((ruleset) => courseStagesOf(ruleset as unknown as RaceRulesetRow, divisionId).length > 0);
  const layoutDivisionIds = divisionIds.filter((id) => !hasSnapshot(id));
  const [decisionParts, layoutResult] = await Promise.all([
    Promise.all(chunk(dnfRunIds, IDS_PER_QUERY).map((ids) => pages<DecisionRow>((from, to) => supabaseAdmin
      .from('race_decisions')
      .select('run_id, created_at')
      .eq('action', 'mark_dnf')
      .in('run_id', ids)
      .order('id', { ascending: true })
      .range(from, to)))),
    layoutDivisionIds.length === 0
      ? Promise.resolve(null)
      : supabaseAdmin.from('divisions').select('id, course_layout').in('id', layoutDivisionIds)
  ]);
  const dnfAtByRun = new Map<string, string>();
  for (const decision of decisionParts.flat()) {
    if (!decision.run_id) continue;
    const current = dnfAtByRun.get(decision.run_id);
    if (!current || (timeMs(decision.created_at) ?? 0) > (timeMs(current) ?? 0)) dnfAtByRun.set(decision.run_id, decision.created_at);
  }
  const layouts = new Map(((layoutResult ? check(layoutResult) : []) as { id: string; course_layout: unknown }[]).map((row) => [row.id, row.course_layout]));

  // Percurso de cada categoria: o snapshot do regulamento das corridas dela (a maior versão), o do regulamento
  // mais novo com percurso e, antes da primeira largada, o percurso atual da categoria.
  const rulesetById = new Map(rulesets.map((ruleset) => [ruleset.id, ruleset]));
  const newestRulesets = [...rulesets].sort((a, b) => b.version - a.version);
  const courseOf = (divisionId: string): RaceSnapshotStage[] => {
    const used = runRows
      .filter((run) => run.division_id === divisionId)
      .map((run) => rulesetById.get(run.ruleset_id))
      .filter((ruleset): ruleset is RulesetRow => Boolean(ruleset))
      .sort((a, b) => b.version - a.version);
    for (const ruleset of [...used, ...newestRulesets]) {
      const stages = courseStagesOf(ruleset as unknown as RaceRulesetRow, divisionId);
      if (stages.length > 0) return stages;
    }
    return toRaceSnapshotStages(layouts.get(divisionId));
  };
  const snapshotCourses = new Map(divisions.map((division) => [division.id, courseOf(division.id)]));
  const engineCourses = new Map(divisions.map((division) => [division.id, toEngineStages(snapshotCourses.get(division.id) ?? [])]));

  // Chaves opacas: o id do atleta nunca sai no payload.
  const keyCache = new Map<string, string>();
  const athleteKeyOf = (id: string) => {
    let key = keyCache.get(id);
    if (!key) {
      key = deriveOpaqueId(id, 'telao-athlete');
      keyCache.set(id, key);
    }
    return key;
  };
  const athleteById = new Map(athleteRows.map((row) => [row.id, row]));

  // Elegibilidade: a mesma do leaderboard do site (leaderboard_entries); vale para a classificação e os resultados.
  const eligible = new Set(entryRows.map((entry) => `${entry.division_id}|${entry.athlete_id}`));
  const isEligible = (athlete: AthleteRow) => eligible.has(`${athlete.division_id}|${athlete.id}`);
  const workoutDivision = new Map(totalWorkouts.map((workout) => [workout.id, workout.division_id]));

  // Resultados publicados da prova TOTAL da categoria (de atletas elegíveis).
  const publishedRows = scoreRows.filter((row) => {
    const athlete = athleteById.get(row.athlete_id);
    if (!athlete || !isEligible(athlete) || workoutDivision.get(row.workout_id) !== athlete.division_id) return false;
    return row.result !== null && row.result !== '-' && row.result !== '';
  });
  const finishAtByAthlete = new Map(runRows.filter((run) => run.status === 'finished' && run.finish_at).map((run) => [run.athlete_id, run.finish_at as string]));

  // Classificação: a mesma regra do leaderboard do site (prova TOTAL por categoria), com a elegibilidade acima.
  const standingWorkouts: Workout[] = totalWorkouts.map((workout) => ({
    id: workout.id,
    name: 'Percurso Completo',
    description: '',
    type: 'fortime',
    code: 'TOTAL',
    orderIndex: 1,
    divisionId: workout.division_id ?? undefined
  }));
  type StandingRow = { athleteId: string; position: number | null; finalSeconds: number | null; dnf: boolean };
  const standingsByDivision = new Map<string, StandingRow[]>();
  for (const division of divisions) {
    const divisionWorkoutIds = new Set(totalWorkouts.filter((workout) => workout.division_id === division.id).map((workout) => workout.id));
    const divisionAthletes: Athlete[] = athleteRows
      .filter((athlete) => athlete.division_id === division.id && isEligible(athlete))
      .map((athlete) => ({ id: athlete.id, name: displayName(athlete), box: athlete.box ?? '', country: '', divisionId: division.id }));
    const divisionScores: Score[] = publishedRows
      .filter((row) => divisionWorkoutIds.has(row.workout_id))
      .map((row) => ({
        athleteId: row.athlete_id,
        workoutId: row.workout_id,
        result: row.result ?? '',
        value: numberOrNull(row.value) ?? RACE_NO_RESULT_VALUE,
        splits: row.splits || {},
        resultStatus: (row.result_status || undefined) as Score['resultStatus']
      }));
    const published = new Set(divisionScores.map((score) => score.athleteId));
    const items = computeDivisionStandings({
      event: { date: eventRow.date ?? '', eventType: 'fitness_racing', workouts: standingWorkouts },
      divisionId: division.id,
      divisionAthletes,
      scores: divisionScores,
      nowMs
    });
    standingsByDivision.set(division.id, items
      .filter((item) => published.has(item.athlete.id))
      .map((item) => {
        const value = numberOrNull(item.totalPoints);
        const hasTime = item.rank > 0 && value !== null && value < RACE_NO_RESULT_VALUE;
        return { athleteId: item.athlete.id, position: hasTime ? item.rank : null, finalSeconds: hasTime ? Math.round(value) : null, dnf: !hasTime };
      }));
  }

  // Cronograma: as ondas na ordem de largada prevista, com a largada marcada pelo gestor.
  const heatItems = readRaceHeatItems(eventRow.event_schedule).sort(byPlannedStart);
  const startedAtByHeat = new Map(marks.map((mark) => [mark.heat_id, mark.started_at]));

  const engineRuns: RaceBroadcastRun[] = runRows.map((run) => ({
    athleteKey: athleteKeyOf(run.athlete_id),
    waveKey: run.heat_id,
    status: run.status,
    officialSeconds: numberOrNull(run.official_seconds),
    timeSource: run.time_source,
    finishAt: run.finish_at,
    dnfAt: dnfAtByRun.get(run.id) ?? null,
    startedAt: run.started_at
  }));
  const engineResults: RaceBroadcastResult[] = publishedRows.map((row) => {
    const athlete = athleteById.get(row.athlete_id) as AthleteRow;
    return {
      athleteKey: athleteKeyOf(athlete.id),
      divisionKey: athlete.division_id,
      value: numberOrNull(row.value) ?? RACE_NO_RESULT_VALUE,
      resultStatus: row.result_status,
      splits: isPlainObject(row.splits) ? (row.splits as Record<string, string>) : {},
      at: finishAtByAthlete.get(athlete.id) ?? null
    };
  });
  const baseInput: RaceBroadcastInput = {
    divisions: divisions.map((division) => ({ key: division.id, name: division.name, orderIndex: division.orderIndex, stages: engineCourses.get(division.id) ?? [] })),
    athletes: athleteRows.map((row) => ({ key: athleteKeyOf(row.id), name: displayName(row), box: row.box ?? '', divisionKey: row.division_id })),
    waves: heatItems.map((item) => ({
      key: item.id,
      title: raceWaveTitle(item),
      date: item.date,
      time: item.time,
      heatNumber: item.heatNumber,
      athleteKeys: item.athleteIds.map(athleteKeyOf),
      startedAt: startedAtByHeat.get(item.id) ?? null
    })),
    runs: engineRuns,
    attempts: [],
    penalties: [],
    results: engineResults,
    nowMs
  };

  const view: RaceBroadcastView = {
    mode: config.mode,
    pinnedWaveKey: config.pinned_heat_id,
    pinnedDivisionKey: config.pinned_division_id,
    standings: divisions.map((division) => ({ divisionKey: division.id, rows: standingsByDivision.get(division.id)?.length ?? 0 }))
  };

  // Primeiro passe (sem cartões): o que vai ao ar. Os cartões não mudam a escolha da tela nem as ondas na pista.
  const waveStates = computeRaceWaveStates(baseInput);
  const firstPass = resolveRaceScreen({ ...view, waves: waveStates });
  const divisionScope = firstPass.screen === 'live' && firstPass.scope === 'division';
  const liveWaveKeys = firstPass.screen === 'live' ? firstPass.waveKeys : [];
  const liveDivisionIds = new Set(divisionScope && firstPass.screen === 'live' ? firstPass.divisionKeys : []);

  // Fase 3: cartões e penalidades vigentes do que vai ao ar. Torre da categoria: as corridas de todas as ondas
  // largadas das categorias no ar (`runRows` já são só das ondas largadas) e a escala de judges. Torre de uma onda: as dela.
  const liveRuns = divisionScope
    ? runRows.filter((run) => run.division_id !== null && liveDivisionIds.has(run.division_id))
    : runRows.filter((run) => run.heat_id !== null && liveWaveKeys.includes(run.heat_id));
  const liveRunIds = liveRuns.map((run) => run.id);
  const [attemptParts, penaltyParts, assignmentRows] = await Promise.all([
    Promise.all(chunk(liveRunIds, IDS_PER_QUERY).map((ids) => pages<AttemptRow>((from, to) => supabaseAdmin
      .from('race_attempts')
      .select(ATTEMPT_COLUMNS)
      .in('run_id', ids)
      .neq('status', 'cancelled')
      .order('id', { ascending: true })
      .range(from, to)))),
    Promise.all(chunk(liveRunIds, IDS_PER_QUERY).map((ids) => pages<PenaltyRow>((from, to) => supabaseAdmin
      .from('race_infractions')
      .select('run_id, station_id, seconds, created_at')
      .in('run_id', ids)
      .eq('kind', 'penalty')
      .eq('status', 'confirmed')
      .order('id', { ascending: true })
      .range(from, to)))),
    divisionScope
      ? pages<AssignmentRow>((from, to) => supabaseAdmin
        .from('race_judge_assignments')
        .select('station_key, heat_id')
        .eq('event_id', eventId)
        .order('id', { ascending: true })
        .range(from, to))
      : Promise.resolve([] as AssignmentRow[])
  ]);
  const coverage: RaceBroadcastCoverage[] = assignmentRows.map((row) => ({ stationKey: row.station_key, waveKey: row.heat_id ?? null }));
  const runAthleteKey = new Map(liveRuns.map((run) => [run.id, athleteKeyOf(run.athlete_id)]));
  const attempts: RaceBroadcastAttempt[] = attemptParts.flat().map((row) => {
    const progress = isPlainObject(row.progress) ? row.progress : {};
    return {
      athleteKey: athleteKeyOf(row.athlete_id),
      stationId: row.station_id,
      status: row.status,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      units: numberOrNull(progress.units),
      expectedUnits: numberOrNull(progress.expectedUnits),
      validReps: numberOrNull(progress.validReps),
      targetReps: numberOrNull(progress.targetReps)
    };
  });
  const penalties: RaceBroadcastPenalty[] = penaltyParts.flat()
    .filter((row) => runAthleteKey.has(row.run_id) && (numberOrNull(row.seconds) ?? 0) > 0)
    .map((row) => ({
      athleteKey: runAthleteKey.get(row.run_id) as string,
      seconds: numberOrNull(row.seconds) as number,
      stationId: row.station_id,
      at: row.created_at
    }));

  const fullInput: RaceBroadcastInput = { ...baseInput, attempts, penalties, coverage };
  const out = computeRaceBroadcast(fullInput, view);

  // -------------------------------------------------------------------------
  // Payload
  // -------------------------------------------------------------------------

  const stageMeta = new Map<string, Map<string, { target: string; load: string }>>();
  for (const division of divisions) {
    stageMeta.set(division.id, new Map((snapshotCourses.get(division.id) ?? []).map((stage) => [stage.id, describeStage(stage, division.category)])));
  }
  const stageNameOf = (divisionKey: string, stageId: string | null) => (
    (stageId && (snapshotCourses.get(divisionKey) ?? []).find((stage) => stage.id === stageId)?.name) || ''
  );
  const staticStages = (divisionKey: string): RaceStageView[] => buildRaceCourse(engineCourses.get(divisionKey) ?? []).stages.map((stage) => ({
    id: stage.id,
    key: stage.key,
    name: stage.name,
    type: stage.type,
    kind: stage.kind,
    target: stageMeta.get(divisionKey)?.get(stage.id)?.target ?? '',
    load: stageMeta.get(divisionKey)?.get(stage.id)?.load ?? '',
    closesTime: stage.closesTime,
    semJudge: false
  }));

  const stateByKey = new Map(out.waves.map((wave) => [wave.key, wave]));
  const heatByKey = new Map(heatItems.map((item) => [item.id, item]));
  const brief = (waveKey: string): RaceWaveBrief | null => {
    const item = heatByKey.get(waveKey);
    const state = stateByKey.get(waveKey);
    if (!item || !state) return null;
    return {
      key: item.id,
      title: raceWaveTitle(item),
      heatNumber: item.heatNumber,
      date: item.date,
      time: item.time,
      divisionNames: state.divisionKeys.map((key) => divisionById.get(key)?.name ?? '').filter(Boolean),
      athleteCount: state.athleteCount
    };
  };

  const buildGrid = (waveKey: string): RaceGridPayload | null => {
    const wave = brief(waveKey);
    const item = heatByKey.get(waveKey);
    const state = stateByKey.get(waveKey);
    if (!wave || !item || !state) return null;
    const athletes = [...new Set(item.athleteIds)]
      .map((id) => athleteById.get(id))
      .filter((row): row is AthleteRow => Boolean(row))
      .map((row) => ({ key: athleteKeyOf(row.id), name: displayName(row), box: row.box ?? '', divisionKey: row.division_id, divisionName: divisionById.get(row.division_id)?.name ?? '' }));
    return {
      wave,
      athletes,
      courses: state.divisionKeys.map((key) => ({ divisionKey: key, divisionName: divisionById.get(key)?.name ?? '', stages: staticStages(key) }))
    };
  };

  const waveTitleOfAthlete = new Map<string, string>();
  for (const item of heatItems) for (const id of item.athleteIds) if (!waveTitleOfAthlete.has(id)) waveTitleOfAthlete.set(id, raceWaveTitle(item));
  for (const run of runRows) {
    const item = run.heat_id ? heatByKey.get(run.heat_id) : null;
    if (item) waveTitleOfAthlete.set(run.athlete_id, raceWaveTitle(item));
  }

  const payload: Omit<RaceBroadcastPayload, 'version' | 'serverTime'> = {
    eventType: 'fitness_racing',
    appVersion: APP_VERSION,
    event: { name: eventRow.name ?? '', logoUrl: eventRow.logo_url ?? '', date: eventRow.date ?? '', timeZone },
    mode: config.mode,
    screen: out.resolution.screen,
    next: (() => { const next = nextRaceWave(out.waves); return next ? brief(next.key) : null; })(),
    live: null,
    grid: null,
    class: null,
    standby: null
  };

  if (out.resolution.screen === 'live') {
    const resolution = out.resolution;
    const liveKeys = new Set(resolution.waveKeys);
    const liveDivisionKeys = new Set(out.boards.map((board) => board.divisionKey));
    const penaltyTotals = new Map<string, number>();
    for (const penalty of penalties) penaltyTotals.set(penalty.athleteKey, (penaltyTotals.get(penalty.athleteKey) ?? 0) + penalty.seconds);
    const nameByKey = new Map(baseInput.athletes.map((athlete) => [athlete.key, athlete]));
    const waveOfKey = new Map(runRows.map((run) => [athleteKeyOf(run.athlete_id), run.heat_id]));
    const divisionsOf = (athleteKey: string) => {
      const divisionKey = nameByKey.get(athleteKey)?.divisionKey;
      return divisionKey ? [divisionKey] : [];
    };
    const waveTitleOf = (waveKey: string | null | undefined) => (waveKey && stateByKey.get(waveKey)?.title) || '';

    const arrivals: RaceArrivalView[] = out.arrivals
      .filter((arrival) => arrival.waveKey !== null && liveKeys.has(arrival.waveKey))
      .map((arrival) => ({
        ...arrival,
        finishClock: clock(arrival.finishAt),
        // Posição na categoria até agora: quantos já publicados fecharam mais rápido; a linha dele, se já publicada, não conta.
        position: 1 + (standingsByDivision.get(arrival.divisionKey) ?? []).filter((row) => row.finalSeconds !== null && row.finalSeconds < arrival.finalSeconds).length,
        penaltySeconds: penaltyTotals.get(arrival.athleteKey) ?? 0,
        holds: out.bests
          .filter((best) => best.athleteKey === arrival.athleteKey && best.divisionKey === arrival.divisionKey)
          .map((best) => ({ stationName: best.stationName, seconds: best.seconds }))
      }));

    type TickerItem = RaceTickerEvent & { sortMs: number; athleteKey: string | null };
    const ticker: TickerItem[] = [];
    const pushTicker = (event: Omit<RaceTickerEvent, 'clock' | 'position' | 'point'> & Partial<Pick<RaceTickerEvent, 'point'>>, athleteKey: string | null = null) => {
      const ms = timeMs(event.at);
      if (ms !== null) ticker.push({ position: null, point: null, ...event, clock: clock(event.at), sortMs: ms, athleteKey });
    };
    const empty = { name: null, seconds: null, stationName: null, finalSeconds: null };
    for (const wave of out.waves.filter((item) => liveKeys.has(item.key) && item.startedAt)) {
      pushTicker({ kind: 'start', at: wave.startedAt as string, waveKey: wave.key, waveTitle: wave.title, divisionKeys: wave.divisionKeys, ...empty });
    }
    for (const penalty of penalties) {
      const athlete = nameByKey.get(penalty.athleteKey);
      const waveKey = waveOfKey.get(penalty.athleteKey) ?? null;
      if (!athlete || !penalty.at || !waveKey || !liveKeys.has(waveKey)) continue;
      pushTicker({
        kind: 'penalty',
        at: penalty.at,
        waveKey,
        waveTitle: waveTitleOf(waveKey),
        divisionKeys: [athlete.divisionKey],
        name: athlete.name,
        seconds: penalty.seconds,
        stationName: stageNameOf(athlete.divisionKey, penalty.stationId) || null,
        finalSeconds: null
      });
    }
    for (const run of engineRuns) {
      if (run.status !== 'dnf' || !run.dnfAt || !run.waveKey || !liveKeys.has(run.waveKey)) continue;
      pushTicker({ kind: 'dnf', at: run.dnfAt, waveKey: run.waveKey, waveTitle: waveTitleOf(run.waveKey), divisionKeys: divisionsOf(run.athleteKey), ...empty, name: nameByKey.get(run.athleteKey)?.name ?? null });
    }
    for (const arrival of arrivals) {
      pushTicker({ kind: 'finish', at: arrival.finishAt, waveKey: arrival.waveKey, waveTitle: waveTitleOf(arrival.waveKey), divisionKeys: [arrival.divisionKey], ...empty, name: arrival.name, finalSeconds: arrival.finalSeconds });
    }
    // Entrada no ranking (torre da categoria): a primeira leitura de cada atleta das ondas na pista; a posição é calculada só para os eventos que vão no payload.
    if (resolution.scope === 'division') {
      for (const entry of raceRankingEntries(fullInput, resolution.divisionKeys)) {
        if (!entry.waveKey || !liveKeys.has(entry.waveKey)) continue;
        pushTicker({ kind: 'enter', at: entry.at, waveKey: entry.waveKey, waveTitle: waveTitleOf(entry.waveKey), divisionKeys: [entry.divisionKey], ...empty, name: nameByKey.get(entry.athleteKey)?.name ?? null, point: entry.point }, entry.athleteKey);
      }
    }
    ticker.sort((a, b) => a.sortMs - b.sortMs || a.kind.localeCompare(b.kind));
    // Os últimos de cada categoria no ar (a largada conta para as categorias da onda), sem repetir.
    const kept = new Set<TickerItem>();
    for (const divisionKey of liveDivisionKeys) {
      ticker.filter((event) => event.divisionKeys.includes(divisionKey)).slice(-TICKER_MAX).forEach((event) => kept.add(event));
    }
    const tickerOut = ticker.filter((event) => kept.has(event)).map((event): RaceTickerEvent => ({
      kind: event.kind,
      at: event.at,
      clock: event.clock,
      waveKey: event.waveKey,
      waveTitle: event.waveTitle,
      divisionKeys: event.divisionKeys,
      name: event.name,
      position: event.kind === 'enter' && event.athleteKey && event.divisionKeys[0]
        ? raceDivisionPositionAt(fullInput, event.divisionKeys[0], event.athleteKey, event.sortMs)
        : null,
      point: event.point,
      seconds: event.seconds,
      stationName: event.stationName,
      finalSeconds: event.finalSeconds
    }));

    const live: RaceLivePayload = {
      scope: resolution.scope,
      steps: out.liveSteps,
      waves: out.waves.filter((wave) => liveKeys.has(wave.key) && wave.startedAt).map((wave) => ({
        key: wave.key,
        title: wave.title,
        heatNumber: heatByKey.get(wave.key)?.heatNumber ?? null,
        time: heatByKey.get(wave.key)?.time ?? '',
        startedAt: wave.startedAt as string,
        startedClock: clock(wave.startedAt),
        lastReadingAt: wave.lastReadingAt,
        divisionKeys: wave.divisionKeys,
        athleteCount: wave.athleteCount,
        racingCount: wave.racingCount
      })),
      boards: out.boards.map((board) => ({
        scope: board.scope,
        waveKey: board.waveKey,
        waveTitle: board.waveTitle,
        divisionKey: board.divisionKey,
        divisionName: board.divisionName,
        startedAt: board.startedAt,
        stages: board.stages.map((stage) => ({
          id: stage.id,
          key: stage.key,
          name: stage.name,
          type: stage.type,
          kind: stage.kind,
          target: stageMeta.get(board.divisionKey)?.get(stage.id)?.target ?? '',
          load: stageMeta.get(board.divisionKey)?.get(stage.id)?.load ?? '',
          closesTime: stage.closesTime,
          semJudge: stage.semJudge
        })),
        // O "contando" anda com o relógio: a tela conta pela base; no payload a diferença fica nula, para a `version` só mudar com dado novo.
        rows: board.rows.map((row) => (row.gapCounting ? { ...row, gapSeconds: null } : row)),
        battle: board.battle,
        finalists: board.finalists,
        hasLeaderReading: board.hasLeaderReading
      })),
      bests: out.bests.filter((best) => liveDivisionKeys.has(best.divisionKey)),
      records: out.records.filter((record) => record.at !== null && liveDivisionKeys.has(record.divisionKey)).slice(-RECORDS_MAX),
      arrivals,
      ticker: tickerOut
    };
    payload.live = live;
  }

  if (out.resolution.screen === 'grid') payload.grid = buildGrid(out.resolution.waveKey);

  if (out.resolution.screen === 'class') {
    // A onda que terminou por último: o maior fechamento (ou, sem ele, a largada mais nova).
    const lastState = out.waves
      .filter((wave) => wave.finished)
      .sort((a, b) => (timeMs(b.closedAt ?? b.startedAt) ?? 0) - (timeMs(a.closedAt ?? a.startedAt) ?? 0))[0] ?? null;
    const freshIds = new Set<string>();
    if (lastState) {
      for (const id of heatByKey.get(lastState.key)?.athleteIds ?? []) freshIds.add(id);
      for (const run of runRows) if (run.heat_id === lastState.key) freshIds.add(run.athlete_id);
    }
    const divisionsView: RaceClassDivisionView[] = out.resolution.divisionKeys
      .filter((key) => divisionById.has(key))
      .map((key) => {
        const rows = standingsByDivision.get(key) ?? [];
        const first = rows.find((row) => row.finalSeconds !== null)?.finalSeconds ?? null;
        const classRows: RaceClassRowView[] = rows.map((row) => {
          const athlete = athleteById.get(row.athleteId);
          return {
            key: athleteKeyOf(row.athleteId),
            position: row.position,
            name: displayName(athlete),
            box: athlete?.box ?? '',
            waveTitle: waveTitleOfAthlete.get(row.athleteId) ?? '',
            finalSeconds: row.finalSeconds,
            timeText: row.finalSeconds === null ? null : raceOfficialScore(row.finalSeconds).result,
            gapSeconds: row.finalSeconds !== null && first !== null && row.position !== 1 ? row.finalSeconds - first : null,
            dnf: row.dnf,
            fresh: freshIds.has(row.athleteId)
          };
        });
        return { key, name: divisionById.get(key)?.name ?? '', rows: classRows, bests: out.bests.filter((best) => best.divisionKey === key) };
      });
    const classPayload: RaceClassPayload = {
      steps: out.classSteps,
      divisions: divisionsView,
      lastWave: lastState ? { key: lastState.key, title: lastState.title } : null,
      grid: out.resolution.gridWaveKey ? buildGrid(out.resolution.gridWaveKey) : null
    };
    payload.class = classPayload;
  }

  if (out.resolution.screen === 'standby') {
    const upcoming = out.waves.filter((wave) => !wave.started && wave.athleteCount > 0).slice(0, UPCOMING_MAX);
    payload.standby = { upcoming: upcoming.map((wave) => brief(wave.key)).filter((item): item is RaceWaveBrief => item !== null) };
  }

  // A `version` só muda quando um dado muda: o payload leva instantes absolutos e a hora do servidor fica de fora.
  return { ...payload, version: fingerprint(payload), serverTime: new Date(nowMs).toISOString() };
};

// ---------------------------------------------------------------------------
// Mesa de controle (aba Telão do evento Fitness Race, Story 1.115)
// ---------------------------------------------------------------------------

export type RaceBroadcastControl = {
  /** O link, ativo ou não, sem o token: ele só existe na resposta que o gerou (só o hash fica no banco). */
  link: { active: boolean; createdAt: string | null };
  mode: BroadcastMode;
  pinnedHeatId: string | null;
  pinnedDivisionId: string | null;
  /** As ondas do cronograma na ordem de largada prevista: "Onda 3 · 10:12 · Open Masculino". */
  heats: { id: string; label: string }[];
  divisions: { id: string; name: string }[];
  /** O payload do telão como a TV o recebe agora (Story 1.112). */
  preview: RaceBroadcastPayload;
};

/**
 * O que a mesa do gestor mostra: link (sem o token), modo, a onda e a categoria fixadas, as ondas do
 * cronograma, as categorias e a prévia. Só leitura; a largada nunca passa por aqui (D45): ela é do
 * gesto do gestor na seção Ondas da aba Súmula Fitness Race. A leitura própria existe porque a mesa
 * de Functional Fitness (`readBroadcastControl`) monta a prévia com um estado que recusa Fitness Race.
 */
export const readRaceBroadcastControl = async (
  supabaseAdmin: SupabaseClient,
  eventId: string,
  options: RaceBroadcastReadOptions = {}
): Promise<RaceBroadcastControl> => {
  const eventRow = await readBroadcastEvent(supabaseAdmin, eventId);
  const config = await readBroadcastConfig(supabaseAdmin, eventId);
  const divisionRows = (check(await supabaseAdmin.from('divisions').select('id, name, order_index, category').eq('event_id', eventId)) || []) as DivisionRow[];
  const divisions = sortDivisions(divisionRows.map((row) => ({ id: row.id, name: row.name ?? '', orderIndex: row.order_index, category: row.category })));
  const divisionIds = divisions.map((division) => division.id);
  const athleteRows = divisionIds.length === 0
    ? []
    : await readAllPages<{ id: string; division_id: string }>((from, to) => supabaseAdmin
      .from('athletes')
      .select('id, division_id')
      .in('division_id', divisionIds)
      .order('id', { ascending: true })
      .range(from, to), options.pageSize ?? SHEET_PAGE_SIZE, check);
  const divisionOfAthlete = new Map(athleteRows.map((row) => [row.id, row.division_id]));
  const divisionOrder = new Map(divisions.map((division, index) => [division.id, index]));
  const divisionName = new Map(divisions.map((division) => [division.id, division.name]));

  const heats = readRaceHeatItems(eventRow.event_schedule).sort(byPlannedStart).map((item) => {
    const present = [...new Set(item.athleteIds.map((id) => divisionOfAthlete.get(id)).filter((id): id is string => Boolean(id)))]
      .sort((a, b) => (divisionOrder.get(a) ?? 0) - (divisionOrder.get(b) ?? 0));
    return {
      id: item.id,
      label: [raceWaveTitle(item), item.time, present.map((id) => divisionName.get(id) ?? '').filter(Boolean).join(' e ')].filter(Boolean).join(' · ')
    };
  });

  return {
    link: {
      active: Boolean(config.token_hash && !config.token_revoked_at),
      createdAt: config.token_hash ? config.token_created_at : null
    },
    mode: config.mode,
    pinnedHeatId: config.pinned_heat_id,
    pinnedDivisionId: config.pinned_division_id,
    heats,
    divisions: divisions.map((division) => ({ id: division.id, name: division.name })),
    preview: await buildRaceBroadcastState(supabaseAdmin, eventRow, config, options)
  };
};
