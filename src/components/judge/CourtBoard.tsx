'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';

import { CourtShell } from '@/components/judge/CourtShell';
import {
  filterLooseAthletes,
  findCurrentHeat,
  followingHeatId,
  loadCourtLane,
  openDecision,
  orderHeats,
  saveCourtLane,
  type CourtLane,
  type FocusLaneStatus
} from '@/lib/courtFocus';
import { SCORESHEET_STATUS_LABELS, type ScoresheetStatus } from '@/lib/scoresheet';
import { summarizeStructure } from '@/lib/workoutStructureEditor';
import type { WorkoutStructure } from '@/lib/workoutStructure';

// Quadro do evento na quadra (Story 1.49): o judge vê as baterias com as raias e
// o estado de cada súmula e abre (ou retoma) a súmula do atleta. O quadro se
// atualiza a cada 15 s e quando a tela volta a ficar visível.
// Story 1.89: a prova pode ser uma PROVA DO EVENTO ("Prova 1 · DT Speed"), cujas
// baterias misturam categorias; cada raia abre a súmula da prova da categoria do atleta.
// Story 1.147 (docs/design/quadra-por-raia/, D1, D2, D3 e D7): o judge diz em que
// raia está (guardado no aparelho, por evento) e a quadra abre em "Agora", a
// bateria atual pela regra do telão (courtFocus.ts), com o atleta da raia dele.
// Fora da raia ou da bateria atual, abrir pede confirmação. A lista completa
// (provas, baterias e atletas sem bateria, com busca) fica recolhida.

const REFRESH_MS = 15_000;

type Lane = { lane: number; athleteId: string; athleteName: string; box: string; divisionId: string; divisionName: string; workoutId: string };
type Heat = { id: string; workoutId: string; stageNumber: number | null; stageTitle: string; heatNumber: number | null; date: string; time: string; title: string; lanes: Lane[] };
type Board = {
  event: { id: string; name: string; date: string; location: string };
  workouts: { id: string; name: string; code: string; divisionId: string | null; structure: WorkoutStructure }[];
  divisions: { id: string; name: string }[];
  athletes: { id: string; name: string; box: string; divisionId: string; divisionName: string }[];
  heats: Heat[];
  stages: { number: number; title: string; workoutByDivision: Record<string, string> }[];
  sheets: { id: string; workoutId: string; athleteId: string; status: ScoresheetStatus; judgeUserId: string | null; judgeName: string; officialResult: string | null }[];
  viewer: { id: string; name: string; role: string };
};
type OpenTarget = { athlete: { id: string; name: string; box: string; divisionName: string }; workoutId: string; heatId?: string; lane?: number };

const CHIP_CLASS: Record<ScoresheetStatus | 'not_started', string> = {
  not_started: 'border-card-border text-muted',
  in_progress: 'border-primary bg-primary/15 text-foreground',
  submitted: 'border-trading-up bg-trading-up/10 text-trading-up',
  returned: 'border-trading-down bg-trading-down/10 text-trading-down',
  cancelled: 'border-card-border text-muted'
};

const STAGE_PREFIX = 'stage:';

/** Provas que o judge escolhe: as provas do evento e as provas antigas que nenhuma delas agrupa. */
const buildOptions = (board: Board) => {
  const grouped = new Set(board.stages.flatMap((stage) => Object.values(stage.workoutByDivision)));
  return [
    ...board.stages.map((stage) => ({ key: `${STAGE_PREFIX}${stage.number}`, label: stage.title })),
    ...board.workouts.filter((item) => !grouped.has(item.id)).map((item) => ({ key: item.id, label: `${item.code ? `${item.code} · ` : ''}${item.name}` }))
  ];
};
const firstSelection = (board: Board) => buildOptions(board)[0]?.key || '';
const sheetKey = (workoutId: string, athleteId: string) => `${workoutId}|${athleteId}`;
const selectionOfHeat = (heat: Heat) => (heat.stageNumber ? `${STAGE_PREFIX}${heat.stageNumber}` : heat.workoutId);

