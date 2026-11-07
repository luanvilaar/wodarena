'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

// Confirmação das ações do proprietário que mudam a plataforma ou bloqueiam um
// gestor na hora (Story 1.121, docs/design/painel-proprietario/): o texto diz o
// efeito numa frase, o foco abre em "Cancelar" e o Esc fecha. Enquanto a ação
// grava, os botões travam; um erro do servidor aparece aqui, em vermelho.

type Props = {
  title: string;
  children: ReactNode;
  confirmText: string;
  danger?: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
};

const buttonBase = 'inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-xs font-bold uppercase tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-60';

export function OwnerConfirmDialog({ title, children, confirmText, danger, onConfirm, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cancelRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);

  useEffect(() => {
    closeRef.current = onClose;
    busyRef.current = busy;
  }, [onClose, busy]);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      await onConfirm();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível concluir a ação.');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4" role="presentation">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="owner-confirm-title"
        aria-describedby="owner-confirm-body"
        className="w-full max-w-md space-y-4 rounded-t-xl border border-card-border bg-card p-5 text-white sm:rounded-xl"
      >
        <h4 id="owner-confirm-title" className="text-lg font-bold">{title}</h4>
        <div id="owner-confirm-body" className="space-y-2 text-sm text-muted">{children}</div>
        {error && <p role="alert" className="rounded-md border border-red-500/40 bg-red-950/20 px-3 py-2 text-sm text-red-200">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button ref={cancelRef} type="button" onClick={onClose} disabled={busy} className={`${buttonBase} border-card-border bg-dark-gray text-white hover:border-primary/50`}>
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={busy}
            className={danger
              ? `${buttonBase} border-red-500/60 bg-red-950/30 text-red-200 hover:border-red-400`
              : `${buttonBase} border-primary bg-primary text-black hover:bg-primary-hover`}
          >
            {busy ? 'Salvando…' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
