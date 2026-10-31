'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';

import { RACE_DECISION_REASON_MIN, formatRaceDuration, isRaceDecisionReasonValid } from '@/lib/racePenaltiesView';

// Modal de decisão do painel Fitness Race (Story 1.98 e correção da largada da
// 1.96): justificativa obrigatória (o servidor confere de novo), prévia do
// tempo oficial antes e depois e, nas ações graves, confirmação explícita
// (`explicitConfirm`). Botões de 44 px no tablet.

export type RaceDecisionResult = { republish?: { ok: boolean; failedRunIds: string[]; warning?: string } } & Record<string, unknown>;

/** POST /api/race-sheets com a ação; erro do servidor vira exceção com a mensagem dele. */
export const postRaceDecision = async (body: Record<string, unknown>): Promise<RaceDecisionResult> => {
  const response = await fetch('/api/race-sheets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a decisão.');
  return data as RaceDecisionResult;
};

export const raceButton = 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-card-border bg-dark-gray px-3 text-xs font-bold uppercase tracking-wider text-white transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-50';
export const raceDangerButton = 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-red-500/60 bg-red-950/30 px-3 text-xs font-bold uppercase tracking-wider text-red-200 transition-colors hover:border-red-400 disabled:cursor-not-allowed disabled:opacity-50';
export const raceInput = 'w-full min-h-11 rounded-md border border-card-border bg-dark-gray px-3 py-2 text-sm text-white placeholder:text-muted focus:border-primary/50 focus:outline-none';

type Props = {
  title: string;
  subtitle?: string;
  children?: ReactNode;
  reasonLabel?: string;
  reasonHelp?: string;
  /** Tempo oficial antes e depois (null = sem tempo oficial). Omitir quando a decisão não mexe no tempo. */
  officialBefore?: number | null;
  officialAfter?: number | null;
  /** Texto da consequência, abaixo da prévia. */
  consequence?: ReactNode;
  confirmText: string;
  danger?: boolean;
  /** Ação grave: exige marcar a confirmação explícita. */
  explicitConfirm?: string;
  /** Validação extra dos campos (mensagem de erro ou ''). */
  validate?: () => string;
  onSubmit: (reason: string) => Promise<void>;
  onClose: () => void;
};

export function RaceDecisionDialog(props: Props) {
  const { title, subtitle, children, reasonLabel = 'Justificativa', reasonHelp = 'Obrigatória. Fica no registro com o antes e o depois.', officialBefore, officialAfter, consequence, confirmText, danger, explicitConfirm, validate, onSubmit, onClose } = props;
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const first = dialogRef.current?.querySelector<HTMLElement>('input, select, textarea');
    first?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const extra = validate?.() ?? '';
    if (extra) return setError(extra);
    if (!isRaceDecisionReasonValid(reason)) return setError(`Escreva o motivo (pelo menos ${RACE_DECISION_REASON_MIN} caracteres).`);
    if (explicitConfirm && !confirmed) return setError('Marque a confirmação para seguir.');
    setBusy(true);
    setError('');
    try {
      await onSubmit(reason.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível concluir a decisão.');
      setBusy(false);
    }
  };

  const showPreview = officialBefore !== undefined || officialAfter !== undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4" role="presentation">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="race-decision-title" className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-xl border border-card-border bg-card p-5 text-white sm:rounded-xl">
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1">
            <h4 id="race-decision-title" className="text-lg font-bold">{title}</h4>
            {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
          </div>
          {children}
          <label className="block space-y-1">
            <span className="text-xs font-bold uppercase tracking-wider">{reasonLabel}</span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              maxLength={1000}
              required
              className={raceInput}
              placeholder="Escreva o motivo"
            />
            <span className="block text-xs text-muted">{reasonHelp}</span>
          </label>
          {showPreview && (
            <p className="rounded-md border border-card-border bg-dark-gray px-3 py-2 text-sm" aria-live="polite">
              Tempo oficial: <span className="font-bold tabular-nums">{formatRaceDuration(officialBefore ?? null)}</span>
              {' → '}
              <span className="font-bold tabular-nums">{formatRaceDuration(officialAfter ?? null)}</span>
            </p>
          )}
          {consequence && <div className="text-sm text-muted">{consequence}</div>}
          {explicitConfirm && (
            <label className="flex min-h-11 items-center gap-3 rounded-md border border-red-500/40 bg-red-950/20 px-3 text-sm">
              <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="h-5 w-5" />
              {explicitConfirm}
            </label>
          )}
          {error && <p role="alert" className="rounded-md border border-red-500/40 bg-red-950/20 px-3 py-2 text-sm">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={raceButton} onClick={onClose} disabled={busy}>Cancelar</button>
            <button type="submit" className={danger ? raceDangerButton : `${raceButton} border-primary/60 text-primary`} disabled={busy}>
              {busy ? 'Gravando…' : confirmText}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
