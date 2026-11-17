import { getLaneWorkoutId } from '@/lib/heatStages';
import { sortWorkouts } from '@/lib/workoutOrder';
import type { EventScheduleItem } from '@/types';

// Aba "Súmulas e Judges" do gestor organizada por prova e bateria (Stories 1.141
// a 1.143; desenho aprovado em docs/design/sumulas-organizacao/).
//
// - Prova (D1): as provas com o mesmo código ("PROVA 2" de cada categoria) viram
//   uma só; códigos diferentes ficam separados.
// - Bateria (D2): dentro da prova, a lista segue as baterias do cronograma, raia
//   por raia, com a mesma regra da Quadra (raia = posição + 1, prova da raia em
//   `getLaneWorkoutId`). Sem bateria no cronograma, vale a bateria gravada na
//   súmula; sem nenhuma, "Sem bateria".
// - Raia sem súmula (D5): raia do cronograma sem súmula ativa numa bateria que já
//   começou. Bateria que ainda não começou fica "aguardando" e não é pendência.
// - Canceladas (D3): ficam presas ao atleta e só aparecem quando pedidas.
//
// Módulo puro: a tela usa as funções daqui e os testes as importam direto.

export type BoardSheetStatus = 'in_progress' | 'submitted' | 'returned' | 'cancelled';

export type BoardSheet = {
  id: string;
  workoutId: string;
  athleteId: string;
  athleteName: string;
  box: string;
  divisionId?: string | null;
  heatNumber: number | null;
  lane: number | null;
  status: BoardSheetStatus;
  updatedAt: string;
};

export type BoardWorkout = {
  id: string;
  name: string;
  code?: string | null;
  orderIndex?: number | null;
  divisionId?: string | null;
  structure?: unknown;
};

export type BoardAthlete = { id: string; name: string; box: string; divisionId: string };

export type BoardHeatItem = Pick<EventScheduleItem, 'id' | 'kind' | 'workoutId' | 'laneWorkoutIds' | 'athleteIds' | 'heatNumber' | 'date' | 'time'>;

export type ScoresheetProva<W extends BoardWorkout = BoardWorkout> = {
  key: string;
  label: string;
  workouts: W[];
  workoutIds: string[];
};

/** Estado da raia: o status da súmula ativa, ou a falta dela. `cancelled` = só canceladas. */
export type BoardLaneState = 'submitted' | 'in_progress' | 'returned' | 'missing' | 'waiting' | 'cancelled';

export type BoardEntry<S extends BoardSheet = BoardSheet> = {
  /** Estável entre atualizações: a raia do cronograma ou o par atleta/prova. */
  key: string;
  athleteId: string;
  workoutId: string;
  divisionId: string;
  athleteName: string;
  box: string;
  heatNumber: number | null;
  lane: number | null;
  /** Súmula ativa (não cancelada). */
  sheet: S | null;
  /** Canceladas do atleta nesta prova, da mais recente para a mais antiga. */
  cancelled: S[];
  state: BoardLaneState;
};

/** heat = bateria do cronograma; sheet_heat = bateria gravada na súmula; outside = fora do cronograma; no_heat = sem bateria. */
export type BoardGroupKind = 'heat' | 'sheet_heat' | 'outside' | 'no_heat';

export type BoardCounts = Record<BoardLaneState, number>;

export type BoardGroup<S extends BoardSheet = BoardSheet> = {
  key: string;
  kind: BoardGroupKind;
  heatNumber: number | null;
  date: string;
  time: string;
  entries: BoardEntry<S>[];
  /** Alguma súmula (até cancelada) já foi aberta nesta bateria. */
  started: boolean;
  /** Todas as raias (sem contar as só canceladas) publicadas. */
  complete: boolean;
  counts: BoardCounts;
};

export type BoardStats = {
  /** Raias e atletas da prova, sem os que só têm súmula cancelada. */
  total: number;
  published: number;
  inProgress: number;
  returned: number;
  missing: number;
  waiting: number;
  /** Súmulas canceladas da prova. */
  cancelled: number;
  pending: number;
};

export type ScoresheetBoard<S extends BoardSheet = BoardSheet> = {
  groups: BoardGroup<S>[];
  stats: BoardStats;
};

export type BoardFilter = {
  divisionId: string | null;
  query: string;
  pendingOnly: boolean;
  showCancelled: boolean;
};

