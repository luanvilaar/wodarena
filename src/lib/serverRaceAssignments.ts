import type { SupabaseClient } from '@supabase/supabase-js';

import {
  filterActiveRaceAssignments,
  parseRaceAssignmentPairs,
  pickMyRaceStationKeys,
  raceWaveIsAdjusted,
  resolveRaceWaveAssignments,
  type RaceAssignmentRow
} from '@/lib/raceAssignments';
import { RACE_STATION_KIND_LABELS, describeStationMeta } from '@/lib/raceStation';
import { RACE_DEFAULT_TIME_ZONE, findRaceHeatItem, raceWaveTitle, readRaceHeatItems } from '@/lib/raceWaves';
import {
  RaceSheetError,
  buildRaceCourseSnapshot,
  groupRaceEventStations,
  isMissingRaceSchema,
  readCurrentRaceRuleset,
  readRaceEventSchedule
} from '@/lib/serverRaceSheets';
import type { SessionUser } from '@/lib/serverSecurity';

// Escala de judges por estação do Fitness Race (Story 1.104; D35, D3, D38).
// O acesso (gestor dono com acesso válido ou owner; judge atribuído para
// `my_stations`) é conferido antes, na rota, por serverRaceSheetAccess.ts. A
// escala só orienta (D3): nada aqui é chamado por open_attempt, e o judge fora
// da escala continua abrindo a estação em que estiver, dentro dos limites da
// Story 1.103. A gravação de um escopo (padrão ou onda) é atômica, pela função
// race_save_judge_assignments (migration 20261101120000_race_judge_assignments.sql).

export const RACE_ASSIGNMENTS_MIGRATION = '20261101120000_race_judge_assignments.sql';
const UNAVAILABLE_MESSAGE = `A escala de judges ainda não está disponível neste ambiente. Aplique a migration ${RACE_ASSIGNMENTS_MIGRATION} antes de usar.`;

const isMissingFunction = (error: unknown) => {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  return code === '42883' || code === 'PGRST202';
};

