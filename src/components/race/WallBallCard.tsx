'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Check, DoorOpen, Flag, Lock, Undo2, Users, X } from 'lucide-react';

import { useTapHold } from '@/components/sheet/useTapHold';
import type { RaceEvent } from '@/lib/raceRules';
import { RACE_PROVISIONAL_TIME_LABEL, formatRacePenalty } from '@/lib/raceWallBall';

// Tela de contagem do Wall Ball (Story 1.97; maquete aprovada em
// docs/design/fitness-race-sumula/telas/wall-ball.html, D23). Só apresentação:
// o estado vem do motor rodado no aparelho e cada ação vira um registro na
// fila (useRaceSync). REP no polegar com vibração (useTapHold); NO REP com os
// motivos do regulamento; infração geral com 1 toque, sem confirmação (D17);
// "Liberar" e "Atleta saiu" exigem segurar 700 ms (D18). Não há DQ na
// súmula: o caso grave é DNF, do organizador. Nenhum botão envia
// `exit` (D22): a saída é o registro `abandon`, que não fecha o tempo (D24).
// `closesTime` (Story 1.101, D34) diz se o Wall Ball é a última estação do
// percurso: só então "Liberar" fecha o tempo; no meio do percurso, o atleta
// segue para a próxima estação.

export type WallBallSheet = 'norep' | 'infra' | 'exit' | null;

export type WallBallCardProps = {
  athleteName: string;
  team: boolean;
  load: string;
  validReps: number;
  targetReps: number;
  noRepCount: number;
  penaltySeconds: number;
  lastAction: string;
  /** Tempo do atleta desde a largada (D21), já formatado; "—" sem largada. */
  elapsed: string;
  /** Saída registrada e ainda ativa (D24): horário HH:MM:SS. */
  abandonedAt: string | null;
  /** Liberado: tempo congelado no toque (provisório) e o oficial do servidor, se já veio. */
  released: { elapsed: string; official: string | null } | null;
  /** A estação é a última do percurso e a liberação fecha o tempo (Story 1.101, D34). Padrão: true. */
  closesTime?: boolean;
  noRepReasons: readonly { code: string; label: string }[];
  infractions: readonly { key: string; label: string; seconds: number; event: RaceEvent }[];
  canUndo: boolean;
  /** Fila parada (conflito, recusa, sessão) ou visualização sem escrita. */
  locked: boolean;
  nextHref: string;
  onRep: () => void;
  onNoRep: (reason: string) => void;
  onUndo: () => void;
  onInfraction: (event: RaceEvent) => void;
  onAbandon: () => void;
  onRelease: () => void;
  /** Só para a renderização de teste: abre a tela já com uma folha aberta. */
  initialSheet?: WallBallSheet;
};

const HINT_MS = 2200;