export const PENDING_STATES: ReadonlySet<BoardLaneState> = new Set<BoardLaneState>(['in_progress', 'returned', 'missing']);

// ---------------------------------------------------------------------------
// Provas (D1)
// ---------------------------------------------------------------------------

const collapse = (value: string | null | undefined) => (value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();

/** Chave da prova: o código sem diferença de maiúsculas e espaços (o nome, sem código). */
export const getScoresheetProvaKey = (workout: Pick<BoardWorkout, 'id' | 'code' | 'name'>): string => {
  const label = collapse(workout.code) || collapse(workout.name);
  return label ? label.toLocaleUpperCase('pt-BR') : `id:${workout.id}`;
};

/**
 * Provas da aba: as que têm súmula digital ou súmula aberta, agrupadas pelo
 * código, na ordem da aba Provas (a primeira prova de cada código manda).
 */
export const groupScoresheetProvas = <W extends BoardWorkout>(workouts: W[], sheetWorkoutIds: Iterable<string> = []): ScoresheetProva<W>[] => {
  const withSheets = new Set(sheetWorkoutIds);
  const provas = new Map<string, ScoresheetProva<W>>();
  for (const workout of sortWorkouts(workouts.filter((item) => Boolean(item.structure) || withSheets.has(item.id)))) {
    const key = getScoresheetProvaKey(workout);
    const prova = provas.get(key) ?? { key, label: collapse(workout.code) || collapse(workout.name) || 'Prova sem nome', workouts: [], workoutIds: [] };
    prova.workouts.push(workout);
    prova.workoutIds.push(workout.id);
    provas.set(key, prova);
  }
  return [...provas.values()];
};

/** Prova da súmula atualizada por último (D7); sem súmula, a primeira prova. */
export const pickDefaultProva = (provas: Pick<ScoresheetProva, 'key' | 'workoutIds'>[], sheets: Pick<BoardSheet, 'workoutId' | 'updatedAt'>[]): string | null => {
  let latest: Pick<BoardSheet, 'workoutId' | 'updatedAt'> | null = null;
  for (const sheet of sheets) {
    if (!provas.some((prova) => prova.workoutIds.includes(sheet.workoutId))) continue;
    if (!latest || sheet.updatedAt > latest.updatedAt) latest = sheet;
  }
  const found = latest ? provas.find((prova) => prova.workoutIds.includes(latest.workoutId)) : undefined;
  return found?.key ?? provas[0]?.key ?? null;
};

// ---------------------------------------------------------------------------
// Baterias (D2, D3, D5)
// ---------------------------------------------------------------------------

const emptyCounts = (): BoardCounts => ({ submitted: 0, in_progress: 0, returned: 0, missing: 0, waiting: 0, cancelled: 0 });

const pairKey = (athleteId: string, workoutId: string) => `${athleteId}|${workoutId}`;

const newestFirst = (a: BoardSheet, b: BoardSheet) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0);

const sheetState = (sheet: BoardSheet): BoardLaneState => (sheet.status === 'cancelled' ? 'cancelled' : sheet.status);

const compareHeatItems = (a: BoardHeatItem, b: BoardHeatItem) =>
  (a.date || '').localeCompare(b.date || '')
  || (a.time || '').localeCompare(b.time || '')
  || (a.heatNumber ?? 999) - (b.heatNumber ?? 999)
  || String(a.id).localeCompare(String(b.id));

const finishGroup = <S extends BoardSheet>(group: Omit<BoardGroup<S>, 'complete' | 'counts'>): BoardGroup<S> => {
  const counts = emptyCounts();
  for (const entry of group.entries) counts[entry.state] += 1;
  const live = group.entries.length - counts.cancelled;
  return { ...group, counts, complete: live > 0 && counts.submitted === live };
};

/**
 * Monta a prova bateria por bateria. Toda súmula da prova aparece em algum
 * grupo: a ativa na raia do atleta, as canceladas presas a ele, e as que não
 * batem com o cronograma em "fora das baterias" (ou pela bateria gravada).
 */
