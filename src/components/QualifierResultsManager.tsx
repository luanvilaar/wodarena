'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Event } from '@/types';
import { getSubmissionWindowState } from '@/lib/submissionWindow';
import {
  QUALIFIER_RESULT_STATES,
  QUALIFIER_RESULT_STATE_LABELS,
  filterQualifierResultRows,
  getQualifierResultActions,
  getQualifierResultState,
  summarizeQualifierResultRows,
  type QualifierResultRow,
  type QualifierResultState
} from '@/lib/qualifierResults';

type EditDecision = 'validated' | 'penalized' | 'rejected' | 'manual_adjustment';
type FormKind = 'enter' | 'edit' | 'clear';

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

const inputClassName = 'mt-1 w-full rounded-md border border-card-border bg-dark-gray px-3 py-2 text-sm text-white placeholder:text-muted';

export function QualifierResultsManager({ event }: { event: Event }) {
  const workouts = useMemo(
    () => [...(event.workouts || [])].sort((a, b) => a.orderIndex - b.orderIndex),
    [event.workouts]
  );
  const [selectedWorkoutId, setSelectedWorkoutId] = useState('');
  const [roster, setRoster] = useState<{ workoutId: string; rows: QualifierResultRow[] }>({ workoutId: '', rows: [] });
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [divisionFilter, setDivisionFilter] = useState('');
  const [stateFilter, setStateFilter] = useState<QualifierResultState | 'all'>('all');
  const [activeForm, setActiveForm] = useState<{ registrationId: string; kind: FormKind } | null>(null);
  const [decision, setDecision] = useState<EditDecision>('validated');
  const [manualResult, setManualResult] = useState('');
  const [justification, setJustification] = useState('');

  const activeWorkout = workouts.find(workout => workout.id === selectedWorkoutId) || workouts[0];
  const activeWorkoutId = activeWorkout?.id || '';

  const load = useCallback(async () => {
    if (!activeWorkoutId) return;
    try {
      const response = await fetch(`/api/qualifier/results-roster?event_id=${encodeURIComponent(event.id)}&workout_id=${encodeURIComponent(activeWorkoutId)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Erro ao carregar os resultados do qualifier.');
      setRoster({ workoutId: activeWorkoutId, rows: (data.rows || []) as QualifierResultRow[] });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Erro ao carregar os resultados do qualifier.');
      setRoster({ workoutId: activeWorkoutId, rows: [] });
    }
  }, [event.id, activeWorkoutId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const loaded = roster.workoutId === activeWorkoutId;
  const rows = useMemo(() => (loaded ? roster.rows : []), [loaded, roster.rows]);
  const summary = useMemo(() => summarizeQualifierResultRows(rows), [rows]);
  const visibleRows = useMemo(
    () => filterQualifierResultRows(rows, { search, divisionId: divisionFilter, state: stateFilter }),
    [rows, search, divisionFilter, stateFilter]
  );
  const divisionOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const row of rows) options.set(row.divisionId, row.divisionName || row.divisionId);
    return [...options.entries()];
  }, [rows]);

  const closeForms = () => {
    setActiveForm(null);
    setDecision('validated');
    setManualResult('');
    setJustification('');
  };

  const openForm = (row: QualifierResultRow, kind: FormKind) => {
    closeForms();
    setActiveForm({ registrationId: row.registrationId, kind });
    if (kind === 'edit') {
      const status = row.submission?.status;
      setDecision(status === 'penalized' || status === 'rejected' ? status : 'validated');
    }
    setNotice('');
  };

  const run = async (action: () => Promise<string>, fallback: string) => {
    setBusy(true);
    setNotice('');
    try {
      const message = await action();
      closeForms();
      setNotice(message);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : fallback);
    } finally {
      setBusy(false);
    }
  };

  const submitEnter = (formEvent: React.FormEvent, row: QualifierResultRow) => {
    formEvent.preventDefault();
    if (!manualResult.trim()) { setNotice('Informe o resultado a ser lançado.'); return; }
    if (!justification.trim()) { setNotice('Informe a justificativa do lançamento manual.'); return; }
    void run(async () => {
      await postJson('/api/judge/submissions/manual-result', {
        eventId: event.id,
        workoutId: activeWorkoutId,
        registrationId: row.registrationId,
        result: manualResult.trim(),
        justification: justification.trim()
      }, 'Não foi possível lançar o resultado.');
      return `Resultado de ${row.athleteName} lançado pela organização. O atleta será avisado por e-mail.`;
    }, 'Erro ao lançar o resultado.');
  };

  const submitEdit = (formEvent: React.FormEvent, row: QualifierResultRow) => {
    formEvent.preventDefault();
    const submission = row.submission;
    if (!submission) return;
    const isPending = submission.status === 'pending_review';
    if (!justification.trim() && (!isPending || decision !== 'validated')) {
      setNotice(isPending ? 'Informe a justificativa para esta decisão.' : 'Informe a justificativa para editar um resultado já revisado.');
      return;
    }
    if (decision === 'manual_adjustment' && !manualResult.trim()) { setNotice('Informe o resultado ajustado.'); return; }
    void run(async () => {
      await postJson('/api/judge/reviews', {
        submissionId: submission.id,
        expectedVersion: submission.currentVersion,
        decision,
        justification: justification.trim(),
        manualResult
      }, 'Não foi possível editar o resultado.');
      return isPending
        ? `Resultado de ${row.athleteName} revisado.`
        : `Resultado de ${row.athleteName} atualizado. O atleta será avisado por e-mail.`;
    }, 'Erro ao editar o resultado.');
  };

  const submitClear = (formEvent: React.FormEvent, row: QualifierResultRow) => {
    formEvent.preventDefault();
    const submission = row.submission;
    if (!submission) return;
    if (!justification.trim()) { setNotice('Informe a justificativa para excluir o resultado.'); return; }
    void run(async () => {
      await postJson('/api/judge/submissions/request-resubmission', {
        submissionId: submission.id,
        expectedReviewedAt: submission.reviewedAt,
        justification: justification.trim()
      }, 'Não foi possível excluir o resultado.');
      return `Resultado de ${row.athleteName} excluído. O atleta foi liberado para reenviar.`;
    }, 'Erro ao excluir o resultado.');
  };

  const manualPlaceholder = activeWorkout?.type === 'fortime' ? 'MM:SS' : 'Valor';
  const closesAt = activeWorkout?.submissionClosesAt;
  const windowClosed = getSubmissionWindowState(null, closesAt) === 'closed';

  return (
    <section className="space-y-4 rounded-xl border border-card-border bg-card p-5 text-white">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Lançamento de scores</p>
        <h3 className="mt-1 text-lg font-bold uppercase">Gestão de resultados do qualifier</h3>
        <p className="mt-2 text-sm text-muted">Os scores deste Qualifier vêm das submissões dos atletas. Aqui você lança o resultado de quem não enviou, corrige uma decisão já tomada ou exclui o resultado para o atleta reenviar. Cada ação exige justificativa e fica registrada.</p>
      </div>

      {notice && <p role="status" className="rounded-md border border-card-border bg-dark-gray/40 p-3 text-xs text-muted">{notice}</p>}

      {workouts.length === 0 ? <p className="text-sm text-muted">Cadastre as provas do evento para lançar resultados.</p> : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label htmlFor="qualifier-results-workout" className="text-xs font-bold uppercase tracking-wider text-muted">
              Prova
              <select id="qualifier-results-workout" value={activeWorkoutId} onChange={e => { setSelectedWorkoutId(e.target.value); setDivisionFilter(''); closeForms(); }} className={inputClassName}>
                {workouts.map(workout => <option key={workout.id} value={workout.id}>{workout.code ? `${workout.code} · ` : ''}{workout.name}</option>)}
              </select>
            </label>
            <label htmlFor="qualifier-results-division" className="text-xs font-bold uppercase tracking-wider text-muted">
              Categoria
              <select id="qualifier-results-division" value={divisionFilter} onChange={e => setDivisionFilter(e.target.value)} className={inputClassName}>
                <option value="">Todas</option>
                {divisionOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <label htmlFor="qualifier-results-state" className="text-xs font-bold uppercase tracking-wider text-muted">
              Situação
              <select id="qualifier-results-state" value={stateFilter} onChange={e => setStateFilter(e.target.value as QualifierResultState | 'all')} className={inputClassName}>
                <option value="all">Todas</option>
                {QUALIFIER_RESULT_STATES.map(state => <option key={state} value={state}>{QUALIFIER_RESULT_STATE_LABELS[state]}</option>)}
              </select>
            </label>
            <label htmlFor="qualifier-results-search" className="text-xs font-bold uppercase tracking-wider text-muted">
              Buscar atleta
              <input id="qualifier-results-search" type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Nome ou box" className={inputClassName} />
            </label>
          </div>

          {loaded && (
            <p className="text-xs text-muted">
              {summary.total} {summary.total === 1 ? 'atleta' : 'atletas'} · {summary.no_submission} sem envio · {summary.pending_review} em análise · {summary.validated + summary.penalized + summary.rejected} com resultado · {summary.awaiting_resubmission} aguardando reenvio
              {closesAt ? ` · prazo de envio: ${formatDateTime(closesAt)} (Fortaleza)${windowClosed ? ' — encerrado' : ''}` : ''}
            </p>
          )}

          {!loaded ? <p className="text-sm text-muted">Carregando resultados...</p> : visibleRows.length === 0 ? <p className="text-sm text-muted">Nenhum atleta encontrado para os filtros selecionados.</p> : (
            <div className="space-y-3">
              {visibleRows.map(row => {
                const submission = row.submission;
                const state = getQualifierResultState(row);
                const actions = getQualifierResultActions(state);
                const formKind = activeForm?.registrationId === row.registrationId ? activeForm.kind : null;
                const byOrganization = submission?.entrySource === 'manager';
                const reviewed = actions.canRequestResubmission;
                const formId = row.registrationId;
                return (
                  <article key={row.registrationId} className="rounded-lg border border-card-border bg-dark-gray/30 p-3 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="font-bold uppercase">{row.athleteName} <span className="text-muted">· {row.divisionName}{row.box ? ` · ${row.box}` : ''}</span></p>
                      <div className="flex flex-wrap items-center gap-2">
                        {byOrganization && (
                          <span className="rounded border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-primary">Lançado pela organização</span>
                        )}
                        <span className={`rounded border px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${state === 'no_submission' || state === 'awaiting_resubmission' ? 'border-card-border bg-dark-gray/40 text-muted' : 'border-primary/30 bg-primary/10 text-primary'}`}>
                          {QUALIFIER_RESULT_STATE_LABELS[state]}
                        </span>
                      </div>
                    </div>

                    {submission ? (
                      <p className="mt-1 text-muted">
                        Resultado final: <span className="font-mono text-white">{submission.finalResult || '—'}</span>
                        {!byOrganization && <>{' · '}Enviado: <span className="font-mono text-white">{submission.submittedResult}</span></>}
                      </p>
                    ) : (
                      <p className="mt-1 text-muted">Nenhum envio do atleta nesta prova.</p>
                    )}
                    {submission?.reviewedAt && (
                      <p className="mt-1 text-xs text-muted">{byOrganization ? 'Lançado' : 'Revisado'} por {submission.reviewedByName || '—'} em {formatDateTime(submission.reviewedAt)}</p>
                    )}
                    {state === 'awaiting_resubmission' && (
                      <p className="mt-1 text-xs text-muted">Resultado excluído pela organização. Aguardando o atleta enviar um novo vídeo e resultado, ou lance o resultado manualmente.</p>
                    )}
                    {submission?.videoUrl && (
                      <a className="mt-2 inline-flex text-xs font-bold uppercase tracking-wider text-primary hover:underline" href={submission.videoUrl} target="_blank" rel="noopener noreferrer">Abrir vídeo enviado</a>
                    )}

                    {!formKind && (actions.canEnter || actions.canEdit) && (
                      <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-card-border pt-3">
                        {actions.canEnter && (
                          <button type="button" disabled={busy} onClick={() => openForm(row, 'enter')} className="text-xs font-bold uppercase tracking-wider text-primary hover:underline disabled:opacity-60">Lançar resultado</button>
                        )}
                        {actions.canEdit && (
                          <button type="button" disabled={busy} onClick={() => openForm(row, 'edit')} className="text-xs font-bold uppercase tracking-wider text-primary hover:underline disabled:opacity-60">{reviewed ? 'Editar resultado' : 'Revisar resultado'}</button>
                        )}
                        {actions.canRequestResubmission && (
                          <button type="button" disabled={busy || windowClosed} onClick={() => openForm(row, 'clear')} className="text-xs font-bold uppercase tracking-wider text-red-300 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-50">Excluir e solicitar reenvio</button>
                        )}
                        {actions.canRequestResubmission && windowClosed && (
                          <p className="w-full text-xs text-muted">
                            {closesAt
                              ? `Exclusão indisponível: o prazo de envio desta prova terminou em ${formatDateTime(closesAt)} (Fortaleza) e o atleta não conseguiria reenviar. Estenda o prazo na aba de provas ou corrija o resultado manualmente.`
                              : 'Exclusão indisponível: esta prova não tem prazo de envio configurado.'}
                          </p>
                        )}
                      </div>
                    )}

                    {formKind === 'enter' && (
                      <form onSubmit={formEvent => submitEnter(formEvent, row)} className="mt-3 space-y-3 border-t border-card-border pt-3">
                        <p className="text-xs text-muted">O resultado será marcado como <strong className="text-white">Lançado pela organização</strong>, sem vídeo, e o atleta será avisado por e-mail. {windowClosed ? 'O prazo de envio já terminou, mas a organização ainda pode lançar o resultado.' : ''}</p>
                        <label htmlFor={`qualifier-enter-result-${formId}`} className="block text-xs font-bold uppercase tracking-wider text-muted">
                          Resultado *
                          <input id={`qualifier-enter-result-${formId}`} required value={manualResult} onChange={e => setManualResult(e.target.value)} placeholder={manualPlaceholder} className={inputClassName} />
                        </label>
                        <label htmlFor={`qualifier-enter-justification-${formId}`} className="block text-xs font-bold uppercase tracking-wider text-muted">
                          Justificativa *
                          <textarea id={`qualifier-enter-justification-${formId}`} required maxLength={2000} rows={3} value={justification} onChange={e => setJustification(e.target.value)} placeholder="Explique por que o resultado está sendo lançado pela organização (o atleta recebe este texto por e-mail)" className={inputClassName} />
                        </label>
                        <div className="flex flex-wrap items-center gap-3">
                          <button disabled={busy} className="rounded-md bg-primary px-4 py-2 text-xs font-bold uppercase tracking-wider text-ink disabled:opacity-60">{busy ? 'Lançando...' : 'Lançar resultado'}</button>
                          <button type="button" disabled={busy} onClick={closeForms} className="text-xs font-bold uppercase tracking-wider text-muted hover:text-white disabled:opacity-60">Cancelar</button>
                        </div>
                      </form>
                    )}

                    {formKind === 'edit' && (
                      <form onSubmit={formEvent => submitEdit(formEvent, row)} className="mt-3 space-y-3 border-t border-card-border pt-3">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <label htmlFor={`qualifier-edit-decision-${formId}`} className="text-xs font-bold uppercase tracking-wider text-muted">
                            Decisão
                            <select id={`qualifier-edit-decision-${formId}`} value={decision} onChange={e => setDecision(e.target.value as EditDecision)} className={inputClassName}>
                              <option value="validated">Validado</option>
                              <option value="penalized">Penalizado (-15%)</option>
                              <option value="rejected">Rejeitado</option>
                              <option value="manual_adjustment">Ajuste manual</option>
                            </select>
                          </label>
                          {decision === 'manual_adjustment' && (
                            <label htmlFor={`qualifier-edit-manual-${formId}`} className="text-xs font-bold uppercase tracking-wider text-muted">
                              Resultado ajustado
                              <input id={`qualifier-edit-manual-${formId}`} required value={manualResult} onChange={e => setManualResult(e.target.value)} placeholder={manualPlaceholder} className={inputClassName} />
                            </label>
                          )}
                        </div>
                        <label htmlFor={`qualifier-edit-justification-${formId}`} className="block text-xs font-bold uppercase tracking-wider text-muted">
                          Justificativa {submission?.status === 'pending_review' && decision === 'validated' ? '' : '*'}
                          <textarea id={`qualifier-edit-justification-${formId}`} maxLength={2000} rows={3} value={justification} onChange={e => setJustification(e.target.value)} placeholder="Explique por que a decisão anterior está sendo alterada" className={inputClassName} />
                        </label>
                        <div className="flex flex-wrap items-center gap-3">
                          <button disabled={busy} className="rounded-md bg-primary px-4 py-2 text-xs font-bold uppercase tracking-wider text-ink disabled:opacity-60">{busy ? 'Salvando...' : 'Salvar alteração'}</button>
                          <button type="button" disabled={busy} onClick={closeForms} className="text-xs font-bold uppercase tracking-wider text-muted hover:text-white disabled:opacity-60">Cancelar</button>
                        </div>
                      </form>
                    )}

                    {formKind === 'clear' && (
                      <form onSubmit={formEvent => submitClear(formEvent, row)} className="mt-3 space-y-3 rounded-md border border-red-500/30 bg-red-950/20 p-3">
                        <p className="text-xs font-bold uppercase tracking-wider text-red-300">Excluir resultado de {row.athleteName}</p>
                        <p className="text-xs text-red-200">O atleta poderá reenviar um novo vídeo e resultado do zero. Esta ação fica registrada.</p>
                        <label htmlFor={`qualifier-delete-justification-${formId}`} className="block text-xs font-bold uppercase tracking-wider text-muted">
                          Justificativa *
                          <textarea id={`qualifier-delete-justification-${formId}`} required maxLength={2000} rows={3} value={justification} onChange={e => setJustification(e.target.value)} placeholder="Explique por que o resultado está sendo excluído (o atleta recebe este texto por e-mail)" className={inputClassName} />
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
        </>
      )}
    </section>
  );
}
