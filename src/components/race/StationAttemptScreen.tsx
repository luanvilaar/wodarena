'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCircle2, CloudOff, Loader2 } from 'lucide-react';

import { CourtShell } from '@/components/judge/CourtShell';
import { useRaceSync, type RaceAppendResult } from '@/components/judge/useRaceSync';
import { StationCard, type StationCardProps } from '@/components/race/StationCard';
import { useApp } from '@/context/AppContext';
import { evaluateRaceStation, type RaceCourseStage, type RaceEvent, type RaceRuleset, type RaceStationKind } from '@/lib/raceRules';
import {
  describeLastStationAction,
  describeStationControls,
  describeStationExit,
  describeStationMeta,
  describeStationWarning,
  isRaceAttemptActive,
  lastUndoableStationSeq,
  raceCardsHref,
  raceStationEyebrow,
  stationElapsedSeconds,
  stationEndedAt,
  stationGeneralInfractionItems,
  stationOpensWallBall,
  stationReasons,
  stationUsesCounter,
  stationWarningUsed
} from '@/lib/raceStation';
import {
  formatRaceElapsed,
  formatRacePenalty,
  raceElapsedSeconds,
  releasedElapsedSeconds,
  type RaceQueuedEvent
} from '@/lib/raceWallBall';
import { formatRaceClock } from '@/lib/raceWaves';

// Tela do judge de uma estação (Story 1.102, AC4 a AC12). Carrega a
// tentativa (view attempt), roda o motor no aparelho sobre o log confirmado +
// a fila local (a tela responde sem esperar a rede) e envia cada toque por
// useRaceSync, o mesmo gancho do Wall Ball, sem mudança. O tempo exibido é só
// do aparelho (D21); o oficial é o que o servidor grava ao liberar a última
// estação (D34). Estação de reps abre a tela do Wall Ball (1.97). Na estação
// final (`closesTime`, D39) a tela é de 1 atleta, sem soltar nem dispensar.
// O início (`start`) vai junto do primeiro registro: abrir a tela não inicia
// a estação. Story 1.103: a tentativa do próprio judge numa estação de 2
// cartões abre a tela de dois cartões com ela em foco; a lógica do cartão
// (fila, motor, botões) mora em useStationCardModel, usada pelas duas telas.

export type RunInfo = { status?: string; startedAt?: string | null; finishAt?: string | null; grossSeconds?: number | null; officialSeconds?: number | null };

export type StagePayload = {
  id: string;
  name: string;
  kind: RaceStationKind;
  expectedUnits?: number;
  distance?: string;
  reps?: number;
  maleWeight?: string;
  femaleWeight?: string;
};

export type AttemptPayload = {
  /** solo (Story 1.103, AC3): estação de 1 atleta, fora da tela de dois cartões; stationKey: a estação física. */
  attempt: { id: string; status: string; judgeUserId: string | null; judgeName: string; stationKind: RaceStationKind; closesTime?: boolean; solo?: boolean; stationKey?: string | null };
  run: RunInfo;
  stage: StagePayload | null;
  ruleset: { rules: RaceRuleset };
  events: { id: string; event: RaceEvent; deviceAt: string | null }[];
  context: { athleteName: string; box: string; divisionName: string; team: boolean; category: string | null; eventName: string; timeZone: string; stationName: string };
  viewer: { id: string; role: string };
};

const encode = encodeURIComponent;
export const stationListHref = (eventId: string, stationKey: string) => `/judge/corrida/${encode(eventId)}/estacao/${encode(stationKey)}`;