export function WallBallCard(props: WallBallCardProps) {
  const {
    athleteName, team, load, validReps, targetReps, noRepCount, penaltySeconds, lastAction, elapsed,
    abandonedAt, released, noRepReasons, infractions, canUndo, locked, nextHref,
    onRep, onNoRep, onUndo, onInfraction, onAbandon, onRelease
  } = props;
  const closesTime = props.closesTime !== false;
  const [sheet, setSheet] = useState<WallBallSheet>(props.initialSheet ?? null);
  const [hint, setHint] = useState<'release' | 'exit' | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (hintTimer.current) clearTimeout(hintTimer.current);
  }, []);

  const counterLocked = validReps >= targetReps;
  const missing = Math.max(0, targetReps - validReps);
  const showHint = (kind: 'release' | 'exit') => {
    setHint(kind);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(null), HINT_MS);
  };

  const rep = useTapHold({ onTap: onRep, onHold: () => {}, disabled: locked || counterLocked || Boolean(released) });
  const release = useTapHold({ onTap: () => showHint('release'), onHold: onRelease, disabled: locked || !counterLocked || Boolean(released) });
  const exit = useTapHold({
    onTap: () => showHint('exit'),
    onHold: () => {
      setSheet(null);
      onAbandon();
    },
    disabled: locked || counterLocked || Boolean(abandonedAt) || sheet !== 'exit'
  });

  const chip = 'rounded-full border border-card-border px-2 py-1 text-[11px] font-bold';
  const secondary = 'flex min-h-14 items-center justify-center gap-2 rounded-xl border-2 border-card-border bg-card px-3 text-sm font-extrabold disabled:opacity-40';

  const infoRow = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap gap-2">
        {team && (
          <span className={`${chip} flex items-center gap-1 border-primary/60`}>
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            Dupla · reps juntas
          </span>
        )}
        {load && <span className={chip}>{load}</span>}
        <span className={`${chip} tabular-nums`} aria-label="Tempo do atleta desde a largada">Tempo {elapsed}</span>
      </div>
      <span className={`${chip} ${penaltySeconds > 0 ? 'border-trading-down text-trading-down' : 'text-muted'}`}>{formatRacePenalty(penaltySeconds)}</span>
    </div>
  );

  if (released) {
    return (
      <div className="space-y-4">
        {infoRow}
        {closesTime ? (
          <div role="status" className="space-y-2 rounded-2xl border-2 border-trading-up bg-trading-up/10 p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-trading-up">Tempo na liberação</p>
            <p className="text-5xl font-extrabold tabular-nums">{released.elapsed}</p>
            <p className="text-sm font-semibold text-muted">{RACE_PROVISIONAL_TIME_LABEL}</p>
            {released.official && (
              <p className="text-sm font-extrabold">Tempo oficial (servidor): <span className="tabular-nums">{released.official}</span></p>
            )}
          </div>
        ) : (
          <div role="status" className="space-y-2 rounded-2xl border-2 border-trading-up bg-trading-up/10 p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-trading-up">Wall Ball liberado</p>
            <p className="text-xl font-extrabold">O atleta segue para a próxima estação.</p>
            <p className="text-sm font-semibold text-muted">O tempo da prova fecha na última estação do percurso.</p>
          </div>
        )}
        <p className="text-center text-sm font-semibold">
          <span className="text-3xl font-extrabold tabular-nums">{validReps}</span> de {targetReps} reps válidas · {penaltySeconds > 0 ? formatRacePenalty(penaltySeconds) : 'sem penalidade'}
        </p>
        <p className="text-center text-sm text-muted">A tentativa foi encerrada. Correção de tempo ou de penalidade é com o organizador.</p>
        <Link href={nextHref} className="flex min-h-14 items-center justify-center rounded-xl border-2 border-foreground bg-primary text-base font-extrabold text-ink">
          Próximo atleta
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {infoRow}
      {abandonedAt && !counterLocked && (
        <div role="status" className="rounded-xl border-2 border-primary bg-primary/10 px-4 py-3">
          <p className="font-extrabold">Saída registrada às <span className="tabular-nums">{abandonedAt}</span> · faltam {missing} reps</p>
          <p className="text-sm text-muted">Oriente o atleta a voltar e completar. O tempo segue correndo.</p>
        </div>
      )}

      <div className="text-center">
        <p className={`text-[112px] font-extrabold leading-none tabular-nums ${counterLocked ? 'text-trading-up' : ''}`} aria-hidden="true">{validReps}</p>
        <p className="flex items-center justify-center gap-1 text-sm font-bold text-muted">
          {counterLocked && <Lock className="h-4 w-4" aria-hidden="true" />}
          de {targetReps} reps válidas
        </p>
        <span className="sr-only" aria-live="polite">{validReps} de {targetReps}</span>
      </div>
      <div role="progressbar" aria-label="Reps válidas" aria-valuemin={0} aria-valuemax={targetReps} aria-valuenow={validReps} className="h-2 overflow-hidden rounded-full bg-dark-gray">
        <i className={`block h-full ${counterLocked ? 'bg-trading-up' : 'bg-primary'}`} style={{ width: `${Math.min(100, (validReps / Math.max(1, targetReps)) * 100)}%` }} />
      </div>
      <p className="min-h-5 text-center text-sm font-semibold" aria-live="polite">
        {lastAction ? `Último: ${lastAction}` : ''} <span className="text-muted">· {noRepCount} {noRepCount === 1 ? 'no-rep' : 'no-reps'}</span>
      </p>

      {counterLocked ? (
        <>
          <p className="flex items-center justify-center gap-1 text-sm font-extrabold text-trading-up">
            <Lock className="h-4 w-4" aria-hidden="true" />
            Contador travado em {targetReps}
          </p>
          <button
            type="button"
            {...release.handlers}
            disabled={locked}
            aria-label={closesTime ? 'Liberar o atleta: segure o botão. Fecha o tempo da corrida, sem desfazer.' : 'Liberar o atleta: segure o botão. O atleta segue para a próxima estação, sem desfazer.'}
            className="relative flex min-h-[120px] w-full touch-none select-none flex-col items-center justify-center gap-1 overflow-hidden rounded-2xl border-2 border-foreground bg-trading-up px-4 py-3 text-ink disabled:opacity-40"
          >
            <span
              aria-hidden="true"
              className={`absolute inset-y-0 left-0 bg-foreground/25 ${release.holding ? 'motion-safe:transition-[width] motion-safe:duration-700 motion-safe:ease-linear' : ''}`}
              style={{ width: release.holding ? '100%' : '0%' }}
            />
            <span className="relative flex items-center gap-2 text-xl font-extrabold uppercase">
              <Flag className="h-6 w-6" aria-hidden="true" />
              {release.holding ? 'Continue segurando…' : 'Segure para liberar'}
            </span>
            <span className="relative text-xs font-bold">{closesTime ? 'Fecha o tempo da corrida · sem desfazer' : 'Segue para a próxima estação · sem desfazer'}</span>
          </button>
          {hint === 'release' && <p role="status" className="text-center text-sm font-extrabold">Segure para liberar</p>}
        </>
      ) : (
        <button
          type="button"
          {...rep.handlers}
          disabled={locked}
          aria-label={`REP válida. ${validReps} de ${targetReps}`}
          className={`flex min-h-[160px] w-full touch-none select-none flex-col items-center justify-center gap-1 rounded-2xl border-2 border-foreground bg-primary text-ink active:brightness-90 disabled:opacity-40 ${rep.holding ? 'brightness-95' : ''}`}
        >
          <span className="flex items-center gap-2 text-4xl font-extrabold">REP <Check className="h-8 w-8" aria-hidden="true" /></span>
          <span className="text-xs font-bold">Toque a cada repetição válida</span>
        </button>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={secondary} disabled={locked || counterLocked} onClick={() => setSheet('norep')}>
          <X className="h-5 w-5" aria-hidden="true" />
          NO REP
        </button>
        <button type="button" className={secondary} disabled={locked || !canUndo} onClick={onUndo}>
          <Undo2 className="h-5 w-5" aria-hidden="true" />
          Desfazer último
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={secondary} disabled={locked} onClick={() => setSheet('infra')}>
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          Infração geral
        </button>
        <button type="button" className={secondary} disabled={locked || counterLocked || Boolean(abandonedAt)} onClick={() => setSheet('exit')}>
          <DoorOpen className="h-4 w-4" aria-hidden="true" />
          {abandonedAt ? 'Saída registrada' : 'Atleta saiu'}
        </button>
      </div>

      {sheet && (
        <div className="fixed inset-0 z-40 flex items-end bg-black/50" onClick={(event) => { if (event.target === event.currentTarget) setSheet(null); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="wall-ball-sheet-title" className="max-h-[85vh] w-full space-y-3 overflow-y-auto rounded-t-2xl border-t border-card-border bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {sheet === 'norep' && (
              <>
                <h2 id="wall-ball-sheet-title" className="text-lg font-extrabold">Motivo do NO REP</h2>
                <p className="text-sm text-muted">Um toque registra. Não conta rep.</p>
                <div className="grid grid-cols-2 gap-2">
                  {noRepReasons.map((reason) => (
                    <button key={reason.code} type="button" className={secondary} onClick={() => { setSheet(null); onNoRep(reason.code); }}>
                      {reason.label}
                    </button>
                  ))}
                </div>
                <button type="button" className={`${secondary} w-full`} onClick={() => setSheet(null)}>Cancelar</button>
              </>
            )}
            {sheet === 'infra' && (
              <>
                <h2 id="wall-ball-sheet-title" className="text-lg font-extrabold">Infração geral</h2>
                <p className="text-sm text-muted">Um toque registra, vale na hora e soma ao tempo. Errou? Use &quot;Desfazer último&quot;.</p>
                <ul className="space-y-2">
                  {infractions.map((item, index) => (
                    <li key={item.key}>
                      <button
                        type="button"
                        data-one-tap-infraction
                        className={`flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border-2 bg-card px-4 text-left text-sm font-extrabold ${index === 0 ? 'border-primary' : 'border-card-border'}`}
                        onClick={() => { setSheet(null); onInfraction(item.event); }}
                      >
                        <span>{item.label}</span>
                        <span className="shrink-0 tabular-nums text-trading-down">{formatRacePenalty(item.seconds)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <button type="button" className={`${secondary} w-full`} onClick={() => setSheet(null)}>Cancelar</button>
              </>
            )}
            {sheet === 'exit' && (
              <>
                <h2 id="wall-ball-sheet-title" className="text-lg font-extrabold">{athleteName} saiu antes das {targetReps} reps</h2>
                <div className="flex items-center justify-between rounded-xl border-2 border-primary px-4 py-3 text-sm font-extrabold">
                  <span>{validReps} de {targetReps} reps válidas</span>
                  <span>Faltam {missing} reps</span>
                </div>
                <p className="text-sm font-bold">Oriente o atleta a voltar e completar as {missing} reps.</p>
                <p className="text-sm text-muted">O tempo segue correndo: ele só fecha na liberação, com {targetReps} válidas.</p>
                <button
                  type="button"
                  {...exit.handlers}
                  aria-label="Registrar a saída: segure o botão. Não fecha o tempo."
                  className="relative flex min-h-[88px] w-full touch-none select-none flex-col items-center justify-center gap-1 overflow-hidden rounded-2xl border-2 border-foreground bg-primary px-4 py-3 text-ink"
                >
                  <span
                    aria-hidden="true"
                    className={`absolute inset-y-0 left-0 bg-foreground/25 ${exit.holding ? 'motion-safe:transition-[width] motion-safe:duration-700 motion-safe:ease-linear' : ''}`}
                    style={{ width: exit.holding ? '100%' : '0%' }}
                  />
                  <span className="relative flex items-center gap-2 text-base font-extrabold uppercase">
                    <DoorOpen className="h-5 w-5" aria-hidden="true" />
                    {exit.holding ? 'Continue segurando…' : 'Segure para registrar a saída'}
                  </span>
                  <span className="relative text-xs font-bold">Não fecha o tempo</span>
                </button>
                {hint === 'exit' && <p role="status" className="text-center text-sm font-extrabold">Segure para registrar a saída</p>}
                <button type="button" className={`${secondary} w-full`} onClick={() => setSheet(null)}>Voltar</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
