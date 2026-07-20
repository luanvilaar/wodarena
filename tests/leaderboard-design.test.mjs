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

test('keeps the workout matrix usable on mobile with a scroll hint', () => {
  assert.match(leaderboard, /ArrowLeftRight/);
  assert.match(leaderboard, /Deslize para comparar as provas/);
  assert.doesNotMatch(leaderboard, /MobileLeaderboardCard/);
});

test('expands the leaderboard page container for the dense results layout', () => {
  assert.match(leaderboardPage, /max-w-\[1600px\]/);
  assert.match(leaderboardPage, /Resultados oficiais/);
});
