import { createHash, randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import { sanitizeNamePII } from '@/lib/bootstrapPayload';
import {
  BROADCAST_MODES,
  buildGroups,
  nextHeat,
  resolveBroadcast,
  sheetGroupKey,
  type BroadcastMode,
  type HeatMark,
  type ModeHeat,
  type ModeSheet
} from '@/lib/broadcastMode';
import {
  intervalMaxLine,
  type BroadcastCallLane,
  type BroadcastHeat,
  type BroadcastIntervalSpec,
  type BroadcastLiveEntry,
  type BroadcastNext,
  type BroadcastPayload,
  type BroadcastStandingsBoard,
  type BroadcastWorkout
} from '@/lib/broadcastPayload';
import { sortDivisions } from '@/lib/divisionOrder';
import { computeDivisionStandings } from '@/lib/leaderboardStandings';
import { rankLiveEntries } from '@/lib/liveHeatRanking';
import { readLiveProgress, type LiveProgress } from '@/lib/liveProgress';
import { rankWorkoutScores } from '@/lib/scoring';
import { buildLiveProgress } from '@/lib/serverScoresheets';
import type { SessionUser } from '@/lib/serverSecurity';
import { getTeamDisplayName } from '@/lib/teamDisplay';
import { sortWorkouts } from '@/lib/workoutOrder';
import { formatWorkoutTime, validateWorkoutStructure, type SheetEvent, type WorkoutStructure } from '@/lib/workoutStructure';
import type { Athlete, Score, Workout, WorkoutType } from '@/types';

// Telão ao vivo no servidor (Stories 1.53 a 1.58). O link do telão é um token
// aleatório; o banco guarda só o SHA-256 dele. O estado da tela é montado aqui a
// cada leitura: quem está sendo julgado sai das súmulas (broadcastMode.ts), o
// progresso de cada raia sai de scoresheets.live_progress (calculado no
// servidor a cada lote) e o geral da categoria usa a mesma regra do leaderboard
// do site (leaderboardStandings.ts) e a mesma elegibilidade (leaderboard_entries).

export class BroadcastError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'BroadcastError';
  }
}

/** Evento Fitness Race ou Qualifier no telão (mesa e link). */
export const BROADCAST_EVENT_TYPE_MESSAGE = 'O telão ao vivo é exclusivo de eventos Functional Fitness presenciais.';

const UNAVAILABLE_MESSAGE = 'O telão ainda não está disponível neste ambiente. Aplique a migration do telão antes de usar.';

/** Tabela ou coluna do telão ainda não criada (migration 20261020120000 pendente). */
export const isMissingBroadcastSchema = (error: unknown) => {
  const details = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : null;
  const code = typeof details?.code === 'string' ? details.code : '';
  const message = typeof details?.message === 'string' ? details.message : '';
  return code === '42P01' || code === 'PGRST205' || ((code === '42703' || code === 'PGRST204') && /broadcast|live_progress/.test(message));
};

const check = <T>(result: { data: T; error: unknown }) => {
  if (result.error) {
    if (isMissingBroadcastSchema(result.error)) throw new BroadcastError(UNAVAILABLE_MESSAGE, 503);
    throw result.error;
  }
  return result.data;
};

const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Link do telão
// ---------------------------------------------------------------------------

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{24,64}$/;

export const hashBroadcastToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const isBroadcastTokenFormat = (token: unknown): token is string => typeof token === 'string' && TOKEN_PATTERN.test(token);

export type BroadcastConfig = {
  event_id: string;
  token_hash: string | null;
  token_created_at: string | null;
  token_revoked_at: string | null;
  mode: BroadcastMode;
  pinned_heat_id: string | null;
  pinned_division_id: string | null;
  updated_at: string;
};

const CONFIG_SELECT = 'event_id, token_hash, token_created_at, token_revoked_at, mode, pinned_heat_id, pinned_division_id, updated_at';

const defaultConfig = (eventId: string): BroadcastConfig => ({
  event_id: eventId,
  token_hash: null,
  token_created_at: null,
  token_revoked_at: null,
  mode: 'auto',
  pinned_heat_id: null,
  pinned_division_id: null,
  updated_at: nowIso()
});

export const readBroadcastConfig = async (supabaseAdmin: SupabaseClient, eventId: string) => {
  const row = check(await supabaseAdmin.from('event_broadcasts').select(CONFIG_SELECT).eq('event_id', eventId).maybeSingle()) as BroadcastConfig | null;
  return row ?? defaultConfig(eventId);
};

/** Configuração do evento dono deste link, ou null (link inexistente ou revogado). */
export const findBroadcastByToken = async (supabaseAdmin: SupabaseClient, token: unknown) => {
  if (!isBroadcastTokenFormat(token)) return null;
  const row = check(await supabaseAdmin
    .from('event_broadcasts')
    .select(CONFIG_SELECT)
    .eq('token_hash', hashBroadcastToken(token))
    .maybeSingle()) as BroadcastConfig | null;
  return row && row.token_hash && !row.token_revoked_at ? row : null;
};

const writeConfig = async (supabaseAdmin: SupabaseClient, actor: SessionUser, eventId: string, patch: Partial<BroadcastConfig>) => {
  check(await supabaseAdmin.from('event_broadcasts').upsert({
    event_id: eventId,
    ...patch,
    updated_by: actor.id,
    updated_at: nowIso()
  }, { onConflict: 'event_id' }));
  return readBroadcastConfig(supabaseAdmin, eventId);
};

