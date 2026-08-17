'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Event, Registration, ScoreSubmission } from '@/types';

const decisionLabel: Record<ScoreSubmission['status'], string> = {
  pending_review: 'Em análise',
  validated: 'Validado',
  penalized: 'Penalizado',
  rejected: 'Resultado rejeitado'
};

export function QualifierAthleteContestation({ events, registrations }: { events: Event[]; registrations: Registration[] }) {
  const [submissions, setSubmissions] = useState<ScoreSubmission[]>([]);
  const [submissionId, setSubmissionId] = useState('');
  const [description, setDescription] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch('/api/submissions');
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar as submissões.');
    setSubmissions(payload.submissions || []);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch(error => setNotice(error instanceof Error ? error.message : 'Não foi possível carregar as submissões.'));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const registrationsById = useMemo(() => new Map(registrations.map(registration => [registration.id, registration])), [registrations]);
  const eligibleSubmissions = useMemo(() => submissions.filter(submission => {
    const registration = registrationsById.get(submission.registrationId);
    const event = events.find(item => item.id === submission.eventId);
    return registration?.paymentStatus === 'payment_approved'
      && event?.eventType === 'functional_fitness_qualifier'
      && submission.status !== 'pending_review';
  }), [events, registrationsById, submissions]);
  const selectedSubmission = eligibleSubmissions.find(item => item.id === submissionId) || eligibleSubmissions[0];

  const submit = async (formEvent: React.FormEvent) => {
    formEvent.preventDefault();
    if (!selectedSubmission || !description.trim()) {
      setNotice('Selecione uma submissão finalizada e descreva a contestação.');
      return;
    }
    setSaving(true);
    setNotice('');
    try {
      const response = await fetch('/api/contestations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: selectedSubmission.eventId,
          registrationId: selectedSubmission.registrationId,
          workoutId: selectedSubmission.workoutId,
          submissionId: selectedSubmission.id,
          description: description.trim()
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Não foi possível registrar a contestação.');
      setDescription('');
      setNotice(payload.message || 'Contestação registrada com sucesso.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Não foi possível registrar a contestação.');
    } finally {
      setSaving(false);
    }
  };

  if (eligibleSubmissions.length === 0) return null;

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border border-card-border bg-dark-gray/30 p-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-primary">Qualifier online</p>
        <h4 className="mt-1 text-sm font-bold uppercase tracking-wider text-white">Contestar uma decisão de submissão</h4>
        <p className="mt-1 text-xs leading-5 text-muted">Selecione um resultado já analisado. A contestação pode ser deferida com reabertura explícita para nova revisão.</p>
      </div>
      <label className="block text-xs font-bold uppercase tracking-wider text-muted">Submissão analisada
        <select value={selectedSubmission?.id || ''} onChange={event => setSubmissionId(event.target.value)} className="mt-1 w-full rounded-md border border-card-border bg-dark-gray px-3 py-2 text-sm text-white">
          {eligibleSubmissions.map(submission => {
            const event = events.find(item => item.id === submission.eventId);
            const workout = event?.workouts.find(item => item.id === submission.workoutId);
            return <option key={submission.id} value={submission.id}>{event?.name} · {workout?.name} · {decisionLabel[submission.status]}</option>;
          })}
        </select>
      </label>
      <label className="block text-xs font-bold uppercase tracking-wider text-muted">Descrição da contestação
        <textarea required rows={3} value={description} onChange={event => setDescription(event.target.value)} placeholder="Explique o que deve ser revisto no vídeo ou no score." className="mt-1 w-full rounded-md border border-card-border bg-dark-gray px-3 py-2 text-sm text-white placeholder:text-muted" />
      </label>
      <button disabled={saving} className="rounded-md bg-primary px-4 py-2 text-xs font-bold uppercase tracking-wider text-ink disabled:opacity-50">{saving ? 'Enviando...' : 'Contestar decisão'}</button>
      {notice && <p role="status" className="text-xs text-muted">{notice}</p>}
    </form>
  );
}
