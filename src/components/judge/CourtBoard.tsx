'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { CourtShell } from '@/components/judge/CourtShell';
import { SCORESHEET_STATUS_LABELS, type ScoresheetStatus } from '@/lib/scoresheet';
import { summarizeStructure } from '@/lib/workoutStructureEditor';
import type { WorkoutStructure } from '@/lib/workoutStructure';

// Quadro do evento na quadra (Story 1.49): o judge escolhe a prova, vê as
// baterias com as raias e o estado de cada súmula e toca no atleta para abrir
// (ou retomar) a súmula. Atletas sem bateria aparecem por categoria. O quadro
// se atualiza a cada 15 s e quando a tela volta a ficar visível.
// Story 1.89: a prova pode ser uma PROVA DO EVENTO ("Prova 1 · DT Speed"), cujas
// baterias misturam categorias; cada raia abre a súmula da prova da categoria do atleta.

const REFRESH_MS = 15_000;

type Lane = { lane: number; athleteId: string; athleteName: string; box: string; divisionId: string; divisionName: string; workoutId: string };
type Board = {
  event: { id: string; name: string; date: string; location: string };
  workouts: { id: string; name: string; code: string; divisionId: string | null; structure: WorkoutStructure }[];
  divisions: { id: string; name: string }[];
  athletes: { id: string; name: string; box: string; divisionId: string; divisionName: string }[];
  heats: { id: string; workoutId: string; stageNumber: number | null; stageTitle: string; heatNumber: number | null; time: string; title: string; lanes: Lane[] }[];
  stages: { number: number; title: string; workoutByDivision: Record<string, string> }[];
  sheets: { id: string; workoutId: string; athleteId: string; status: ScoresheetStatus; judgeUserId: string | null; judgeName: string; officialResult: string | null }[];
  viewer: { id: string; name: string; role: string };
};

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

export function CourtBoard({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [board, setBoard] = useState<Board | null>(null);
  // Prova escolhida: o id de uma prova ou `stage:N` (prova do evento).
  const [selection, setSelection] = useState('');
  const [error, setError] = useState('');
  const [opening, setOpening] = useState('');
  const [showLoose, setShowLoose] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/sheets?view=board&eventId=${encodeURIComponent(eventId)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Erro ao carregar o evento.');
    setBoard(data as Board);
    setSelection((current) => current || firstSelection(data as Board));
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
  const selectedLabel = stage ? stage.title : workout ? workout.name : '';
  // Prova de uma categoria só mostra os atletas dela; a prova do evento, os das categorias que têm prova nela.
  const looseAthletes = useMemo(() => {
    const inHeat = new Set(heats.flatMap((heat) => heat.lanes.map((lane) => lane.athleteId)));
    return (board?.athletes || []).filter((athlete) => {
      if (inHeat.has(athlete.id)) return false;
      if (stage) return Boolean(stage.workoutByDivision[athlete.divisionId]);
      return !workout?.divisionId || athlete.divisionId === workout.divisionId;
    });
  }, [board, heats, workout, stage]);
  // Prova que o atleta faz nesta seleção: a da raia dele ou, sem bateria, a da categoria dele.
  const workoutOfLoose = (athlete: { divisionId: string }) => (stage ? stage.workoutByDivision[athlete.divisionId] || '' : selection);

  const open = async (athleteId: string, workoutId: string, heatId?: string, lane?: number) => {
    setOpening(athleteId);
    setError('');
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

  const athleteButton = (athlete: { id: string; name: string; box: string; divisionName: string }, workoutId: string, laneLabel: string, heatId?: string, lane?: number) => {
    const sheet = sheetByAthlete.get(sheetKey(workoutId, athlete.id));
    const status = sheet?.status ?? 'not_started';
    const blocked = Boolean(sheet && (status === 'in_progress' || status === 'returned') && sheet.judgeUserId !== board?.viewer.id);
    const label = status === 'submitted' && sheet?.officialResult
      ? `${SCORESHEET_STATUS_LABELS.submitted} · ${sheet.officialResult}`
      : blocked ? `Com ${sheet?.judgeName}` : SCORESHEET_STATUS_LABELS[status];
    return (
      <button
        type="button"
        onClick={() => void open(athlete.id, workoutId, heatId, lane)}
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

  return (
    <CourtShell title={board?.event.name || 'Evento'} subtitle={selectedLabel || undefined} back={{ href: '/judge/quadra', label: 'Voltar aos eventos' }}>
      {error && <p role="alert" className="mb-4 rounded-md border border-trading-down bg-trading-down/10 px-4 py-3 text-sm font-semibold">{error}</p>}
      {!board ? (
        !error && <p role="status" className="py-10 text-center text-sm font-semibold text-muted">Carregando baterias…</p>
      ) : options.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-card px-4 py-8 text-center">
          <p className="font-bold">Nenhuma prova com súmula digital neste evento.</p>
          <p className="text-sm text-muted">O gestor estrutura a súmula na aba Provas.</p>
        </div>
      ) : (
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
                <span>{heat.heatNumber ? `Bateria ${heat.heatNumber}` : heat.title || 'Bateria'}</span>
                {heat.time && <span className="font-number text-xs font-bold text-muted">{heat.time}</span>}
              </h2>
              <ul className="space-y-2">
                {heat.lanes.map((lane) => (
                  <li key={`${heat.id}-${lane.lane}`}>
                    {athleteButton({ id: lane.athleteId, name: lane.athleteName, box: lane.box, divisionName: lane.divisionName }, lane.workoutId, `R${lane.lane}`, heat.id, lane.lane)}
                  </li>
                ))}
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
                <ul className="space-y-2">
                  {looseAthletes.map((athlete) => <li key={athlete.id}>{athleteButton(athlete, workoutOfLoose(athlete), '–')}</li>)}
                </ul>
              )}
            </section>
          )}
        </div>
      )}
    </CourtShell>
  );
}
