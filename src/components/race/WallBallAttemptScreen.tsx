'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, CloudOff, Loader2 } from 'lucide-react';

import { CourtShell } from '@/components/judge/CourtShell';
import { useRaceSync, type RaceAppendResult } from '@/components/judge/useRaceSync';
import { WallBallCard } from '@/components/race/WallBallCard';
import { useApp } from '@/context/AppContext';
import { evaluateRaceStation, type RaceCourseStage, type RaceEvent, type RaceRuleset } from '@/lib/raceRules';
import {
  WALL_BALL_EYEBROW,
  describeLastWallBallAction,
  formatRaceElapsed,
  lastUndoableSeq,
  raceElapsedSeconds,
  releasedElapsedSeconds,
  wallBallInfractionItems,
  wallBallLoad,
  type RaceQueuedEvent
} from '@/lib/raceWallBall';
import { formatRaceClock } from '@/lib/raceWaves';

// Tela de contagem do Wall Ball (Story 1.97). Carrega a tentativa (view
// attempt), roda o motor no aparelho sobre o log confirmado + a fila local
// (a tela responde sem esperar a rede) e envia cada toque por useRaceSync. O
// tempo exibido é só do aparelho (D21); o oficial é o que o servidor grava ao
// liberar a última estação (D34), e aparece quando a resposta chega. Com o
// Wall Ball no meio do percurso (`closesTime` falso, Story 1.101), a
// liberação só manda o atleta para a próxima estação.

type RunInfo = { status?: string; startedAt?: string | null; finishAt?: string | null; grossSeconds?: number | null; officialSeconds?: number | null };

type AttemptPayload = {
  attempt: { id: string; status: string; judgeUserId: string | null; judgeName: string; stationKind: string; closesTime?: boolean };
  run: RunInfo;
  stage: { id: string; name: string; reps?: number; maleWeight?: string; femaleWeight?: string } | null;
  ruleset: { rules: RaceRuleset };
  events: { id: string; event: RaceEvent; deviceAt: string | null }[];
  context: { athleteName: string; box: string; divisionName: string; team: boolean; category: string | null; eventName: string; timeZone: string };
  viewer: { id: string; role: string };
};

const listHrefOf = (eventId: string) => `/judge/corrida/${encodeURIComponent(eventId)}/wall-ball`;

export function WallBallAttemptScreen({ eventId, attemptId }: { eventId: string; attemptId: string }) {
  const { currentUser } = useApp();
  const [payload, setPayload] = useState<AttemptPayload | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/race-sheets?view=attempt&attemptId=${encodeURIComponent(attemptId)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Erro ao carregar a tentativa.');
      setPayload(data as AttemptPayload);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erro ao carregar a tentativa.');
    }
  }, [attemptId]);

  useEffect(() => {
    if (!currentUser) return;
    const first = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(first);
  }, [currentUser, load]);

  const claim = async () => {
    const response = await fetch('/api/race-sheets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'claim_attempt', attemptId })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) setError(data.error || 'Não foi possível assumir a tentativa.');
    else void load();
  };

  if (!payload || !payload.stage) {
    return (
      <CourtShell eyebrow={WALL_BALL_EYEBROW} title="Wall Ball" back={{ href: listHrefOf(eventId), label: 'Voltar à lista da onda' }}>
        {error ? (
          <p role="alert" className="rounded-md border border-trading-down bg-trading-down/10 px-4 py-3 text-sm font-semibold">{error}</p>
        ) : payload ? (
          <p role="alert" className="rounded-md border border-trading-down bg-trading-down/10 px-4 py-3 text-sm font-semibold">Esta estação não está no percurso da corrida.</p>
        ) : (
          <p role="status" className="py-10 text-center text-sm font-semibold text-muted">Carregando a tentativa…</p>
        )}
      </CourtShell>
    );
  }

  return <WallBallCounter key={payload.attempt.id} eventId={eventId} payload={payload} error={error} onClaim={claim} />;
}