const errorText = (error: unknown) => (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string' ? (error as { message: string }).message : '');

const check = <T>(result: { data: T; error: unknown }) => {
  if (result.error) {
    if (isMissingRaceSchema(result.error)) throw new RaceSheetError(UNAVAILABLE_MESSAGE, 503);
    throw result.error;
  }
  return result.data;
};

type AssignmentDbRow = { event_id: string; judge_user_id: string; station_key: string; heat_id: string | null };
/** O evento já conferido pela rota (assertRaceManagerAccess / assertRaceJudgeAccess). */
export type RaceAssignmentsEvent = { id: string; organizer_id: string };

export const readAssignmentRows = async (supabaseAdmin: SupabaseClient, eventId: string): Promise<RaceAssignmentRow[]> => {
  const rows = (check(await supabaseAdmin.from('race_judge_assignments').select('event_id, judge_user_id, station_key, heat_id').eq('event_id', eventId)) || []) as AssignmentDbRow[];
  return rows.map((row) => ({ judgeUserId: row.judge_user_id, stationKey: row.station_key, heatId: row.heat_id ?? null }));
};

/**
 * Judges atribuídos ao evento (event_judges) que são contas de judge do mesmo
 * gestor do evento, com id e nome (sem e-mail), na ordem da atribuição.
 */
export const readEventJudges = async (supabaseAdmin: SupabaseClient, eventId: string, organizerId: string) => {
  const assignments = (check(await supabaseAdmin.from('event_judges').select('judge_user_id, created_at').eq('event_id', eventId)) || []) as { judge_user_id: string; created_at?: string }[];
  const ids = [...new Set(assignments
    .slice()
    .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
    .map((row) => String(row.judge_user_id)))];
  if (ids.length === 0) return [];
  const users = (check(await supabaseAdmin.from('users').select('id, name, role, parent_manager_id').in('id', ids)) || []) as { id: string; name?: string; role?: string; parent_manager_id?: string | null }[];
  const byId = new Map(users.filter((user) => user.role === 'judge' && user.parent_manager_id === organizerId).map((user) => [user.id, user]));
  return ids.filter((id) => byId.has(id)).map((id) => ({ id, name: byId.get(id)?.name ?? '' }));
};

const readEventRow = async (supabaseAdmin: SupabaseClient, ref: RaceAssignmentsEvent) => (
  { ...(await readRaceEventSchedule(supabaseAdmin, ref.id)), organizer_id: ref.organizer_id }
);

/**
 * Estações do evento para a escala (AC4): do snapshot travado do regulamento
 * quando existe (D6) e, antes da primeira largada, de divisions.course_layout.
 */
const readAssignmentStations = async (supabaseAdmin: SupabaseClient, eventId: string) => {
  const [ruleset, divisionsResult] = await Promise.all([
    readCurrentRaceRuleset(supabaseAdmin, eventId),
    supabaseAdmin.from('divisions').select('id, name').eq('event_id', eventId)
  ]);
  const divisions = (check(divisionsResult) || []) as { id: string; name?: string }[];
  const course = ruleset?.locked_at ? ruleset.course : await buildRaceCourseSnapshot(supabaseAdmin, eventId);
  return groupRaceEventStations(divisions, course);
};

/** Ondas do cronograma (itens `kind: 'heat'`), em ordem de data, horário e número, com a largada e se há corrida em andamento. */
const readAssignmentWaves = async (supabaseAdmin: SupabaseClient, eventId: string, schedule: unknown) => {
  const [marksResult, runsResult] = await Promise.all([
    supabaseAdmin.from('race_heat_marks').select('heat_id, started_at').eq('event_id', eventId),
    supabaseAdmin.from('race_runs').select('heat_id, status').eq('event_id', eventId)
  ]);
  const marks = new Map(((check(marksResult) || []) as { heat_id: string; started_at: string }[]).map((row) => [row.heat_id, row.started_at]));
  const racing = new Set(((check(runsResult) || []) as { heat_id: string | null; status: string }[]).filter((row) => row.heat_id && row.status === 'racing').map((row) => row.heat_id as string));
  return readRaceHeatItems(schedule)
    .map((item) => ({
      id: item.id,
      title: raceWaveTitle(item),
      date: item.date,
      time: item.time,
      heatNumber: item.heatNumber,
      startedAt: marks.get(item.id) ?? null,
      inProgress: marks.has(item.id) && racing.has(item.id)
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || (a.heatNumber ?? 0) - (b.heatNumber ?? 0));
};

/**
 * Leitura da escala para o editor do organizador (AC4, `view=assignments`):
 * estações (chave, nome, tipo, meta, categorias), judges do evento (id e
 * nome, sem e-mail), ondas (título, horário, se largou), as linhas do padrão
 * e de cada onda e a escala efetiva de cada onda (AC2). Linha de judge que
 * saiu do evento não aparece (AC7); linha de estação que não está mais no
 * percurso vem marcada `orphan` (o editor avisa e deixa remover); linha de
 * onda que saiu do cronograma é ignorada.
 */
export const readRaceAssignments = async (supabaseAdmin: SupabaseClient, ref: RaceAssignmentsEvent) => {
  const eventId = ref.id;
  const event = await readEventRow(supabaseAdmin, ref);
  const [stations, judges, waves, allRows] = await Promise.all([
    readAssignmentStations(supabaseAdmin, eventId),
    readEventJudges(supabaseAdmin, eventId, event.organizer_id),
    readAssignmentWaves(supabaseAdmin, eventId, event.event_schedule),
    readAssignmentRows(supabaseAdmin, eventId)
  ]);
  const judgeIds = judges.map((judge) => judge.id);
  const stationKeys = new Set(stations.map((station) => station.key));
  const waveIds = new Set(waves.map((wave) => wave.id));
  const rows = filterActiveRaceAssignments(allRows, judgeIds).filter((row) => row.heatId === null || waveIds.has(row.heatId));
  const mark = (pairs: { judgeUserId: string; stationKey: string }[]) => pairs.map((pair) => ({ ...pair, orphan: !stationKeys.has(pair.stationKey) }));
  const scopeRows = (heatId: string | null) => rows.filter((row) => row.heatId === heatId).map((row) => ({ judgeUserId: row.judgeUserId, stationKey: row.stationKey }));

  return {
    event: { id: event.id, name: event.name ?? '', timeZone: event.time_zone || RACE_DEFAULT_TIME_ZONE },
    stations: stations.map((station) => {
      const first = station.divisions[0];
      return {
        key: station.key,
        name: station.name,
        kind: station.kind,
        kindLabel: RACE_STATION_KIND_LABELS[station.kind],
        meta: first ? describeStationMeta(first).target : '',
        closesTime: station.closesTime,
        categories: [...new Set(station.divisions.map((division) => division.divisionName).filter(Boolean))]
      };
    }),
    judges,
    waves: waves.map((wave) => {
      const effective = resolveRaceWaveAssignments(rows, wave.id);
      return {
        id: wave.id,
        title: wave.title,
        date: wave.date,
        time: wave.time,
        startedAt: wave.startedAt,
        adjusted: raceWaveIsAdjusted(rows, wave.id),
        rows: mark(scopeRows(wave.id)),
        effective: mark(effective.pairs)
      };
    }),
    defaultRows: mark(scopeRows(null)),
    hasAssignments: rows.length > 0
  };
};

/**
 * "Minhas estações" do judge que pede (AC6, `view=my_stations`): para cada
 * onda, as estações da escala efetiva em que ele está, se a onda está em
 * andamento, e as chaves a mostrar primeiro (da onda em andamento ou, sem
 * ela, de todas). `hasAssignments` falso = evento sem escala (a lista fica
 * como na Story 1.102).
 */
export const readRaceMyStations = async (supabaseAdmin: SupabaseClient, ref: RaceAssignmentsEvent, actor: SessionUser) => {
  const eventId = ref.id;
  const event = await readEventRow(supabaseAdmin, ref);
  const [judges, waves, allRows] = await Promise.all([
    readEventJudges(supabaseAdmin, eventId, event.organizer_id),
    readAssignmentWaves(supabaseAdmin, eventId, event.event_schedule),
    readAssignmentRows(supabaseAdmin, eventId)
  ]);
  const waveIds = new Set(waves.map((wave) => wave.id));
  const rows = filterActiveRaceAssignments(allRows, judges.map((judge) => judge.id)).filter((row) => row.heatId === null || waveIds.has(row.heatId));
  const mine = (pairs: { judgeUserId: string; stationKey: string }[]) => [...new Set(pairs.filter((pair) => pair.judgeUserId === actor.id).map((pair) => pair.stationKey))];
  const myWaves = waves.map((wave) => ({
    heatId: wave.id,
    title: wave.title,
    time: wave.time,
    startedAt: wave.startedAt,
    inProgress: wave.inProgress,
    stationKeys: mine(resolveRaceWaveAssignments(rows, wave.id).pairs)
  }));
  const defaultKeys = mine(resolveRaceWaveAssignments(rows, null).pairs);
  return {
    event: { id: event.id, name: event.name ?? '', timeZone: event.time_zone || RACE_DEFAULT_TIME_ZONE },
    hasAssignments: rows.length > 0,
    waves: myWaves,
    myStationKeys: pickMyRaceStationKeys(myWaves, defaultKeys)
  };
};

/** Onda do escopo: nulo, ausente ou vazio = padrão do evento; texto = item `kind: 'heat'` do cronograma (404 fora dele). */
const readScopeHeatId = (value: unknown, schedule: unknown, required: boolean) => {
  if (value === null || value === undefined || value === '') {
    if (required) throw new RaceSheetError('Informe a onda.');
    return null;
  }
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 120) throw new RaceSheetError('Onda inválida.');
  const heatId = value.trim();
  if (!findRaceHeatItem(schedule, heatId)) throw new RaceSheetError('Onda não encontrada no cronograma do evento.', 404);
  return heatId;
};

/**
 * Grava o conjunto de um escopo (AC3, `save_assignments`): o padrão do evento
 * (heatId nulo) ou uma onda. Substitui o escopo inteiro de forma atômica e
 * idempotente (race_save_judge_assignments). Confere que cada judge está em
 * event_judges deste evento e é do mesmo gestor, que cada estação está no
 * percurso de ao menos uma categoria (a linha órfã já gravada pode ficar até
 * o organizador tirá-la: o editor avisa, não apaga sozinho), que a onda está
 * no cronograma e que vêm no máximo 500 linhas. Estação sem judge não impede
 * gravar (D3). Devolve a escala atualizada.
 */
export const saveRaceAssignments = async (
  supabaseAdmin: SupabaseClient,
  actor: SessionUser,
  ref: RaceAssignmentsEvent,
  input: { heatId?: unknown; assignments?: unknown }
) => {
  const parsed = parseRaceAssignmentPairs(input.assignments);
  if (!parsed.ok) throw new RaceSheetError(parsed.message);
  const eventId = ref.id;
  const event = await readEventRow(supabaseAdmin, ref);
  const heatId = readScopeHeatId(input.heatId, event.event_schedule, false);
  const [judges, stations, existing] = await Promise.all([
    readEventJudges(supabaseAdmin, eventId, event.organizer_id),
    readAssignmentStations(supabaseAdmin, eventId),
    readAssignmentRows(supabaseAdmin, eventId)
  ]);
  const judgeIds = new Set(judges.map((judge) => judge.id));
  const outsider = parsed.pairs.find((pair) => !judgeIds.has(pair.judgeUserId));
  if (outsider) throw new RaceSheetError('Judge não atribuído a este evento. Atribua o judge na seção "Judges do evento" antes de escalar.');
  const known = new Set([...stations.map((station) => station.key), ...existing.map((row) => row.stationKey)]);
  const unknown = parsed.pairs.find((pair) => !known.has(pair.stationKey));
  if (unknown) throw new RaceSheetError('Esta estação não está no percurso do evento.');

  const result = await supabaseAdmin.rpc('race_save_judge_assignments', {
    p_event_id: eventId,
    p_heat_id: heatId,
    p_actor_id: actor.id,
    p_rows: parsed.pairs.map((pair) => ({ judge_user_id: pair.judgeUserId, station_key: pair.stationKey }))
  });
  if (result.error) {
    if (isMissingFunction(result.error) || isMissingRaceSchema(result.error)) throw new RaceSheetError(UNAVAILABLE_MESSAGE, 503);
    if (/race_event_required/.test(errorText(result.error))) throw new RaceSheetError('A súmula Fitness Race é exclusiva de eventos Fitness Race.', 400);
    throw result.error;
  }
  return { saved: { heatId, count: parsed.pairs.length }, ...(await readRaceAssignments(supabaseAdmin, ref)) };
};

/**
 * Volta a onda ao padrão do evento (AC2, AC3, `clear_wave_assignments`):
 * apaga as linhas da onda num só comando. Devolve a escala atualizada.
 */
export const clearRaceWaveAssignments = async (supabaseAdmin: SupabaseClient, ref: RaceAssignmentsEvent, input: { heatId?: unknown }) => {
  const eventId = ref.id;
  const event = await readEventRow(supabaseAdmin, ref);
  const heatId = readScopeHeatId(input.heatId, event.event_schedule, true) as string;
  check(await supabaseAdmin.from('race_judge_assignments').delete().eq('event_id', eventId).eq('heat_id', heatId));
  return { cleared: { heatId }, ...(await readRaceAssignments(supabaseAdmin, ref)) };
};
