'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, CloudOff, Flag, Loader2, X } from 'lucide-react';

import { useTapHold } from '@/components/sheet/useTapHold';
import { describeHeatStartSync, type HeatStartNotice, type HeatStartSyncStatus, type QueuedHeatStart } from '@/lib/raceStartQueue';
import { formatRaceClock, type RaceWave } from '@/lib/raceWaves';

// Folha de largada da onda no painel do organizador (Story 1.110; gesto e
// fila da Story 1.96, maquete telas/largada.html). A largada é só do gestor:
// segurar o botão por 700 ms (useTapHold; o toque rápido só avisa), sem
// desfazer. Pensada para tablet na beira da pista: no tablet (md) a folha abre
// larga em duas colunas (estado e botão de um lado, atletas do outro), no
// paisagem baixo o botão fica fixo no rodapé e a lista de atletas rola, e todo
// alvo de toque tem 56 px ou mais. O botão e o relógio só ficam no tamanho
// máximo quando a altura da tela passa de 700 px (celular deitado, 768 px de
// largura, mantém o tamanho menor). Acessibilidade (A11Y-001): o foco entra na
// folha ao abrir, o Tab não sai dela, o fundo não rola e o foco volta ao botão
// "Largar" ao fechar. Segurar não tem equivalente de teclado, como na 1.96.

const HINT_MS = 2500;

