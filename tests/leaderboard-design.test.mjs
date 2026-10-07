import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const leaderboard = readFileSync(new URL('../src/components/Leaderboard.tsx', import.meta.url), 'utf8');
const leaderboardPage = readFileSync(new URL('../src/app/[locale]/event/[id]/leaderboard/LeaderboardView.tsx', import.meta.url), 'utf8');
const ptBrMessages = readFileSync(new URL('../src/messages/pt-br.json', import.meta.url), 'utf8');
const admin = readFileSync(new URL('../src/app/admin/page.tsx', import.meta.url), 'utf8');

const PODIUM_COLOR_CLASSES = /slate-300|amber-600|amber-700|yellow-500/;

test('shows placements as plain numbers, without podium circles or colors (Story 1.36)', () => {
  // Célula do participante: número simples, sem círculo nem cor por posição
  const participantCell = leaderboard.slice(
    leaderboard.indexOf('const LeaderboardParticipantCell'),
    leaderboard.indexOf('const LeaderboardParticipantHeader')
  );
  assert.ok(participantCell.length > 0, 'LeaderboardParticipantCell deve existir');
  assert.doesNotMatch(participantCell, /rounded-full/);
  assert.doesNotMatch(participantCell, PODIUM_COLOR_CLASSES);
  assert.match(participantCell, /text-right font-number font-bold/);
  assert.match(participantCell, /rank > 0 \? 'text-foreground' : 'text-muted-soft'/);

  // Nenhuma função de cor de pódio no leaderboard público
  assert.doesNotMatch(leaderboard, /getLeaderboardRankClasses|getRankBadgeClasses/);

  // Perfil do atleta/equipe: colocação em texto neutro, mantendo o aria-label
  const rankBadge = leaderboard.slice(leaderboard.indexOf('const RankBadge'), leaderboard.indexOf('const OverallPlacementCard'));
  assert.ok(rankBadge.length > 0, 'RankBadge deve existir');
  assert.doesNotMatch(rankBadge, /rounded|border|bg-|text-ink/);
  assert.match(rankBadge, /aria-label=\{hasRank \? t\('rankPlaceAria', \{ rank \}\) : t\('rankNoneAria'\)\}/);

  // Aba Leaderboard do admin: mesma leitura, sem círculo de pódio
  const adminLeaderboardStart = admin.indexOf('const renderAbaLeaderboard');
  assert.ok(adminLeaderboardStart >= 0, 'renderAbaLeaderboard deve existir');
  const adminLeaderboard = admin.slice(adminLeaderboardStart, admin.indexOf('\n  return (', adminLeaderboardStart));
  assert.doesNotMatch(adminLeaderboard, PODIUM_COLOR_CLASSES);
  assert.doesNotMatch(adminLeaderboard, /finalRank === 1 \?/);
  assert.match(adminLeaderboard, /<span className="font-number text-sm text-foreground">\{finalRank\}<\/span>/);

  // Componente legado com círculos foi removido
  assert.equal(existsSync(new URL('../src/components/MobileLeaderboardCard.tsx', import.meta.url)), false);
});

test('uses compact rows: 64px on desktop and 56px on mobile (Story 1.36)', () => {
  assert.doesNotMatch(leaderboard, /min-h-\[5\.5rem\]/);
  assert.match(leaderboard, /compact \? 'min-h-14 grid-cols-\[1\.375rem_1fr\]/);
  assert.match(leaderboard, /'min-h-16 grid-cols-\[2\.5rem_1fr\]/);
  assert.match(leaderboard, /grid min-h-14 grid-cols-3 items-center px-1/);
  assert.match(leaderboard, /grid min-h-16 grid-cols-3 items-center px-3/);
});

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
  assert.match(leaderboard, /t\('prevWorkout'\)/);
  assert.match(leaderboard, /t\('nextWorkout'\)/);
  assert.match(leaderboard, /t\('searchPlaceholder'\)/);
  assert.match(ptBrMessages, /"prevWorkout": "Exercício anterior"/);
  assert.match(ptBrMessages, /"nextWorkout": "Próximo treino"/);
  assert.match(ptBrMessages, /"searchPlaceholder": "Buscar atleta ou box"/);
  assert.doesNotMatch(leaderboard, /MobileLeaderboardCard/);
});

test('discloses workout tie-break details without changing the leaderboard matrix', () => {
  assert.match(leaderboard, /WorkoutScoreResult/);
  assert.match(leaderboard, /SCORE_TIE_BREAKER_SPLIT_KEY/);
  assert.match(leaderboard, /workoutTieBreakGroupSizes/);
  assert.match(leaderboard, /shouldUseTimeTieBreaker\(workout\.tieBreaker\)/);
  assert.match(leaderboard, /t\('tieBreakApplied'\)/);
  assert.match(ptBrMessages, /"tieBreakApplied": "Tie-break aplicado"/);
  assert.match(leaderboard, /aria-controls=\{tooltipId\}/);
  assert.match(leaderboard, /aria-expanded=\{open\}/);
  assert.match(leaderboard, /document\.addEventListener\('pointerdown'/);
  assert.match(leaderboard, /fixed inset-x-3 top-20/);
  assert.match(leaderboard, /min-h-11 min-w-11/);
});

test('marks qualifier penalty and manual adjustment statuses in public results', () => {
  assert.match(leaderboard, /ResultStatusBadge/);
  assert.match(leaderboard, /status === 'penalized'/);
  assert.match(leaderboard, /t\('penalizedPercent', \{ percent: penaltyPercent \}\)/);
  assert.match(ptBrMessages, /"penalizedPercent": "Penalidade \{percent\}%"/);
  assert.match(leaderboard, /status === 'manual'/);
  assert.match(leaderboard, /score\.penaltyPercent/);
});

test('expands the leaderboard page container for the dense results layout', () => {
  const ptBrMessages = readFileSync(new URL('../src/messages/pt-br.json', import.meta.url), 'utf8');
  assert.match(leaderboardPage, /max-w-\[1600px\]/);
  assert.match(leaderboardPage, /t\('kickerSuffix'\)/);
  assert.match(ptBrMessages, /"kickerSuffix": "\| Resultados oficiais"/);
});
