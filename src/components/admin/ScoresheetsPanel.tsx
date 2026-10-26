'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { History, RotateCcw, Trash2, UserPlus, Wrench } from 'lucide-react';

import { useApp } from '@/context/AppContext';
import { SCORESHEET_REVIEW_LABELS, SCORESHEET_STATUS_LABELS, type ScoresheetReviewAction, type ScoresheetStatus } from '@/lib/scoresheet';
import type { Event, Score } from '@/types';

// Aba "Súmulas" do evento presencial (Stories 1.49 e 1.51): os judges do
// evento (criar, remover) e as súmulas da arbitragem. A súmula enviada já está
// publicada (decisão 3 da E3); o gestor corrige o resultado (com
// justificativa), devolve ao judge ou cancela, e vê o histórico. Depois de cada
// ação, os scores das provas com súmula são trocados pelos do servidor.

const REFRESH_MS = 20_000;

type JudgeRow = { id: string; name: string; email: string };
type SheetRow = {
  id: string;
  workoutId: string;
  athleteId: string;
  athleteName: string;
  box: string;
  heatNumber: number | null;
  lane: number | null;
  judgeName: string;
  status: ScoresheetStatus;
  officialResult: string | null;
  officialTieBreak: string | null;
  corrected: boolean;
  returnReason: string | null;
  updatedAt: string;
};
type ReviewRow = {
  id: string;
  action: ScoresheetReviewAction;
  actorName: string;
  reason: string | null;
  previousResult: string | null;
  appliedResult: string | null;
  appliedTieBreak: string | null;
  createdAt: string;
};
type ScoreRow = { athleteId: string; workoutId: string; result: string; value: number; rank?: number; points?: number; splits?: Record<string, string> };
type Mode = { sheetId: string; kind: 'correct' | 'return' | 'cancel' | 'history' } | null;

const adminAction = async (action: string, payload: Record<string, unknown>) => {
  const response = await fetch('/api/admin/persistence', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, payload })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a operação.');
  return data;
};

const sheetsRequest = async (body: Record<string, unknown>) => {
  const response = await fetch('/api/sheets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a operação.');
  return data;
};

const inputClass = 'w-full rounded-md border border-card-border bg-dark-gray px-3 py-2 text-sm text-white placeholder:text-muted focus:border-primary/50 focus:outline-none';
const smallButton = 'inline-flex min-h-9 items-center gap-1.5 rounded-md border border-card-border bg-dark-gray px-2.5 text-[11px] font-bold uppercase tracking-wider text-white transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-50';

const STATUS_CHIP: Record<ScoresheetStatus, string> = {
  in_progress: 'border-primary/60 text-primary',
  submitted: 'border-trading-up/60 text-trading-up',
  returned: 'border-trading-down/60 text-trading-down',
  cancelled: 'border-card-border text-muted'
};

const RESULT_HINT: Record<string, string> = { fortime: 'Tempo (MM:SS)', amrap: 'Total de repetições', maxweight: 'Carga em kg', reps: 'Repetições', distance: 'Distância em metros', tonnage: 'Tonelagem em kg (ex.: 830 ou 1.652,5)' };

const formatWhen = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