/** Gera um link novo (o anterior para de funcionar). O token só existe nesta resposta. */
export const generateBroadcastLink = async (supabaseAdmin: SupabaseClient, actor: SessionUser, eventId: string) => {
  const token = randomBytes(24).toString('base64url');
  const createdAt = nowIso();
  await writeConfig(supabaseAdmin, actor, eventId, { token_hash: hashBroadcastToken(token), token_created_at: createdAt, token_revoked_at: null });
  return { token, createdAt };
};

export const revokeBroadcastLink = (supabaseAdmin: SupabaseClient, actor: SessionUser, eventId: string) => (
  writeConfig(supabaseAdmin, actor, eventId, { token_hash: null, token_revoked_at: nowIso() })
);

export const setBroadcastMode = async (
  supabaseAdmin: SupabaseClient,
  actor: SessionUser,
  eventId: string,
  input: { mode?: unknown; heatId?: unknown; divisionId?: unknown }
) => {
  const mode = BROADCAST_MODES.find((item) => item === input.mode);
  if (!mode) throw new BroadcastError('Escolha o que o telão mostra.');
  const patch: Partial<BroadcastConfig> = { mode, pinned_heat_id: null, pinned_division_id: null };
  if (mode === 'pin_heat') {
    if (typeof input.heatId !== 'string' || !input.heatId || input.heatId.length > 200) throw new BroadcastError('Escolha a bateria que fica no telão.');
    patch.pinned_heat_id = input.heatId;
  }
  if (mode === 'pin_standings') {
    if (typeof input.divisionId !== 'string' || !input.divisionId) throw new BroadcastError('Escolha a categoria do geral.');
    const division = check(await supabaseAdmin.from('divisions').select('id, event_id').eq('id', input.divisionId).maybeSingle()) as { event_id: string } | null;
    if (!division || division.event_id !== eventId) throw new BroadcastError('Categoria não encontrada neste evento.', 404);
    patch.pinned_division_id = input.divisionId;
  }
  return writeConfig(supabaseAdmin, actor, eventId, patch);
};

/** "Encerrar" numa bateria sem nenhum registro nas súmulas (só a Chamada). */
export const FINISH_WITHOUT_RECORD_MESSAGE = 'Esta bateria ainda não tem nenhum registro nas súmulas, então não há o que encerrar. Se as súmulas foram abertas por engano, cancele-as na área de súmulas para tirar a chamada do ar.';

/**
 * Marca a bateria (grupo de súmulas) na mesa do gestor: `start` acerta o relógio
 * do telão no sinal oficial (e desfaz um encerramento anterior da mesma
 * bateria), `finish` força o intervalo com súmula pendente e `reopen` desfaz o
 * encerramento.
 *
 * `finish` só vale para bateria que já começou (alguma súmula com registro ou
 * enviada). Encerrar uma bateria que ainda está na Chamada gravaria a marca
 * antes do primeiro toque, e com ela a bateria nunca entraria ao vivo.
 */
export const markBroadcastHeat = async (
  supabaseAdmin: SupabaseClient,
  actor: SessionUser,
  eventId: string,
  input: { heatId?: unknown; mark?: unknown }
) => {
  if (typeof input.heatId !== 'string' || !input.heatId || input.heatId.length > 200) throw new BroadcastError('Informe a bateria.');
  const heatId = input.heatId;
  const at = nowIso();
  const patch = input.mark === 'start'
    ? { started_at: at, started_by: actor.id, finished_at: null, finished_by: null }
    : input.mark === 'finish'
      ? { finished_at: at, finished_by: actor.id }
      : input.mark === 'reopen'
        ? { finished_at: null, finished_by: null }
        : null;
  if (!patch) throw new BroadcastError('Ação desconhecida: use largada, encerrar ou reabrir.');
  if (input.mark === 'finish') {
    // Mesma regra do motor (broadcastMode.ts): o grupo é a bateria ou, sem
    // bateria, a prova e a categoria; súmula cancelada não conta.
    const sheets = await readBroadcastSheets(supabaseAdmin, eventId);
    const started = sheets.some((sheet) => sheet.status !== 'cancelled'
      && sheetGroupKey({ heatId: sheet.heat_id, workoutId: sheet.workout_id, divisionId: sheet.division_id }) === heatId
      && (sheet.status === 'submitted' || sheetSeq(sheet) > 0));
    if (!started) throw new BroadcastError(FINISH_WITHOUT_RECORD_MESSAGE, 409);
  }
  check(await supabaseAdmin.from('broadcast_heat_states').upsert({
    event_id: eventId,
    heat_id: heatId,
    ...patch,
    updated_at: at
  }, { onConflict: 'event_id,heat_id' }));
};

// ---------------------------------------------------------------------------
// Leitura do evento
// ---------------------------------------------------------------------------

type ScheduleItem = { id?: unknown; kind?: unknown; workoutId?: unknown; heatNumber?: unknown; date?: unknown; time?: unknown; title?: unknown; athleteIds?: unknown; isCallReleased?: unknown };

