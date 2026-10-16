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

const REFRESH_MS = 15_000;

type Lane = { lane: number; athleteId: string; athleteName: string; box: string; divisionId: string; divisionName: string };
type Board = {
  event: { id: string; name: string; date: string; location: string };
  workouts: { id: string; name: string; code: string; divisionId: string | null; structure: WorkoutStructure }[];
  athletes: { id: string; name: string; box: string; divisionId: string; divisionName: string }[];
  heats: { id: string; workoutId: string; heatNumber: number | null; time: string; title: string; lanes: Lane[] }[];
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

export function CourtBoard({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [board, setBoard] = useState<Board | null>(null);
  const [workoutId, setWorkoutId] = useState('');
  const [error, setError] = useState('');
  const [opening, setOpening] = useState('');
  const [showLoose, setShowLoose] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/sheets?view=board&eventId=${encodeURIComponent(eventId)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Erro ao carregar o evento.');
    setBoard(data as Board);
    setWorkoutId((current) => current || (data as Board).workouts[0]?.id || '');
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

  const sheetByAthlete = useMemo(() => new Map((board?.sheets || [])
    .filter((sheet) => sheet.workoutId === workoutId)
    .map((sheet) => [sheet.athleteId, sheet])), [board, workoutId]);

  const heats = useMemo(() => (board?.heats || []).filter((heat) => heat.workoutId === workoutId), [board, workoutId]);
  const workout = board?.workouts.find((item) => item.id === workoutId) ?? null;
  // Prova de uma categoria só mostra os atletas dela.
  const looseAthletes = useMemo(() => {
    const inHeat = new Set(heats.flatMap((heat) => heat.lanes.map((lane) => lane.athleteId)));
    return (board?.athletes || []).filter((athlete) => !inHeat.has(athlete.id) && (!workout?.divisionId || athlete.divisionId === workout.divisionId));
  }, [board, heats, workout]);

  const open = async (athleteId: string, heatId?: string, lane?: number) => {
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

  const athleteButton = (athlete: { id: string; name: string; box: string; divisionName: string }, laneLabel: string, heatId?: string, lane?: number) => {
    const sheet = sheetByAthlete.get(athlete.id);
    const status = sheet?.status ?? 'not_started';
    const blocked = Boolean(sheet && (status === 'in_progress' || status === 'returned') && sheet.judgeUserId !== board?.viewer.id);
    const label = status === 'submitted' && sheet?.officialResult
      ? `${SCORESHEET_STATUS_LABELS.submitted} · ${sheet.officialResult}`
      : blocked ? `Com ${sheet?.judgeName}` : SCORESHEET_STATUS_LABELS[status];
    return (
      <button
        type="button"
        onClick={() => void open(athlete.id, heatId, lane)}
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
    <CourtShell title={board?.event.name || 'Evento'} subtitle={workout ? workout.name : undefined} back={{ href: '/judge/quadra', label: 'Voltar aos eventos' }}>
      {error && <p role="alert" className="mb-4 rounded-md border border-trading-down bg-trading-down/10 px-4 py-3 text-sm font-semibold">{error}</p>}
      {!board ? (
        !error && <p role="status" className="py-10 text-center text-sm font-semibold text-muted">Carregando baterias…</p>
      ) : board.workouts.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-card px-4 py-8 text-center">
          <p className="font-bold">Nenhuma prova com súmula digital neste evento.</p>
          <p className="text-sm text-muted">O gestor estrutura a súmula na aba Provas.</p>
        </div>
      ) : (
        <div className="space-y-5">
          <div role="group" aria-label="Prova" className="flex gap-2 overflow-x-auto pb-1">
            {board.workouts.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setWorkoutId(item.id)}
                aria-pressed={item.id === workoutId}
                className={`min-h-11 shrink-0 rounded-full border px-4 text-sm font-bold ${item.id === workoutId ? 'border-primary bg-primary text-ink' : 'border-card-border bg-dark-gray'}`}
              >
                {item.code ? `${item.code} · ` : ''}{item.name}
              </button>
            ))}
          </div>
          {workout && <p className="text-xs font-semibold text-muted">{summarizeStructure(workout.structure)}</p>}

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
                    {athleteButton({ id: lane.athleteId, name: lane.athleteName, box: lane.box, divisionName: lane.divisionName }, `R${lane.lane}`, heat.id, lane.lane)}
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
                  {looseAthletes.map((athlete) => <li key={athlete.id}>{athleteButton(athlete, '–')}</li>)}
                </ul>
              )}
            </section>
          )}
        </div>
      )}
    </CourtShell>
  );
}
