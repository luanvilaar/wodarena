'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, CloudOff, Loader2, Plus, RefreshCw, X } from 'lucide-react';

import { CourtShell } from '@/components/judge/CourtShell';
import { StationCard } from '@/components/race/StationCard';
import { useStationCardModel, type AttemptPayload } from '@/components/race/StationAttemptScreen';
import { useApp } from '@/context/AppContext';
import {
  RACE_FROM_CARDS,
  RACE_JUDGE_MAX_ACTIVE,
  RACE_STATIONS_EYEBROW,
  aggregateCardsSync,
  describeJudgeCardsCount,
  isSoloRaceStation,
  stationOpensWallBall,
  stationUsesCounter
} from '@/lib/raceStation';

// Tela de dois cartões do judge (Story 1.103, AC7 e AC8; desenho aprovado em
// docs/design/fitness-race-sumula/telas/dois-cartoes.html, D42). Mostra as
// tentativas ativas de quem pede, lidas do servidor (`view=my_cards`): recarregar
// a página volta igual. Cada cartão é um StationCard com a sua própria fila
// local (TwoCardsCard chama useStationCardModel, e por ele useRaceSync, uma
// vez por cartão): um 409 ou queda de internet num cartão não para o outro.
// Com menos de 2 cartões aparece a vaga livre com "Adicionar atleta", que
// leva à lista da onda da estação e volta com o cartão novo em foco; com 2,
// a vaga some e é o servidor que recusa o terceiro (AC2). Celular deitado e
// tablet: lado a lado; celular em pé: abas no topo (maquete aprovada). A
// estação de 1 atleta (Wall Ball e estação final, D32, D39) não entra aqui:
// fica na tela de um atleta só.

type CardsPayload = {
  event: { id: string; name: string; timeZone: string };
  cards: AttemptPayload[];
  capacity: { max: number; active: number; solo: boolean };
  viewer: { id: string; name: string; role: string };
};

type CardSync = { status: 'saved' | 'saving' | 'offline' | 'conflict' | 'rejected'; pendingCount: number; closed: boolean; info: string };

const encode = encodeURIComponent;
const eventHref = (eventId: string) => `/judge/corrida/${encode(eventId)}`;
const pickerHref = (eventId: string) => `${eventHref(eventId)}/estacao?de=${RACE_FROM_CARDS}`;
const stationListHref = (eventId: string, stationKey: string | null | undefined) => (
  stationKey ? `${eventHref(eventId)}/estacao/${encode(stationKey)}?de=${RACE_FROM_CARDS}` : pickerHref(eventId)
);
/** Estação de 1 atleta: o servidor diz (`solo`); sem o campo, reps ou estação final. */
const isSoloCard = (card: AttemptPayload) => card.attempt.solo ?? isSoloRaceStation(card.stage?.kind ?? card.attempt.stationKind, card.attempt.closesTime === true);
const soloHref = (eventId: string, card: AttemptPayload) => (
  stationOpensWallBall(card.stage?.kind ?? card.attempt.stationKind)
    ? `${eventHref(eventId)}/wall-ball/${encode(card.attempt.id)}`
    : `${eventHref(eventId)}/estacao/${encode(card.attempt.stationKey ?? '')}/${encode(card.attempt.id)}`
);
const firstName = (name: string) => name.split(' ')[0] || name;

const alertClass = 'rounded-md border border-trading-down bg-trading-down/10 px-4 py-3 text-sm font-semibold';
const secondaryClass = 'flex min-h-14 w-full items-center justify-center gap-2 rounded-xl border-2 border-card-border bg-card px-3 text-sm font-extrabold';
const TONE_CLASS = { ok: 'border-trading-up/60 text-trading-up', wait: 'border-primary text-foreground', down: 'border-trading-down text-trading-down' } as const;

