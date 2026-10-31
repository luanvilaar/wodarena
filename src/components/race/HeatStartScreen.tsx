'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, CloudOff, Flag, Loader2 } from 'lucide-react';

import { CourtShell } from '@/components/judge/CourtShell';
import { RaceWaveList } from '@/components/race/RaceWaveList';
import { useTapHold } from '@/components/sheet/useTapHold';
import { useApp } from '@/context/AppContext';
import {
  dequeueHeatStart,
  describeHeatStartSync,
  enqueueHeatStart,
  loadHeatStartQueue,
  saveHeatStartQueue,
  type HeatStartSyncStatus,
  type QueuedHeatStart
} from '@/lib/raceStartQueue';
import { formatRaceClock, nextRaceWaveId, type RaceWave } from '@/lib/raceWaves';
import { retryDelayMs } from '@/lib/sheetSync';

// Tela de largada da onda (Story 1.96; maquete aprovada em
// docs/design/fitness-race-sumula/telas/largada.html, D23). Lista as ondas do
// Cronograma (D5) e, na onda aberta (?onda=), larga com o gesto de segurar
// (useTapHold, 700 ms; o toque rápido só avisa). A largada fica na fila do
// aparelho com o horário do toque e vai ao servidor assim que der (AC6, D9);
// o servidor confere o acesso, grava a marca e cria as corridas (start_heat).
// Não existe tela de chegada (D1): o fim do tempo vem do Wall Ball (1.97).

type WavesPayload = { event: { id: string; name: string; timeZone: string }; waves: RaceWave[] };
type Notice = { kind: 'conflict' | 'error'; heatId: string; text: string };

const HINT_MS = 2500;

