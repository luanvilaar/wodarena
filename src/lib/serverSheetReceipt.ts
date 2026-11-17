import type { SupabaseClient } from '@supabase/supabase-js';

import { computeSheetOutcome } from '@/lib/scoresheet';
import { createSheetReceiptToken, verifySheetReceiptToken, type SessionUser } from '@/lib/serverSecurity';
import { SheetAccessError, assertSheetJudgeAccess, assertSheetManagerAccess, isPresentialEventType } from '@/lib/serverSheetAccess';
import {
  buildSheetReceipt,
  type AthleteReceiptItem,
  type AthleteReceiptRegistration,
  type SheetReceipt,
  type SheetReceiptInput
} from '@/lib/sheetReceipt';
import { sortWorkouts } from '@/lib/workoutOrder';
import type { SheetEvent, WorkoutStructure } from '@/lib/workoutStructure';

// Leitura do comprovante de envio da súmula (Story 1.144; plano em
// docs/design/comprovante-sumula/). Três caminhos:
// - pelo link assinado, sem login (a página do comprovante);
// - pela súmula, com sessão: atleta dono da inscrição, judge do evento, gestor
//   dono do evento e owner (devolve também o link);
// - a lista do atleta logado, para o cartão da inscrição na Área do Atleta.
// Só eventos de Functional Fitness presenciais. Nada de e-mail, telefone ou CPF.

export class SheetReceiptError extends Error {
  constructor(message: string, readonly status = 404) {
    super(message);
    this.name = 'SheetReceiptError';
  }
}

export const SHEET_RECEIPT_NOT_FOUND = 'Comprovante não encontrado.';

type SheetRow = {
  id: string;
  event_id: string;
  workout_id: string;
  athlete_id: string;
  division_id?: string | null;
  heat_id?: string | null;
  heat_number?: number | null;
  lane?: number | null;
  judge_name?: string | null;
  structure?: WorkoutStructure | null;
  status: string;
  absent?: boolean | null;
  corrected?: boolean | null;
  official_result?: string | null;
  official_tie_break?: string | null;
  computed_result?: string | null;
  created_at?: string | null;
  submitted_at?: string | null;
};
type ScheduleItem = { id?: string; kind?: string; date?: string; time?: string };
type EventRow = {
  id: string;
  name: string;
  date?: string | null;
  location?: string | null;
  city?: string | null;
  state?: string | null;
  time_zone?: string | null;
  event_type?: string | null;
  event_schedule?: ScheduleItem[] | null;
};
type WorkoutRow = { id: string; event_id?: string; code?: string | null; name: string; description?: string | null; tie_breaker?: string | null; division_id?: string | null; order_index?: number | null; structure?: unknown };
type AthleteRow = { id: string; name?: string | null; box?: string | null; division_id?: string | null };
type ReviewRow = SheetReceiptInput['reviews'][number] & { sheet_id: string };
type ScoreRow = { athlete_id: string; workout_id: string; result?: string | null; scoresheet_id?: string | null };

const EVENT_COLUMNS = 'id, name, date, location, city, state, time_zone, event_type, event_schedule';
const WORKOUT_COLUMNS = 'id, event_id, code, name, description, tie_breaker, division_id, order_index, structure';

const check = <T>(result: { data: T | null; error: unknown }): T | null => {
  if (result.error) throw result.error;
  return result.data;
};

/**
 * Caminho da página, com o idioma no prefixo, como o link do telão: o ponto do
 * token faz o middleware de idioma tratar o caminho como arquivo e não pôr o prefixo.
 */
export const sheetReceiptPath = (sheetId: string) => `/pt-br/comprovante/sumula/${createSheetReceiptToken(sheetId)}`;

const readSheet = async (supabaseAdmin: SupabaseClient, sheetId: string) =>
  check(await supabaseAdmin.from('scoresheets').select('*').eq('id', sheetId).maybeSingle()) as SheetRow | null;

