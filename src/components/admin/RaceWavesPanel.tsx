'use client';

import { useCallback, useEffect, useState } from 'react';
import { CloudOff, Clock, Flag, RotateCcw } from 'lucide-react';

import { RaceDecisionDialog, postRaceDecision, raceButton, raceDangerButton, raceInput } from '@/components/admin/RaceDecisionDialog';
import { RaceHeatStartNotices } from '@/components/admin/RaceHeatStartNotices';
import { RaceHeatStartSheet } from '@/components/admin/RaceHeatStartSheet';
import { useHeatStart } from '@/components/race/useHeatStart';
import { describeHeatStartSync } from '@/lib/raceStartQueue';
import { describeWaveStart, formatRaceClock, nextRaceWaveId, type RaceWave } from '@/lib/raceWaves';
import type { Event } from '@/types';

// Seção "Ondas" da aba Súmula Fitness Race (Story 1.96, AC8; maquete
// telas/painel-organizador.html): as ondas do Cronograma com o estado da
// largada, o botão "Largar" (Story 1.110: a largada é só do organizador e
// acontece aqui, na folha com o gesto de segurar, também no tablet) e o botão
// "Corrigir largada" (AC7,
// D14a, na leva da Story 1.98): muda a largada da onda inteira, com motivo, e
// recalcula o bruto das corridas já fechadas pelo ponto único de republicação.
// "Zerar largada" (Story 1.107): cancela as corridas da onda, tira os resultados
// do leaderboard e deixa a onda largar de novo (teste real do organizador).

type WavesPayload = { event: { timeZone: string }; waves: RaceWave[] };