function SyncTag({ sync }: { sync: CardSync | undefined }) {
  const status = sync?.status ?? 'saved';
  const pending = sync?.pendingCount ?? 0;
  if (status === 'conflict' || status === 'rejected') {
    return <span className="flex shrink-0 items-center gap-1 rounded-full border border-trading-down px-2 py-1 text-[11px] font-bold text-trading-down"><AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />Recusado</span>;
  }
  if (pending > 0) {
    const offline = status === 'offline';
    const Icon = offline ? CloudOff : Loader2;
    return (
      <span className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-bold ${offline ? 'border-trading-down text-trading-down' : 'border-primary'}`}>
        <Icon className={`h-3.5 w-3.5 ${offline ? '' : 'motion-safe:animate-spin'}`} aria-hidden="true" />
        {offline ? `${pending} no aparelho` : `Salvando ${pending}`}
      </span>
    );
  }
  return <span className="flex shrink-0 items-center gap-1 rounded-full border border-trading-up/60 px-2 py-1 text-[11px] font-bold text-trading-up"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />Salvo</span>;
}

export function TwoCardsScreen({ eventId, focusId }: { eventId: string; focusId: string | null }) {
  const { currentUser } = useApp();
  const [payload, setPayload] = useState<CardsPayload | null>(null);
  const [cards, setCards] = useState<AttemptPayload[]>([]);
  const [versions, setVersions] = useState<Record<string, number>>({});
  const [syncs, setSyncs] = useState<Record<string, CardSync>>({});
  const [focus, setFocus] = useState<string | null>(focusId);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  // Cartões encerrados no aparelho: o resumo sobrevive a uma releitura (o servidor não os devolve mais).
  const closedRef = useRef(new Set<string>());

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/race-sheets?view=my_cards&eventId=${encode(eventId)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Erro ao carregar os seus cartões.');
      const next = data as CardsPayload;
      setPayload(next);
      // Cartão encerrado (liberado ou saída) some do servidor, mas o resumo fica até "Fechar" ou "Próximo atleta".
      setCards((previous) => [
        ...next.cards,
        ...previous.filter((card) => !next.cards.some((item) => item.attempt.id === card.attempt.id) && card.attempt.status !== 'cancelled' && closedRef.current.has(card.attempt.id))
      ]);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erro ao carregar os seus cartões.');
    }
  }, [eventId]);

  useEffect(() => {
    if (!currentUser) return;
    const first = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(first);
  }, [currentUser, load]);

  const onSync = useCallback((attemptId: string, sync: CardSync) => {
    if (sync.closed) closedRef.current.add(attemptId);
    else closedRef.current.delete(attemptId);
    setSyncs((previous) => {
      const current = previous[attemptId];
      if (current && current.status === sync.status && current.pendingCount === sync.pendingCount && current.closed === sync.closed && current.info === sync.info) return previous;
      return { ...previous, [attemptId]: sync };
    });
  }, []);

  const removeCard = (attemptId: string) => {
    closedRef.current.delete(attemptId);
    setCards((previous) => previous.filter((card) => card.attempt.id !== attemptId));
    setSyncs((previous) => {
      const next = { ...previous };
      delete next[attemptId];
      return next;
    });
  };

  // "Recarregar este cartão": lê a tentativa de novo e monta o cartão do zero (só ele).
  const reloadCard = async (attemptId: string) => {
    try {
      const response = await fetch(`/api/race-sheets?view=attempt&attemptId=${encode(attemptId)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Erro ao recarregar o cartão.');
      setCards((previous) => previous.map((card) => (card.attempt.id === attemptId ? data as AttemptPayload : card)));
      setVersions((previous) => ({ ...previous, [attemptId]: (previous[attemptId] ?? 0) + 1 }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erro ao recarregar o cartão.');
    }
  };

  // Soltar (AC5): nada é apagado, o atleta fica sem judge. Dispensar: cancela o cartão sem registro.
  const cardAction = async (card: AttemptPayload, action: 'release_attempt' | 'dismiss_attempt') => {
    if (busy) return;
    setBusy(card.attempt.id);
    try {
      const response = await fetch('/api/race-sheets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, attemptId: card.attempt.id })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Não foi possível liberar a vaga.');
      const name = firstName(card.context.athleteName || 'o atleta');
      removeCard(card.attempt.id);
      setFocus(null);
      setFlash(action === 'release_attempt'
        ? `Cartão de ${name} solto: fica sem judge até outro judge assumir. Sua vaga está livre.`
        : `Cartão de ${name} dispensado. Sua vaga está livre.`);
      void load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível liberar a vaga.');
    } finally {
      setBusy(null);
    }
  };

  const soloCards = cards.filter((card) => isSoloCard(card));
  // A estação de 1 atleta nunca vira cartão aqui (D39); no máximo 2 cartões (D31).
  const shown = cards.filter((card) => !isSoloCard(card) && card.stage).slice(0, RACE_JUDGE_MAX_ACTIVE);
  const active = shown.filter((card) => !syncs[card.attempt.id]?.closed).length;
  const showSlot = shown.length < RACE_JUDGE_MAX_ACTIVE && soloCards.length === 0;
  const keys = [...shown.map((card) => card.attempt.id), ...(showSlot ? ['slot'] : [])];
  const focusKey = focus && keys.includes(focus) ? focus : keys[0];
  // Celular em pé: abas no topo quando há mais de um item (cartão ou vaga); deitado e tablet, lado a lado.
  const tabbed = keys.length > 1;
  const overall = aggregateCardsSync(shown.map((card) => syncs[card.attempt.id] ?? { status: 'saved', pendingCount: 0 }));
  const OverallIcon = overall.tone === 'ok' ? CheckCircle2 : overall.tone === 'wait' ? Loader2 : overall.pendingCount > 0 ? CloudOff : AlertTriangle;
  const stationKey = shown[0]?.attempt.stationKey ?? null;
  const stationName = shown[0]?.stage?.name ?? '';
  const hidden = (key: string) => (tabbed && focusKey !== key ? 'max-md:portrait:hidden' : '');

  return (
    <CourtShell
      eyebrow={RACE_STATIONS_EYEBROW}
      title="Meus cartões"
      subtitle={payload ? (soloCards.length > 0 ? 'Estação de 1 atleta aberta' : describeJudgeCardsCount(active)) : undefined}
      back={{ href: `${eventHref(eventId)}/estacao`, label: 'Voltar às estações' }}
      wide
    >
      {!payload ? (
        error ? <p role="alert" className={alertClass}>{error}</p> : <p role="status" className="py-10 text-center text-sm font-semibold text-muted">Carregando os seus cartões…</p>
      ) : (
        <div className="space-y-3">
          <div role="status" aria-live="polite" className={`flex items-center gap-2 rounded-md border bg-background px-3 py-2.5 text-xs font-bold ${TONE_CLASS[overall.tone]}`}>
            <OverallIcon className={`h-4 w-4 shrink-0 ${overall.tone === 'wait' ? 'motion-safe:animate-spin' : ''}`} aria-hidden="true" />
            <span>{overall.text}</span>
          </div>
          {error && <p role="alert" className={alertClass}>{error}</p>}
          {flash && (
            <div role="status" className="flex items-center justify-between gap-2 rounded-md border border-card-border bg-card px-3 py-2 text-sm font-bold">
              <span>{flash}</span>
              <button type="button" onClick={() => setFlash('')} aria-label="Fechar o aviso" className="flex min-h-11 min-w-11 items-center justify-center rounded-md border border-card-border">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          )}
          {soloCards.map((card) => (
            <div key={card.attempt.id} className="space-y-2 rounded-xl border-2 border-primary bg-primary/10 px-4 py-3">
              <p className="text-sm font-extrabold">
                Você está com {card.context.athleteName || 'um atleta'} em {card.stage?.name ?? card.context.stationName}: estação de 1 atleta por judge.
              </p>
              <p className="text-sm text-muted">Ela não divide a tela com outro cartão. Libere o atleta antes de abrir outro.</p>
              <Link href={soloHref(eventId, card)} className="flex min-h-14 items-center justify-center rounded-xl border-2 border-foreground bg-primary font-extrabold text-ink">
                Voltar para {firstName(card.context.athleteName || 'o atleta')}
              </Link>
            </div>
          ))}

          {tabbed && (
            <div role="tablist" aria-label="Meus cartões" className="grid grid-cols-2 gap-2 md:hidden landscape:hidden">
              {shown.map((card) => {
                const sync = syncs[card.attempt.id];
                const selected = focusKey === card.attempt.id;
                const bad = sync?.status === 'conflict' || sync?.status === 'rejected';
                return (
                  <button
                    key={card.attempt.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setFocus(card.attempt.id)}
                    className={`grid min-h-16 min-w-0 content-center gap-0.5 rounded-xl border-2 px-3 py-1.5 text-left ${bad ? 'border-trading-down' : selected ? 'border-primary bg-background' : 'border-card-border bg-card'}`}
                  >
                    <span className="truncate text-sm font-extrabold">{firstName(card.context.athleteName || 'Atleta')}</span>
                    <span className="truncate text-xs font-semibold text-muted">{sync?.info ?? card.stage?.name}</span>
                    <SyncTag sync={sync} />
                  </button>
                );
              })}
              {showSlot && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={focusKey === 'slot'}
                  onClick={() => setFocus('slot')}
                  className={`grid min-h-16 min-w-0 content-center gap-0.5 rounded-xl border-2 border-dashed px-3 py-1.5 text-left ${focusKey === 'slot' ? 'border-primary bg-background' : 'border-card-border bg-card'}`}
                >
                  <span className="flex items-center gap-1 text-sm font-extrabold"><Plus className="h-4 w-4" aria-hidden="true" />Vaga livre</span>
                  <span className="truncate text-xs font-semibold text-muted">Adicionar atleta</span>
                </button>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2 landscape:grid-cols-2">
            {shown.map((card) => (
              <div key={`${card.attempt.id}:${versions[card.attempt.id] ?? 0}`} className={hidden(card.attempt.id)}>
                <TwoCardsCard
                  eventId={eventId}
                  payload={card}
                  fresh={card.attempt.id === focusId}
                  busy={busy === card.attempt.id}
                  sync={syncs[card.attempt.id]}
                  onSync={onSync}
                  onReload={() => void reloadCard(card.attempt.id)}
                  onRelinquish={() => void cardAction(card, 'release_attempt')}
                  onDismiss={() => void cardAction(card, 'dismiss_attempt')}
                  onClose={() => removeCard(card.attempt.id)}
                />
              </div>
            ))}
            {showSlot && (
              <div className={hidden('slot')}>
                <div className="flex flex-col justify-center gap-3 rounded-2xl border-2 border-dashed border-card-border p-4 text-center">
                  <p className="text-lg font-extrabold">Vaga livre</p>
                  <p className="text-sm text-muted">
                    {shown.length === 0 ? 'Você pode conferir até 2 atletas ou equipes ao mesmo tempo.' : 'Você pode conferir mais 1 atleta ou equipe.'}
                  </p>
                  <Link href={stationListHref(eventId, stationKey)} className="flex min-h-14 items-center justify-center gap-2 rounded-xl border-2 border-foreground bg-primary text-base font-extrabold text-ink">
                    <Plus className="h-5 w-5" aria-hidden="true" />
                    Adicionar atleta
                  </Link>
                  {stationName && <p className="text-xs font-semibold text-muted">Abre a lista da onda: {stationName}.</p>}
                  <Link href={pickerHref(eventId)} className={secondaryClass}>Outra estação</Link>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </CourtShell>
  );
}

type CardProps = {
  eventId: string;
  payload: AttemptPayload;
  fresh: boolean;
  busy: boolean;
  sync: CardSync | undefined;
  onSync: (attemptId: string, sync: CardSync) => void;
  onReload: () => void;
  onRelinquish: () => void;
  onDismiss: () => void;
  onClose: () => void;
};

/** Um cartão da tela: a sua fila (useStationCardModel chama useRaceSync uma vez), o seu indicador e as suas folhas. */
function TwoCardsCard({ eventId, payload, fresh, busy, sync: reported, onSync, onReload, onRelinquish, onDismiss, onClose }: CardProps) {
  const { sync, isWriter, closed, cardProps } = useStationCardModel(payload);
  const { attempt, context } = payload;
  const stage = payload.stage!;
  const units = cardProps.units;
  const info = closed
    ? (cardProps.exited ? 'Saída registrada' : 'Liberado')
    : `${stage.name} · ${stationUsesCounter(stage.kind) ? `${units}/${cardProps.expectedUnits ?? '—'}` : cardProps.stationElapsed !== null ? 'em andamento' : 'não iniciou'}`;

  useEffect(() => {
    onSync(attempt.id, { status: sync.status, pendingCount: sync.pendingCount, closed, info });
  }, [onSync, attempt.id, sync.status, sync.pendingCount, closed, info]);

  const stopped = sync.status === 'conflict' || sync.status === 'rejected';
  const header = (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="break-words text-base font-extrabold leading-tight">{context.athleteName || 'Atleta'}</p>
        <p className="text-xs font-semibold text-muted">{[context.divisionName, context.team ? 'Dupla' : context.box].filter(Boolean).join(' · ')}</p>
      </div>
      <SyncTag sync={reported ?? { status: sync.status, pendingCount: sync.pendingCount, closed, info }} />
    </div>
  );

  return (
    <div className={`space-y-2 ${stopped ? 'rounded-2xl ring-2 ring-trading-down' : ''}`}>
      {stopped && (
        <div role="alert" className="space-y-2 rounded-md border border-trading-down bg-trading-down/10 px-3 py-2 text-sm font-semibold">
          <p className="font-extrabold">Recarregue para continuar</p>
          <p>{sync.message || 'O servidor recusou o último registro deste cartão.'} O outro cartão segue normal.</p>
          {sync.sessionExpired ? (
            <Link href="/admin" className={secondaryClass}>Entrar de novo</Link>
          ) : sync.status === 'rejected' ? (
            <button type="button" onClick={sync.discardRejected} className={secondaryClass}>Descartar o registro recusado</button>
          ) : (
            <button type="button" onClick={onReload} className={secondaryClass}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Recarregar este cartão
            </button>
          )}
        </div>
      )}
      <StationCard
        {...cardProps}
        contained
        header={header}
        oneAthlete={false}
        isNew={fresh && sync.items.length === 0}
        hasRecords={sync.items.length > 0}
        onRelinquish={onRelinquish}
        onDismiss={onDismiss}
        cardActionsDisabled={busy || !isWriter || sync.pendingCount > 0}
        onClose={onClose}
        nextHref={stationListHref(eventId, attempt.stationKey)}
      />
    </div>
  );
}
