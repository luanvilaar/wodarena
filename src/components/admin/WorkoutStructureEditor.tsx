'use client';

import { useId, useRef, useState } from 'react';
import { ClipboardList, Pencil, Trash2 } from 'lucide-react';

import { WorkoutSheetBuilderDialog } from '@/components/admin/WorkoutSheetBuilderDialog';
import {
  createDraft,
  describeStructureRule,
  draftFromStructure,
  summarizeStructure,
  type SheetDraft
} from '@/lib/workoutStructureEditor';
import type { WorkoutStructure, WorkoutStructureFormat } from '@/lib/workoutStructure';

// Súmula digital no formulário da prova (Stories 1.45 e 1.46). Controlado:
// quem usa guarda a estrutura (`value`, null = prova só com texto) e recebe
// cada mudança em `onChange`. No formulário fica só o resumo; a montagem
// acontece no construtor em tela cheia (WorkoutSheetBuilderDialog), com a
// súmula do judge ao lado. O servidor valida tudo de novo antes de gravar.

type WorkoutStructureEditorProps = {
  value: WorkoutStructure | null;
  onChange: (next: WorkoutStructure | null) => void;
  /** Formato sugerido ao estruturar (vem do tipo de score da prova). */
  defaultFormat?: WorkoutStructureFormat;
  /** Nome da prova, mostrado no construtor e na súmula. */
  workoutName?: string;
  /** Time cap já digitado no formulário; vira o inicial do construtor. */
  timeCapHint?: string;
  /** Prefixo dos ids, para o editor poder aparecer em mais de um lugar. */
  idPrefix?: string;
  /** Súmulas já abertas desta prova (Story 1.52): com alguma, a estrutura fica travada. */
  lockedSheets?: number;
};

const buttonClass = 'flex min-h-10 items-center justify-center gap-1.5 rounded-md border px-3 text-xs font-bold uppercase tracking-wider transition-colors';

type Session = { draft: SheetDraft; notice: string | null; key: number };

export function WorkoutStructureEditor({
  value,
  onChange,
  defaultFormat = 'for_time',
  workoutName,
  timeCapHint,
  idPrefix,
  lockedSheets = 0
}: WorkoutStructureEditorProps) {
  const autoId = useId();
  const prefix = idPrefix ?? `wse-${autoId.replace(/[^a-zA-Z0-9]/g, '')}`;
  const [session, setSession] = useState<Session | null>(null);
  const openButton = useRef<HTMLButtonElement>(null);

  const open = () => {
    const loaded = value ? draftFromStructure(value) : null;
    setSession({
      draft: loaded?.ok ? loaded.draft : createDraft(value?.format ?? defaultFormat, { timeCap: timeCapHint }),
      notice: loaded && !loaded.ok ? `${loaded.error} Monte de novo em linhas; a súmula gravada só muda quando você usar a nova e salvar a prova.` : null,
      key: Date.now()
    });
  };

  const close = () => {
    setSession(null);
    // Devolve o foco ao botão que abriu o construtor.
    requestAnimationFrame(() => openButton.current?.focus());
  };

  return (
    <fieldset className="space-y-3 rounded-md border border-primary/30 bg-primary/5 p-3">
      <legend className="px-1 text-[10px] font-bold uppercase tracking-wider text-primary">Súmula digital</legend>

      {value ? (
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-sm font-bold text-white">
            <ClipboardList className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            {summarizeStructure(value)}
          </p>
          <p className="text-[11px] leading-relaxed text-muted">
            {describeStructureRule(value).map((part) => part.text).join('')}
          </p>
        </div>
      ) : (
        <p className="text-[11px] leading-relaxed text-muted">
          Monte a súmula do judge a partir dos movimentos: repetições, movimento e carga, como no quadro do box. O score sai dela; a descrição em texto continua valendo para os atletas.
        </p>
      )}

      {lockedSheets > 0 && (
        <p role="status" className="rounded-md border border-primary/40 bg-dark-gray/60 px-3 py-2 text-[11px] font-semibold leading-relaxed text-white">
          Estrutura travada: {lockedSheets} {lockedSheets === 1 ? 'súmula já foi aberta' : 'súmulas já foram abertas'} na arbitragem. Para mudar, cancele as súmulas na aba Súmulas e Judges.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          ref={openButton}
          id={`${prefix}-open`}
          type="button"
          onClick={open}
          disabled={lockedSheets > 0}
          className={`${buttonClass} border-primary/60 bg-dark-gray text-primary hover:border-primary disabled:cursor-not-allowed disabled:opacity-50`}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          {value ? 'Editar súmula' : 'Estruturar a súmula'}
        </button>
        {value && (
          <button
            id={`${prefix}-remove`}
            type="button"
            onClick={() => onChange(null)}
            disabled={lockedSheets > 0}
            className={`${buttonClass} border-card-border bg-dark-gray text-white hover:border-trading-down disabled:cursor-not-allowed disabled:opacity-50`}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Remover súmula
          </button>
        )}
      </div>

      <WorkoutSheetBuilderDialog
        key={session?.key ?? 'fechado'}
        open={session !== null}
        initialDraft={session?.draft ?? createDraft(defaultFormat)}
        notice={session?.notice ?? null}
        workoutName={workoutName}
        idPrefix={`${prefix}-builder`}
        onCancel={close}
        onSave={(structure) => {
          onChange(structure);
          close();
        }}
      />
    </fieldset>
  );
}
