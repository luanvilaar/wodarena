import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appContext = readFileSync(new URL('../src/context/AppContext.tsx', import.meta.url), 'utf8');
const scoring = readFileSync(new URL('../src/lib/scoring.ts', import.meta.url), 'utf8');

test('implements low-point scoring logic by ranking', () => {
  // O valor dos pontos na prova é igual ao rank
  assert.match(scoring, /points = rank;\s*\/\/ Em Low-Point/);
  assert.match(appContext, /rankWorkoutScores\(workoutType, workoutTieBreaker, workoutScores, athleteIds\.length\)/);
});

test('presents tie-breaking cascade logic for overall leaderboard', () => {
  // Confronto direto e WOD 1
  assert.match(appContext, /getDirectWins/);
  assert.match(appContext, /firstWorkout/);
  assert.match(appContext, /Confronto Direto/);
});

test('does not auto-penalize unscored workouts while the event is in progress', () => {
  // Functional Fitness: provas ainda sem resultado NÃO geram penalidade automática
  // nem score falso — o evento segue em andamento. Ausência real é tratada pelo
  // organizador via lançamento manual da pontuação máxima (entra como score normal).
  assert.doesNotMatch(appContext, /penaltyPoints = divisionAthletes\.length \+ 1/);
  // O total soma apenas provas com resultado válido lançado
  assert.match(appContext, /score && score\.result !== '-' && score\.result !== ''/);
});

test('keeps qualifier scores restricted to judge review instead of manual bulk launch', () => {
  assert.match(appContext, /eventType === 'functional_fitness_qualifier'/);
  assert.match(appContext, /Scores de Qualifier são definidos somente após a revisão da submissão pelo judge/);
});
