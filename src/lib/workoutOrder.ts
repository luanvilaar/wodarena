// Ordenação de provas (workouts) definida pelo gestor na aba Provas do painel admin.
// Módulo puro, sem imports de runtime: usado pelo mapper do AppContext, pelas
// mutações em memória e pelas telas que listam provas, para que todas sigam a
// mesma sequência. Os testes importam este arquivo direto (node --test).

export interface OrderableWorkout {
  id: string;
  name: string;
  code?: string | null;
  orderIndex?: number | null;
}

const FALLBACK_ORDER = Number.MAX_SAFE_INTEGER;

// Ordem natural: "WOD 2" vem antes de "WOD 10"; maiúsculas e acentos não contam.
const WORKOUT_LABEL_COLLATOR = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });

const normalizeOrderIndex = (value: unknown): number => {
  if (value === null || value === undefined || value === '') return FALLBACK_ORDER;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : FALLBACK_ORDER;
};

const compareLabels = (a?: string | null, b?: string | null): number =>
  WORKOUT_LABEL_COLLATOR.compare(a ?? '', b ?? '');

// Provas sem orderIndex válido vão para o fim. Empates de orderIndex (cadastro
// duplicado) caem no código, depois no nome e por último no id, para a ordem
// nunca depender da ordem física das linhas no banco.
export const compareWorkouts = (a: OrderableWorkout, b: OrderableWorkout): number => {
  const orderDiff = normalizeOrderIndex(a.orderIndex) - normalizeOrderIndex(b.orderIndex);
  if (orderDiff !== 0) return orderDiff;

  const codeDiff = compareLabels(a.code, b.code);
  if (codeDiff !== 0) return codeDiff;

  const nameDiff = compareLabels(a.name, b.name);
  if (nameDiff !== 0) return nameDiff;

  // Comparação simples (sem locale): só garante uma ordem determinística.
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
};

// Devolve uma cópia ordenada; a lista recebida não é alterada.
export const sortWorkouts = <T extends OrderableWorkout>(workouts: T[]): T[] =>
  [...workouts].sort(compareWorkouts);

// Corte da correção do desempate "Colocação no WOD 1" (Story 1.35): até aqui o
// critério usava a primeira prova do evento inteiro, que podia ser de outra
// categoria e anular o desempate em silêncio. Eventos encerrados antes desta data
// mantêm o critério antigo para não alterar rankings já publicados. A data é fixa
// (07/10/2026 00:00, horário local) e não "agora": evento que terminar depois da
// correção usa a regra nova para sempre.
export const FIRST_WORKOUT_TIEBREAK_CUTOFF = new Date(2026, 9, 7);

// Prova usada no desempate "Colocação no WOD 1": a primeira prova da categoria
// ou, no critério legado, a primeira prova do evento inteiro. Quem chama decide o
// critério com hasEventDatePassed(event.date, FIRST_WORKOUT_TIEBREAK_CUTOFF), de
// eventStatus.ts, que fica fora daqui para este módulo seguir sem imports.
export const getTiebreakFirstWorkout = <T extends OrderableWorkout>(
  eventWorkouts: T[],
  divisionWorkouts: T[],
  usesLegacyEventWideRule: boolean
): T | undefined => sortWorkouts(usesLegacyEventWideRule ? eventWorkouts : divisionWorkouts)[0];
