'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { UserPlus } from 'lucide-react';

import type { Event } from '@/types';

// Judges do evento Fitness Race (Story 1.95): listar, criar (nome, e-mail,
// senha) e remover, com o mesmo comportamento do bloco de judges da aba
// "Súmulas e Judges" de Functional Fitness (ScoresheetsPanel.tsx), que não é
// importado porque conhece as súmulas de FF. O servidor escolhe as funções
// race_* pelo tipo do evento (/api/admin/persistence).

type JudgeRow = { id: string; name: string; email: string };

const adminAction = async (action: string, payload: Record<string, unknown>) => {
  const response = await fetch('/api/admin/persistence', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, payload })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a operação.');
  return data;
};

const inputClass = 'w-full rounded-md border border-card-border bg-dark-gray px-3 py-2 text-sm text-white placeholder:text-muted focus:border-primary/50 focus:outline-none';

export function RaceJudgesPanel({ event }: { event: Event }) {
  const [judges, setJudges] = useState<JudgeRow[] | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [judgeForm, setJudgeForm] = useState({ name: '', email: '', password: '' });

  const load = useCallback(async () => {
    const result = await adminAction('listJudges', { eventId: event.id });
    setJudges(result.judges || []);
  }, [event.id]);

  useEffect(() => {
    const first = window.setTimeout(() => {
      void load().catch((error) => setNotice(error instanceof Error ? error.message : 'Erro ao carregar os judges.'));
    }, 0);
    return () => window.clearTimeout(first);
  }, [load]);

  const createJudge = async (formEvent: FormEvent) => {
    formEvent.preventDefault();
    setBusy(true);
    setNotice('');
    try {
      await adminAction('createJudge', { eventId: event.id, ...judgeForm });
      setJudgeForm({ name: '', email: '', password: '' });
      setNotice('Judge criado e atribuído ao evento. Ele entra pelo login com este e-mail e senha.');
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Erro ao criar o judge.');
    } finally {
      setBusy(false);
    }
  };

  const removeJudge = async (judge: JudgeRow) => {
    if (!window.confirm(`Remover ${judge.name} deste evento? As tentativas que ele já abriu ficam com o nome dele.`)) return;
    try {
      await adminAction('removeJudgeFromEvent', { eventId: event.id, judgeId: judge.id });
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Erro ao remover o judge.');
    }
  };

  return (
    <section className="space-y-4 rounded-xl border border-card-border bg-card p-5" aria-labelledby="race-judges-title">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Equipe de arbitragem</p>
        <h3 id="race-judges-title" className="mt-1 text-lg font-bold uppercase">Judges do evento</h3>
        <p className="mt-1 text-xs text-muted">O judge entra com este e-mail e senha. Só os judges atribuídos aqui arbitram este evento.</p>
      </div>
      {notice && <p role="status" aria-live="polite" className="rounded-md border border-card-border bg-dark-gray/40 px-3 py-2 text-xs text-white">{notice}</p>}
      <form onSubmit={(formEvent) => void createJudge(formEvent)} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="sr-only" htmlFor="race-judge-name">Nome do judge</label>
        <input id="race-judge-name" required minLength={3} value={judgeForm.name} onChange={(e) => setJudgeForm({ ...judgeForm, name: e.target.value })} placeholder="Nome do judge" className={inputClass} />
        <label className="sr-only" htmlFor="race-judge-email">E-mail</label>
        <input id="race-judge-email" required type="email" value={judgeForm.email} onChange={(e) => setJudgeForm({ ...judgeForm, email: e.target.value })} placeholder="E-mail" className={inputClass} />
        <label className="sr-only" htmlFor="race-judge-password">Senha inicial</label>
        <input id="race-judge-password" required minLength={8} type="password" autoComplete="new-password" value={judgeForm.password} onChange={(e) => setJudgeForm({ ...judgeForm, password: e.target.value })} placeholder="Senha inicial (mín. 8)" className={inputClass} />
        <button type="submit" disabled={busy} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-xs font-bold uppercase tracking-wider text-ink disabled:opacity-60">
          <UserPlus className="h-4 w-4" aria-hidden="true" />{busy ? 'Criando…' : 'Criar judge'}
        </button>
      </form>
      <ul className="space-y-2">
        {judges === null ? <li className="text-sm text-muted" role="status">Carregando judges…</li> : judges.length === 0 ? <li className="text-sm text-muted">Nenhum judge atribuído.</li> : judges.map((judge) => (
          <li key={judge.id} className="flex items-center justify-between gap-3 rounded-md border border-card-border bg-dark-gray/30 p-3">
            <div className="min-w-0"><p className="truncate text-sm font-bold">{judge.name}</p><p className="truncate text-xs text-muted">{judge.email}</p></div>
            <button type="button" onClick={() => void removeJudge(judge)} className="min-h-9 text-xs font-bold uppercase tracking-wider text-trading-down hover:underline">Remover</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