function WallBallCounter({ eventId, payload, error, onClaim }: { eventId: string; payload: AttemptPayload; error: string; onClaim: () => void }) {
  const { attempt, context, ruleset, viewer } = payload;
  const stage = payload.stage!;
  const closesTime = attempt.closesTime !== false;
  const rules = ruleset.rules;
  const [run, setRun] = useState<RunInfo>(payload.run);
  const [now, setNow] = useState(() => Date.now());

  const isWriter = attempt.judgeUserId === viewer.id;
  const writable = isWriter && attempt.status !== 'cancelled' && run.status === 'racing';
  const serverEvents = useMemo<RaceQueuedEvent[]>(() => payload.events.map((item) => ({
    id: item.id,
    event: item.event,
    deviceAt: item.deviceAt ? Date.parse(item.deviceAt) : null
  })), [payload.events]);

  const onSaved = useCallback((result: RaceAppendResult) => {
    if (result.run) setRun((previous) => ({ ...previous, ...result.run }));
  }, []);
  const sync = useRaceSync({ attemptId: attempt.id, serverEvents, writable, onSaved });

  const engineStage = useMemo<RaceCourseStage>(() => ({
    id: stage.id, name: stage.name, reps: stage.reps, maleWeight: stage.maleWeight, femaleWeight: stage.femaleWeight, kind: 'wall_ball'
  }), [stage]);
  const result = useMemo(() => evaluateRaceStation(rules, engineStage, sync.items.map((item) => item.event)), [rules, engineStage, sync.items]);
  const targetReps = result.targetReps ?? stage.reps ?? 0;
  const releasedState = result.state === 'released';

  // Relógio da tela: 1 s enquanto o atleta corre.
  useEffect(() => {
    if (releasedState) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [releasedState]);

  // Tela acesa quando o aparelho permite (Wake Lock); pedida de novo ao voltar para a aba.
  useEffect(() => {
    type Sentinel = { release: () => Promise<void> };
    const wakeLock = (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<Sentinel> } }).wakeLock;
    if (!wakeLock || releasedState) return;
    let sentinel: Sentinel | null = null;
    const request = () => {
      if (document.visibilityState !== 'visible') return;
      wakeLock.request('screen').then((lock) => { sentinel = lock; }).catch(() => {});
    };
    request();
    document.addEventListener('visibilitychange', request);
    return () => {
      document.removeEventListener('visibilitychange', request);
      void sentinel?.release().catch(() => {});
    };
  }, [releasedState]);

  const record = (...events: RaceEvent[]) => sync.record(...events);
  const withStart = (event: RaceEvent) => (result.started ? record(event) : record({ t: 'start' }, event));
  const undoSeq = lastUndoableSeq(sync.items, result);

  const abandonItem = result.abandonSeq !== null ? sync.items[result.abandonSeq] : null;
  const abandonedAt = result.abandoned
    ? (abandonItem?.deviceAt ? formatRaceClock(new Date(abandonItem.deviceAt).toISOString(), context.timeZone) : '—')
    : null;
  const releasedInfo = releasedState
    ? {
      elapsed: formatRaceElapsed(releasedElapsedSeconds(run.startedAt, sync.items, result)),
      official: closesTime && typeof run.officialSeconds === 'number' && run.status === 'finished' ? formatRaceElapsed(run.officialSeconds) : null
    }
    : null;

  const stopped = sync.status === 'conflict' || sync.status === 'rejected';
  const synced = sync.pendingCount === 0 && sync.status === 'saved';
  const SyncIcon = sync.status === 'offline' ? CloudOff : sync.pendingCount > 0 ? Loader2 : CheckCircle2;
  const listHref = listHrefOf(eventId);
  const subtitle = [context.team ? 'Dupla' : context.box, context.divisionName, context.eventName].filter(Boolean).join(' · ');

  return (
    <CourtShell eyebrow={WALL_BALL_EYEBROW} title={context.athleteName || 'Atleta'} subtitle={subtitle} back={{ href: listHref, label: 'Voltar à lista da onda' }}>
      <div className="space-y-3">
        <div
          role="status"
          aria-live="polite"
          className={`flex items-center gap-2 rounded-md border bg-background px-3 py-2.5 text-xs font-bold ${
            synced ? 'border-trading-up/60 text-trading-up' : sync.status === 'offline' || stopped ? 'border-trading-down text-trading-down' : 'border-primary text-foreground'
          }`}
        >
          <SyncIcon className={`h-4 w-4 shrink-0 ${sync.status === 'saving' ? 'motion-safe:animate-spin' : ''}`} aria-hidden="true" />
          <span>{sync.statusText}</span>
        </div>
        {(error || sync.message) && (
          <div role="alert" className="space-y-2 rounded-md border border-trading-down bg-trading-down/10 px-4 py-3 text-sm font-semibold">
            <p>{sync.message || error}</p>
            {sync.status === 'conflict' && (
              <button type="button" onClick={() => window.location.reload()} className="min-h-14 w-full rounded-xl border-2 border-card-border bg-card font-extrabold">Recarregar</button>
            )}
            {sync.sessionExpired ? (
              <Link href="/admin" className="flex min-h-14 items-center justify-center rounded-xl border-2 border-card-border bg-card font-extrabold">Entrar de novo</Link>
            ) : sync.status === 'rejected' && (
              <button type="button" onClick={sync.discardRejected} className="min-h-14 w-full rounded-xl border-2 border-card-border bg-card font-extrabold">Descartar o registro recusado</button>
            )}
          </div>
        )}
        {!isWriter && attempt.status !== 'released' && (
          <div className="space-y-2 rounded-md border border-card-border bg-card px-4 py-3 text-sm font-semibold">
            <p>{attempt.judgeUserId ? `Esta tentativa está com ${attempt.judgeName}. Só leitura.` : 'Esta tentativa está sem árbitro.'}</p>
            {!attempt.judgeUserId && (
              <button type="button" onClick={onClaim} className="min-h-14 w-full rounded-xl border-2 border-primary bg-card font-extrabold">Assumir esta tentativa</button>
            )}
          </div>
        )}
        {isWriter && run.status !== 'racing' && !releasedState && (
          <p className="rounded-md border border-card-border bg-card px-4 py-3 text-sm font-semibold">A corrida deste atleta já foi encerrada. Correções são com o organizador.</p>
        )}

        <WallBallCard
          athleteName={context.athleteName || 'O atleta'}
          team={context.team}
          load={wallBallLoad(stage, context.category)}
          validReps={result.validReps}
          targetReps={targetReps}
          noRepCount={result.noReps.length}
          penaltySeconds={result.penaltySeconds}
          lastAction={describeLastWallBallAction(sync.items, rules, result.validReps, result.targetReps)}
          elapsed={formatRaceElapsed(raceElapsedSeconds(run.startedAt, now))}
          abandonedAt={abandonedAt}
          released={releasedInfo}
          closesTime={closesTime}
          noRepReasons={rules.wallBall.noRepReasons}
          infractions={wallBallInfractionItems(rules)}
          canUndo={undoSeq !== null}
          locked={!writable || stopped}
          nextHref={listHref}
          onRep={() => withStart({ t: 'rep' })}
          onNoRep={(reason) => withStart({ t: 'norep', reason })}
          onUndo={() => { if (undoSeq !== null) record({ t: 'undo', of: undoSeq }); }}
          onInfraction={(event) => record(event)}
          onAbandon={() => withStart({ t: 'abandon' })}
          onRelease={() => record({ t: 'release' })}
        />
      </div>
    </CourtShell>
  );
}
