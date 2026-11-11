'use client';

import React from 'react';
import { ArrowRight, CalendarClock, Trophy } from 'lucide-react';
import { Link } from '@/i18n/navigation';

// Barra fixa de inscrição da página do evento (Story 1.131, P5 de
// docs/design/mobile-competitivo/). Abaixo de 768 px fica logo acima da
// navegação do rodapé (Story 1.129); de 768 a 1023 px, no rodapé da tela; a
// partir de 1024 px some e o card lateral faz o papel dela.
type EventBuyBarProps =
  | {
      mode: 'register';
      fromLabel: string;
      priceLabel: string;
      unitLabel: string | null;
      ctaLabel: string;
      onRegister: () => void;
    }
  | { mode: 'schedule'; notice: string; ctaLabel: string; onSchedule: () => void }
  | { mode: 'results'; notice: string; ctaLabel: string; href: string };

const ctaClass =
  'flex min-h-12 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-5 text-sm font-bold uppercase tracking-wider transition-colors';

export function EventBuyBar(props: EventBuyBarProps) {
  return (
    <>
      {/* Reserva o espaço da barra no fim da página. */}
      <div aria-hidden="true" className="h-[4.75rem] lg:hidden" />
      <div className="fixed inset-x-0 bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-30 border-t border-card-border bg-card md:bottom-0 md:pb-[env(safe-area-inset-bottom)] lg:hidden">
        <div className="mx-auto flex min-h-[4.75rem] max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          {props.mode === 'register' ? (
            <>
              <p className="min-w-0 leading-tight">
                <span className="block text-xs font-semibold text-muted">{props.fromLabel}</span>
                <span className="font-number text-xl font-bold text-white tabular-nums">{props.priceLabel}</span>
                {props.unitLabel && <span className="text-xs font-semibold text-muted"> {props.unitLabel}</span>}
              </p>
              <button
                type="button"
                onClick={props.onRegister}
                className={`${ctaClass} bg-primary text-ink hover:bg-primary-hover active:bg-primary-hover`}
              >
                {props.ctaLabel}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </>
          ) : (
            <>
              <p className="min-w-0 text-sm font-semibold leading-snug text-foreground">{props.notice}</p>
              {props.mode === 'schedule' ? (
                <button
                  type="button"
                  onClick={props.onSchedule}
                  className={`${ctaClass} border border-primary/55 bg-dark-gray text-primary hover:border-primary`}
                >
                  <CalendarClock className="h-4 w-4" aria-hidden="true" />
                  {props.ctaLabel}
                </button>
              ) : (
                <Link href={props.href} className={`${ctaClass} border border-primary/55 bg-dark-gray text-primary hover:border-primary`}>
                  <Trophy className="h-4 w-4" aria-hidden="true" />
                  {props.ctaLabel}
                </Link>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
