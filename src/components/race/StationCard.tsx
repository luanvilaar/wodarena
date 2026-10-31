'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { AlertTriangle, Check, DoorOpen, Flag, Hand, Play, Plus, RotateCcw, Trash2, Undo2, Users } from 'lucide-react';

import { useTapHold } from '@/components/sheet/useTapHold';
import type { RaceEvent, RaceStationKind } from '@/lib/raceRules';
import { STATION_INLINE_REASONS_MAX, stationUnitNoun, type StationControls, type describeStationExit } from '@/lib/raceStation';
import { RACE_PROVISIONAL_TIME_LABEL, formatRacePenalty } from '@/lib/raceWallBall';

// Cartão do judge de uma estação (Story 1.102; desenho do cartão em
// docs/design/fitness-race-sumula/telas/dois-cartoes.html). Só apresentação:
// as regras (quais botões, quando "Liberar" acende, texto de "Atleta saiu")
// vêm de raceStation.ts, o estado vem do motor rodado no aparelho e cada ação
// vira um registro na fila (useRaceSync). Por tipo (D33): ergômetro e genérica
// com "Iniciar"; trenó e seções com o contador "+1"; seções com carga com
// devolução, carga errada (REFAZER) e Roxzone. Infração com 1 toque (D17),
// "Desfazer último" corrige; "Liberar", "Atleta saiu", "Saiu da Roxzone",
// "Refez" e "Não refez" exigem segurar 700 ms (D18). Na estação final
// (`oneAthlete`, D39) o cartão é a tela inteira de um atleta, como o Wall Ball:
// sem soltar nem dispensar; "Liberar" fecha o tempo e mostra o tempo do atleta
// e "Próximo atleta". A Story 1.103 coloca este mesmo cartão duas vezes na
// tela nas estações do meio do percurso (`contained`): as folhas abrem dentro
// do cartão e cobrem só ele, e o cartão ganha "Soltar" (com registros) ou
// "Dispensar" (sem registro), confirmados numa folha de dois botões (AC5).

export type StationCardSheet = 'station' | 'general' | 'exit' | 'relinquish' | 'dismiss' | null;

export type StationCardProps = {
  athleteName: string;
  team: boolean;
  kind: RaceStationKind;
  /** Meta ("4 trechos · 50m") e carga da categoria, do percurso do evento (D6). */
  target: string;
  load: string;
  /** A estação é a última do percurso e a liberação fecha o tempo (Story 1.101, D34). */
  closesTime: boolean;
  /** Estação final: tela de 1 atleta por judge (AC12, D39). */
  oneAthlete: boolean;
  controls: StationControls;
  units: number;
  expectedUnits: number | null;
  stationReasons: readonly { code: string; label: string }[];
  generalItems: readonly { key: string; label: string; seconds: number; event: RaceEvent }[];
  warningText: string;
  warningUsed: boolean;
  penaltySeconds: number;
  returnWrongSeconds: number;
  redoDeclinedSeconds: number;
  lastAction: string;
  /** Mensagem do motor para o último registro recusado na fila local. */
  refusal: string;
  /** Tempo na estação (AC8), já formatado; null antes do início. */
  stationElapsed: string | null;
  /** Tempo do atleta desde a largada da onda (D21), já formatado; "—" sem largada. */
  raceElapsed: string;
  exitInfo: ReturnType<typeof describeStationExit> | null;
  /** Liberado: horário, tempo na estação e, na estação final, o tempo do atleta congelado no toque e o oficial do servidor. */
  released: { at: string; stationElapsed: string; athleteElapsed: string; official: string | null } | null;
  /** Saída incompleta registrada (trenó ou seções). */
  exited: { missing: number; charge: string } | null;
  canUndo: boolean;
  /** Fila parada (conflito, recusa, sessão) ou visualização sem escrita. */
  locked: boolean;
  nextHref: string;
  onStart: () => void;
  onUnit: () => void;
  onStationInfraction: (code: string) => void;
  onGeneralInfraction: (event: RaceEvent) => void;
  onReturnWrong: () => void;
  onReturnCorrected: () => void;
  onLeaveRoxzone: () => void;
  onWrongLoad: () => void;
  onRedoDone: () => void;
  onRedoDeclined: () => void;
  onExit: () => void;
  onRelease: () => void;
  onUndo: () => void;
  /** Tela de dois cartões (Story 1.103, AC8): o cartão é uma caixa e as folhas abrem dentro dele, sem atingir o outro. */
  contained?: boolean;
  /** Cabeçalho do cartão na tela de dois cartões: nome, categoria e a sincronização do cartão. */
  header?: ReactNode;
  /** Selo "Novo" até o primeiro registro (cartão recém-aberto). */
  isNew?: boolean;
  /** O log da tentativa tem registro: "Soltar" no lugar de "Dispensar". */
  hasRecords?: boolean;
  /** Soltar o cartão (AC5): só nas estações de 2 cartões; nunca na tela de 1 atleta (D39). */
  onRelinquish?: () => void;
  /** Dispensar o cartão sem registro (AC5): só nas estações de 2 cartões. */
  onDismiss?: () => void;
  /** Soltar ou dispensar em andamento ou indisponível (registros na fila do aparelho). */
  cardActionsDisabled?: boolean;
  /** Fecha o resumo do cartão encerrado (tela de dois cartões). */
  onClose?: () => void;
  /** Só para a renderização de teste: abre o cartão já com uma folha aberta. */
  initialSheet?: StationCardSheet;
};

