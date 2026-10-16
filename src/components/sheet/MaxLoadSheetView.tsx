'use client';

import { useId, useMemo, useState } from 'react';
import { Check, ChevronRight, Minus, Play, Plus, Square, Undo2, X } from 'lucide-react';

import type { SheetViewProps } from '@/components/sheet/SheetView';
import { PHASE_LABELS, ProgressBar, actionButtonClass, secondaryButtonClass } from '@/components/sheet/sheetUi';
import { buildMaxLoadResultSummary, buildMaxLoadViewModel, type MaxLoadLiftRow } from '@/lib/sheetView';
import {
  WORKOUT_STRUCTURE_LIMITS,
  checkAttempt,
  computeMaxLoadResult,
  deriveMaxLoadState,
  formatWorkoutTime,
  type SheetEvent
} from '@/lib/workoutStructure';

// Súmula de carga máxima (Story 1.47): uma tentativa por vez. O judge ajusta a
// carga (com o incremento da prova), marca "Válida" ou "No-rep" e a súmula
// EMITE o evento `attempt`; o motor conta só o que vale (janela, limite de
// tentativas e ordem) e soma as melhores cargas. Como a súmula de segmentos,
// não grava nada, não usa rede e não calcula score. Sem `onEvent` fica
// somente leitura.

const formatKg = (kg: number) => String(kg).replace('.', ',');
const parseKg = (text: string) => {
  const trimmed = text.trim().replace(',', '.');
  return /^\d{1,3}(\.\d{1,2})?$/.test(trimmed) ? Number(trimmed) : null;
};
const roundKg = (kg: number) => Math.round((kg + Number.EPSILON) * 100) / 100;

const STATUS_CLASSES: Record<MaxLoadLiftRow['status'], string> = {
  current: 'border-primary/60 bg-primary/5',
  done: 'border-card-border bg-card',
  pending: 'border-card-border bg-card opacity-80',
  locked: 'border-card-border bg-card opacity-60'
};

function LiftCard({ lift }: { lift: MaxLoadLiftRow }) {
  return (
    <li className={`space-y-2 rounded-xl border px-3 py-2.5 ${STATUS_CLASSES[lift.status]}`}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-bold text-foreground">
          {lift.name}
          <span className="ml-1.5 font-number text-xs font-semibold text-muted">{lift.repsLabel}</span>
        </p>
        <span className="font-number text-sm font-bold tabular-nums text-primary">{lift.bestLabel ?? '—'}</span>
      </div>
      {lift.attempts.length > 0 && (
        <ol className="flex flex-wrap gap-1.5" aria-label={`Tentativas de ${lift.name}`}>
          {lift.attempts.map((attempt) => (
            <li
              key={attempt.position}
              className={`flex min-h-9 items-center gap-1.5 rounded-md border px-2 font-number text-xs font-bold tabular-nums ${
                attempt.ok ? 'border-trading-up/60 bg-trading-up/10 text-foreground' : 'border-trading-down/60 bg-trading-down/10 text-foreground'
              }`}
            >
              <span className="text-muted">T{attempt.number}</span>
              {attempt.loadLabel}
              {attempt.ok
                ? <Check className="h-3.5 w-3.5 text-trading-up" aria-label="válida" />
                : <X className="h-3.5 w-3.5 text-trading-down" aria-label="no-rep" />}
              <span className="font-medium text-muted">{attempt.atLabel}</span>
            </li>
          ))}
        </ol>
      )}
      <p className="text-[11px] font-semibold text-muted">
        {lift.status === 'locked' ? 'Ficou para trás (ordem fixa)' : lift.remainingLabel}
        {lift.startLoadLabel && lift.attempts.length === 0 ? ` · ${lift.startLoadLabel}` : ''}
      </p>
    </li>
  );
}

