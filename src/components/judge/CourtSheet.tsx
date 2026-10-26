'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CloudOff, Loader2, Send, TriangleAlert, UserX } from 'lucide-react';

import { CourtShell } from '@/components/judge/CourtShell';
import { useSheetSync } from '@/components/judge/useSheetSync';
import { SheetView } from '@/components/sheet/SheetView';
import { computeAbsentOutcome, computeSheetOutcome, type ScoresheetStatus } from '@/lib/scoresheet';
import {
  clearLocalSheet,
  clockSeconds,
  initialClock,
  loadLocalSheet,
  startClock,
  stopClock,
  type QueuedEvent,
  type SheetClock
} from '@/lib/sheetSync';
import {
  checkOfficialTime,
  deriveMaxLoadState,
  deriveSheetState,
  formatMeters,
  formatTonnageKg,
  formatWorkoutTime,
  type SheetEvent,
  type WorkoutStructure
} from '@/lib/workoutStructure';
import { maskTimeInput, parseTimeInput } from '@/lib/workoutStructureEditor';

// Súmula na quadra (Stories 1.50 e 1.51): a súmula do judge (Story 1.44) com a
// gravação no servidor, o relógio guardado no aparelho (recarregar a página
// não perde a prova), a tela fica acesa enquanto o relógio roda, e o "Conferir
// e enviar" com o ajuste pelo cronômetro oficial. Enviar publica na hora
// (decisão 3 da E3); o servidor calcula o resultado do log. "Atleta ausente"
// (Story 1.59) só aparece com a súmula sem nenhum registro e publica o pior
// resultado da prova, calculado pelo servidor (a requisição não leva resultado).
// O Intervalado (Story 1.62) não termina antes do relógio parado, mostra o
// resultado em repetições e não tem ajuste pelo cronômetro oficial. A Distância
// (Story 1.68) também só revisa com o relógio parado, mostra o resultado em
// metros ("6.330 m") e não tem ajuste pelo cronômetro oficial. O tempo oficial é
// digitado só com algarismos (Story 1.70): o teclado numérico do celular não tem
// ":", então a máscara preenche o MM:SS da direita para a esquerda. A Tonelagem
// (Story 1.80) também só revisa com o relógio parado, mostra o resultado em kg
// ("830 kg") e não tem ajuste pelo cronômetro oficial.

type SheetPayload = {
  sheet: {
    id: string;
    eventId: string;
    workoutId: string;
    status: ScoresheetStatus;
    judgeUserId: string | null;
    judgeName: string;
    heatNumber: number | null;
    lane: number | null;
    structure: WorkoutStructure;
    officialResult: string | null;
    officialTieBreak: string | null;
    corrected: boolean;
    absent: boolean;
    returnReason: string | null;
  };
  events: QueuedEvent[];
  context: { athleteName: string; box: string; workoutName: string; workoutCode: string; divisionName: string };
  viewer: { id: string; name: string; role: string };
};

const panelClass = 'space-y-3 rounded-2xl border border-card-border bg-card p-4';
const buttonClass = 'flex min-h-12 items-center justify-center gap-2 rounded-md border px-4 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50';

type WakeLockSentinelLike = { release: () => Promise<void> };

// Mantém a tela acesa enquanto o relógio roda (quando o navegador deixa).
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;
    const request = async () => {
      try {
        const lock = await (navigator as Navigator & { wakeLock: { request: (type: 'screen') => Promise<WakeLockSentinelLike> } }).wakeLock.request('screen');
        if (cancelled) await lock.release();
        else sentinel = lock;
      } catch {
        // Sem permissão ou sem suporte: a súmula funciona do mesmo jeito.
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void request();
    };
    void request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => {});
    };
  }, [active]);
}