type EventRow = { id: string; name: string | null; logo_url: string | null; date: string | null; event_type: string | null; event_schedule: unknown };
type DivisionRow = { id: string; name: string; order_index: number | null };
type WorkoutRow = { id: string; name: string; code: string | null; order_index: number | null; division_id: string | null; type: WorkoutType; tie_breaker: string | null; time_cap: string | null; submission_closes_at: string | null; structure: unknown };
type SheetRow = {
  id: string;
  workout_id: string;
  athlete_id: string;
  division_id: string | null;
  heat_id: string | null;
  lane: number | null;
  status: ModeSheet['status'];
  official_result: string | null;
  submitted_at: string | null;
  updated_at: string;
  /** Só o contador do log (`live_progress->seq`); o JSON inteiro é lido só para a bateria no ar. */
  seq?: unknown;
};
type AthleteRow = { id: string; name: string; box: string | null; division_id: string; is_team: boolean | null };
type HeatRow = { heat_id: string; started_at: string | null; finished_at: string | null };

const SHEET_SELECT = 'id, workout_id, athlete_id, division_id, heat_id, lane, status, official_result, submitted_at, updated_at, seq:live_progress->seq';

type ScheduleHeat = ModeHeat & { workoutId: string; heatNumber: number | null; date: string; time: string; title: string; athleteIds: string[] };