type Props = {
  wave: RaceWave;
  timeZone?: string;
  queued: QueuedHeatStart | null;
  syncStatus: HeatStartSyncStatus;
  pendingCount: number;
  notice: HeatStartNotice | null;
  onStart: () => void;
  /** Sessão expirada: recarrega a página para o login aparecer (REQ-001). */
  onReload?: () => void;
  onClose: () => void;
};

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function RaceHeatStartSheet({ wave, timeZone, queued, syncStatus, pendingCount, notice, onStart, onReload, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [hint, setHint] = useState(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef(onStart);
  const closeRef = useRef(onClose);
  useEffect(() => {
    startRef.current = onStart;
    closeRef.current = onClose;
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      // Tab fica dentro da folha: do último volta ao primeiro e vice-versa.
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      if (hintTimer.current) clearTimeout(hintTimer.current);
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
  }, []);

  const showHint = () => {
    setHint(true);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(false), HINT_MS);
  };

  const locked = Boolean(wave.startedAt) || Boolean(queued);
  const { holding, handlers } = useTapHold({ onTap: showHint, onHold: () => startRef.current(), disabled: locked });

  const waveNotice = notice && notice.heatId === wave.id ? notice : null;
  const athleteCount = `${wave.athletes.length} ${wave.athletes.length === 1 ? 'atleta' : 'atletas'}`;
  const stalled = syncStatus === 'offline' || syncStatus === 'session';
  const synced = pendingCount === 0 && syncStatus === 'saved';
  const SyncIcon = stalled ? CloudOff : pendingCount > 0 ? Loader2 : CheckCircle2;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-0 md:items-center md:p-6" role="presentation">
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="race-heat-start-title"
        className="flex max-h-[96dvh] w-full max-w-lg flex-col overflow-hidden focus:outline-none rounded-t-2xl border border-card-border bg-card text-white md:max-h-[90dvh] md:max-w-4xl md:rounded-2xl lg:max-w-5xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-card-border px-5 py-4 md:px-7 md:py-5">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-primary">Fitness Race · Largada</p>
            <h4 id="race-heat-start-title" className="truncate text-xl font-extrabold md:text-3xl">{wave.title}</h4>
            <p className="text-sm text-muted md:text-base">
              <span className="tabular-nums">{wave.time || '—'}</span> previsto
              {wave.categories.length > 0 && ` · ${wave.categories.join(' · ')}`}
              {` · ${athleteCount}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar a largada"
            className="flex min-h-14 min-w-14 shrink-0 items-center justify-center rounded-lg border border-card-border bg-dark-gray hover:border-primary"
          >
            <X className="h-6 w-6" aria-hidden="true" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-5 py-4 md:grid-cols-2 md:gap-6 md:px-7 md:py-6">
          <div className="space-y-4">
            {waveNotice?.kind === 'conflict' && (
              <div role="alert" className="space-y-1 rounded-xl border-2 border-primary bg-primary/10 p-4">
                <p className="font-extrabold">{waveNotice.text}</p>
                <p className="text-sm text-muted">Outro aparelho largou esta onda antes. Nada foi alterado: vale o horário registrado.</p>
              </div>
            )}
            {waveNotice && waveNotice.kind !== 'conflict' && (
              <p role="alert" className="rounded-lg border border-red-500/40 bg-red-950/20 px-4 py-3 text-sm font-semibold">{waveNotice.text}</p>
            )}

            {wave.startedAt ? (
              <div className="space-y-1 rounded-2xl border-2 border-trading-up bg-trading-up/10 p-4 md:p-6">
                <p className="text-[11px] font-bold uppercase tracking-widest text-trading-up">Largou às</p>
                <p className="text-5xl font-extrabold tabular-nums md:text-6xl md:[@media(min-height:700px)]:text-7xl">{formatRaceClock(wave.startedAt, timeZone)}</p>
                <p className="text-sm font-semibold text-muted md:text-base">{wave.runsCount} {wave.runsCount === 1 ? 'corrida iniciada' : 'corridas iniciadas'}</p>
              </div>
            ) : queued ? (
              <div className="space-y-1 rounded-2xl border-2 border-trading-down bg-trading-down/10 p-4 md:p-6">
                <p className="text-[11px] font-bold uppercase tracking-widest text-trading-down">Guardada no aparelho</p>
                <p className="text-5xl font-extrabold tabular-nums md:text-6xl md:[@media(min-height:700px)]:text-7xl">{formatRaceClock(new Date(queued.deviceAt).toISOString(), timeZone)}</p>
                <p className="text-sm font-semibold text-muted md:text-base">
                  Horário do toque. {syncStatus === 'session' ? 'Será enviada depois que você entrar de novo.' : syncStatus === 'offline' ? 'Será enviada quando a conexão voltar. Não feche esta tela.' : 'Enviando ao servidor…'}
                </p>
              </div>
            ) : (
              <div className="space-y-2 rounded-2xl border border-card-border bg-dark-gray p-4 md:p-6">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-widest text-muted">Horário previsto</span>
                  <span className="rounded-full border border-card-border px-2 py-1 text-[11px] font-bold text-muted">Aguardando largada</span>
                </div>
                <p className="text-5xl font-extrabold tabular-nums md:text-6xl md:[@media(min-height:700px)]:text-7xl">{wave.time || '—'}</p>
                <p className="text-sm font-semibold text-muted md:text-base">Previsto no Cronograma. O tempo dos atletas começa no gesto de largar.</p>
              </div>
            )}

            {syncStatus === 'session' && onReload && (
              <button type="button" onClick={onReload} className="flex min-h-14 w-full items-center justify-center rounded-lg border-2 border-card-border bg-dark-gray text-base font-extrabold hover:border-primary">
                Entrar de novo
              </button>
            )}
            <div
              role="status"
              aria-live="polite"
              className={`flex min-h-14 items-center gap-2 rounded-lg border bg-dark-gray px-4 py-2.5 text-sm font-bold ${
                synced ? 'border-trading-up/60 text-trading-up' : stalled ? 'border-trading-down text-trading-down' : 'border-primary text-white'
              }`}
            >
              <SyncIcon className={`h-5 w-5 shrink-0 ${syncStatus === 'saving' ? 'motion-safe:animate-spin' : ''}`} aria-hidden="true" />
              <span>{describeHeatStartSync(syncStatus, pendingCount)}</span>
            </div>
          </div>

          <div className="min-w-0 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h5 className="text-sm font-extrabold uppercase tracking-wider">Atletas da onda</h5>
              <span className="text-sm font-bold tabular-nums text-muted">{wave.athletes.length}</span>
            </div>
            <ul className="divide-y divide-card-border rounded-xl border border-card-border bg-dark-gray md:max-h-[46dvh] md:overflow-y-auto" aria-label="Atletas da onda">
              {wave.athletes.map((athlete) => (
                <li key={athlete.id} className="flex min-h-14 items-center justify-between gap-3 px-4 py-2">
                  <span className="min-w-0">
                    <span className="block truncate font-bold md:text-lg">{athlete.name}</span>
                    <span className="block truncate text-xs font-semibold text-muted md:text-sm">{[athlete.box, athlete.divisionName].filter(Boolean).join(' · ')}</span>
                  </span>
                  {wave.startedAt ? (
                    <span className="shrink-0 rounded-full border border-trading-up/60 px-2 py-1 text-[11px] font-bold text-trading-up">Em corrida</span>
                  ) : queued ? (
                    <span className="shrink-0 rounded-full border border-card-border px-2 py-1 text-[11px] font-bold text-muted">Aguardando confirmação</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <footer className="space-y-2 border-t border-card-border bg-card px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 md:px-7 md:pb-6 md:pt-4">
          {wave.startedAt ? (
            <div className="flex min-h-16 items-center justify-center gap-2 rounded-xl border-2 border-trading-up text-base font-extrabold text-trading-up md:min-h-20 md:text-xl">
              <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
              Largada registrada
            </div>
          ) : queued ? (
            <div className="flex min-h-16 items-center justify-center gap-2 rounded-xl border-2 border-trading-down text-base font-extrabold text-trading-down md:min-h-20 md:text-xl">
              <CloudOff className="h-6 w-6" aria-hidden="true" />
              {stalled ? 'Largada guardada no aparelho' : 'Enviando a largada…'}
            </div>
          ) : (
            <>
              {hint && <p role="status" className="text-center text-sm font-extrabold md:text-base">Segure para largar</p>}
              <button
                type="button"
                {...handlers}
                aria-label={`Largar a ${wave.title}: segure o botão por quase um segundo. Sem desfazer.`}
                className="relative flex min-h-[96px] w-full touch-none select-none flex-col items-center justify-center gap-1 overflow-hidden rounded-2xl border-2 border-white bg-primary px-4 py-3 text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/50 md:[@media(min-height:700px)]:min-h-[128px]"
              >
                <span
                  aria-hidden="true"
                  className={`absolute inset-y-0 left-0 bg-black/25 ${holding ? 'motion-safe:transition-[width] motion-safe:duration-700 motion-safe:ease-linear' : ''}`}
                  style={{ width: holding ? '100%' : '0%' }}
                />
                <span className="relative flex items-center gap-2 text-xl font-extrabold uppercase tracking-wide md:text-3xl">
                  <Flag className="h-7 w-7 md:h-9 md:w-9" aria-hidden="true" />
                  {holding ? 'Continue segurando…' : 'Segure para largar'}
                </span>
                <span className="relative text-xs font-bold md:text-base">{wave.title} · {athleteCount} · sem desfazer</span>
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
