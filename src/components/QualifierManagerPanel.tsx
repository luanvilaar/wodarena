'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Event } from '@/types';

type JudgeRow = { id: string; name: string; email: string };
type QueueRow = {
  id: string;
  athleteName: string;
  athleteBox: string;
  workoutName: string;
  submittedResult: string;
  status: string;
  submittedAt: string;
  videoUrl: string;
};

const adminAction = async (action: string, payload: Record<string, unknown>) => {
  const response = await fetch('/api/admin/persistence', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, payload })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a operação.');
  return data;
};

export function QualifierManagerPanel({ event }: { event: Event }) {
  const [judges, setJudges] = useState<JudgeRow[]>([]);
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [judgesResult, queueResult] = await Promise.all([
        adminAction('listJudges', { eventId: event.id }),
        fetch(`/api/judge/queue?event_id=${encodeURIComponent(event.id)}&status=pending_review`).then(async response => {
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.error || 'Erro ao carregar a fila.');
          return data;
        })
      ]);
      setJudges(judgesResult.judges || []);
      setQueue(queueResult.queue || []);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Erro ao carregar dados do qualifier.');
    }
  }, [event.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const createJudge = async (formEvent: React.FormEvent) => {
    formEvent.preventDefault();
    setBusy(true);
    setNotice('');
    try {
      await adminAction('createJudge', { eventId: event.id, name, email, password });
      setName(''); setEmail(''); setPassword('');
      setNotice('Judge criado e atribuído ao evento.');
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Erro ao criar judge.');
    } finally { setBusy(false); }
  };

  const removeJudge = async (judgeId: string) => {
    if (!window.confirm('Remover este judge da fila deste evento? O histórico de análises será preservado.')) return;
    try {
      await adminAction('removeJudgeFromEvent', { eventId: event.id, judgeId });
      await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Erro ao remover judge.'); }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <section className="space-y-4 rounded-xl border border-card-border bg-card p-5 text-white">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Revisão online</p>
          <h3 className="mt-1 text-lg font-bold uppercase">Submissões pendentes</h3>
        </div>
        {queue.length === 0 ? <p className="text-sm text-muted">Nenhuma submissão aguardando revisão.</p> : (
          <div className="space-y-3">
            {queue.map(item => (
              <article key={item.id} className="rounded-lg border border-card-border bg-dark-gray/30 p-3 text-sm">
                <p className="font-bold uppercase">{item.athleteName} <span className="text-muted">· {item.workoutName}</span></p>
                <p className="mt-1 text-muted">Score enviado: <span className="font-mono text-white">{item.submittedResult}</span>{item.athleteBox ? ` · ${item.athleteBox}` : ''}</p>
                <a className="mt-2 inline-flex text-xs font-bold uppercase tracking-wider text-primary hover:underline" href={item.videoUrl} target="_blank" rel="noopener noreferrer">Abrir vídeo enviado</a>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4 rounded-xl border border-card-border bg-card p-5 text-white">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Equipe de arbitragem</p>
          <h3 className="mt-1 text-lg font-bold uppercase">Judges atribuídos</h3>
        </div>
        <form onSubmit={createJudge} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input required minLength={3} value={name} onChange={e => setName(e.target.value)} placeholder="Nome do judge" className="rounded-md border border-card-border bg-dark-gray px-3 py-2 text-sm" />
          <input required type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="E-mail" className="rounded-md border border-card-border bg-dark-gray px-3 py-2 text-sm" />
          <input required minLength={8} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Senha inicial (mín. 8)" className="rounded-md border border-card-border bg-dark-gray px-3 py-2 text-sm" />
          <button disabled={busy} className="rounded-md bg-primary px-4 py-2 text-xs font-bold uppercase tracking-wider text-ink disabled:opacity-60">{busy ? 'Criando...' : 'Criar judge'}</button>
        </form>
        {notice && <p role="status" className="rounded-md border border-card-border bg-dark-gray/40 p-3 text-xs text-muted">{notice}</p>}
        <div className="space-y-2">
          {judges.length === 0 ? <p className="text-sm text-muted">Nenhum judge atribuído.</p> : judges.map(judge => (
            <div key={judge.id} className="flex items-center justify-between gap-3 rounded-md border border-card-border bg-dark-gray/30 p-3">
              <div className="min-w-0"><p className="truncate text-sm font-bold">{judge.name}</p><p className="truncate text-xs text-muted">{judge.email}</p></div>
              <button type="button" onClick={() => void removeJudge(judge.id)} className="text-xs font-bold uppercase tracking-wider text-red-300 hover:text-red-200">Remover</button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
