import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  MAX_EVENTS_PER_BATCH,
  MAX_EVENTS_PER_SHEET,
  computeAbsentOutcome,
  computeSheetOutcome,
  validateClientEvent,
  type ScoresheetReviewAction,
  type ScoresheetStatus
} from '@/lib/scoresheet';
import { SCORE_TIE_BREAKER_SPLIT_KEY, parseScoreForWorkout, rankWorkoutScores, secondsToTime, timeToSeconds, type WorkoutScoreForRanking } from '@/lib/scoring';
import { estimateClockStart, summarizeLiveProgress, type LiveProgress } from '@/lib/liveProgress';
import type { SessionUser } from '@/lib/serverSecurity';
import { checkTonnageEntry, parseMetersInput, parseTonnageKgInput, validateWorkoutStructure, type SheetEvent, type WorkoutStructure } from '@/lib/workoutStructure';
import type { Score, WorkoutType } from '@/types';

// Súmula gravada no servidor (Stories 1.49 a 1.52, etapa E3). Abrir a súmula
// guarda a cópia da estrutura da prova; o log chega em lotes com sequência
// contígua (o reenvio do mesmo lote não duplica); o envio calcula o resultado
// com o motor e publica na hora em `scores` (decisão 3 da E3), recalculando a
// posição e os pontos da prova e categoria com a mesma regra do painel
// (rankWorkoutScores). O gestor pode devolver, corrigir (com justificativa) ou
// cancelar; tudo fica em scoresheet_reviews. O acesso é conferido antes, em
// serverSheetAccess.ts. Story 1.59: o judge (súmula sem registro) ou o gestor
// (com motivo, sobre a súmula ou sem súmula) marcam o atleta ausente; o
// servidor publica o pior resultado da prova com result_status = 'absent'.

export class SheetError extends Error {
  constructor(message: string, readonly status = 400, readonly extra: Record<string, unknown> = {}) {
    super(message);
    this.name = 'SheetError';
  }
}

const UNAVAILABLE_MESSAGE = 'A súmula digital ainda não está disponível neste ambiente. Aplique as migrations pendentes antes de usar.';
/** Ações de ausência com a coluna scoresheets.absent ainda não criada (a súmula funciona; só elas param). */
export const ABSENT_UNAVAILABLE_MESSAGE = 'A marcação de atleta ausente ainda não está disponível neste ambiente. Aplique a migration 20261021120000_scoresheet_absent.sql antes de usar.';

// Coluna scoresheets.absent ainda não criada (migration da Story 1.59 pendente):
// as leituras repetem sem ela e só as ações de ausência respondem 503.
export const isMissingAbsentColumn = (error: unknown) => {
  const details = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : null;
  return (details?.code === '42703' || details?.code === 'PGRST204') && /\babsent\b/.test(String(details?.message ?? ''));
};

// Tabela ou coluna da súmula ainda não criada (migration não aplicada): 503 com a mensagem acima.
export const isMissingSheetSchema = (error: unknown) => {
  const details = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : null;
  const code = typeof details?.code === 'string' ? details.code : '';
  const message = typeof details?.message === 'string' ? details.message : '';
  return code === '42P01' || code === 'PGRST205' || ((code === '42703' || code === 'PGRST204') && /scoresheet|structure/.test(message));
};

const check = <T>(result: { data: T; error: unknown }) => {
  if (result.error) {
    if (isMissingAbsentColumn(result.error)) throw new SheetError(ABSENT_UNAVAILABLE_MESSAGE, 503);
    if (isMissingSheetSchema(result.error)) throw new SheetError(UNAVAILABLE_MESSAGE, 503);
    throw result.error;
  }
  return result.data;
};

const nowIso = () => new Date().toISOString();
const newId = (prefix: string) => `${prefix}_${randomUUID()}`;

export type SheetRow = {
  id: string;
  event_id: string;
  workout_id: string;
  athlete_id: string;
  division_id: string | null;
  heat_id: string | null;
  heat_number: number | null;
  lane: number | null;
  judge_user_id: string | null;
  judge_name: string;
  structure: WorkoutStructure;
  status: ScoresheetStatus;
  computed_result: string | null;
  computed_value: number | null;
  computed_tie_break: string | null;
  official_result: string | null;
  official_value: number | null;
  official_tie_break: string | null;
  corrected: boolean;
  return_reason: string | null;
  submitted_at: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  /** Atleta ausente nesta prova (Story 1.59); false quando a coluna ainda não existe. */
  absent: boolean;
};

const SHEET_COLUMNS = 'id, event_id, workout_id, athlete_id, division_id, heat_id, heat_number, lane, judge_user_id, judge_name, structure, status, computed_result, computed_value, computed_tie_break, official_result, official_value, official_tie_break, corrected, return_reason, submitted_at, published_at, created_at, updated_at';
const SHEET_SELECT = `${SHEET_COLUMNS}, absent`;

const withAbsentFlag = (row: Record<string, unknown>) => ({ ...row, absent: row.absent === true }) as SheetRow;

/**
 * Lê súmulas com a coluna `absent` e, se ela ainda não existe (migration da
 * Story 1.59 pendente), repete a mesma consulta sem ela: a súmula segue igual,
 * com `absent` false. `absentColumn` diz se a coluna existe; é por ele que as
 * ações de ausência respondem 503 antes de gravar qualquer coisa.
 */
const selectSheets = async <T>(run: (columns: string) => PromiseLike<{ data: unknown; error: unknown }>) => {
  const normalize = (data: unknown) => (
    Array.isArray(data)
      ? data.map((row) => withAbsentFlag(row as Record<string, unknown>))
      : data ? withAbsentFlag(data as Record<string, unknown>) : null
  ) as T;
  const first = await run(SHEET_SELECT);
  if (!first.error) return { data: normalize(first.data), absentColumn: true };
  if (!isMissingAbsentColumn(first.error)) check(first);
  return { data: normalize(check(await run(SHEET_COLUMNS))), absentColumn: false };
};

