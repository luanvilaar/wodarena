import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const leaderboard = readFileSync(new URL('../src/components/Leaderboard.tsx', import.meta.url), 'utf8');
const leaderboardPage = readFileSync(new URL('../src/app/event/[id]/leaderboard/page.tsx', import.meta.url), 'utf8');

test('uses a comparison matrix with a pinned participant column', () => {
  assert.match(leaderboard, /LeaderboardParticipantHeader/);
  assert.match(leaderboard, /sticky left-0 z-30/);
  assert.match(leaderboard, /sticky left-0 z-20/);
  assert.match(leaderboard, /min-w-\[70rem\]/);
});

test('uses a focused workout view with explicit navigation on mobile', () => {
  assert.match(leaderboard, /mobileWorkoutIndex/);
  assert.match(leaderboard, /activeMobileWorkout/);
  assert.match(leaderboard, /table-fixed/);
  assert.match(leaderboard, /left-\[9\.5rem\]/);
  assert.match(leaderboard, /Exercício anterior/);
  assert.match(leaderboard, /Próximo treino/);
  assert.match(leaderboard, /Buscar atleta ou box/);
  assert.doesNotMatch(leaderboard, /MobileLeaderboardCard/);
});

test('discloses workout tie-break details without changing the leaderboard matrix', () => {
  assert.match(leaderboard, /WorkoutScoreResult/);
  assert.match(leaderboard, /SCORE_TIE_BREAKER_SPLIT_KEY/);
  assert.match(leaderboard, /workoutTieBreakGroupSizes/);
  assert.match(leaderboard, /shouldUseTimeTieBreaker\(workout\.tieBreaker\)/);
  assert.match(leaderboard, /Tie-break aplicado/);
  assert.match(leaderboard, /aria-controls=\{tooltipId\}/);
  assert.match(leaderboard, /aria-expanded=\{open\}/);
  assert.match(leaderboard, /document\.addEventListener\('pointerdown'/);
  assert.match(leaderboard, /fixed inset-x-3 top-20/);
  assert.match(leaderboard, /min-h-11 min-w-11/);
});

test('marks qualifier penalty and manual adjustment statuses in public results', () => {
  assert.match(leaderboard, /ResultStatusBadge/);
  assert.match(leaderboard, /status === 'penalized'/);
  assert.match(leaderboard, /Penalidade \$\{penaltyPercent\}%/);
  assert.match(leaderboard, /status === 'manual'/);
  assert.match(leaderboard, /score\.penaltyPercent/);
});

test('expands the leaderboard page container for the dense results layout', () => {
  assert.match(leaderboardPage, /max-w-\[1600px\]/);
  assert.match(leaderboardPage, /Resultados oficiais/);
});
