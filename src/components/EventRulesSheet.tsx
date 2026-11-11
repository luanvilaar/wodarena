'use client';

import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

// Regulamento do evento (Story 1.131, P5 de docs/design/mobile-competitivo/):
// folha que sobe do rodapé no celular e janela centrada no computador. Fecha
// pelo botão, pela tecla Esc ou tocando fora; o foco volta para quem abriu.
type EventRulesSheetProps = {
  open: boolean;
  title: string;
  eventName: string;
  rules: string;
  closeLabel: string;
  onClose: () => void;
};

export function EventRulesSheet({ open, title, eventName, rules, closeLabel, onClose }: EventRulesSheetProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      opener?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-6">
      <div className="fixed inset-0 bg-black/80" aria-hidden="true" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-rules-title"
        className="relative flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-card-border bg-card sm:max-w-2xl sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-card-border px-5 py-4">
          <div className="min-w-0">
            <h2 id="event-rules-title" className="type-display text-xl text-white">{title}</h2>
            <p className="mt-1 truncate text-sm text-muted">{eventName}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-card-border text-white transition-colors hover:border-primary"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
          <p className="whitespace-pre-wrap text-[15px] leading-7 text-foreground">{rules}</p>
        </div>
      </div>
    </div>
  );
}