export function RaceWavesPanel({ event }: { event: Event }) {
  const [payload, setPayload] = useState<WavesPayload | null>(null);
  const [error, setError] = useState('');

  const [fixing, setFixing] = useState<RaceWave | null>(null);
  const [resetting, setResetting] = useState<RaceWave | null>(null);
  const [clock, setClock] = useState('');
  const [notice, setNotice] = useState('');
  const [startingId, setStartingId] = useState<string | null>(null);

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

  // Largada (Story 1.110): fila no aparelho com o horário do toque; o servidor confere o gestor dono.
  const markStarted = useCallback((heatId: string, startedAt: string) => {
    setPayload((previous) => (previous
      ? { ...previous, waves: previous.waves.map((wave) => (wave.id === heatId ? { ...wave, startedAt } : wave)) }
      : previous));
  }, []);
  const heatStart = useHeatStart({ eventId: event.id, onStarted: markStarted, onSettled: () => void load() });
  const flushHeatStart = heatStart.flush;

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(first);
  }, [load]);

  // Largada guardada (de uma sessão anterior ou parada) sobe a cada carga das ondas (REL-001);
  // sem nada na fila, ou com o envio em andamento, não faz nada.
  useEffect(() => {
    if (payload) flushHeatStart();
  }, [payload, flushHeatStart]);

  const openFix = (wave: RaceWave) => {
    setClock(wave.startedAt ? formatRaceClock(wave.startedAt, payload?.event.timeZone) : '');
    setFixing(wave);
  };

  const nextId = payload ? nextRaceWaveId(payload.waves) : null;
  const startingWave = startingId && payload ? payload.waves.find((wave) => wave.id === startingId) ?? null : null;
  const pendingStarts = heatStart.queue.length;
  const syncStalled = heatStart.syncStatus === 'offline' || heatStart.syncStatus === 'session';
  // /admin dentro de /admin não recarrega o contexto do app: a página inteira recarrega para o login aparecer
  // (REQ-001). A largada continua guardada no aparelho e sobe quando as ondas carregam de novo.
  const reloadPage = () => window.location.reload();
  const startingNotice = startingWave ? heatStart.notices.find((item) => item.heatId === startingWave.id) ?? null : null;

  return (
    <section className="space-y-4 rounded-xl border border-card-border bg-card p-5" aria-labelledby="race-waves-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Largada</p>
          <h3 id="race-waves-title" className="text-lg font-bold uppercase">Ondas</h3>
          <p className="text-xs text-muted md:text-sm">As ondas vêm da aba Cronograma. A largada é só sua: toque em &quot;Largar&quot; e segure o botão. Os árbitros não largam ondas.</p>
        </div>
      </div>

      {(pendingStarts > 0 || syncStalled) && (
        <div
          role="status"
          aria-live="polite"
          className={`flex min-h-14 flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-2 text-sm font-bold ${syncStalled ? 'border-trading-down text-trading-down' : 'border-primary'}`}
        >
          <span className="flex items-center gap-2">
            {syncStalled && <CloudOff className="h-5 w-5 shrink-0" aria-hidden="true" />}
            {describeHeatStartSync(heatStart.syncStatus, pendingStarts)}
          </span>
          {heatStart.syncStatus === 'session' && (
            <button type="button" onClick={reloadPage} className="inline-flex min-h-14 items-center rounded-lg border border-card-border px-4 text-xs font-bold uppercase tracking-wider hover:border-primary">Entrar de novo</button>
          )}
        </div>
      )}

      <RaceHeatStartNotices
        notices={heatStart.notices}
        waves={payload?.waves ?? []}
        openHeatId={startingWave?.id ?? null}
        onDismiss={heatStart.dismissNotice}
        onReload={reloadPage}
      />

      {error ? (
        <p role="alert" className="rounded-md border border-red-500/40 bg-red-950/20 px-3 py-2 text-sm">{error}</p>
      ) : !payload ? (
        <p role="status" className="text-sm text-muted">Carregando ondas…</p>
      ) : payload.waves.length === 0 ? (
        <p className="text-sm text-muted">Nenhuma onda com atletas. Monte as ondas na aba Cronograma.</p>
      ) : (
        <ul className="space-y-2" aria-label="Ondas do evento">
          {payload.waves.map((wave) => (
            <li key={wave.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-lg bg-dark-gray px-3 py-3 md:gap-4 md:px-4 md:py-4 ${wave.id === nextId ? 'border-2 border-primary' : 'border border-card-border'}`}>
              <div className="min-w-0">
                <p className="truncate font-bold md:text-lg">
                  {wave.id === nextId && <span className="mr-2 text-[10px] font-bold uppercase tracking-widest text-primary">Próxima</span>}
                  {wave.title}
                </p>
                <p className="text-xs text-muted md:text-sm">
                  <span className="tabular-nums">{wave.time || '—'}</span> previsto
                  {wave.categories.length > 0 && ` · ${wave.categories.join(' · ')}`}
                  {` · ${wave.athletes.length} ${wave.athletes.length === 1 ? 'atleta' : 'atletas'}`}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 md:gap-3">
                <span className={`rounded-full border px-2 py-1 text-[11px] font-bold tabular-nums md:text-xs ${wave.startedAt ? 'border-trading-up/60 text-trading-up' : heatStart.queue.some((item) => item.heatId === wave.id) ? 'border-trading-down text-trading-down' : 'border-card-border text-muted'}`}>
                  {!wave.startedAt && heatStart.queue.some((item) => item.heatId === wave.id) ? 'Guardada no aparelho' : describeWaveStart(wave.startedAt, payload.event.timeZone)}
                </span>
                {!wave.startedAt && (
                  <button
                    type="button"
                    className={`${raceButton} md:min-h-14 md:px-6 md:text-sm ${wave.id === nextId ? 'border-primary bg-primary text-ink hover:bg-primary-hover' : ''}`}
                    onClick={() => setStartingId(wave.id)}
                    aria-label={`Largar a ${wave.title}`}
                  >
                    <Flag className="h-4 w-4 md:h-5 md:w-5" aria-hidden="true" /> Largar
                  </button>
                )}
                {wave.startedAt && (
                  <button type="button" className={`${raceButton} md:min-h-14 md:px-5`} onClick={() => openFix(wave)} aria-label={`Corrigir a largada da ${wave.title}`}>
                    <Clock className="h-4 w-4" aria-hidden="true" /> Corrigir largada
                  </button>
                )}
                {wave.startedAt && (
                  <button type="button" className={`${raceDangerButton} md:min-h-14 md:px-5`} onClick={() => setResetting(wave)} aria-label={`Zerar a largada da ${wave.title}`}>
                    <RotateCcw className="h-4 w-4" aria-hidden="true" /> Zerar largada
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {startingWave && payload && (
        <RaceHeatStartSheet
          wave={startingWave}
          timeZone={payload.event.timeZone}
          queued={heatStart.queue.find((item) => item.heatId === startingWave.id) ?? null}
          syncStatus={heatStart.syncStatus}
          pendingCount={pendingStarts}
          notice={startingNotice}
          onStart={() => heatStart.start(startingWave.id)}
          onReload={reloadPage}
          onClose={() => setStartingId(null)}
        />
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
      {resetting && payload && (
        <RaceDecisionDialog
          title={`Zerar largada da ${resetting.title}`}
          subtitle={`Largada registrada: ${resetting.startedAt ? formatRaceClock(resetting.startedAt, payload.event.timeZone) : '—'} · ${resetting.athletes.length} ${resetting.athletes.length === 1 ? 'atleta' : 'atletas'}`}
          reasonLabel="Motivo para zerar"
          consequence={(
            <div className="space-y-1">
              <p>
                {`${resetting.runsCount} ${resetting.runsCount === 1 ? 'corrida será cancelada' : 'corridas serão canceladas'}`}
                {` e ${resetting.resultsCount ?? 0} ${(resetting.resultsCount ?? 0) === 1 ? 'resultado sai' : 'resultados saem'} do leaderboard.`}
              </p>
              <p>Os cartões abertos dos judges nesta onda param de aceitar registros. A onda volta a &quot;Não largou&quot; e pode largar de novo pelo botão Largar.</p>
            </div>
          )}
          confirmText="Zerar largada"
          danger
          explicitConfirm="Entendi: as corridas desta onda são canceladas e os resultados saem do leaderboard."
          onClose={() => setResetting(null)}
          onSubmit={async (reason) => {
            const result = await postRaceDecision({ action: 'reset_heat', eventId: event.id, heatId: resetting.id, reason });
            setResetting(null);
            setNotice(`Largada da ${resetting.title} zerada: ${Number(result.runsCancelled ?? 0)} ${Number(result.runsCancelled ?? 0) === 1 ? 'corrida cancelada' : 'corridas canceladas'}. A onda pode largar de novo.${result.rulesetRenewed ? ' Nenhuma onda está correndo: a próxima largada usa o percurso como estiver na construção da prova.' : ''}`);
            await load();
          }}
        />
      )}
    </section>
  );
}