export const toSheetDto = (row: SheetRow) => ({
  id: row.id,
  eventId: row.event_id,
  workoutId: row.workout_id,
  athleteId: row.athlete_id,
  divisionId: row.division_id,
  heatId: row.heat_id,
  heatNumber: row.heat_number,
  lane: row.lane,
  judgeUserId: row.judge_user_id,
  judgeName: row.judge_name,
  structure: row.structure,
  status: row.status,
  computedResult: row.computed_result,
  computedTieBreak: row.computed_tie_break,
  officialResult: row.official_result,
  officialValue: row.official_value === null ? null : Number(row.official_value),
  officialTieBreak: row.official_tie_break,
  corrected: Boolean(row.corrected),
  absent: row.absent === true,
  returnReason: row.return_reason,
  submittedAt: row.submitted_at,
  publishedAt: row.published_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

export type SheetDto = ReturnType<typeof toSheetDto>;

type ScoreRow = {
  athlete_id: string;
  workout_id: string;
  result: string;
  value: number;
  rank: number | null;
  points: number | null;
  splits: Record<string, string> | null;
  result_status?: string | null;
};

const toScoreDto = (row: ScoreRow) => ({
  athleteId: row.athlete_id,
  workoutId: row.workout_id,
  result: row.result,
  value: Number(row.value),
  rank: row.rank ?? undefined,
  points: row.points ?? undefined,
  splits: row.splits || {},
  resultStatus: (row.result_status || undefined) as Score['resultStatus']
});

export type RankedScoreDto = ReturnType<typeof toScoreDto>;

const actorRole = (actor: SessionUser) => (actor.role === 'owner' || actor.role === 'manager' ? actor.role : 'judge');

const insertReview = async (
  supabaseAdmin: SupabaseClient,
  sheetId: string,
  actor: SessionUser,
  action: ScoresheetReviewAction,
  details: {
    reason?: string | null;
    previous?: { result: string | null; value: number | null; tieBreak: string | null } | null;
    applied?: { result: string | null; value: number | null; tieBreak: string | null } | null;
  } = {}
) => {
  check(await supabaseAdmin.from('scoresheet_reviews').insert({
    id: newId('review'),
    sheet_id: sheetId,
    action,
    actor_user_id: actor.id,
    actor_name: actor.name,
    actor_role: actorRole(actor),
    reason: details.reason ?? null,
    previous_result: details.previous?.result ?? null,
    previous_value: details.previous?.value ?? null,
    previous_tie_break: details.previous?.tieBreak ?? null,
    applied_result: details.applied?.result ?? null,
    applied_value: details.applied?.value ?? null,
    applied_tie_break: details.applied?.tieBreak ?? null,
    created_at: nowIso()
  }));
};

// ---------------------------------------------------------------------------
// Quadro da quadra: provas estruturadas, baterias, raias e súmulas do evento
// ---------------------------------------------------------------------------

type ScheduleItem = {
  id?: unknown;
  kind?: unknown;
  workoutId?: unknown;
  heatNumber?: unknown;
  date?: unknown;
  time?: unknown;
  title?: unknown;
  athleteIds?: unknown;
};

const readStructuredWorkouts = async (supabaseAdmin: SupabaseClient, eventId: string) => {
  const rows = check(await supabaseAdmin
    .from('workouts')
    .select('id, name, code, order_index, division_id, type, tie_breaker, structure')
    .eq('event_id', eventId)
    .order('order_index', { ascending: true })) as Record<string, unknown>[] | null;
  return (rows || []).flatMap((row) => {
    const checked = row.structure ? validateWorkoutStructure(row.structure) : null;
    if (!checked?.ok) return [];
    return [{
      id: String(row.id),
      name: String(row.name ?? ''),
      code: String(row.code ?? ''),
      orderIndex: Number(row.order_index ?? 0),
      divisionId: row.division_id ? String(row.division_id) : null,
      structure: checked.structure
    }];
  });
};

const summarizeSheet = (row: SheetRow) => ({
  id: row.id,
  workoutId: row.workout_id,
  athleteId: row.athlete_id,
  status: row.status,
  judgeUserId: row.judge_user_id,
  judgeName: row.judge_name,
  heatId: row.heat_id,
  lane: row.lane,
  officialResult: row.official_result,
  absent: row.absent === true,
  updatedAt: row.updated_at
});

/** O que a área do judge precisa para escolher prova, bateria e atleta (sem e-mails nem dados de inscrição). */
export const buildSheetBoard = async (supabaseAdmin: SupabaseClient, eventId: string) => {
  const eventRow = check(await supabaseAdmin
    .from('events')
    .select('id, name, date, location, event_schedule')
    .eq('id', eventId)
    .maybeSingle()) as Record<string, unknown> | null;
  if (!eventRow) throw new SheetError('Evento não encontrado.', 404);

  const workouts = await readStructuredWorkouts(supabaseAdmin, eventId);
  const divisions = (check(await supabaseAdmin.from('divisions').select('id, name').eq('event_id', eventId)) || []) as { id: string; name: string }[];
  const divisionIds = divisions.map((division) => division.id);
  const athletes = divisionIds.length > 0
    ? (check(await supabaseAdmin.from('athletes').select('id, name, box, division_id').in('division_id', divisionIds)) || []) as { id: string; name: string; box: string; division_id: string }[]
    : [];
  const sheets = (await selectSheets<SheetRow[] | null>((columns) => supabaseAdmin.from('scoresheets').select(columns).eq('event_id', eventId))).data || [];

  const divisionName = new Map(divisions.map((division) => [division.id, division.name]));
  const athleteById = new Map(athletes.map((athlete) => [athlete.id, athlete]));
  const structuredIds = new Set(workouts.map((workout) => workout.id));
  const schedule = Array.isArray(eventRow.event_schedule) ? eventRow.event_schedule as ScheduleItem[] : [];

  const heats = schedule
    .filter((item) => item && item.kind === 'heat' && typeof item.workoutId === 'string' && structuredIds.has(item.workoutId))
    .map((item) => ({
      id: String(item.id ?? ''),
      workoutId: String(item.workoutId),
      heatNumber: typeof item.heatNumber === 'number' ? item.heatNumber : null,
      date: typeof item.date === 'string' ? item.date : '',
      time: typeof item.time === 'string' ? item.time : '',
      title: typeof item.title === 'string' ? item.title : '',
      lanes: (Array.isArray(item.athleteIds) ? item.athleteIds : []).flatMap((athleteId, index) => {
        const athlete = typeof athleteId === 'string' ? athleteById.get(athleteId) : undefined;
        if (!athlete) return [];
        return [{
          lane: index + 1,
          athleteId: athlete.id,
          athleteName: athlete.name,
          box: athlete.box,
          divisionId: athlete.division_id,
          divisionName: divisionName.get(athlete.division_id) ?? ''
        }];
      })
    }))
    .sort((a, b) => (a.heatNumber ?? 0) - (b.heatNumber ?? 0));

  return {
    event: {
      id: String(eventRow.id),
      name: String(eventRow.name ?? ''),
      date: String(eventRow.date ?? ''),
      location: String(eventRow.location ?? '')
    },
    workouts,
    divisions,
    athletes: athletes.map((athlete) => ({
      id: athlete.id,
      name: athlete.name,
      box: athlete.box,
      divisionId: athlete.division_id,
      divisionName: divisionName.get(athlete.division_id) ?? ''
    })),
    heats,
    sheets: sheets.filter((sheet) => sheet.status !== 'cancelled').map(summarizeSheet)
  };
};

// ---------------------------------------------------------------------------
// Abrir, ler e gravar
// ---------------------------------------------------------------------------

const readSheet = async (supabaseAdmin: SupabaseClient, sheetId: unknown) => {
  if (typeof sheetId !== 'string' || !sheetId) throw new SheetError('Informe a súmula.', 400);
  const { data: row, absentColumn } = await selectSheets<SheetRow | null>((columns) => supabaseAdmin.from('scoresheets').select(columns).eq('id', sheetId).maybeSingle());
  if (!row) throw new SheetError('Súmula não encontrada.', 404);
  return { row, absentColumn };
};

const readSheetRow = async (supabaseAdmin: SupabaseClient, sheetId: unknown) => (await readSheet(supabaseAdmin, sheetId)).row;

/** Evento da súmula, para conferir o acesso antes de qualquer outra coisa. */
export const readSheetEventId = async (supabaseAdmin: SupabaseClient, sheetId: unknown) => (await readSheetRow(supabaseAdmin, sheetId)).event_id;

type StoredEvent = { seq: number; client_event_id: string; event: SheetEvent; recorded_at?: string | null };

const readEvents = async (supabaseAdmin: SupabaseClient, sheetId: string) => {
  const rows = (check(await supabaseAdmin
    .from('scoresheet_events')
    .select('seq, client_event_id, event, recorded_at')
    .eq('sheet_id', sheetId)
    .order('seq', { ascending: true })) || []) as StoredEvent[];
  return [...rows].sort((a, b) => a.seq - b.seq);
};

const readReviews = async (supabaseAdmin: SupabaseClient, sheetId: string) => {
  const rows = (check(await supabaseAdmin
    .from('scoresheet_reviews')
    .select('id, action, actor_name, actor_role, reason, previous_result, previous_tie_break, applied_result, applied_tie_break, created_at')
    .eq('sheet_id', sheetId)
    .order('created_at', { ascending: true })) || []) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: String(row.id),
    action: row.action as ScoresheetReviewAction,
    actorName: String(row.actor_name ?? ''),
    actorRole: String(row.actor_role ?? ''),
    reason: row.reason ? String(row.reason) : null,
    previousResult: row.previous_result ? String(row.previous_result) : null,
    previousTieBreak: row.previous_tie_break ? String(row.previous_tie_break) : null,
    appliedResult: row.applied_result ? String(row.applied_result) : null,
    appliedTieBreak: row.applied_tie_break ? String(row.applied_tie_break) : null,
    createdAt: String(row.created_at ?? '')
  }));
};

