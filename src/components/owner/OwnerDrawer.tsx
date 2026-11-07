'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

// Painel lateral do proprietário (Story 1.125): detalhe do gestor, cadastro de
// gestor e detalhe do evento. Abre por cima da seção, fecha no X, no fundo escuro
// ou no Esc; o foco vai para o painel ao abrir e volta para quem abriu ao fechar.

type Props = {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  /** Esc e o fundo não fecham enquanto algo grava. */
  busy?: boolean;
};

export function OwnerDrawer({ title, subtitle, onClose, children, busy = false }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);

  useEffect(() => {
    closeRef.current = onClose;
    busyRef.current = busy;
  }, [onClose, busy]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      // Um diálogo de confirmação aberto por cima cuida do próprio Esc.
      if (event.key === 'Escape' && !busyRef.current && !document.querySelector('[role="alertdialog"]')) closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-40" role="presentation">
      <button type="button" aria-label="Fechar painel" tabIndex={-1} onClick={() => !busy && onClose()} className="absolute inset-0 h-full w-full cursor-default bg-black/60" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="owner-drawer-title"
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex w-full max-w-[460px] flex-col border-l border-card-border bg-dark-gray text-white shadow-2xl outline-none"
      >
        <div className="flex items-start justify-between gap-3 border-b border-card-border px-5 py-4">
          <div className="min-w-0">
            <h2 id="owner-drawer-title" className="text-base font-bold">{title}</h2>
            {subtitle && <p className="mt-0.5 truncate text-xs text-muted">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Fechar"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-card-border text-muted transition-colors hover:text-white disabled:opacity-50"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">{children}</div>
      </div>
    </div>
  );
}