function LaneBadge({ lane, small = false }: { lane: number; small?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 flex-col items-center justify-center rounded-xl border-2 border-primary bg-primary text-ink ${small ? 'h-12 min-w-12' : 'h-20 min-w-20'}`}
    >
      <span className={`${small ? 'text-[8px]' : 'text-[10px]'} font-extrabold uppercase tracking-widest`}>Raia</span>
      <span className={`font-number font-extrabold leading-none ${small ? 'text-2xl' : 'text-4xl'}`}>{lane}</span>
    </span>
  );
}

export function CourtBoard({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [board, setBoard] = useState<Board | null>(null);
  // Prova escolhida na lista completa: o id de uma prova ou `stage:N` (prova do evento).
  const [selection, setSelection] = useState('');
  const [error, setError] = useState('');
  const [opening, setOpening] = useState('');
  const [showLoose, setShowLoose] = useState(false);
  const [looseQuery, setLooseQuery] = useState('');
  // Raia do judge (D1): undefined enquanto lê o aparelho; null = ainda não escolheu.
  const [myLane, setMyLane] = useState<CourtLane | null | undefined>(undefined);
  const [folds, setFolds] = useState({ other: false, previous: false, all: false });
  const [confirming, setConfirming] = useState<(OpenTarget & { warnings: string[] }) | null>(null);
  // Volta da súmula liberada pelo judge (Story 1.148): aviso e limpa o endereço.
  const [notice, setNotice] = useState('');
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/sheets?view=board&eventId=${encodeURIComponent(eventId)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Erro ao carregar o evento.');
    setBoard(data as Board);
    setSelection((current) => current || firstSelection(data as Board));
  }, [eventId]);

  useEffect(() => {
    const first = window.setTimeout(() => {
      setMyLane(loadCourtLane(eventId));
      const url = new URL(window.location.href);
      if (url.searchParams.get('liberada') === '1') {
        setNotice('Súmula liberada. Nada foi gravado.');
        url.searchParams.delete('liberada');
        window.history.replaceState(null, '', `${url.pathname}${url.search}`);
      }
    }, 0);
    return () => window.clearTimeout(first);
  }, [eventId]);

  useEffect(() => {
    const refresh = () => void load().then(() => setError('')).catch((cause) => setError(cause instanceof Error ? cause.message : 'Erro ao carregar o evento.'));
    const first = window.setTimeout(refresh, 0);
    const interval = window.setInterval(refresh, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  useEffect(() => {
    if (!confirming) return;
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setConfirming(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirming]);

  const chooseLane = (lane: CourtLane | null) => {
    setMyLane(lane);
    saveCourtLane(eventId, lane);
    setFolds({ other: false, previous: false, all: false });
  };

  const stage = useMemo(() => {
    if (!selection.startsWith(STAGE_PREFIX)) return null;
    const number = Number(selection.slice(STAGE_PREFIX.length));
    return board?.stages.find((item) => item.number === number) ?? null;
  }, [board, selection]);
  const options = useMemo(() => (board ? buildOptions(board) : []), [board]);
  const sheetByAthlete = useMemo(() => new Map((board?.sheets || [])
    .map((sheet) => [sheetKey(sheet.workoutId, sheet.athleteId), sheet] as const)), [board]);

  const heats = useMemo(() => (board?.heats || []).filter((heat) => (stage ? heat.stageNumber === stage.number : heat.stageNumber === null && heat.workoutId === selection)), [board, selection, stage]);
  const workout = stage ? null : board?.workouts.find((item) => item.id === selection) ?? null;
  // Prova de uma categoria só mostra os atletas dela; a prova do evento, os das categorias que têm prova nela.
  const looseAthletes = useMemo(() => {
    const inHeat = new Set(heats.flatMap((heat) => heat.lanes.map((lane) => lane.athleteId)));
    return (board?.athletes || []).filter((athlete) => {
      if (inHeat.has(athlete.id)) return false;
      if (stage) return Boolean(stage.workoutByDivision[athlete.divisionId]);
      return !workout?.divisionId || athlete.divisionId === workout.divisionId;
    });
  }, [board, heats, workout, stage]);
  // D7: ordem alfabética e busca por nome ou box.
  const looseShown = useMemo(() => filterLooseAthletes(looseAthletes, looseQuery), [looseAthletes, looseQuery]);
  // Prova que o atleta faz nesta seleção: a da raia dele ou, sem bateria, a da categoria dele.
  const workoutOfLoose = (athlete: { divisionId: string }) => (stage ? stage.workoutByDivision[athlete.divisionId] || '' : selection);

  // Bateria atual (D2), pela regra do telão.
  const laneStatus = useCallback((lane: Lane): FocusLaneStatus => {
    const status = sheetByAthlete.get(sheetKey(lane.workoutId, lane.athleteId))?.status;
    return status === 'in_progress' || status === 'returned' || status === 'submitted' ? status : 'not_started';
  }, [sheetByAthlete]);
  const allHeats = useMemo(() => orderHeats(board?.heats || []), [board]);
  const focusHeats = useMemo(() => allHeats.map((heat) => ({ ...heat, laneStatuses: heat.lanes.map(laneStatus) })), [allHeats, laneStatus]);
  const current = useMemo(() => findCurrentHeat(focusHeats), [focusHeats]);
  const currentHeat = allHeats.find((heat) => heat.id === current?.heatId) ?? null;
  const nextHeatItem = currentHeat ? allHeats.find((heat) => heat.id === followingHeatId(focusHeats, currentHeat.id)) ?? null : null;
  const maxLane = Math.max(0, ...allHeats.flatMap((heat) => heat.lanes.map((lane) => lane.lane)));
  const heatLabel = (heat: Heat) => {
    if (heat.stageNumber) return board?.stages.find((item) => item.number === heat.stageNumber)?.title || heat.stageTitle || `Prova ${heat.stageNumber}`;
    const item = board?.workouts.find((candidate) => candidate.id === heat.workoutId);
    return item ? `${item.code ? `${item.code} · ` : ''}${item.name}` : heat.title;
  };
  const heatName = (heat: Heat) => (heat.heatNumber ? `Bateria ${heat.heatNumber}` : heat.title || 'Bateria');

  const viewerId = board?.viewer.id;
  const isOwn = (sheet: Board['sheets'][number] | undefined) => Boolean(sheet && sheet.judgeUserId === viewerId && (sheet.status === 'in_progress' || sheet.status === 'returned'));
  const ownOpenSheets = useMemo(() => (board?.sheets || []).filter((sheet) => sheet.judgeUserId === viewerId && (sheet.status === 'in_progress' || sheet.status === 'returned')), [board, viewerId]);

  const open = async (athleteId: string, workoutId: string, heatId?: string, lane?: number) => {
    setOpening(athleteId);
    setError('');
    setConfirming(null);
    try {
      const response = await fetch('/api/sheets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'open', eventId, workoutId, athleteId, heatId, lane })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Não foi possível abrir a súmula.');
      router.push(`/judge/quadra/sumula/${encodeURIComponent(data.sheet.id)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível abrir a súmula.');
      setOpening('');
    }
  };

  // D3: na raia do judge e na bateria atual abre direto; fora disso, confirma.
  const requestOpen = (target: OpenTarget) => {
    const decision = openDecision({
      myLane: myLane ?? null,
      lane: target.lane ?? null,
      heatId: target.heatId ?? null,
      currentHeatId: current?.heatId ?? null,
      ownSheet: isOwn(sheetByAthlete.get(sheetKey(target.workoutId, target.athlete.id)))
    });
    if (decision.direct) void open(target.athlete.id, target.workoutId, target.heatId, target.lane);
    else setConfirming({ ...target, warnings: decision.warnings });
  };

  const athleteButton = (athlete: { id: string; name: string; box: string; divisionName: string }, workoutId: string, laneLabel: string, heatId?: string, lane?: number) => {
    const sheet = sheetByAthlete.get(sheetKey(workoutId, athlete.id));
    const status = sheet?.status ?? 'not_started';
    // Sem judge (liberada pelo gestor, Story 1.148): quem abrir assume.
    const blocked = Boolean(sheet && (status === 'in_progress' || status === 'returned') && sheet.judgeUserId !== null && sheet.judgeUserId !== board?.viewer.id);
    const label = status === 'submitted' && sheet?.officialResult
      ? `${SCORESHEET_STATUS_LABELS.submitted} · ${sheet.officialResult}`
      : blocked ? `Com ${sheet?.judgeName}` : SCORESHEET_STATUS_LABELS[status];
    return (
      <button
        type="button"
        onClick={() => requestOpen({ athlete, workoutId, heatId, lane })}
        disabled={blocked || opening !== ''}
        aria-label={`${laneLabel}: ${athlete.name}, ${athlete.divisionName}. ${label}`}
        className="flex min-h-16 w-full items-center gap-3 rounded-xl border border-card-border bg-card px-3 py-2 text-left hover:border-primary disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-card-border bg-dark-gray font-number text-sm font-extrabold">{laneLabel}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-extrabold">{athlete.name}</span>
          <span className="block truncate text-xs font-semibold text-muted">{athlete.box} · {athlete.divisionName}</span>
        </span>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${CHIP_CLASS[status]}`}>
          {opening === athlete.id ? 'Abrindo…' : label}
        </span>
      </button>
    );
  };
  const laneButton = (heat: Heat, lane: Lane, laneLabel = `R${lane.lane}`) => athleteButton(
    { id: lane.athleteId, name: lane.athleteName, box: lane.box, divisionName: lane.divisionName }, lane.workoutId, laneLabel, heat.id, lane.lane
  );

  const foldButton = (key: keyof typeof folds, label: string) => (
    <button
      type="button"
      onClick={() => setFolds((value) => ({ ...value, [key]: !value[key] }))}
      aria-expanded={folds[key]}
      className="flex min-h-12 w-full items-center justify-between gap-3 rounded-md border border-card-border bg-dark-gray px-3 text-left text-sm font-bold"
    >
      {label}
      {folds[key] ? <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" /> : <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />}
    </button>
  );

  // Lista completa (como antes da Story 1.147): provas, baterias e atletas sem bateria.
  const fullList = board && (
    <div className="space-y-5">
      <div role="group" aria-label="Prova" className="flex gap-2 overflow-x-auto pb-1">
        {options.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setSelection(item.key)}
            aria-pressed={item.key === selection}
            className={`min-h-11 shrink-0 rounded-full border px-4 text-sm font-bold ${item.key === selection ? 'border-primary bg-primary text-ink' : 'border-card-border bg-dark-gray'}`}
          >
            {item.label}
          </button>
        ))}
      </div>
      {workout && <p className="text-xs font-semibold text-muted">{summarizeStructure(workout.structure)}</p>}
      {stage && (
        <ul className="space-y-0.5 text-xs font-semibold text-muted">
          {Object.entries(stage.workoutByDivision).map(([divisionId, workoutId]) => {
            const item = board.workouts.find((candidate) => candidate.id === workoutId);
            const name = board.divisions.find((division) => division.id === divisionId)?.name || item?.name;
            return item ? <li key={divisionId}>{name}: {summarizeStructure(item.structure)}</li> : null;
          })}
        </ul>
      )}

      {heats.length === 0 && (
        <p className="rounded-xl border border-dashed border-card-border px-4 py-4 text-sm text-muted">
          Esta prova ainda não tem baterias no cronograma. Escolha o atleta na lista abaixo.
        </p>
      )}

      {heats.map((heat) => (
        <section key={heat.id} aria-labelledby={`heat-${heat.id}`} className="space-y-2">
          <h2 id={`heat-${heat.id}`} className="flex items-baseline justify-between gap-2 text-sm font-extrabold uppercase tracking-wider">
            <span>{heatName(heat)}{heat.id === current?.heatId ? ' · agora' : ''}</span>
            {heat.time && <span className="font-number text-xs font-bold text-muted">{heat.time}</span>}
          </h2>
          <ul className="space-y-2">
            {heat.lanes.map((lane) => <li key={`${heat.id}-${lane.lane}`}>{laneButton(heat, lane)}</li>)}
          </ul>
        </section>
      ))}

      {looseAthletes.length > 0 && (
        <section aria-labelledby="loose-athletes" className="space-y-2">
          <button
            id="loose-athletes"
            type="button"
            onClick={() => setShowLoose((value) => !value)}
            aria-expanded={showLoose || heats.length === 0}
            className="flex min-h-11 w-full items-center justify-between rounded-md border border-card-border bg-dark-gray px-3 text-sm font-bold"
          >
            Atletas sem bateria nesta prova ({looseAthletes.length})
            {showLoose || heats.length === 0 ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
          </button>
          {(showLoose || heats.length === 0) && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted">Estes atletas estão fora das baterias do cronograma. Avise o gestor para colocá-los numa bateria.</p>
              <label htmlFor="loose-search" className="sr-only">Buscar atleta sem bateria</label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
                <input
                  id="loose-search"
                  type="search"
                  value={looseQuery}
                  onChange={(event) => setLooseQuery(event.target.value)}
                  placeholder="Nome, equipe ou box"
                  autoComplete="off"
                  className="min-h-11 w-full rounded-md border border-card-border bg-dark-gray pl-9 pr-3 text-sm"
                />
              </div>
              <ul className="space-y-2">
                {looseShown.map((athlete) => <li key={athlete.id}>{athleteButton(athlete, workoutOfLoose(athlete), '–')}</li>)}
                {looseShown.length === 0 && <li className="px-1 text-sm text-muted">Nenhum atleta com esse nome.</li>}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );

  const myLaneInHeat = (heat: Heat | null) => (heat && typeof myLane === 'number' ? heat.lanes.find((lane) => lane.lane === myLane) ?? null : null);

  const nowCard = () => {
    if (!currentHeat || typeof myLane !== 'number') return null;
    const lane = myLaneInHeat(currentHeat);
    const sheet = lane ? sheetByAthlete.get(sheetKey(lane.workoutId, lane.athleteId)) : undefined;
    const status = sheet?.status ?? 'not_started';
    const own = isOwn(sheet);
    const held = Boolean(sheet && (status === 'in_progress' || status === 'returned') && sheet.judgeUserId !== null && !own);
    const stateLabel = current?.finished ? 'Última bateria do cronograma' : current?.called ? 'Em chamada agora' : 'Próxima a ser chamada';
    return (
      <section aria-label="Agora na sua raia" className="space-y-3 rounded-2xl border-2 border-foreground bg-background p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-bold text-muted">
              <span className="h-2 w-2 shrink-0 rounded-full bg-trading-down" aria-hidden="true" />
              {stateLabel}
            </p>
            <p className="text-base font-extrabold leading-tight">{heatLabel(currentHeat)}</p>
            <p className="text-xs font-semibold text-muted">
              {heatName(currentHeat)}{currentHeat.time && <> · <span className="font-number">{currentHeat.time}</span></>}
            </p>
          </div>
          <LaneBadge lane={myLane} />
        </div>
        {lane ? (
          <>
            <div>
              <p className="break-words text-2xl font-extrabold leading-tight">{lane.athleteName}</p>
              <p className="text-sm font-semibold text-muted">{lane.box} · {lane.divisionName}</p>
            </div>
            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${CHIP_CLASS[status]}`}>
              {status === 'submitted' && sheet?.officialResult ? `${SCORESHEET_STATUS_LABELS.submitted} · ${sheet.officialResult}` : held ? `Com ${sheet?.judgeName}` : SCORESHEET_STATUS_LABELS[status]}
            </span>
            {status === 'submitted' ? (
              <p className="text-sm font-semibold text-muted">Enviada. A próxima bateria aparece aqui quando esta terminar.</p>
            ) : held ? (
              <p className="text-sm font-semibold text-muted">Esta súmula está com {sheet?.judgeName}. Fale com o gestor.</p>
            ) : (
              <button
                type="button"
                onClick={() => requestOpen({ athlete: { id: lane.athleteId, name: lane.athleteName, box: lane.box, divisionName: lane.divisionName }, workoutId: lane.workoutId, heatId: currentHeat.id, lane: lane.lane })}
                disabled={opening !== ''}
                className="flex min-h-14 w-full items-center justify-center rounded-xl border-2 border-primary bg-primary text-base font-extrabold text-ink disabled:opacity-60"
              >
                {opening === lane.athleteId ? 'Abrindo…' : own ? 'Retomar súmula' : 'Abrir súmula'}
              </button>
            )}
          </>
        ) : (
          <p className="text-sm font-semibold text-muted">Sua raia está vazia nesta bateria.</p>
        )}
      </section>
    );
  };

  const lanePicker = (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-2xl font-extrabold leading-tight">Em qual raia você está?</h2>
        <p className="text-sm font-medium text-muted">Você vai ver primeiro o atleta desta raia em cada bateria. Dá para trocar a qualquer momento.</p>
      </div>
      <div role="group" aria-label="Raias" className="grid grid-cols-4 gap-2.5">
        {Array.from({ length: Math.max(maxLane, 1) }, (_, index) => index + 1).map((lane) => (
          <button
            key={lane}
            type="button"
            onClick={() => chooseLane(lane)}
            aria-label={`Raia ${lane}`}
            className="flex aspect-square flex-col items-center justify-center rounded-2xl border-2 border-card-border bg-card hover:border-primary hover:bg-primary/15"
          >
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Raia</span>
            <span className="font-number text-3xl font-extrabold leading-none">{lane}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => chooseLane('multi')}
        className="min-h-13 w-full rounded-xl border border-dashed border-card-border bg-dark-gray py-3 text-base font-bold"
      >
        Vou cobrir várias raias
      </button>
    </div>
  );

  const athleteName = (athleteId: string) => board?.athletes.find((athlete) => athlete.id === athleteId)?.name || 'Atleta';
  const placeOf = (workoutId: string, athleteId: string) => {
    const heat = allHeats.find((item) => item.lanes.some((lane) => lane.athleteId === athleteId && lane.workoutId === workoutId));
    const lane = heat?.lanes.find((item) => item.athleteId === athleteId && item.workoutId === workoutId);
    return heat && lane ? { heat, lane } : null;
  };

  const previousHeats = currentHeat && typeof myLane === 'number'
    ? allHeats.slice(0, allHeats.findIndex((heat) => heat.id === currentHeat.id))
      .filter((heat) => selectionOfHeat(heat) === selectionOfHeat(currentHeat) && myLaneInHeat(heat))
      .reverse()
    : [];

  const focusView = board && currentHeat && myLane !== null && myLane !== undefined && (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-card-border bg-card px-3 py-2 text-sm">
        <span>{myLane === 'multi' ? <>Você está cobrindo <b>várias raias</b></> : <>Você está na <b>Raia {myLane}</b></>}</span>
        <button type="button" onClick={() => chooseLane(null)} className="min-h-10 shrink-0 rounded-md border border-card-border bg-dark-gray px-3 text-sm font-bold">
          Trocar
        </button>
      </div>

      {ownOpenSheets.length > 0 && (
        <section aria-labelledby="own-open" className="space-y-2 rounded-xl border border-primary bg-primary/15 px-3 py-3">
          <h2 id="own-open" className="text-sm font-extrabold">{ownOpenSheets.length === 1 ? 'Sua súmula aberta' : `Suas súmulas abertas (${ownOpenSheets.length})`}</h2>
          <ul className="space-y-2">
            {ownOpenSheets.map((sheet) => {
              const place = placeOf(sheet.workoutId, sheet.athleteId);
              return (
                <li key={sheet.id}>
                  <button
                    type="button"
                    onClick={() => void open(sheet.athleteId, sheet.workoutId, place?.heat.id, place?.lane.lane)}
                    disabled={opening !== ''}
                    className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md border border-primary bg-background px-3 text-left text-sm font-bold"
                  >
                    <span className="min-w-0 truncate">Retomar · {athleteName(sheet.athleteId)}</span>
                    <span className="shrink-0 font-number text-xs text-muted">{place ? `${place.heat.heatNumber ? `B${place.heat.heatNumber} ` : ''}R${place.lane.lane}` : 'sem bateria'}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {myLane === 'multi' ? (
        <section aria-labelledby="multi-heat" className="space-y-2">
          <h2 id="multi-heat" className="flex items-baseline justify-between gap-2 text-sm font-extrabold uppercase tracking-wider">
            <span>{current?.called ? 'Em chamada' : 'Próxima'} · {heatName(currentHeat)}</span>
            {currentHeat.time && <span className="font-number text-xs font-bold text-muted">{currentHeat.time}</span>}
          </h2>
          <p className="text-xs font-semibold text-muted">{heatLabel(currentHeat)}</p>
          <ul className="space-y-2">
            {currentHeat.lanes.map((lane) => <li key={`${currentHeat.id}-${lane.lane}`}>{laneButton(currentHeat, lane)}</li>)}
          </ul>
        </section>
      ) : (
        <>
          {nowCard()}
          {nextHeatItem && myLaneInHeat(nextHeatItem) && (
            <div className="flex items-center gap-3 rounded-xl border border-dashed border-card-border px-3 py-2.5">
              <LaneBadge lane={myLane} small />
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-muted">Depois · {heatName(nextHeatItem)}{nextHeatItem.time ? ` · ${nextHeatItem.time}` : ''}</span>
                <span className="block truncate text-sm font-extrabold">{myLaneInHeat(nextHeatItem)?.athleteName}</span>
              </span>
            </div>
          )}
          <section className="space-y-2">
            {foldButton('other', `Outras raias da ${heatName(currentHeat)} (${currentHeat.lanes.filter((lane) => lane.lane !== myLane).length})`)}
            {folds.other && (
              <ul className="space-y-2">
                {currentHeat.lanes.filter((lane) => lane.lane !== myLane).map((lane) => <li key={`${currentHeat.id}-${lane.lane}`}>{laneButton(currentHeat, lane)}</li>)}
              </ul>
            )}
          </section>
          {previousHeats.length > 0 && (
            <section className="space-y-2">
              {foldButton('previous', `Sua raia nas baterias anteriores (${previousHeats.length})`)}
              {folds.previous && (
                <ul className="space-y-2">
                  {previousHeats.map((heat) => {
                    const lane = myLaneInHeat(heat) as Lane;
                    return <li key={heat.id}>{laneButton(heat, lane, heat.heatNumber ? `B${heat.heatNumber}` : '–')}</li>;
                  })}
                </ul>
              )}
            </section>
          )}
        </>
      )}

      <section className="space-y-3">
        {foldButton('all', 'Todas as provas e baterias')}
        {folds.all && fullList}
      </section>
    </div>
  );

  const hasHeats = allHeats.length > 0;
  const subtitle = hasHeats && myLane !== null && myLane !== undefined && currentHeat && !folds.all
    ? heatLabel(currentHeat)
    : stage ? stage.title : workout ? workout.name : undefined;

  return (
    <CourtShell title={board?.event.name || 'Evento'} subtitle={subtitle} back={{ href: '/judge/quadra', label: 'Voltar aos eventos' }}>
      {error && <p role="alert" className="mb-4 rounded-md border border-trading-down bg-trading-down/10 px-4 py-3 text-sm font-semibold">{error}</p>}
      {notice && (
        <p role="status" className="mb-4 flex items-center justify-between gap-3 rounded-md border border-trading-up bg-trading-up/10 px-4 py-2 text-sm font-semibold">
          {notice}
          <button type="button" onClick={() => setNotice('')} className="min-h-10 shrink-0 rounded-md px-2 text-xs font-bold underline underline-offset-4">Fechar</button>
        </p>
      )}
      {!board || myLane === undefined ? (
        !error && <p role="status" className="py-10 text-center text-sm font-semibold text-muted">Carregando baterias…</p>
      ) : options.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-card px-4 py-8 text-center">
          <p className="font-bold">Nenhuma prova com súmula digital neste evento.</p>
          <p className="text-sm text-muted">O gestor estrutura a súmula na aba Provas.</p>
        </div>
      ) : !hasHeats ? (
        fullList
      ) : myLane === null ? (
        lanePicker
      ) : (
        focusView
      )}

      {confirming && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/50" onClick={() => setConfirming(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-open-title"
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-3xl space-y-3 rounded-t-2xl bg-background px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 shadow-2xl"
          >
            {confirming.warnings.map((warning) => (
              <p key={warning} className="text-xs font-extrabold uppercase tracking-wider text-trading-down">{warning}</p>
            ))}
            <div className="flex items-center gap-3">
              {confirming.lane ? <LaneBadge lane={confirming.lane} /> : null}
              <div className="min-w-0">
                <p id="confirm-open-title" className="break-words text-xl font-extrabold leading-tight">{confirming.athlete.name}</p>
                <p className="text-sm font-semibold text-muted">{confirming.athlete.box} · {confirming.athlete.divisionName}</p>
                {(() => {
                  const heat = allHeats.find((item) => item.id === confirming.heatId);
                  return heat ? <p className="text-sm font-semibold text-muted">{heatLabel(heat)} · {heatName(heat)}{heat.time ? ` · ${heat.time}` : ''}</p> : null;
                })()}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <button ref={confirmRef} type="button" onClick={() => setConfirming(null)} className="min-h-12 rounded-xl border border-card-border bg-dark-gray text-base font-bold">
                Voltar
              </button>
              <button
                type="button"
                onClick={() => void open(confirming.athlete.id, confirming.workoutId, confirming.heatId, confirming.lane)}
                className="min-h-12 rounded-xl border-2 border-primary bg-primary text-base font-extrabold text-ink"
              >
                {confirming.warnings.length > 0 ? 'Abrir mesmo assim' : 'Abrir súmula'}
              </button>
            </div>
          </div>
        </div>
      )}
    </CourtShell>
  );
}
