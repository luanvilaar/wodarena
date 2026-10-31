'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronRight, Flag, Search, Users } from 'lucide-react';

import { CourtShell } from '@/components/judge/CourtShell';
import { useApp } from '@/context/AppContext';
import { splitMyRaceStations } from '@/lib/raceAssignments';
import type { RaceStationKind } from '@/lib/raceRules';
import {
  RACE_FROM_CARDS,
  RACE_STATIONS_EYEBROW,
  RACE_STATION_KIND_LABELS,
  describeStationMeta,
  describeStationRow,
  filterStationRows,
  finalStationGuard,
  raceCardsHref,
  raceStationEyebrow,
  stationOpensWallBall,
  type RaceStationBoardAthlete
} from '@/lib/raceStation';

// Escolha da estação e lista da onda da estação (Story 1.102, AC3 e AC4;
// desenho em docs/design/fitness-race-sumula/telas/dois-cartoes.html, estado
// "Lista da onda"). As estações abrem sem judge atribuído (D3): o judge
// escolhe onde está. A estação de reps leva à tela do Wall Ball (1.97). Na
// lista, a busca por nome é local; tocar no atleta abre (ou retoma) a
// tentativa por open_attempt. Na estação final (D39), com um atleta aberto,
// tocar em outro só mostra o aviso de 1 atleta por judge. Story 1.103: o
// atleta aberto numa estação de 2 cartões vai para a tela de dois cartões com
// o cartão em foco; a estação de 1 atleta segue na tela de um atleta só. A
// recusa do servidor (2 cartões, estação de 1 atleta) abre a folha com a
// mensagem dele. Vindo de "Adicionar atleta" (`fromCards`), a lista volta aos
// cartões e não mostra quem está na estação final (D39). Story 1.104 (AC6):
// a escolha da estação mostra "Minhas estações" (a escala efetiva do judge, da
// onda em andamento ou, sem ela, de todas as ondas) primeiro e as demais em
// seguida; sem escala para ele, a lista fica como na 1.102. A escala só
// orienta (D3): todas as estações continuam abrindo.

const encode = encodeURIComponent;
const eventHref = (eventId: string) => `/judge/corrida/${encode(eventId)}`;
const stationsHref = (eventId: string) => `${eventHref(eventId)}/estacao`;

type StationDivision = {
  divisionId: string;
  divisionName: string;
  stationId: string;
  kind: RaceStationKind;
  expectedUnits: number | null;
  distance: string | null;
  maleWeight: string | null;
  femaleWeight: string | null;
  closesTime: boolean;
};

type StationsPayload = {
  event: { id: string; name: string };
  stations: { key: string; name: string; kind: RaceStationKind; closesTime: boolean; divisions: StationDivision[] }[];
};

const alertClass = 'rounded-md border border-trading-down bg-trading-down/10 px-4 py-3 text-sm font-semibold';
const chipClass = 'flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-bold';