export const readSheetForActor = async (supabaseAdmin: SupabaseClient, sheetId: unknown) => {
  const row = await readSheetRow(supabaseAdmin, sheetId);
  const [events, reviews, athlete, workout] = await Promise.all([
    readEvents(supabaseAdmin, row.id),
    readReviews(supabaseAdmin, row.id),
    supabaseAdmin.from('athletes').select('id, name, box, division_id').eq('id', row.athlete_id).maybeSingle(),
    supabaseAdmin.from('workouts').select('id, name, code').eq('id', row.workout_id).maybeSingle()
  ]);
  const division = row.division_id
    ? check(await supabaseAdmin.from('divisions').select('id, name').eq('id', row.division_id).maybeSingle()) as { name?: string } | null
    : null;
  const athleteRow = check(athlete) as { name?: string; box?: string } | null;
  const workoutRow = check(workout) as { name?: string; code?: string } | null;
  return {
    sheet: toSheetDto(row),
    events: events.map((stored) => ({ id: stored.client_event_id, event: stored.event })),
    reviews,
    context: {
      athleteName: athleteRow?.name ?? '',
      box: athleteRow?.box ?? '',
      workoutName: workoutRow?.name ?? '',
      workoutCode: workoutRow?.code ?? '',
      divisionName: division?.name ?? ''
    }
  };
};

type OpenInput = { eventId: string; workoutId: unknown; athleteId: unknown; heatId?: unknown; lane?: unknown };

/**
 * Abre (ou retoma) a súmula do atleta nesta prova. Uma súmula ativa por atleta
 * e prova: a mesma pessoa retoma a dela; com outra pessoa arbitrando, 409.
 * Súmula em andamento ou devolvida sem judge (criada pelo gestor como ausente,
 * ou cujo judge foi apagado): o judge que abre assume; o gestor dono e o owner
 * abrem só para leitura (Story 1.59, decisões 12, 16 e 17).
 */
export const openSheet = async (supabaseAdmin: SupabaseClient, actor: SessionUser, input: OpenInput) => {
  if (typeof input.workoutId !== 'string' || typeof input.athleteId !== 'string') throw new SheetError('Informe a prova e o atleta.');
  const workouts = await readStructuredWorkouts(supabaseAdmin, input.eventId);
  const workout = workouts.find((item) => item.id === input.workoutId);
  if (!workout) throw new SheetError('Esta prova não tem súmula digital estruturada.', 404);

  const athlete = check(await supabaseAdmin
    .from('athletes')
    .select('id, name, division_id')
    .eq('id', input.athleteId)
    .maybeSingle()) as { id: string; division_id: string } | null;
  if (!athlete) throw new SheetError('Atleta não encontrado.', 404);
  const division = check(await supabaseAdmin
    .from('divisions')
    .select('id, event_id')
    .eq('id', athlete.division_id)
    .maybeSingle()) as { id: string; event_id: string } | null;
  if (!division || division.event_id !== input.eventId) throw new SheetError('Este atleta não pertence ao evento.', 400);

  const existing = async () => (await findActiveSheet(supabaseAdmin, workout.id, athlete.id)).row;
  const resume = async (row: SheetRow) => {
    const sameJudge = row.judge_user_id === actor.id;
    if (row.status === 'submitted' || sameJudge) return row;
    if (row.judge_user_id === null && (row.status === 'in_progress' || row.status === 'returned')) {
      return actor.role === 'judge' ? claimSheet(supabaseAdmin, actor, row) : row;
    }
    throw new SheetError(`Esta súmula está com ${row.judge_name}. Peça ao gestor para liberar antes de arbitrar.`, 409, { sheetId: row.id });
  };

  const current = await existing();
  if (current) return resume(current);

  const heatId = typeof input.heatId === 'string' && input.heatId.length <= 120 ? input.heatId : null;
  const lane = Number.isInteger(input.lane) && (input.lane as number) > 0 && (input.lane as number) < 100 ? input.lane as number : null;
  let heatNumber: number | null = null;
  if (heatId) {
    const eventRow = check(await supabaseAdmin.from('events').select('event_schedule').eq('id', input.eventId).maybeSingle()) as { event_schedule?: unknown } | null;
    const heat = (Array.isArray(eventRow?.event_schedule) ? eventRow.event_schedule as ScheduleItem[] : []).find((item) => item?.id === heatId);
    heatNumber = typeof heat?.heatNumber === 'number' && heat.heatNumber > 0 ? heat.heatNumber : null;
  }

  const created = nowIso();
  const row = {
    id: newId('sheet'),
    event_id: input.eventId,
    workout_id: workout.id,
    athlete_id: athlete.id,
    division_id: athlete.division_id,
    heat_id: heatId,
    heat_number: heatNumber,
    lane,
    judge_user_id: actor.id,
    judge_name: actor.name,
    structure: workout.structure,
    status: 'in_progress' as const,
    computed_result: null,
    computed_value: null,
    computed_tie_break: null,
    official_result: null,
    official_value: null,
    official_tie_break: null,
    corrected: false,
    return_reason: null,
    submitted_at: null,
    published_at: null,
    created_at: created,
    updated_at: created
  };
  const inserted = await supabaseAdmin.from('scoresheets').insert(row);
  if (inserted.error) {
    // Outra pessoa abriu no mesmo instante (índice único da súmula ativa).
    if ((inserted.error as { code?: string }).code === '23505') {
      const raced = await existing();
      if (raced) return resume(raced);
    }
    check(inserted);
  }
  await insertReview(supabaseAdmin, row.id, actor, 'opened');
  return { ...row, absent: false } as SheetRow;
};

/** A súmula não cancelada do atleta nesta prova (o índice único garante no máximo uma). */
const findActiveSheet = async (supabaseAdmin: SupabaseClient, workoutId: string, athleteId: string) => {
  const { data, absentColumn } = await selectSheets<SheetRow[] | null>((columns) => supabaseAdmin
    .from('scoresheets')
    .select(columns)
    .eq('workout_id', workoutId)
    .eq('athlete_id', athleteId));
  return { row: (data || []).find((row) => row.status !== 'cancelled') ?? null, absentColumn };
};

/**
 * O judge assume a súmula sem judge. A gravação só vale enquanto ela continua
 * sem judge: com dois judges abrindo ao mesmo tempo, o segundo recebe 409.
 */
