import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import { computeOfficialSeconds, sumConfirmedPenaltySeconds } from '@/lib/raceRules';
import { secondsToTime } from '@/lib/scoring';
import {
  RaceSheetError,
  isMissingRaceSchema,
  type RaceAttemptRow,
  type RaceInfractionRow,
  type RaceRunRow
} from '@/lib/serverRaceSheets';

// Publicação da súmula Fitness Race no leaderboard (Story 1.99, fecha a F1).
// O tempo oficial (bruto da largada da onda até a liberação do Wall Ball, D1,
// mais as penalidades vigentes, D2) vai para `scores`, na prova TOTAL da
// categoria, que `computeDivisionStandings` já lê. Quem chama é só o ponto
// único de republicação (`republishRaceRun`, serverRaceDecisions.ts): o
// fechamento da corrida (Story 1.97), as decisões do organizador (Story 1.98)
// e a correção da largada (Story 1.96, AC7, D14a).
//
// Regras:
// - corrida `finished`: `value` = tempo oficial arredondado UMA vez para o
//   segundo mais próximo (Math.round, meio segundo sobe) e `result` é esse
//   mesmo inteiro formatado (MM:SS ou H:MM:SS); `result_status` nulo, como o
//   envio da súmula de Functional Fitness;
// - `dnf` publica "DNF" com 999999 (o "sem resultado" do leaderboard) e
//   `result_status` próprio (não há DQ: o caso grave é DNF);
// - `racing` (ou `cancelled`) não publica: retira a linha desta corrida e,
//   se ela tinha substituído um resultado manual, devolve o manual (D25);
// - o ranking é só por tempo (`recalculateRaceRanking`), sem pontos: não usa
//   `recalculateWorkoutRanking` nem `rankWorkoutScores` de Functional Fitness.
// `splits` levam a duração de cada estação conferida por id de etapa (Story
// 1.106, D37: estação sem judge fica sem split) e as chaves `race:` das
// penalidades vigentes (motivo e segundos, sem árbitro nem observação).

const UNAVAILABLE_MESSAGE = 'A publicação da súmula Fitness Race ainda não está disponível neste ambiente. Aplique a migration 20261031120000_race_publication.sql antes de usar.';

const check = <T>(result: { data: T; error: unknown }) => {
  if (result.error) {
    if (isMissingRaceSchema(result.error)) throw new RaceSheetError(UNAVAILABLE_MESSAGE, 503);
    throw result.error;
  }
  return result.data;
};

const isDuplicate = (error: unknown) => Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === '23505');
type PlainObject = Record<string, unknown>;
const isPlainObject = (value: unknown): value is PlainObject => value !== null && typeof value === 'object' && !Array.isArray(value);

/** "Sem resultado" do leaderboard de Fitness Race (computeDivisionStandings): fica atrás de todos e sem posição. */
export const RACE_NO_RESULT_VALUE = 999999;
export const RACE_SPLIT_PENALTY_SECONDS_KEY = 'race:penalty_seconds';
export const RACE_SPLIT_PENALTIES_KEY = 'race:penalties';
export const RACE_MANUAL_OVERRIDE_ACTION = 'manual_override';

/** Tempo publicado: arredonda uma vez (segundo mais próximo) e formata o mesmo inteiro. */
export const raceOfficialScore = (officialSeconds: number) => {
  const value = Math.max(0, Math.round(officialSeconds));
  return { value, result: secondsToTime(value) };
};

export const raceTotalWorkoutId = (divisionId: string) => `wod-${divisionId}-total`;

type WorkoutRow = { id: string; event_id: string; division_id: string | null; code: string | null };

/**
 * Garante a prova TOTAL da categoria (AC2), no padrão de
 * buildFitnessRacingDefaults (id `wod-{divisionId}-total`): reaproveita a
 * existente (pelo código TOTAL da categoria) ou cria. Falha = erro claro.
 */
export const ensureRaceTotalWorkout = async (supabaseAdmin: SupabaseClient, eventId: string, divisionId: string) => {
  const find = async () => {
    const rows = (check(await supabaseAdmin.from('workouts').select('id, event_id, division_id, code').eq('division_id', divisionId)) || []) as WorkoutRow[];
    return rows.find((row) => row.code === 'TOTAL' && row.event_id === eventId) ?? null;
  };
  const existing = await find();
  if (existing) return existing.id;
  const inserted = await supabaseAdmin.from('workouts').insert({
    id: raceTotalWorkoutId(divisionId),
    event_id: eventId,
    name: 'Percurso Completo',
    description: 'Tempo oficial total do percurso de Fitness Racing.',
    type: 'fortime',
    code: 'TOTAL',
    order_index: 1,
    division_id: divisionId,
    tie_breaker: ''
  });
  if (inserted.error) {
    // Outra publicação criou no mesmo instante: reaproveita.
    const raced = isDuplicate(inserted.error) ? await find() : null;
    if (raced) return raced.id;
    console.error('Erro ao criar a prova TOTAL do Fitness Race:', inserted.error);
    throw new RaceSheetError('Não foi possível garantir a prova TOTAL da categoria; o resultado não foi publicado.', 500);
  }
  return raceTotalWorkoutId(divisionId);
};

