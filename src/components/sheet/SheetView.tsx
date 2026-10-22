'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { Check, Clock, Minus, Play, Plus, Square, Undo2 } from 'lucide-react';

import { DistanceSheetView } from '@/components/sheet/DistanceSheetView';
import { IntervalSheetView } from '@/components/sheet/IntervalSheetView';
import { MaxLoadSheetView } from '@/components/sheet/MaxLoadSheetView';
import { PHASE_LABELS, ProgressBar, actionButtonClass, secondaryButtonClass } from '@/components/sheet/sheetUi';
import { useTapHold } from '@/components/sheet/useTapHold';
import { buildResultSummary, buildSheetViewModel, type SheetRow } from '@/lib/sheetView';
import {
  computeSheetResult,
  deriveSheetState,
  formatWorkoutTime,
  type SheetEvent,
  type WorkoutStructure
} from '@/lib/workoutStructure';

// Súmula digital do judge (Story 1.44, desenho D+E "Toque e segure"): lê a
// estrutura da prova, mostra o progresso e EMITE eventos do log (rep, fill,
// set, adj, undo). Quem guarda o log, o relógio e a publicação é o consumidor;
// este componente não grava nada, não usa rede e não calcula score (o motor da
// Story 1.43 calcula). Sem `onEvent` fica somente leitura. Texto em português
// fixo, como no restante da área do judge. Provas de carga máxima (Story 1.47)
// usam a súmula por tentativas (MaxLoadSheetView); calorias e metros (Story
// 1.48) aparecem com a unidade e se corrigem informando quanto foi feito.
// Provas intervaladas (Story 1.62) usam a súmula de rounds com trabalho e
// descanso (IntervalSheetView), e as de distância (Story 1.68) a súmula do
// total em metros (DistanceSheetView).

export type SheetPhase = 'ready' | 'running' | 'stopped';

export type SheetContext = {
  workoutName?: string;
  athleteName?: string;
  laneLabel?: string;
};

export type SheetViewProps = {
  structure: WorkoutStructure;
  /** O log de eventos, na ordem em que foram registrados. */
  events: readonly SheetEvent[];
  phase: SheetPhase;
  /** Segundos do relógio da prova; vira o `at` dos eventos emitidos. */
  elapsedSeconds: number;
  context?: SheetContext;
  onEvent?: (event: SheetEvent) => void;
  onStart?: () => void;
  onStop?: () => void;
};

const END_HINT_MS = 2200;
// Circunferência do anel de progresso do segurar (raio 46 no viewBox 100).
const RING_LENGTH = 2 * Math.PI * 46;

function TieBreakBadge({ timeLabel }: { timeLabel: string | null }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-primary/50 bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
      <Clock className="h-3 w-3" aria-hidden="true" />
      Tie-break{timeLabel ? <span className="font-number normal-case tracking-normal text-foreground">{timeLabel}</span> : null}
    </span>
  );
}

type CurrentSegmentProps = {
  row: SheetRow;
  enabled: boolean;
  phase: SheetPhase;
  onRep: () => void;
  onFill: () => void;
};