const claimSheet = async (supabaseAdmin: SupabaseClient, actor: SessionUser, row: SheetRow) => {
  check(await supabaseAdmin
    .from('scoresheets')
    .update({ judge_user_id: actor.id, judge_name: actor.name, updated_at: nowIso() })
    .eq('id', row.id)
    .is('judge_user_id', null));
  const claimed = await readSheetRow(supabaseAdmin, row.id);
  if (claimed.judge_user_id !== actor.id) {
    throw new SheetError(`Esta súmula está com ${claimed.judge_name}. Peça ao gestor para liberar antes de arbitrar.`, 409, { sheetId: row.id });
  }
  await insertReview(supabaseAdmin, row.id, actor, 'opened');
  return claimed;
};

const assertSheetWriter = (row: SheetRow, actor: SessionUser) => {
  if (row.judge_user_id !== actor.id) throw new SheetError(`Esta súmula está com ${row.judge_name}.`, 403);
  if (row.status !== 'in_progress' && row.status !== 'returned') {
    throw new SheetError(row.status === 'submitted' ? 'Esta súmula já foi enviada e publicada.' : 'Esta súmula foi cancelada pelo gestor.', 409);
  }
};

/**
 * Grava um lote de eventos. `fromSeq` é quantos eventos o aparelho já sabe que
 * estão no servidor. Se o servidor tem mais, eles precisam ser o começo deste
 * mesmo lote (resposta perdida e reenvio): esses são ignorados e o resto entra
 * em seguida. Qualquer outra diferença é conflito (409): a súmula mudou em
 * outro aparelho.
 */
export const appendSheetEvents = async (
  supabaseAdmin: SupabaseClient,
  actor: SessionUser,
  sheetId: unknown,
  input: { fromSeq?: unknown; events?: unknown }
) => {
  const row = await readSheetRow(supabaseAdmin, sheetId);
  assertSheetWriter(row, actor);
  if (!Number.isInteger(input.fromSeq) || (input.fromSeq as number) < 0) throw new SheetError('Informe de onde o lote começa.');
  if (!Array.isArray(input.events) || input.events.length === 0 || input.events.length > MAX_EVENTS_PER_BATCH) {
    throw new SheetError(`Envie de 1 a ${MAX_EVENTS_PER_BATCH} registros por vez.`);
  }
  const fromSeq = input.fromSeq as number;
  const batch = input.events as unknown[];
  const stored = await readEvents(supabaseAdmin, row.id);
  const count = stored.length;
  const batchIds = batch.map((item) => (item && typeof item === 'object' ? (item as { id?: unknown }).id : undefined));

  const tail = stored.filter((item) => item.seq >= fromSeq);
  const replayed = fromSeq <= count && tail.length <= batch.length && tail.every((item, index) => item.client_event_id === batchIds[index]);
  if (!replayed) {
    throw new SheetError('Esta súmula foi alterada em outro aparelho. Recarregue para continuar.', 409, { serverCount: count });
  }
  const pending = batch.slice(tail.length);
  if (count + pending.length > MAX_EVENTS_PER_SHEET) throw new SheetError('Esta súmula chegou ao limite de registros.', 409);

  const rows = [];
  for (const [index, raw] of pending.entries()) {
    const seq = count + index;
    const checked = validateClientEvent(raw, row.structure, seq);
    if (!checked.ok) throw new SheetError(checked.error);
    // Tonelagem (Story 1.77): a carga e a repetição dependem do log até aqui (liberação concluída, carga vigente, incremento permitido).
    if (row.structure.format === 'tonnage' && (checked.event.t === 'load' || checked.event.t === 'lrep')) {
      const history = [...stored.map((item) => item.event), ...rows.map((item) => item.event)];
      const entry = checked.event.t === 'load' ? { t: 'load' as const, v: checked.event.v } : { t: 'lrep' as const, load: checked.event.load };
      const gate = checkTonnageEntry(row.structure, history, entry);
      if (!gate.ok) throw new SheetError(`Registro ${seq + 1}: ${gate.error}`);
    }
    rows.push({ sheet_id: row.id, seq, client_event_id: checked.id, event: checked.event, author_user_id: actor.id, recorded_at: nowIso() });
  }
  if (rows.length > 0) {
    const inserted = await supabaseAdmin.from('scoresheet_events').insert(rows);
    if (inserted.error) {
      if ((inserted.error as { code?: string }).code === '23505') {
        throw new SheetError('Esta súmula foi alterada em outro aparelho. Recarregue para continuar.', 409, { serverCount: count });
      }
      check(inserted);
    }
    // Os eventos já estão gravados: falha no resumo do telão não derruba o lote
    // (fica ao menos o contador; o telão recalcula o resto do log).
    try {
      await writeLiveProgress(supabaseAdmin, row, [...stored, ...rows]);
    } catch (error) {
      console.error('Erro ao gravar o progresso ao vivo da súmula:', error);
    }
  }
  return { count: count + rows.length };
};

// Coluna live_progress ainda não criada (migration do telão pendente): a súmula segue sem ela.
const isMissingLiveProgress = (error: unknown) => {
  const details = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : null;
  return (details?.code === '42703' || details?.code === 'PGRST204') && /live_progress/.test(String(details?.message ?? ''));
};

/** Resumo do log para o telão (Story 1.54), recalculado a cada lote com o mesmo motor da súmula. */
export const buildLiveProgress = (structure: WorkoutStructure, events: readonly StoredEvent[]): LiveProgress => {
  let clockStartAt: string | null = null;
  for (const item of events) {
    const recordedAt = item.recorded_at ? Date.parse(item.recorded_at) : Number.NaN;
    if (Number.isFinite(recordedAt)) clockStartAt = estimateClockStart(clockStartAt, recordedAt, [item.event]);
  }
  return summarizeLiveProgress(structure, events.map((item) => item.event), clockStartAt);
};

// Sem o resumo completo (cálculo ou gravação com erro), grava ao menos o
// contador do log ({ seq }): é por ele que o telão sabe que a bateria começou
// (com seq 0, a bateria em andamento apareceria como Chamada). O contador sozinho
// não passa em readLiveProgress, então o telão calcula o progresso do log para o
// grupo no ar. Sem nem isso (coluna ausente ou erro de novo), ao menos o
// updated_at avança: é por ele que o telão sabe que a bateria segue no ar.
const writeLiveProgress = async (supabaseAdmin: SupabaseClient, row: SheetRow, events: readonly StoredEvent[]) => {
  const updatedAt = nowIso();
  let progress: LiveProgress | null = null;
  try {
    progress = buildLiveProgress(row.structure, events);
  } catch (error) {
    console.error('Erro ao calcular o progresso ao vivo da súmula:', error);
  }
  const attempts: (LiveProgress | { seq: number })[] = progress ? [progress, { seq: events.length }] : [{ seq: events.length }];
  for (const liveProgress of attempts) {
    const written = await supabaseAdmin
      .from('scoresheets')
      .update({ updated_at: updatedAt, live_progress: liveProgress })
      .eq('id', row.id);
    if (!written.error) return;
    if (isMissingLiveProgress(written.error)) break;
    console.error('Erro ao gravar o progresso ao vivo da súmula:', written.error);
  }
  check(await supabaseAdmin.from('scoresheets').update({ updated_at: updatedAt }).eq('id', row.id));
};