export function StationPickerScreen({ eventId, fromCards = false }: { eventId: string; fromCards?: boolean }) {
  const { currentUser } = useApp();
  const [payload, setPayload] = useState<StationsPayload | null>(null);
  const [error, setError] = useState('');

  const [myKeys, setMyKeys] = useState<string[]>([]);

  const load = useCallback(async () => {
    // "Minhas estações" (Story 1.104, AC6) é complemento: se a escala não carregar, a lista segue como na 1.102.
    const mine = fetch(`/api/race-sheets?view=my_stations&eventId=${encode(eventId)}`)
      .then(async (response) => (response.ok ? ((await response.json()) as { myStationKeys?: unknown }) : null))
      .then((data) => (Array.isArray(data?.myStationKeys) ? data.myStationKeys.filter((key): key is string => typeof key === 'string') : []))
      .catch(() => [] as string[]);
    try {
      const response = await fetch(`/api/race-sheets?view=stations&eventId=${encode(eventId)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Erro ao carregar as estações.');
      setPayload(data as StationsPayload);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erro ao carregar as estações.');
    }
    setMyKeys(await mine);
  }, [eventId]);

  useEffect(() => {
    if (!currentUser) return;
    const first = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(first);
  }, [currentUser, load]);

  // "Outra estação" da tela de dois cartões (Story 1.103, AC7): sem Wall Ball e sem estação que só fecha o tempo (D39).
  const stations = (payload?.stations ?? []).filter((station) => !fromCards || (!stationOpensWallBall(station.kind) && station.divisions.some((division) => !division.closesTime)));
  const { mine, others } = splitMyRaceStations(stations, myKeys);

  const stationItem = (station: StationsPayload['stations'][number]) => {
    const first = station.divisions[0];
    const meta = first ? describeStationMeta(first).target : '';
    const wallBall = stationOpensWallBall(station.kind);
    const href = wallBall ? `${eventHref(eventId)}/wall-ball` : `${stationsHref(eventId)}/${encode(station.key)}${fromCards ? `?de=${RACE_FROM_CARDS}` : ''}`;
    return (
      <li key={station.key}>
        <Link href={href} className="flex min-h-[68px] w-full items-center justify-between gap-3 rounded-xl border border-card-border bg-card px-4 py-3 hover:border-primary">
          <span className="min-w-0">
            <span className="block truncate text-base font-extrabold">{station.name}</span>
            <span className="block truncate text-xs font-semibold text-muted">{[RACE_STATION_KIND_LABELS[station.kind], meta].filter(Boolean).join(' · ')}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {station.closesTime && (
              <span className={`${chipClass} border-primary`}>
                <Flag className="h-3.5 w-3.5" aria-hidden="true" />
                Fecha o tempo
              </span>
            )}
            {(station.closesTime || wallBall) && <span className={`${chipClass} border-card-border`}>1 atleta por judge</span>}
            <ChevronRight className="h-5 w-5 text-muted" aria-hidden="true" />
          </span>
        </Link>
      </li>
    );
  };

  return (
    <CourtShell
      eyebrow={RACE_STATIONS_EYEBROW}
      title="Em qual estação você está?"
      subtitle={payload?.event.name}
      back={fromCards ? { href: raceCardsHref(eventId), label: 'Voltar aos meus cartões' } : { href: eventHref(eventId), label: 'Voltar ao evento' }}
    >
      {error && <p role="alert" className={`mb-3 ${alertClass}`}>{error}</p>}
      {!payload ? (
        !error && <p role="status" className="py-10 text-center text-sm font-semibold text-muted">Carregando as estações…</p>
      ) : stations.length === 0 ? (
        <div className="space-y-2 rounded-xl border border-card-border bg-card px-4 py-8 text-center">
          <p className="font-bold">Nenhuma estação no percurso.</p>
          <p className="text-sm text-muted">Peça ao organizador para montar o percurso das categorias na construção da prova.</p>
        </div>
      ) : (
        <>
          {mine.length > 0 && (
            <>
              <p className="pb-2 text-xs font-bold uppercase tracking-widest text-primary">Minhas estações</p>
              <ul className="space-y-2" aria-label="Minhas estações">{mine.map(stationItem)}</ul>
              {others.length > 0 && <p className="pb-2 pt-4 text-xs font-bold uppercase tracking-widest text-muted">Outras estações</p>}
            </>
          )}
          {others.length > 0 && <ul className="space-y-2" aria-label="Estações do evento">{others.map(stationItem)}</ul>}
        </>
      )}
    </CourtShell>
  );
}

type BoardPayload = {
  event: { id: string; name: string };
  station: { key: string; name: string; kind: RaceStationKind; closesTime: boolean };
  waves: { id: string; title: string; time: string; startedAt: string | null; athletes: RaceStationBoardAthlete[] }[];
  viewer: { id: string };
};

type Guard = NonNullable<ReturnType<typeof finalStationGuard>>;
/** Recusa do servidor ao abrir (Story 1.103, AC2, AC3): 2 cartões ou estação de 1 atleta. */
type Refusal = { reason: 'full' | 'solo'; message: string; openName: string };

export function StationListScreen({ eventId, stationKey, fromCards = false }: { eventId: string; stationKey: string; fromCards?: boolean }) {
  const { currentUser } = useApp();
  const router = useRouter();
  const [payload, setPayload] = useState<BoardPayload | null>(null);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [guard, setGuard] = useState<Guard | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const listHref = `${stationsHref(eventId)}/${encode(stationKey)}`;

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/race-sheets?view=station_board&eventId=${encode(eventId)}&stationKey=${encode(stationKey)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Erro ao carregar a lista da onda.');
      setPayload(data as BoardPayload);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erro ao carregar a lista da onda.');
    }
  }, [eventId, stationKey]);

  useEffect(() => {
    if (!currentUser) return;
    const first = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(first);
  }, [currentUser, load]);

  // Reps: a lista e a contagem são as do Wall Ball (1.97).
  const wallBall = payload ? stationOpensWallBall(payload.station.kind) : false;
  useEffect(() => {
    if (wallBall) router.replace(`${eventHref(eventId)}/wall-ball`);
  }, [wallBall, router, eventId]);

  const viewerId = payload?.viewer.id ?? currentUser?.id ?? '';
  const allRows = (payload?.waves ?? []).flatMap((wave) => wave.athletes
    // "Adicionar atleta" não lista a estação final (Story 1.103, AC7; D39).
    .filter((athlete) => !fromCards || !athlete.closesTime)
    .map((athlete) => ({ athlete, wave, state: describeStationRow(athlete, viewerId) })));
  const athletes = allRows.map((row) => row.athlete);

  const open = async (athlete: RaceStationBoardAthlete) => {
    if (opening) return;
    const blocked = finalStationGuard(athletes, viewerId, athlete);
    if (blocked) {
      setGuard(blocked);
      return;
    }
    setOpening(athlete.athleteId);
    try {
      const response = await fetch('/api/race-sheets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'open_attempt', eventId, athleteId: athlete.athleteId, stationId: athlete.stationId })
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 409 && (data.capacity === 'full' || data.capacity === 'solo')) {
        const blocking = Array.isArray(data.openAttempts) ? data.openAttempts[0] : null;
        setRefusal({ reason: data.capacity, message: data.error || '', openName: typeof blocking?.athleteName === 'string' ? blocking.athleteName : '' });
        setOpening(null);
        void load();
        return;
      }
      if (!response.ok || !data.attempt?.id) throw new Error(data.error || 'Não foi possível abrir a tentativa.');
      // Estação de 1 atleta: tela de um atleta só (D39). As outras: tela de dois cartões com o cartão em foco (Story 1.103).
      if (data.attempt.solo === false) router.push(raceCardsHref(eventId, data.attempt.id));
      else router.push(`${listHref}/${encode(data.attempt.id)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível abrir a tentativa.');
      setOpening(null);
      void load();
    }
  };

  const rows = filterStationRows(allRows.map((row) => ({ ...row, name: row.athlete.name })), query);
  const active = rows.filter((row) => !row.state.done);
  const done = rows.filter((row) => row.state.done);
  const station = payload?.station;
  const waveTitles = payload && payload.waves.length > 0 ? payload.waves.map((wave) => wave.title).join(', ') : '';

  const row = ({ athlete, state }: (typeof rows)[number]) => {
    const meta = describeStationMeta(athlete).target;
    return (
      <li key={athlete.athleteId}>
        <button
          type="button"
          disabled={state.disabled || opening !== null}
          onClick={() => void open(athlete)}
          className={`flex min-h-[68px] w-full items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-left disabled:cursor-not-allowed ${state.done ? 'border-card-border opacity-70' : state.mine ? 'border-primary' : 'border-card-border hover:border-primary disabled:opacity-60'}`}
        >
          <span className="min-w-0">
            <span className="block truncate text-base font-extrabold">{athlete.name}</span>
            <span className="block truncate text-xs font-semibold text-muted">
              {[athlete.team ? 'Dupla' : athlete.box, athlete.divisionName, state.detail || (state.done ? '' : meta)].filter(Boolean).join(' · ')}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {athlete.team && (
              <span className={`${chipClass} border-primary/60`}>
                <Users className="h-3.5 w-3.5" aria-hidden="true" />
                Dupla
              </span>
            )}
            <span className={`rounded-full border px-2 py-1 text-[11px] font-bold tabular-nums ${state.done ? 'border-trading-up/60 text-trading-up' : state.mine ? 'border-primary text-foreground' : 'border-card-border text-muted'}`}>
              {opening === athlete.athleteId ? 'Abrindo…' : state.chip}
            </span>
            {!state.disabled && <ChevronRight className="h-5 w-5 text-muted" aria-hidden="true" />}
          </span>
        </button>
      </li>
    );
  };

  return (
    <CourtShell
      eyebrow={raceStationEyebrow(station?.name)}
      title={station ? [station.name, waveTitles].filter(Boolean).join(' · ') : 'Estação'}
      subtitle={payload?.event.name}
      back={fromCards ? { href: raceCardsHref(eventId), label: 'Voltar aos meus cartões' } : { href: stationsHref(eventId), label: 'Voltar às estações' }}
    >
      {error && <p role="alert" className={`mb-3 ${alertClass}`}>{error}</p>}
      {!payload || wallBall ? (
        !error && <p role="status" className="py-10 text-center text-sm font-semibold text-muted">{wallBall ? 'Abrindo a lista do Wall Ball…' : 'Carregando a lista da onda…'}</p>
      ) : (
        <div className="space-y-3">
          {station?.closesTime && (
            <div className="flex flex-wrap gap-2">
              <span className={`${chipClass} border-card-border`}>Estação final: 1 atleta por judge</span>
              <span className={`${chipClass} border-primary`}>
                <Flag className="h-3.5 w-3.5" aria-hidden="true" />
                Fecha o tempo
              </span>
            </div>
          )}
          <label className="relative block">
            <span className="sr-only">Buscar atleta pelo nome</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar pelo nome"
              autoComplete="off"
              className="min-h-14 w-full rounded-xl border-2 border-card-border bg-card pl-10 pr-4 text-base font-semibold"
            />
          </label>
          {allRows.length === 0 ? (
            <div className="space-y-2 rounded-xl border border-card-border bg-card px-4 py-8 text-center">
              <p className="font-bold">Nenhum atleta em corrida nesta estação.</p>
              <p className="text-sm text-muted">Os atletas aparecem aqui depois que a onda deles larga.</p>
            </div>
          ) : (
            <>
              <p className="text-sm font-semibold text-muted">Toque no atleta que chegou à estação.</p>
              {rows.length === 0 && <p className="text-sm font-semibold">Nenhum atleta com &quot;{query}&quot; nesta onda.</p>}
              <ul className="space-y-2" aria-label="Atletas em corrida">{active.map(row)}</ul>
              {done.length > 0 && (
                <>
                  <p className="pt-2 text-xs font-bold uppercase tracking-widest text-muted">Concluídos</p>
                  <ul className="space-y-2" aria-label="Atletas concluídos">{done.map(row)}</ul>
                </>
              )}
            </>
          )}
        </div>
      )}

      {refusal && (
        <div className="fixed inset-0 z-40 flex items-end bg-black/50" onClick={(event) => { if (event.target === event.currentTarget) setRefusal(null); }}>
          <div role="alertdialog" aria-modal="true" aria-labelledby="station-refusal-title" className="w-full space-y-3 rounded-t-2xl border-t border-card-border bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <h2 id="station-refusal-title" className="text-lg font-extrabold">
              {refusal.reason === 'full' ? 'Você já confere 2 atletas' : 'Esta estação é de 1 atleta por judge'}
            </h2>
            <p className="text-sm font-bold">{refusal.message}</p>
            {refusal.reason === 'full' ? (
              <p className="text-sm text-muted">Para abrir vaga: libere um atleta, solte o cartão (outro judge assume) ou dispense um cartão aberto por engano.</p>
            ) : refusal.openName && (
              <p className="text-sm text-muted">Você está com {refusal.openName}.</p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="min-h-14 rounded-xl border-2 border-card-border bg-card font-extrabold" onClick={() => setRefusal(null)}>Fechar</button>
              <Link href={raceCardsHref(eventId)} className="flex min-h-14 items-center justify-center rounded-xl border-2 border-foreground bg-primary text-center font-extrabold text-ink">
                Ver meus cartões
              </Link>
            </div>
          </div>
        </div>
      )}

      {guard && (
        <div className="fixed inset-0 z-40 flex items-end bg-black/50" onClick={(event) => { if (event.target === event.currentTarget) setGuard(null); }}>
          <div role="alertdialog" aria-modal="true" aria-labelledby="station-guard-title" className="w-full space-y-3 rounded-t-2xl border-t border-card-border bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <h2 id="station-guard-title" className="text-lg font-extrabold">Esta estação é de 1 atleta por judge</h2>
            <p className="text-sm font-bold">{guard.message}</p>
            <p className="text-sm text-muted">Esta estação fecha o tempo: você acompanha um atleta até a liberação.</p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="min-h-14 rounded-xl border-2 border-card-border bg-card font-extrabold" onClick={() => setGuard(null)}>Fechar</button>
              {guard.open.attempt && (
                <Link href={`${listHref}/${encode(guard.open.attempt.id)}`} className="flex min-h-14 items-center justify-center rounded-xl border-2 border-foreground bg-primary text-center font-extrabold text-ink">
                  Voltar para {guard.open.name}
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </CourtShell>
  );
}