export function StationAttemptScreen({ eventId, stationKey, attemptId }: { eventId: string; stationKey: string; attemptId: string }) {
  const { currentUser } = useApp();
  const router = useRouter();
  const [payload, setPayload] = useState<AttemptPayload | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/race-sheets?view=attempt&attemptId=${encode(attemptId)}`);
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

  // Reps nunca usa o cartão de estação: a tela do Wall Ball (1.97) já é de 1 atleta.
  const wallBall = payload ? stationOpensWallBall(payload.stage?.kind ?? payload.attempt.stationKind) : false;
  useEffect(() => {
    if (wallBall) router.replace(`/judge/corrida/${encode(eventId)}/wall-ball/${encode(attemptId)}`);
  }, [wallBall, router, eventId, attemptId]);

  // Story 1.103 (AC7): a tentativa ativa do próprio judge numa estação de 2 cartões abre a tela de
  // dois cartões com ela em foco. A estação de 1 atleta (reps ou final, D39) fica nesta tela.
  const toCards = Boolean(payload && payload.stage && !wallBall && payload.attempt.solo === false
    && payload.attempt.judgeUserId === payload.viewer.id && isRaceAttemptActive(payload.attempt.status, payload.run.status));
  useEffect(() => {
    if (toCards) router.replace(raceCardsHref(eventId, attemptId));
  }, [toCards, router, eventId, attemptId]);

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

  const listHref = stationListHref(eventId, stationKey);
  if (!payload || !payload.stage || wallBall || toCards) {
    return (
      <CourtShell eyebrow={raceStationEyebrow(payload?.context.stationName)} title="Estação" back={{ href: listHref, label: 'Voltar à lista da onda' }}>
        {error ? (
          <p role="alert" className="rounded-md border border-trading-down bg-trading-down/10 px-4 py-3 text-sm font-semibold">{error}</p>
        ) : payload && !payload.stage ? (
          <p role="alert" className="rounded-md border border-trading-down bg-trading-down/10 px-4 py-3 text-sm font-semibold">Esta estação não está no percurso da corrida.</p>
        ) : (
          <p role="status" className="py-10 text-center text-sm font-semibold text-muted">{wallBall ? 'Abrindo a tela do Wall Ball…' : toCards ? 'Abrindo os seus cartões…' : 'Carregando a tentativa…'}</p>
        )}
      </CourtShell>
    );
  }

  return <StationRunner key={payload.attempt.id} listHref={listHref} payload={payload} error={error} onClaim={claim} />;
}

/**
 * Lógica do cartão de uma tentativa (Story 1.102; reaproveitada pela tela de
 * dois cartões da Story 1.103): a fila local própria (useRaceSync, uma por
 * cartão: um 409 ou queda de rede num cartão não para o outro), o motor no
 * aparelho, os botões e os textos. Devolve as props do StationCard (sem a
 * navegação) e o estado da fila. Cada cartão é um componente que chama este
 * gancho uma vez.
 */
export function useStationCardModel(payload: AttemptPayload) {
  const { attempt, context, ruleset, viewer } = payload;
  const stage = payload.stage!;
  const closesTime = attempt.closesTime === true;
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
    id: stage.id,
    name: stage.name,
    distance: stage.distance,
    reps: stage.reps,
    maleWeight: stage.maleWeight,
    femaleWeight: stage.femaleWeight,
    kind: stage.kind,
    ...(typeof stage.expectedUnits === 'number' ? { expectedUnits: stage.expectedUnits } : {})
  }), [stage]);
  const result = useMemo(() => evaluateRaceStation(rules, engineStage, sync.items.map((item) => item.event)), [rules, engineStage, sync.items]);
  const controls = describeStationControls({ stage, closesTime, result });
  const closed = controls.closed !== null;

  // Relógio da tela: 1 s enquanto a estação está aberta.
  useEffect(() => {
    if (closed) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [closed]);

  // Tela acesa quando o aparelho permite (Wake Lock); pedida de novo ao voltar para a aba.
  useEffect(() => {
    type Sentinel = { release: () => Promise<void> };
    const wakeLock = (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<Sentinel> } }).wakeLock;
    if (!wakeLock || closed) return;
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
  }, [closed]);

  const record = (...events: RaceEvent[]) => sync.record(...events);
  const withStart = (...events: RaceEvent[]) => (result.started ? record(...events) : record({ t: 'start' }, ...events));
  const undoSeq = lastUndoableStationSeq(sync.items, result);
  const counter = stationUsesCounter(stage.kind);

  // Recusa do motor no aparelho para um registro ainda na fila: a tela mostra a mensagem dele.
  const confirmedCount = sync.items.length - sync.pendingCount;
  const refusal = result.rejected.filter((item) => item.seq >= confirmedCount).pop()?.error ?? '';

  const meta = describeStationMeta(stage, context.category);
  const elapsedStation = stationElapsedSeconds(sync.items, result, now);
  const endedAt = stationEndedAt(sync.items, result);
  const released = controls.closed === 'released'
    ? {
      at: endedAt !== null ? formatRaceClock(new Date(endedAt).toISOString(), context.timeZone) : '—',
      stationElapsed: formatRaceElapsed(elapsedStation),
      athleteElapsed: formatRaceElapsed(releasedElapsedSeconds(run.startedAt, sync.items, result)),
      official: closesTime && typeof run.officialSeconds === 'number' && run.status === 'finished' ? formatRaceElapsed(run.officialSeconds) : null
    }
    : null;
  const exited = controls.closed === 'left_incomplete'
    ? { missing: result.missing, charge: formatRacePenalty(result.missing * rules.missingUnit.perUnitSeconds) }
    : null;
  const exitInfo = controls.exit.visible && result.expectedUnits !== null
    ? describeStationExit({ kind: stage.kind, units: result.units, expectedUnits: result.expectedUnits, perUnitSeconds: rules.missingUnit.perUnitSeconds, closesTime })
    : null;
  const warningUsed = stationWarningUsed(result);

  const stopped = sync.status === 'conflict' || sync.status === 'rejected';
  const synced = sync.pendingCount === 0 && sync.status === 'saved';

  const cardProps: Omit<StationCardProps, 'nextHref' | 'oneAthlete'> = {
    athleteName: context.athleteName || 'O atleta',
    team: context.team,
    kind: stage.kind,
    target: meta.target,
    load: meta.load,
    closesTime,
    controls,
    units: result.units,
    expectedUnits: result.expectedUnits,
    stationReasons: stationReasons(rules, stage),
    generalItems: stationGeneralInfractionItems(rules),
    warningText: describeStationWarning(rules, stage.kind, warningUsed),
    warningUsed,
    penaltySeconds: result.penaltySeconds,
    returnWrongSeconds: rules.returnWrong.seconds,
    redoDeclinedSeconds: rules.wrongLoad.declinedSeconds,
    lastAction: describeLastStationAction(sync.items, rules, stage.kind),
    refusal,
    stationElapsed: result.started ? formatRaceElapsed(elapsedStation) : null,
    raceElapsed: formatRaceElapsed(raceElapsedSeconds(run.startedAt, now)),
    exitInfo,
    released,
    exited,
    canUndo: undoSeq !== null,
    locked: !writable || stopped,
    onStart: () => { if (!result.started) record({ t: 'start' }); },
    onUnit: () => withStart({ t: 'section' }),
    onStationInfraction: (code) => withStart({ t: 'infraction', code }),
    onGeneralInfraction: (event) => record(event),
    onReturnWrong: () => withStart({ t: 'return_wrong' }),
    onReturnCorrected: () => record({ t: 'return_corrected' }),
    onLeaveRoxzone: () => record({ t: 'leave_roxzone' }),
    onWrongLoad: () => withStart({ t: 'wrong_load' }),
    onRedoDone: () => record({ t: 'redo_done' }),
    onRedoDeclined: () => record({ t: 'redo_declined' }),
    // Saída só no trenó e nas seções (D28); nunca em reps (D22).
    onExit: () => { if (counter && controls.exit.enabled) withStart({ t: 'exit' }); },
    onRelease: () => record({ t: 'release' }),
    onUndo: () => { if (undoSeq !== null) record({ t: 'undo', of: undoSeq }); }
  };

  return { sync, run, isWriter, writable, stopped, synced, closed, cardProps };
}

function StationRunner({ listHref, payload, error, onClaim }: { listHref: string; payload: AttemptPayload; error: string; onClaim: () => void }) {
  const { attempt, context } = payload;
  const stage = payload.stage!;
  const closesTime = attempt.closesTime === true;
  const { sync, run, isWriter, stopped, synced, closed, cardProps } = useStationCardModel(payload);
  const SyncIcon = sync.status === 'offline' ? CloudOff : sync.pendingCount > 0 ? Loader2 : CheckCircle2;
  const subtitle = [context.team ? 'Dupla' : context.box, context.divisionName, context.eventName].filter(Boolean).join(' · ');

  return (
    <CourtShell eyebrow={raceStationEyebrow(stage.name)} title={context.athleteName || 'Atleta'} subtitle={subtitle} back={{ href: listHref, label: 'Voltar à lista da onda' }}>
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
        {isWriter && run.status !== 'racing' && !closed && (
          <p className="rounded-md border border-card-border bg-card px-4 py-3 text-sm font-semibold">A corrida deste atleta já foi encerrada. Correções são com o organizador.</p>
        )}

        {/* Tela de 1 atleta (estação final, D39): sem "Soltar" nem "Dispensar". */}
        <StationCard {...cardProps} oneAthlete={closesTime} nextHref={listHref} />
      </div>
    </CourtShell>
  );
}