// ---------------------------------------------------------------------------
// Publicação e ranking
// ---------------------------------------------------------------------------

type Official = { result: string; value: number; tieBreak: string | null };

/**
 * Recalcula a posição e os pontos da prova na categoria, no servidor, com a
 * mesma regra do painel (rankWorkoutScores), e devolve os scores da prova na
 * categoria.
 */
export const recalculateWorkoutRanking = async (supabaseAdmin: SupabaseClient, workoutId: string, divisionId: string) => {
  const workout = check(await supabaseAdmin.from('workouts').select('id, type, tie_breaker').eq('id', workoutId).maybeSingle()) as { type: WorkoutType; tie_breaker: string | null } | null;
  if (!workout) return [];
  const athleteRows = (check(await supabaseAdmin.from('athletes').select('id').eq('division_id', divisionId)) || []) as { id: string }[];
  const athleteIds = athleteRows.map((athlete) => athlete.id);
  if (athleteIds.length === 0) return [];
  const scoreRows = (check(await supabaseAdmin
    .from('scores')
    .select('athlete_id, workout_id, result, value, rank, points, splits, result_status')
    .eq('workout_id', workoutId)
    .in('athlete_id', athleteIds)) || []) as ScoreRow[];
  if (scoreRows.length === 0) return [];

  const ranked = rankWorkoutScores(
    workout.type,
    workout.tie_breaker || '',
    scoreRows.map((score): WorkoutScoreForRanking => ({
      athleteId: score.athlete_id,
      result: score.result,
      value: Number(score.value),
      splits: score.splits || {},
      resultStatus: score.result_status ?? null
    })),
    athleteIds.length
  );
  // O upsert por athlete_id,workout_id preserva result_status (não vai no payload).
  const payload = ranked.map((score) => ({
    athlete_id: score.athleteId,
    workout_id: workoutId,
    result: score.result ?? '',
    value: score.value,
    rank: score.rank || null,
    points: score.points ?? null,
    splits: score.splits || {}
  }));
  check(await supabaseAdmin.from('scores').upsert(payload, { onConflict: 'athlete_id,workout_id' }));
  return payload.map((score, index) => toScoreDto({ ...score, result_status: ranked[index].resultStatus ?? null }));
};

/** Recalcula as provas e categorias tocadas por um lote de scores (a categoria vem do atleta). */
export const recalculateRankingForPairs = async (supabaseAdmin: SupabaseClient, pairs: { workoutId: string; athleteId: string }[]) => {
  const athleteIds = [...new Set(pairs.map((pair) => pair.athleteId))];
  if (athleteIds.length === 0) return;
  const athletes = (check(await supabaseAdmin.from('athletes').select('id, division_id').in('id', athleteIds)) || []) as { id: string; division_id: string }[];
  const divisionByAthlete = new Map(athletes.map((athlete) => [athlete.id, athlete.division_id]));
  const groups = new Map<string, { workoutId: string; divisionId: string }>();
  for (const pair of pairs) {
    const divisionId = divisionByAthlete.get(pair.athleteId);
    if (divisionId) groups.set(`${pair.workoutId}|${divisionId}`, { workoutId: pair.workoutId, divisionId });
  }
  for (const group of groups.values()) await recalculateWorkoutRanking(supabaseAdmin, group.workoutId, group.divisionId);
};

/**
 * Grava o resultado oficial em scores e recalcula a prova e categoria. Devolve
 * também o resultado que estava no ranking sem ter vindo desta súmula (um
 * lançamento manual), para o histórico dizer o que foi substituído.
 * `result_status` vai sempre: 'absent' na ausência e null no envio e na
 * correção, para um selo antigo nunca sobreviver a um resultado real.
 */
const publish = async (supabaseAdmin: SupabaseClient, row: SheetRow, official: Official, resultStatus: 'absent' | null = null) => {
  const athlete = check(await supabaseAdmin.from('athletes').select('id, division_id').eq('id', row.athlete_id).maybeSingle()) as { division_id: string } | null;
  if (!athlete) throw new SheetError('O atleta desta súmula não existe mais.', 409);
  const current = check(await supabaseAdmin
    .from('scores')
    .select('result, value, splits, scoresheet_id')
    .eq('athlete_id', row.athlete_id)
    .eq('workout_id', row.workout_id)
    .maybeSingle()) as { result: string; value: number; splits: Record<string, string> | null; scoresheet_id?: string | null } | null;
  const replaced: Official | null = current && current.scoresheet_id !== row.id
    ? { result: current.result, value: Number(current.value), tieBreak: current.splits?.[SCORE_TIE_BREAKER_SPLIT_KEY] || null }
    : null;
  check(await supabaseAdmin.from('scores').upsert({
    athlete_id: row.athlete_id,
    workout_id: row.workout_id,
    result: official.result,
    value: official.value,
    splits: official.tieBreak ? { [SCORE_TIE_BREAKER_SPLIT_KEY]: official.tieBreak } : {},
    scoresheet_id: row.id,
    result_status: resultStatus
  }, { onConflict: 'athlete_id,workout_id' }));
  return { ranking: await recalculateWorkoutRanking(supabaseAdmin, row.workout_id, athlete.division_id), replaced };
};

const officialOf = (row: SheetRow) => ({
  result: row.official_result,
  value: row.official_value === null ? null : Number(row.official_value),
  tieBreak: row.official_tie_break
});

/**
 * Envia a súmula: calcula o resultado do log no servidor e publica na hora
 * (decisão 3 da E3). `expectedCount` garante que o aparelho enviou tudo antes.
 * Reenviar depois de uma devolução substitui o resultado publicado.
 */
export const submitSheet = async (
  supabaseAdmin: SupabaseClient,
  actor: SessionUser,
  sheetId: unknown,
  input: { expectedCount?: unknown }
) => {
  const row = await readSheetRow(supabaseAdmin, sheetId);
  assertSheetWriter(row, actor);
  const stored = await readEvents(supabaseAdmin, row.id);
  if (input.expectedCount !== stored.length) {
    throw new SheetError('Há registros desta súmula que ainda não chegaram ao servidor. Aguarde salvar e envie de novo.', 409, { serverCount: stored.length });
  }
  const outcome = computeSheetOutcome(row.structure, stored.map((item) => item.event));
  if (!outcome.ok) throw new SheetError(outcome.error);

  const official: Official = { result: outcome.result, value: outcome.value, tieBreak: outcome.tieBreak };
  const previous = officialOf(row);
  // Publica antes de marcar a súmula: se algo falhar no meio, reenviar dá o mesmo resultado.
  const { ranking, replaced } = await publish(supabaseAdmin, row, official);
  const at = nowIso();
  const patch = {
    status: 'submitted' as const,
    computed_result: outcome.result,
    computed_value: outcome.value,
    computed_tie_break: outcome.tieBreak,
    official_result: official.result,
    official_value: official.value,
    official_tie_break: official.tieBreak,
    corrected: false,
    return_reason: null,
    submitted_at: at,
    published_at: at,
    updated_at: at,
    // Só toca em `absent` quando a súmula era ausente: assim o envio funciona sem a migration da Story 1.59.
    ...(row.absent ? { absent: false } : {})
  };
  check(await supabaseAdmin.from('scoresheets').update(patch).eq('id', row.id));
  await insertReview(supabaseAdmin, row.id, actor, 'submitted', {
    reason: replaced ? MANUAL_REPLACED_REASON : null,
    previous: replaced ?? (previous.result ? previous : null),
    applied: official
  });
  return { sheet: toSheetDto({ ...row, ...patch }), summary: outcome.summary, ranking };
};

