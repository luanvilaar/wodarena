import { useEffect, useState } from 'react';
import { getCountValue, type CountTiming } from '@/lib/eventCardMotion';
import type { RevealPhase } from '@/hooks/useRevealOnView';

// Conta de 0 até `target` enquanto o card está em `run`. Em `pending` mostra 0 (o
// card está escondido, então o visitante já o vê zerado quando ele aparece) e em
// `done` mostra o valor final. Roda uma vez: mudança de `target` depois de
// terminar só troca o valor, sem recontar.
export function useCountUp(target: number, phase: RevealPhase, timing: CountTiming): number {
  const [animated, setAnimated] = useState(0);
  const [finished, setFinished] = useState(false);
  const { delayMs, durationMs } = timing;

  useEffect(() => {
    if (phase !== 'run' || finished) return;

    let frame = 0;
    let startedAt: number | null = null;
    const tick = (now: number) => {
      if (startedAt === null) startedAt = now;
      const value = getCountValue(target, now - startedAt, { delayMs, durationMs });
      setAnimated(value);
      if (value >= target) {
        setFinished(true);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [phase, finished, target, delayMs, durationMs]);

  if (phase === 'done' || finished) return target;
  return phase === 'pending' ? 0 : animated;
}
