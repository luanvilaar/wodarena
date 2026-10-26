'use client';

import { useEffect, useId, useState } from 'react';
import { Check, Clock, Minus, Plus } from 'lucide-react';

import { ProgressBar, secondaryButtonClass } from '@/components/sheet/sheetUi';
import { useTapHold } from '@/components/sheet/useTapHold';
import type { SheetPhase } from '@/components/sheet/SheetView';
import type { SheetRow } from '@/lib/sheetView';

// Peças da súmula por segmentos (Story 1.44, desenho D+E "Toque e segure"),
// compartilhadas entre a súmula de For Time e AMRAP (SheetView) e a liberação
// da Tonelagem (Story 1.80): o segmento que o judge conta, a linha de cada
// segmento e a correção de calorias e metros. Só tela: o que cada toque
// significa (rep, fill, set, adj) é do consumidor.

const END_HINT_MS = 2200;
// Circunferência do anel de progresso do segurar (raio 46 no viewBox 100).
const RING_LENGTH = 2 * Math.PI * 46;

export function TieBreakBadge({ timeLabel }: { timeLabel: string | null }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-primary/50 bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
      <Clock className="h-3 w-3" aria-hidden="true" />
      Tie-break{timeLabel ? <span className="font-number normal-case tracking-normal text-foreground">{timeLabel}</span> : null}
    </span>
  );
}

export type CurrentSegmentProps = {
  row: SheetRow;
  enabled: boolean;
  phase: SheetPhase;
  onRep: () => void;
  onFill: () => void;
};

// O segmento que o judge está contando: alvo grande de toque. Tocar soma uma
// repetição; segurar conclui o segmento.
export function CurrentSegment({ row, enabled, phase, onRep, onFill }: CurrentSegmentProps) {
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

export type SegmentRowProps = {
  row: SheetRow;
  corrections: boolean;
  onAdjust: (delta: number) => void;
  onSet: (value: number) => void;
};

export function SegmentRow({ row, corrections, onAdjust, onSet }: SegmentRowProps) {
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