const MANUAL_REPLACED_REASON = 'Substituiu um resultado lançado à mão.';

// ---------------------------------------------------------------------------
// Atleta ausente (Story 1.59)
// ---------------------------------------------------------------------------

/**
 * Publica a ausência sobre a súmula: o resultado atribuído sai da estrutura
 * copiada (computeAbsentOutcome), nunca do aparelho; vai para scores com
 * result_status = 'absent'; a súmula fica enviada, com `absent` e o resultado
 * atribuído como calculado e oficial; o histórico ganha "Atleta ausente" com o
 * antes e, quando foi o gestor, o motivo. A ordem é a do envio: publicar antes
 * de marcar a súmula.
 */
const publishAbsence = async (supabaseAdmin: SupabaseClient, actor: SessionUser, row: SheetRow, reason: string | null) => {
  const outcome = computeAbsentOutcome(row.structure);
  if (!outcome.ok) throw new SheetError(outcome.error);
  const official: Official = { result: outcome.result, value: outcome.value, tieBreak: null };
  const previous = officialOf(row);
  const { ranking, replaced } = await publish(supabaseAdmin, row, official, 'absent');
  const at = nowIso();
  const patch = {
    status: 'submitted' as const,
    absent: true,
    computed_result: official.result,
    computed_value: official.value,
    computed_tie_break: null,
    official_result: official.result,
    official_value: official.value,
    official_tie_break: null,
    corrected: false,
    return_reason: null,
    submitted_at: at,
    published_at: at,
    updated_at: at
  };
  check(await supabaseAdmin.from('scoresheets').update(patch).eq('id', row.id));
  await insertReview(supabaseAdmin, row.id, actor, 'absent', {
    reason: reason ?? (replaced ? MANUAL_REPLACED_REASON : null),
    previous: replaced ?? (previous.result ? previous : null),
    applied: official
  });
  return { sheet: toSheetDto({ ...row, ...patch }), summary: outcome.summary, ranking };
};

/**
 * O judge marca ausente o atleta da súmula dele (Story 1.59, AC4): só com a
 * súmula em andamento ou devolvida e sem nenhum registro no servidor. O corpo
 * não leva resultado.
 */
export const markSheetAbsent = async (supabaseAdmin: SupabaseClient, actor: SessionUser, sheetId: unknown) => {
  const { row, absentColumn } = await readSheet(supabaseAdmin, sheetId);
  assertSheetWriter(row, actor);
  if (!absentColumn) throw new SheetError(ABSENT_UNAVAILABLE_MESSAGE, 503);
  const stored = await readEvents(supabaseAdmin, row.id);
  if (stored.length > 0) {
    throw new SheetError('Esta súmula já tem registros, então o atleta não pode ser marcado como ausente por aqui. Recarregue a súmula ou peça ao gestor.', 409, { serverCount: stored.length });
  }
  return publishAbsence(supabaseAdmin, actor, row, null);
};

/** O gestor marca ausente sobre uma súmula que existe (AC6): qualquer estado ativo, sem exigir log vazio. */
const markExistingSheetAbsent = async (supabaseAdmin: SupabaseClient, actor: SessionUser, row: SheetRow, absentColumn: boolean, reason: string) => {
  if (row.status === 'cancelled') throw new SheetError('Esta súmula foi cancelada.', 409);
  if (row.absent) throw new SheetError('Este atleta já está marcado como ausente nesta prova.', 409);
  if (!absentColumn) throw new SheetError(ABSENT_UNAVAILABLE_MESSAGE, 503);
  return publishAbsence(supabaseAdmin, actor, row, reason);
};

type MarkAbsentInput = { eventId: string; workoutId: unknown; athleteId: unknown; reason: unknown; heatId?: unknown; lane?: unknown };

/**
 * O gestor marca ausente o atleta numa prova (Story 1.59, AC13), com motivo.
 * Se o atleta já tem súmula não cancelada nessa prova, vale o caminho da súmula
 * existente. Senão, cria a súmula já enviada e ausente, sem judge
 * (`judge_user_id` nulo, `judge_name` de quem marcou), na bateria do cronograma
 * em que o atleta aparece para a prova (ou na informada, conferida).
 */
export const markAthleteAbsent = async (supabaseAdmin: SupabaseClient, actor: SessionUser, input: MarkAbsentInput) => {
  const reason = readReason(input.reason);
  if (typeof input.workoutId !== 'string' || typeof input.athleteId !== 'string') throw new SheetError('Informe a prova e o atleta.');
  const workouts = await readStructuredWorkouts(supabaseAdmin, input.eventId);
  const workout = workouts.find((item) => item.id === input.workoutId);
  if (!workout) throw new SheetError('Esta prova não tem súmula digital estruturada.', 404);

  const athlete = check(await supabaseAdmin
    .from('athletes')
    .select('id, name, division_id')
    .eq('id', input.athleteId)
    .maybeSingle()) as { id: string; division_id: string } | null;
  if (!athlete) throw new SheetError('Atleta não encontrado.', 404);
  const division = check(await supabaseAdmin
    .from('divisions')
    .select('id, event_id')
    .eq('id', athlete.division_id)
    .maybeSingle()) as { id: string; event_id: string } | null;
  if (!division || division.event_id !== input.eventId) throw new SheetError('Este atleta não pertence ao evento.', 400);
  if (workout.divisionId && workout.divisionId !== athlete.division_id) {
    throw new SheetError('Esta prova é de outra categoria: o atleta não compete nela.', 400);
  }

  const eventRow = check(await supabaseAdmin.from('events').select('event_schedule').eq('id', input.eventId).maybeSingle()) as { event_schedule?: unknown } | null;
  const heats = (Array.isArray(eventRow?.event_schedule) ? eventRow.event_schedule as ScheduleItem[] : [])
    .filter((item) => item && item.kind === 'heat' && typeof item.id === 'string');
  const laneIn = (item: ScheduleItem) => (Array.isArray(item.athleteIds) ? item.athleteIds.indexOf(athlete.id) + 1 : 0);
  const informedHeat = typeof input.heatId === 'string' ? input.heatId : input.heatId === undefined || input.heatId === null || input.heatId === '' ? null : '';
  let heat: ScheduleItem | undefined;
  if (informedHeat !== null) {
    heat = heats.find((item) => item.id === informedHeat);
    if (!heat || heat.workoutId !== workout.id) throw new SheetError('Bateria não encontrada no cronograma desta prova.', 400);
  } else {
    heat = heats.find((item) => item.workoutId === workout.id && laneIn(item) > 0);
  }
  const informedLane = Number.isInteger(input.lane) && (input.lane as number) > 0 && (input.lane as number) < 100 ? input.lane as number : null;
  const scheduleLane = heat && laneIn(heat) > 0 ? laneIn(heat) : null;

  const current = await findActiveSheet(supabaseAdmin, workout.id, athlete.id);
  if (current.row) return markExistingSheetAbsent(supabaseAdmin, actor, current.row, current.absentColumn, reason);
  if (!current.absentColumn) throw new SheetError(ABSENT_UNAVAILABLE_MESSAGE, 503);

  const outcome = computeAbsentOutcome(workout.structure);
  if (!outcome.ok) throw new SheetError(outcome.error);
  const official: Official = { result: outcome.result, value: outcome.value, tieBreak: null };
  const at = nowIso();
  const row: SheetRow = {
    id: newId('sheet'),
    event_id: input.eventId,
    workout_id: workout.id,
    athlete_id: athlete.id,
    division_id: athlete.division_id,
    heat_id: heat ? String(heat.id) : null,
    heat_number: typeof heat?.heatNumber === 'number' && heat.heatNumber > 0 ? heat.heatNumber : null,
    lane: informedLane ?? scheduleLane,
    judge_user_id: null,
    judge_name: actor.name,
    structure: workout.structure,
    status: 'submitted',
    computed_result: official.result,
    computed_value: official.value,
    computed_tie_break: null,
    official_result: official.result,
    official_value: official.value,
    official_tie_break: null,
    corrected: false,
    return_reason: null,
    submitted_at: at,
    published_at: at,
    created_at: at,
    updated_at: at,
    absent: true
  };
  const inserted = await supabaseAdmin.from('scoresheets').insert(row);
  if (inserted.error) {
    // Outra súmula do atleta nesta prova entrou no mesmo instante (índice único): segue sobre ela.
    if ((inserted.error as { code?: string }).code === '23505') {
      const raced = await findActiveSheet(supabaseAdmin, workout.id, athlete.id);
      if (raced.row) return markExistingSheetAbsent(supabaseAdmin, actor, raced.row, raced.absentColumn, reason);
    }
    check(inserted);
  }
  // A súmula precisa existir antes do score (scores.scoresheet_id). Se a
  // publicação falhar, a súmula recém-criada sai, para a próxima tentativa
  // começar do zero.
  let published: Awaited<ReturnType<typeof publish>>;
  try {
    published = await publish(supabaseAdmin, row, official, 'absent');
  } catch (error) {
    const removed = await supabaseAdmin.from('scoresheets').delete().eq('id', row.id);
    if (removed.error) console.error('Erro ao desfazer a súmula de ausência sem publicação:', removed.error);
    throw error;
  }
  await insertReview(supabaseAdmin, row.id, actor, 'absent', { reason, previous: published.replaced, applied: official });
  return { sheet: toSheetDto(row), summary: outcome.summary, ranking: published.ranking };
};

