'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { RaceEvent } from '@/lib/raceRules';
import {
  RACE_SESSION_EXPIRED_MESSAGE,
  buildRaceAppendBody,
  classifyRaceSyncResponse,
  type RaceQueuedEvent
} from '@/lib/raceWallBall';
import {
  describeSyncStatus,
  loadLocalSheet,
  mergePending,
  newClientEventId,
  retryDelayMs,
  saveLocalSheet,
  type QueuedEvent,
  type SyncStatus
} from '@/lib/sheetSync';

// Gravação da súmula Fitness Race a partir do aparelho (Story 1.97, AC13).
// Modelo: useSheetSync (Functional Fitness, que segue intocado). Cada toque
// entra na fila local na hora, com o horário do aparelho, e sobe em lote, em
// ordem, para /api/race-sheets; só sai da fila quando o servidor confirma. A
// chave local é a do sheetSync com o id da tentativa (`attempt_…`, não colide
// com as súmulas de FF). Sem conexão, tenta de novo (2 s, 4 s, até 15 s, e
// quando a rede ou a aba voltam). 409 para e pede para recarregar; 401 para,
// preserva a fila e pede o login; 400/403 param com a mensagem do servidor.

export type RaceAppendResult = {
  attempt?: { status?: string; progress?: Record<string, unknown> };
  run?: { status?: string; finishAt?: string | null; grossSeconds?: number | null; officialSeconds?: number | null; penaltySeconds?: number };
};

type Options = {
  attemptId: string;
  serverEvents: RaceQueuedEvent[];
  writable: boolean;
  onSaved?: (result: RaceAppendResult) => void;
};

// O sheetSync guarda `{ id, event }`; o horário do toque viaja junto no mesmo objeto.
const toLocal = (items: RaceQueuedEvent[]) => items as unknown as QueuedEvent[];
const fromLocal = (items: QueuedEvent[]) => items as unknown as RaceQueuedEvent[];

export function useRaceSync({ attemptId, serverEvents, writable, onSaved }: Options) {
  const [confirmed, setConfirmed] = useState<RaceQueuedEvent[]>(serverEvents);
  const [pending, setPending] = useState<RaceQueuedEvent[]>(() => (
    typeof window === 'undefined' ? [] : fromLocal(mergePending(toLocal(serverEvents), loadLocalSheet(attemptId).pending))
  ));
  const [status, setStatus] = useState<SyncStatus>('saved');
  const [message, setMessage] = useState('');
  const [sessionExpired, setSessionExpired] = useState(false);

  const confirmedRef = useRef(confirmed);
  const pendingRef = useRef(pending);
  const inFlight = useRef(false);
  const attempt = useRef(0);
  const retryTimer = useRef<number | null>(null);
  const stopped = useRef(false);
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    onSavedRef.current = onSaved;
  });

  const persist = useCallback(() => {
    saveLocalSheet(attemptId, { pending: toLocal(pendingRef.current), clock: null });
  }, [attemptId]);

  const flushRef = useRef<() => Promise<void>>(async () => {});

  const flush = useCallback(async () => {
    if (!writable || inFlight.current || stopped.current) return;
    if (retryTimer.current !== null) {
      window.clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    const batch = pendingRef.current.slice(0, 200);
    if (batch.length === 0) {
      setStatus('saved');
      return;
    }
    inFlight.current = true;
    setStatus('saving');
    let flushAgain = false;
    try {
      const response = await fetch('/api/race-sheets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildRaceAppendBody(attemptId, confirmedRef.current.length, batch, Date.now()))
      });
      const data = await response.json().catch(() => ({})) as RaceAppendResult & { error?: string };
      const outcome = classifyRaceSyncResponse(response.status);
      if (outcome === 'ok') {
        confirmedRef.current = [...confirmedRef.current, ...batch];
        pendingRef.current = pendingRef.current.slice(batch.length);
        setConfirmed(confirmedRef.current);
        setPending(pendingRef.current);
        attempt.current = 0;
        persist();
        onSavedRef.current?.(data);
        if (pendingRef.current.length > 0) flushAgain = true;
        else setStatus('saved');
        return;
      }
      if (outcome === 'retry') throw new Error('retry');
      stopped.current = true;
      if (outcome === 'conflict') {
        setStatus('conflict');
        setMessage(data.error || '');
      } else {
        setStatus('rejected');
        setSessionExpired(outcome === 'session');
        setMessage(outcome === 'session' ? RACE_SESSION_EXPIRED_MESSAGE : data.error || '');
      }
    } catch {
      setStatus('offline');
      const delay = retryDelayMs(attempt.current);
      attempt.current += 1;
      retryTimer.current = window.setTimeout(() => {
        retryTimer.current = null;
        void flushRef.current();
      }, delay);
    } finally {
      inFlight.current = false;
      if (flushAgain) void flushRef.current();
    }
  }, [attemptId, persist, writable]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  // Ao abrir, sobe o que ficou guardado; de novo quando a rede volta ou a aba volta ao primeiro plano.
  useEffect(() => {
    if (!writable) return;
    const timer = window.setTimeout(() => void flushRef.current(), 0);
    const resume = () => {
      if (document.visibilityState !== 'visible') return;
      attempt.current = 0;
      void flushRef.current();
    };
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', resume);
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
    };
  }, [writable]);

  /** Registra na hora (fila local + tela) e envia; vários eventos entram juntos e na ordem. */
  const record = useCallback((...events: RaceEvent[]) => {
    const deviceAt = Date.now();
    pendingRef.current = [...pendingRef.current, ...events.map((event) => ({ id: newClientEventId(), event, deviceAt }))];
    setPending(pendingRef.current);
    persist();
    void flushRef.current();
  }, [persist]);

  /** Tira da fila o registro que o servidor recusou e volta a enviar o resto. */
  const discardRejected = useCallback(() => {
    pendingRef.current = pendingRef.current.slice(1);
    setPending(pendingRef.current);
    persist();
    stopped.current = false;
    setMessage('');
    setStatus(pendingRef.current.length > 0 ? 'saving' : 'saved');
    void flushRef.current();
  }, [persist]);

  const items = useMemo(() => [...confirmed, ...pending], [confirmed, pending]);

  return {
    items,
    pendingCount: pending.length,
    status,
    statusText: describeSyncStatus(status, pending.length),
    message,
    sessionExpired,
    record,
    discardRejected
  };
}
