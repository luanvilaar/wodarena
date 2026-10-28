import { getDivisionWorkoutsInOrder } from '@/lib/heatStages';
import { sortWorkouts } from '@/lib/workoutOrder';

// Lista "Provas WODs Cadastradas" por prova do evento (Story 1.91).
//
// A mesma prova costuma ser cadastrada uma vez por categoria, e a lista corrida
// virava uma pilha de cartões quase iguais. Aqui as provas são agrupadas pela
// MESMA regra do construtor de baterias (heatStages.ts): a N-ésima prova de cada
// categoria, na ordem da aba Provas, é a "Prova N" do evento; prova "Geral" (sem
// categoria) vale para todas. Módulo puro: o componente só desenha o resultado.

export interface StageListWorkout {
  id: string;
  name: string;
  code?: string | null;
  orderIndex?: number | null;
  divisionId?: string | null;
}

export interface StageListDivision {
  id: string;
  name: string;
  orderIndex?: number | null;
}

export interface StageListRow<W> {
  key: string;
  workout: W;
  /** Categorias que esta linha cobre: uma, ou várias quando a prova é "Geral". */
  divisions: StageListDivision[];
  isGeneral: boolean;
  /** "Dupla Rx Masculino", "Todas as categorias" ou "Geral · 3 categorias". */
  label: string;
  /** Nomes das categorias de uma prova Geral que não cobre todas; vazio nos demais casos. */
  coverageNote: string;
  /** Código e/ou nome da prova quando diferem do título do grupo; vazio quando o título já diz tudo. */
  ownLabel: string;
}

export interface StageListGap {
  division: StageListDivision;
  /** Só a primeira prova que falta de uma categoria pode ser cadastrada agora: a próxima prova dela vira essa. */
  canAdd: boolean;
  /** Número da prova que a categoria precisa cadastrar primeiro. */
  blockedBy: number;
}

export interface StageListGroup<W> {
  stageNumber: number;
  /** O código comum das provas do grupo ("PROVA 1") ou "Prova N" quando os códigos diferem. */
  title: string;
  /** O nome comum das provas do grupo, quando existe e difere do código. */
  subtitle: string;
  /** Código comum, para preencher o formulário ao cadastrar uma lacuna; vazio quando os códigos diferem. */
  suggestedCode: string;
  rows: StageListRow<W>[];
  coveredCount: number;
  totalCount: number;
  gaps: StageListGap[];
}

export interface WorkoutStageList<W> {
  groups: StageListGroup<W>[];
  /** Provas que nenhuma categoria do evento enxerga (categoria removida ou evento sem categorias). */
  unplaced: W[];
}

const clean = (value?: string | null): string => (value ?? '').trim();
const fold = (value?: string | null): string => clean(value).toLowerCase();

/** O nome só aparece quando acrescenta algo: igual ao código ("PROVA 1" e "PROVA 1"), some. */
export const shouldShowWorkoutName = (workout: Pick<StageListWorkout, 'name' | 'code'>): boolean =>
  Boolean(clean(workout.name)) && fold(workout.name) !== fold(workout.code);

const orderValue = (value?: number | null): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;

const allSame = (values: string[]): boolean => values.every((value) => value === values[0]);

export const buildWorkoutStageList = <W extends StageListWorkout>(
  workouts: W[],
  divisions: StageListDivision[]
): WorkoutStageList<W> => {
  const orderedDivisions = divisions
    .map((division, index) => ({ division, index }))
    .sort((a, b) => orderValue(a.division.orderIndex) - orderValue(b.division.orderIndex) || a.index - b.index)
    .map((entry) => entry.division);

  const perDivision = orderedDivisions.map((division) => ({
    division,
    list: getDivisionWorkoutsInOrder(workouts, division.id)
  }));
  const stageCount = Math.max(0, ...perDivision.map((entry) => entry.list.length));
  const totalCount = orderedDivisions.length;

  // Categoria com menos provas que o evento: a próxima que ela cadastrar vira a primeira que falta.
  const firstMissing = new Map<string, number>();
  perDivision.forEach((entry) => {
    if (entry.list.length < stageCount) firstMissing.set(entry.division.id, entry.list.length + 1);
  });

  const placedIds = new Set<string>();
  const groups: StageListGroup<W>[] = [];

  for (let stageNumber = 1; stageNumber <= stageCount; stageNumber += 1) {
    const slots = perDivision.map((entry) => ({ division: entry.division, workout: entry.list[stageNumber - 1] ?? null }));
    const present = slots.filter((slot): slot is { division: StageListDivision; workout: W } => slot.workout !== null);
    present.forEach((slot) => placedIds.add(slot.workout.id));

    const codes = present.map((slot) => fold(slot.workout.code));
    const names = present.map((slot) => fold(slot.workout.name));
    const sameCode = codes.length > 0 && allSame(codes) && Boolean(clean(present[0].workout.code));
    const sameName = names.length > 0 && allSame(names);

    const title = sameCode ? clean(present[0].workout.code) : `Prova ${stageNumber}`;
    const subtitle = sameName && shouldShowWorkoutName(present[0].workout) ? clean(present[0].workout.name) : '';

    const rows: StageListRow<W>[] = [];
    const generalRows = new Map<string, StageListRow<W>>();
    present.forEach((slot) => {
      const { workout } = slot;
      const ownParts: string[] = [];
      if (!sameCode && clean(workout.code)) ownParts.push(clean(workout.code));
      if (!sameName && shouldShowWorkoutName(workout)) ownParts.push(clean(workout.name));
      const ownLabel = ownParts.join(' · ');

      if (clean(workout.divisionId)) {
        rows.push({
          key: workout.id,
          workout,
          divisions: [slot.division],
          isGeneral: false,
          label: slot.division.name,
          coverageNote: '',
          ownLabel
        });
        return;
      }

      // Prova "Geral": uma linha só, mesmo valendo para várias categorias.
      const existing = generalRows.get(workout.id);
      if (existing) {
        existing.divisions.push(slot.division);
        return;
      }
      const row: StageListRow<W> = {
        key: workout.id,
        workout,
        divisions: [slot.division],
        isGeneral: true,
        label: '',
        coverageNote: '',
        ownLabel
      };
      generalRows.set(workout.id, row);
      rows.push(row);
    });
    generalRows.forEach((row) => {
      if (row.divisions.length === totalCount) {
        row.label = 'Todas as categorias';
      } else {
        row.label = `Geral · ${row.divisions.length} ${row.divisions.length === 1 ? 'categoria' : 'categorias'}`;
        row.coverageNote = row.divisions.map((division) => division.name).join(', ');
      }
    });

    const gaps: StageListGap[] = slots
      .filter((slot) => slot.workout === null)
      .map((slot) => {
        const first = firstMissing.get(slot.division.id) ?? stageNumber;
        return { division: slot.division, canAdd: first === stageNumber, blockedBy: first };
      });

    groups.push({
      stageNumber,
      title,
      subtitle,
      suggestedCode: sameCode ? clean(present[0].workout.code) : '',
      rows,
      coveredCount: present.length,
      totalCount,
      gaps
    });
  }

  return {
    groups,
    unplaced: sortWorkouts(workouts.filter((workout) => !placedIds.has(workout.id)))
  };
};