const heatOf = (event: EventRow, sheet: SheetRow) =>
  (Array.isArray(event.event_schedule) ? event.event_schedule : []).find((item) => item?.kind === 'heat' && item.id === sheet.heat_id) ?? null;

const summaryOf = async (supabaseAdmin: SupabaseClient, sheet: SheetRow) => {
  if (sheet.absent || !sheet.structure) return null;
  const rows = (check(await supabaseAdmin.from('scoresheet_events').select('seq, event').eq('sheet_id', sheet.id).order('seq', { ascending: true })) || []) as { seq: number; event: SheetEvent }[];
  try {
    const outcome = computeSheetOutcome(sheet.structure, [...rows].sort((a, b) => a.seq - b.seq).map((row) => row.event));
    return outcome.ok ? outcome.summary : null;
  } catch {
    return null;
  }
};

const toInput = (parts: {
  sheet: SheetRow;
  event: EventRow;
  workout: WorkoutRow | null;
  athlete: AthleteRow | null;
  divisionName: string;
  reviews: ReviewRow[];
  score: ScoreRow | null;
  summary: string | null;
}): SheetReceiptInput => ({
  sheet: parts.sheet,
  event: parts.event,
  workout: parts.workout,
  athlete: parts.athlete,
  divisionName: parts.divisionName,
  heat: heatOf(parts.event, parts.sheet),
  reviews: parts.reviews,
  score: parts.score,
  summary: parts.summary
});

/** Comprovante de uma súmula; null se não existe, não é de Functional Fitness ou nunca foi enviada. */
const loadReceipt = async (supabaseAdmin: SupabaseClient, sheet: SheetRow): Promise<SheetReceipt | null> => {
  if (!sheet.submitted_at) return null;
  const event = check(await supabaseAdmin.from('events').select(EVENT_COLUMNS).eq('id', sheet.event_id).maybeSingle()) as EventRow | null;
  if (!event || !isPresentialEventType(event.event_type)) return null;
  const [workout, athlete, reviews, scores, summary] = await Promise.all([
    supabaseAdmin.from('workouts').select(WORKOUT_COLUMNS).eq('id', sheet.workout_id).maybeSingle().then((result) => check(result) as WorkoutRow | null),
    supabaseAdmin.from('athletes').select('id, name, box, division_id').eq('id', sheet.athlete_id).maybeSingle().then((result) => check(result) as AthleteRow | null),
    supabaseAdmin.from('scoresheet_reviews').select('sheet_id, action, actor_name, actor_role, previous_result, applied_result, created_at').eq('sheet_id', sheet.id).then((result) => (check(result) || []) as ReviewRow[]),
    supabaseAdmin.from('scores').select('athlete_id, workout_id, result, scoresheet_id').eq('athlete_id', sheet.athlete_id).eq('workout_id', sheet.workout_id).then((result) => (check(result) || []) as ScoreRow[]),
    summaryOf(supabaseAdmin, sheet)
  ]);
  const divisionId = sheet.division_id || athlete?.division_id || null;
  const division = divisionId
    ? check(await supabaseAdmin.from('divisions').select('id, name').eq('id', divisionId).maybeSingle()) as { name?: string } | null
    : null;
  return buildSheetReceipt(toInput({ sheet, event, workout, athlete, divisionName: division?.name ?? '', reviews, score: scores[0] ?? null, summary }));
};

/** Página do comprovante: pelo link assinado, sem login. */
export const readSheetReceiptByToken = async (supabaseAdmin: SupabaseClient, token: string | null | undefined) => {
  const sheetId = verifySheetReceiptToken(token);
  if (!sheetId) return null;
  const sheet = await readSheet(supabaseAdmin, sheetId);
  return sheet ? loadReceipt(supabaseAdmin, sheet) : null;
};