export function ScoresheetsPanel({ event }: { event: Event }) {
  const { replaceWorkoutScores } = useApp();
  const [judges, setJudges] = useState<JudgeRow[]>([]);
  const [sheets, setSheets] = useState<SheetRow[] | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>(null);
  const [form, setForm] = useState({ result: '', tieBreak: '', reason: '', acknowledged: false });
  const [history, setHistory] = useState<ReviewRow[]>([]);
  const [judgeForm, setJudgeForm] = useState({ name: '', email: '', password: '' });

  const workouts = useMemo(() => event.workouts.filter((workout) => workout.structure), [event.workouts]);

  const load = useCallback(async () => {
    const [judgesResult, manageResponse] = await Promise.all([
      adminAction('listJudges', { eventId: event.id }),
      fetch(`/api/sheets?view=manage&eventId=${encodeURIComponent(event.id)}`)
    ]);
    const manage = await manageResponse.json().catch(() => ({}));
    if (!manageResponse.ok) throw new Error(manage.error || 'Erro ao carregar as súmulas.');
    setJudges(judgesResult.judges || []);
    setSheets(manage.sheets || []);
    for (const [workoutId, scores] of Object.entries((manage.scores || {}) as Record<string, ScoreRow[]>)) {
      replaceWorkoutScores(workoutId, scores as Score[]);
    }
  }, [event.id, replaceWorkoutScores]);

  useEffect(() => {
    const refresh = () => void load().catch((error) => setNotice(error instanceof Error ? error.message : 'Erro ao carregar as súmulas.'));
    const first = window.setTimeout(refresh, 0);
    const interval = window.setInterval(refresh, REFRESH_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, [load]);

  const startMode = async (sheet: SheetRow, kind: NonNullable<Mode>['kind']) => {
    if (mode?.sheetId === sheet.id && mode.kind === kind) {
      setMode(null);
      return;
    }
    setForm({ result: kind === 'correct' ? sheet.officialResult || '' : '', tieBreak: kind === 'correct' ? sheet.officialTieBreak || '' : '', reason: '', acknowledged: false });
    setMode({ sheetId: sheet.id, kind });
    if (kind === 'history') {
      setHistory([]);
      try {
        const response = await fetch(`/api/sheets?view=sheet&sheetId=${encodeURIComponent(sheet.id)}`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Erro ao carregar o histórico.');
        setHistory(data.reviews || []);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : 'Erro ao carregar o histórico.');
      }
    }
  };

  const submitReview = async (formEvent: FormEvent, sheet: SheetRow) => {
    formEvent.preventDefault();
    if (!mode) return;
    setBusy(true);
    setNotice('');
    try {
      await sheetsRequest({
        action: 'review',
        sheetId: sheet.id,
        review: mode.kind,
        reason: form.reason,
        ...(mode.kind === 'correct' ? { result: form.result, tieBreak: form.tieBreak } : {})
      });
      setNotice(mode.kind === 'correct' ? `Resultado de ${sheet.athleteName} corrigido e publicado.` : mode.kind === 'return' ? `Súmula de ${sheet.athleteName} devolvida ao judge.` : `Súmula de ${sheet.athleteName} cancelada.`);
      setMode(null);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Não foi possível concluir a operação.');
    } finally {
      setBusy(false);
    }
  };

  const createJudge = async (formEvent: FormEvent) => {
    formEvent.preventDefault();
    setBusy(true);
    setNotice('');
    try {
      await adminAction('createJudge', { eventId: event.id, ...judgeForm });
      setJudgeForm({ name: '', email: '', password: '' });
      setNotice('Judge criado e atribuído ao evento. Ele entra pelo login e abre a área "Quadra".');
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Erro ao criar o judge.');
    } finally {
      setBusy(false);
    }
  };

  const removeJudge = async (judge: JudgeRow) => {
    if (!window.confirm(`Remover ${judge.name} deste evento? As súmulas que ele já abriu ficam com o nome dele.`)) return;
    try {
      await adminAction('removeJudgeFromEvent', { eventId: event.id, judgeId: judge.id });
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Erro ao remover o judge.');
    }
  };

  const renderForm = (sheet: SheetRow, workoutType: string) => {
    if (!mode || mode.sheetId !== sheet.id) return null;
    if (mode.kind === 'history') {
      return (
        <ol className="space-y-1.5 border-t border-card-border pt-3 text-xs" aria-label={`Histórico da súmula de ${sheet.athleteName}`}>
          {history.length === 0 ? <li className="text-muted">Carregando…</li> : history.map((review) => (
            <li key={review.id} className="flex flex-wrap gap-x-2">
              <span className="font-number text-muted">{formatWhen(review.createdAt)}</span>
              <span className="font-bold text-white">{SCORESHEET_REVIEW_LABELS[review.action] ?? review.action}</span>
              <span className="text-muted">por {review.actorName}</span>
              {review.appliedResult && <span className="font-number text-white">{review.previousResult ? `${review.previousResult} → ` : ''}{review.appliedResult}{review.appliedTieBreak ? ` (tb ${review.appliedTieBreak})` : ''}</span>}
              {review.reason && <span className="w-full text-muted">“{review.reason}”</span>}
            </li>
          ))}
        </ol>
      );
    }
    const id = `${sheet.id}-${mode.kind}`;
    return (
      <form onSubmit={(formEvent) => void submitReview(formEvent, sheet)} className="space-y-3 border-t border-card-border pt-3">
        {mode.kind === 'correct' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`${id}-result`} className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">{RESULT_HINT[workoutType] ?? 'Resultado'}</label>
              <input id={`${id}-result`} required value={form.result} onChange={(e) => setForm({ ...form, result: e.target.value })} className={`${inputClass} font-number`} />
            </div>
            <div>
              <label htmlFor={`${id}-tiebreak`} className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">Tie-break (MM:SS, opcional)</label>
              <input id={`${id}-tiebreak`} value={form.tieBreak} onChange={(e) => setForm({ ...form, tieBreak: e.target.value })} className={`${inputClass} font-number`} />
            </div>
          </div>
        )}
        <div>
          <label htmlFor={`${id}-reason`} className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
            {mode.kind === 'correct' ? 'Justificativa (fica no histórico)' : mode.kind === 'return' ? 'Motivo para o judge' : 'Motivo do cancelamento'}
          </label>
          <input id={`${id}-reason`} required minLength={3} maxLength={500} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className={inputClass} />
        </div>
        {mode.kind === 'cancel' && (
          <label className="flex items-start gap-2 text-xs text-white">
            <input type="checkbox" checked={form.acknowledged} onChange={(e) => setForm({ ...form, acknowledged: e.target.checked })} className="mt-0.5 accent-primary" />
            Entendo que o resultado desta súmula sai do ranking e que outra súmula poderá ser aberta para o atleta.
          </label>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={busy || (mode.kind === 'cancel' && !form.acknowledged)} className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-xs font-bold uppercase tracking-wider text-ink disabled:opacity-50">
            {mode.kind === 'correct' ? 'Publicar correção' : mode.kind === 'return' ? 'Devolver ao judge' : 'Cancelar súmula'}
          </button>
          <button type="button" onClick={() => setMode(null)} className={smallButton}>Fechar</button>
        </div>
      </form>
    );
  };

  return (
    <div className="space-y-6 text-white">
      {notice && <p role="status" aria-live="polite" className="rounded-md border border-card-border bg-dark-gray/40 px-3 py-2 text-xs text-white">{notice}</p>}

      <section className="space-y-4 rounded-xl border border-card-border bg-card p-5" aria-labelledby="sheets-title">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Arbitragem na quadra</p>
            <h3 id="sheets-title" className="mt-1 text-lg font-bold uppercase">Súmulas</h3>
          </div>
          <p className="text-[11px] text-muted">A súmula enviada já está no ranking. Corrigir, devolver e cancelar ficam no histórico.</p>
        </div>
        {workouts.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma prova com súmula digital. Estruture a súmula na aba Provas.</p>
        ) : sheets === null ? (
          <p className="text-sm text-muted" role="status">Carregando súmulas…</p>
        ) : (
          workouts.map((workout) => {
            const rows = sheets.filter((sheet) => sheet.workoutId === workout.id);
            return (
              <div key={workout.id} className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-white">{workout.code ? `${workout.code} · ` : ''}{workout.name} <span className="font-normal text-muted">({rows.filter((row) => row.status !== 'cancelled').length} {rows.length === 1 ? 'súmula' : 'súmulas'})</span></h4>
                {rows.length === 0 ? (
                  <p className="text-xs text-muted">Nenhuma súmula aberta ainda.</p>
                ) : (
                  <ul className="space-y-2">
                    {rows.map((sheet) => (
                      <li key={sheet.id} className={`space-y-2 rounded-lg border border-card-border bg-dark-gray/30 p-3 ${sheet.status === 'cancelled' ? 'opacity-60' : ''}`}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold">
                              {sheet.heatNumber || sheet.lane ? <span className="mr-2 font-number text-muted">{sheet.heatNumber ? `B${sheet.heatNumber}` : ''}{sheet.lane ? ` R${sheet.lane}` : ''}</span> : null}
                              {sheet.athleteName}
                              <span className="ml-1.5 text-xs font-normal text-muted">{sheet.box}</span>
                            </p>
                            <p className="text-xs text-muted">
                              {sheet.judgeName} · {formatWhen(sheet.updatedAt)}
                              {sheet.status === 'returned' && sheet.returnReason ? ` · “${sheet.returnReason}”` : ''}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {sheet.officialResult && (
                              <span className="font-number text-sm font-bold">
                                {sheet.officialResult}{sheet.officialTieBreak ? <span className="ml-1 text-xs text-muted">tb {sheet.officialTieBreak}</span> : null}
                                {sheet.corrected && <span className="ml-1.5 rounded border border-primary/50 px-1 text-[10px] uppercase text-primary">corrigido</span>}
                              </span>
                            )}
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${STATUS_CHIP[sheet.status]}`}>{SCORESHEET_STATUS_LABELS[sheet.status]}</span>
                          </div>
                        </div>
                        {sheet.status !== 'cancelled' && (
                          <div className="flex flex-wrap gap-2">
                            {(sheet.status === 'submitted' || sheet.status === 'returned') && (
                              <button type="button" onClick={() => void startMode(sheet, 'correct')} aria-expanded={mode?.sheetId === sheet.id && mode.kind === 'correct'} className={smallButton}>
                                <Wrench className="h-3.5 w-3.5" aria-hidden="true" />Corrigir
                              </button>
                            )}
                            {sheet.status === 'submitted' && (
                              <button type="button" onClick={() => void startMode(sheet, 'return')} aria-expanded={mode?.sheetId === sheet.id && mode.kind === 'return'} className={smallButton}>
                                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />Devolver
                              </button>
                            )}
                            <button type="button" onClick={() => void startMode(sheet, 'cancel')} aria-expanded={mode?.sheetId === sheet.id && mode.kind === 'cancel'} className={smallButton}>
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />Cancelar
                            </button>
                            <button type="button" onClick={() => void startMode(sheet, 'history')} aria-expanded={mode?.sheetId === sheet.id && mode.kind === 'history'} className={smallButton}>
                              <History className="h-3.5 w-3.5" aria-hidden="true" />Histórico
                            </button>
                          </div>
                        )}
                        {sheet.status === 'cancelled' && (
                          <button type="button" onClick={() => void startMode(sheet, 'history')} className={smallButton}>
                            <History className="h-3.5 w-3.5" aria-hidden="true" />Histórico
                          </button>
                        )}
                        {renderForm(sheet, workout.type)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })
        )}
      </section>

      <section className="space-y-4 rounded-xl border border-card-border bg-card p-5" aria-labelledby="judges-title">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Equipe de arbitragem</p>
          <h3 id="judges-title" className="mt-1 text-lg font-bold uppercase">Judges do evento</h3>
          <p className="mt-1 text-xs text-muted">O judge entra com este e-mail e senha, abre a área &quot;Quadra&quot; no celular e escolhe a bateria e a raia.</p>
        </div>
        <form onSubmit={(formEvent) => void createJudge(formEvent)} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="sr-only" htmlFor="sheet-judge-name">Nome do judge</label>
          <input id="sheet-judge-name" required minLength={3} value={judgeForm.name} onChange={(e) => setJudgeForm({ ...judgeForm, name: e.target.value })} placeholder="Nome do judge" className={inputClass} />
          <label className="sr-only" htmlFor="sheet-judge-email">E-mail</label>
          <input id="sheet-judge-email" required type="email" value={judgeForm.email} onChange={(e) => setJudgeForm({ ...judgeForm, email: e.target.value })} placeholder="E-mail" className={inputClass} />
          <label className="sr-only" htmlFor="sheet-judge-password">Senha inicial</label>
          <input id="sheet-judge-password" required minLength={8} type="password" autoComplete="new-password" value={judgeForm.password} onChange={(e) => setJudgeForm({ ...judgeForm, password: e.target.value })} placeholder="Senha inicial (mín. 8)" className={inputClass} />
          <button type="submit" disabled={busy} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-xs font-bold uppercase tracking-wider text-ink disabled:opacity-60">
            <UserPlus className="h-4 w-4" aria-hidden="true" />{busy ? 'Criando…' : 'Criar judge'}
          </button>
        </form>
        <ul className="space-y-2">
          {judges.length === 0 ? <li className="text-sm text-muted">Nenhum judge atribuído.</li> : judges.map((judge) => (
            <li key={judge.id} className="flex items-center justify-between gap-3 rounded-md border border-card-border bg-dark-gray/30 p-3">
              <div className="min-w-0"><p className="truncate text-sm font-bold">{judge.name}</p><p className="truncate text-xs text-muted">{judge.email}</p></div>
              <button type="button" onClick={() => void removeJudge(judge)} className="min-h-9 text-xs font-bold uppercase tracking-wider text-trading-down hover:underline">Remover</button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
