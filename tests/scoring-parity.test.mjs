import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const scoringSource = readFileSync(new URL('../src/lib/scoring.ts', import.meta.url), 'utf8')
  .replace("import { WorkoutType } from '@/types';\n\n", '');
const compiled = ts.transpileModule(scoringSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText;
const scoring = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('qualifier score decisions preserve the documented penalty parity per workout type', () => {
  const time = scoring.parseScoreForWorkout('fortime', '02:03');
  assert.deepEqual(scoring.applyQualifierDecision('fortime', time, 'penalized'), { result: '02:22', value: 142 });

  const reps = scoring.parseScoreForWorkout('reps', '101');
  assert.deepEqual(scoring.applyQualifierDecision('reps', reps, 'penalized'), { result: '85', value: 85 });

  const points = scoring.parseScoreForWorkout('points', '200');
  assert.deepEqual(scoring.applyQualifierDecision('points', points, 'penalized'), { result: '170', value: 170 });

  const weight = scoring.parseScoreForWorkout('maxweight', '101.239');
  assert.deepEqual(scoring.applyQualifierDecision('maxweight', weight, 'penalized'), { result: '86.05', value: 86.05 });

  const distance = scoring.parseScoreForWorkout('distance', '1000');
  assert.deepEqual(scoring.applyQualifierDecision('distance', distance, 'penalized'), { result: '850', value: 850 });

  assert.deepEqual(scoring.applyQualifierDecision('reps', reps, 'rejected'), { result: '0', value: 0 });
  assert.deepEqual(scoring.applyQualifierDecision('reps', reps, 'manual_adjustment', { result: '99', value: 99 }), { result: '99', value: 99 });
});

test('score parser canonicalizes time and rejects invalid inputs before review', () => {
  assert.deepEqual(scoring.parseScoreForWorkout('fortime', '1:02:03'), { result: '1:02:03', value: 3723 });
  assert.throws(() => scoring.parseScoreForWorkout('fortime', '01:60'));
  assert.throws(() => scoring.parseScoreForWorkout('reps', '-1'));
  assert.throws(() => scoring.parseScoreForWorkout('points', 'not-a-score'));
});

test('max weight workout ranking uses time tie-breaker only after equal loads', () => {
  const ranked = scoring.rankWorkoutScores('maxweight', 'Tempo', [
    { athleteId: 'ath-a', result: '120', value: 120, splits: { tieBreaker: '00:45' } },
    { athleteId: 'ath-b', result: '120', value: 120, splits: { tieBreaker: '00:50' } },
    { athleteId: 'ath-c', result: '125', value: 125, splits: { tieBreaker: '01:30' } },
    { athleteId: 'ath-d', result: '120', value: 120, splits: { tieBreaker: '00:45' } },
  ], 4);

  assert.equal(ranked.find(score => score.athleteId === 'ath-c').rank, 1);
  assert.equal(ranked.find(score => score.athleteId === 'ath-a').rank, 2);
  assert.equal(ranked.find(score => score.athleteId === 'ath-d').rank, 2);
  assert.equal(ranked.find(score => score.athleteId === 'ath-b').rank, 4);
  assert.equal(ranked.find(score => score.athleteId === 'ath-a').points, 2);
  assert.equal(ranked.find(score => score.athleteId === 'ath-d').points, 2);
});

test('equal loads still share rank when no time tie-breaker is configured', () => {
  const ranked = scoring.rankWorkoutScores('maxweight', '', [
    { athleteId: 'ath-a', result: '120', value: 120, splits: { tieBreaker: '00:45' } },
    { athleteId: 'ath-b', result: '120', value: 120, splits: { tieBreaker: '00:50' } },
  ], 2);

  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[1].rank, 1);
  assert.equal(ranked[0].points, 1);
  assert.equal(ranked[1].points, 1);
});