export function MaxLoadSheetView({
  structure,
  events,
  phase,
  elapsedSeconds,
  context,
  onEvent,
  onStart,
  onStop
}: SheetViewProps) {
  const [selectedLiftId, setSelectedLiftId] = useState<string | null>(null);
  const [loadDraft, setLoadDraft] = useState<{ key: string; text: string } | null>(null);
  const [error, setError] = useState('');
  // Id único por súmula: mais de um atleta pode aparecer na mesma tela.
  const loadInputId = `${useId()}-carga`;

  const state = useMemo(() => deriveMaxLoadState(structure, events), [structure, events]);
  const result = useMemo(() => computeMaxLoadResult(structure, state), [structure, state]);
  const view = useMemo(() => buildMaxLoadViewModel(structure, state, events, selectedLiftId), [structure, state, events, selectedLiftId]);
  const summary = useMemo(() => buildMaxLoadResultSummary(structure, result, state), [structure, result, state]);

  const interactive = Boolean(onEvent);
  const running = phase === 'running';
  const at = Math.max(0, Math.floor(Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0));
  const clockLabel = formatWorkoutTime(at);
  const windowSeconds = structure.timeCapSeconds;
  // O segundo da janela ainda conta (o motor recusa só depois dele).
  const windowOver = running && windowSeconds !== null && at > windowSeconds;
  const clockPercent = windowSeconds
    ? Math.max(0, Math.min(100, Math.round((elapsedSeconds / windowSeconds) * 100)))
    : 0;

  const current = view.current;
  const finished = state.attemptsUsed > 0 && state.currentLiftId === null;
  const suggestionKey = current ? `${current.id}-${state.attemptsUsed}` : '';
  const loadText = loadDraft && loadDraft.key === suggestionKey ? loadDraft.text : formatKg(view.suggestedLoadKg);
  const load = parseKg(loadText);
  const canLift = interactive && running && current !== null && !windowOver;
  const showResult = phase === 'stopped' || finished;
  const currentIndex = current ? view.lifts.findIndex((lift) => lift.id === current.id) : -1;
  const nextLift = view.order === 'fixed' && currentIndex >= 0 ? view.lifts[currentIndex + 1] ?? null : null;

  const emit = (event: SheetEvent) => onEvent?.(event);
  const emitUndo = () => {
    if (view.undoTarget !== null) emit({ t: 'undo', of: view.undoTarget, at });
  };
  const register = (ok: boolean) => {
    if (!current) return;
    if (load === null) {
      setError('Informe a carga em kg (ex.: 102,5).');
      return;
    }
    const check = checkAttempt(structure, state, current.id, load, at);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setError('');
    setLoadDraft(null);
    emit({ t: 'attempt', lift: current.id, load, ok, at });
  };
  const nudge = (delta: number) => {
    const base = load ?? view.suggestedLoadKg;
    const next = Math.max(WORKOUT_STRUCTURE_LIMITS.minLoadKg, Math.min(WORKOUT_STRUCTURE_LIMITS.maxLoadKg, roundKg(base + delta)));
    setLoadDraft({ key: suggestionKey, text: formatKg(next) });
  };
  const hasHeader = Boolean(context?.workoutName || context?.athleteName || context?.laneLabel);

  return (
    <section aria-label="Súmula digital de carga máxima" className="space-y-4 text-foreground">
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
            Janela
            <span className="block font-number text-base font-bold tabular-nums text-foreground">
              {windowSeconds === null ? 'Sem janela' : formatWorkoutTime(windowSeconds)}
            </span>
          </p>
        </div>
        {windowSeconds !== null && <ProgressBar percent={clockPercent} label="Relógio em relação à janela" />}
        {windowOver && (
          <p role="status" className="rounded-md border border-trading-down/50 bg-trading-down/10 px-3 py-2 text-xs font-bold text-foreground">
            Janela encerrada: levantamento depois dela não conta. Pare o relógio.
          </p>
        )}
        <div className="flex items-baseline justify-between text-xs font-semibold text-muted">
          <span>{view.scoreCaption}</span>
          <span className="font-number text-sm font-bold tabular-nums text-foreground">{view.scoreLabel}</span>
        </div>
      </div>

      <p className="sr-only" aria-live="polite">
        {current ? `${current.name}: próxima tentativa com ${loadText} quilos. ${current.remainingLabel}.` : 'Tentativas encerradas'}
      </p>

      {phase !== 'stopped' && current && (
        <div className="space-y-3 rounded-2xl border-2 border-primary bg-primary/5 p-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="min-w-0 text-lg font-extrabold leading-tight">
              {current.name}
              <span className="ml-2 font-number text-sm font-semibold text-muted">{current.repsLabel}</span>
            </p>
            <p className="shrink-0 text-right text-[11px] font-semibold text-muted">{current.remainingLabel}</p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => nudge(-view.stepKg)}
              disabled={!canLift}
              aria-label={`Diminuir ${formatKg(view.stepKg)} kg`}
              className={`${secondaryButtonClass} !px-0 w-12`}
            >
              <Minus className="h-4 w-4" aria-hidden="true" />
            </button>
            <label htmlFor={loadInputId} className="sr-only">Carga da tentativa em kg</label>
            <input
              id={loadInputId}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={loadText}
              disabled={!canLift}
              onChange={(event) => setLoadDraft({ key: suggestionKey, text: event.target.value })}
              className="min-h-12 w-full min-w-0 rounded-md border border-card-border bg-dark-gray px-3 text-center font-number text-3xl font-extrabold tabular-nums text-foreground focus:border-primary/60 focus:outline-none disabled:opacity-60"
            />
            <span className="text-sm font-bold text-muted">kg</span>
            <button
              type="button"
              onClick={() => nudge(view.stepKg)}
              disabled={!canLift}
              aria-label={`Aumentar ${formatKg(view.stepKg)} kg`}
              className={`${secondaryButtonClass} !px-0 w-12`}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => register(true)}
              disabled={!canLift}
              aria-label={`Registrar ${loadText} kg em ${current.name} como válida`}
              className={`${actionButtonClass} min-h-14 border-trading-up bg-trading-up/15 text-base text-foreground hover:bg-trading-up/25`}
            >
              <Check className="h-5 w-5" aria-hidden="true" />
              Válida
            </button>
            <button
              type="button"
              onClick={() => register(false)}
              disabled={!canLift}
              aria-label={`Registrar ${loadText} kg em ${current.name} como no-rep`}
              className={`${actionButtonClass} min-h-14 border-trading-down bg-trading-down/15 text-base text-foreground hover:bg-trading-down/25`}
            >
              <X className="h-5 w-5" aria-hidden="true" />
              No-rep
            </button>
          </div>

          {!running && <p className="text-center text-xs font-semibold text-muted">Inicie o relógio para registrar as tentativas</p>}
          {error && <p role="alert" className="text-xs font-bold text-trading-down">{error}</p>}

          {interactive && view.order === 'fixed' && nextLift && (
            <button type="button" onClick={() => setSelectedLiftId(nextLift.id)} className={`${secondaryButtonClass} w-full text-xs`}>
              Passar para {nextLift.name}
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          {interactive && view.order === 'free' && view.lifts.filter((lift) => lift.selectable).length > 1 && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Escolher o movimento">
              {view.lifts.filter((lift) => lift.selectable).map((lift) => (
                <button
                  key={lift.id}
                  type="button"
                  onClick={() => setSelectedLiftId(lift.id)}
                  aria-pressed={lift.id === current.id}
                  className={`min-h-9 rounded-md border px-3 text-xs font-bold ${lift.id === current.id ? 'border-primary bg-primary text-ink' : 'border-card-border bg-dark-gray text-foreground hover:border-primary'}`}
                >
                  {lift.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <ul className="space-y-2">
        {view.lifts.map((lift) => <LiftCard key={lift.id} lift={lift} />)}
      </ul>

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