export const readScheduleHeats = (schedule: unknown): ScheduleHeat[] => {
  const items = Array.isArray(schedule) ? schedule as ScheduleItem[] : [];
  return items
    .filter((item) => item && item.kind === 'heat' && typeof item.id === 'string' && typeof item.workoutId === 'string')
    .map((item) => ({
      id: String(item.id),
      workoutId: String(item.workoutId),
      heatNumber: typeof item.heatNumber === 'number' ? item.heatNumber : null,
      date: typeof item.date === 'string' ? item.date : '',
      time: typeof item.time === 'string' ? item.time : '',
      title: typeof item.title === 'string' ? item.title.trim() : '',
      athleteIds: Array.isArray(item.athleteIds) ? item.athleteIds.map((id) => (typeof id === 'string' ? id.trim() : '')) : [],
      isCallReleased: item.isCallReleased === true,
      order: 0
    }))
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`) || (a.heatNumber ?? 0) - (b.heatNumber ?? 0))
    .map((heat, index) => ({ ...heat, order: index }));
};

const readStructure = (raw: unknown): WorkoutStructure | null => {
  if (!raw) return null;
  const checked = validateWorkoutStructure(raw);
  return checked.ok ? checked.structure : null;
};

const unitText = (unit: string) => (unit === 'cal' ? ' cal' : unit === 'm' ? ' m' : '');

const MAX_BOARD_LINES = 8;

/** Corta a lista da chamada em 8 linhas ("+ N etapas"); a linha `last` (o máximo do intervalado) fica sempre por último. */
const capBoardLines = (lines: string[], last: string | null) => {
  const room = last === null ? MAX_BOARD_LINES : MAX_BOARD_LINES - 1;
  const head = lines.length > room ? [...lines.slice(0, room - 1), `+ ${lines.length - (room - 1)} etapas`] : lines;
  return last === null ? head : [...head, last];
};

/** Maior largura de uma linha da chamada da distância (a tela corta com reticências de qualquer jeito). */
const DISTANCE_LINE_LIMIT = 60;
/** A chamada da distância mostra no máximo estas linhas do resumo (o gestor separa com ";" ou quebra de linha). */
const DISTANCE_MAX_LINES = 6;

/**
 * Linhas da chamada da distância (Story 1.69): o resumo da prova separado por
 * ";" e por quebra de linha, cada uma limitada a 60 caracteres; sem resumo, a
 * linha "Maior distância em 20:00". Só dados da prova, nada de pessoa.
 */
const distanceBoardLines = (structure: WorkoutStructure) => {
  const lines = (structure.distance?.note ?? '')
    .split(/[;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, DISTANCE_MAX_LINES)
    .map((part) => (part.length > DISTANCE_LINE_LIMIT ? `${part.slice(0, DISTANCE_LINE_LIMIT - 1).trimEnd()}…` : part));
  return lines.length > 0 ? lines : [`Maior distância em ${formatWorkoutTime(structure.timeCapSeconds ?? 0)}`];
};

/**
 * Linhas da chamada da tonelagem (Story 1.81): os exercícios na ordem da prova,
 * com o que conta marcado e a carga prescrita quando houver. Só dados da prova,
 * nada de pessoa.
 */
const tonnageBoardLines = (structure: WorkoutStructure) => {
  const tonnage = structure.tonnage;
  if (!tonnage) return [];
  const labels = structure.segments.map((segment) => `${segment.reps}${unitText(segment.unit)} ${segment.name}${segment.load ? ` ${segment.load.value} kg` : ''}`);
  const lift = `${tonnage.lift.name}${tonnage.loadMode === 'prescribed' && tonnage.lift.loadKg !== null ? ` ${tonnage.lift.loadKg} kg` : ''} · tonelagem`;
  return [...labels.slice(0, tonnage.position), lift, ...labels.slice(tonnage.position)];
};

/** Bloco do formato Intervalado (Story 1.63); null nos outros formatos. Só dados da prova, nada de pessoa. */
const describeIntervalSpec = (structure: WorkoutStructure): BroadcastIntervalSpec | null => {
  const interval = structure.format === 'interval' ? structure.interval : null;
  if (!interval) return null;
  return {
    rounds: interval.rounds,
    onSeconds: interval.onSeconds,
    offSeconds: interval.offSeconds,
    max: { id: interval.max.id, name: interval.max.name, loadKg: interval.max.load ? interval.max.load.value : null }
  };
};

/** A prova como o telão mostra: esquema, linhas da chamada e segmentos da barra de progresso. */
export const describeWorkoutForBoard = (row: Pick<WorkoutRow, 'name' | 'code'>, structure: WorkoutStructure): BroadcastWorkout => {
  // Tonelagem: a barra de progresso é a da liberação (só os exercícios antes do que conta); os de depois são só texto.
  const barSegments = structure.format === 'tonnage' ? structure.segments.slice(0, structure.tonnage?.position ?? 0) : structure.segments;
  const segments = barSegments.map((segment) => {
    const load = segment.load ? ` ${segment.load.value} kg` : '';
    return { id: segment.id, name: segment.name, reps: segment.reps, unit: segment.unit, label: `${segment.reps}${unitText(segment.unit)} ${segment.name}${load}` };
  });
  const generator = structure.generator;
  const scheme = generator && generator.reps.length > 1
    ? (generator.kind === 'fixed' ? `${generator.reps.length} rounds` : generator.reps.join('-'))
    : null;
  let lines: string[];
  if (structure.format === 'tonnage') lines = tonnageBoardLines(structure);
  else if (structure.format === 'distance') lines = distanceBoardLines(structure);
  else if (structure.format === 'max_load') {
    lines = (structure.maxLoad?.lifts ?? []).map((lift) => (lift.reps > 1 ? `${lift.name} · ${lift.reps}RM` : lift.name));
  } else if (scheme) {
    lines = [...new Set(structure.segments.map((segment) => `${segment.name}${segment.load ? ` ${segment.load.value} kg` : ''}`))];
  } else lines = segments.map((segment) => segment.label);
  // Intervalado: os fixos como nos outros formatos e, por último, a linha do máximo (que não tem meta nem entra na barra).
  const intervalSpec = describeIntervalSpec(structure);
  return {
    name: row.name,
    code: row.code ?? '',
    format: structure.format,
    timeCapSeconds: structure.timeCapSeconds,
    scheme,
    lines: capBoardLines(lines, intervalSpec ? intervalMaxLine(intervalSpec.max) : null),
    segments,
    lifts: (structure.maxLoad?.lifts ?? []).map((lift) => ({ id: lift.id, name: lift.name })),
    totalReps: structure.totalReps,
    scoreDisplay: structure.scoreDisplay,
    intervalSpec,
    tonnageLift: structure.format === 'tonnage' ? structure.tonnage?.lift.name ?? null : null
  };
};

const displayName = (athlete: AthleteRow | undefined) => (
  athlete ? getTeamDisplayName({ name: sanitizeNamePII(athlete.name), isTeam: Boolean(athlete.is_team) }) : 'Atleta'
);

const minIso = (values: (string | null | undefined)[]) => {
  const times = values.map((value) => (value ? Date.parse(value) : Number.NaN)).filter(Number.isFinite);
  return times.length ? new Date(Math.min(...times)).toISOString() : null;
};

const fingerprint = (value: unknown) => createHash('sha1').update(JSON.stringify(value)).digest('base64url').slice(0, 16);

/** Linhas por página: o "Max rows" padrão do PostgREST no Supabase (acima disso ele corta sem erro). */
export const SHEET_PAGE_SIZE = 1000;
const MAX_PAGES = 100;

/**
 * Lê todas as páginas de uma consulta (`range` sobre uma ordem estável) até vir
 * uma página incompleta. `fetchPage` recebe o intervalo inclusivo de linhas.
 */
export const readAllPages = async <T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
  pageSize = SHEET_PAGE_SIZE
): Promise<T[]> => {
  const rows: T[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * pageSize;
    const data = (check(await fetchPage(from, from + pageSize - 1)) || []) as T[];
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
  console.warn(`Telão: leitura parada em ${MAX_PAGES * pageSize} linhas.`);
  return rows;
};

/**
 * Todas as súmulas do evento, só com as colunas leves (o progresso vem só como
 * `seq`), paginadas pelo id. O motor de modo precisa de todas: `nextHeat` usa
 * as baterias já tocadas para saber a próxima.
 *
 * A paginação é por posição: uma súmula aberta durante a leitura, com id menor
 * que o da borda da página, empurra a linha da borda para a página seguinte, e
 * ela viria duas vezes. Fica uma linha por id (a lida por último, na posição da
 * primeira); a súmula nova entra na leitura seguinte.
 */
export const readBroadcastSheets = async (supabaseAdmin: SupabaseClient, eventId: string, pageSize = SHEET_PAGE_SIZE) => {
  const rows = await readAllPages<SheetRow>((from, to) => supabaseAdmin
    .from('scoresheets')
    .select(SHEET_SELECT)
    .eq('event_id', eventId)
    .order('id', { ascending: true })
    .range(from, to), pageSize);
  const byId = new Map<string, SheetRow>();
  for (const row of rows) byId.set(row.id, row);
  return [...byId.values()];
};

const sheetSeq = (sheet: SheetRow) => (typeof sheet.seq === 'number' && Number.isFinite(sheet.seq) ? sheet.seq : 0);

/**
 * Progresso das súmulas do grupo; as que não têm o resumo completo gravado (só
 * o contador `{ seq }`, quando o resumo falhou no lote) são calculadas do log.
 * Se o cálculo falhar também aqui, a raia fica sem progresso, sem derrubar o telão.
 */
const readGroupProgress = async (supabaseAdmin: SupabaseClient, sheets: SheetRow[], structure: WorkoutStructure) => {
  const progress = new Map<string, LiveProgress | null>();
  if (sheets.length === 0) return progress;
  const storedRows = (check(await supabaseAdmin
    .from('scoresheets')
    .select('id, live_progress')
    .in('id', sheets.map((sheet) => sheet.id))) || []) as { id: string; live_progress: unknown }[];
  const storedById = new Map(storedRows.map((row) => [row.id, readLiveProgress(row.live_progress)]));
  const missing: string[] = [];
  for (const sheet of sheets) {
    const stored = storedById.get(sheet.id) ?? null;
    progress.set(sheet.id, stored);
    if (!stored) missing.push(sheet.id);
  }
  if (missing.length > 0) {
    const rows = (check(await supabaseAdmin
      .from('scoresheet_events')
      .select('sheet_id, seq, client_event_id, event, recorded_at')
      .in('sheet_id', missing)
      .order('seq', { ascending: true })) || []) as { sheet_id: string; seq: number; client_event_id: string; event: SheetEvent; recorded_at: string | null }[];
    for (const sheetId of missing) {
      const events = rows.filter((row) => row.sheet_id === sheetId).sort((a, b) => a.seq - b.seq);
      let item: LiveProgress | null = null;
      try {
        item = events.length > 0 ? buildLiveProgress(structure, events) : null;
      } catch (error) {
        console.error('Telão: erro ao calcular o progresso da súmula pelo log:', error);
      }
      progress.set(sheetId, item);
    }
  }
  return progress;
};

// ---------------------------------------------------------------------------
// Geral da categoria (intervalo)
// ---------------------------------------------------------------------------

const toWorkout = (row: WorkoutRow): Workout => ({
  id: row.id,
  name: row.name,
  description: '',
  type: row.type,
  timeCap: row.time_cap ?? undefined,
  code: row.code ?? '',
  orderIndex: Number(row.order_index ?? 0),
  divisionId: row.division_id ?? undefined,
  tieBreaker: row.tie_breaker ?? undefined,
  submissionClosesAt: row.submission_closes_at ?? undefined
});

type ScoreRow = { athlete_id: string; workout_id: string; result: string; value: number; rank: number | null; points: number | null; splits: Record<string, string> | null; result_status: string | null };

const toScore = (row: ScoreRow): Score => ({
  athleteId: row.athlete_id,
  workoutId: row.workout_id,
  result: row.result,
  value: Number(row.value),
  rank: row.rank ?? undefined,
  points: row.points ?? undefined,
  splits: row.splits || {},
  resultStatus: (row.result_status || undefined) as Score['resultStatus']
});

const MAX_COLUMNS = 4;

const buildStandingsBoards = async (
  supabaseAdmin: SupabaseClient,
  event: EventRow,
  divisions: DivisionRow[],
  workoutRows: WorkoutRow[],
  divisionIds: string[],
  fresh: { workoutId: string; athleteIds: Set<string> } | null
): Promise<BroadcastStandingsBoard[]> => {
  if (divisionIds.length === 0) return [];
  const workouts = sortWorkouts(workoutRows.map(toWorkout));
  const workoutIds = workouts.map((workout) => workout.id);
  const [athleteRows, scoreRows, entryRows] = await Promise.all([
    supabaseAdmin.from('athletes').select('id, name, box, division_id, is_team').in('division_id', divisionIds),
    workoutIds.length > 0
      ? supabaseAdmin.from('scores').select('athlete_id, workout_id, result, value, rank, points, splits, result_status').in('workout_id', workoutIds)
      : Promise.resolve({ data: [], error: null }),
    supabaseAdmin.from('leaderboard_entries').select('athlete_id, division_id').eq('event_id', event.id)
  ]);
  const athletes = (check(athleteRows) || []) as AthleteRow[];
  const scores = ((check(scoreRows) || []) as ScoreRow[]).map(toScore);
  const entries = (check(entryRows) || []) as { athlete_id: string; division_id: string }[];
  const eventInput = { date: event.date ?? '', eventType: 'functional_fitness' as const, workouts };

  const boards: BroadcastStandingsBoard[] = [];
  for (const division of sortDivisions(divisions.filter((item) => divisionIds.includes(item.id)).map((item) => ({ ...item, orderIndex: item.order_index })))) {
    const eligible = new Set(entries.filter((entry) => entry.division_id === division.id).map((entry) => entry.athlete_id));
    const divisionAthletes: Athlete[] = athletes
      .filter((athlete) => athlete.division_id === division.id && eligible.has(athlete.id))
      .map((athlete) => ({ id: athlete.id, name: displayName(athlete), box: athlete.box ?? '', country: '', divisionId: athlete.division_id }));
    const after = computeDivisionStandings({ event: eventInput, divisionId: division.id, divisionAthletes, scores });

    // "Antes" desta bateria: sem os resultados recém-publicados, com a prova reclassificada.
    let before = after;
    const freshInDivision = fresh ? divisionAthletes.filter((athlete) => fresh.athleteIds.has(athlete.id)).map((athlete) => athlete.id) : [];
    if (fresh && freshInDivision.length > 0) {
      const workout = workouts.find((item) => item.id === fresh.workoutId);
      // Mesmo conjunto da publicação (recalculateWorkoutRanking): a prova é
      // classificada por categoria, com todos os atletas dela, mesmo quando é
      // compartilhada entre categorias (division_id null).
      const members = new Set(athletes.filter((athlete) => athlete.division_id === division.id).map((athlete) => athlete.id));
      const remaining = scores.filter((score) => score.workoutId === fresh.workoutId && members.has(score.athleteId) && !freshInDivision.includes(score.athleteId));
      const reranked = workout ? rankWorkoutScores(workout.type, workout.tieBreaker || '', remaining, members.size) : remaining;
      const beforeScores = [...scores.filter((score) => score.workoutId !== fresh.workoutId), ...reranked];
      before = computeDivisionStandings({ event: eventInput, divisionId: division.id, divisionAthletes, scores: beforeScores });
    }
    const beforeRank = new Map(before.map((item) => [item.athlete.id, item.rank]));

    const divisionWorkouts = workouts.filter((workout) => !workout.divisionId || workout.divisionId === division.id);
    const scored = divisionWorkouts.filter((workout) => after.some((item) => {
      const score = item.scores[workout.id];
      return score && score.result !== '-' && score.result !== '';
    }));
    const freshIndex = fresh ? scored.findIndex((workout) => workout.id === fresh.workoutId) : -1;
    const end = freshIndex >= 0 ? freshIndex + 1 : scored.length;
    const columns = scored.slice(Math.max(0, end - MAX_COLUMNS), end);

    boards.push({
      divisionName: division.name,
      athleteCount: divisionAthletes.length,
      columns: columns.map((workout) => ({ label: workout.code || workout.name, fresh: workout.id === fresh?.workoutId })),
      rows: after.map((item) => ({
        position: item.rank,
        delta: (beforeRank.get(item.athlete.id) ?? item.rank) - item.rank,
        name: item.athlete.name,
        box: item.athlete.box,
        fresh: freshInDivision.includes(item.athlete.id),
        cells: columns.map((workout) => {
          const score = item.scores[workout.id];
          return score && score.result !== '-' && score.result !== '' ? { rank: score.rank ?? 0, result: score.result } : null;
        }),
        points: item.totalPoints
      }))
    });
  }
  return boards;
};

// ---------------------------------------------------------------------------
// Estado do telão
// ---------------------------------------------------------------------------

const APP_VERSION = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || '';

export const buildBroadcastState = async (
  supabaseAdmin: SupabaseClient,
  eventId: string,
  config: BroadcastConfig,
  nowMs = Date.now()
): Promise<BroadcastPayload> => {
  const eventRow = check(await supabaseAdmin
    .from('events')
    .select('id, name, logo_url, date, event_type, event_schedule')
    .eq('id', eventId)
    .maybeSingle()) as EventRow | null;
  if (!eventRow) throw new BroadcastError('Evento não encontrado.', 404);
  if (eventRow.event_type && eventRow.event_type !== 'functional_fitness') {
    throw new BroadcastError(BROADCAST_EVENT_TYPE_MESSAGE, 400);
  }

  const [divisionResult, workoutResult, sheets, markResult] = await Promise.all([
    supabaseAdmin.from('divisions').select('id, name, order_index').eq('event_id', eventId),
    supabaseAdmin.from('workouts').select('id, name, code, order_index, division_id, type, tie_breaker, time_cap, submission_closes_at, structure').eq('event_id', eventId),
    readBroadcastSheets(supabaseAdmin, eventId),
    supabaseAdmin.from('broadcast_heat_states').select('heat_id, started_at, finished_at').eq('event_id', eventId)
  ]);
  const divisions = (check(divisionResult) || []) as DivisionRow[];
  const workoutRows = (check(workoutResult) || []) as WorkoutRow[];
  const marks: HeatMark[] = ((check(markResult) || []) as HeatRow[]).map((row) => ({ heatId: row.heat_id, startedAt: row.started_at, finishedAt: row.finished_at }));
  const heats = readScheduleHeats(eventRow.event_schedule);

  const modeSheets = sheets.map((sheet) => ({
    sheet,
    mode: {
      heatId: sheet.heat_id,
      workoutId: sheet.workout_id,
      divisionId: sheet.division_id,
      status: sheet.status,
      seq: sheetSeq(sheet),
      updatedAt: sheet.updated_at,
      submittedAt: sheet.submitted_at
    } satisfies ModeSheet
  }));
  const modeInput = { sheets: modeSheets.map((item) => item.mode), marks, nowMs };
  const groups = buildGroups(modeInput);
  const resolution = resolveBroadcast({
    mode: config.mode,
    pinnedHeatId: config.pinned_heat_id,
    pinnedDivisionId: config.pinned_division_id,
    heats,
    ...modeInput
  }, groups);
  const following = nextHeat(heats, groups);
  // Próximas baterias: a partir da próxima de verdade (sem as passadas nem as
  // já tocadas), no máximo 4. Servem à faixa "Próxima bateria" e à espera.
  const touched = new Set(groups.map((group) => group.key));
  const upcoming = following ? heats.filter((heat) => heat.order >= following.order && !touched.has(heat.id)).slice(0, 4) : [];

  const divisionName = new Map(divisions.map((division) => [division.id, division.name]));
  const workoutById = new Map(workoutRows.map((row) => [row.id, row]));
  const heatById = new Map(heats.map((heat) => [heat.id, heat]));
  const groupSheets = (key: string) => modeSheets.filter((item) => item.sheet.status !== 'cancelled' && sheetGroupKey(item.mode) === key).map((item) => item.sheet);

  const athleteIds = new Set<string>();
  const wantedHeat = resolution.screen === 'live' || resolution.screen === 'call' ? resolution.groupKey : null;
  if (wantedHeat) {
    groupSheets(wantedHeat).forEach((sheet) => athleteIds.add(sheet.athlete_id));
    heatById.get(wantedHeat)?.athleteIds.forEach((id) => id && athleteIds.add(id));
  }
  upcoming.forEach((heat) => heat.athleteIds.forEach((id) => id && athleteIds.add(id)));
  const athletes = athleteIds.size > 0
    ? (check(await supabaseAdmin.from('athletes').select('id, name, box, division_id, is_team').in('id', [...athleteIds])) || []) as AthleteRow[]
    : [];
  const athleteById = new Map(athletes.map((athlete) => [athlete.id, athlete]));

  const heatDivisionNames = (heat: ScheduleHeat | undefined, sheetsOfGroup: SheetRow[]) => {
    const ids = new Set<string>();
    sheetsOfGroup.forEach((sheet) => sheet.division_id && ids.add(sheet.division_id));
    heat?.athleteIds.forEach((id) => { const athlete = athleteById.get(id); if (athlete) ids.add(athlete.division_id); });
    const workout = heat ? workoutById.get(heat.workoutId) : undefined;
    if (ids.size === 0 && workout?.division_id) ids.add(workout.division_id);
    return sortDivisions([...ids].map((id) => ({ id, name: divisionName.get(id) ?? '', orderIndex: divisions.find((item) => item.id === id)?.order_index ?? null })))
      .map((item) => item.name)
      .filter(Boolean);
  };

  const describeHeat = (key: string): BroadcastHeat => {
    const heat = heatById.get(key);
    const sheetsOfGroup = groupSheets(key);
    const workoutId = heat?.workoutId ?? sheetsOfGroup[0]?.workout_id ?? '';
    const workoutRow = workoutById.get(workoutId);
    const structure = readStructure(workoutRow?.structure);
    const names = heatDivisionNames(heat, sheetsOfGroup);
    const sameWorkout = heat ? heats.filter((item) => item.workoutId === heat.workoutId) : [];
    return {
      key,
      title: heat ? (heat.heatNumber ? `Bateria ${heat.heatNumber}` : heat.title || 'Bateria') : names.join(' · ') || 'Bateria',
      heatNumber: heat?.heatNumber ?? null,
      heatCount: sameWorkout.length > 0 ? sameWorkout.length : null,
      divisionNames: names,
      time: heat?.time ?? '',
      workout: workoutRow && structure ? describeWorkoutForBoard(workoutRow, structure) : null
    };
  };

  const toNext = (heat: ScheduleHeat): BroadcastNext => ({
    title: heat.heatNumber ? `Bateria ${heat.heatNumber}` : heat.title || 'Bateria',
    divisionNames: heatDivisionNames(heat, []),
    time: heat.time,
    workoutName: workoutById.get(heat.workoutId)?.name ?? ''
  });

  const payload: Omit<BroadcastPayload, 'version' | 'serverTime'> = {
    appVersion: APP_VERSION,
    event: { name: eventRow.name ?? '', logoUrl: eventRow.logo_url ?? '' },
    mode: config.mode,
    screen: resolution.screen,
    live: null,
    call: null,
    interval: null,
    standby: null,
    next: following ? toNext(following) : null
  };

  if (resolution.screen === 'live') {
    const heat = describeHeat(resolution.groupKey);
    const sheetsOfGroup = groupSheets(resolution.groupKey);
    const structure = readStructure(workoutById.get(sheetsOfGroup[0]?.workout_id ?? '')?.structure);
    const progress = structure ? await readGroupProgress(supabaseAdmin, sheetsOfGroup, structure) : new Map<string, LiveProgress | null>();
    const scheduleLane = (athleteId: string) => {
      const index = heatById.get(resolution.groupKey)?.athleteIds.indexOf(athleteId) ?? -1;
      return index >= 0 ? index + 1 : null;
    };
    const ranked = rankLiveEntries(structure?.format ?? 'for_time', sheetsOfGroup.map((sheet) => ({ sheet, lane: sheet.lane ?? scheduleLane(sheet.athlete_id), progress: progress.get(sheet.id) ?? null })));
    const mark = marks.find((item) => item.heatId === resolution.groupKey);
    const entries: BroadcastLiveEntry[] = ranked.map(({ sheet, lane, progress: item, position }) => {
      const athlete = athleteById.get(sheet.athlete_id);
      return {
        key: sheet.id,
        position,
        lane,
        name: displayName(athlete),
        box: athlete?.box ?? '',
        divisionName: divisionName.get(sheet.division_id ?? '') ?? '',
        status: sheet.status === 'submitted' || sheet.status === 'returned'
          ? sheet.status
          : (item?.seq ?? 0) === 0 && sheetSeq(sheet) === 0 ? 'waiting' : 'in_progress',
        repsDone: item?.repsDone ?? 0,
        roundsCompleted: item?.roundsCompleted ?? 0,
        segments: item?.segments ?? [],
        currentSegmentId: item?.currentSegmentId ?? null,
        completedAt: item?.completedAt ?? null,
        scoreKg: item?.scoreKg ?? null,
        officialResult: sheet.status === 'submitted' ? sheet.official_result : null,
        round: structure?.format === 'interval' ? item?.round ?? null : null
      };
    });
    const group = groups.find((item) => item.key === resolution.groupKey);
    payload.live = {
      heat,
      startedAt: mark?.startedAt ?? minIso(sheetsOfGroup.map((sheet) => progress.get(sheet.id)?.clockStartAt)),
      finished: Boolean(group && !group.live),
      entries
    };
  }

  if (resolution.screen === 'call') {
    const heat = describeHeat(resolution.groupKey);
    const scheduled = heatById.get(resolution.groupKey);
    const sheetsOfGroup = groupSheets(resolution.groupKey);
    const opened = new Set(sheetsOfGroup.map((sheet) => sheet.athlete_id));
    const lanes: BroadcastCallLane[] = [];
    const seen = new Set<string>();
    scheduled?.athleteIds.forEach((athleteId, index) => {
      const athlete = athleteById.get(athleteId);
      if (!athleteId || !athlete) return;
      seen.add(athleteId);
      const sheet = sheetsOfGroup.find((item) => item.athlete_id === athleteId);
      lanes.push({ lane: sheet?.lane ?? index + 1, name: displayName(athlete), box: athlete.box ?? '', divisionName: divisionName.get(athlete.division_id) ?? '', sheetOpened: opened.has(athleteId) });
    });
    for (const sheet of sheetsOfGroup) {
      if (seen.has(sheet.athlete_id)) continue;
      const athlete = athleteById.get(sheet.athlete_id);
      lanes.push({ lane: sheet.lane, name: displayName(athlete), box: athlete?.box ?? '', divisionName: divisionName.get(sheet.division_id ?? '') ?? '', sheetOpened: true });
    }
    lanes.sort((a, b) => (a.lane ?? 999) - (b.lane ?? 999));
    payload.call = { heat, lanes };
  }

  if (resolution.screen === 'interval') {
    const sheetsOfGroup = resolution.groupKey ? groupSheets(resolution.groupKey) : [];
    const submitted = sheetsOfGroup.filter((sheet) => sheet.status === 'submitted');
    const fresh = submitted.length > 0
      ? { workoutId: submitted[0].workout_id, athleteIds: new Set(submitted.map((sheet) => sheet.athlete_id)) }
      : null;
    const boards = await buildStandingsBoards(supabaseAdmin, eventRow, divisions, workoutRows, resolution.divisionIds, fresh);
    const freshWorkout = fresh ? workoutById.get(fresh.workoutId) : undefined;
    payload.interval = { boards, afterTitle: freshWorkout ? `Depois da ${freshWorkout.code || freshWorkout.name}` : '' };
  }

  if (resolution.screen === 'standby') {
    payload.standby = { upcoming: upcoming.map(toNext) };
  }

  return { ...payload, version: fingerprint(payload), serverTime: new Date(nowMs).toISOString() };
};

// ---------------------------------------------------------------------------
// Mesa de controle (aba Telão do painel)
// ---------------------------------------------------------------------------

/** O que a aba Telão mostra: link (sem o token), modo, baterias, categorias, marcações e a prévia do telão. */
export const readBroadcastControl = async (supabaseAdmin: SupabaseClient, eventId: string, nowMs = Date.now()) => {
  const config = await readBroadcastConfig(supabaseAdmin, eventId);
  const [eventRow, divisionRows, workoutRows, markRows] = await Promise.all([
    supabaseAdmin.from('events').select('event_schedule').eq('id', eventId).maybeSingle(),
    supabaseAdmin.from('divisions').select('id, name, order_index').eq('event_id', eventId),
    supabaseAdmin.from('workouts').select('id, name, code').eq('event_id', eventId),
    supabaseAdmin.from('broadcast_heat_states').select('heat_id, started_at, finished_at').eq('event_id', eventId)
  ]);
  const schedule = (check(eventRow) as { event_schedule?: unknown } | null)?.event_schedule;
  const workouts = new Map(((check(workoutRows) || []) as { id: string; name: string; code: string | null }[]).map((row) => [row.id, row]));
  const preview = await buildBroadcastState(supabaseAdmin, eventId, config, nowMs);
  return {
    link: {
      active: Boolean(config.token_hash && !config.token_revoked_at),
      createdAt: config.token_hash ? config.token_created_at : null
    },
    mode: config.mode,
    pinnedHeatId: config.pinned_heat_id,
    pinnedDivisionId: config.pinned_division_id,
    heats: readScheduleHeats(schedule).map((heat) => {
      const workout = workouts.get(heat.workoutId);
      const label = heat.heatNumber ? `Bateria ${heat.heatNumber}` : heat.title || 'Bateria';
      return { id: heat.id, label: [label, workout?.code || workout?.name, heat.time].filter(Boolean).join(' · ') };
    }),
    divisions: sortDivisions(((check(divisionRows) || []) as DivisionRow[]).map((row) => ({ id: row.id, name: row.name, orderIndex: row.order_index })))
      .map((row) => ({ id: row.id, name: row.name })),
    marks: ((check(markRows) || []) as HeatRow[]).map((row) => ({ heatId: row.heat_id, startedAt: row.started_at, finishedAt: row.finished_at })),
    preview
  };
};