const HINT_MS = 2200;
const HOLD_TONES = {
  release: 'bg-trading-up text-ink',
  alt: 'bg-primary text-ink',
  danger: 'bg-trading-down text-white'
} as const;

/** Botão de segurar para confirmar (D18): o toque rápido só avisa "Segure…". */
function HoldButton({ label, sub, hint, onHold, disabled, tone, ariaLabel, icon, tall = false }: {
  label: string;
  sub?: string;
  hint: string;
  onHold: () => void;
  disabled: boolean;
  tone: keyof typeof HOLD_TONES;
  ariaLabel: string;
  icon?: ReactNode;
  tall?: boolean;
}) {
  const [showHint, setShowHint] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const hold = useTapHold({
    onTap: () => {
      setShowHint(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setShowHint(false), HINT_MS);
    },
    onHold,
    disabled
  });
  return (
    <div className="space-y-1">
      <button
        type="button"
        {...hold.handlers}
        disabled={disabled}
        aria-label={ariaLabel}
        data-hold-to-confirm
        className={`relative flex w-full touch-none select-none flex-col items-center justify-center gap-1 overflow-hidden rounded-2xl border-2 border-foreground px-4 py-3 disabled:opacity-40 ${tall ? 'min-h-[96px]' : 'min-h-14'} ${HOLD_TONES[tone]}`}
      >
        <span
          aria-hidden="true"
          className={`absolute inset-y-0 left-0 bg-foreground/25 ${hold.holding ? 'motion-safe:transition-[width] motion-safe:duration-700 motion-safe:ease-linear' : ''}`}
          style={{ width: hold.holding ? '100%' : '0%' }}
        />
        <span className="relative flex items-center gap-2 text-base font-extrabold uppercase">
          {icon}
          {hold.holding ? 'Continue segurando…' : label}
        </span>
        {sub && <span className="relative text-xs font-bold">{sub}</span>}
      </button>
      {showHint && <p role="status" className="text-center text-sm font-extrabold">{hint}</p>}
    </div>
  );
}

