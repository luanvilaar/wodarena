import { useEffect, useRef, useState } from 'react';
import { EVENT_CARD_MOTION, getShineDelayMs } from '@/lib/eventCardMotion';
import type { RevealPhase } from '@/hooks/useRevealOnView';

// Brilho único do Garantir Vaga em tela sem hover. Em celular o card entra bem
// antes de o botão aparecer (o card tem ~600 px), então o brilho só dispara
// quando o botão chega à tela. Devolve o atraso em ms (ou null enquanto não
// disparou); o CSS lê `data-shine` e `--ec-shine-delay` e a animação toca uma vez.
export function useShineOnView<T extends Element>(phase: RevealPhase) {
  const ref = useRef<T | null>(null);
  const [shineDelayMs, setShineDelayMs] = useState<number | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (phase !== 'run' || shineDelayMs !== null || !node || typeof IntersectionObserver === 'undefined') return;

    const revealedAt = performance.now();
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        setShineDelayMs(getShineDelayMs(performance.now() - revealedAt));
      },
      { threshold: EVENT_CARD_MOTION.shine.visibleRatio }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [phase, shineDelayMs]);

  return { ref, shineDelayMs };
}
