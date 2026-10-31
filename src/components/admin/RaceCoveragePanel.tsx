'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowRight, Check, Clock, CloudOff, List, RefreshCw, Users } from 'lucide-react';

import { focusRaceAssignmentsWave } from '@/components/admin/RaceAssignmentsPanel';
import { raceButton } from '@/components/admin/RaceDecisionDialog';
import {
  RACE_COVERAGE_ESTIMATE_NOTE,
  RACE_COVERAGE_NO_SCHEDULE_GUIDE,
  RACE_COVERAGE_NO_SCHEDULE_NOTE,
  RACE_COVERAGE_ONLY_WARNS,
  RACE_COVERAGE_PREP_NOTICE,
  RACE_COVERAGE_REFRESH_MS,
  describeRaceCoverageFailure,
  type RaceCoverage,
  type RaceCoverageAlert,
  type RaceCoverageJudge,
  type RaceCoverageStation,
  type RaceCoverageWave
} from '@/lib/raceCoverage';
import { formatRaceClock } from '@/lib/raceWaves';
import type { Event } from '@/types';

// Seção "Cobertura ao vivo" da aba Súmula Fitness Race (Story 1.105; maquete
// aprovada telas/cobertura.html, D42). Por onda: estações com judge, quem está
// com quantos cartões, atletas esperando (estimativa) e os avisos no topo. Só
// avisa (D3): nada aqui bloqueia a súmula, a abertura de cartões ou a largada,
// e não há ação de troca de judge nem de soltar cartão. Evento sem escala: sem
// aviso, sem estimativa e sem selo Coberta/Atenção, só a orientação "Montar a
// escala" e o resumo do que já foi aberto (D40). Judge fora da escala aparece
// com o selo neutro "Fora da escala" (D41). Atualiza a cada 15 s só com a aba
// visível (visibilitychange); a falha de rede mantém o último dado na tela.
// Cartões altos, sem tabela com rolagem lateral (D20).

type Payload = RaceCoverage & {
  event: { id: string; name: string; timeZone: string };
  assignmentsAvailable: boolean;
  assignmentsMigration: string | null;
};

type Tone = 'up' | 'pri' | 'down' | 'mut' | 'fg';
const CHIP_TONES: Record<Tone, string> = {
  up: 'border-trading-up/60 text-trading-up',
  pri: 'border-primary/60 text-primary',
  down: 'border-trading-down/60 text-trading-down',
  mut: 'border-card-border text-muted',
  fg: 'border-muted-soft text-foreground'
};

function Chip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${CHIP_TONES[tone]}`}>
      {children}
    </span>
  );
}

const JUDGE_TONES: Record<RaceCoverageJudge['state'], Tone> = { over: 'down', full: 'pri', free: 'up', scheduled: 'mut', neutral: 'mut' };

const stationAnchor = (key: string) => `cov-stn-${key}`;

function Stat({ label, value, detail, attention }: { label: string; value: string; detail: string; attention?: boolean }) {
  return (
    <div className={`grid gap-0.5 rounded-xl border bg-dark-gray p-3.5 ${attention ? 'border-primary' : 'border-card-border'}`}>
      <span className="text-[11px] font-bold uppercase tracking-wider text-muted">{label}</span>
      <span className={`text-2xl font-bold tabular-nums leading-tight ${attention ? 'text-primary' : 'text-white'}`}>{value}</span>
      <span className="text-xs text-muted">{detail}</span>
    </div>
  );
}

function AlertCard({ alert, waveId }: { alert: RaceCoverageAlert; waveId: string }) {
  return (
    <article role="listitem" className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-lg border border-primary bg-dark-gray px-3.5 py-3 lg:grid-cols-[auto_minmax(0,1fr)_auto]">
      <AlertTriangle className="mt-0.5 h-[18px] w-[18px] text-primary" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-wider text-primary">{alert.label}</p>
        <p className="text-sm font-semibold text-white">{alert.text}</p>
        <p className="text-xs text-muted">{alert.hint}</p>
      </div>
      <div className="col-span-2 flex flex-wrap gap-1.5 lg:col-span-1 lg:justify-end">
        {alert.openAssignments && (
          <button type="button" className={raceButton} onClick={() => focusRaceAssignmentsWave(waveId)}>
            <List className="h-4 w-4" aria-hidden="true" /> Abrir a escala da onda
          </button>
        )}
        <a className={raceButton} href={`#${stationAnchor(alert.stationKey)}`}>
          <ArrowRight className="h-4 w-4" aria-hidden="true" /> Ver a estação
        </a>
      </div>
    </article>
  );
}

