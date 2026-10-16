'use client';

import { useEffect, useRef, useState } from 'react';

import { SheetView, type SheetContext, type SheetPhase } from '@/components/sheet/SheetView';
import type { SheetEvent, WorkoutStructure } from '@/lib/workoutStructure';

// Súmula interativa de demonstração (Stories 1.44 e 1.45): liga o SheetView a um
// relógio e a um log em memória, com atalhos de tempo, para o gestor ver e
// testar a prova que montou e para a página de desenvolvimento. Nada é gravado
// nem enviado. Quem usa deve trocar a `key` quando a estrutura muda, porque o
// log guarda ids de segmentos da estrutura anterior.

type SheetDemoProps = {
  structure: WorkoutStructure;
  context?: SheetContext;
  /** Mostra o log de eventos emitidos (útil em desenvolvimento). */
  showLog?: boolean;
};

const TICK_MS = 200;

const buttonClass = 'min-h-9 rounded-md border border-card-border bg-dark-gray px-3 text-xs font-bold text-foreground transition-colors hover:border-primary';

export function SheetDemo({ structure, context, showLog = false }: SheetDemoProps) {
  const [events, setEvents] = useState<SheetEvent[]>([]);
  const [phase, setPhase] = useState<SheetPhase>('ready');
  const [elapsed, setElapsed] = useState(0);
  const clock = useRef({ startedAtMs: 0, baseSeconds: 0 });

  useEffect(() => {
    if (phase !== 'running') return;
    const timer = setInterval(() => {
      setElapsed(clock.current.baseSeconds + (Date.now() - clock.current.startedAtMs) / 1000);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [phase]);

  const reset = () => {
    clock.current = { startedAtMs: 0, baseSeconds: 0 };
    setEvents([]);
    setPhase('ready');
    setElapsed(0);
  };

  const start = () => {
    clock.current = { startedAtMs: Date.now(), baseSeconds: elapsed };
    setPhase('running');
  };

  const stop = () => {
    const stoppedAt = clock.current.baseSeconds + (Date.now() - clock.current.startedAtMs) / 1000;
    clock.current.baseSeconds = stoppedAt;
    setElapsed(stoppedAt);
    setPhase('stopped');
  };

  const skip = (seconds: number) => {
    clock.current.baseSeconds += seconds;
    setElapsed((value) => value + seconds);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Atalhos da demonstração">
        <button type="button" onClick={() => skip(30)} className={buttonClass}>+30 s</button>
        <button type="button" onClick={() => skip(60)} className={buttonClass}>+60 s</button>
        <button type="button" onClick={reset} className={buttonClass}>Reiniciar</button>
        <span className="text-[10px] font-semibold text-muted">Demonstração: nada é gravado.</span>
      </div>

      <SheetView
        structure={structure}
        events={events}
        phase={phase}
        elapsedSeconds={elapsed}
        context={context}
        onEvent={(event) => setEvents((current) => [...current, event])}
        onStart={start}
        onStop={stop}
      />

      {showLog && (
        <details className="rounded-xl border border-card-border p-3 text-xs text-muted">
          <summary className="cursor-pointer font-bold text-foreground">Log de eventos ({events.length})</summary>
          <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap font-mono text-[11px]">{JSON.stringify(events, null, 1)}</pre>
        </details>
      )}
    </div>
  );
}
