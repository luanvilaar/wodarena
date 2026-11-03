'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { RACE_SESSION_EXPIRED_MESSAGE } from '@/lib/raceWallBall';
import {
  classifyHeatStartResponse,
  dequeueHeatStart,
  dismissHeatStartNotice,
  dropSessionHeatStartNotices,
  enqueueHeatStart,
  loadHeatStartQueue,
  saveHeatStartQueue,
  upsertHeatStartNotice,
  type HeatStartNotice,
  type HeatStartSyncStatus,
  type QueuedHeatStart
} from '@/lib/raceStartQueue';
import { retryDelayMs } from '@/lib/sheetSync';

// Fila e envio da largada da onda (Story 1.96, AC6; D9), agora usada só pelo
// painel do organizador (Story 1.110): a largada é do gestor dono do evento ou
// do owner. A largada tocada fica na fila do aparelho com o horário do toque e
// sobe assim que der; sessão expirada guarda e espera o login, limite de
// envios, serviço fora e rede caída tentam de novo com espera crescente, e a
// largada recusada (acesso, onda vazia, sem percurso) sai da fila com o
// motivo (classifyHeatStartResponse).

export type { HeatStartNotice };

type Options = {
  eventId: string;
  /** O servidor confirmou a largada (ou disse que a onda já tinha largado, com o horário dele). */
  onStarted: (heatId: string, startedAt: string) => void;
  /** Terminou de enviar ao menos uma largada: recarregar as ondas. */
  onSettled: () => void;
};

export function useHeatStart({ eventId, onStarted, onSettled }: Options) {
  const [queue, setQueue] = useState<QueuedHeatStart[]>(() => (typeof window === 'undefined' ? [] : loadHeatStartQueue(eventId)));
  const [syncStatus, setSyncStatus] = useState<HeatStartSyncStatus>('saved');
  const [notices, setNotices] = useState<HeatStartNotice[]>([]);

  const queueRef = useRef(queue);
  const flushing = useRef(false);
  const retryAttempt = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushRef = useRef<() => Promise<void>>(async () => {});
  const callbacks = useRef({ onStarted, onSettled });
  useEffect(() => {
    callbacks.current = { onStarted, onSettled };
  });

  const updateQueue = useCallback((next: QueuedHeatStart[]) => {
    queueRef.current = next;
    setQueue(next);
    saveHeatStartQueue(eventId, next);
  }, [eventId]);

  // Envia a fila, uma largada por vez.
  useEffect(() => {
    flushRef.current = async () => {
      if (flushing.current) return;
      flushing.current = true;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = null;
      try {
        let started = false;
        while (queueRef.current.length > 0) {
          const item = queueRef.current[0];
          setSyncStatus('saving');
          let response: Response;
          try {
            response = await fetch('/api/race-sheets', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ action: 'start_heat', eventId, heatId: item.heatId, deviceAt: item.deviceAt, clientNow: Date.now() })
            });
          } catch {
            response = new Response(null, { status: 599 });
          }
          const data = await response.json().catch(() => ({})) as { error?: string; startedAt?: string };
          const outcome = classifyHeatStartResponse(response.status, Boolean(data.startedAt));
          if (outcome === 'started') {
            updateQueue(dequeueHeatStart(queueRef.current, item.heatId));
            if (data.startedAt) callbacks.current.onStarted(item.heatId, data.startedAt);
            if (response.status === 409) setNotices((previous) => upsertHeatStartNotice(dropSessionHeatStartNotices(previous), { kind: 'conflict', heatId: item.heatId, text: data.error || 'Largada já registrada.' }));
            else setNotices(dropSessionHeatStartNotices);
            retryAttempt.current = 0;
            started = true;
            continue;
          }
          // Sessão expirada: a largada fica no aparelho com o horário do toque e
          // sobe quando o painel voltar com o login (carga das ondas ou aba em primeiro plano).
          if (outcome === 'session') {
            setSyncStatus('session');
            setNotices((previous) => upsertHeatStartNotice(previous, { kind: 'session', heatId: item.heatId, text: RACE_SESSION_EXPIRED_MESSAGE }));
            return;
          }
          if (outcome === 'retry') {
            setSyncStatus('offline');
            retryTimer.current = setTimeout(() => void flushRef.current(), retryDelayMs(retryAttempt.current));
            retryAttempt.current += 1;
            return;
          }
          updateQueue(dequeueHeatStart(queueRef.current, item.heatId));
          setNotices((previous) => upsertHeatStartNotice(previous, { kind: 'error', heatId: item.heatId, text: data.error || 'A largada foi recusada pelo servidor.' }));
        }
        setSyncStatus('saved');
        if (started) callbacks.current.onSettled();
      } finally {
        flushing.current = false;
      }
    };
  }, [eventId, updateQueue]);

  // A conexão voltou ou a aba voltou ao primeiro plano (o navegador congela as retentativas em segundo plano).
  useEffect(() => {
    const resume = () => {
      if (document.visibilityState === 'visible' && queueRef.current.length > 0) void flushRef.current();
    };
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', resume);
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, []);

  /** Largar: guarda na fila com o horário do toque (AC6) e envia. Uma largada por onda. */
  const start = useCallback((heatId: string) => {
    if (queueRef.current.some((item) => item.heatId === heatId)) return;
    setNotices((previous) => dismissHeatStartNotice(previous, heatId));
    updateQueue(enqueueHeatStart(queueRef.current, heatId, Date.now()));
    void flushRef.current();
  }, [updateQueue]);

  /** Há largada na fila (pendente desde a carga da tela): tenta enviar. */
  const flush = useCallback(() => {
    if (queueRef.current.length > 0) void flushRef.current();
  }, []);

  /** O gestor dispensou o aviso da onda. */
  const dismissNotice = useCallback((heatId: string) => setNotices((previous) => dismissHeatStartNotice(previous, heatId)), []);

  return { queue, syncStatus, notices, start, flush, dismissNotice };
}