function StationCard({ station, wave, hasAssignments, openWaveAssignments }: {
  station: RaceCoverageStation;
  wave: RaceCoverageWave;
  hasAssignments: boolean;
  openWaveAssignments: () => void;
}) {
  const started = Boolean(wave.startedAt);
  const attention = station.status === 'attention';
  return (
    <article
      id={stationAnchor(station.key)}
      aria-labelledby={`${stationAnchor(station.key)}-h`}
      className={`grid scroll-mt-4 content-start gap-2.5 rounded-xl border bg-dark-gray p-3.5 ${attention ? 'border-primary' : 'border-card-border'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center">
            <span className="mr-2 inline-flex h-7 min-w-7 items-center justify-center rounded-md border border-card-border text-[13px] font-bold tabular-nums text-white">{station.order}</span>
            <b id={`${stationAnchor(station.key)}-h`} className="text-[15px] text-white">{station.name}</b>
          </div>
          <p className="mt-0.5 text-xs text-muted">{[station.kindLabel, station.meta].filter(Boolean).join(' · ')}</p>
        </div>
        {station.status === 'no_schedule'
          ? <Chip tone="mut">Sem escala</Chip>
          : attention ? <Chip tone="pri">Atenção</Chip> : <Chip tone="up">Coberta</Chip>}
      </div>
      {station.onlyIn.length > 0 && (
        <p><Chip tone="fg"><Users className="h-3.5 w-3.5" aria-hidden="true" />Só no percurso de {station.onlyIn.join(', ')}</Chip></p>
      )}
      {station.waiting !== null && (
        <div className="flex items-baseline justify-between gap-2.5 border-t border-card-border pt-2">
          <span className="text-xs text-muted">Atletas esperando (estimativa)</span>
          <b className={`text-lg tabular-nums ${station.waiting > 0 ? 'text-primary' : 'text-white'}`}>{station.waiting > 0 ? `≈ ${station.waiting}` : '0'}</b>
        </div>
      )}

      {hasAssignments ? (
        <>
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted">{started ? `Judges · cartões abertos de ${station.limit}` : 'Judges escalados'}</p>
          {station.judges.length > 0 ? (
            <ul className="grid gap-1.5">
              {station.judges.map((judge) => (
                <li key={judge.judgeUserId} className="flex min-h-9 items-center justify-between gap-2 rounded-lg border border-card-border px-2.5 py-1.5 text-[13px]">
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-bold text-white">{judge.name}</span>
                    {judge.outside && <Chip tone="fg">Fora da escala</Chip>}
                  </span>
                  <Chip tone={JUDGE_TONES[judge.state]}>{judge.label}</Chip>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted">Nenhum judge escalado nesta onda.</p>
          )}
        </>
      ) : started ? (
        <>
          {/* Sem escala todos estão fora dela: o selo não se repete em cada linha (D41). */}
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted">Judges com cartão aberto</p>
          {station.judges.length > 0 ? (
            <ul className="grid gap-1.5">
              {station.judges.map((judge) => (
                <li key={judge.judgeUserId} className="flex min-h-9 items-center justify-between gap-2 rounded-lg border border-card-border px-2.5 py-1.5 text-[13px]">
                  <span className="font-bold text-white">{judge.name}</span>
                  <Chip tone="mut">{judge.label}</Chip>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted">Nenhum judge abriu esta estação.</p>
          )}
        </>
      ) : null}

      {started ? (
        <>
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted">Cartões abertos · {station.cards.length}</p>
          {station.cards.length > 0 ? (
            <ul className="grid gap-1.5">
              {station.cards.map((card) => {
                const loose = !card.judgeUserId;
                return (
                  <li key={card.attemptId} className={`flex min-h-9 items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-[13px] ${loose && hasAssignments ? 'border-primary' : 'border-card-border'}`}>
                    <span className="min-w-0">
                      <span className="font-bold text-white">{card.athleteName}</span>
                      <span className="block text-xs text-muted">
                        {[card.progress, loose && card.looseSince ? `${hasAssignments ? 'solto às' : 'sem judge desde'} ${card.looseSince}` : ''].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    {loose
                      ? (hasAssignments ? <Chip tone="pri">Sem judge</Chip> : <span className="text-xs text-muted">Sem judge</span>)
                      : <span className="text-xs text-muted">{card.judgeName}</span>}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-[13px] text-muted">Nenhum cartão aberto.</p>
          )}
        </>
      ) : !hasAssignments ? (
        <p className="text-[13px] text-muted">A onda ainda não largou.</p>
      ) : null}

      {hasAssignments && (
        <div>
          <button type="button" className={raceButton} onClick={openWaveAssignments}>
            <List className="h-4 w-4" aria-hidden="true" /> Escala desta onda
          </button>
        </div>
      )}
    </article>
  );
}

export function RaceCoveragePanel({ event }: { event: Event }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      const response = await fetch(`/api/race-sheets?view=coverage&eventId=${encodeURIComponent(event.id)}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Erro ao carregar a cobertura.');
      setPayload(data as Payload);
      setUpdatedAt(new Date().toISOString());
      setFailure(null);
    } catch (cause) {
      // Falha de rede mantém o último dado na tela (AC5): só o aviso muda.
      setFailure(cause instanceof Error ? cause.message : 'Erro ao carregar a cobertura.');
    } finally {
      inFlight.current = false;
      setRefreshing(false);
    }
  }, [event.id]);

  // Atualiza a cada 15 s só enquanto a aba está visível; ao voltar, lê na hora (AC5).
  useEffect(() => {
    let interval: number | null = null;
    const start = () => {
      if (interval === null) interval = window.setInterval(() => void load(), RACE_COVERAGE_REFRESH_MS);
    };
    const stop = () => {
      if (interval !== null) window.clearInterval(interval);
      interval = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void load();
        start();
      } else {
        stop();
      }
    };
    const first = window.setTimeout(() => void load(), 0);
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearTimeout(first);
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load]);

  const timeZone = payload?.event.timeZone;
  const clock = updatedAt ? formatRaceClock(updatedAt, timeZone) : null;
  const waves = payload?.waves ?? [];
  const wave = waves.find((item) => item.id === choice) ?? waves.find((item) => item.id === payload?.defaultWaveId) ?? waves[0] ?? null;
  const hasAssignments = Boolean(payload?.hasAssignments);
  const failed = failure ? describeRaceCoverageFailure(clock) : null;

  const refreshButton = (label: string) => (
    <button type="button" className={raceButton} onClick={() => void load()} disabled={refreshing}>
      <RefreshCw className="h-4 w-4" aria-hidden="true" /> {label}
    </button>
  );

  let body: ReactNode;
  if (!payload && !failure) {
    body = (
      <>
        <p role="status" aria-live="polite" className="flex items-center gap-2.5 rounded-lg border border-card-border bg-dark-gray px-3 py-2.5 text-xs">
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Carregando a cobertura…
        </p>
        <div className="h-11 max-w-[520px] animate-pulse rounded-lg bg-elevated motion-reduce:animate-none" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[1, 2, 3, 4].map((item) => <div key={item} className="h-20 animate-pulse rounded-lg bg-elevated motion-reduce:animate-none" />)}
        </div>
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
          {[1, 2, 3].map((item) => <div key={item} className="h-56 animate-pulse rounded-lg bg-elevated motion-reduce:animate-none" />)}
        </div>
      </>
    );
  } else if (!payload) {
    body = (
      <p role="alert" className="flex flex-wrap items-center gap-2.5 rounded-lg border border-trading-down bg-dark-gray px-3 py-2.5 text-xs">
        <CloudOff className="h-4 w-4" aria-hidden="true" />
        <b className="text-trading-down">{failed?.title}</b>
        <span>{failure}</span>
        {refreshButton('Tentar de novo')}
      </p>
    );
  } else {
    const started = Boolean(wave?.startedAt);
    const summary = wave?.summary;
    body = (
      <>
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div role="group" aria-label="Filtrar por onda" className="flex flex-wrap overflow-hidden rounded-lg border border-card-border">
            {waves.map((item) => {
              const count = item.alerts.length;
              const base = item.startedAt ? `largou às ${formatRaceClock(item.startedAt, timeZone).slice(0, 5)}` : `largada ${item.time || '—'} · não largou`;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={wave?.id === item.id}
                  onClick={() => setChoice(item.id)}
                  className={`grid min-h-11 gap-px border-b-2 border-r border-r-card-border px-3 py-1 text-left text-xs font-bold last:border-r-0 ${wave?.id === item.id ? 'border-b-primary bg-elevated text-white' : 'border-b-transparent bg-dark-gray text-muted'}`}
                >
                  <span>{item.title}</span>
                  <span className="text-[11px] font-semibold">
                    {base}
                    {hasAssignments && (count > 0 ? <> · <span className="tabular-nums text-primary">{count} {count === 1 ? 'aviso' : 'avisos'}</span></> : ' · sem aviso')}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2.5 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" /> Atualizado às <span className="tabular-nums">{clock ?? '—'}</span> · atualiza a cada 15 s com a aba aberta
            </span>
            {refreshButton('Atualizar')}
          </div>
        </div>

        {failed && (
          <p role="alert" className="flex flex-wrap items-center gap-2.5 rounded-lg border border-trading-down bg-dark-gray px-3 py-2.5 text-xs">
            <CloudOff className="h-4 w-4" aria-hidden="true" />
            <b className="text-trading-down">{failed.title}</b>
            <span>{failed.detail}</span>
            {refreshButton('Tentar de novo')}
          </p>
        )}

        {!wave ? (
          <p className="text-sm text-muted">Nenhuma onda com atletas no cronograma. Monte as ondas na aba Cronograma para ver a cobertura.</p>
        ) : (
          <>
            <p className="flex flex-wrap items-center gap-2 text-[13px]">
              <b className="text-sm text-white">{wave.title}</b>
              <span className="text-muted">·</span>
              {wave.startedAt
                ? <Chip tone="up">Largou às <span className="tabular-nums">{formatRaceClock(wave.startedAt, timeZone)}</span></Chip>
                : <Chip tone="mut">Aguardando largada{wave.time ? ` · previsto ${wave.time}` : ''}</Chip>}
              {wave.categories.length > 0 && <span className="text-muted">Categorias: {wave.categories.join(', ')}</span>}
              {wave.source === 'wave' && <Chip tone="pri">Escala ajustada nesta onda</Chip>}
              {wave.source === 'default' && <Chip tone="mut">Escala: segue o padrão</Chip>}
            </p>

            {!started && hasAssignments && (
              <p role="note" className="flex items-center gap-2.5 rounded-lg border border-primary bg-dark-gray px-3 py-2.5 text-xs">
                <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span><b>Visão de preparação.</b> {RACE_COVERAGE_PREP_NOTICE}</span>
              </p>
            )}

            {!hasAssignments ? (
              <div role="note" className="flex flex-wrap items-center gap-2.5 rounded-lg border border-primary bg-dark-gray px-3 py-2.5 text-xs">
                <List className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1">{RACE_COVERAGE_NO_SCHEDULE_GUIDE}</span>
                <button
                  type="button"
                  onClick={() => focusRaceAssignmentsWave(null)}
                  className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-bold uppercase tracking-wider text-ink hover:bg-primary-hover"
                >
                  <List className="h-4 w-4" aria-hidden="true" /> Montar a escala
                </button>
                {!payload.assignmentsAvailable && (
                  <span className="w-full text-muted">
                    A escala de judges ainda não está disponível neste ambiente{payload.assignmentsMigration ? ` (migration ${payload.assignmentsMigration} pendente)` : ''}.
                  </span>
                )}
              </div>
            ) : wave.alerts.length > 0 ? (
              <div role="list" aria-label={`Avisos da ${wave.title}`} className="grid gap-2.5">
                {wave.alerts.map((alert, index) => (
                  <AlertCard key={`${alert.kind}-${alert.stationKey}-${index}`} alert={alert} waveId={wave.id} />
                ))}
              </div>
            ) : (
              <p role="status" className="flex items-center gap-2.5 rounded-lg border border-card-border bg-dark-gray px-3 py-2.5 text-xs">
                <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span><b>Tudo coberto na {wave.title}.</b> Toda estação tem judge escalado e ninguém espera judge lotado.</span>
              </p>
            )}

            {summary && (hasAssignments ? (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat
                  label="Estações cobertas"
                  value={`${summary.covered} de ${summary.stations}`}
                  detail={summary.covered < summary.stations ? `${summary.stations - summary.covered} com atenção` : 'todas cobertas'}
                  attention={summary.covered < summary.stations}
                />
                <Stat
                  label="Judges escalados"
                  value={String(summary.judgesScheduled)}
                  detail={`${!summary.judgesScheduled ? 'ninguém escalado nesta onda' : !started ? 'escalados para esta onda' : `${summary.judgesFull} no limite`}${summary.outside ? ` · +${summary.outside} fora da escala` : ''}`}
                />
                <Stat
                  label="Cartões abertos"
                  value={started ? String(summary.cards) : '—'}
                  detail={started ? (summary.looseCards ? `${summary.looseCards} sem judge` : 'todos com judge') : 'onda não largou'}
                  attention={summary.looseCards > 0}
                />
                <Stat
                  label="Atletas esperando"
                  value={started ? `≈ ${summary.waiting ?? 0}` : '—'}
                  detail="estimativa pelo que a súmula sabe"
                  attention={(summary.waiting ?? 0) > 0}
                />
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Cartões abertos" value={started ? String(summary.cards) : '—'} detail={started ? 'nesta onda' : 'onda não largou'} />
                <Stat label="Judges com cartão" value={started ? String(summary.judgesWithCard) : '—'} detail="sem escala, todos fora dela" />
                <Stat label="Estações com cartão" value={started ? `${summary.stationsWithCard} de ${summary.stations}` : '—'} detail="na ordem do percurso" />
              </div>
            ))}

            {wave.stations.length > 0 ? (
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
                {wave.stations.map((station) => (
                  <StationCard
                    key={station.key}
                    station={station}
                    wave={wave}
                    hasAssignments={hasAssignments}
                    openWaveAssignments={() => focusRaceAssignmentsWave(wave.id)}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">Nenhuma estação no percurso das categorias desta onda. Monte o percurso na construção da prova.</p>
            )}

            <p className="max-w-[100ch] border-t border-card-border pt-3 text-xs text-muted">
              <b>{hasAssignments ? 'Sobre a estimativa:' : 'Sem escala:'}</b> {hasAssignments ? RACE_COVERAGE_ESTIMATE_NOTE : RACE_COVERAGE_NO_SCHEDULE_NOTE}
            </p>
          </>
        )}
      </>
    );
  }

  return (
    <section className="grid min-w-0 gap-4 rounded-xl border border-card-border bg-card p-5" aria-labelledby="race-coverage-title">
      <div className="flex flex-wrap items-end justify-between gap-2.5">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Súmula Fitness Race</p>
          <h3 id="race-coverage-title" className="mt-1 text-lg font-bold uppercase">Cobertura ao vivo</h3>
        </div>
        <p className="max-w-[56ch] text-xs text-muted">{RACE_COVERAGE_ONLY_WARNS}</p>
      </div>
      {body}
    </section>
  );
}
