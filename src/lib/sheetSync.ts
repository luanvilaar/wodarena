import type { SheetEvent } from '@/lib/workoutStructure';

// Fila da súmula no aparelho (Story 1.50, decisão 7 da E3). Puro, sem rede: o
// gancho useSheetSync usa estas funções para guardar no celular os registros
// que ainda não chegaram ao servidor e o relógio da súmula, e para juntar o que
// ficou no aparelho com o que o servidor já tem depois de recarregar a página.
// O armazenamento local pode falhar (aba anônima, cota): tudo segue em memória.

export type QueuedEvent = { id: string; event: SheetEvent };
export type ClockPhase = 'ready' | 'running' | 'stopped';
export type SheetClock = { phase: ClockPhase; baseSeconds: number; startedAtMs: number | null };
export type LocalSheet = { pending: QueuedEvent[]; clock: SheetClock | null };

const storageKey = (sheetId: string) => `woda-sumula-${sheetId}`;

/** Id do registro, gerado no aparelho: o servidor descarta o reenvio do mesmo id. */
export const newClientEventId = () => {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return random.slice(0, 32);
};

export const READY_CLOCK: SheetClock = { phase: 'ready', baseSeconds: 0, startedAtMs: null };

/** Segundos do relógio da súmula agora. */
export const clockSeconds = (clock: SheetClock, nowMs: number) => (
  clock.phase === 'running' && clock.startedAtMs !== null
    ? clock.baseSeconds + Math.max(0, nowMs - clock.startedAtMs) / 1000
    : clock.baseSeconds
);

export const startClock = (clock: SheetClock, nowMs: number): SheetClock => ({ phase: 'running', baseSeconds: clock.baseSeconds, startedAtMs: nowMs });
export const stopClock = (clock: SheetClock, nowMs: number): SheetClock => ({ phase: 'stopped', baseSeconds: clockSeconds(clock, nowMs), startedAtMs: null });

const isQueuedEvent = (value: unknown): value is QueuedEvent => (
  Boolean(value) && typeof value === 'object'
  && typeof (value as QueuedEvent).id === 'string'
  && Boolean((value as QueuedEvent).event) && typeof (value as QueuedEvent).event === 'object'
);

const isClock = (value: unknown): value is SheetClock => {
  const clock = value as SheetClock;
  return Boolean(value) && typeof value === 'object'
    && (clock.phase === 'ready' || clock.phase === 'running' || clock.phase === 'stopped')
    && typeof clock.baseSeconds === 'number' && Number.isFinite(clock.baseSeconds) && clock.baseSeconds >= 0
    && (clock.startedAtMs === null || (typeof clock.startedAtMs === 'number' && Number.isFinite(clock.startedAtMs)));
};

export const loadLocalSheet = (sheetId: string): LocalSheet => {
  try {
    const raw = window.localStorage.getItem(storageKey(sheetId));
    if (!raw) return { pending: [], clock: null };
    const parsed = JSON.parse(raw) as { pending?: unknown; clock?: unknown };
    return {
      pending: Array.isArray(parsed.pending) ? parsed.pending.filter(isQueuedEvent) : [],
      clock: isClock(parsed.clock) ? parsed.clock : null
    };
  } catch {
    return { pending: [], clock: null };
  }
};

export const saveLocalSheet = (sheetId: string, local: LocalSheet) => {
  try {
    window.localStorage.setItem(storageKey(sheetId), JSON.stringify(local));
    return true;
  } catch {
    return false;
  }
};

export const clearLocalSheet = (sheetId: string) => {
  try {
    window.localStorage.removeItem(storageKey(sheetId));
  } catch {
    // Sem armazenamento local: nada a limpar.
  }
};

/**
 * Junta o que ficou no aparelho com o que o servidor tem: o que o servidor já
 * gravou (resposta perdida) sai da fila; o resto continua pendente, na ordem.
 */
export const mergePending = (serverEvents: readonly QueuedEvent[], localPending: readonly QueuedEvent[]) => {
  const known = new Set(serverEvents.map((item) => item.id));
  return localPending.filter((item) => !known.has(item.id));
};

/**
 * Relógio ao abrir a súmula: o guardado no aparelho, se houver; senão, parado
 * no instante do último registro (a súmula já tinha começado) ou pronto.
 */
export const initialClock = (local: SheetClock | null, events: readonly QueuedEvent[]): SheetClock => {
  if (local) return local;
  const last = events.reduce((max, item) => Math.max(max, Number(item.event.at) || 0), 0);
  return events.length > 0 ? { phase: 'stopped', baseSeconds: last, startedAtMs: null } : READY_CLOCK;
};

export type SyncStatus = 'saved' | 'saving' | 'offline' | 'conflict' | 'rejected';

/** Texto do estado da gravação; nunca diz "salvo" com registro pendente. */
export const describeSyncStatus = (status: SyncStatus, pendingCount: number) => {
  if (status === 'conflict') return 'Súmula alterada em outro aparelho. Recarregue para continuar.';
  if (status === 'rejected') return 'Um registro foi recusado pelo servidor. Desfaça o último e tente de novo.';
  if (pendingCount === 0) return 'Salvo';
  const items = `${pendingCount} ${pendingCount === 1 ? 'registro' : 'registros'}`;
  return status === 'offline' ? `Sem conexão: ${items} guardados no aparelho` : `Salvando ${items}…`;
};

/** Espera da próxima tentativa sem conexão: 2 s, 4 s, 8 s, até 15 s. */
export const retryDelayMs = (attempt: number) => Math.min(15_000, 2_000 * 2 ** Math.max(0, attempt));