export const buildScoresheetBoard = <S extends BoardSheet>(input: {
  workoutIds: string[];
  sheets: S[];
  heats: BoardHeatItem[];
  athletes: BoardAthlete[];
  divisionOrder?: string[];
}): ScoresheetBoard<S> => {
  const inProva = new Set(input.workoutIds);
  const sheets = input.sheets.filter((sheet) => inProva.has(sheet.workoutId));
  const athleteById = new Map(input.athletes.map((athlete) => [athlete.id, athlete]));

  const byPair = new Map<string, { active: S[]; cancelled: S[] }>();
  for (const sheet of sheets) {
    const key = pairKey(sheet.athleteId, sheet.workoutId);
    const bucket = byPair.get(key) ?? { active: [], cancelled: [] };
    (sheet.status === 'cancelled' ? bucket.cancelled : bucket.active).push(sheet);
    byPair.set(key, bucket);
  }
  for (const bucket of byPair.values()) {
    bucket.active.sort(newestFirst);
    bucket.cancelled.sort(newestFirst);
  }

  const entryFor = (key: string, athleteId: string, workoutId: string, sheet: S | null, cancelled: S[], heatNumber: number | null, lane: number | null): BoardEntry<S> => {
    const athlete = athleteById.get(athleteId);
    const reference = sheet ?? cancelled[0] ?? null;
    return {
      key,
      athleteId,
      workoutId,
      divisionId: reference?.divisionId || athlete?.divisionId || '',
      athleteName: reference?.athleteName || athlete?.name || '',
      box: reference?.box || athlete?.box || '',
      heatNumber,
      lane,
      sheet,
      cancelled,
      state: sheet ? sheetState(sheet) : (cancelled.length ? 'cancelled' : 'missing')
    };
  };

  // 1. Baterias do cronograma.
  const groups: BoardGroup<S>[] = [];
  const used = new Set<string>();
  const loose: BoardEntry<S>[] = [];
  for (const heat of input.heats.filter((item) => item.kind === 'heat').sort(compareHeatItems)) {
    const entries: BoardEntry<S>[] = [];
    (Array.isArray(heat.athleteIds) ? heat.athleteIds : []).forEach((athleteId, index) => {
      if (typeof athleteId !== 'string' || !athleteId) return;
      const workoutId = getLaneWorkoutId(heat, index);
      if (!inProva.has(workoutId)) return;
      const key = pairKey(athleteId, workoutId);
      const bucket = byPair.get(key);
      // Atleta que saiu do evento e não tem súmula: some, como na Quadra.
      if (used.has(key) || (!athleteById.has(athleteId) && !bucket)) return;
      used.add(key);
      const [sheet = null, ...extra] = bucket?.active ?? [];
      const heatNumber = typeof heat.heatNumber === 'number' ? heat.heatNumber : null;
      entries.push(entryFor(`heat:${heat.id}:${index + 1}`, athleteId, workoutId, sheet, bucket?.cancelled ?? [], heatNumber, index + 1));
      // Duas súmulas ativas do mesmo atleta na prova: a outra não some.
      for (const other of extra) loose.push(entryFor(`sheet:${other.id}`, athleteId, workoutId, other, [], other.heatNumber, other.lane));
    });
    if (entries.length === 0) continue;
    const started = entries.some((entry) => entry.sheet || entry.cancelled.length > 0);
    // Raia do cronograma sem súmula ativa (mesmo com canceladas): falta súmula, ou a bateria nem começou.
    for (const entry of entries) if (!entry.sheet) entry.state = started ? 'missing' : 'waiting';
    groups.push(finishGroup({
      key: `heat:${heat.id}`,
      kind: 'heat',
      heatNumber: typeof heat.heatNumber === 'number' ? heat.heatNumber : null,
      date: heat.date || '',
      time: heat.time || '',
      entries,
      started
    }));
  }

  // 2. Súmulas de quem não está no cronograma desta prova.
  for (const [key, bucket] of byPair) {
    if (used.has(key)) continue;
    const reference = bucket.active[0] ?? bucket.cancelled[0];
    const [sheet = null, ...extra] = bucket.active;
    loose.push(entryFor(`pair:${key}`, reference.athleteId, reference.workoutId, sheet, bucket.cancelled, reference.heatNumber, reference.lane));
    for (const other of extra) loose.push(entryFor(`sheet:${other.id}`, other.athleteId, other.workoutId, other, [], other.heatNumber, other.lane));
  }

  const divisionRank = new Map((input.divisionOrder ?? []).map((id, index) => [id, index]));
  const byHeatThenName = (a: BoardEntry<S>, b: BoardEntry<S>) =>
    (a.heatNumber ?? 999) - (b.heatNumber ?? 999) || (a.lane ?? 999) - (b.lane ?? 999) || a.athleteName.localeCompare(b.athleteName, 'pt-BR');
  const byDivisionThenName = (a: BoardEntry<S>, b: BoardEntry<S>) =>
    (divisionRank.get(a.divisionId) ?? 999) - (divisionRank.get(b.divisionId) ?? 999) || a.athleteName.localeCompare(b.athleteName, 'pt-BR');

  if (loose.length > 0) {
    if (groups.length > 0) {
      groups.push(finishGroup({ key: 'outside', kind: 'outside', heatNumber: null, date: '', time: '', entries: loose.sort(byHeatThenName), started: true }));
    } else {
      const numbers = [...new Set(loose.map((entry) => entry.heatNumber).filter((value): value is number => value !== null))].sort((a, b) => a - b);
      for (const heatNumber of numbers) {
        groups.push(finishGroup({
          key: `sheet-heat:${heatNumber}`,
          kind: 'sheet_heat',
          heatNumber,
          date: '',
          time: '',
          entries: loose.filter((entry) => entry.heatNumber === heatNumber).sort(byHeatThenName),
          started: true
        }));
      }
      const noHeat = loose.filter((entry) => entry.heatNumber === null);
      if (noHeat.length > 0) groups.push(finishGroup({ key: 'no-heat', kind: 'no_heat', heatNumber: null, date: '', time: '', entries: noHeat.sort(byDivisionThenName), started: true }));
    }
  }

  const stats: BoardStats = { total: 0, published: 0, inProgress: 0, returned: 0, missing: 0, waiting: 0, cancelled: 0, pending: 0 };
  for (const group of groups) {
    stats.total += group.entries.length - group.counts.cancelled;
    stats.published += group.counts.submitted;
    stats.inProgress += group.counts.in_progress;
    stats.returned += group.counts.returned;
    stats.missing += group.counts.missing;
    stats.waiting += group.counts.waiting;
  }
  stats.cancelled = sheets.filter((sheet) => sheet.status === 'cancelled').length;
  stats.pending = stats.inProgress + stats.returned + stats.missing;
  return { groups, stats };
};

