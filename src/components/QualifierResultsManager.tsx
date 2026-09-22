'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Event, ScoreSubmission } from '@/types';
import { getSubmissionWindowState } from '@/lib/submissionWindow';

type ResultRow = {
  id: string;
  workoutId: string;
  athleteName: string;
  athleteBox: string;
  workoutName: string;
  workoutCode: string;
  workoutType: string;
  submittedResult: string;
  finalResult?: string;
  status: ScoreSubmission['status'];
  currentVersion: number;
  // String crua de reviewed_at vinda da API. É o token de concorrência da
  // exclusão para reenvio e deve ser reenviada sem passar por new Date().
  reviewedAt?: string;
  reviewedBy?: string;
  videoUrl: string;
};

type EditDecision = 'validated' | 'penalized' | 'rejected' | 'manual_adjustment';

// pending_review fica de fora: essas submissões são tratadas no QualifierManagerPanel.
const MANAGED_STATUSES: ScoreSubmission['status'][] = ['validated', 'penalized', 'rejected', 'awaiting_resubmission'];
const REVIEWED_STATUSES: ScoreSubmission['status'][] = ['validated', 'penalized', 'rejected'];

const STATUS_LABEL: Record<ScoreSubmission['status'], string> = {
  pending_review: 'Em análise',
  validated: 'Validado',
  penalized: 'Penalizado (-15%)',
  rejected: 'Rejeitado',
  awaiting_resubmission: 'Aguardando reenvio do atleta'
};

const postJson = async (url: string, payload: Record<string, unknown>, fallback: string) => {
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || fallback);
  return data;
};

const formatDateTime = (value?: string) => {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' });
};

