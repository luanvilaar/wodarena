'use client';

import { useId, useMemo, useState } from 'react';
import { Play, Square, Undo2 } from 'lucide-react';

import { CurrentSegment, SegmentRow } from '@/components/sheet/SegmentParts';
import type { SheetViewProps } from '@/components/sheet/SheetView';
import { PHASE_LABELS, ProgressBar, actionButtonClass, secondaryButtonClass } from '@/components/sheet/sheetUi';
import {
  TONNAGE_LOAD_HINT_FREE,
  TONNAGE_LOAD_HINT_PRESCRIBED,
  buildTonnageResultSummary,
  buildTonnageViewModel,
  readTonnageLoadInput
} from '@/lib/sheetView';
import { computeTonnageResult, deriveTonnageState, formatTonnageKg } from '@/lib/workoutStructure';

// Súmula da Tonelagem (Story 1.80, Maquete 2 de docs/design/tonelagem/): a carga
// do atleta antes de iniciar, a liberação (os exercícios que vêm antes do que
// conta, com o mesmo "toque e segure" do For Time), e as repetições do exercício
// que conta, cada uma com a carga vigente. Como as outras súmulas, EMITE eventos
// do log (`load`, `lrep`, `rep`, `fill`, `undo`) e não grava, não usa rede e não
// calcula score: o estado e o resultado vêm do motor (Story 1.77), e o texto
// digitado passa por readTonnageLoadInput antes de virar evento. Sem `onEvent`
// fica somente leitura.

const cardClass = 'space-y-3 rounded-2xl border border-card-border bg-card p-4';
const kicker = 'text-[10px] font-bold uppercase tracking-widest text-muted';

