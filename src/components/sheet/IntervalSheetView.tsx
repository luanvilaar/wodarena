'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { ChevronDown, Minus, Play, Plus, Square, Undo2 } from 'lucide-react';

import type { SheetViewProps } from '@/components/sheet/SheetView';
import { PHASE_LABELS, actionButtonClass, secondaryButtonClass } from '@/components/sheet/sheetUi';
import { useTapHold } from '@/components/sheet/useTapHold';
import {
  buildIntervalResultSummary,
  buildIntervalViewModel,
  decideIntervalTouch,
  type IntervalClockPhase,
  type IntervalCorrectionCard,
  type IntervalCorrectionControl,
  type IntervalTile,
  type IntervalViewModel
} from '@/lib/sheetView';
import {
  computeIntervalResult,
  deriveIntervalState,
  intervalPhaseAt,
  type SheetEvent
} from '@/lib/workoutStructure';

// Súmula do Intervalado (Story 1.62, Maquete 2 de docs/design/intervalado/):
// relógio, fase (trabalho ou descanso), round e contagem regressiva; o
// movimento da vez como alvo grande de toque (primeiro os fixos do round, depois
// o máximo); quadro dos rounds; depois de parar, a correção por round (`adj` e
// `set` com `rd`) e o resultado. Como as outras súmulas, EMITE eventos do log e
// não grava, não usa rede e não calcula score: a fase vem de intervalPhaseAt, o
// toque passa pela porta checkIntervalEntry antes de ser emitido, e o estado e
// o resultado vêm do motor da Story 1.60. Sem `onEvent` fica somente leitura.

/** Tempo da mensagem de toque recusado (o mesmo da maquete). */
export const REFUSAL_MESSAGE_MS = 2600;

// Circunferência do anel de progresso do segurar (raio 46 no viewBox 100), como no For Time.
const RING_LENGTH = 2 * Math.PI * 46;

// Descanso em listras, como na maquete (a cor vem do tema).
const restStyle = { background: 'repeating-linear-gradient(135deg, var(--card-border) 0 4px, transparent 4px 8px)' };

const PILL_CLASSES: Record<IntervalClockPhase, string> = {
  work: 'bg-trading-up text-background',
  rest: 'bg-elevated text-foreground',
  ended: 'bg-trading-down text-background'
};

const adjustButtonClass = `${secondaryButtonClass} !min-h-12 w-12 !px-0`;

const refusalCountText = (count: number) => (
  count === 1 ? '1 toque fora da janela foi recusado.' : `${count} toques fora da janela foram recusados.`
);

function IntervalTimeline({ view, hasFixed }: { view: IntervalViewModel; hasFixed: boolean }) {
  const { blocks, ticks, markerPercent, ariaLabel } = view.timeline;
  return (
    <div className="relative">
      <div role="img" aria-label={ariaLabel} className="flex h-[18px] overflow-hidden rounded-md border border-card-border bg-card">
        {blocks.map((block, index) => (
          block.kind === 'work' ? (
            <span key={index} className="flex min-w-0" style={{ flex: `${block.seconds} 0 0` }}>
              {hasFixed && <span className="block h-full bg-info" style={{ flex: '45 0 0' }} />}
              <span className="block h-full bg-primary" style={{ flex: '55 0 0' }} />
            </span>
          ) : (
            <span key={index} className="block" style={{ flex: `${block.seconds} 0 0`, ...restStyle }} />
          )
        ))}
      </div>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-[3px] h-[24px] w-0.5 -translate-x-1/2 bg-foreground transition-[left] duration-200 ease-linear motion-reduce:transition-none"
        style={{ left: `${markerPercent}%` }}
      />
      <div aria-hidden="true" className="relative mt-1 h-4 font-number text-[10px] text-muted">
        {ticks.map((tick, index) => {
          const left = view.durationSeconds > 0 ? (tick.at / view.durationSeconds) * 100 : 0;
          // Perto do fim, a marca encostaria na do total (a súmula tem largura de celular também no desktop).
          if (index > 0 && left > 85) return null;
          return (
            <span
              key={tick.at}
              className={`absolute top-0 whitespace-nowrap ${index === 0 ? '' : '-translate-x-1/2'}`}
              style={{ left: `${left}%` }}
            >
              {tick.label}
            </span>
          );
        })}
        <span className="absolute top-0 -translate-x-full whitespace-nowrap" style={{ left: '100%' }}>{view.durationLabel}</span>
      </div>
    </div>
  );
}

