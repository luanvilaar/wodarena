import { WorkoutType } from '@/types';

export type ParsedScore = { result: string; value: number };
export type QualifierDecision = 'validated' | 'penalized' | 'rejected' | 'manual_adjustment';

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