// ---------------------------------------------------------------------------
// Revisão do gestor
// ---------------------------------------------------------------------------

const REASON_MIN = 3;
const REASON_MAX = 500;

const readReason = (value: unknown) => {
  const reason = typeof value === 'string' ? value.trim() : '';
  if (reason.length < REASON_MIN || reason.length > REASON_MAX) {
    throw new SheetError(`Escreva o motivo (de ${REASON_MIN} a ${REASON_MAX} caracteres).`);
  }
  return reason;
};

const removePublishedScore = async (supabaseAdmin: SupabaseClient, row: SheetRow) => {
  const score = check(await supabaseAdmin
    .from('scores')
    .select('athlete_id, workout_id, scoresheet_id')
    .eq('athlete_id', row.athlete_id)
    .eq('workout_id', row.workout_id)
    .maybeSingle()) as { scoresheet_id?: string | null } | null;
  // Só sai do ranking o resultado que veio desta súmula (um lançamento manual por cima fica).
  if (!score || score.scoresheet_id !== row.id) return [];
  check(await supabaseAdmin.from('scores').delete().eq('athlete_id', row.athlete_id).eq('workout_id', row.workout_id));
  const athlete = check(await supabaseAdmin.from('athletes').select('division_id').eq('id', row.athlete_id).maybeSingle()) as { division_id: string } | null;
  return athlete ? recalculateWorkoutRanking(supabaseAdmin, row.workout_id, athlete.division_id) : [];
};

/**
 * Ações do gestor sobre uma súmula:
 * - `return`: devolve ao judge com o motivo; o resultado publicado fica até o reenvio;
 * - `correct`: troca o resultado publicado (com justificativa), sem apagar o que o judge lançou;
 * - `cancel`: cancela a súmula (com o motivo) e tira do ranking o resultado que veio dela;
 * - `absent`: marca o atleta ausente (com o motivo), com o pior resultado da prova (Story 1.59).
 */
export const reviewSheet = async (
  supabaseAdmin: SupabaseClient,
  actor: SessionUser,
  sheetId: unknown,
  input: { action?: unknown; reason?: unknown; result?: unknown; tieBreak?: unknown }
) => {
  const { row, absentColumn } = await readSheet(supabaseAdmin, sheetId);
  const reason = readReason(input.reason);
  const at = nowIso();

  if (input.action === 'return') {
    if (row.status !== 'submitted') throw new SheetError('Só uma súmula enviada pode ser devolvida.', 409);
    const patch = { status: 'returned' as const, return_reason: reason, updated_at: at };
    check(await supabaseAdmin.from('scoresheets').update(patch).eq('id', row.id));
    await insertReview(supabaseAdmin, row.id, actor, 'returned', { reason });
    return { sheet: toSheetDto({ ...row, ...patch }), ranking: [] as RankedScoreDto[] };
  }

  if (input.action === 'correct') {
    if (row.status !== 'submitted' && row.status !== 'returned') throw new SheetError('Só uma súmula enviada pode ser corrigida.', 409);
    const workout = check(await supabaseAdmin.from('workouts').select('id, type').eq('id', row.workout_id).maybeSingle()) as { type: WorkoutType } | null;
    if (!workout) throw new SheetError('Prova não encontrada.', 404);
    let parsed;
    if (row.structure.format === 'tonnage') {
      // Tonelagem (Story 1.77): kg com até duas casas, como o gestor digita ("1.652,5"). O parser legado leria a vírgula como erro e o ponto de milhar como decimal.
      const kg = parseTonnageKgInput(input.result);
      if (!kg.ok) throw new SheetError(kg.error);
      parsed = { result: String(kg.kg), value: kg.kg };
    } else if (row.structure.format === 'distance') {
      // Distância (Story 1.68): metros inteiros, como o judge digita. O parser legado leria "6.330" como 6,33.
      const meters = parseMetersInput(input.result);
      if (!meters.ok) throw new SheetError(meters.error);
      parsed = { result: String(meters.meters), value: meters.meters };
    } else {
      try {
        parsed = parseScoreForWorkout(workout.type, input.result);
      } catch (error) {
        throw new SheetError(error instanceof Error ? error.message : 'Resultado inválido.');
      }
    }
    let tieBreak: string | null = null;
    if (typeof input.tieBreak === 'string' && input.tieBreak.trim()) {
      try {
        tieBreak = secondsToTime(timeToSeconds(input.tieBreak));
      } catch {
        throw new SheetError('Informe o tie-break no formato MM:SS.');
      }
    }
    const official: Official = { result: parsed.result, value: parsed.value, tieBreak };
    const { ranking, replaced } = await publish(supabaseAdmin, row, official);
    const patch = {
      status: 'submitted' as const,
      official_result: official.result,
      official_value: official.value,
      official_tie_break: official.tieBreak,
      corrected: true,
      return_reason: null,
      published_at: at,
      updated_at: at,
      ...(row.absent ? { absent: false } : {})
    };
    check(await supabaseAdmin.from('scoresheets').update(patch).eq('id', row.id));
    // O "antes" é o que estava no ranking: um lançamento manual por cima da súmula, se houver.
    await insertReview(supabaseAdmin, row.id, actor, 'corrected', { reason, previous: replaced ?? officialOf(row), applied: official });
    return { sheet: toSheetDto({ ...row, ...patch }), ranking };
  }

  if (input.action === 'cancel') {
    if (row.status === 'cancelled') throw new SheetError('Esta súmula já foi cancelada.', 409);
    const ranking = await removePublishedScore(supabaseAdmin, row);
    const patch = { status: 'cancelled' as const, updated_at: at };
    check(await supabaseAdmin.from('scoresheets').update(patch).eq('id', row.id));
    await insertReview(supabaseAdmin, row.id, actor, 'cancelled', { reason, previous: officialOf(row) });
    return { sheet: toSheetDto({ ...row, ...patch }), ranking };
  }

  if (input.action === 'absent') return markExistingSheetAbsent(supabaseAdmin, actor, row, absentColumn, reason);

  throw new SheetError('Ação desconhecida: use devolver, corrigir, cancelar ou marcar ausente.');
};