type ScoreRow = {
  athlete_id: string;
  workout_id: string;
  result: string;
  value: number | string;
  rank?: number | null;
  points?: number | null;
  splits?: Record<string, string> | null;
  result_status?: string | null;
  race_run_id?: string | null;
};

const SCORE_COLUMNS = 'athlete_id, workout_id, result, value, rank, points, splits, result_status, race_run_id';
const UNRANKED_STATUSES = new Set(['dnf', 'absent']);

/** Posição só por tempo (1, 1, 3); DNF e sem resultado sem posição; nunca pontos. Pura, para teste. */
export const rankRaceScores = (rows: Pick<ScoreRow, 'athlete_id' | 'value' | 'result_status'>[]) => {
  const valid = rows
    .filter((row) => !UNRANKED_STATUSES.has(String(row.result_status ?? '')) && Number.isFinite(Number(row.value)) && Number(row.value) < RACE_NO_RESULT_VALUE)
    .sort((a, b) => Number(a.value) - Number(b.value));
  const ranks = new Map<string, number>();
  valid.forEach((row, index) => {
    const previous = valid[index - 1];
    ranks.set(row.athlete_id, previous && Number(previous.value) === Number(row.value) ? ranks.get(previous.athlete_id) as number : index + 1);
  });
  return rows.map((row) => ({ athleteId: row.athlete_id, rank: ranks.get(row.athlete_id) ?? null, points: null }));
};

/**
 * Ranking próprio do Race (AC6) na prova TOTAL: grava `rank` por tempo e
 * `points` nulo, só nas linhas que mudaram.
 */
export const recalculateRaceRanking = async (supabaseAdmin: SupabaseClient, workoutId: string) => {
  const rows = (check(await supabaseAdmin.from('scores').select('athlete_id, workout_id, value, rank, points, result_status').eq('workout_id', workoutId)) || []) as ScoreRow[];
  const ranked = rankRaceScores(rows);
  for (const item of ranked) {
    const row = rows.find((score) => score.athlete_id === item.athleteId) as ScoreRow;
    if ((row.rank ?? null) === item.rank && (row.points ?? null) === null) continue;
    check(await supabaseAdmin.from('scores').update({ rank: item.rank, points: null }).eq('athlete_id', item.athleteId).eq('workout_id', workoutId));
  }
  return ranked;
};

const formatStationSeconds = (seconds: number) => secondsToTime(Math.max(0, Math.round(seconds)));

/** Menor duração que vira split (Story 1.106, AC2): abaixo disso, o resultado público mostraria "00:00". */
export const RACE_MIN_SPLIT_SECONDS = 1;

/**
 * Splits públicos (Story 1.99, AC3; Story 1.106, D37): a duração de cada
 * estação conferida, do `start` ao `release` ou `exit` da tentativa (horários
 * já corrigidos pelo desvio do aparelho no recálculo, resolveEventTime), pela
 * chave do id da etapa da categoria (o que o Leaderboard lê), de qualquer
 * tipo e em qualquer posição do percurso. Estação sem judge, sem `start`,
 * sem fim (reps com `abandon`, não liberada) ou com menos de 1 s fica sem
 * chave: nunca "00:00" nem valor inventado. As chaves `race:` levam o total e
 * a lista (motivo e segundos) das penalidades vigentes. Texto dos valores,
 * como os splits do lançamento manual. Sem id de tentativa, árbitro,
 * observação ou quem lançou.
 */
