// Ordenação de categorias (divisions) definida pelo gestor no painel admin.
// Módulo puro: usado pelo mapper do AppContext, pela UI de arrastar e soltar
// e por qualquer lista que precise seguir a ordem das categorias.

export interface OrderableDivision {
  id: string;
  name: string;
  orderIndex?: number | null;
}

const FALLBACK_ORDER = Number.MAX_SAFE_INTEGER;

const normalizeOrderIndex = (value: unknown): number => {
  if (value === null || value === undefined || value === '') return FALLBACK_ORDER;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : FALLBACK_ORDER;
};

// Categorias sem orderIndex (legado) vão para o fim, com desempate por nome.
export const sortDivisions = <T extends OrderableDivision>(divisions: T[]): T[] =>
  [...divisions].sort((a, b) => {
    const orderDiff = normalizeOrderIndex(a.orderIndex) - normalizeOrderIndex(b.orderIndex);
    if (orderDiff !== 0) return orderDiff;
    return (a.name || '').localeCompare(b.name || '', 'pt-BR');
  });

// Próxima posição livre — categoria nova (ou duplicada) entra sempre no fim.
export const getNextDivisionOrderIndex = (divisions: OrderableDivision[]): number => {
  const positions = divisions
    .map((division) => normalizeOrderIndex(division.orderIndex))
    .filter((position) => position !== FALLBACK_ORDER);

  if (positions.length === 0) return divisions.length + 1;
  return Math.max(...positions) + 1;
};

// Move um id para a posição de outro, preservando o restante da sequência.
export const moveDivisionId = (orderedIds: string[], sourceId: string, targetId: string): string[] => {
  if (sourceId === targetId) return [...orderedIds];

  const sourceIndex = orderedIds.indexOf(sourceId);
  const targetIndex = orderedIds.indexOf(targetId);
  if (sourceIndex === -1 || targetIndex === -1) return [...orderedIds];

  const reordered = [...orderedIds];
  reordered.splice(sourceIndex, 1);
  reordered.splice(targetIndex, 0, sourceId);
  return reordered;
};

// Troca a categoria de posição com a vizinha (botões ↑/↓, toque e teclado).
export const shiftDivisionId = (orderedIds: string[], divisionId: string, direction: -1 | 1): string[] => {
  const currentIndex = orderedIds.indexOf(divisionId);
  const nextIndex = currentIndex + direction;
  if (currentIndex === -1 || nextIndex < 0 || nextIndex >= orderedIds.length) return [...orderedIds];

  const reordered = [...orderedIds];
  reordered[currentIndex] = reordered[nextIndex];
  reordered[nextIndex] = divisionId;
  return reordered;
};

// Índice de cada categoria na ordem atual — para ordenar listas vinculadas
// (ex.: inscrições). Ids desconhecidos ficam no fim.
export const buildDivisionOrderMap = (divisions: OrderableDivision[]): Map<string, number> => {
  const map = new Map<string, number>();
  sortDivisions(divisions).forEach((division, index) => {
    map.set(division.id, index);
  });
  return map;
};

export const getDivisionOrderPosition = (orderMap: Map<string, number>, divisionId?: string): number => {
  if (!divisionId) return FALLBACK_ORDER;
  const position = orderMap.get(divisionId);
  return position === undefined ? FALLBACK_ORDER : position;
};