function OfficialTimeForm({ structure, events, at, onRecord }: { structure: WorkoutStructure; events: SheetEvent[]; at: number; onRecord: (event: SheetEvent) => void }) {
  const [finalText, setFinalText] = useState('');
  const [tieText, setTieText] = useState('');
  const [error, setError] = useState('');
  const state = useMemo(() => deriveSheetState(structure, events), [structure, events]);
  const canFinal = structure.format === 'for_time' && state.repsRemaining === 0 && state.completedAt !== null;
  const canTie = Boolean(structure.tieBreak) && state.tieBreakCapturedAt !== null;
  if (!canFinal && !canTie) return null;

  const apply = (target: 'final' | 'tiebreak', text: string) => {
    const parsed = parseTimeInput(text);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    const check = checkOfficialTime(structure, state, target, parsed.seconds);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setError('');
    onRecord({ t: 'time', target, v: parsed.seconds, at });
    if (target === 'final') setFinalText('');
    else setTieText('');
  };

  const row = (target: 'final' | 'tiebreak', label: string, captured: number | null, effective: number | null, adjusted: boolean, text: string, setText: (value: string) => void) => (
    <div className="space-y-1.5">
      <label htmlFor={`official-${target}`} className="block text-[11px] font-bold uppercase tracking-wider text-muted">{label}</label>
      <p className="text-xs font-semibold text-muted">
        Súmula <span className="font-number text-foreground">{captured === null ? '—' : formatWorkoutTime(captured)}</span>
        {adjusted && effective !== null && <> · oficial <span className="font-number text-foreground">{formatWorkoutTime(effective)}</span></>}
      </p>
      <div className="flex gap-2">
        <input
          id={`official-${target}`}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="00:00"
          value={text}
          onChange={(event) => setText(maskTimeInput(event.target.value))}
          className="min-h-12 w-full min-w-0 rounded-md border border-card-border bg-dark-gray px-3 font-number text-lg font-bold focus:border-primary focus:outline-none"
        />
        <button type="button" onClick={() => apply(target, text)} disabled={!text.trim()} className={`${buttonClass} border-card-border bg-dark-gray`}>
          Aplicar
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-3 rounded-xl border border-dashed border-card-border p-3">
      <p className="text-xs font-semibold text-muted">Cronômetro oficial do evento (opcional). O tempo da súmula fica guardado ao lado.</p>
      {canFinal && row('final', 'Tempo final oficial', state.capturedCompletedAt, state.completedAt, state.finalAdjusted, finalText, setFinalText)}
      {canTie && row('tiebreak', 'Tie-break oficial', state.tieBreakCapturedAt, state.tieBreakAt, state.tieBreakAdjusted, tieText, setTieText)}
      {error && <p role="alert" className="text-xs font-bold text-trading-down">{error}</p>}
    </div>
  );
}