// ---------------------------------------------------------------------------
// Filtros e abertura dos blocos
// ---------------------------------------------------------------------------

/** Texto para busca: sem acento, minúsculo e sem espaços nas pontas. */
export const normalizeBoardSearch = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR').trim();

export const isBoardFilterActive = (filter: BoardFilter) => Boolean(filter.divisionId) || filter.pendingOnly || normalizeBoardSearch(filter.query) !== '';

/** A raia aparece com estes filtros? Raia só com canceladas só aparece com "Canceladas" ligado. */
export const boardEntryMatches = (entry: BoardEntry, filter: BoardFilter): boolean => {
  if (entry.state === 'cancelled' && !filter.showCancelled) return false;
  if (filter.divisionId && entry.divisionId !== filter.divisionId) return false;
  if (filter.pendingOnly && !PENDING_STATES.has(entry.state)) return false;
  const query = normalizeBoardSearch(filter.query);
  return !query || normalizeBoardSearch(`${entry.athleteName} ${entry.box}`).includes(query);
};

/** Bateria completa ou que não começou fica recolhida; as outras abrem (D7). */
export const isBoardGroupOpenByDefault = (group: Pick<BoardGroup, 'kind' | 'started' | 'complete'>) =>
  group.kind === 'heat' ? group.started && !group.complete : !group.complete;

/** Atletas da prova por categoria (sem os que só têm súmula cancelada), para o filtro. */
export const countBoardDivisions = (board: ScoresheetBoard): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const group of board.groups) {
    for (const entry of group.entries) {
      if (entry.state === 'cancelled') continue;
      counts[entry.divisionId] = (counts[entry.divisionId] ?? 0) + 1;
    }
  }
  return counts;
};

/** "Time (Fulano / Beltrano)" → time em destaque e integrantes embaixo. */
export const splitTeamName = (name: string): { primary: string; secondary: string } => {
  const trimmed = name.trim();
  const match = /^(.+?)\s*\((.+)\)$/.exec(trimmed);
  return match ? { primary: match[1].trim(), secondary: match[2].trim() } : { primary: trimmed, secondary: '' };
};
