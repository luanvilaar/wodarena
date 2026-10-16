'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  describeSyncStatus,
  loadLocalSheet,
  mergePending,
  newClientEventId,
  retryDelayMs,
  saveLocalSheet,
  type QueuedEvent,
  type SheetClock,
  type SyncStatus
} from '@/lib/sheetSync';
import type { SheetEvent } from '@/lib/workoutStructure';

// Gravação da súmula a partir do aparelho (Story 1.50). Cada registro entra na
// fila local na hora (a tela responde sem esperar a rede), sobe em lote para
// /api/sheets e só sai da fila quando o servidor confirma. Sem conexão, a fila
// fica guardada no celular e tenta de novo (2 s, 4 s, 8 s, até 15 s, e quando
// a rede volta). 409 é conflito com outro aparelho; 400/401/403 param a fila
// com a mensagem do servidor.

type Options = { sheetId: string; serverEvents: QueuedEvent[]; writable: boolean };

export function useSheetSync({ sheetId, serverEvents, writable }: Options) {
  const [confirmed, setConfirmed] = useState<QueuedEvent[]>(serverEvents);
  const [pending, setPending] = useState<QueuedEvent[]>(() => (
    typeof window === 'undefined' ? [] : mergePending(serverEvents, loadLocalSheet(sheetId).pending)
  ));
  const [status, setStatus] = useState<SyncStatus>('saved');
  const [message, setMessage] = useState('');

  const confirmedRef = useRef(confirmed);
  const pendingRef = useRef(pending);
  const clockRef = useRef<SheetClock | null>(typeof window === 'undefined' ? null : loadLocalSheet(sheetId).clock);
  const inFlight = useRef(false);
  const attempt = useRef(0);
  const retryTimer = useRef<number | null>(null);
  const stopped = useRef(false);

  const persist = useCallback(() => {
    saveLocalSheet(sheetId, { pending: pendingRef.current, clock: clockRef.current });
  }, [sheetId]);

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
    try {
      const response = await fetch('/api/sheets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'append', sheetId, fromSeq: confirmedRef.current.length, events: batch })
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (response.ok) {
        confirmedRef.current = [...confirmedRef.current, ...batch];
        pendingRef.current = pendingRef.current.slice(batch.length);
        setConfirmed(confirmedRef.current);
        setPending(pendingRef.current);
        attempt.current = 0;
        persist();
        inFlight.current = false;
        if (pendingRef.current.length > 0) void flushRef.current();
        else setStatus('saved');
        return;
      }
      if (response.status === 409) {
        stopped.current = true;
        setStatus('conflict');
        setMessage(data.error || '');
      } else if (response.status === 400 || response.status === 401 || response.status === 403) {
        stopped.current = true;
        setStatus('rejected');
        setMessage(response.status === 401 ? 'Sua sessão expirou. Entre de novo para enviar os registros guardados.' : data.error || '');
      } else {
        throw new Error('retry');
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
    }
  }, [persist, sheetId, writable]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  // Ao abrir, sobe o que ficou guardado no aparelho; e de novo quando a rede volta.
  useEffect(() => {
    if (!writable) return;
    const timer = window.setTimeout(() => void flushRef.current(), 0);
    const online = () => {
      attempt.current = 0;
      void flushRef.current();
    };
    window.addEventListener('online', online);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('online', online);
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
    };
  }, [writable]);

  const record = useCallback((event: SheetEvent) => {
    const item = { id: newClientEventId(), event };
    pendingRef.current = [...pendingRef.current, item];
    setPending(pendingRef.current);
    persist();
    void flushRef.current();
  }, [persist]);

  const saveClock = useCallback((clock: SheetClock) => {
    clockRef.current = clock;
    persist();
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

  const events = useMemo(() => [...confirmed, ...pending].map((item) => item.event), [confirmed, pending]);

  return {
    events,
    confirmedCount: confirmed.length,
    pendingCount: pending.length,
    status,
    statusText: describeSyncStatus(status, pending.length),
    message,
    record,
    flush,
    saveClock,
    discardRejected
  };
}