function SheetSession({ payload }: { payload: SheetPayload }) {
  const { sheet, context, viewer } = payload;
  const [status, setStatus] = useState<ScoresheetStatus>(sheet.status);
  const [published, setPublished] = useState({ result: sheet.officialResult, tieBreak: sheet.officialTieBreak, corrected: sheet.corrected, absent: sheet.absent === true });
  const isWriter = sheet.judgeUserId === viewer.id;
  const writable = isWriter && (status === 'in_progress' || status === 'returned');
  const sync = useSheetSync({ sheetId: sheet.id, serverEvents: payload.events, writable });
  const [clock, setClock] = useState<SheetClock>(() => initialClock(loadLocalSheet(sheet.id).clock, payload.events));
  const [now, setNow] = useState(() => Date.now());
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [confirmingAbsent, setConfirmingAbsent] = useState(false);
  const [markingAbsent, setMarkingAbsent] = useState(false);
  const [absentError, setAbsentError] = useState('');

  useEffect(() => {
    if (clock.phase !== 'running') return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [clock.phase]);
  useWakeLock(clock.phase === 'running' && writable);

  const elapsed = clockSeconds(clock, now);
  const at = Math.max(0, Math.floor(elapsed));
  const structure = sheet.structure;
  const events = sync.events;

  const start = () => {
    const next = startClock(clock, Date.now());
    setClock(next);
    sync.saveClock(next);
  };
  const stop = () => {
    const stoppedAt = Date.now();
    const next = stopClock(clock, stoppedAt);
    setClock(next);
    setNow(stoppedAt);
    sync.saveClock(next);
  };

  const finished = useMemo(() => {
    // Intervalado: sem "terminou antes do fim"; a revisão abre quando o relógio para.
    if (structure.format === 'interval') return false;
    if (structure.format === 'max_load') {
      const state = deriveMaxLoadState(structure, events);
      return state.attemptsUsed > 0 && state.currentLiftId === null;
    }
    const state = deriveSheetState(structure, events);
    return structure.format === 'for_time' && state.repsRemaining === 0 && state.completedAt !== null;
  }, [structure, events]);
  const outcome = useMemo(() => computeSheetOutcome(structure, events), [structure, events]);
  // Palavra do formato junto do número principal: "102,5 kg", "23 repetições"; tempo e AMRAP sem palavra.
  const resultUnit = (value: number) => (
    structure.format === 'max_load' ? ' kg' : structure.format === 'interval' ? (value === 1 ? ' repetição' : ' repetições') : ''
  );
  // O resultado como a conferência, a confirmação e o cartão publicado o escrevem: a distância em metros ("6.330 m"), a tonelagem em kg ("1.652,5 kg"), os outros como estão.
  const resultText = (result: string, value: number) => (
    structure.format === 'distance' ? `${formatMeters(value)} m`
      : structure.format === 'tonnage' ? `${formatTonnageKg(value)} kg`
        : `${result.replace('.', ',')}${resultUnit(value)}`
  );
  const showReview = writable && (clock.phase === 'stopped' || finished);
  const syncReady = sync.pendingCount === 0 && sync.status === 'saved';
  // Atleta ausente: só sem nenhum registro, nem no servidor nem na fila do aparelho.
  const canMarkAbsent = writable && sync.confirmedCount === 0 && sync.pendingCount === 0 && events.length === 0;
  // Só informativo (o servidor calcula de novo); com erro, a confirmação omite o resultado.
  const absentOutcome = useMemo(() => computeAbsentOutcome(structure), [structure]);
  const absentResultText = absentOutcome.ok
    ? (structure.format === 'distance' ? `${formatMeters(absentOutcome.value)} m`
      : structure.format === 'tonnage' ? `${formatTonnageKg(absentOutcome.value)} kg`
        : `${absentOutcome.result.replace('.', ',')}${structure.format === 'max_load' ? ' kg' : ''}`)
    : '';

  const submit = async () => {
    setSubmitting(true);
    setSubmitError('');
    try {
      const response = await fetch('/api/sheets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'submit', sheetId: sheet.id, expectedCount: sync.confirmedCount })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Não foi possível enviar a súmula.');
      setStatus('submitted');
      setPublished({ result: data.sheet.officialResult, tieBreak: data.sheet.officialTieBreak, corrected: false, absent: false });
      if (clock.phase === 'running') stop();
      clearLocalSheet(sheet.id);
      setConfirming(false);
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : 'Não foi possível enviar a súmula.');
    } finally {
      setSubmitting(false);
    }
  };

  const markAbsent = async () => {
    setMarkingAbsent(true);
    setAbsentError('');
    try {
      const response = await fetch('/api/sheets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'absent', sheetId: sheet.id })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Não foi possível marcar o atleta como ausente.');
      setStatus('submitted');
      setPublished({ result: data.sheet.officialResult, tieBreak: null, corrected: false, absent: true });
      if (clock.phase === 'running') stop();
      clearLocalSheet(sheet.id);
      setConfirmingAbsent(false);
    } catch (cause) {
      setAbsentError(cause instanceof Error ? cause.message : 'Não foi possível marcar o atleta como ausente.');
    } finally {
      setMarkingAbsent(false);
    }
  };

  const laneLabel = [sheet.heatNumber ? `Bateria ${sheet.heatNumber}` : '', sheet.lane ? `Raia ${sheet.lane}` : ''].filter(Boolean).join(' · ');
  const SyncIcon = sync.status === 'offline' ? CloudOff : sync.status === 'saving' ? Loader2 : sync.status === 'saved' && sync.pendingCount === 0 ? CheckCircle2 : TriangleAlert;

  return (
    <div className="space-y-4">
      {writable && (
        <div
          role="status"
          aria-live="polite"
          className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-bold ${
            sync.status === 'saved' && sync.pendingCount === 0
              ? 'border-trading-up/60 text-trading-up'
              : sync.status === 'offline' || sync.status === 'saving' ? 'border-primary text-foreground' : 'border-trading-down text-trading-down'
          }`}
        >
          <SyncIcon className={`h-4 w-4 shrink-0 ${sync.status === 'saving' ? 'motion-safe:animate-spin' : ''}`} aria-hidden="true" />
          <span>{sync.statusText}</span>
          {sync.status === 'rejected' && sync.pendingCount > 0 && (
            <button type="button" onClick={sync.discardRejected} className="ml-auto min-h-9 rounded-md border border-trading-down px-2 text-[11px]">
              Descartar o registro
            </button>
          )}
        </div>
      )}
      {sync.message && <p className="text-xs font-semibold text-trading-down">{sync.message}</p>}

      {status === 'returned' && (
        <p role="alert" className="rounded-md border border-trading-down bg-trading-down/10 px-3 py-2 text-sm font-semibold">
          Devolvida pelo gestor: {sheet.returnReason || 'confira e envie de novo.'}
        </p>
      )}
      {status === 'submitted' && (
        <div className="space-y-1 rounded-2xl border-2 border-trading-up bg-trading-up/10 p-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-trading-up">Publicada no ranking</p>
          {published.absent && <p className="text-lg font-extrabold">Atleta ausente</p>}
          <p className="font-number text-4xl font-extrabold">
            {structure.format === 'distance' && published.result
              ? `${formatMeters(Number(published.result))} m`
              : structure.format === 'tonnage' && published.result ? `${formatTonnageKg(Number(published.result))} kg` : published.result}
          </p>
          {published.tieBreak && <p className="text-sm font-semibold">Tie-break {published.tieBreak}</p>}
          {published.corrected && <p className="text-xs font-semibold text-muted">Corrigida pelo gestor.</p>}
        </div>
      )}
      {status === 'cancelled' && (
        <p className="rounded-md border border-card-border bg-card px-3 py-2 text-sm font-semibold">Esta súmula foi cancelada pelo gestor.</p>
      )}
      {!isWriter && (status === 'in_progress' || status === 'returned') && (
        <p className="rounded-md border border-card-border bg-card px-3 py-2 text-sm font-semibold">
          {sheet.judgeUserId === null
            ? 'Esta súmula está sem judge: o judge do evento que abri-la assume. Você vê sem poder marcar.'
            : `Esta súmula está com ${sheet.judgeName}. Você vê sem poder marcar.`}
        </p>
      )}

      <SheetView
        structure={structure}
        events={events}
        phase={clock.phase}
        elapsedSeconds={elapsed}
        context={{ workoutName: [context.workoutCode, context.workoutName].filter(Boolean).join(' · '), athleteName: context.athleteName, laneLabel }}
        onEvent={writable ? sync.record : undefined}
        onStart={writable ? start : undefined}
        onStop={writable ? stop : undefined}
      />

      {canMarkAbsent && (
        <section aria-label="Atleta ausente" className="space-y-2">
          {absentError && <p role="alert" className="text-sm font-bold text-trading-down">{absentError}</p>}
          {confirmingAbsent ? (
            <div role="group" aria-label="Confirmar ausência" className="space-y-2 rounded-xl border border-trading-down bg-trading-down/10 p-3">
              <p className="text-sm font-bold">
                {absentResultText
                  ? `Marcar ${context.athleteName} como ausente? O resultado ${absentResultText} vai direto para o ranking, com o selo Ausente.`
                  : `Marcar ${context.athleteName} como ausente? O resultado vai direto para o ranking, com o selo Ausente.`}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setConfirmingAbsent(false)} disabled={markingAbsent} className={`${buttonClass} border-card-border bg-dark-gray focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary`}>
                  Voltar
                </button>
                <button type="button" onClick={() => void markAbsent()} disabled={markingAbsent} className={`${buttonClass} border-trading-down bg-trading-down text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary`}>
                  {markingAbsent ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" /> : <UserX className="h-4 w-4" aria-hidden="true" />}
                  Confirmar ausência
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => { setAbsentError(''); setConfirmingAbsent(true); }}
              className={`${buttonClass} w-full border-card-border bg-dark-gray focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary`}
            >
              <UserX className="h-4 w-4" aria-hidden="true" />
              Atleta ausente
            </button>
          )}
        </section>
      )}

      {showReview && (
        <section aria-labelledby="review-title" className={panelClass}>
          <h2 id="review-title" className="text-sm font-extrabold uppercase tracking-wider">Conferir e enviar</h2>
          {outcome.ok ? (
            <div className="space-y-0.5">
              <p className="font-number text-4xl font-extrabold">{resultText(outcome.result, outcome.value)}</p>
              <p className="text-sm font-semibold text-muted">{outcome.summary}{outcome.tieBreak ? ` · tie-break ${outcome.tieBreak}` : ''}</p>
            </div>
          ) : (
            <p role="alert" className="text-sm font-bold text-trading-down">{outcome.error}</p>
          )}
          {/* O cronômetro oficial só vale para For Time e AMRAP (carga máxima, intervalado e distância recusam o `time`). */}
          {(structure.format === 'for_time' || structure.format === 'amrap') && <OfficialTimeForm structure={structure} events={events} at={at} onRecord={sync.record} />}

          {!syncReady && <p className="text-xs font-semibold text-muted">Aguarde os registros chegarem ao servidor para enviar.</p>}
          {submitError && <p role="alert" className="text-sm font-bold text-trading-down">{submitError}</p>}
          {confirming ? (
            <div role="group" aria-label="Confirmar envio" className="space-y-2 rounded-xl border border-primary bg-primary/10 p-3">
              <p className="text-sm font-bold">
                Enviar {outcome.ok ? resultText(outcome.result, outcome.value) : ''} de {context.athleteName}? O resultado vai direto para o ranking.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setConfirming(false)} disabled={submitting} className={`${buttonClass} border-card-border bg-dark-gray`}>
                  Voltar
                </button>
                <button type="button" onClick={() => void submit()} disabled={submitting || !syncReady || !outcome.ok} className={`${buttonClass} border-primary bg-primary text-ink`}>
                  {submitting ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
                  Confirmar envio
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={!syncReady || !outcome.ok}
              className={`${buttonClass} w-full border-primary bg-primary text-ink`}
            >
              <Send className="h-4 w-4" aria-hidden="true" />
              Enviar e publicar
            </button>
          )}
        </section>
      )}
    </div>
  );
}

export function CourtSheet({ sheetId }: { sheetId: string }) {
  const [payload, setPayload] = useState<SheetPayload | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const response = await fetch(`/api/sheets?view=sheet&sheetId=${encodeURIComponent(sheetId)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Erro ao abrir a súmula.');
    setPayload(data as SheetPayload);
  }, [sheetId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((cause) => setError(cause instanceof Error ? cause.message : 'Erro ao abrir a súmula.'));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const context = payload?.context;
  return (
    <CourtShell
      title={context?.athleteName || 'Súmula'}
      subtitle={context ? [context.workoutName, context.divisionName].filter(Boolean).join(' · ') : undefined}
      back={payload ? { href: `/judge/quadra/${encodeURIComponent(payload.sheet.eventId)}`, label: 'Voltar às baterias' } : { href: '/judge/quadra', label: 'Voltar aos eventos' }}
    >
      {error && <p role="alert" className="rounded-md border border-trading-down bg-trading-down/10 px-4 py-3 text-sm font-semibold">{error}</p>}
      {!payload && !error && <p role="status" className="py-10 text-center text-sm font-semibold text-muted">Abrindo a súmula…</p>}
      {payload && <SheetSession key={payload.sheet.id} payload={payload} />}
    </CourtShell>
  );
}
