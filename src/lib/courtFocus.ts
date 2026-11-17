import { nextHeat } from '@/lib/broadcastMode';

// Foco da quadra do judge (Story 1.147, docs/design/quadra-por-raia/, D1 a D3).
// Puro. A bateria "agora" vem das súmulas, como no telão (broadcastMode.ts): o
// cronograma só dá a ordem. Regras:
// - bateria tocada = alguma raia com súmula (em andamento, devolvida ou enviada);
// - a última bateria tocada que ainda não terminou é a atual ("em chamada" se tem
//   súmula aberta); terminou (todas as raias enviadas) → a próxima sem súmula,
//   pela mesma regra de `nextHeat` do telão;
// - nenhuma tocada → a primeira do cronograma.
// Súmula esquecida numa bateria antiga não segura a quadra: vale a última tocada.

export type FocusLaneStatus = 'not_started' | 'in_progress' | 'returned' | 'submitted';
export type FocusHeat = { id: string; date: string; time: string; heatNumber: number | null; laneStatuses: FocusLaneStatus[] };
export type CurrentHeat = { heatId: string; called: boolean; finished: boolean };

/** Ordem oficial das baterias: dia e horário, depois o número (a mesma do telão em serverBroadcast.ts). */
export const orderHeats = <H extends Pick<FocusHeat, 'date' | 'time' | 'heatNumber'>>(heats: readonly H[]): H[] => [...heats]
  .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`) || (a.heatNumber ?? 0) - (b.heatNumber ?? 0));

const touched = (heat: FocusHeat) => heat.laneStatuses.some((status) => status !== 'not_started');
const finished = (heat: FocusHeat) => heat.laneStatuses.length > 0 && heat.laneStatuses.every((status) => status === 'submitted');
const open = (heat: FocusHeat) => heat.laneStatuses.some((status) => status === 'in_progress' || status === 'returned');

export const findCurrentHeat = (heats: readonly FocusHeat[]): CurrentHeat | null => {
  const ordered = orderHeats(heats).map((heat, order) => ({ ...heat, order, isCallReleased: false }));
  if (ordered.length === 0) return null;
  const last = [...ordered].reverse().find(touched);
  if (!last) return { heatId: ordered[0].id, called: false, finished: false };
  if (!finished(last)) return { heatId: last.id, called: open(last), finished: false };
  const groups = ordered.filter(touched).map((heat) => ({ key: heat.id, finishedMs: finished(heat) ? 1 : null }));
  const next = nextHeat(ordered, groups);
  return next ? { heatId: next.id, called: false, finished: false } : { heatId: last.id, called: false, finished: true };
};

/** A bateria seguinte na ordem oficial (para "Depois"), ou null. */
export const followingHeatId = (heats: readonly FocusHeat[], heatId: string) => {
  const ordered = orderHeats(heats);
  const index = ordered.findIndex((heat) => heat.id === heatId);
  return index >= 0 && index + 1 < ordered.length ? ordered[index + 1].id : null;
};

export type CourtLane = number | 'multi';

/** Lê a raia guardada no aparelho ("3" ou "multi"); qualquer outra coisa é "sem raia". */
export const parseCourtLane = (raw: unknown): CourtLane | null => {
  if (raw === 'multi') return 'multi';
  const value = typeof raw === 'string' ? Number(raw) : Number.NaN;
  return Number.isInteger(value) && value > 0 && value < 100 ? value : null;
};

export const courtLaneStorageKey = (eventId: string) => `woda:court-lane:${eventId}`;

/** A raia guardada no aparelho para o evento (D1); sem armazenamento, "sem raia". */
export const loadCourtLane = (eventId: string): CourtLane | null => {
  try {
    return parseCourtLane(window.localStorage.getItem(courtLaneStorageKey(eventId)));
  } catch {
    return null;
  }
};

/** Guarda (ou apaga, com null) a raia do evento no aparelho. Sem armazenamento, vale só na tela aberta. */
export const saveCourtLane = (eventId: string, lane: CourtLane | null) => {
  try {
    if (lane === null) window.localStorage.removeItem(courtLaneStorageKey(eventId));
    else window.localStorage.setItem(courtLaneStorageKey(eventId), String(lane));
  } catch {
    // Armazenamento bloqueado (aba anônima, dados apagados): segue sem guardar.
  }
};

/**
 * Abrir direto ou pedir confirmação (D3). Direto: a súmula já é do judge, ou é
 * a raia dele na bateria atual. Todo o resto confirma; `warnings` diz o que não
 * bate (vazio no modo "várias raias" dentro da bateria atual).
 */
export const openDecision = (input: {
  myLane: CourtLane | null;
  lane: number | null;
  heatId: string | null;
  currentHeatId: string | null;
  ownSheet: boolean;
}): { direct: boolean; warnings: string[] } => {
  if (input.ownSheet) return { direct: true, warnings: [] };
  if (input.heatId === null) return { direct: false, warnings: ['Atleta fora das baterias do cronograma'] };
  const warnings: string[] = [];
  const sameLane = typeof input.myLane === 'number' && input.lane === input.myLane;
  if (typeof input.myLane === 'number' && !sameLane) warnings.push(`Você está na Raia ${input.myLane}`);
  if (input.heatId !== input.currentHeatId) warnings.push('Esta bateria não é a que está em chamada');
  return { direct: sameLane && warnings.length === 0, warnings };
};

/** Busca da lista sem bateria (D7): sem acento e sem diferença de maiúsculas, por nome ou box. */
const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const filterLooseAthletes = <A extends { name: string; box: string }>(athletes: readonly A[], query: string): A[] => {
  const q = fold(query.trim());
  return [...athletes]
    .filter((athlete) => !q || fold(`${athlete.name} ${athlete.box}`).includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
};