/** Súmulas do evento para o painel do gestor, com o nome do atleta e da prova. */
export const listSheetsForManager = async (supabaseAdmin: SupabaseClient, eventId: string) => {
  const sheets = (await selectSheets<SheetRow[] | null>((columns) => supabaseAdmin.from('scoresheets').select(columns).eq('event_id', eventId))).data || [];
  const athleteIds = [...new Set(sheets.map((sheet) => sheet.athlete_id))];
  const athletes = athleteIds.length > 0
    ? (check(await supabaseAdmin.from('athletes').select('id, name, box').in('id', athleteIds)) || []) as { id: string; name: string; box: string }[]
    : [];
  const athleteById = new Map(athletes.map((athlete) => [athlete.id, athlete]));
  return sheets
    .map((sheet) => ({
      ...toSheetDto(sheet),
      structure: undefined,
      athleteName: athleteById.get(sheet.athlete_id)?.name ?? '',
      box: athleteById.get(sheet.athlete_id)?.box ?? ''
    }))
    .sort((a, b) => (a.heatNumber ?? 999) - (b.heatNumber ?? 999) || (a.lane ?? 999) - (b.lane ?? 999) || a.createdAt.localeCompare(b.createdAt));
};

/**
 * Scores gravados das provas que têm súmula, agrupados por prova: o painel do
 * gestor troca os dele por estes (os judges publicam sem passar pelo painel).
 */
export const readScoresForWorkouts = async (supabaseAdmin: SupabaseClient, workoutIds: string[]) => {
  const grouped: Record<string, RankedScoreDto[]> = Object.fromEntries(workoutIds.map((id) => [id, []]));
  if (workoutIds.length === 0) return grouped;
  const rows = (check(await supabaseAdmin
    .from('scores')
    .select('athlete_id, workout_id, result, value, rank, points, splits, result_status')
    .in('workout_id', workoutIds)) || []) as ScoreRow[];
  for (const row of rows) grouped[row.workout_id]?.push(toScoreDto(row));
  return grouped;
};

// ---------------------------------------------------------------------------
// Trava da estrutura e lançamento manual (Stories 1.51 e 1.52)
// ---------------------------------------------------------------------------

/**
 * Quantas súmulas ativas (não canceladas) a prova tem. Com o banco ainda sem a
 * migration, devolve 0: não há súmula, então não há trava.
 */
export const countActiveSheets = async (supabaseAdmin: SupabaseClient, workoutId: string) => {
  const { data, error } = await supabaseAdmin.from('scoresheets').select('id, status').eq('workout_id', workoutId);
  if (error) {
    if (isMissingSheetSchema(error)) return 0;
    throw error;
  }
  return ((data || []) as { status: string }[]).filter((row) => row.status !== 'cancelled').length;
};

type ManualScoreRow = { athlete_id: string; workout_id: string; result: string; value: number } & Record<string, unknown>;

/**
 * Lançamento manual por cima de resultado de súmula (decisão 6 da E3): o
 * resultado que muda deixa de apontar para a súmula e vira um registro no
 * histórico; os outros mantêm a origem. Sem nenhuma súmula envolvida (ou sem a
 * migration), as linhas voltam como vieram. Story 1.59: o resultado de ausente
 * que muda perde o selo (result_status nulo) e a súmula volta a `absent` false;
 * com o mesmo resultado, nada muda e o selo fica.
 */
export const reconcileManualScores = async (supabaseAdmin: SupabaseClient, actor: SessionUser, rows: ManualScoreRow[]) => {
  const workoutIds = [...new Set(rows.map((row) => row.workout_id))];
  if (workoutIds.length === 0) return { rows, touchedPairs: [] as { workoutId: string; athleteId: string }[] };
  const { data, error } = await supabaseAdmin
    .from('scores')
    .select('athlete_id, workout_id, result, value, scoresheet_id, result_status')
    .in('workout_id', workoutIds);
  if (error) {
    if (isMissingSheetSchema(error)) return { rows, touchedPairs: [] };
    throw error;
  }
  type StoredScore = { athlete_id: string; workout_id: string; result: string; value: number; scoresheet_id: string | null; result_status?: string | null };
  const stored = new Map(((data || []) as StoredScore[]).map((score) => [`${score.athlete_id}|${score.workout_id}`, score]));
  const linked = new Map([...stored].filter(([, score]) => score.scoresheet_id));
  if (linked.size === 0) return { rows, touchedPairs: [] };

  const overridden: { sheetId: string; absent: boolean; previous: { result: string; value: number }; applied: { result: string; value: number } }[] = [];
  const reconciled = rows.map((row) => {
    const existing = linked.get(`${row.athlete_id}|${row.workout_id}`);
    if (!existing) return { ...row, scoresheet_id: null };
    const changed = existing.result !== row.result || Number(existing.value) !== Number(row.value);
    if (changed) {
      overridden.push({
        sheetId: existing.scoresheet_id as string,
        absent: existing.result_status === 'absent',
        previous: { result: existing.result, value: Number(existing.value) },
        applied: { result: row.result, value: Number(row.value) }
      });
    }
    return { ...row, scoresheet_id: changed ? null : existing.scoresheet_id };
  });
  // O selo do ausente sai só do resultado que mudou. As linhas vão num upsert
  // em lote, que precisa das mesmas colunas em todas: as outras levam o
  // result_status que já tinham (sem mudança).
  const clearedAbsent = overridden.filter((item) => item.absent);
  const next = clearedAbsent.length === 0 ? reconciled : reconciled.map((row) => {
    const existing = stored.get(`${row.athlete_id}|${row.workout_id}`);
    const cleared = clearedAbsent.some((item) => existing && item.sheetId === existing.scoresheet_id && row.scoresheet_id === null);
    return { ...row, result_status: cleared ? null : existing?.result_status ?? null };
  });
  if (clearedAbsent.length > 0) {
    const written = await supabaseAdmin
      .from('scoresheets')
      .update({ absent: false, updated_at: nowIso() })
      .in('id', clearedAbsent.map((item) => item.sheetId));
    if (written.error && !isMissingAbsentColumn(written.error)) throw written.error;
  }
  for (const item of overridden) {
    await insertReview(supabaseAdmin, item.sheetId, actor, 'manual_override', {
      previous: { ...item.previous, tieBreak: null },
      applied: { ...item.applied, tieBreak: null }
    });
  }
  return { rows: next, touchedPairs: rows.map((row) => ({ workoutId: row.workout_id, athleteId: row.athlete_id })) };
};