export function TonnageSheetView({
  structure,
  events,
  phase,
  elapsedSeconds,
  context,
  onEvent,
  onStart,
  onStop
}: SheetViewProps) {
  // Texto que o judge está digitando antes de iniciar; sem edição, o campo mostra a carga prescrita ou a declarada.
  const [draft, setDraft] = useState<string | null>(null);
  // Id único por súmula: mais de um atleta pode aparecer na mesma tela.
  const inputId = `${useId()}-carga`;

  const state = useMemo(() => deriveTonnageState(structure, events), [structure, events]);
  const result = useMemo(() => computeTonnageResult(state), [state]);
  const summary = useMemo(() => buildTonnageResultSummary(result, state), [result, state]);
  const running = phase === 'running';
  const view = useMemo(
    () => buildTonnageViewModel(structure, state, events, elapsedSeconds, running),
    [structure, state, events, elapsedSeconds, running]
  );

  const interactive = Boolean(onEvent);
  const at = Math.max(0, Math.floor(Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0));
  const prescribed = view.loadMode === 'prescribed';
  const initialText = view.loadKg !== null
    ? formatTonnageKg(view.loadKg)
    : prescribed && view.prescribedKg !== null ? formatTonnageKg(view.prescribedKg) : '';
  const typed = draft ?? initialText;
  const parsed = readTonnageLoadInput(typed);
  const showError = !prescribed && !view.declared && typed.trim() !== '' && !parsed.ok;
  const hasHeader = Boolean(context?.workoutName || context?.athleteName || context?.laneLabel);
  const showResult = phase === 'stopped';
  const hasLiberation = view.liberation.length > 0;

  // Contar vale com o relógio rodando, liberado, com a carga declarada e dentro do time cap.
  const canCount = interactive && running && view.released && view.declared && !view.timeUp;
  const canStart = interactive && (view.declared || parsed.ok);

  const start = () => {
    if (!canStart || !onStart) return;
    // A carga declarada é o primeiro registro da prova; depois o relógio começa.
    if (!view.declared && parsed.ok) onEvent?.({ t: 'load', v: parsed.kg, at: 0 });
    setDraft(null);
    onStart();
  };
  const undo = () => {
    if (onEvent && view.undoTarget !== null) onEvent({ t: 'undo', of: view.undoTarget, at });
  };
  const countRep = () => {
    if (canCount && view.loadKg !== null) onEvent?.({ t: 'lrep', load: view.loadKg, at });
  };
  const raiseLoad = () => {
    if (canCount && view.nextLoadKg !== null) onEvent?.({ t: 'load', v: view.nextLoadKg, at });
  };

  const liftCaption = `${view.liftName} · conta a tonelagem`;
  // O rótulo do botão de repetição diz o motivo quando ele está desligado.
  const countLabel = canCount
    ? `Somar uma repetição de ${view.liftName} com ${view.loadLabel ?? ''}`
    : !view.released
      ? 'Conclua a liberação para registrar repetições'
      : view.timeUp
        ? 'Tempo esgotado: não é possível registrar repetições'
        : !running
          ? 'Inicie o relógio para registrar repetições'
          : 'Informe a carga do atleta para registrar repetições';

  return (
    <section aria-label="Súmula digital da tonelagem" className="space-y-4 text-foreground">
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

      <div className={cardClass}>
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className={kicker}>{PHASE_LABELS[phase]}</p>
            <p className="font-number text-4xl font-extrabold leading-none tabular-nums" aria-label={`Relógio ${view.clockLabel}`}>
              {view.clockLabel}
            </p>
          </div>
          <p className="text-right text-xs font-semibold text-muted">
            Time cap
            <span className="block font-number text-base font-bold tabular-nums text-foreground">{view.durationLabel}</span>
          </p>
        </div>
        <ProgressBar percent={view.clockPercent} label="Relógio em relação ao time cap" />
        {view.timeUp && (
          <p role="status" className="rounded-md border border-trading-down/50 bg-trading-down/10 px-3 py-2 text-xs font-bold text-foreground">
            Tempo esgotado. Pare o relógio.
          </p>
        )}
        {view.note && <p className="text-sm font-semibold leading-snug text-muted">{view.note}</p>}
      </div>

      {phase === 'ready' && interactive && (
        <div className={cardClass}>
          <label htmlFor={inputId} className="block text-[11px] font-bold uppercase tracking-wider text-muted">
            Carga do atleta · {view.liftName} (kg)
          </label>
          <input
            id={inputId}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            enterKeyHint="done"
            placeholder="ex.: 60"
            readOnly={prescribed || view.declared}
            value={typed}
            aria-invalid={showError ? 'true' : undefined}
            aria-describedby={showError ? `${inputId}-erro` : `${inputId}-dica`}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                start();
              }
            }}
            className={`min-h-14 w-full min-w-0 rounded-md border-2 px-3 font-number text-3xl font-extrabold tabular-nums focus:border-primary focus:outline-none read-only:bg-elevated ${
              showError ? 'border-trading-down bg-dark-gray' : 'border-card-border bg-dark-gray'
            }`}
          />
          {showError && !parsed.ok ? (
            <p id={`${inputId}-erro`} role="alert" className="text-sm font-bold text-trading-down">{parsed.error}</p>
          ) : (
            <p id={`${inputId}-dica`} className="text-xs font-semibold text-muted">
              {prescribed ? TONNAGE_LOAD_HINT_PRESCRIBED : TONNAGE_LOAD_HINT_FREE}
            </p>
          )}
        </div>
      )}

      {hasLiberation && (
        <div className={`${cardClass} ${phase === 'ready' ? 'opacity-60' : ''}`}>
          <div className="flex items-baseline justify-between gap-3">
            <p className={kicker}>Liberação</p>
            <p className="text-xs font-semibold text-muted">
              {phase === 'ready' ? 'aguardando' : view.released ? 'concluída' : 'em andamento'}
            </p>
          </div>
          {phase !== 'ready' && interactive && !view.released && view.current && (
            <CurrentSegment
              key={view.current.id}
              row={view.current}
              enabled={running && view.declared && !view.timeUp}
              phase={phase}
              onRep={() => onEvent?.({ t: 'rep', seg: view.current?.id ?? '', at })}
              onFill={() => {
                if (view.current && view.current.remaining > 0) onEvent?.({ t: 'fill', seg: view.current.id, n: view.current.remaining, at });
              }}
            />
          )}
          <ul className="space-y-2">
            {view.liberation
              .filter((row) => !(phase !== 'ready' && interactive && !view.released && row.status === 'current'))
              .map((row) => (
                <SegmentRow key={row.id} row={row} corrections={false} onAdjust={() => undefined} onSet={() => undefined} />
              ))}
          </ul>
        </div>
      )}

      {phase !== 'ready' && (
        <div className={`${cardClass} ${view.released ? '' : 'opacity-60'}`}>
          <div className="flex items-baseline justify-between gap-3">
            <p className={kicker}>{liftCaption}</p>
            <p className="text-xs font-semibold text-muted">{view.released ? 'liberado' : 'travado'}</p>
          </div>
          {view.liftNote && <p className="text-xs font-semibold text-muted">{view.liftNote}</p>}
          <p className="font-number text-5xl font-extrabold leading-none tabular-nums">
            {view.loadKg === null ? '—' : formatTonnageKg(view.loadKg)}
            <span className="ml-2 text-base font-semibold text-muted">kg vigente</span>
          </p>
          {interactive && (
            <>
              <button
                type="button"
                onClick={countRep}
                disabled={!canCount}
                aria-label={countLabel}
                className="flex min-h-24 w-full select-none items-center justify-center rounded-2xl border-2 border-primary bg-primary/10 px-4 text-2xl font-extrabold text-foreground transition-colors touch-manipulation active:bg-primary/20 disabled:cursor-not-allowed disabled:border-card-border disabled:bg-dark-gray disabled:text-muted [-webkit-tap-highlight-color:transparent]"
              >
                {view.released ? '+1 repetição' : 'Conclua a liberação'}
              </button>
              {view.incrementAllowed && (
                <button
                  type="button"
                  onClick={raiseLoad}
                  disabled={!canCount || view.nextLoadKg === null}
                  className={`${secondaryButtonClass} w-full`}
                >
                  Subir carga +{formatTonnageKg(view.stepKg)} kg
                </button>
              )}
            </>
          )}
          <div className="space-y-0.5">
            <p className={kicker}>Tonelagem até agora</p>
            <p className="font-number text-3xl font-extrabold tabular-nums" aria-live="polite">
              {view.tonnageLabel}
              <span className="ml-2 text-xs font-semibold text-muted">{view.reps} {view.reps === 1 ? 'repetição' : 'repetições'}</span>
            </p>
          </div>
          {view.groups.length > 0 && (
            <ol aria-label="Cargas e repetições" className="flex flex-wrap gap-1.5">
              {view.groups.map((group) => (
                <li
                  key={group.label}
                  className="flex min-h-9 items-center gap-1.5 rounded-md border border-card-border bg-dark-gray px-2 font-number text-xs font-bold tabular-nums"
                >
                  {group.label}
                  <span className="font-medium text-muted">{group.kgLabel}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {view.after.length > 0 && (
        <p className="text-xs font-semibold text-muted">
          Depois da tonelagem (não conta, não trava): {view.after.map((row) => row.label).join(', ')}.
        </p>
      )}

      {showResult && (
        <div className="space-y-1 rounded-2xl border-2 border-trading-up bg-card p-4" aria-label="Resultado a publicar">
          <p className="text-[11px] font-bold uppercase tracking-widest text-trading-up">Resultado a publicar</p>
          <p className="font-number text-4xl font-extrabold tabular-nums">{summary.headline}</p>
          {summary.detail && <p className="text-sm font-semibold text-muted">{summary.detail}</p>}
          {summary.warning && <p role="status" className="text-sm font-bold text-trading-down">{summary.warning}</p>}
          {summary.ignoredNote && <p role="status" className="text-xs font-semibold text-muted">{summary.ignoredNote}</p>}
          <p className="text-[11px] leading-relaxed text-muted">{summary.note}</p>
        </div>
      )}

      {interactive && (
        <div className="sticky bottom-0 -mx-1 flex gap-2 bg-background/95 px-1 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
          <button type="button" onClick={undo} disabled={!view.canUndo} className={`${secondaryButtonClass} flex-1`}>
            <Undo2 className="h-4 w-4" aria-hidden="true" />
            Desfazer
          </button>
          {phase === 'ready' && onStart && (
            <button
              type="button"
              onClick={start}
              disabled={!canStart}
              className={`${actionButtonClass} flex-[2] border-primary bg-primary text-ink hover:bg-primary-hover`}
            >
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