const assertReceiptAccess = async (supabaseAdmin: SupabaseClient, actor: SessionUser, sheet: SheetRow) => {
  if (actor.role === 'athlete') {
    const registrations = (check(await supabaseAdmin
      .from('registrations')
      .select('id, user_id, athlete_email')
      .eq('event_id', sheet.event_id)
      .eq('athlete_id', sheet.athlete_id)) || []) as { user_id?: string | null; athlete_email?: string | null }[];
    const email = (actor.email || '').toLowerCase();
    const mine = registrations.some((row) => row.user_id === actor.id || (email && (row.athlete_email || '').toLowerCase() === email));
    if (!mine) throw new SheetAccessError('Acesso negado para este comprovante.');
    return;
  }
  if (actor.role === 'judge') {
    await assertSheetJudgeAccess(supabaseAdmin, actor, sheet.event_id);
    return;
  }
  await assertSheetManagerAccess(supabaseAdmin, actor, sheet.event_id);
};

/** Comprovante pela súmula, com sessão: atleta dono, judge do evento, gestor dono ou owner. Devolve o link. */
export const readSheetReceiptForActor = async (supabaseAdmin: SupabaseClient, actor: SessionUser, sheetId: unknown) => {
  if (typeof sheetId !== 'string' || !sheetId || sheetId.length > 120) throw new SheetReceiptError('Informe a súmula.', 400);
  const sheet = await readSheet(supabaseAdmin, sheetId);
  if (!sheet) throw new SheetReceiptError(SHEET_RECEIPT_NOT_FOUND);
  await assertReceiptAccess(supabaseAdmin, actor, sheet);
  const receipt = await loadReceipt(supabaseAdmin, sheet);
  if (!receipt) throw new SheetReceiptError('Esta súmula ainda não tem comprovante: ela não foi enviada.');
  return { receipt, path: sheetReceiptPath(sheet.id) };
};


/**
 * Comprovantes do atleta logado, por inscrição aprovada de evento de
 * Functional Fitness: uma linha por prova com súmula digital da categoria dele,
 * com o comprovante da súmula ativa (ou da última cancelada) quando houver.
 */
