'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

import { SheetBuilderForm } from '@/components/admin/SheetBuilderForm';
import { SheetDemo } from '@/components/sheet/SheetDemo';
import { analyzeDraft, type SheetDraft } from '@/lib/workoutStructureEditor';
import type { WorkoutStructure } from '@/lib/workoutStructure';

// Painel largo do construtor da súmula (Story 1.46, desenho aprovado em
// docs/design/sumula-digital/): ocupa a tela inteira por cima da aba Provas,
// com a montagem à esquerda e a súmula do judge à direita, atualizando enquanto
// o gestor edita. Trabalha num rascunho próprio: "Usar esta súmula" entrega a
// estrutura validada ao formulário da prova, que a grava ao salvar; "Cancelar"
// descarta (com confirmação, se houve mudança). Renderizado num portal fora do
// <form> da prova, para Enter nos campos não salvar a prova sem querer.

export type SheetBuilderPanelProps = {
  initialDraft: SheetDraft;
  /** Aviso no topo (ex.: a súmula gravada não cabia em linhas e foi recomeçada). */
  notice?: string | null;
  workoutName?: string;
  idPrefix: string;
  onCancel: () => void;
  onSave: (structure: WorkoutStructure) => void;
};

/** Aviso no lugar da prévia do Intervalado (sai com a Story 1.62). */
export const INTERVAL_PREVIEW_NOTICE = 'A prévia da súmula do Intervalado chega com a próxima etapa.';

const buttonClass = 'flex min-h-11 items-center justify-center gap-2 rounded-md border px-4 text-xs font-bold uppercase tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-40';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function SheetBuilderPanel({ initialDraft, notice, workoutName, idPrefix, onCancel, onSave }: SheetBuilderPanelProps) {
  const [draft, setDraft] = useState(initialDraft);
  const [openLines, setOpenLines] = useState<string[]>([]);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const titleId = `${idPrefix}-title`;
  const previewTitleId = useId();

  const analysis = useMemo(() => analyzeDraft(draft), [draft]);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(initialDraft), [draft, initialDraft]);
  const problems = analysis.problems.length;

  // Tela cheia: a página de trás não rola, e o foco começa no painel.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    rootRef.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus();
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const requestClose = () => {
    if (dirty) setConfirmDiscard(true);
    else onCancel();
  };

  const save = () => {
    if (analysis.structure) onSave(analysis.structure);
  };

  // Esc fecha (ou pede confirmação) e o Tab não sai do painel.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (confirmDiscard) setConfirmDiscard(false);
      else requestClose();
      return;
    }
    if (event.key !== 'Tab' || !rootRef.current) return;
    const focusable = [...rootRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-[80] flex flex-col bg-background text-white"
    >
      <header className="border-b border-card-border bg-card px-4 py-3 sm:px-6">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Súmula digital</p>
            <h2 id={titleId} className="truncate text-base font-bold uppercase tracking-wider text-white">
              Construtor da súmula{workoutName ? ` · ${workoutName}` : ''}
            </h2>
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Fechar o construtor da súmula"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-md border border-card-border bg-dark-gray text-white transition-colors hover:border-primary"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-4">
            {notice && (
              <p role="status" className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-xs font-semibold leading-relaxed text-white">
                {notice}
              </p>
            )}
            <SheetBuilderForm
              draft={draft}
              analysis={analysis}
              onChange={setDraft}
              openLines={openLines}
              onToggleLine={(key) => setOpenLines((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]))}
              idPrefix={idPrefix}
            />
          </div>

          {/* No desktop a súmula rola sozinha ao lado da montagem, sem passar da altura da tela. */}
          <aside
            aria-labelledby={previewTitleId}
            className="min-w-0 space-y-3 lg:sticky lg:top-0 lg:max-h-[calc(100dvh-10.5rem)] lg:self-start lg:overflow-y-auto lg:pr-1"
          >
            <div>
              <h3 id={previewTitleId} className="text-xs font-bold uppercase tracking-wider text-white">Como o judge verá</h3>
              <p className="text-[11px] text-muted">Teste à vontade: inicie o relógio, toque e segure. Nada é gravado.</p>
            </div>
            {/* Story 1.61, AUTO-DECISION 1: até a súmula do Intervalado (Story 1.62) existir, a prévia
                não mostra a de For Time no lugar dela. O aviso não bloqueia "Usar esta súmula". */}
            {analysis.format === 'interval' ? (
              <p role="status" className="rounded-2xl border border-dashed border-card-border px-4 py-8 text-center text-xs text-muted">
                {INTERVAL_PREVIEW_NOTICE}
              </p>
            ) : analysis.structure ? (
              <div className="rounded-2xl border border-card-border bg-background p-3">
                <SheetDemo
                  key={JSON.stringify(analysis.structure)}
                  structure={analysis.structure}
                  context={{ workoutName: workoutName || 'Prévia', athleteName: 'Atleta de exemplo', laneLabel: 'Lane 1' }}
                />
              </div>
            ) : (
              <p className="rounded-2xl border border-dashed border-card-border px-4 py-8 text-center text-xs text-muted">
                Corrija os itens marcados com ! para ver a súmula.
              </p>
            )}
          </aside>
        </div>
      </div>

      <footer className="border-t border-card-border bg-card px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
        {confirmDiscard ? (
          <div role="alert" className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold text-white">Descartar as mudanças da súmula?</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setConfirmDiscard(false)} className={`${buttonClass} border-card-border bg-dark-gray text-white hover:border-primary`}>
                Continuar editando
              </button>
              <button type="button" onClick={onCancel} className={`${buttonClass} border-trading-down bg-trading-down/15 text-white hover:bg-trading-down/25`}>
                Descartar
              </button>
            </div>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3">
            <p aria-live="polite" className={`text-xs font-semibold ${problems > 0 ? 'text-trading-down' : 'text-muted'}`}>
              {problems > 0
                ? `${problems} ${problems === 1 ? 'item para corrigir' : 'itens para corrigir'} na regra da prova.`
                : 'Súmula pronta. Ela é gravada quando você salvar a prova.'}
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={requestClose} className={`${buttonClass} border-card-border bg-dark-gray text-white hover:border-primary`}>
                Cancelar
              </button>
              <button
                id={`${idPrefix}-use`}
                type="button"
                onClick={save}
                disabled={!analysis.structure}
                className={`${buttonClass} border-primary bg-primary text-ink hover:bg-primary-hover`}
              >
                Usar esta súmula
              </button>
            </div>
          </div>
        )}
      </footer>
    </div>
  );
}

/** O painel num portal (só no navegador e só aberto). */
export function WorkoutSheetBuilderDialog({ open, ...props }: SheetBuilderPanelProps & { open: boolean }) {
  if (!open || typeof document === 'undefined') return null;
  return createPortal(<SheetBuilderPanel {...props} />, document.body);
}
