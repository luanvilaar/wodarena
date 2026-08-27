import { WorkoutType } from '@/types';

export type ParsedScore = { result: string; value: number };
export type QualifierDecision = 'validated' | 'penalized' | 'rejected' | 'manual_adjustment';
export type WorkoutScoreForRanking = {
  athleteId: string;
  result?: string;
  value: number;
  rank?: number;
  points?: number;
  splits?: Record<string, string>;
};
export const SCORE_TIE_BREAKER_SPLIT_KEY = 'tieBreaker';

const numericScore = (raw: string) => {
  const normalized = raw.trim().replace(',', '.');
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    throw new Error('Informe um valor numérico válido para esta prova.');
  }
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) throw new Error('O score deve ser um número maior ou igual a zero.');
  return value;
};

export const timeToSeconds = (raw: string) => {
  const parts = raw.trim().split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some(part => !/^\d{1,2}$/.test(part))) {
    throw new Error('Informe o tempo no formato MM:SS ou H:MM:SS.');
  }
  const values = parts.map(Number);
  const seconds = values.length === 3
    ? values[0] * 3600 + values[1] * 60 + values[2]
    : values[0] * 60 + values[1];
  if (!Number.isFinite(seconds) || seconds <= 0 || values[values.length - 1] >= 60 || (values.length === 3 && values[1] >= 60)) {
    throw new Error('Informe um tempo válido.');
  }
  return seconds;
};

export const secondsToTime = (seconds: number) => {
  const rounded = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainingSeconds = rounded % 60;
  const paddedMinutes = String(minutes).padStart(2, '0');
  const paddedSeconds = String(remainingSeconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${paddedMinutes}:${paddedSeconds}` : `${paddedMinutes}:${paddedSeconds}`;
};

export const parseScoreForWorkout = (workoutType: WorkoutType, rawResult: unknown): ParsedScore => {
  if (typeof rawResult !== 'string' || !rawResult.trim()) {
    throw new Error('Informe o score obtido.');
  }
  const result = rawResult.trim();
  if (workoutType === 'fortime') {
    const value = timeToSeconds(result);
    return { result: secondsToTime(value), value };
  }
  const value = numericScore(result);
  return { result: String(value), value };
};

const roundToTwo = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export const applyQualifierDecision = (
  workoutType: WorkoutType,
  submitted: ParsedScore,
  decision: QualifierDecision,
  manual?: ParsedScore
): ParsedScore => {
  if (decision === 'validated') return submitted;
  if (decision === 'rejected') return { result: '0', value: 0 };
  if (decision === 'manual_adjustment') {
    if (!manual) throw new Error('Informe o resultado ajustado manualmente.');
    return manual;
  }
  if (workoutType === 'fortime') {
    const value = Math.ceil(submitted.value * 1.15);
    return { result: secondsToTime(value), value };
  }
  if (workoutType === 'amrap' || workoutType === 'reps' || workoutType === 'points') {
    const value = Math.floor(submitted.value * 0.85);
    return { result: String(value), value };
  }
  const value = roundToTwo(submitted.value * 0.85);
  return { result: String(value), value };
};

export const isLowerScoreBetter = (workoutType: WorkoutType) => workoutType === 'fortime';

export const shouldUseTimeTieBreaker = (tieBreaker?: string | null) => tieBreaker?.trim().toLowerCase() === 'tempo';

const optionalTimeToSeconds = (raw?: string) => {
  if (!raw?.trim()) return null;
  try {
    return timeToSeconds(raw);
  } catch {
    return null;
  }
};

export const compareTimeTieBreaker = (aRaw?: string, bRaw?: string) => {
  const a = optionalTimeToSeconds(aRaw);
  const b = optionalTimeToSeconds(bRaw);
  if (a === null && b === null) return 0;
  if (a !== null && b === null) return -1;
  if (a === null && b !== null) return 1;
  return (a as number) - (b as number);
};

const isPendingRankScore = (score: WorkoutScoreForRanking) => !score.result || score.result === '-' || score.result === '';

export const compareWorkoutScoresForRank = (
  workoutType: WorkoutType,
  tieBreaker: string | undefined,
  a: WorkoutScoreForRanking,
  b: WorkoutScoreForRanking
) => {
  const aPending = isPendingRankScore(a);
  const bPending = isPendingRankScore(b);
  if (aPending && !bPending) return 1;
  if (!aPending && bPending) return -1;
  if (aPending && bPending) return 0;

  const primaryComparison = isLowerScoreBetter(workoutType)
    ? a.value - b.value
    : b.value - a.value;
  if (primaryComparison !== 0) return primaryComparison;

  if (!shouldUseTimeTieBreaker(tieBreaker)) return 0;
  return compareTimeTieBreaker(
    a.splits?.[SCORE_TIE_BREAKER_SPLIT_KEY],
    b.splits?.[SCORE_TIE_BREAKER_SPLIT_KEY]
  );
};

export const workoutScoresShareRank = (
  workoutType: WorkoutType,
  tieBreaker: string | undefined,
  a: WorkoutScoreForRanking,
  b: WorkoutScoreForRanking
) => (
  !isPendingRankScore(a)
  && !isPendingRankScore(b)
  && a.value === b.value
  && compareWorkoutScoresForRank(workoutType, tieBreaker, a, b) === 0
);

export const rankWorkoutScores = <T extends WorkoutScoreForRanking>(
  workoutType: WorkoutType,
  tieBreaker: string | undefined,
  scores: T[],
  athleteCount: number
) => {
  const sortedScores = [...scores].sort((a, b) => compareWorkoutScoresForRank(workoutType, tieBreaker, a, b));
  const updatedScoresMap = new Map<string, T & { rank: number; points: number }>();

  sortedScores.forEach((score, index) => {
    const isPending = isPendingRankScore(score);
    let rank = 0;
    let points = 0;

    if (!isPending) {
      if (index > 0) {
        const prevScore = sortedScores[index - 1];
        if (workoutScoresShareRank(workoutType, tieBreaker, score, prevScore)) {
          rank = updatedScoresMap.get(prevScore.athleteId)?.rank || (index + 1);
        } else {
          rank = index + 1;
        }
      } else {
        rank = 1;
      }
      points = rank; // Em Low-Point, os pontos de colocação são iguais à classificação
    } else {
      rank = 0;
      points = athleteCount + 1;
    }

    updatedScoresMap.set(score.athleteId, {
      ...score,
      rank,
      points
    });
  });

  return scores.map(score => updatedScoresMap.get(score.athleteId) || score);
};
