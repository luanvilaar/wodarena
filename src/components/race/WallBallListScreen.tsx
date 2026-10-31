'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, Users } from 'lucide-react';

import { CourtShell } from '@/components/judge/CourtShell';
import { useApp } from '@/context/AppContext';
import { WALL_BALL_EYEBROW, describeWallBallRow, type WallBallBoardAthlete } from '@/lib/raceWallBall';

// Lista da onda do Wall Ball (Story 1.97, AC1; maquete telas/wall-ball.html,
// estado "Lista da onda"). O árbitro escolhe o atleta que chegou à raia dele
// (D7: número de peito só na F2, QR na F3). Abrir usa a ação open_attempt
// (Story 1.94) e leva à tela de contagem. Concluídos ficam embaixo, separados;
// quem saiu antes das reps continua na lista com "Saiu · faltam N" (D22, D24).

type BoardPayload = {
  event: { id: string; name: string; timeZone: string };
  waves: { id: string; title: string; time: string; startedAt: string | null; athletes: WallBallBoardAthlete[] }[];
  viewer: { id: string };
};

export function WallBallListScreen({ eventId }: { eventId: string }) {
  const { currentUser } = useApp();
  const router = useRouter();
  const [payload, setPayload] = useState<BoardPayload | null>(null);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/race-sheets?view=wall_ball&eventId=${encodeURIComponent(eventId)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Erro ao carregar a lista da onda.');
      setPayload(data as BoardPayload);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erro ao carregar a lista da onda.');
    }
  }, [eventId]);

  useEffect(() => {
    if (!currentUser) return;
    const first = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(first);
  }, [currentUser, load]);

  const open = async (athlete: WallBallBoardAthlete) => {
    if (!athlete.stationId || opening) return;
    setOpening(athlete.athleteId);
    try {
      const response = await fetch('/api/race-sheets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'open_attempt', eventId, athleteId: athlete.athleteId, stationId: athlete.stationId })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.attempt?.id) throw new Error(data.error || 'Não foi possível abrir a tentativa.');
      router.push(`/judge/corrida/${encodeURIComponent(eventId)}/wall-ball/${encodeURIComponent(data.attempt.id)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível abrir a tentativa.');
      setOpening(null);
      void load();
    }
  };

  const viewerId = payload?.viewer.id ?? currentUser?.id ?? '';
  const rows = (payload?.waves ?? []).flatMap((wave) => wave.athletes.map((athlete) => ({ athlete, wave, state: describeWallBallRow(athlete, viewerId) })));
  const active = rows.filter((row) => !row.state.done);
  const done = rows.filter((row) => row.state.done);
  const title = payload && payload.waves.length > 0 ? `Wall Ball · ${payload.waves.map((wave) => wave.title).join(', ')}` : 'Wall Ball';

  const row = ({ athlete, state }: (typeof rows)[number]) => (
    <li key={athlete.athleteId}>
      <button
        type="button"
        disabled={state.disabled || opening !== null}
        onClick={() => void open(athlete)}
        className={`flex min-h-[68px] w-full items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-left disabled:cursor-not-allowed ${state.done ? 'border-card-border opacity-70' : 'border-card-border hover:border-primary disabled:opacity-60'}`}
      >
        <span className="min-w-0">
          <span className="block truncate text-base font-extrabold">{athlete.name}</span>
          <span className="block truncate text-xs font-semibold text-muted">{[athlete.team ? 'Dupla' : athlete.box, athlete.divisionName].filter(Boolean).join(' · ')}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {athlete.team && (
            <span className="flex items-center gap-1 rounded-full border border-primary/60 px-2 py-1 text-[11px] font-bold">
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              Dupla
            </span>
          )}
          <span className={`rounded-full border px-2 py-1 text-[11px] font-bold tabular-nums ${state.done ? 'border-trading-up/60 text-trading-up' : athlete.attempt?.abandoned ? 'border-primary text-foreground' : 'border-card-border text-muted'}`}>
            {opening === athlete.athleteId ? 'Abrindo…' : state.chip}
          </span>
          {!state.disabled && <ChevronRight className="h-5 w-5 text-muted" aria-hidden="true" />}
        </span>
      </button>
    </li>
  );

  return (
    <CourtShell
      eyebrow={WALL_BALL_EYEBROW}
      title={title}
      subtitle={payload?.event.name}
      back={{ href: `/judge/corrida/${encodeURIComponent(eventId)}`, label: 'Voltar ao evento' }}
    >
      {error && <p role="alert" className="mb-3 rounded-md border border-trading-down bg-trading-down/10 px-4 py-3 text-sm font-semibold">{error}</p>}
      {!payload ? (
        !error && <p role="status" className="py-10 text-center text-sm font-semibold text-muted">Carregando a lista da onda…</p>
      ) : rows.length === 0 ? (
        <div className="space-y-2 rounded-xl border border-card-border bg-card px-4 py-8 text-center">
          <p className="font-bold">Nenhum atleta em corrida.</p>
          <p className="text-sm text-muted">Os atletas aparecem aqui depois que a onda deles larga.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-muted">Toque no atleta que chegou à sua raia.</p>
          <ul className="space-y-2" aria-label="Atletas em corrida">{active.map(row)}</ul>
          {done.length > 0 && (
            <>
              <p className="pt-2 text-xs font-bold uppercase tracking-widest text-muted">Concluídos</p>
              <ul className="space-y-2" aria-label="Atletas concluídos">{done.map(row)}</ul>
            </>
          )}
        </div>
      )}
    </CourtShell>
  );
}
