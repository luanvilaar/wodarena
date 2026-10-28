import { sortWorkouts } from '@/lib/workoutOrder';
import type { EventScheduleItem } from '@/types';

// Provas do evento no cronograma (Stories 1.87 a 1.90).
//
// Antes, cada bateria nascia de uma prova da aba Provas, e cada prova pertence a
// uma categoria: a bateria só aceitava atletas dela. Agora o gestor monta as
// baterias por PROVA DO EVENTO ("Prova 1 · DT Speed") e a bateria aceita qualquer
// categoria. Cada atleta continua sendo arbitrado e pontuado na prova da categoria
// dele, e por isso cada raia guarda essa prova (`laneWorkoutIds`).
//
// Uma bateria nova leva `stageNumber`, `stageTitle`, `stageWorkouts` (a prova de
// cada categoria) e `laneWorkoutIds`; `workoutId` guarda uma prova representativa
// para quem ainda agrupa por prova. Bateria antiga só tem `workoutId` e segue valendo.
//
// Módulo puro: a tela do gestor, a quadra, o telão, o cronograma público e a
// remoção de provas usam as mesmas regras daqui.

type WorkoutRef = { id: string; name: string; code?: string | null; orderIndex?: number | null; divisionId?: string | null };
type DivisionRef = { id: string; name: string; orderIndex?: number | null };
type AthleteRef = { id: string; divisionId: string };

/** { [divisionId]: workoutId }; '' = a categoria não tem prova nesta etapa. */
export type StageWorkouts = Record<string, string>;

type HeatLike = Pick<EventScheduleItem, 'kind' | 'workoutId' | 'stageNumber' | 'laneWorkoutIds' | 'athleteIds'>;

export const buildStageHeatId = (stageNumber: number, heatNumber: number) => `heat-stage-${stageNumber}-${heatNumber}`;

export const isStageHeat = (item: Pick<EventScheduleItem, 'kind' | 'stageNumber'>): boolean =>
  item.kind === 'heat' && Number.isInteger(item.stageNumber) && (item.stageNumber as number) > 0;

/** Chave do grupo da bateria no cronograma público e no telão: a prova do evento ou a prova antiga. */
export const getHeatGroupKey = (item: Pick<EventScheduleItem, 'kind' | 'stageNumber' | 'workoutId'>): string => {
  if (isStageHeat(item)) return `stage-${item.stageNumber}`;
  return item.workoutId || '';
};

/** Prova da raia: a gravada para ela ou, na bateria antiga, a prova da bateria. */
export const getLaneWorkoutId = (heat: Pick<EventScheduleItem, 'workoutId' | 'laneWorkoutIds'>, laneIndex: number): string => {
  const own = heat.laneWorkoutIds?.[laneIndex];
  return typeof own === 'string' && own ? own : (heat.workoutId || '');
};

/** A bateria tem atleta (ou, na antiga, pertence) à prova informada? */
export const heatIncludesWorkout = (heat: HeatLike, workoutId: string): boolean => {
  if (heat.kind !== 'heat' || !workoutId) return false;
  if (!isStageHeat(heat)) return heat.workoutId === workoutId;
  return (heat.laneWorkoutIds || []).some((id, index) => id === workoutId && Boolean(heat.athleteIds?.[index]));
};

/** Provas da categoria na ordem da aba Provas; prova sem categoria ("Geral") vale para todas. */
export const getDivisionWorkoutsInOrder = <W extends WorkoutRef>(workouts: W[], divisionId: string): W[] =>
  sortWorkouts(workouts.filter((workout) => !workout.divisionId || workout.divisionId === divisionId));

/** Quantas provas o evento tem, por padrão: a categoria com mais provas manda. */
export const countDefaultStages = (workouts: WorkoutRef[], divisions: DivisionRef[]): number => {
  if (workouts.length === 0) return 0;
  const counts = divisions.map((division) => getDivisionWorkoutsInOrder(workouts, division.id).length);
  return Math.max(1, ...counts);
};

/** Preenchimento automático: a n-ésima prova de cada categoria é a prova n do evento. */
export const buildDefaultStageWorkouts = (workouts: WorkoutRef[], divisions: DivisionRef[], stageNumber: number): StageWorkouts => {
  const result: StageWorkouts = {};
  divisions.forEach((division) => {
    result[division.id] = getDivisionWorkoutsInOrder(workouts, division.id)[stageNumber - 1]?.id ?? '';
  });
  return result;
};

export const getStageHeats = <T extends EventScheduleItem>(items: T[], stageNumber: number): T[] =>
  items.filter((item) => isStageHeat(item) && item.stageNumber === stageNumber);