type TileMode = 'live' | 'ready' | 'readonly';

// O movimento da vez. Na janela de trabalho, tocar soma e segurar conclui o
// fixo; no descanso e depois do fim o tile fica com aria-disabled, mas o toque
// ainda chega à porta, que recusa e mostra a mensagem.
function IntervalTileButton({ tile, mode, onTap, onHold }: { tile: IntervalTile; mode: TileMode; onTap: () => void; onHold: () => void }) {
  const [endHint, setEndHint] = useState(false);

  useEffect(() => {
    if (!endHint) return;
    const timer = setTimeout(() => setEndHint(false), REFUSAL_MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [endHint]);

  const live = mode === 'live';
  const counts = tile.kind === 'fixed' || tile.kind === 'max';
  const blockMark = tile.kind === 'fixed' && tile.mark === 'end';
  const { holding, handlers } = useTapHold({
    disabled: !live,
    onTap: () => {
      // Marcação por bloco: só o segurar conclui (como no For Time); o toque não emite nada.
      if (blockMark && live) setEndHint(true);
      else onTap();
    },
    onHold
  });

  const hint = mode === 'ready' ? 'Inicie o relógio para contar' : endHint ? 'Segure para concluir' : tile.hint;
  const active = live && counts;

  return (
    <button
      type="button"
      {...handlers}
      disabled={!live}
      aria-disabled={live && !counts ? 'true' : undefined}
      aria-label={`${tile.label}: ${tile.done} ${tile.targetLabel}. ${hint}`}
      className={`relative flex min-h-36 w-full select-none flex-col items-center justify-center gap-1 rounded-2xl border-2 px-4 py-4 text-center transition-colors motion-reduce:transition-none [-webkit-touch-callout:none] [-webkit-tap-highlight-color:transparent] touch-manipulation disabled:cursor-not-allowed ${
        active
          ? holding
            ? 'border-primary bg-primary/20 text-foreground'
            : 'border-primary bg-primary/10 text-foreground active:bg-primary/20'
          : `border-card-border bg-card text-muted ${live ? 'cursor-not-allowed' : ''}`
      }`}
    >
      <span className="text-xs font-bold uppercase tracking-widest text-muted">{tile.label}</span>
      {tile.kind === 'fixed' ? (
        <span className="relative flex h-24 w-24 items-center justify-center">
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
          <span className="font-number text-6xl font-extrabold leading-none tabular-nums text-foreground">{tile.done}</span>
        </span>
      ) : (
        <span className={`font-number text-6xl font-extrabold leading-none tabular-nums ${counts ? 'text-foreground' : ''}`}>{tile.done}</span>
      )}
      <span className="text-sm font-semibold text-muted">{tile.targetLabel}</span>
      <span className={`text-xs font-semibold ${active || endHint ? 'text-primary' : 'text-muted'}`}>{hint}</span>
    </button>
  );
}

// Valor informado direto (calorias e metros), com o round do cartão: evento `set`.
function SetAmount({ control, round, onSet }: { control: IntervalCorrectionControl; round: number; onSet: (value: number) => void }) {
  const [text, setText] = useState(String(control.value));
  // Id único por súmula: mais de um atleta pode aparecer na mesma tela.
  const inputId = `${useId()}-${control.id}-${round}`;
  const trimmed = text.trim();
  const value = /^\d{1,5}$/.test(trimmed) ? Number(trimmed) : null;
  const valid = value !== null && value <= (control.target ?? value) && value !== control.value;
  const commit = () => {
    if (valid && value !== null) onSet(value);
  };
  return (
    <div className="flex items-center justify-end gap-1.5">
      <label htmlFor={inputId} className="sr-only">Quanto foi feito de {control.name} no round {round}, em {control.unitWord}</label>
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
      <span className="font-number text-xs font-semibold tabular-nums text-muted">/ {control.target} {control.unitShort}</span>
      <button type="button" onClick={commit} disabled={!valid} className={`${secondaryButtonClass} !px-3`}>
        Definir
      </button>
    </div>
  );
}

function AdjustRow({ control, round, onAdjust, onSet }: {
  control: IntervalCorrectionControl;
  round: number;
  onAdjust: (delta: number) => void;
  onSet: (value: number) => void;
}) {
  const one = control.unit === 'reps' ? 'uma repetição' : control.unit === 'cal' ? 'uma caloria' : 'um metro';
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="min-w-0 font-semibold">{control.name}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => onAdjust(-1)}
            disabled={!control.canDecrease}
            aria-label={`Tirar ${one} de ${control.name} no round ${round}`}
            className={adjustButtonClass}
          >
            <Minus className="h-4 w-4" aria-hidden="true" />
          </button>
          <span className="min-w-[3.5rem] text-center font-number text-base font-extrabold tabular-nums">{control.valueLabel}</span>
          <button
            type="button"
            onClick={() => onAdjust(1)}
            disabled={!control.canIncrease}
            aria-label={`Somar ${one} em ${control.name} no round ${round}`}
            className={adjustButtonClass}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
        </span>
      </div>
      {control.kind === 'fixed' && control.unit !== 'reps' && (
        <SetAmount key={`${control.id}-${control.value}`} control={control} round={round} onSet={onSet} />
      )}
    </div>
  );
}

