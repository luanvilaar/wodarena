'use client';

import React, { useEffect, useRef, useState } from 'react';

const SHOW_DELAY_MS = 150;
const MIN_VISIBLE_MS = 400;
const FADE_MS = 300;

type Phase = 'hidden' | 'visible' | 'fading';

/**
 * Splash de boot: some sem aparecer em cargas quase instantâneas (SHOW_DELAY_MS)
 * e, uma vez visível, permanece por um tempo mínimo (MIN_VISIBLE_MS) antes do
 * fade-out, para não piscar em telas que carregam rápido demais.
 */
export function SplashScreen({ active }: { active: boolean }) {
  const [phase, setPhase] = useState<Phase>('hidden');
  const shownAtRef = useRef<number | null>(null);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    if (active) {
      timers.push(setTimeout(() => {
        shownAtRef.current = Date.now();
        setPhase('visible');
      }, SHOW_DELAY_MS));
    } else if (shownAtRef.current !== null) {
      const remaining = Math.max(MIN_VISIBLE_MS - (Date.now() - shownAtRef.current), 0);

      timers.push(setTimeout(() => {
        setPhase('fading');
        timers.push(setTimeout(() => {
          setPhase('hidden');
          shownAtRef.current = null;
        }, FADE_MS));
      }, remaining));
    }

    return () => timers.forEach(clearTimeout);
  }, [active]);

  if (phase === 'hidden') return null;

  const visible = phase === 'visible';

  return (
    <div
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-8 bg-background transition-opacity duration-300 ease-out ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
      role="status"
      aria-live="polite"
      aria-label="Carregando WODArena"
    >
      <img src="/Ativo3.svg" alt="" aria-hidden="true" className="splash-mark h-20 w-20 sm:h-24 sm:w-24" />

      <div className="w-36 sm:w-40">
        <div className="relative h-[3px] overflow-hidden rounded-full bg-card-border">
          <div
            className="splash-bar-fill absolute inset-y-0 w-2/5 rounded-full"
            style={{
              background: 'linear-gradient(90deg, transparent, var(--primary) 45%, var(--primary-hover) 55%, transparent)',
            }}
            aria-hidden="true"
          />
        </div>
        <p className="mt-2.5 text-center text-[10px] font-bold uppercase tracking-[0.18em] text-muted">
          Carregando
        </p>
      </div>
    </div>
  );
}