/** Números das provas do evento que já têm bateria salva, em ordem. */
export const getSavedStageNumbers = (items: EventScheduleItem[]): number[] =>
  [...new Set(items.filter(isStageHeat).map((item) => item.stageNumber as number))].sort((a, b) => a - b);

/**
 * Prova de cada categoria nesta prova do evento: o que o gestor salvou e, para as
 * categorias que não estavam no que foi salvo, o preenchimento automático. Prova
 * que não existe mais é tratada como "sem prova".
 */
export const resolveStageWorkouts = (
  items: EventScheduleItem[],
  workouts: WorkoutRef[],
  divisions: DivisionRef[],
  stageNumber: number
): StageWorkouts => {
  const defaults = buildDefaultStageWorkouts(workouts, divisions, stageNumber);
  const saved = getStageHeats(items, stageNumber).find((item) => item.stageWorkouts)?.stageWorkouts;
  if (!saved) return defaults;
  const existing = new Set(workouts.map((workout) => workout.id));
  const result: StageWorkouts = { ...defaults };
  divisions.forEach((division) => {
    if (!Object.hasOwn(saved, division.id)) return;
    const workoutId = saved[division.id];
    result[division.id] = workoutId && existing.has(workoutId) ? workoutId : '';
  });
  return result;
};

export const getStageTitle = (
  items: EventScheduleItem[],
  workouts: WorkoutRef[],
  stageWorkouts: StageWorkouts,
  stageNumber: number
): string => {
  const saved = getStageHeats(items, stageNumber).find((item) => item.stageTitle?.trim())?.stageTitle?.trim();
  if (saved) return saved;
  const names = Object.values(stageWorkouts)
    .map((id) => workouts.find((workout) => workout.id === id)?.name)
    .filter((name): name is string => Boolean(name));
  const first = names[0] ? names[0].replace(/\s*\([^()]*\)\s*$/, '').trim() : '';
  return first ? `Prova ${stageNumber} · ${first}` : `Prova ${stageNumber}`;
};

/** Atletas que fazem parte desta prova do evento: os das categorias que têm prova nela. */
export const eligibleStageAthletes = <A extends AthleteRef>(athletes: A[], stageWorkouts: StageWorkouts): A[] =>
  athletes.filter((athlete) => Boolean(stageWorkouts[athlete.divisionId]));

/** Prova de cada raia, alinhada com as raias; raia livre ou de categoria sem prova fica ''. */
export const buildLaneWorkoutIds = (athleteIds: string[], athletes: AthleteRef[], stageWorkouts: StageWorkouts): string[] => {
  const divisionByAthlete = new Map(athletes.map((athlete) => [athlete.id, athlete.divisionId]));
  return athleteIds.map((athleteId) => {
    const divisionId = athleteId ? divisionByAthlete.get(athleteId) : undefined;
    return divisionId ? (stageWorkouts[divisionId] || '') : '';
  });
};

/** Prova representativa da bateria (para quem ainda agrupa por prova): a da 1ª raia ocupada ou a 1ª da etapa. */
export const pickRepresentativeWorkoutId = (laneWorkoutIds: string[], stageWorkouts: StageWorkouts): string =>
  laneWorkoutIds.find(Boolean) || Object.values(stageWorkouts).find(Boolean) || '';

/**
 * Auto-preencher (D3): categoria por categoria, na ordem das categorias, do pior
 * para o melhor no ranking de cada uma; quando uma categoria acaba, a próxima
 * completa a bateria. `orderedAthleteIds` já vem nessa ordem (quem chama usa o
 * ranking de cada categoria). Devolve as raias por bateria e quem ficou de fora.
 */
export const autoFillHeats = (
  orderedAthleteIds: string[],
  heatCount: number,
  capacity: number
): { heats: string[][]; leftOut: string[] } => {
  const heats: string[][] = Array.from({ length: heatCount }, () => Array(capacity).fill(''));
  let index = 0;
  for (let heat = 0; heat < heatCount; heat += 1) {
    for (let lane = 0; lane < capacity; lane += 1) {
      if (index < orderedAthleteIds.length) heats[heat][lane] = orderedAthleteIds[index++];
    }
  }
  return { heats, leftOut: orderedAthleteIds.slice(index) };
};

/**
 * Trava (A5): a prova n do evento só abre baterias depois que a prova anterior
 * tem baterias salvas, nas duas formas (bateria da prova do evento ou bateria
 * antiga das provas que ela agrupa).
 */
export const getStageLockStatus = (
  items: EventScheduleItem[],
  workouts: WorkoutRef[],
  divisions: DivisionRef[],
  stageNumber: number
): { isLocked: boolean; previousStage: number | null } => {
  if (stageNumber <= 1) return { isLocked: false, previousStage: null };
  const previous = stageNumber - 1;
  if (getStageHeats(items, previous).length > 0) return { isLocked: false, previousStage: null };
  const previousWorkouts = new Set(Object.values(resolveStageWorkouts(items, workouts, divisions, previous)).filter(Boolean));
  const hasLegacy = items.some((item) => item.kind === 'heat' && !isStageHeat(item) && item.workoutId && previousWorkouts.has(item.workoutId));
  return hasLegacy ? { isLocked: false, previousStage: null } : { isLocked: true, previousStage: previous };
};

