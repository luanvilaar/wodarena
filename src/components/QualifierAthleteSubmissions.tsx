'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Event, Registration, ScoreSubmission } from '@/types';
import { getSubmissionWindowMessage, getSubmissionWindowState } from '@/lib/submissionWindow';

export function QualifierAthleteSubmissions({ events, registrations }: { events: Event[]; registrations: Registration[] }) {
  const qualifierRegistrations = useMemo(() => registrations.filter(registration => (
    registration.paymentStatus === 'payment_approved'
    && events.some(event => event.id === registration.eventId && event.eventType === 'functional_fitness_qualifier')
  )), [events, registrations]);
  const [submissions, setSubmissions] = useState<ScoreSubmission[]>([]);
  const [registrationId, setRegistrationId] = useState('');
  const [workoutId, setWorkoutId] = useState('');
  const [result, setResult] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [athleteNote, setAthleteNote] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch('/api/submissions');
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Erro ao carregar submissões.');
    setSubmissions(data.submissions || []);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch(error => setNotice(error instanceof Error ? error.message : 'Erro ao carregar submissões.'));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const effectiveRegistrationId = qualifierRegistrations.some(item => item.id === registrationId)
    ? registrationId
    : qualifierRegistrations[0]?.id || '';
  const registration = qualifierRegistrations.find(item => item.id === effectiveRegistrationId);
  const event = events.find(item => item.id === registration?.eventId);
  const workouts = (event?.workouts || []).filter(workout => !workout.divisionId || workout.divisionId === registration?.divisionId);
  const effectiveWorkoutId = workouts.some(workout => workout.id === workoutId) ? workoutId : workouts[0]?.id || '';
  const workout = workouts.find(item => item.id === effectiveWorkoutId);
  const existing = submissions.find(item => item.registrationId === effectiveRegistrationId && item.workoutId === effectiveWorkoutId);
  const windowState = getSubmissionWindowState(workout?.submissionOpensAt, workout?.submissionClosesAt);
  // O atleta pode (re)enviar enquanto a submissão está em análise ou quando o
  // organizador removeu o resultado e solicitou um novo envio.
  const awaitingResubmission = existing?.status === 'awaiting_resubmission';
  const canSubmit = !existing || existing.status === 'pending_review' || awaitingResubmission;
  const formLocked = windowState !== 'open' || !canSubmit;

  const submit = async (formEvent: React.FormEvent) => {
    formEvent.preventDefault();
    if (!registration || !workout) return;
    setSaving(true); setNotice('');
    try {
      const response = await fetch(existing ? '/api/submissions' : '/api/submissions', {
        method: existing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: event?.id, registrationId: effectiveRegistrationId, workoutId: effectiveWorkoutId, result, videoUrl, athleteNote, expectedVersion: existing?.currentVersion || 0 })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Não foi possível enviar o resultado.');
      setNotice(existing ? 'Submissão atualizada e reenviada para revisão.' : 'Resultado enviado para revisão.');
      setResult(''); setVideoUrl(''); setAthleteNote('');
      await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Erro ao enviar resultado.'); }
    finally { setSaving(false); }
  };

  if (qualifierRegistrations.length === 0) return <p className="rounded-xl border border-card-border bg-card p-5 text-sm text-muted">Você não possui inscrição aprovada em um Functional Fitness Qualifier.</p>;

  return (
    <div className="space-y-5">
      <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Qualifier online</p><h3 className="mt-1 text-xl font-bold uppercase text-white">Enviar resultados</h3><p className="mt-2 text-sm text-muted">Envie o score e o link do vídeo no YouTube. O vídeo fica visível apenas para você, judges e organização.</p></div>
      <form onSubmit={submit} className="space-y-4 rounded-xl border border-card-border bg-card p-5 text-white">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="text-xs font-bold uppercase tracking-wider text-muted">Inscrição
            <select value={effectiveRegistrationId} onChange={e => setRegistrationId(e.target.value)} className="mt-1 w-full rounded-md border border-card-border bg-dark-gray px-3 py-2 text-sm text-white">
              {qualifierRegistrations.map(item => <option key={item.id} value={item.id}>{events.find(eventItem => eventItem.id === item.eventId)?.name} · {item.ticketType}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold uppercase tracking-wider text-muted">Prova
            <select value={effectiveWorkoutId} onChange={e => setWorkoutId(e.target.value)} className="mt-1 w-full rounded-md border border-card-border bg-dark-gray px-3 py-2 text-sm text-white">
              {workouts.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
            </select>
          </label>
        </div>
        {workout && <p className={`rounded-md border p-3 text-xs ${windowState === 'open' ? 'border-primary/30 bg-primary/5 text-primary' : 'border-card-border bg-dark-gray/30 text-muted'}`}>
          {getSubmissionWindowMessage(windowState)} {workout.submissionClosesAt ? `Limite: ${new Date(workout.submissionClosesAt).toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' })} (Fortaleza).` : ''}
        </p>}
        {existing && <p className="text-xs text-muted">Status atual: <strong className="text-white">{existing.status}</strong> · versão {existing.currentVersion}. {!canSubmit ? 'Para nova análise após decisão, use a contestação.' : ''}</p>}
        {awaitingResubmission && <p role="status" className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs text-primary">O organizador removeu seu resultado anterior e solicitou um novo envio. Envie um novo vídeo e resultado para esta prova dentro do prazo.</p>}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <input required disabled={formLocked} value={result} onChange={e => setResult(e.target.value)} placeholder={workout?.type === 'fortime' ? 'Score (MM:SS)' : 'Score numérico'} className="rounded-md border border-card-border bg-dark-gray px-3 py-2 text-sm text-white disabled:opacity-50" />
          <input required disabled={formLocked} value={videoUrl} onChange={e => setVideoUrl(e.target.value)} placeholder="Link do vídeo no YouTube" className="rounded-md border border-card-border bg-dark-gray px-3 py-2 text-sm text-white disabled:opacity-50" />
        </div>
        <textarea disabled={formLocked} value={athleteNote} onChange={e => setAthleteNote(e.target.value)} rows={3} placeholder="Observação opcional para a arbitragem" className="w-full rounded-md border border-card-border bg-dark-gray px-3 py-2 text-sm text-white disabled:opacity-50" />
        <button disabled={saving || formLocked} className="rounded-md bg-primary px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-ink disabled:opacity-50">{saving ? 'Enviando...' : awaitingResubmission ? 'Reenviar resultado' : existing ? 'Atualizar submissão' : 'Enviar resultado'}</button>
        {notice && <p role="status" className="text-sm text-muted">{notice}</p>}
      </form>
      <section className="space-y-2"><h4 className="text-sm font-bold uppercase text-white">Histórico de envios</h4>{submissions.length === 0 ? <p className="text-sm text-muted">Nenhum resultado enviado.</p> : submissions.map(item => <article key={item.id} className="rounded-lg border border-card-border bg-card p-3 text-sm text-white"><p className="font-bold">{events.find(eventItem => eventItem.id === item.eventId)?.workouts.find(workoutItem => workoutItem.id === item.workoutId)?.name || 'Prova'} · {item.submittedResult}</p><p className="mt-1 text-xs text-muted">{item.status} · enviado em {new Date(item.submittedAt).toLocaleString('pt-BR')}</p></article>)}</section>
    </div>
  );
}
