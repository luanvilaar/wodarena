// Fila da largada no aparelho (Story 1.96, AC6; D9). Puro, sem rede: a tela
// de largada guarda aqui a largada tocada com o horário do toque e a remove
// quando o servidor confirma (ou responde que a onda já largou). O MVP cobre
// queda de conexão com a tela já aberta; abrir a tela sem internet fica para a
// F4. O armazenamento local pode falhar (aba anônima, cota): a fila segue em
// memória na tela.

export type QueuedHeatStart = { heatId: string; deviceAt: number };

const storageKey = (eventId: string) => `woda-largada-${eventId}`;

const isQueuedHeatStart = (value: unknown): value is QueuedHeatStart => (
  Boolean(value) && typeof value === 'object'
  && typeof (value as QueuedHeatStart).heatId === 'string' && (value as QueuedHeatStart).heatId !== ''
  && typeof (value as QueuedHeatStart).deviceAt === 'number' && Number.isFinite((value as QueuedHeatStart).deviceAt) && (value as QueuedHeatStart).deviceAt > 0
);

/**
 * Acrescenta a largada tocada com o horário do toque. Uma por onda: tocar de
 * novo a mesma onda antes da confirmação mantém o primeiro horário.
 */
export const enqueueHeatStart = (queue: readonly QueuedHeatStart[], heatId: string, deviceAt: number): QueuedHeatStart[] => (
  queue.some((item) => item.heatId === heatId) ? [...queue] : [...queue, { heatId, deviceAt }]
);

/** Tira a largada da onda da fila (o servidor confirmou ou recusou). */
export const dequeueHeatStart = (queue: readonly QueuedHeatStart[], heatId: string) => queue.filter((item) => item.heatId !== heatId);

export const loadHeatStartQueue = (eventId: string): QueuedHeatStart[] => {
  try {
    const raw = window.localStorage.getItem(storageKey(eventId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isQueuedHeatStart) : [];
  } catch {
    return [];
  }
};

export const saveHeatStartQueue = (eventId: string, queue: readonly QueuedHeatStart[]) => {
  try {
    if (queue.length === 0) window.localStorage.removeItem(storageKey(eventId));
    else window.localStorage.setItem(storageKey(eventId), JSON.stringify(queue));
    return true;
  } catch {
    return false;
  }
};

export type HeatStartSyncStatus = 'saved' | 'saving' | 'offline';

/** Texto do indicador de sincronização da largada (AC6, maquete aprovada). */
export const describeHeatStartSync = (status: HeatStartSyncStatus, pendingCount: number) => {
  if (pendingCount > 0 && status === 'offline') return 'Largada guardada no aparelho · envio quando a conexão voltar';
  if (pendingCount > 0) return `Salvando ${pendingCount} ${pendingCount === 1 ? 'registro' : 'registros'}…`;
  if (status === 'offline') return 'Sem conexão';
  return 'Salvo';
};