export function HeatStartScreen({ eventId, heatId }: { eventId: string; heatId: string | null }) {
  const { currentUser } = useApp();
  const [payload, setPayload] = useState<WavesPayload | null>(null);
  const [error, setError] = useState('');
  const [queue, setQueue] = useState<QueuedHeatStart[]>(() => (typeof window === 'undefined' ? [] : loadHeatStartQueue(eventId)));
  const [syncStatus, setSyncStatus] = useState<HeatStartSyncStatus>('saved');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [hint, setHint] = useState(false);

  const queueRef = useRef(queue);
  const flushing = useRef(false);
  const retryAttempt = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushRef = useRef<() => Promise<void>>(async () => {});

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/race-sheets?view=waves&eventId=${encodeURIComponent(eventId)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Erro ao carregar as ondas.');
      setPayload({ event: data.event, waves: data.waves || [] });
      setError('');
      if (queueRef.current.length > 0) void flushRef.current();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erro ao carregar as ondas.');
    }
  }, [eventId]);

  const updateQueue = useCallback((next: QueuedHeatStart[]) => {
    queueRef.current = next;
    setQueue(next);
    saveHeatStartQueue(eventId, next);
  }, [eventId]);

  const markStarted = useCallback((startedHeatId: string, startedAt: string) => {
    setPayload((previous) => (previous
      ? { ...previous, waves: previous.waves.map((wave) => (wave.id === startedHeatId ? { ...wave, startedAt } : wave)) }
      : previous));
  }, []);

  // Envia a fila, uma largada por vez. Sem conexão (ou erro do servidor), tenta
  // de novo com espera crescente; a largada recusada (acesso, onda vazia, sem
  // percurso) sai da fila com o motivo na tela.
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
          if (response.ok || (response.status === 409 && data.startedAt)) {
            updateQueue(dequeueHeatStart(queueRef.current, item.heatId));
            if (data.startedAt) markStarted(item.heatId, data.startedAt);
            if (response.status === 409) setNotice({ kind: 'conflict', heatId: item.heatId, text: data.error || 'Largada já registrada.' });
            retryAttempt.current = 0;
            started = true;
            continue;
          }
          if (response.status >= 500 && response.status !== 503) {
            setSyncStatus('offline');
            retryTimer.current = setTimeout(() => void flushRef.current(), retryDelayMs(retryAttempt.current));
            retryAttempt.current += 1;
            return;
          }
          updateQueue(dequeueHeatStart(queueRef.current, item.heatId));
          setNotice({ kind: 'error', heatId: item.heatId, text: data.error || 'A largada foi recusada pelo servidor.' });
        }
        setSyncStatus('saved');
        if (started) void load();
      } finally {
        flushing.current = false;
      }
    };
  }, [eventId, load, markStarted, updateQueue]);

  useEffect(() => {
    if (!currentUser) return;
    const first = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(first);
  }, [currentUser, load]);

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
      if (hintTimer.current) clearTimeout(hintTimer.current);
    };
  }, []);

  const timeZone = payload?.event.timeZone;
  const waves = payload?.waves ?? [];
  const wave = heatId ? waves.find((item) => item.id === heatId) ?? null : null;
  const queued = wave ? queue.find((item) => item.heatId === wave.id) ?? null : null;

  // Largar: guarda na fila com o horário do toque (AC6) e envia. Atribuído
  // num efeito porque roda só no gesto, nunca durante a renderização.
  const startRef = useRef<() => void>(() => {});
  useEffect(() => {
    startRef.current = () => {
      if (!wave || wave.startedAt || queued) return;
      const deviceAt = Date.now();
      setNotice(null);
      updateQueue(enqueueHeatStart(queueRef.current, wave.id, deviceAt));
      void flushRef.current();
    };
  }, [wave, queued, updateQueue]);

  const showHint = () => {
    setHint(true);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(false), HINT_MS);
  };

  const { holding, handlers } = useTapHold({ onTap: showHint, onHold: () => startRef.current(), disabled: !wave || Boolean(wave.startedAt) || Boolean(queued) });

  const syncText = describeHeatStartSync(syncStatus, queue.length);
  const synced = queue.length === 0 && syncStatus === 'saved';
  const SyncIcon = syncStatus === 'offline' ? CloudOff : queue.length > 0 ? Loader2 : CheckCircle2;
  const syncBar = (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center gap-2 rounded-md border bg-background px-3 py-2.5 text-xs font-bold ${
        synced ? 'border-trading-up/60 text-trading-up' : syncStatus === 'offline' ? 'border-trading-down text-trading-down' : 'border-primary text-foreground'
      }`}
    >
      <SyncIcon className={`h-4 w-4 shrink-0 ${syncStatus === 'saving' ? 'motion-safe:animate-spin' : ''}`} aria-hidden="true" />
      <span>{syncText}</span>
    </div>
  );

  const listHref = `/judge/corrida/${encodeURIComponent(eventId)}`;
  const footerClass = 'sticky bottom-0 z-20 -mx-4 mt-5 space-y-2 border-t border-card-border bg-background/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur';

  if (!heatId || !payload || !wave) {
    const nextId = nextRaceWaveId(waves);
    return (
      <CourtShell
        eyebrow="Fitness Race · Largada"
        title={payload?.event.name || 'Largada'}
        subtitle={payload ? `Fitness Race · ${waves.length} ${waves.length === 1 ? 'onda' : 'ondas'}` : undefined}
        back={{ href: '/judge/corrida', label: 'Voltar aos eventos' }}
      >
        {error ? (
          <p role="alert" className="rounded-md border border-trading-down bg-trading-down/10 px-4 py-3 text-sm font-semibold">{error}</p>
        ) : !payload ? (
          <p role="status" className="py-10 text-center text-sm font-semibold text-muted">Carregando ondas…</p>
        ) : heatId ? (
          <div className="space-y-3 rounded-xl border border-card-border bg-card px-4 py-8 text-center">
            <p className="font-bold">Onda não encontrada no Cronograma.</p>
            <Link href={listHref} className="inline-flex min-h-14 items-center rounded-md border border-card-border px-4 text-sm font-bold">Ver as ondas</Link>
          </div>
        ) : waves.length === 0 ? (
          <div className="space-y-2 rounded-xl border border-card-border bg-card px-4 py-8 text-center">
            <p className="font-bold">Nenhuma onda com atletas no Cronograma.</p>
            <p className="text-sm text-muted">Peça ao organizador para montar as ondas na aba Cronograma.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-muted">Escolha a onda para largar. O horário é o previsto no Cronograma.</p>
            <RaceWaveList
              waves={waves}
              queuedIds={queue.map((entry) => entry.heatId)}
              nextId={nextId}
              timeZone={timeZone}
              hrefFor={(id) => `${listHref}?onda=${encodeURIComponent(id)}`}
            />
          </div>
        )}
        {payload && (
          <div className={footerClass}>
            {syncBar}
            {/* Árbitro do Wall Ball (Story 1.97) e das outras estações (Story 1.102): as listas da onda ficam a partir da tela do evento. */}
            <div className="grid grid-cols-2 gap-2">
              <Link href={`${listHref}/wall-ball`} className="flex min-h-14 items-center justify-center rounded-xl border-2 border-card-border bg-card text-base font-extrabold hover:border-primary">
                Abrir Wall Ball
              </Link>
              <Link href={`${listHref}/estacao`} className="flex min-h-14 items-center justify-center rounded-xl border-2 border-card-border bg-card text-base font-extrabold hover:border-primary">
                Abrir estações
              </Link>
            </div>
          </div>
        )}
      </CourtShell>
    );
  }

  const athleteCount = `${wave.athletes.length} ${wave.athletes.length === 1 ? 'atleta' : 'atletas'}`;
  const waveNotice = notice && notice.heatId === wave.id ? notice : null;

  return (
    <CourtShell eyebrow="Fitness Race · Largada" title={wave.title} subtitle={payload.event.name} back={{ href: listHref, label: 'Voltar às ondas' }}>
      <div className="space-y-4">
        {waveNotice?.kind === 'conflict' && (
          <div role="alert" className="space-y-1 rounded-xl border-2 border-primary bg-primary/10 p-4">
            <p className="font-extrabold">{waveNotice.text}</p>
            <p className="text-sm text-muted">Outro aparelho largou esta onda antes. Nada foi alterado: vale o horário registrado.</p>
          </div>
        )}
        {waveNotice?.kind === 'error' && (
          <p role="alert" className="rounded-md border border-trading-down bg-trading-down/10 px-4 py-3 text-sm font-semibold">{waveNotice.text}</p>
        )}

        {wave.startedAt ? (
          <div className="space-y-1 rounded-2xl border-2 border-trading-up bg-trading-up/10 p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-trading-up">Largou às</p>
            <p className="text-4xl font-extrabold tabular-nums">{formatRaceClock(wave.startedAt, timeZone)}</p>
            <p className="text-sm font-semibold text-muted">{wave.runsCount} {wave.runsCount === 1 ? 'corrida iniciada' : 'corridas iniciadas'}</p>
          </div>
        ) : queued ? (
          <div className="space-y-1 rounded-2xl border-2 border-trading-down bg-trading-down/10 p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-trading-down">Guardada no aparelho</p>
            <p className="text-4xl font-extrabold tabular-nums">{formatRaceClock(new Date(queued.deviceAt).toISOString(), timeZone)}</p>
            <p className="text-sm font-semibold text-muted">
              Horário do toque. {syncStatus === 'offline' ? 'Será enviada quando a conexão voltar. Não feche esta tela.' : 'Enviando ao servidor…'}
            </p>
          </div>
        ) : (
          <div className="space-y-2 rounded-2xl border border-card-border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-widest text-muted">Horário previsto</span>
              <span className="rounded-full border border-card-border px-2 py-1 text-[11px] font-bold text-muted">Aguardando largada</span>
            </div>
            <p className="text-4xl font-extrabold tabular-nums">{wave.time || '—'}</p>
            <p className="text-sm font-semibold text-muted">Previsto no Cronograma. O tempo dos atletas começa no gesto de largar.</p>
            {wave.categories.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {wave.categories.map((category) => (
                  <span key={category} className="rounded-full border border-primary/60 px-2 py-1 text-[11px] font-bold">{category}</span>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-extrabold uppercase tracking-wider">Atletas da onda</h2>
          <span className="text-sm font-bold tabular-nums text-muted">{wave.athletes.length}</span>
        </div>
        <ul className="divide-y divide-card-border rounded-xl border border-card-border bg-card" aria-label="Atletas da onda">
          {wave.athletes.map((athlete) => (
            <li key={athlete.id} className="flex min-h-14 items-center justify-between gap-3 px-4 py-2">
              <span className="min-w-0">
                <span className="block truncate font-bold">{athlete.name}</span>
                <span className="block truncate text-xs font-semibold text-muted">{[athlete.box, athlete.divisionName].filter(Boolean).join(' · ')}</span>
              </span>
              {wave.startedAt ? (
                <span className="shrink-0 rounded-full border border-trading-up/60 px-2 py-1 text-[11px] font-bold text-trading-up">Em corrida</span>
              ) : queued ? (
                <span className="shrink-0 rounded-full border border-card-border px-2 py-1 text-[11px] font-bold text-muted">Aguardando confirmação</span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      <div className={footerClass}>
        {syncBar}
        {wave.startedAt ? (
          <div className="flex min-h-14 items-center justify-center gap-2 rounded-xl border-2 border-trading-up text-base font-extrabold text-trading-up">
            <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
            Largada registrada
          </div>
        ) : queued ? (
          <div className="flex min-h-14 items-center justify-center gap-2 rounded-xl border-2 border-trading-down text-base font-extrabold text-trading-down">
            <CloudOff className="h-5 w-5" aria-hidden="true" />
            {syncStatus === 'offline' ? 'Largada guardada no aparelho' : 'Enviando a largada…'}
          </div>
        ) : (
          <>
            {hint && <p role="status" className="text-center text-sm font-extrabold">Segure para largar</p>}
            <button
              type="button"
              {...handlers}
              aria-label={`Largar a ${wave.title}: segure o botão por quase um segundo. Sem desfazer.`}
              className="relative flex min-h-[88px] w-full touch-none select-none flex-col items-center justify-center gap-1 overflow-hidden rounded-2xl border-2 border-foreground bg-primary px-4 py-3 text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/50"
            >
              <span
                aria-hidden="true"
                className={`absolute inset-y-0 left-0 bg-foreground/25 ${holding ? 'motion-safe:transition-[width] motion-safe:duration-700 motion-safe:ease-linear' : ''}`}
                style={{ width: holding ? '100%' : '0%' }}
              />
              <span className="relative flex items-center gap-2 text-lg font-extrabold uppercase tracking-wide">
                <Flag className="h-6 w-6" aria-hidden="true" />
                {holding ? 'Continue segurando…' : 'Segure para largar'}
              </span>
              <span className="relative text-xs font-bold">{wave.title} · {athleteCount} · sem desfazer</span>
            </button>
          </>
        )}
      </div>
    </CourtShell>
  );
}