export function QualifierResultsManager({ event }: { event: Event }) {
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [decision, setDecision] = useState<EditDecision>('validated');
  const [manualResult, setManualResult] = useState('');
  const [justification, setJustification] = useState('');
  const [deletingId, setDeletingId] = useState('');
  const [deleteJustification, setDeleteJustification] = useState('');

  const workoutsById = useMemo(
    () => new Map((event.workouts || []).map(workout => [workout.id, workout])),
    [event.workouts]
  );

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/judge/queue?event_id=${encodeURIComponent(event.id)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Erro ao carregar os resultados do qualifier.');
      const queue = (data.queue || []) as ResultRow[];
      setRows(queue.filter(item => MANAGED_STATUSES.includes(item.status)));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Erro ao carregar os resultados do qualifier.');
    } finally {
      setLoaded(true);
    }
  }, [event.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const closeForms = () => {
    setEditingId('');
    setDeletingId('');
    setDecision('validated');
    setManualResult('');
    setJustification('');
    setDeleteJustification('');
  };

  const openEdit = (item: ResultRow) => {
    closeForms();
    setEditingId(item.id);
    setDecision(item.status === 'penalized' || item.status === 'rejected' ? item.status : 'validated');
    setNotice('');
  };

  const openDelete = (item: ResultRow) => {
    closeForms();
    setDeletingId(item.id);
    setNotice('');
  };

  const submitEdit = async (formEvent: React.FormEvent, item: ResultRow) => {
    formEvent.preventDefault();
    if (!justification.trim()) {
      setNotice('Informe a justificativa para editar um resultado já revisado.');
      return;
    }
    if (decision === 'manual_adjustment' && !manualResult.trim()) {
      setNotice('Informe o resultado ajustado.');
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      await postJson('/api/judge/reviews', {
        submissionId: item.id,
        expectedVersion: item.currentVersion,
        decision,
        justification: justification.trim(),
        manualResult
      }, 'Não foi possível editar o resultado.');
      closeForms();
      setNotice(`Resultado de ${item.athleteName} atualizado.`);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Erro ao editar o resultado.');
    } finally {
      setBusy(false);
    }
  };

  const submitDelete = async (formEvent: React.FormEvent, item: ResultRow) => {
    formEvent.preventDefault();
    if (!deleteJustification.trim()) {
      setNotice('Informe a justificativa para excluir o resultado.');
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      await postJson('/api/judge/submissions/request-resubmission', {
        submissionId: item.id,
        expectedReviewedAt: item.reviewedAt,
        justification: deleteJustification.trim()
      }, 'Não foi possível excluir o resultado.');
      closeForms();
      setNotice(`Resultado de ${item.athleteName} excluído. O atleta foi liberado para reenviar.`);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Erro ao excluir o resultado.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4 rounded-xl border border-card-border bg-card p-5 text-white">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Resultados revisados</p>
        <h3 className="mt-1 text-lg font-bold uppercase">Gestão de resultados do qualifier</h3>
        <p className="mt-2 text-sm text-muted">Os scores deste Qualifier vêm da revisão das submissões. Aqui você corrige uma decisão já tomada ou exclui o resultado para o atleta reenviar. Submissões pendentes são revisadas na aba “Submissões e Judges”.</p>
      </div>

      {notice && <p role="status" className="rounded-md border border-card-border bg-dark-gray/40 p-3 text-xs text-muted">{notice}</p>}

      {!loaded ? <p className="text-sm text-muted">Carregando resultados...</p> : rows.length === 0 ? <p className="text-sm text-muted">Nenhum resultado revisado até o momento.</p> : (
        <div className="space-y-3">
          {rows.map(item => {
            const workout = workoutsById.get(item.workoutId);
            const closesAt = workout?.submissionClosesAt;
            const windowClosed = getSubmissionWindowState(null, closesAt) === 'closed';
            const isReviewed = REVIEWED_STATUSES.includes(item.status);
            const isEditing = editingId === item.id;
            const isDeleting = deletingId === item.id;
            return (
              <article key={item.id} className="rounded-lg border border-card-border bg-dark-gray/30 p-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-bold uppercase">{item.athleteName} <span className="text-muted">· {item.workoutCode ? `${item.workoutCode} · ` : ''}{item.workoutName}</span></p>
                  <span className={`rounded border px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${item.status === 'awaiting_resubmission' ? 'border-card-border bg-dark-gray/40 text-muted' : 'border-primary/30 bg-primary/10 text-primary'}`}>
                    {STATUS_LABEL[item.status]}
                  </span>
                </div>
                <p className="mt-1 text-muted">
                  Resultado final: <span className="font-mono text-white">{item.finalResult || '—'}</span>
                  {' · '}Enviado: <span className="font-mono text-white">{item.submittedResult}</span>
                  {item.athleteBox ? ` · ${item.athleteBox}` : ''}
                </p>
                {item.reviewedAt && (
                  <p className="mt-1 text-xs text-muted">Revisado por {item.reviewedBy || '—'} em {formatDateTime(item.reviewedAt)}</p>
                )}
                {item.status === 'awaiting_resubmission' && (
                  <p className="mt-1 text-xs text-muted">Resultado excluído pela organização. Aguardando o atleta enviar um novo vídeo e resultado.</p>
                )}
                {item.videoUrl && (
                  <a className="mt-2 inline-flex text-xs font-bold uppercase tracking-wider text-primary hover:underline" href={item.videoUrl} target="_blank" rel="noopener noreferrer">Abrir vídeo enviado</a>
                )}

                {isReviewed && !isEditing && !isDeleting && (
                  <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-card-border pt-3">
                    <button type="button" disabled={busy} onClick={() => openEdit(item)} className="text-xs font-bold uppercase tracking-wider text-primary hover:underline disabled:opacity-60">Editar resultado</button>
                    <button type="button" disabled={busy || windowClosed} onClick={() => openDelete(item)} className="text-xs font-bold uppercase tracking-wider text-red-300 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-50">Excluir e solicitar reenvio</button>
                    {windowClosed && (
                      <p className="w-full text-xs text-muted">
                        {closesAt
                          ? `Exclusão indisponível: o prazo de envio desta prova terminou em ${formatDateTime(closesAt)} (Fortaleza) e o atleta não conseguiria reenviar.`
                          : 'Exclusão indisponível: esta prova não tem prazo de envio configurado.'}
                      </p>
                    )}
                  </div>
                )}

                {isReviewed && isEditing && (
                  <form onSubmit={formEvent => void submitEdit(formEvent, item)} className="mt-3 space-y-3 border-t border-card-border pt-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label htmlFor={`qualifier-edit-decision-${item.id}`} className="text-xs font-bold uppercase tracking-wider text-muted">
                        Decisão
                        <select id={`qualifier-edit-decision-${item.id}`} value={decision} onChange={e => setDecision(e.target.value as EditDecision)} className="mt-1 w-full rounded-md border border-card-border bg-dark-gray px-3 py-2 text-sm text-white">
                          <option value="validated">Validado</option>
                          <option value="penalized">Penalizado (-15%)</option>
                          <option value="rejected">Rejeitado</option>
                          <option value="manual_adjustment">Ajuste manual</option>
                        </select>
                      </label>
                      {decision === 'manual_adjustment' && (
                        <label htmlFor={`qualifier-edit-manual-${item.id}`} className="text-xs font-bold uppercase tracking-wider text-muted">
                          Resultado ajustado
                          <input id={`qualifier-edit-manual-${item.id}`} required value={manualResult} onChange={e => setManualResult(e.target.value)} placeholder={item.workoutType === 'fortime' ? 'MM:SS' : 'Valor'} className="mt-1 w-full rounded-md border border-card-border bg-dark-gray px-3 py-2 text-sm text-white" />
                        </label>
                      )}
                    </div>
                    <label htmlFor={`qualifier-edit-justification-${item.id}`} className="block text-xs font-bold uppercase tracking-wider text-muted">
                      Justificativa *
                      <textarea id={`qualifier-edit-justification-${item.id}`} required maxLength={2000} rows={3} value={justification} onChange={e => setJustification(e.target.value)} placeholder="Explique por que a decisão anterior está sendo alterada" className="mt-1 w-full rounded-md border border-card-border bg-dark-gray px-3 py-2 text-sm text-white placeholder:text-muted" />
                    </label>
                    <div className="flex flex-wrap items-center gap-3">
                      <button disabled={busy} className="rounded-md bg-primary px-4 py-2 text-xs font-bold uppercase tracking-wider text-ink disabled:opacity-60">{busy ? 'Salvando...' : 'Salvar alteração'}</button>
                      <button type="button" disabled={busy} onClick={closeForms} className="text-xs font-bold uppercase tracking-wider text-muted hover:text-white disabled:opacity-60">Cancelar</button>
                    </div>
                  </form>
                )}

                {isReviewed && isDeleting && (
                  <form onSubmit={formEvent => void submitDelete(formEvent, item)} className="mt-3 space-y-3 rounded-md border border-red-500/30 bg-red-950/20 p-3">
                    <p className="text-xs font-bold uppercase tracking-wider text-red-300">Excluir resultado de {item.athleteName}</p>
                    <p className="text-xs text-red-200">O atleta poderá reenviar um novo vídeo e resultado do zero. Esta ação fica registrada.</p>
                    <label htmlFor={`qualifier-delete-justification-${item.id}`} className="block text-xs font-bold uppercase tracking-wider text-muted">
                      Justificativa *
                      <textarea id={`qualifier-delete-justification-${item.id}`} required maxLength={2000} rows={3} value={deleteJustification} onChange={e => setDeleteJustification(e.target.value)} placeholder="Explique por que o resultado está sendo excluído (o atleta recebe este texto por e-mail)" className="mt-1 w-full rounded-md border border-card-border bg-dark-gray px-3 py-2 text-sm text-white placeholder:text-muted" />
                    </label>
                    <div className="flex flex-wrap items-center gap-3">
                      <button disabled={busy} className="rounded-md bg-red-600 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white transition-colors hover:bg-red-700 disabled:opacity-60">{busy ? 'Excluindo...' : 'Confirmar exclusão'}</button>
                      <button type="button" disabled={busy} onClick={closeForms} className="text-xs font-bold uppercase tracking-wider text-muted hover:text-white disabled:opacity-60">Cancelar</button>
                    </div>
                  </form>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