/**
 * Baterias antigas (por prova) que o construtor novo substitui ao salvar a prova
 * do evento: as das provas que ela agrupa (D5).
 */
export const getLegacyHeatsForStage = <T extends EventScheduleItem>(items: T[], stageWorkouts: StageWorkouts): T[] => {
  const ids = new Set(Object.values(stageWorkouts).filter(Boolean));
  return items.filter((item) => item.kind === 'heat' && !isStageHeat(item) && item.workoutId && ids.has(item.workoutId));
};

/**
 * Remove provas do cronograma (prova excluída ou recriada). Bateria antiga da prova
 * sai; bateria da prova do evento perde só as raias dessa prova e continua com
 * as outras (sai se não sobrar prova nenhuma nela).
 */
export const stripWorkoutsFromHeats = (items: EventScheduleItem[], removedWorkoutIds: string[]): EventScheduleItem[] => {
  const removed = new Set(removedWorkoutIds);
  return items.flatMap((item) => {
    if (item.kind !== 'heat') return [item];
    if (!isStageHeat(item)) return item.workoutId && removed.has(item.workoutId) ? [] : [item];

    const stageWorkouts: StageWorkouts = Object.fromEntries(
      Object.entries(item.stageWorkouts || {}).map(([divisionId, workoutId]) => [divisionId, removed.has(workoutId) ? '' : workoutId])
    );
    const athleteIds = [...(item.athleteIds || [])];
    const laneWorkoutIds = [...(item.laneWorkoutIds || [])];
    athleteIds.forEach((_, index) => {
      if (laneWorkoutIds[index] && removed.has(laneWorkoutIds[index])) {
        athleteIds[index] = '';
        laneWorkoutIds[index] = '';
      }
    });
    const representative = pickRepresentativeWorkoutId(laneWorkoutIds, stageWorkouts);
    if (!representative) return [];
    return [{ ...item, athleteIds, laneWorkoutIds, stageWorkouts, workoutId: representative }];
  });
};

/**
 * Baterias da prova do evento prontas para gravar no cronograma. `slots` traz os horários de
 * cada bateria (já calculados pela tela) e `allocations`, as raias por bateria com a chave
 * `heat-stage-<prova>-<bateria>`. Atleta de categoria sem prova nesta etapa não entra.
 */
export const buildStageHeatItems = (input: {
  stageNumber: number;
  stageTitle: string;
  stageWorkouts: StageWorkouts;
  slots: { time: string; warmupTime: string; checkinTime: string; endTime: string }[];
  capacity: number;
  allocations: Record<string, string[]>;
  athletes: AthleteRef[];
  date: string;
  location?: string;
  isPublished: boolean;
}): EventScheduleItem[] => input.slots.map((slot, index) => {
  const heatNumber = index + 1;
  const id = buildStageHeatId(input.stageNumber, heatNumber);
  const divisionByAthlete = new Map(input.athletes.map((athlete) => [athlete.id, athlete.divisionId]));
  const current = input.allocations[id] || [];
  const athleteIds = Array.from({ length: input.capacity }, (_, lane) => {
    const athleteId = current[lane] || '';
    const divisionId = athleteId ? divisionByAthlete.get(athleteId) : undefined;
    return divisionId && input.stageWorkouts[divisionId] ? athleteId : '';
  });
  const laneWorkoutIds = buildLaneWorkoutIds(athleteIds, input.athletes, input.stageWorkouts);
  return {
    id,
    kind: 'heat',
    date: input.date,
    time: slot.time,
    title: `BATERIA ${heatNumber} - ${input.stageTitle}`,
    description: `Aquecimento: ${slot.warmupTime} | Fila: ${slot.checkinTime} | Início: ${slot.time} | Final: ${slot.endTime}`,
    location: input.location,
    // Prova representativa, para quem ainda agrupa por prova; cada raia leva a prova da categoria do atleta.
    workoutId: pickRepresentativeWorkoutId(laneWorkoutIds, input.stageWorkouts),
    stageNumber: input.stageNumber,
    stageTitle: input.stageTitle,
    stageWorkouts: input.stageWorkouts,
    heatNumber,
    warmupTime: slot.warmupTime,
    checkinTime: slot.checkinTime,
    endTime: slot.endTime,
    athleteIds,
    laneWorkoutIds,
    capacity: input.capacity,
    isPublished: input.isPublished
  };
});
