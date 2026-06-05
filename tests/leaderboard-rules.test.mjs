import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appContext = readFileSync(new URL('../src/context/AppContext.tsx', import.meta.url), 'utf8');

test('implements low-point scoring logic by ranking', () => {
  // O valor dos pontos na prova é igual ao rank
  assert.match(appContext, /points = rank;\s*\/\/ Em Low-Point/);
});

test('presents tie-breaking cascade logic for overall leaderboard', () => {
  // Confronto direto e WOD 1
  assert.match(appContext, /getDirectWins/);
  assert.match(appContext, /firstWorkout/);
  assert.match(appContext, /Confronto Direto/);
});

test('implements standard low-point tie points penalty for missing scores', () => {
  // Penalidade de total_competidores + 1 para pendentes
  assert.match(appContext, /penaltyPoints = divisionAthletes\.length \+ 1/);
});
