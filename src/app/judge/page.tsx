'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { getYouTubeNoCookieEmbedUrl } from '@/lib/videoProof';

type QueueItem = {
  id: string;
  eventId: string;
  eventName: string;
  workoutName: string;
  workoutCode: string;
  workoutType: string;
  athleteName: string;
  athleteBox: string;
  submittedResult: string;
  videoId: string;
  athleteNote?: string;
  status: string;
  currentVersion: number;
  submittedAt: string;
};

type ReviewItem = {
  id: string;
  judgeName: string;
  decision: string;
  justification?: string;
  reviewedAt: string;
  appliedResult?: string;
};

export default function JudgePage() {
  const { currentUser, logout } = useApp();
  const router = useRouter();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [decision, setDecision] = useState('validated');
  const [manualResult, setManualResult] = useState('');
  const [justification, setJustification] = useState('');
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const loadQueue = useCallback(async () => {
    const response = await fetch('/api/judge/queue?status=pending_review');
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Erro ao carregar a fila.');
    setQueue(data.queue || []);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadQueue().catch((error) => setNotice(error instanceof Error ? error.message : 'Erro ao carregar fila.'));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadQueue]);

  const selected = useMemo(() => queue.find((item) => item.id === selectedId) || queue[0], [queue, selectedId]);

  const loadHistory = useCallback(async (submissionId: string) => {
    const response = await fetch(`/api/judge/reviews?submission_id=${encodeURIComponent(submissionId)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Erro ao carregar histórico.');
    setReviews(data.reviews || []);
  }, []);

  useEffect(() => {
    if (!selected?.id) return;
    const timer = window.setTimeout(() => {
      void loadHistory(selected.id).catch((error) => setNotice(error instanceof Error ? error.message : 'Erro ao carregar histórico.'));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadHistory, selected?.id]);

  const submitReview = async (formEvent: React.FormEvent) => {
    formEvent.preventDefault();
    if (!selected) return;

    setBusy(true);
    setNotice('');
    try {
      const response = await fetch('/api/judge/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submissionId: selected.id,
          expectedVersion: selected.currentVersion,
          decision,
          manualResult,
          justification
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Não foi possível aplicar a decisão.');

      setNotice('Decisão registrada com sucesso.');
      setJustification('');
      setManualResult('');
      await loadQueue();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Erro ao aplicar decisão.');
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = () => {
    logout();
    router.replace('/admin');
  };

  if (currentUser?.role !== 'judge') {
    return (
      <main className="mx-auto max-w-xl p-8 text-center">
        <h1 className="text-xl font-bold text-white">Acesso restrito a judges</h1>
        <p className="mt-2 text-sm text-muted">Entre com uma conta de judge atribuída a um qualifier.</p>
        <Link className="mt-4 inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-dark" href="/admin">
          Ir para login
        </Link>
      </main>
    );
  }

  const embedUrl = selected ? getYouTubeNoCookieEmbedUrl(selected.videoId) : null;

  return (
    <main className="mx-auto w-full max-w-7xl space-y-5 overflow-x-hidden px-4 py-6 sm:space-y-6 sm:px-6 sm:py-8 lg:px-8">
      <header className="border-b border-card-border pb-5">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Arbitragem</p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-balance text-2xl font-bold uppercase text-white sm:text-3xl">Dashboard do judge</h1>
          <div className="flex items-center gap-2">
            <p className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-bold tabular-nums text-primary">
              {queue.length} {queue.length === 1 ? 'pendência' : 'pendências'}
            </p>
            <button
              type="button"
              onClick={handleLogout}
              aria-label="Sair da conta de judge"
              className="inline-flex min-h-11 items-center gap-2 rounded-md border border-card-border bg-dark-gray px-3 py-2 text-xs font-bold uppercase tracking-wider text-muted transition-colors hover:border-red-500/40 hover:bg-red-950/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-dark"
            >
              <span>Sair</span>
              <LogOut className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">Revise apenas as submissões dos qualifiers atribuídos a você.</p>
      </header>

      {notice && (
        <p role="status" aria-live="polite" className="rounded-lg border border-card-border bg-card px-4 py-3 text-sm leading-6 text-muted">
          {notice}
        </p>
      )}

      <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-[20rem_minmax(0,1fr)] lg:gap-6">
        <aside aria-label="Fila de submissões pendentes" className="min-w-0 rounded-xl border border-card-border bg-card p-3 sm:p-4">
          <div className="mb-3 flex items-center justify-between gap-3 px-1">
            <h2 className="text-sm font-bold uppercase tracking-wider text-white">Fila de revisão</h2>
            <span className="text-xs text-muted">Deslize para ver</span>
          </div>

          {queue.length === 0 ? (
            <p className="rounded-lg border border-dashed border-card-border px-4 py-8 text-center text-sm leading-6 text-muted">
              Nenhuma submissão pendente.
            </p>
          ) : (
            <div className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain px-1 pb-2 pt-1 touch-pan-x lg:mx-0 lg:max-h-[calc(100vh-15rem)] lg:flex-col lg:overflow-x-hidden lg:overflow-y-auto lg:pr-2">
              {queue.map((item) => {
                const isSelected = selected?.id === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    aria-pressed={isSelected}
                    className={`min-h-28 min-w-[15rem] snap-start rounded-lg border p-4 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-card lg:min-w-0 ${
                      isSelected
                        ? 'border-primary bg-primary/10 text-white'
                        : 'border-card-border bg-dark-gray/30 text-muted hover:border-primary/60 hover:text-white'
                    }`}
                  >
                    <strong className="block truncate uppercase" title={item.athleteName}>{item.athleteName}</strong>
                    <span className="mt-1 block truncate text-xs" title={`${item.workoutCode} · ${item.workoutName}`}>
                      {item.workoutCode} · {item.workoutName}
                    </span>
                    <span className="mt-3 block font-mono text-base font-bold tabular-nums text-primary">{item.submittedResult}</span>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        {selected ? (
          <section aria-labelledby="judge-review-title" className="min-w-0 space-y-5 rounded-xl border border-card-border bg-card p-4 text-white sm:p-6">
            <div className="min-w-0">
              <p className="truncate text-xs font-bold uppercase tracking-wider text-primary" title={selected.eventName}>{selected.eventName}</p>
              <h2 id="judge-review-title" className="mt-1 text-pretty text-xl font-bold uppercase leading-tight sm:text-2xl">
                {selected.athleteName} <span className="text-muted">·</span> {selected.workoutName}
              </h2>
              <p className="mt-3 text-sm leading-6 text-muted">
                Score enviado: <span className="font-mono font-bold tabular-nums text-white">{selected.submittedResult}</span>
                {selected.athleteBox ? ` · ${selected.athleteBox}` : ''}
              </p>
              {selected.athleteNote && (
                <p className="mt-3 break-words rounded-lg border border-card-border bg-dark-gray/30 p-3 text-sm leading-6 text-muted">
                  <span className="font-bold text-white">Nota do atleta:</span> {selected.athleteNote}
                </p>
              )}
            </div>

            {embedUrl ? (
              <div className="w-full lg:w-1/2">
                <iframe
                  title={`Vídeo de ${selected.athleteName}`}
                  src={embedUrl}
                  className="aspect-video w-full rounded-lg border border-card-border bg-dark-gray"
                  loading="lazy"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              </div>
            ) : (
              <p className="rounded-lg border border-red-300/30 bg-red-300/10 p-3 text-sm leading-6 text-red-200">
                O link do vídeo não pôde ser incorporado. Solicite uma nova submissão ao atleta.
              </p>
            )}

            <form onSubmit={submitReview} className="space-y-4 border-t border-card-border pt-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label htmlFor="judge-decision" className="text-xs font-bold uppercase tracking-wider text-muted">
                  Decisão
                  <select id="judge-decision" name="decision" value={decision} onChange={(event) => setDecision(event.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-card-border bg-dark-gray px-3 py-2 text-sm text-white focus:border-primary/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                    <option value="validated">Validado — 100%</option>
                    <option value="penalized">Penalidade — 15%</option>
                    <option value="rejected">Resultado rejeitado</option>
                    <option value="manual_adjustment">Ajuste manual</option>
                  </select>
                </label>

                {decision === 'manual_adjustment' && (
                  <label htmlFor="judge-manual-result" className="text-xs font-bold uppercase tracking-wider text-muted">
                    Resultado ajustado
                    <input id="judge-manual-result" name="manualResult" required value={manualResult} onChange={(event) => setManualResult(event.target.value)} placeholder={selected.workoutType === 'fortime' ? 'MM:SS' : 'Valor'} className="mt-1 min-h-11 w-full rounded-md border border-card-border bg-dark-gray px-3 py-2 text-sm text-white placeholder:text-muted focus:border-primary/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary" />
                  </label>
                )}
              </div>

              <label htmlFor="judge-justification" className="block text-xs font-bold uppercase tracking-wider text-muted">
                Justificativa {decision !== 'validated' ? '*' : '(opcional)'}
                <textarea id="judge-justification" name="justification" required={decision !== 'validated'} value={justification} onChange={(event) => setJustification(event.target.value)} rows={3} placeholder={decision === 'validated' ? 'Justificativa opcional' : 'Explique a decisão aplicada'} className="mt-1 w-full rounded-md border border-card-border bg-dark-gray px-3 py-2 text-sm leading-6 text-white placeholder:text-muted focus:border-primary/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary" />
              </label>

              <button disabled={busy} className="min-h-11 w-full rounded-md bg-primary px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-ink transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">
                {busy ? 'Salvando...' : 'Registrar decisão'}
              </button>
            </form>

            <section aria-labelledby="judge-history-title" className="border-t border-card-border pt-5">
              <h3 id="judge-history-title" className="text-sm font-bold uppercase tracking-wider">Histórico da análise</h3>
              {reviews.length === 0 ? (
                <p className="mt-2 text-sm leading-6 text-muted">Sem análises anteriores.</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {reviews.map((review) => (
                    <article key={review.id} className="break-words rounded-lg bg-dark-gray/30 p-3 text-xs leading-5 text-muted">
                      <strong className="text-white">{review.judgeName}</strong> · {review.decision} · {new Date(review.reviewedAt).toLocaleString('pt-BR')}
                      {review.justification ? ` — ${review.justification}` : ''}
                    </article>
                  ))}
                </div>
              )}
            </section>
          </section>
        ) : (
          <section aria-labelledby="judge-empty-title" className="rounded-xl border border-dashed border-card-border bg-card p-8 text-center">
            <h2 id="judge-empty-title" className="text-lg font-bold text-white">Fila vazia</h2>
            <p className="mt-2 text-sm leading-6 text-muted">Quando houver uma submissão pendente, os detalhes de revisão aparecerão aqui.</p>
          </section>
        )}
      </div>
    </main>
  );
}