// O segmento que o judge está contando: alvo grande de toque. Tocar soma uma
// repetição; segurar conclui o segmento.
function CurrentSegment({ row, enabled, phase, onRep, onFill }: CurrentSegmentProps) {
  const [endHint, setEndHint] = useState(false);

  useEffect(() => {
    if (!endHint) return;
    const timer = setTimeout(() => setEndHint(false), END_HINT_MS);
    return () => clearTimeout(timer);
  }, [endHint]);

  const isEnd = row.mark === 'end';
  const { holding, handlers } = useTapHold({
    disabled: !enabled,
    onTap: () => {
      if (isEnd) setEndHint(true);
      else onRep();
    },
    onHold: onFill
  });

  const hint = phase === 'ready'
    ? 'Inicie o relógio para contar'
    : isEnd
      ? 'Segure para concluir o movimento'
      : 'Toque +1 · Segure para concluir';

  return (
    <div className="space-y-2">
      <button
        type="button"
        {...handlers}
        disabled={!enabled}
        aria-label={`${row.name}: ${row.done} de ${row.target}. ${isEnd ? 'Segure para concluir' : `Toque para somar ${row.unit === 'cal' ? 'uma caloria' : 'uma repetição'}, segure para concluir o segmento`}`}
        className={`relative flex min-h-36 w-full select-none flex-col items-center justify-center gap-1 rounded-2xl border-2 px-4 py-5 text-center transition-colors [-webkit-touch-callout:none] [-webkit-tap-highlight-color:transparent] touch-manipulation disabled:cursor-not-allowed ${
          enabled
            ? holding
              ? 'border-primary bg-primary/20 text-foreground'
              : 'border-primary bg-primary/10 text-foreground active:bg-primary/20'
            : 'border-card-border bg-dark-gray text-muted'
        }`}
      >
        <span className="text-xs font-bold uppercase tracking-widest text-muted">
          {row.name}{row.loadLabel ? ` · ${row.loadLabel}` : ''}
        </span>
        <span className="relative flex h-28 w-28 items-center justify-center">
          <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true" focusable="false">
            <circle cx="50" cy="50" r="46" fill="none" strokeWidth="5" className="stroke-card-border" />
            <circle
              cx="50"
              cy="50"
              r="46"
              fill="none"
              strokeWidth="5"
              strokeLinecap="round"
              // A duração (700 ms) é a de HOLD_MS; vem por classe para o prefers-reduced-motion valer.
              className={`stroke-primary ${holding ? 'transition-[stroke-dashoffset] duration-700 ease-linear motion-reduce:transition-none' : 'transition-none'}`}
              style={{ strokeDasharray: RING_LENGTH, strokeDashoffset: holding ? 0 : RING_LENGTH }}
            />
          </svg>
          <span className="font-number text-6xl font-extrabold leading-none tabular-nums">{row.done}</span>
        </span>
        <span className="text-sm font-semibold text-muted">de <span className="font-number text-foreground">{row.target}</span> {row.unitWord}</span>
        <span className={`text-xs font-semibold ${endHint ? 'text-primary' : 'text-muted'}`} aria-live="polite">
          {endHint ? 'Segure para concluir' : hint}
        </span>
      </button>
      {row.isTieBreak && (
        <div className="flex justify-center">
          <TieBreakBadge timeLabel={row.tieBreakTimeLabel} />
        </div>
      )}
      {enabled && (
        <button type="button" onClick={onFill} className={`${secondaryButtonClass} w-full text-xs`}>
          <Check className="h-4 w-4" aria-hidden="true" />
          Concluir segmento
        </button>
      )}
    </div>
  );
}

// Correção de calorias e metros depois de parar o relógio: o judge informa
// quanto foi feito (evento `set`), em vez de somar de um em um.
function SetAmount({ row, onSet }: { row: SheetRow; onSet: (value: number) => void }) {
  const [text, setText] = useState(String(row.done));
  // Id único por súmula: mais de um atleta pode aparecer na mesma tela.
  const inputId = `${useId()}-${row.id}`;
  const trimmed = text.trim();
  const value = /^\d{1,5}$/.test(trimmed) ? Number(trimmed) : null;
  const valid = value !== null && value <= row.target && value !== row.done;
  const commit = () => {
    if (valid && value !== null) onSet(value);
  };
  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor={inputId} className="sr-only">Quanto foi feito de {row.name}, em {row.unitWord}</label>
      <input
        id={inputId}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          commit();
        }}
        className="min-h-11 w-20 rounded-md border border-card-border bg-dark-gray px-2 text-center font-number text-sm font-bold tabular-nums text-foreground focus:border-primary/60 focus:outline-none"
      />
      <span className="font-number text-xs font-semibold tabular-nums text-muted">/ {row.target} {row.unitShort}</span>
      <button type="button" onClick={commit} disabled={!valid} className={`${secondaryButtonClass} !px-3`}>
        Definir
      </button>
    </div>
  );
}

type SegmentRowProps = {
  row: SheetRow;
  corrections: boolean;
  onAdjust: (delta: number) => void;
  onSet: (value: number) => void;
};