export function StationCard(props: StationCardProps) {
  const {
    athleteName, team, kind, target, load, closesTime, oneAthlete, controls, units, expectedUnits,
    stationReasons, generalItems, warningText, warningUsed, penaltySeconds, returnWrongSeconds, redoDeclinedSeconds,
    lastAction, refusal, stationElapsed, raceElapsed, exitInfo, released, exited, canUndo, locked, nextHref,
    onStart, onUnit, onStationInfraction, onGeneralInfraction, onReturnWrong, onReturnCorrected, onLeaveRoxzone,
    onWrongLoad, onRedoDone, onRedoDeclined, onExit, onRelease, onUndo,
    contained = false, header, isNew = false, hasRecords = false, onRelinquish, onDismiss, cardActionsDisabled = false, onClose
  } = props;
  const [sheet, setSheet] = useState<StationCardSheet>(props.initialSheet ?? null);
  // Dois cartões na tela: cada folha com o próprio id de título.
  const sheetId = useId();
  // Soltar e dispensar só nas estações de 2 cartões (AC5, D39).
  const cardAction = oneAthlete ? null : hasRecords ? (onRelinquish ? 'relinquish' : null) : (onDismiss ? 'dismiss' : null);
  const firstName = athleteName.split(' ')[0] || athleteName;
  const sectionClass = contained ? 'relative space-y-3 rounded-2xl border-2 border-card-border bg-background p-3' : 'space-y-3';

  const chip = 'rounded-full border border-card-border px-2 py-1 text-[11px] font-bold';
  const secondary = 'flex min-h-14 items-center justify-center gap-2 rounded-xl border-2 border-card-border bg-card px-3 text-sm font-extrabold disabled:opacity-40';
  const unitOne = stationUnitNoun(kind, 1);

  const chips = (
    <div className="flex flex-wrap items-center gap-2">
      {target && <span className={chip}>{target}</span>}
      {load && <span className={chip}>{load}</span>}
      {team && (
        <span className={`${chip} flex items-center gap-1 border-primary/60`}>
          <Users className="h-3.5 w-3.5" aria-hidden="true" />
          {contained ? 'Dupla · 1 cartão' : controls.counter ? 'Dupla · contados juntos' : 'Dupla'}
        </span>
      )}
      {closesTime && (
        <span className={`${chip} flex items-center gap-1 border-primary text-foreground`}>
          <Flag className="h-3.5 w-3.5" aria-hidden="true" />
          Fecha o tempo
        </span>
      )}
      {oneAthlete && <span className={chip}>1 atleta por judge</span>}
      {isNew && <span className={`${chip} border-primary`}>Novo</span>}
      {warningUsed && <span className={chip}>Advertência usada</span>}
      <span className={`${chip} ${penaltySeconds > 0 ? 'border-trading-down text-trading-down' : 'text-muted'}`}>{formatRacePenalty(penaltySeconds)}</span>
    </div>
  );

  if (released || exited) {
    return (
      <section aria-label={`Estação de ${athleteName}`} className={contained ? `${sectionClass} space-y-4` : 'space-y-4'}>
        {header}
        {chips}
        {exited ? (
          <div role="status" className="space-y-2 rounded-2xl border-2 border-primary bg-primary/10 p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest">Saída registrada</p>
            <p className="text-xl font-extrabold">Faltaram {exited.missing} {stationUnitNoun(kind, exited.missing)}: {exited.charge}</p>
            {closesTime ? (
              <p className="text-sm font-semibold">O tempo da prova não fecha: a corrida fica em &quot;Sem tempo fechado&quot; e o organizador decide o tempo final.</p>
            ) : (
              <p className="text-sm font-semibold text-muted">A estação foi encerrada. O atleta segue a prova.</p>
            )}
          </div>
        ) : released && closesTime ? (
          <div role="status" className="space-y-2 rounded-2xl border-2 border-trading-up bg-trading-up/10 p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-trading-up">Tempo do atleta</p>
            <p className="text-5xl font-extrabold tabular-nums">{released.athleteElapsed}</p>
            <p className="text-sm font-semibold text-muted">{RACE_PROVISIONAL_TIME_LABEL}</p>
            {released.official && (
              <p className="text-sm font-extrabold">Tempo oficial (servidor): <span className="tabular-nums">{released.official}</span></p>
            )}
          </div>
        ) : released && (
          <div role="status" className="space-y-2 rounded-2xl border-2 border-trading-up bg-trading-up/10 p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-trading-up">Liberado às <span className="tabular-nums">{released.at}</span></p>
            <p className="text-xl font-extrabold">Tempo na estação <span className="tabular-nums">{released.stationElapsed}</span></p>
            <p className="text-sm font-semibold text-muted">O atleta segue para a próxima estação. O tempo da prova fecha na última estação do percurso.</p>
          </div>
        )}
        {controls.counter && (
          <p className="text-center text-sm font-semibold">
            <span className="text-3xl font-extrabold tabular-nums">{units}</span> de {expectedUnits ?? '—'} {stationUnitNoun(kind, expectedUnits ?? units)} · {penaltySeconds > 0 ? formatRacePenalty(penaltySeconds) : 'sem penalidade'}
          </p>
        )}
        <p className="text-center text-sm text-muted">
          A tentativa foi encerrada. Correção de tempo ou de penalidade é com o organizador.{contained ? ' Sua vaga está livre.' : ''}
        </p>
        <div className={onClose ? 'grid grid-cols-2 gap-2' : ''}>
          {onClose && (
            <button type="button" onClick={onClose} className="flex min-h-14 w-full items-center justify-center rounded-xl border-2 border-card-border bg-card text-base font-extrabold">Fechar</button>
          )}
          <Link href={nextHref} className="flex min-h-14 items-center justify-center rounded-xl border-2 border-foreground bg-primary text-base font-extrabold text-ink">
            Próximo atleta
          </Link>
        </div>
      </section>
    );
  }

  const inlineReasons = stationReasons.length > 0 && stationReasons.length <= STATION_INLINE_REASONS_MAX;
  const reasonsSheet = stationReasons.length > STATION_INLINE_REASONS_MAX;

  return (
    <section aria-label={`Estação de ${athleteName}`} className={sectionClass}>
      {header}
      {chips}
      <p className="text-sm font-semibold" aria-label="Tempos do atleta">
        {stationElapsed !== null ? <>Na estação <b className="tabular-nums">{stationElapsed}</b> · </> : 'Ainda não iniciou · '}
        Desde a largada <b className="tabular-nums">{raceElapsed}</b> <span className="text-muted">(provisório)</span>
      </p>

      {controls.redo ? (
        <>
          <div role="status" className="rounded-xl border-2 border-primary bg-primary/10 px-4 py-3">
            <p className="font-extrabold">REFAZER com a carga certa</p>
            <p className="text-sm text-muted">O atleta volta e refaz com a carga certa. Se não refizer: {formatRacePenalty(redoDeclinedSeconds)}.</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <HoldButton label="Refez" sub="Segure" hint="Segure para confirmar que refez" onHold={onRedoDone} disabled={locked} tone="alt" ariaLabel="Refez com a carga certa: segure o botão." icon={<RotateCcw className="h-5 w-5" aria-hidden="true" />} />
            <HoldButton label="Não refez" sub={`${formatRacePenalty(redoDeclinedSeconds)} · segure`} hint="Segure para registrar que não refez" onHold={onRedoDeclined} disabled={locked} tone="danger" ariaLabel={`Não refez: segure o botão. Cobra ${formatRacePenalty(redoDeclinedSeconds)}.`} />
          </div>
        </>
      ) : controls.counter ? (
        <>
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1 text-center">
              <p className={`text-[88px] font-extrabold leading-none tabular-nums ${!controls.canAddUnit ? 'text-trading-up' : ''}`} aria-hidden="true">{units}</p>
              <p className="text-sm font-bold text-muted">de {expectedUnits ?? '—'} {stationUnitNoun(kind, expectedUnits ?? 2)}</p>
              <span className="sr-only" aria-live="polite">{units} de {expectedUnits ?? 'sem meta'}</span>
            </div>
            <button
              type="button"
              onClick={onUnit}
              disabled={locked || !controls.canAddUnit}
              aria-label={`Mais 1 ${unitOne}. ${units} de ${expectedUnits ?? 'sem meta'}`}
              className="flex min-h-[120px] min-w-[140px] flex-1 touch-manipulation select-none flex-col items-center justify-center gap-1 rounded-2xl border-2 border-foreground bg-primary text-ink active:brightness-90 disabled:opacity-40"
            >
              <span className="flex items-center gap-1 text-3xl font-extrabold"><Plus className="h-7 w-7" aria-hidden="true" />1</span>
              <span className="text-sm font-extrabold">{unitOne}</span>
            </button>
          </div>
          {expectedUnits !== null && (
            <div role="progressbar" aria-label={stationUnitNoun(kind, 2)} aria-valuemin={0} aria-valuemax={expectedUnits} aria-valuenow={units} className="h-2 overflow-hidden rounded-full bg-dark-gray">
              <i className={`block h-full ${controls.canAddUnit ? 'bg-primary' : 'bg-trading-up'}`} style={{ width: `${Math.min(100, (units / Math.max(1, expectedUnits)) * 100)}%` }} />
            </div>
          )}
        </>
      ) : controls.showStart ? (
        <button
          type="button"
          onClick={onStart}
          disabled={locked}
          className="flex min-h-[96px] w-full items-center justify-center gap-2 rounded-2xl border-2 border-foreground bg-primary text-2xl font-extrabold text-ink disabled:opacity-40"
        >
          <Play className="h-7 w-7" aria-hidden="true" />
          Iniciar
        </button>
      ) : null}

      <p className="min-h-5 text-center text-sm font-semibold" aria-live="polite">
        {lastAction ? `Último: ${lastAction}` : <span className="text-muted">Nenhum registro ainda</span>}
      </p>
      {refusal && <p role="alert" className="rounded-md border border-trading-down bg-trading-down/10 px-3 py-2 text-sm font-semibold">Recusado: {refusal}</p>}

      {!controls.redo && inlineReasons && (
        <div className="grid grid-cols-2 gap-2">
          {stationReasons.map((reason) => (
            <button key={reason.code} type="button" data-one-tap-infraction className={secondary} disabled={locked} onClick={() => onStationInfraction(reason.code)}>
              {reason.label}
            </button>
          ))}
        </div>
      )}
      {!controls.redo && reasonsSheet && (
        <button type="button" className={`${secondary} w-full border-primary`} disabled={locked} onClick={() => setSheet('station')}>
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          Infração da estação
        </button>
      )}

      {controls.load.openReturn ? (
        <>
          <div role="status" className="rounded-xl border-2 border-primary bg-primary/10 px-4 py-3">
            <p className="font-extrabold">Devolução incorreta: {formatRacePenalty(returnWrongSeconds)}</p>
            <p className="text-sm text-muted">Cancela se corrigir antes de sair da Roxzone.</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className={secondary} disabled={locked} onClick={onReturnCorrected}>
              <Check className="h-4 w-4" aria-hidden="true" />
              Devolução corrigida
            </button>
            <HoldButton label="Saiu da Roxzone" sub={`Segure · mantém ${formatRacePenalty(returnWrongSeconds).replace('+', '')}`} hint="Segure para registrar a saída da Roxzone" onHold={onLeaveRoxzone} disabled={locked} tone="alt" ariaLabel="Saiu da Roxzone: segure o botão. Fecha a janela de correção da devolução." />
          </div>
        </>
      ) : (controls.load.canReturnWrong || controls.load.canWrongLoad) && (
        <div className="grid grid-cols-2 gap-2">
          {controls.load.canReturnWrong && (
            <button type="button" className={secondary} disabled={locked} onClick={onReturnWrong}>Devolução incorreta</button>
          )}
          {controls.load.canWrongLoad && (
            <button type="button" className={secondary} disabled={locked} onClick={onWrongLoad}>Carga errada</button>
          )}
        </div>
      )}

      {!controls.redo && (
        <div className={controls.exit.visible ? 'grid grid-cols-[2fr_1fr] items-start gap-2' : ''}>
          <HoldButton
            label={controls.release.label}
            sub={controls.release.enabled ? controls.release.sub : undefined}
            hint="Segure para liberar"
            onHold={onRelease}
            disabled={locked || !controls.release.enabled}
            tone="release"
            tall
            ariaLabel={`Liberar o atleta: segure o botão. ${controls.release.sub}.`}
            icon={<Flag className="h-5 w-5" aria-hidden="true" />}
          />
          {controls.exit.visible && (
            <button type="button" className={`${secondary} min-h-[96px] flex-col`} disabled={locked || !controls.exit.enabled} onClick={() => setSheet('exit')}>
              <DoorOpen className="h-5 w-5" aria-hidden="true" />
              Atleta saiu
            </button>
          )}
        </div>
      )}

      <div className={cardAction ? 'grid grid-cols-3 gap-2' : 'grid grid-cols-2 gap-2'}>
        <button type="button" className={secondary} disabled={locked} onClick={() => setSheet('general')}>
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          Infração geral
        </button>
        <button type="button" className={secondary} disabled={locked || !canUndo} onClick={onUndo}>
          <Undo2 className="h-5 w-5" aria-hidden="true" />
          Desfazer último
        </button>
        {cardAction === 'relinquish' && (
          <button type="button" className={secondary} disabled={cardActionsDisabled} onClick={() => setSheet('relinquish')}>
            <Hand className="h-5 w-5" aria-hidden="true" />
            Soltar
          </button>
        )}
        {cardAction === 'dismiss' && (
          <button type="button" className="flex min-h-14 items-center justify-center gap-2 rounded-xl border-2 px-3 text-sm font-extrabold disabled:opacity-40 border-trading-down bg-card text-trading-down" disabled={cardActionsDisabled} onClick={() => setSheet('dismiss')}>
            <Trash2 className="h-5 w-5" aria-hidden="true" />
            Dispensar
          </button>
        )}
      </div>

      {sheet && (
        <div
          className={contained ? 'absolute inset-0 z-20 flex items-end overflow-hidden rounded-2xl bg-black/40' : 'fixed inset-0 z-40 flex items-end bg-black/50'}
          onClick={(event) => { if (event.target === event.currentTarget) setSheet(null); }}
        >
          <div
            role="dialog"
            aria-modal={contained ? undefined : true}
            aria-labelledby={`station-sheet-title-${sheetId}`}
            className={`w-full space-y-3 overflow-y-auto rounded-t-2xl border-t border-card-border bg-background p-4 ${contained ? 'max-h-full' : 'max-h-[85vh] pb-[max(1rem,env(safe-area-inset-bottom))]'}`}
          >
            {sheet === 'station' && (
              <>
                <h2 id={`station-sheet-title-${sheetId}`} className="text-lg font-extrabold">Infração da estação</h2>
                <p className="text-sm text-muted">{warningText} Um toque registra. Errou? Use &quot;Desfazer último&quot;.</p>
                <div className="grid grid-cols-2 gap-2">
                  {stationReasons.map((reason) => (
                    <button key={reason.code} type="button" data-one-tap-infraction className={secondary} onClick={() => { setSheet(null); onStationInfraction(reason.code); }}>
                      {reason.label}
                    </button>
                  ))}
                </div>
                <button type="button" className={`${secondary} w-full`} onClick={() => setSheet(null)}>Cancelar</button>
              </>
            )}
            {sheet === 'general' && (
              <>
                <h2 id={`station-sheet-title-${sheetId}`} className="text-lg font-extrabold">Infração geral</h2>
                <p className="text-sm text-muted">Um toque registra, vale na hora e soma ao tempo. Errou? Use &quot;Desfazer último&quot;.</p>
                <ul className="space-y-2">
                  {generalItems.map((item) => (
                    <li key={item.key}>
                      <button
                        type="button"
                        data-one-tap-infraction
                        className="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border-2 border-card-border bg-card px-4 text-left text-sm font-extrabold"
                        onClick={() => { setSheet(null); onGeneralInfraction(item.event); }}
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
            {sheet === 'exit' && exitInfo && (
              <>
                <h2 id={`station-sheet-title-${sheetId}`} className="text-lg font-extrabold">{athleteName} saiu antes de completar</h2>
                <div className="space-y-1 rounded-xl border-2 border-trading-down px-4 py-3">
                  <p className="text-sm font-extrabold">{exitInfo.progress}</p>
                  <p className="text-4xl font-extrabold tabular-nums text-trading-down">{exitInfo.charge}</p>
                  <p className="text-xs font-semibold text-muted">{exitInfo.calc} (valor do regulamento, a conferir)</p>
                </div>
                <p className="text-sm font-bold">{exitInfo.consequence}</p>
                {exitInfo.closesTimeWarning && (
                  <p role="note" className="rounded-xl border-2 border-primary bg-primary/10 px-4 py-3 text-sm font-bold">{exitInfo.closesTimeWarning}</p>
                )}
                <HoldButton
                  label="Segure para registrar a saída"
                  sub={`Cobra ${exitInfo.charge.replace('+', '')}${exitInfo.closesTimeWarning ? ' · não fecha o tempo' : ''}`}
                  hint="Segure para registrar a saída"
                  onHold={() => { setSheet(null); onExit(); }}
                  disabled={locked || !controls.exit.enabled}
                  tone="danger"
                  tall
                  ariaLabel={`Registrar a saída: segure o botão. Cobra ${exitInfo.charge.replace('+', '')}.${exitInfo.closesTimeWarning ? ' Não fecha o tempo.' : ''}`}
                  icon={<DoorOpen className="h-5 w-5" aria-hidden="true" />}
                />
                <button type="button" className={`${secondary} w-full`} onClick={() => setSheet(null)}>Voltar</button>
              </>
            )}
            {sheet === 'relinquish' && cardAction === 'relinquish' && (
              <>
                <h2 id={`station-sheet-title-${sheetId}`} className="text-lg font-extrabold">Soltar o cartão de {firstName}?</h2>
                <p className="text-sm font-semibold">Nada é apagado: os registros e o histórico ficam guardados. {firstName} fica sem judge até outro judge assumir de onde parou.</p>
                <p className="text-sm font-bold">Sua vaga fica livre.</p>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" className={secondary} onClick={() => setSheet(null)}>Voltar</button>
                  <button type="button" className="flex min-h-14 items-center justify-center gap-2 rounded-xl border-2 px-3 text-sm font-extrabold disabled:opacity-40 border-foreground bg-primary text-ink" disabled={cardActionsDisabled} onClick={() => { setSheet(null); onRelinquish?.(); }}>
                    <Hand className="h-5 w-5" aria-hidden="true" />
                    Soltar cartão
                  </button>
                </div>
              </>
            )}
            {sheet === 'dismiss' && cardAction === 'dismiss' && (
              <>
                <h2 id={`station-sheet-title-${sheetId}`} className="text-lg font-extrabold">Dispensar o cartão de {firstName}?</h2>
                <p className="text-sm font-semibold">Use quando abriu o atleta errado. O cartão não tem nenhum registro e é cancelado.</p>
                <p className="text-sm font-bold">Sua vaga fica livre.</p>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" className={secondary} onClick={() => setSheet(null)}>Voltar</button>
                  <button type="button" className="flex min-h-14 items-center justify-center gap-2 rounded-xl border-2 px-3 text-sm font-extrabold disabled:opacity-40 border-trading-down bg-trading-down text-white" disabled={cardActionsDisabled} onClick={() => { setSheet(null); onDismiss?.(); }}>
                    <Trash2 className="h-5 w-5" aria-hidden="true" />
                    Dispensar
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
