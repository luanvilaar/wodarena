'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Clock, ExternalLink } from 'lucide-react';

import { RaceDecisionDialog, postRaceDecision, raceButton, raceInput } from '@/components/admin/RaceDecisionDialog';
import { describeWaveStart, formatRaceClock, type RaceWave } from '@/lib/raceWaves';
import type { Event } from '@/types';

// Seção "Ondas" da aba Súmula Fitness Race (Story 1.96, AC8; maquete
// telas/painel-organizador.html): as ondas do Cronograma com o estado da
// largada, o link para a tela de largada e o botão "Corrigir largada" (AC7,
// D14a, na leva da Story 1.98): muda a largada da onda inteira, com motivo, e
// recalcula o bruto das corridas já fechadas pelo ponto único de republicação.

type WavesPayload = { event: { timeZone: string }; waves: RaceWave[] };

export function RaceWavesPanel({ event }: { event: Event }) {
  const [payload, setPayload] = useState<WavesPayload | null>(null);
  const [error, setError] = useState('');

  const [fixing, setFixing] = useState<RaceWave | null>(null);
  const [clock, setClock] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/race-sheets?view=waves&eventId=${encodeURIComponent(event.id)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Erro ao carregar as ondas.');
      setPayload({ event: data.event, waves: data.waves || [] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erro ao carregar as ondas.');
    }
  }, [event.id]);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(first);
  }, [load]);

  const openFix = (wave: RaceWave) => {
    setClock(wave.startedAt ? formatRaceClock(wave.startedAt, payload?.event.timeZone) : '');
    setFixing(wave);
  };

  const startHref = `/judge/corrida/${encodeURIComponent(event.id)}`;

  return (
    <section className="space-y-4 rounded-xl border border-card-border bg-card p-5" aria-labelledby="race-waves-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Largada</p>
          <h3 id="race-waves-title" className="text-lg font-bold uppercase">Ondas</h3>
          <p className="text-xs text-muted">As ondas vêm da aba Cronograma. A largada é registrada na tela de largada, pelo árbitro ou por você.</p>
        </div>
        <Link
          href={startHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 text-xs font-bold uppercase tracking-wider text-primary hover:border-primary"
        >
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
          Abrir a tela de largada
        </Link>
      </div>

      {error ? (
        <p role="alert" className="rounded-md border border-red-500/40 bg-red-950/20 px-3 py-2 text-sm">{error}</p>
      ) : !payload ? (
        <p role="status" className="text-sm text-muted">Carregando ondas…</p>
      ) : payload.waves.length === 0 ? (
        <p className="text-sm text-muted">Nenhuma onda com atletas. Monte as ondas na aba Cronograma.</p>
      ) : (
        <ul className="space-y-2" aria-label="Ondas do evento">
          {payload.waves.map((wave) => (
            <li key={wave.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-card-border bg-dark-gray px-3 py-3">
              <div className="min-w-0">
                <p className="truncate font-bold">{wave.title}</p>
                <p className="text-xs text-muted">
                  <span className="tabular-nums">{wave.time || '—'}</span> previsto
                  {wave.categories.length > 0 && ` · ${wave.categories.join(' · ')}`}
                  {` · ${wave.athletes.length} ${wave.athletes.length === 1 ? 'atleta' : 'atletas'}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full border px-2 py-1 text-[11px] font-bold tabular-nums ${wave.startedAt ? 'border-trading-up/60 text-trading-up' : 'border-card-border text-muted'}`}>
                  {describeWaveStart(wave.startedAt, payload.event.timeZone)}
                </span>
                <Link
                  href={`${startHref}?onda=${encodeURIComponent(wave.id)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center rounded-md border border-card-border px-3 text-xs font-bold hover:border-primary"
                  aria-label={`Abrir a largada da ${wave.title}`}
                >
                  Abrir
                </Link>
                {wave.startedAt && (
                  <button type="button" className={raceButton} onClick={() => openFix(wave)} aria-label={`Corrigir a largada da ${wave.title}`}>
                    <Clock className="h-4 w-4" aria-hidden="true" /> Corrigir largada
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {notice && <p role="status" className="rounded-md border border-amber-400/50 bg-amber-950/30 px-3 py-2 text-sm">{notice}</p>}
      {fixing && payload && (
        <RaceDecisionDialog
          title={`Corrigir largada da ${fixing.title}`}
          subtitle={`Largada registrada: ${fixing.startedAt ? formatRaceClock(fixing.startedAt, payload.event.timeZone) : '—'} · previsto ${fixing.time || '—'} · ${fixing.athletes.length} ${fixing.athletes.length === 1 ? 'atleta' : 'atletas'}`}
          reasonLabel="Motivo da correção"
          consequence="Vale para a onda inteira. Recalcula o tempo bruto e o tempo oficial das corridas já fechadas e atualiza o resultado delas."
          confirmText="Corrigir largada"
          validate={() => (/^([01]?\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(clock.trim()) ? '' : 'Use o formato HH:MM:SS.')}
          onClose={() => setFixing(null)}
          onSubmit={async (reason) => {
            const result = await postRaceDecision({ action: 'adjust_heat_start', eventId: event.id, heatId: fixing.id, clock: clock.trim(), reason });
            setFixing(null);
            setNotice(result.republish && !result.republish.ok ? result.republish.warning || 'Largada corrigida, mas o resultado não foi atualizado. Tente de novo pelo painel.' : '');
            await load();
          }}
        >
          <label className="block space-y-1">
            <span className="text-xs font-bold uppercase tracking-wider">Horário correto da largada (HH:MM:SS)</span>
            <input value={clock} onChange={(changed) => setClock(changed.target.value)} placeholder="08:00:07" inputMode="numeric" className={raceInput} />
          </label>
          <p className="rounded-md border border-card-border bg-dark-gray px-3 py-2 text-sm">
            Largada: <span className="font-bold tabular-nums">{fixing.startedAt ? formatRaceClock(fixing.startedAt, payload.event.timeZone) : '—'}</span>
            {' → '}<span className="font-bold tabular-nums">{clock.trim() || '—'}</span>
          </p>
        </RaceDecisionDialog>
      )}
    </section>
  );
}