export const listAthleteSheetReceipts = async (supabaseAdmin: SupabaseClient, actor: SessionUser, registrationId?: string | null): Promise<AthleteReceiptRegistration[]> => {
  type RegistrationRow = { id: string; event_id: string; athlete_id?: string | null; division_id?: string | null; user_id?: string | null; athlete_email?: string | null; payment_status?: string | null };
  const columns = 'id, event_id, athlete_id, division_id, user_id, athlete_email, payment_status';
  const email = (actor.email || '').toLowerCase();
  const [byUser, byEmail] = await Promise.all([
    supabaseAdmin.from('registrations').select(columns).eq('user_id', actor.id).then((result) => (check(result) || []) as RegistrationRow[]),
    email
      ? supabaseAdmin.from('registrations').select(columns).ilike('athlete_email', email).then((result) => (check(result) || []) as RegistrationRow[])
      : Promise.resolve([] as RegistrationRow[])
  ]);
  const registrations = new Map<string, RegistrationRow>();
  for (const row of [...byUser, ...byEmail.filter((item) => (item.athlete_email || '').toLowerCase() === email)]) {
    if (row.payment_status !== 'payment_approved' || !row.athlete_id) continue;
    if (registrationId && row.id !== registrationId) continue;
    registrations.set(row.id, row);
  }
  if (registrations.size === 0) return [];

  const eventIds = [...new Set([...registrations.values()].map((row) => row.event_id))];
  const events = ((check(await supabaseAdmin.from('events').select(EVENT_COLUMNS).in('id', eventIds)) || []) as EventRow[])
    .filter((event) => isPresentialEventType(event.event_type));
  const eventById = new Map(events.map((event) => [event.id, event]));
  const live = [...registrations.values()].filter((row) => eventById.has(row.event_id));
  if (live.length === 0) return [];

  const athleteIds = [...new Set(live.map((row) => row.athlete_id as string))];
  const [workouts, sheets, athletes] = await Promise.all([
    supabaseAdmin.from('workouts').select(WORKOUT_COLUMNS).in('event_id', [...eventById.keys()]).then((result) => (check(result) || []) as WorkoutRow[]),
    supabaseAdmin.from('scoresheets').select('*').in('athlete_id', athleteIds).then((result) => (check(result) || []) as SheetRow[]),
    supabaseAdmin.from('athletes').select('id, name, box, division_id').in('id', athleteIds).then((result) => (check(result) || []) as AthleteRow[])
  ]);
  const sent = sheets.filter((sheet) => sheet.submitted_at && eventById.has(sheet.event_id));
  const sheetIds = sent.map((sheet) => sheet.id);
  const workoutIds = [...new Set(sent.map((sheet) => sheet.workout_id))];
  const divisionIds = [...new Set(live.map((row) => row.division_id).filter((id): id is string => Boolean(id)))];
  const [reviews, scores, divisions] = await Promise.all([
    sheetIds.length ? supabaseAdmin.from('scoresheet_reviews').select('sheet_id, action, actor_name, actor_role, previous_result, applied_result, created_at').in('sheet_id', sheetIds).then((result) => (check(result) || []) as ReviewRow[]) : Promise.resolve([] as ReviewRow[]),
    workoutIds.length ? supabaseAdmin.from('scores').select('athlete_id, workout_id, result, scoresheet_id').in('athlete_id', athleteIds).in('workout_id', workoutIds).then((result) => (check(result) || []) as ScoreRow[]) : Promise.resolve([] as ScoreRow[]),
    divisionIds.length ? supabaseAdmin.from('divisions').select('id, name').in('id', divisionIds).then((result) => (check(result) || []) as { id: string; name: string }[]) : Promise.resolve([] as { id: string; name: string }[])
  ]);
  const athleteById = new Map(athletes.map((athlete) => [athlete.id, athlete]));
  const divisionName = new Map(divisions.map((division) => [division.id, division.name]));
  const newest = (a: SheetRow, b: SheetRow) => String(b.submitted_at).localeCompare(String(a.submitted_at));

  return live.map((registration) => {
    const event = eventById.get(registration.event_id) as EventRow;
    const applicable = sortWorkouts(workouts
      .filter((workout) => workout.event_id === event.id && Boolean(workout.structure) && (!workout.division_id || workout.division_id === registration.division_id))
      .map((workout) => ({ ...workout, code: workout.code ?? '', orderIndex: workout.order_index ?? null })));
    const provas = applicable.map((workout): AthleteReceiptItem => {
      const mine = sent.filter((sheet) => sheet.workout_id === workout.id && sheet.athlete_id === registration.athlete_id).sort(newest);
      const sheet = mine.find((item) => item.status !== 'cancelled') ?? mine[0] ?? null;
      const receipt = sheet ? buildSheetReceipt(toInput({
        sheet,
        event,
        workout,
        athlete: athleteById.get(sheet.athlete_id) ?? null,
        divisionName: divisionName.get(registration.division_id ?? '') ?? '',
        reviews: reviews.filter((review) => review.sheet_id === sheet.id),
        score: scores.find((score) => score.athlete_id === sheet.athlete_id && score.workout_id === sheet.workout_id) ?? null,
        summary: null
      })) : null;
      return {
        workoutId: workout.id,
        code: workout.code || workout.name,
        receipt: receipt && sheet ? {
          sheetId: sheet.id,
          state: receipt.state,
          stateLabel: receipt.stateLabel,
          result: `${receipt.result.value}${receipt.result.unit ? ` ${receipt.result.unit}` : ''}`,
          struck: receipt.result.struck,
          heatNumber: receipt.heat.number,
          lane: receipt.heat.lane,
          scheduled: receipt.heat.scheduled,
          judgeName: receipt.judgeName,
          path: sheetReceiptPath(sheet.id)
        } : null
      };
    });
    return { registrationId: registration.id, eventId: event.id, provas };
  });
};