export const buildRaceSplits = (attempts: RaceAttemptRow[], infractions: RaceInfractionRow[]) => {
  const splits: Record<string, string> = {};
  for (const attempt of attempts) {
    if (attempt.status === 'cancelled' || !attempt.station_id || !attempt.started_at || !attempt.ended_at) continue;
    const seconds = (Date.parse(attempt.ended_at) - Date.parse(attempt.started_at)) / 1000;
    if (Number.isFinite(seconds) && seconds >= RACE_MIN_SPLIT_SECONDS) splits[attempt.station_id] = formatStationSeconds(seconds);
  }
  const vigentes = infractions.filter((row) => row.kind === 'penalty' && row.status === 'confirmed' && Number(row.seconds) > 0);
  splits[RACE_SPLIT_PENALTY_SECONDS_KEY] = String(sumConfirmedPenaltySeconds(vigentes.map((row) => ({ status: row.status, seconds: Number(row.seconds) }))));
  splits[RACE_SPLIT_PENALTIES_KEY] = JSON.stringify(vigentes.map((row) => ({ label: row.label, seconds: Number(row.seconds) })));
  return splits;
};

type Publication = { result: string; value: number; result_status: 'dnf' | null };

/** O que a corrida publica; null = nada (sem tempo fechado, AC11). */
export const racePublicationOf = (run: Pick<RaceRunRow, 'status' | 'gross_seconds'>, infractions: Pick<RaceInfractionRow, 'kind' | 'status' | 'seconds'>[]): Publication | null => {
  if (run.status === 'dnf') return { result: 'DNF', value: RACE_NO_RESULT_VALUE, result_status: 'dnf' };
  if (run.status !== 'finished') return null;
  const gross = run.gross_seconds === null || run.gross_seconds === undefined ? null : Number(run.gross_seconds);
  const official = computeOfficialSeconds(gross, infractions.map((row) => ({ kind: row.kind, status: row.status, seconds: Number(row.seconds) })));
  if (official === null) return null;
  return { ...raceOfficialScore(official), result_status: null };
};

const manualSnapshot = (row: ScoreRow) => ({
  result: row.result,
  value: Number(row.value),
  rank: row.rank ?? null,
  points: row.points ?? null,
  splits: isPlainObject(row.splits) ? row.splits : {},
  result_status: row.result_status ?? null
});

const insertManualOverride = async (supabaseAdmin: SupabaseClient, run: RaceRunRow, before: ReturnType<typeof manualSnapshot>, after: Publication) => {
  check(await supabaseAdmin.from('race_decisions').insert({
    id: `decision_${randomUUID()}`,
    event_id: run.event_id,
    run_id: run.id,
    heat_id: null,
    infraction_id: null,
    action: RACE_MANUAL_OVERRIDE_ACTION,
    actor_user_id: null,
    actor_name: 'Súmula',
    actor_role: 'system',
    reason: 'Resultado manual substituído pelo resultado da súmula.',
    before,
    after: { result: after.result, value: after.value, result_status: after.result_status },
    created_at: new Date().toISOString()
  }));
};

/** Resultado manual substituído por esta corrida (AC8), pela decisão `manual_override` mais recente. */
const readReplacedManual = async (supabaseAdmin: SupabaseClient, runId: string) => {
  const rows = (check(await supabaseAdmin.from('race_decisions').select('action, before, created_at').eq('run_id', runId)) || []) as { action: string; before: unknown; created_at: string }[];
  const latest = rows.filter((row) => row.action === RACE_MANUAL_OVERRIDE_ACTION).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const before = latest && isPlainObject(latest.before) ? latest.before : null;
  if (!before || typeof before.result !== 'string' || !Number.isFinite(Number(before.value))) return null;
  return before;
};

/**
 * Retira o resultado desta corrida (AC11, AC13, D25): sem a linha, nada muda;
 * com ela, devolve o manual substituído (race_run_id nulo) ou apaga.
 */
const retractRaceRun = async (supabaseAdmin: SupabaseClient, run: RaceRunRow) => {
  const rows = (check(await supabaseAdmin.from('scores').select(SCORE_COLUMNS).eq('race_run_id', run.id)) || []) as ScoreRow[];
  let restoredManual = false;
  for (const row of rows) {
    const manual = await readReplacedManual(supabaseAdmin, run.id);
    if (manual) {
      restoredManual = true;
      check(await supabaseAdmin.from('scores').update({
        result: manual.result,
        value: Number(manual.value),
        splits: isPlainObject(manual.splits) ? manual.splits : {},
        result_status: typeof manual.result_status === 'string' ? manual.result_status : null,
        race_run_id: null
      }).eq('athlete_id', row.athlete_id).eq('workout_id', row.workout_id));
    } else {
      check(await supabaseAdmin.from('scores').delete().eq('athlete_id', row.athlete_id).eq('workout_id', row.workout_id));
    }
    await recalculateRaceRanking(supabaseAdmin, row.workout_id);
  }
  return { published: false as const, restoredManual, workoutIds: rows.map((row) => row.workout_id) };
};

