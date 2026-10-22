'use client';

import { useId, useMemo, useState } from 'react';
import { Play, Square, Undo2 } from 'lucide-react';

import type { SheetViewProps } from '@/components/sheet/SheetView';
import { PHASE_LABELS, ProgressBar, actionButtonClass, secondaryButtonClass } from '@/components/sheet/sheetUi';
import {
  DISTANCE_FIELD_HINT,
  DISTANCE_SAME_NOTICE,
  buildDistanceResultSummary,
  buildDistanceViewModel,
  decideDistanceEntry
} from '@/lib/sheetView';
import { computeDistanceResult, deriveDistanceState } from '@/lib/workoutStructure';

// Súmula da Distância (Story 1.68, Maquete 2 de docs/design/distancia/):
// relógio, duração e barra de progresso como o AMRAP, e um campo para o total
// em metros que o judge soma por fora. Como as outras súmulas, EMITE eventos do
// log (`dist` e `undo`) e não grava, não usa rede e não calcula score: o texto
// digitado passa por decideDistanceEntry (que usa o parser do motor da Story
// 1.66) antes de ser emitido, e o estado e o resultado vêm do motor. Sem
// `onEvent` fica somente leitura.

export function DistanceSheetView({
  structure,
  events,
  phase,
  elapsedSeconds,
  context,
  onEvent,
  onStart,
  onStop
}: SheetViewProps) {
  // Texto que o judge está digitando; sem edição, o campo mostra o último total lançado.
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // Id único por súmula: mais de um atleta pode aparecer na mesma tela.
  const inputId = `${useId()}-distancia`;

  const state = useMemo(() => deriveDistanceState(structure, events), [structure, events]);
  const result = useMemo(() => computeDistanceResult(state), [state]);
  const summary = useMemo(() => buildDistanceResultSummary(result), [result]);
  const running = phase === 'running';
  const view = useMemo(
    () => buildDistanceViewModel(structure, state, elapsedSeconds, running),
    [structure, state, elapsedSeconds, running]
  );

  const interactive = Boolean(onEvent);
  const at = Math.max(0, Math.floor(Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0));
  const canType = interactive && phase !== 'ready';
  const showResult = phase === 'stopped';
  const hasHeader = Boolean(context?.workoutName || context?.athleteName || context?.laneLabel);
  const typed = draft ?? (state.meters === null ? '' : String(state.meters));
  const describedBy = error ? `${inputId}-erro` : `${inputId}-dica`;

  const register = () => {
    if (!onEvent || !canType) return;
    const decision = decideDistanceEntry(typed, state.meters, at);
    if (decision.kind === 'refused') {
      setError(decision.error);
      setNotice('');
      return;
    }
    setError('');
    setDraft(null);
    // O mesmo total de novo não vira outro lançamento: o histórico guarda só o que mudou.
    if (decision.kind === 'same') {
      setNotice(DISTANCE_SAME_NOTICE);
      return;
    }
    setNotice('');
    onEvent(decision.event);
  };

  const undo = () => {
    if (!onEvent || view.undoTarget === null) return;
    setError('');
    setNotice('');
    setDraft(null);
    onEvent({ t: 'undo', of: view.undoTarget, at });
  };

  return (
    <section aria-label="Súmula digital da distância" className="space-y-4 text-foreground">
      {hasHeader && (
        <header className="space-y-0.5">
          {context?.workoutName && (
            <p className="text-[11px] font-bold uppercase tracking-widest text-primary">{context.workoutName}</p>
          )}
          <p className="text-lg font-extrabold leading-tight">
            {context?.athleteName ?? 'Atleta'}
            {context?.laneLabel ? <span className="ml-2 text-sm font-semibold text-muted">{context.laneLabel}</span> : null}
          </p>
        </header>
      )}

      <div className="space-y-3 rounded-2xl border border-card-border bg-card p-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted">{PHASE_LABELS[phase]}</p>
            <p className="font-number text-4xl font-extrabold leading-none tabular-nums" aria-label={`Relógio ${view.clockLabel}`}>
              {view.clockLabel}
            </p>
          </div>
          <p className="text-right text-xs font-semibold text-muted">
            Duração
            <span className="block font-number text-base font-bold tabular-nums text-foreground">{view.durationLabel}</span>
          </p>
        </div>
        <ProgressBar percent={view.clockPercent} label="Relógio em relação à duração" />
        {view.timeUp && (
          <p role="status" className="rounded-md border border-trading-down/50 bg-trading-down/10 px-3 py-2 text-xs font-bold text-foreground">
            Tempo esgotado. Pare o relógio.
          </p>
        )}
        {view.note && <p className="text-sm font-semibold leading-snug text-muted">{view.note}</p>}
      </div>

      <div className="space-y-3 rounded-2xl border border-card-border bg-card p-4">
        {interactive ? (
          <>
            <label htmlFor={inputId} className="block text-[11px] font-bold uppercase tracking-wider text-muted">
              Distância total (m)
            </label>
            <div className="flex gap-2">
              <input
                id={inputId}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                enterKeyHint="done"
                disabled={!canType}
                value={typed}
                aria-invalid={error ? 'true' : undefined}
                aria-describedby={describedBy}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setError('');
                  setNotice('');
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    register();
                  }
                }}
                className={`min-h-14 w-full min-w-0 rounded-md border-2 bg-dark-gray px-3 font-number text-3xl font-extrabold tabular-nums focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
                  error ? 'border-trading-down' : 'border-card-border'
                }`}
              />
              <button
                type="button"
                onClick={register}
                disabled={!canType}
                className={`${actionButtonClass} border-primary bg-primary text-ink hover:bg-primary-hover`}
              >
                Registrar
              </button>
            </div>
            {error ? (
              <p id={`${inputId}-erro`} role="alert" className="text-sm font-bold text-trading-down">{error}</p>
            ) : (
              <p id={`${inputId}-dica`} className="text-xs font-semibold text-muted">
                {phase === 'ready' ? 'Inicie o relógio para lançar o total.' : notice || DISTANCE_FIELD_HINT}
              </p>
            )}
          </>
        ) : null}

        <div className="space-y-0.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Total lançado</p>
          {view.totalLabel ? (
            <p className="font-number text-3xl font-extrabold tabular-nums" aria-live="polite">
              {view.totalLabel}
              <span className="ml-2 text-xs font-semibold text-muted">às {view.lastAtLabel}</span>
            </p>
          ) : (
            <p className="text-sm font-semibold text-muted">Nenhum total lançado ainda.</p>
          )}
        </div>

        {view.history.length > 0 && (
          <ol aria-label="Últimos lançamentos" className="flex flex-wrap gap-1.5">
            {view.history.map((row) => (
              <li
                key={row.position}
                className="flex min-h-9 items-center gap-1.5 rounded-md border border-card-border bg-dark-gray px-2 font-number text-xs font-bold tabular-nums"
              >
                {row.metersLabel}
                <span className="font-medium text-muted">{row.atLabel}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {showResult && (
        <div className="space-y-1 rounded-2xl border-2 border-trading-up bg-card p-4" aria-label="Resultado a publicar">
          <p className="text-[11px] font-bold uppercase tracking-widest text-trading-up">Resultado a publicar</p>
          <p className="font-number text-4xl font-extrabold tabular-nums">{summary.headline}</p>
          {summary.detail && <p className="text-sm font-semibold text-muted">{summary.detail}</p>}
          {summary.warning && <p role="status" className="text-sm font-bold text-trading-down">{summary.warning}</p>}
          <p className="text-[11px] leading-relaxed text-muted">{summary.note}</p>
        </div>
      )}

      {interactive && (
        <div className="sticky bottom-0 -mx-1 flex gap-2 bg-background/95 px-1 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
          <button type="button" onClick={undo} disabled={view.undoTarget === null} className={`${secondaryButtonClass} flex-1`}>
            <Undo2 className="h-4 w-4" aria-hidden="true" />
            Desfazer
          </button>
          {phase === 'ready' && onStart && (
            <button type="button" onClick={onStart} className={`${actionButtonClass} flex-[2] border-primary bg-primary text-ink hover:bg-primary-hover`}>
              <Play className="h-4 w-4" aria-hidden="true" />
              Iniciar
            </button>
          )}
          {phase === 'running' && onStop && (
            <button type="button" onClick={onStop} className={`${actionButtonClass} flex-[2] border-trading-down bg-trading-down/15 text-foreground hover:bg-trading-down/25`}>
              <Square className="h-4 w-4" aria-hidden="true" />
              Parar
            </button>
          )}
        </div>
      )}
    </section>
  );
}
