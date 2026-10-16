import type { SheetPhase } from '@/components/sheet/SheetView';

// Peças visuais comuns às súmulas do judge (segmentos e carga máxima).

export const PHASE_LABELS: Record<SheetPhase, string> = {
  ready: 'Não iniciada',
  running: 'Em andamento',
  stopped: 'Relógio parado'
};

export const actionButtonClass = 'flex min-h-11 items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40';
export const secondaryButtonClass = `${actionButtonClass} border-card-border bg-dark-gray text-foreground hover:border-primary`;

export function ProgressBar({ percent, tone = 'primary', label }: { percent: number; tone?: 'primary' | 'up'; label?: string }) {
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label={label}
      className="h-1.5 w-full overflow-hidden rounded-full bg-elevated"
    >
      <div
        className={`h-full rounded-full transition-[width] duration-200 motion-reduce:transition-none ${tone === 'up' ? 'bg-trading-up' : 'bg-primary'}`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