/**
 * Publica (ou retira) o resultado da corrida na prova TOTAL da categoria
 * (AC1, AC5, AC8, AC11, AC13). Lê a corrida de novo (a passada pode estar
 * velha). Idempotente: publicar de novo dá o mesmo resultado.
 */
export const publishRaceRun = async (supabaseAdmin: SupabaseClient, runInput: Pick<RaceRunRow, 'id'>) => {
  const run = check(await supabaseAdmin.from('race_runs').select('*').eq('id', runInput.id).maybeSingle()) as RaceRunRow | null;
  if (!run) throw new RaceSheetError('Corrida não encontrada.', 404);
  const infractions = (check(await supabaseAdmin.from('race_infractions').select('*').eq('run_id', run.id)) || []) as RaceInfractionRow[];
  const publication = racePublicationOf(run, infractions);
  if (!publication) return retractRaceRun(supabaseAdmin, run);

  let divisionId = run.division_id;
  if (!divisionId) {
    const athlete = check(await supabaseAdmin.from('athletes').select('id, division_id').eq('id', run.athlete_id).maybeSingle()) as { division_id: string | null } | null;
    divisionId = athlete?.division_id ?? null;
  }
  if (!divisionId) throw new RaceSheetError('O atleta desta corrida não tem categoria; o resultado não foi publicado.', 409);
  const workoutId = await ensureRaceTotalWorkout(supabaseAdmin, run.event_id, divisionId);
  const attempts = (check(await supabaseAdmin.from('race_attempts').select('*').eq('run_id', run.id)) || []) as RaceAttemptRow[];

  const current = check(await supabaseAdmin.from('scores').select(SCORE_COLUMNS).eq('athlete_id', run.athlete_id).eq('workout_id', workoutId).maybeSingle()) as ScoreRow | null;
  // AC8: resultado manual (sem corrida) substituído fica registrado antes de sumir.
  if (current && !current.race_run_id) await insertManualOverride(supabaseAdmin, run, manualSnapshot(current), publication);

  check(await supabaseAdmin.from('scores').upsert({
    athlete_id: run.athlete_id,
    workout_id: workoutId,
    result: publication.result,
    value: publication.value,
    splits: buildRaceSplits(attempts, infractions),
    result_status: publication.result_status,
    race_run_id: run.id
  }, { onConflict: 'athlete_id,workout_id' }));
  await recalculateRaceRanking(supabaseAdmin, workoutId);
  return { published: true as const, workoutId, ...publication };
};

// ---------------------------------------------------------------------------
// Trava do lançamento manual (AC7)
// ---------------------------------------------------------------------------

export const RACE_MANUAL_LOCK_MESSAGE = 'Este resultado veio da súmula Fitness Race. Ajuste o tempo no painel da súmula (Penalidades e decisões), não no lançamento manual.';

type ManualRow = { athlete_id: string; workout_id: string; result: string; value: number } & Record<string, unknown>;

/**
 * Lançamento manual diante dos resultados publicados pela súmula Race: linha
 * que mudaria resultado de corrida = `locked` (a rota responde 409); linha
 * igual ao publicado sai do lote (o painel reenvia a categoria toda, com o
 * rank que conhece, e isso não pode sobrescrever o ranking da súmula). Sem a
 * coluna (migration não aplicada), nada muda.
 */
export const filterRaceLockedManualScores = async <T extends ManualRow>(supabaseAdmin: SupabaseClient, rows: T[]) => {
  const workoutIds = [...new Set(rows.map((row) => row.workout_id))];
  if (workoutIds.length === 0) return { rows, locked: [] as T[], raceWorkoutIds: [] as string[] };
  const { data, error } = await supabaseAdmin.from('scores').select('athlete_id, workout_id, result, value, race_run_id').in('workout_id', workoutIds);
  if (error) {
    if (isMissingRaceSchema(error)) return { rows, locked: [] as T[], raceWorkoutIds: [] as string[] };
    throw error;
  }
  const published = new Map(((data || []) as ScoreRow[]).filter((row) => row.race_run_id).map((row) => [`${row.athlete_id}|${row.workout_id}`, row]));
  if (published.size === 0) return { rows, locked: [] as T[], raceWorkoutIds: [] as string[] };
  const locked: T[] = [];
  const kept: T[] = [];
  for (const row of rows) {
    const stored = published.get(`${row.athlete_id}|${row.workout_id}`);
    if (!stored) kept.push(row);
    else if (stored.result !== row.result || Number(stored.value) !== Number(row.value)) locked.push(row);
  }
  return { rows: kept, locked, raceWorkoutIds: [...new Set([...published.values()].map((row) => row.workout_id))] };
};
