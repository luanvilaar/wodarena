'use client';

import React, { useEffect, useRef } from 'react';
import { Download, ExternalLink, X } from 'lucide-react';

// Regulamento do evento (Story 1.131, P5 de docs/design/mobile-competitivo/):
// folha que sobe do rodapé no celular e janela centrada no computador. Fecha
// pelo botão, pela tecla Esc ou tocando fora; o foco volta para quem abriu.
// Story 1.150 (docs/design/regulamento-patrocinadores/, D1 e D2): com PDF, a
// folha mostra o arquivo com "Abrir PDF" (nova aba, leitor do próprio aparelho)
// e "Baixar"; o texto do gestor vem embaixo, como resumo.
export type RulesSheetDocument = {
  url: string;
  downloadUrl: string;
  name: string;
  detail: string;
};

type EventRulesSheetProps = {
  open: boolean;
  title: string;
  eventName: string;
  rules: string;
  document?: RulesSheetDocument | null;
  labels?: { pdf: string; open: string; download: string; summary: string };
  closeLabel: string;
  onClose: () => void;
};

export function EventRulesSheet({ open, title, eventName, rules, document: pdf = null, labels, closeLabel, onClose }: EventRulesSheetProps) {
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
        <div className="space-y-5 overflow-y-auto px-5 py-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
          {pdf && (
            <section aria-label={labels?.pdf} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-xl border border-card-border bg-dark-gray p-4">
              <span className="flex h-12 w-10 items-center justify-center rounded-md border border-trading-down/60 bg-trading-down/10 font-number text-[10px] font-bold text-trading-down" aria-hidden="true">PDF</span>
              <div className="min-w-0">
                <p className="break-words text-sm font-bold text-white">{pdf.name}</p>
                <p className="text-xs text-muted">{pdf.detail}</p>
              </div>
              <div className="col-span-2 grid grid-cols-2 gap-2">
                <a
                  href={pdf.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-bold text-ink transition-colors hover:bg-primary-hover"
                >
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  {labels?.open}
                </a>
                <a
                  href={pdf.downloadUrl}
                  rel="noopener noreferrer"
                  className="flex min-h-11 items-center justify-center gap-2 rounded-md border border-card-border px-4 text-sm font-bold text-white transition-colors hover:border-primary"
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  {labels?.download}
                </a>
              </div>
            </section>
          )}
          {rules && (
            <div className={pdf ? 'border-t border-card-border pt-5' : ''}>
              {pdf && <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">{labels?.summary}</h3>}
              <p className="whitespace-pre-wrap text-[15px] leading-7 text-foreground">{rules}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