function SegmentRow({ row, corrections, onAdjust, onSet }: SegmentRowProps) {
  const done = row.status === 'done';
  const current = row.status === 'current';
  return (
    <li
      className={`space-y-2 rounded-xl border px-3 py-2.5 ${
        current ? 'border-primary/60 bg-primary/5' : 'border-card-border bg-card'
      } ${row.status === 'pending' ? 'opacity-70' : ''}`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] ${
            done ? 'border-trading-up bg-trading-up/15 text-trading-up' : 'border-card-border text-muted'
          }`}
          aria-hidden="true"
        >
          {done ? <Check className="h-3.5 w-3.5" /> : null}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-foreground">
            {row.name}
            {row.loadLabel ? <span className="ml-1.5 font-medium text-muted">{row.loadLabel}</span> : null}
          </p>
          {row.isTieBreak && (
            <div className="mt-1">
              <TieBreakBadge timeLabel={row.tieBreakTimeLabel} />
            </div>
          )}
        </div>
        {corrections && row.unit !== 'reps' ? (
          <SetAmount key={`${row.id}-${row.done}`} row={row} onSet={onSet} />
        ) : corrections ? (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onAdjust(-1)}
              disabled={row.done <= 0}
              aria-label={`Tirar uma repetição de ${row.name}`}
              className={`${secondaryButtonClass} !px-0 w-11`}
            >
              <Minus className="h-4 w-4" aria-hidden="true" />
            </button>
            <span className="min-w-[3.5rem] text-center font-number text-sm font-bold tabular-nums text-foreground">
              {row.done}/{row.target}
            </span>
            <button
              type="button"
              onClick={() => onAdjust(1)}
              disabled={row.done >= row.target}
              aria-label={`Somar uma repetição em ${row.name}`}
              className={`${secondaryButtonClass} !px-0 w-11`}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <span className="font-number text-sm font-bold tabular-nums text-foreground">
            {row.done}/{row.target}{row.unit !== 'reps' ? ` ${row.unitShort}` : ''}
          </span>
        )}
      </div>
      <ProgressBar percent={row.percent} tone={done ? 'up' : 'primary'} label={`Progresso de ${row.name}`} />
    </li>
  );
}

function SegmentSheetView({
  structure,
  events,
  phase,
  elapsedSeconds,
  context,
  onEvent,
  onStart,
  onStop
}: SheetViewProps) {
  const state = useMemo(() => deriveSheetState(structure, events), [structure, events]);
  const result = useMemo(() => computeSheetResult(structure, state), [structure, state]);
  const view = useMemo(() => buildSheetViewModel(structure, state, events), [structure, state, events]);
  const summary = useMemo(() => buildResultSummary(structure, result), [structure, result]);

  const interactive = Boolean(onEvent);
  const running = phase === 'running';
  const at = Math.max(0, Math.floor(Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0));
  // O relógio mostra o mesmo segundo que o evento grava (`at`): formatWorkoutTime arredonda para
  // cima, e mostrar 00:29 enquanto o registro diz 28 daria ao atleta um segundo que o judge não viu.
  const clockLabel = formatWorkoutTime(at);
  const counting = interactive && running && !view.completed;
  const showResult = phase === 'stopped' || view.completed;
  const timeCap = structure.timeCapSeconds ?? 0;
  const capReached = running && timeCap > 0 && elapsedSeconds >= timeCap;
  const capLabel = structure.format === 'amrap' ? 'Duração' : 'Time cap';
  const clockPercent = timeCap > 0
    ? Math.max(0, Math.min(100, Math.round((elapsedSeconds / timeCap) * 100)))
    : 0;

  const emit = (event: SheetEvent) => onEvent?.(event);
  const emitUndo = () => {
    if (view.undoTarget !== null) emit({ t: 'undo', of: view.undoTarget, at });
  };

  const current = view.current;
  const hasHeader = Boolean(context?.workoutName || context?.athleteName || context?.laneLabel);

  return (
    <section aria-label="Súmula digital" className="space-y-4 text-foreground">
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
            <p className="font-number text-4xl font-extrabold leading-none tabular-nums" aria-label={`Relógio ${clockLabel}`}>
              {clockLabel}
            </p>
          </div>
          <p className="text-right text-xs font-semibold text-muted">
            {capLabel}
            <span className="block font-number text-base font-bold tabular-nums text-foreground">{formatWorkoutTime(timeCap)}</span>
          </p>
        </div>
        <ProgressBar percent={clockPercent} label={`Relógio em relação ao ${capLabel.toLowerCase()}`} />
        {capReached && (
          <p role="status" className="rounded-md border border-trading-down/50 bg-trading-down/10 px-3 py-2 text-xs font-bold text-foreground">
            {structure.format === 'amrap' ? 'Tempo esgotado. Pare o relógio.' : 'Time cap atingido. Pare o relógio.'}
          </p>
        )}
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between text-xs font-semibold text-muted">
            <span>{view.roundLabel ?? 'Progresso'}</span>
            <span className="font-number text-sm font-bold tabular-nums text-foreground">{view.progress.label}</span>
          </div>
          <ProgressBar percent={view.progress.percent} tone={view.completed ? 'up' : 'primary'} label="Progresso das repetições" />
        </div>
        {view.tieBreakNote && (
          <p className="flex items-center gap-1.5 text-xs font-semibold text-primary">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            {view.tieBreakNote}
          </p>
        )}
      </div>

      <p className="sr-only" aria-live="polite">
        {current ? `${current.name}: ${current.done} de ${current.target} ${current.unitWord}` : 'Todo o trabalho concluído'}
      </p>

      {phase !== 'stopped' && current && !view.completed && (
        <CurrentSegment
          key={current.id}
          row={current}
          enabled={counting}
          phase={phase}
          onRep={() => emit({ t: 'rep', seg: current.id, at })}
          onFill={() => {
            if (current.remaining > 0) emit({ t: 'fill', seg: current.id, n: current.remaining, at });
          }}
        />
      )}

      <div className="space-y-3">
        {view.groups.map((group) => (
          <div key={group.round} className="space-y-2">
            {view.showRoundTitles && (
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted">{group.title}</h3>
            )}
            <ul className="space-y-2">
              {group.rows
                .filter((row) => phase === 'stopped' || view.completed || row.status !== 'current')
                .map((row) => (
                  <SegmentRow
                    key={row.id}
                    row={row}
                    corrections={interactive && phase === 'stopped'}
                    onAdjust={(delta) => emit({ t: 'adj', seg: row.id, d: delta, at })}
                    onSet={(value) => emit({ t: 'set', seg: row.id, v: value, at })}
                  />
                ))}
            </ul>
          </div>
        ))}
      </div>

      {showResult && (
        <div className="space-y-2 rounded-2xl border border-primary/60 bg-primary/5 p-4" aria-label="Resultado">
          <p className="text-[10px] font-bold uppercase tracking-widest text-primary">{summary.caption}</p>
          <p className="font-number text-4xl font-extrabold leading-tight tabular-nums">{summary.headline}</p>
          <ul className="space-y-0.5 text-xs font-semibold text-muted">
            {summary.details.map((line) => <li key={line}>{line}</li>)}
          </ul>
          {summary.warning && (
            <p role="alert" className="rounded-md border border-trading-down/50 bg-trading-down/10 px-3 py-2 text-xs font-bold text-foreground">
              {summary.warning}
            </p>
          )}
        </div>
      )}

      {interactive && (
        <div className="sticky bottom-0 -mx-1 flex gap-2 bg-background/95 px-1 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
          <button type="button" onClick={emitUndo} disabled={!view.canUndo} className={`${secondaryButtonClass} flex-1`}>
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

export function SheetView(props: SheetViewProps) {
  // Componentes diferentes por formato: o React monta um ou outro, sem misturar os hooks.
  if (props.structure.format === 'distance') return <DistanceSheetView {...props} />;
  if (props.structure.format === 'interval') return <IntervalSheetView {...props} />;
  return props.structure.format === 'max_load' ? <MaxLoadSheetView {...props} /> : <SegmentSheetView {...props} />;
}
