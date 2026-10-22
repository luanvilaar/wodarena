import type { LiveProgress } from '@/lib/liveProgress';
import type { WorkoutStructureFormat } from '@/lib/workoutStructure';

// Ordem parcial da bateria no telão (Story 1.54). Puro. Vale só para a tela:
// o resultado oficial continua vindo do envio da súmula (rankWorkoutScores no
// servidor). Quem ainda não tem registro fica sem posição, no fim, pela raia.
//
// - For Time: quem terminou (menor tempo) → mais repetições → chegou antes ao
//   último registro;
// - AMRAP e Intervalado (Story 1.60): mais repetições → chegou antes ao último
//   registro (no intervalado, o último que conta, dentro da janela);
// - Distância (Story 1.66): `repsDone` leva os metros do último lançamento →
//   maior total → lançou antes (o instante do último lançamento que conta);
// - Carga máxima: maior carga → menos tentativas → chegou antes.

export type LiveRankInput = {
  lane: number | null;
  progress: LiveProgress | null;
};

export type LiveRanked<T> = T & { position: number | null };

const started = (progress: LiveProgress | null): progress is LiveProgress => Boolean(progress && progress.seq > 0);
const later = (value: number | null) => (value === null ? Number.POSITIVE_INFINITY : value);

const compareProgress = (format: WorkoutStructureFormat, a: LiveProgress, b: LiveProgress) => {
  if (format === 'max_load') {
    return (b.scoreKg ?? 0) - (a.scoreKg ?? 0)
      || later(a.attemptsUsed) - later(b.attemptsUsed)
      || later(a.lastMarkAt) - later(b.lastMarkAt);
  }
  if (format === 'for_time') {
    const aDone = a.completedAt !== null;
    const bDone = b.completedAt !== null;
    if (aDone && bDone) return (a.completedAt as number) - (b.completedAt as number);
    if (aDone !== bDone) return aDone ? -1 : 1;
  }
  return b.repsDone - a.repsDone || later(a.lastMarkAt) - later(b.lastMarkAt);
};

export const rankLiveEntries = <T extends LiveRankInput>(format: WorkoutStructureFormat, entries: readonly T[]): LiveRanked<T>[] => {
  const active = entries.filter((entry) => started(entry.progress));
  const waiting = entries.filter((entry) => !started(entry.progress));
  const sorted = [...active].sort((a, b) => (
    compareProgress(format, a.progress as LiveProgress, b.progress as LiveProgress) || later(a.lane) - later(b.lane)
  ));
  const ranked: LiveRanked<T>[] = [];
  sorted.forEach((entry, index) => {
    const previous = ranked[index - 1];
    const tied = previous && compareProgress(format, previous.progress as LiveProgress, entry.progress as LiveProgress) === 0;
    ranked.push({ ...entry, position: tied ? previous.position : index + 1 });
  });
  const rest = [...waiting]
    .sort((a, b) => later(a.lane) - later(b.lane))
    .map((entry) => ({ ...entry, position: null }));
  return [...ranked, ...rest];
};
