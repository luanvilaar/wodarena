'use client';

import React, { useEffect, useRef } from 'react';
import { Check, X } from 'lucide-react';

// Folha de filtros da home (Story 1.133, P3 de docs/design/mobile-competitivo/):
// sobe do rodapé no celular e vira janela no computador. Hoje filtra por
// estado (UF); a busca e os chips ficam na própria lista.
type HomeFilterSheetProps = {
  open: boolean;
  ufs: string[];
  selectedUf: string | null;
  labels: { title: string; state: string; allStates: string; apply: string; close: string; clear: string };
  onSelectUf: (uf: string | null) => void;
  onClear: () => void;
  onClose: () => void;
};

export function HomeFilterSheet({ open, ufs, selectedUf, labels, onSelectUf, onClear, onClose }: HomeFilterSheetProps) {
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

  const option = (value: string | null, text: string) => {
    const selected = selectedUf === value;
    return (
      <button
        key={value ?? 'all'}
        type="button"
        aria-pressed={selected}
        onClick={() => onSelectUf(value)}
        className={`flex min-h-11 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-semibold transition-colors ${
          selected ? 'border-primary bg-primary text-ink' : 'border-card-border text-foreground hover:border-muted'
        }`}
      >
        {selected && <Check className="h-4 w-4" aria-hidden="true" />}
        {text}
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-6">
      <div className="fixed inset-0 bg-black/80" aria-hidden="true" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="home-filter-title"
        className="relative flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-card-border bg-card sm:max-w-lg sm:rounded-2xl"
      >
        <div className="flex items-center justify-between gap-4 border-b border-card-border px-5 py-4">
          <h2 id="home-filter-title" className="type-display text-xl text-white">{labels.title}</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={labels.close}
            className="flex h-11 w-11 items-center justify-center rounded-md border border-card-border text-white transition-colors hover:border-primary"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-5">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted">{labels.state}</h3>
          <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-5">
            <div className="col-span-4 sm:col-span-5">{option(null, labels.allStates)}</div>
            {ufs.map((uf) => option(uf, uf))}
          </div>
        </div>

        <div className="flex gap-3 border-t border-card-border px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={onClear}
            className="min-h-12 flex-1 rounded-md border border-card-border text-sm font-bold text-white transition-colors hover:border-primary"
          >
            {labels.clear}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-12 flex-1 rounded-md bg-primary text-sm font-bold text-ink transition-colors hover:bg-primary-hover"
          >
            {labels.apply}
          </button>
        </div>
      </div>
    </div>
  );
}
