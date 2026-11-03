// Fila da largada no aparelho (Story 1.96, AC6; D9). Puro, sem rede: o painel
// do organizador (Story 1.110) guarda aqui a largada tocada com o horário do toque e a remove
// quando o servidor confirma (ou responde que a onda já largou). O MVP cobre
// queda de conexão com o painel já aberto; abrir o painel sem internet fica para a
// F4. O armazenamento local pode falhar (aba anônima, cota): a fila segue em
// memória no painel.

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

/**
 * Aviso de uma largada (Story 1.110, REQ-002): recusa do servidor, outro
 * aparelho largou antes (409 com horário) ou sessão expirada. Um por onda; o
 * painel mostra os avisos mesmo com a folha da onda fechada.
 */
export type HeatStartNotice = { kind: 'conflict' | 'error' | 'session'; heatId: string; text: string };

/** Grava o aviso da onda, trocando o anterior dela. */
export const upsertHeatStartNotice = (notices: readonly HeatStartNotice[], notice: HeatStartNotice): HeatStartNotice[] => (
  [...notices.filter((item) => item.heatId !== notice.heatId), notice]
);

/** Tira o aviso da onda (o gestor dispensou ou largou de novo). */
export const dismissHeatStartNotice = (notices: readonly HeatStartNotice[], heatId: string): HeatStartNotice[] => (
  notices.filter((item) => item.heatId !== heatId)
);

/** Uma largada subiu: o aviso de sessão expirada deixa de valer; recusas e conflitos ficam até o gestor dispensar. */
export const dropSessionHeatStartNotices = (notices: readonly HeatStartNotice[]): HeatStartNotice[] => (
  notices.filter((item) => item.kind !== 'session')
);

export type HeatStartSyncStatus = 'saved' | 'saving' | 'offline' | 'session';

export type HeatStartOutcome = 'started' | 'session' | 'retry' | 'rejected';

/**
 * O que fazer com a largada depois da resposta do servidor. Só sai da fila
 * quando o servidor confirma (ou diz que a onda já largou, 409 com o horário)
 * ou recusa de vez. Sessão expirada (401) fica guardada até entrar de novo,
 * sem tentar sozinha; limite de envios (429), serviço fora (503), outro 5xx e
 * rede caída ficam na fila e tentam de novo. Mesmo critério da fila dos
 * cartões (classifyRaceSyncResponse), para não perder o horário do toque.
 */
export const classifyHeatStartResponse = (status: number, hasStartedAt: boolean): HeatStartOutcome => {
  if ((status >= 200 && status < 300) || (status === 409 && hasStartedAt)) return 'started';
  if (status === 401) return 'session';
  if (status === 429 || status >= 500) return 'retry';
  return 'rejected';
};

/** Texto do indicador de sincronização da largada (AC6, maquete aprovada). */
export const describeHeatStartSync = (status: HeatStartSyncStatus, pendingCount: number) => {
  if (pendingCount > 0 && status === 'session') return 'Sessão expirada · largada guardada no aparelho';
  if (pendingCount > 0 && status === 'offline') return 'Largada guardada no aparelho · envio quando a conexão voltar';
  if (pendingCount > 0) return `Salvando ${pendingCount} ${pendingCount === 1 ? 'registro' : 'registros'}…`;
  if (status === 'offline') return 'Sem conexão';
  return 'Salvo';
};
