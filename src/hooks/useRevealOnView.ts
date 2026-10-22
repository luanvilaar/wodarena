import { useEffect, useRef, useState } from 'react';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { EVENT_CARD_MOTION } from '@/lib/eventCardMotion';

// pending: ainda fora da tela, escondido; run: entrou na tela, a animação roda;
// done: pronto, sem animação (já visto, movimento reduzido ou sem suporte).
export type RevealPhase = 'pending' | 'run' | 'done';

// Ids já revelados nesta navegação: trocar o filtro, voltar de outra página ou
// remontar o card não repete a entrada de quem o visitante já viu.
const revealedIds = new Set<string>();

export function useRevealOnView<T extends Element>(id: string) {
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const ref = useRef<T | null>(null);
  const [phase, setPhase] = useState<RevealPhase>(() => (revealedIds.has(id) ? 'done' : 'pending'));
  const canObserve = typeof IntersectionObserver !== 'undefined';
  const skipMotion = prefersReducedMotion || !canObserve;

  useEffect(() => {
    const node = ref.current;
    if (phase !== 'pending' || skipMotion || !node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        revealedIds.add(id);
        setPhase('run');
      },
      { rootMargin: EVENT_CARD_MOTION.revealRootMargin, threshold: 0 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [id, phase, skipMotion]);

  return { ref, phase: skipMotion ? ('done' as const) : phase };
}