// Um cartão por round (AUTO-DECISION 5): o máximo sempre; os fixos abaixo da
// meta abertos e os completos recolhidos em "Ajustar fixos". Um fixo que o
// judge mexeu fica onde estava, para o foco não sumir quando ele cruza a meta.
function RoundCard({ card, onAdjust, onSet }: {
  card: IntervalCorrectionCard;
  onAdjust: (seg: string, delta: number) => void;
  onSet: (seg: string, value: number) => void;
}) {
  const [placement, setPlacement] = useState<Record<string, 'open' | 'collapsed'>>({});
  const [expanded, setExpanded] = useState(false);
  const panelId = `${useId()}-fixos`;

  const placeOf = (control: IntervalCorrectionControl) => placement[control.id]
    ?? (control.value < (control.target ?? 0) ? 'open' : 'collapsed');
  const pin = (control: IntervalCorrectionControl) => {
    const where = placeOf(control);
    if (placement[control.id] !== where) setPlacement((current) => ({ ...current, [control.id]: where }));
  };
  const open = card.fixed.filter((control) => placeOf(control) === 'open');
  const collapsed = card.fixed.filter((control) => placeOf(control) === 'collapsed');

  const row = (control: IntervalCorrectionControl) => (
    <AdjustRow
      key={control.id}
      control={control}
      round={card.round}
      onAdjust={(delta) => {
        if (control.kind === 'fixed') pin(control);
        onAdjust(control.id, delta);
      }}
      onSet={(value) => {
        pin(control);
        onSet(control.id, value);
      }}
    />
  );

  return (
    <li className={`space-y-2 rounded-xl border px-3 py-2.5 ${card.scored ? 'border-card-border bg-background' : 'border-trading-down bg-trading-down/5'}`}>
      <div className="flex items-baseline justify-between gap-2 text-sm font-bold">
        <h4>Round {card.round}</h4>
        {card.statusLabel && <span className={card.scored ? 'text-trading-up' : 'text-trading-down'}>{card.statusLabel}</span>}
      </div>
      {open.map(row)}
      {row(card.max)}
      {collapsed.length > 0 && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-controls={panelId}
            className={`${secondaryButtonClass} gap-1.5 !px-3 text-xs`}
          >
            Ajustar fixos
            <ChevronDown className={`h-4 w-4 transition-transform motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
          <div id={panelId} hidden={!expanded} className="space-y-2">
            {collapsed.map(row)}
          </div>
        </div>
      )}
      {card.warning && <p className="text-xs font-semibold text-trading-down">{card.warning}</p>}
    </li>
  );
}

export function IntervalSheetView({
  structure,
  events,
  phase,
  elapsedSeconds,
  context,
  onEvent,
  onStart,
  onStop
}: SheetViewProps) {
  const [refusals, setRefusals] = useState(0);
  const [message, setMessage] = useState<{ id: number; text: string } | null>(null);
  const titleId = `${useId()}-correcao`;

  const at = Math.max(0, Math.floor(Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0));
  const clockPhase = useMemo(() => intervalPhaseAt(structure, at), [structure, at]);
  const state = useMemo(() => deriveIntervalState(structure, events), [structure, events]);
  const result = useMemo(() => computeIntervalResult(state), [state]);
  const view = useMemo(() => buildIntervalViewModel(structure, state, events, at, clockPhase), [structure, state, events, at, clockPhase]);
  const summary = useMemo(() => buildIntervalResultSummary(structure, result, state, events), [structure, result, state, events]);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), REFUSAL_MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [message]);

  const interactive = Boolean(onEvent);
  const running = phase === 'running';
  const counting = interactive && running;
  const stopped = phase === 'stopped';

  const emit = (event: SheetEvent) => onEvent?.(event);
  const emitUndo = () => {
    if (view.undoTarget !== null) emit({ t: 'undo', of: view.undoTarget, at });
  };
  const refuse = (text: string) => {
    setRefusals((count) => count + 1);
    setMessage((current) => ({ id: (current?.id ?? 0) + 1, text }));
  };

  // Toque e segurar passam pela porta da tela, no mesmo segundo inteiro que o evento grava;
  // recusado, nada é emitido nem entra na fila, e a tela avisa.
  const touch = (gesture: 'tap' | 'hold') => {
    if (!counting) return;
    const decision = decideIntervalTouch(structure, state, at, gesture);
    if (decision.ok) emit(decision.event);
    else if (decision.refused) refuse(decision.refused);
  };

  const tile = view.tile;
  const tileMode: TileMode = counting ? 'live' : phase === 'ready' && interactive ? 'ready' : 'readonly';
  const tileKey = tile.kind === 'fixed' || tile.kind === 'max' ? `${tile.kind}-${tile.id}-${tile.round}` : tile.kind;
  const tileAnnouncement = tile.kind === 'fixed' || tile.kind === 'max' ? `${tile.label}: ${tile.done} ${tile.targetLabel}` : '';
  const hasHeader = Boolean(context?.workoutName || context?.athleteName || context?.laneLabel);
  const hasFixed = structure.segments.length > 0;
  const clockCaption = running ? 'Relógio da prova' : PHASE_LABELS[phase];

  return (
    <section aria-label="Súmula digital do intervalado" className="space-y-4 text-foreground">
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
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted">{clockCaption}</p>
            <p className="font-number text-4xl font-extrabold leading-none tabular-nums" aria-label={`Relógio ${view.clockLabel}`}>
              {view.clockLabel}
            </p>
          </div>
          <p className="text-right text-xs font-semibold text-muted">
            Duração
            <span className="block font-number text-base font-bold tabular-nums text-foreground">{view.durationLabel}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wider ${PILL_CLASSES[view.clockPhase]}`}>
            {view.phaseLabel}
          </span>
          <span className="text-sm font-bold">{view.roundLabel}</span>
        </div>
        {!stopped && (
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-semibold text-muted">{view.countdownCaption}</span>
            <span className="font-number text-2xl font-extrabold tabular-nums">{view.countdownLabel}</span>
          </div>
        )}
        <IntervalTimeline view={view} hasFixed={hasFixed} />
        <div role="status" aria-live="polite">
          {message && (
            <p className="rounded-md border border-trading-down bg-trading-down/10 px-3 py-2 text-xs font-bold text-foreground">{message.text}</p>
          )}
        </div>
      </div>

      {/* Fase e round anunciados só quando mudam (a contagem regressiva fica fora). */}
      <p className="sr-only" aria-live="polite">{view.announcement}</p>
      <p className="sr-only" aria-live="polite">{tileAnnouncement}</p>

      {!stopped && (
        <IntervalTileButton key={tileKey} tile={tile} mode={tileMode} onTap={() => touch('tap')} onHold={() => touch('hold')} />
      )}

      <div className="space-y-2 rounded-2xl border border-card-border bg-card p-3">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs tabular-nums">
            <caption className="sr-only">Quadro dos rounds</caption>
            <thead>
              <tr>
                <th scope="col" className="px-1 py-1 text-left text-[10px] font-bold uppercase tracking-wider text-muted">Round</th>
                {view.columns.map((column) => (
                  <th key={column.id} scope="col" title={column.name} className="px-1 py-1 text-right text-[10px] font-bold uppercase tracking-wider text-muted">
                    {column.kind === 'fixed' && column.short !== column.name ? (
                      <>
                        <span aria-hidden="true">{column.short}</span>
                        <span className="sr-only">{column.name}</span>
                      </>
                    ) : column.name}
                  </th>
                ))}
                <th scope="col" className="px-1 py-1 text-right text-[10px] font-bold uppercase tracking-wider text-muted">Conta</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((row) => (
                // Destaque só com o relógio rodando: antes do Iniciar e parado, nenhum round está em andamento.
                <tr key={row.round} className={row.current && running ? 'bg-primary/20 font-bold' : ''}>
                  <th scope="row" className="border-t border-card-border px-1 py-1.5 text-left font-semibold">
                    <span aria-hidden="true">R{row.round}</span>
                    <span className="sr-only">Round {row.round}{row.current && running ? ', em andamento' : ''}</span>
                    {row.flagged && <span className="block text-[10px] font-bold text-trading-down">Fixo incompleto</span>}
                  </th>
                  {row.fixed.map((value, index) => (
                    <td key={view.columns[index]?.id ?? index} className="border-t border-card-border px-1 py-1.5 text-right">{value}</td>
                  ))}
                  <td className="border-t border-card-border px-1 py-1.5 text-right">{row.maxRaw}</td>
                  <td className={`border-t border-card-border px-1 py-1.5 text-right font-extrabold ${row.flagged ? 'text-trading-down' : ''}`}>{row.counted}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={view.columns.length + 1} className="border-t-2 border-foreground px-1 py-1.5 text-sm font-extrabold">Total</td>
                <td className="border-t-2 border-foreground px-1 py-1.5 text-right text-sm font-extrabold">{view.total}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {refusals > 0 && <p className="text-xs font-semibold text-muted">{refusalCountText(refusals)}</p>}
      </div>

      {stopped && interactive && (
        <section aria-labelledby={titleId} className="space-y-2">
          <h3 id={titleId} className="text-base font-extrabold">Corrigir por round</h3>
          <p className="text-xs font-semibold text-muted">
            Parado, o relógio não diz a que round um ajuste pertence. Por isso a correção é feita dentro do round.
          </p>
          <ul className="space-y-2">
            {view.cards.map((card) => (
              <RoundCard
                key={card.round}
                card={card}
                // A correção leva o round do cartão (`rd`): parado, o `at` não diz o round.
                onAdjust={(seg, delta) => emit({ t: 'adj', seg, d: delta, at, rd: card.round })}
                onSet={(seg, value) => emit({ t: 'set', seg, v: value, at, rd: card.round })}
              />
            ))}
          </ul>
        </section>
      )}

      {stopped && (
        <div className="space-y-2">
          <div className="space-y-1.5 rounded-2xl border-2 border-primary bg-primary/10 p-4" aria-label="Resultado">
            <p className="text-[10px] font-bold uppercase tracking-widest text-primary">{summary.caption}</p>
            <p className="font-number text-5xl font-extrabold leading-tight tabular-nums">
              {summary.value} <span className="text-lg">{summary.unitWord}</span>
            </p>
            <ul className="space-y-0.5 text-xs font-semibold text-muted">
              {summary.details.map((line) => <li key={line}>{line}</li>)}
            </ul>
          </div>
          {summary.warning && (
            <p role="alert" className="rounded-md border border-trading-down bg-trading-down/10 px-3 py-2 text-xs font-bold text-foreground">
              {summary.warning}
            </p>
          )}
          <p className="text-xs font-semibold text-muted">{summary.note}</p>
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
