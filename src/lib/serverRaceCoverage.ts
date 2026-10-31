import type { SupabaseClient } from '@supabase/supabase-js';

import { filterActiveRaceAssignments, type RaceAssignmentRow } from '@/lib/raceAssignments';
import { buildRaceCoverage, type RaceCoverageStage } from '@/lib/raceCoverage';
import { lastRaceStation, raceStationKeysOf } from '@/lib/raceCourseStructure';
import { describeStationMeta } from '@/lib/raceStation';
import { RACE_DEFAULT_TIME_ZONE, buildRaceWaves, readRaceHeatItems } from '@/lib/raceWaves';
import { RACE_ASSIGNMENTS_MIGRATION, readAssignmentRows, readEventJudges } from '@/lib/serverRaceAssignments';
import {
  RaceSheetError,
  buildRaceCourseSnapshot,
  courseStagesOf,
  readCurrentRaceRuleset,
  readRaceBoardSources,
  type RaceRulesetRow,
  type RaceSnapshotStage
} from '@/lib/serverRaceSheets';

// Leitura do painel "Cobertura ao vivo" (Story 1.105, `view=coverage`; D3,
// D31, D35, D40, D41). Só leitura: não grava nada, não mexe na escala nem nos
// limites da 1.103/1.104. O acesso (gestor dono do evento com acesso válido ou
// owner; judge recebe 403) é conferido antes, na rota, por
// serverRaceSheetAccess.ts. Uma ida ao banco por tabela (sem N+1): a mesma aba
// pode estar aberta em mais de um aparelho, atualizando a cada 15 s. Sem
// e-mail e sem dado de pagamento; nada disso entra no bootstrap público.
//
// A tabela da escala (migration 20261101120000_race_judge_assignments.sql,
// Story 1.104) pode ainda não existir no banco: nesse caso a leitura segue como
// evento sem escala (D40) e devolve `assignmentsAvailable: false`, em vez de
// quebrar o painel.

export type RaceCoverageEvent = { id: string; organizer_id: string };

/** Estações de um percurso para a cobertura: chave, nome, tipo, meta e se fecha o tempo, em ordem. */
const toCoverageStages = (stages: readonly RaceSnapshotStage[]): RaceCoverageStage[] => {
  const keys = raceStationKeysOf(stages);
  const closingId = lastRaceStation(stages)?.id ?? null;
  return stages
    .map((stage, index) => ({ stage, order: typeof stage.orderIndex === 'number' && Number.isFinite(stage.orderIndex) ? stage.orderIndex : index, index }))
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .map(({ stage }) => stage)
    .filter((stage) => stage.type === 'station' && keys.has(stage.id))
    .map((stage) => ({
      stationId: stage.id,
      key: keys.get(stage.id) as string,
      name: stage.name,
      kind: stage.kind,
      meta: describeStationMeta(stage).target || (stage.kind === 'wall_ball' && stage.reps ? `${stage.reps} reps` : stage.distance ?? ''),
      closesTime: stage.id === closingId
    }));
};

/** Linhas da escala; sem a tabela (migration da 1.104 não aplicada), evento sem escala. */
const readCoverageAssignments = async (supabaseAdmin: SupabaseClient, eventId: string): Promise<{ available: boolean; rows: RaceAssignmentRow[] }> => {
  try {
    return { available: true, rows: await readAssignmentRows(supabaseAdmin, eventId) };
  } catch (error) {
    if (error instanceof RaceSheetError && error.status === 503) return { available: false, rows: [] };
    throw error;
  }
};

/**
 * Cobertura ao vivo do evento (AC2): para cada onda do cronograma (com
 * atletas), título, horário, se largou e, para cada estação do percurso das
 * categorias da onda, os judges da escala efetiva com os cartões ativos e o
 * limite, os judges de fora da escala que abriram cartão nela (D41), os
 * cartões abertos e a estimativa de atletas esperando (AC3). Regras em
 * buildRaceCoverage (raceCoverage.ts).
 */
export const readRaceCoverage = async (supabaseAdmin: SupabaseClient, ref: RaceCoverageEvent) => {
  const eventId = ref.id;
  const [sources, ruleset, judges, assignments] = await Promise.all([
    readRaceBoardSources(supabaseAdmin, eventId),
    readCurrentRaceRuleset(supabaseAdmin, eventId),
    readEventJudges(supabaseAdmin, eventId, ref.organizer_id),
    readCoverageAssignments(supabaseAdmin, eventId)
  ]);
  const { event, athletes, markMap, runByAthlete, attempts, rulesetById } = sources;
  const timeZone = event.time_zone || RACE_DEFAULT_TIME_ZONE;

  // Percurso das estações da onda: snapshot travado do regulamento (D6) e, antes da primeira largada, o percurso atual.
  const course = ruleset?.locked_at ? ruleset.course : await buildRaceCourseSnapshot(supabaseAdmin, eventId);
  const holder = { course } as RaceRulesetRow;
  const divisionNames: Record<string, string> = {};
  for (const athlete of athletes.values()) divisionNames[athlete.divisionId] = athlete.divisionName;
  const courses: Record<string, RaceCoverageStage[]> = {};
  for (const divisionId of Object.keys(divisionNames)) courses[divisionId] = toCoverageStages(courseStagesOf(holder, divisionId));

  const waves = buildRaceWaves(event.event_schedule, athletes, markMap, new Map()).map((wave) => ({
    id: wave.id,
    title: wave.title,
    date: wave.date,
    time: wave.time,
    startedAt: wave.startedAt,
    categories: wave.categories,
    divisionIds: [...new Set(wave.athletes.map((athlete) => athlete.divisionId))]
  }));

  // Corrida usa o percurso do regulamento dela (o snapshot com que largou).
  const runs = [...runByAthlete.values()].map((run) => {
    const athlete = athletes.get(run.athlete_id);
    const divisionId = run.division_id ?? athlete?.divisionId ?? null;
    const runRuleset = rulesetById.get(run.ruleset_id);
    return {
      id: run.id,
      athleteId: run.athlete_id,
      athleteName: athlete?.name ?? '',
      divisionId,
      divisionName: (divisionId && divisionNames[divisionId]) || athlete?.divisionName || '',
      heatId: run.heat_id,
      status: run.status,
      stages: runRuleset ? toCoverageStages(courseStagesOf(runRuleset, divisionId)) : []
    };
  });

  const heatIds = new Set(readRaceHeatItems(event.event_schedule).map((item) => item.id));
  const rows = filterActiveRaceAssignments(assignments.rows, judges.map((judge) => judge.id))
    .filter((row) => row.heatId === null || heatIds.has(row.heatId));

  const coverage = buildRaceCoverage({
    timeZone,
    waves,
    courses,
    divisionNames,
    runs,
    attempts: attempts.map((row) => ({
      id: row.id,
      runId: row.run_id,
      stationId: row.station_id,
      stationKind: row.station_kind,
      judgeUserId: row.judge_user_id,
      judgeName: row.judge_name ?? '',
      status: row.status,
      progress: row.progress || {},
      createdAt: row.created_at,
      updatedAt: row.updated_at
    })),
    assignments: rows,
    judges
  });

  return {
    event: { id: event.id, name: event.name ?? '', timeZone },
    // false: a tabela da escala ainda não existe neste banco (migration da Story 1.104 não aplicada).
    assignmentsAvailable: assignments.available,
    assignmentsMigration: assignments.available ? null : RACE_ASSIGNMENTS_MIGRATION,
    ...coverage
  };
};
