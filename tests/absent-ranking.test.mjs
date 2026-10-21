import assert from 'node:assert/strict';
import test from 'node:test';

import { importServerModule } from './support/serverModuleHarness.mjs';

// Story 1.59 (AC3, AC12, AC14): o atleta ausente na prova fica depois de
// qualquer resultado real, os ausentes dividem a última posição e os pontos são
// iguais à posição. Exemplo aprovado em docs/design/atleta-ausente/README.md:
// For Time, cap 12:00, 150 repetições, 1 s por repetição, sem desempate; 14
// atletas e 3 ausentes (14:30 cada). Se este teste falhar, o ranking mudou.

const { rankWorkoutScores } = await importServerModule('lib/scoring.ts');
const { computeDivisionStandings } = await importServerModule('lib/leaderboardStandings.ts');

const ABSENT_SECONDS = 870; // 12:00 + 150 × 1 s
const time = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
const real = (athleteId, value, result = time(value)) => ({ athleteId, result, value, splits: {} });
const absent = (athleteId, value = ABSENT_SECONDS, result = time(value)) => ({ athleteId, result, value, splits: {}, resultStatus: 'absent' });

// Segundos da tabela aprovada: A 522, B 555, C 598, D e E 620, F 647, G 665, H 699, I 718, J 728, K 750.
const REAL_SECONDS = { A: 522, B: 555, C: 598, D: 620, E: 620, F: 647, G: 665, H: 699, I: 718, J: 728, K: 750 };
const approved = () => [
  ...Object.entries(REAL_SECONDS).map(([id, value]) => real(id, value)),
  absent('L'), absent('M'), absent('N')
];
const ranksOf = (ranked) => Object.fromEntries(ranked.map((score) => [score.athleteId, [score.rank, score.points]]));

test('exemplo aprovado: 14 atletas e 3 ausentes → A1 B2 C3 D4 E4 F6 G7 H8 I9 J10 K11 L12 M12 N12 (pontos iguais)', () => {
  const ranked = rankWorkoutScores('fortime', '', approved(), 14);
  const expected = { A: 1, B: 2, C: 3, D: 4, E: 4, F: 6, G: 7, H: 8, I: 9, J: 10, K: 11, L: 12, M: 12, N: 12 };
  assert.deepEqual(ranksOf(ranked), Object.fromEntries(Object.entries(expected).map(([id, rank]) => [id, [rank, rank]])));
  assert.deepEqual(ranked.map((score) => score.athleteId), Object.keys(expected), 'a ordem de entrada é preservada no retorno');
  assert.ok(ranked.filter((score) => score.resultStatus === 'absent').every((score) => score.result === '14:30'));
});

test('contagens: 10/1 → 10; 10/2 → 9 cada; 13 reais + 1 → 14; 10 reais + 4 → 11 cada', () => {
  const reals = (count) => Array.from({ length: count }, (_, index) => real(`r${index}`, 500 + index * 7));
  const absents = (count) => Array.from({ length: count }, (_, index) => absent(`x${index}`));
  const points = (ranked) => ranked.filter((score) => score.resultStatus === 'absent').map((score) => score.points);

  assert.deepEqual(points(rankWorkoutScores('fortime', '', [...reals(9), ...absents(1)], 10)), [10]);
  assert.deepEqual(points(rankWorkoutScores('fortime', '', [...reals(8), ...absents(2)], 10)), [9, 9]);
  assert.deepEqual(points(rankWorkoutScores('fortime', '', [...reals(13), ...absents(1)], 14)), [14]);
  assert.deepEqual(points(rankWorkoutScores('fortime', '', [...reals(10), ...absents(4)], 14)), [11, 11, 11, 11]);
});

test('recálculo: um 4º ausente marcado depois (um dos 11 reais) faz os 4 passarem a 11 pontos', () => {
  const before = ranksOf(rankWorkoutScores('fortime', '', approved(), 14));
  assert.deepEqual(before.L, [12, 12]);
  const scores = approved().map((score) => (score.athleteId === 'K' ? absent('K') : score));
  const after = ranksOf(rankWorkoutScores('fortime', '', scores, 14));
  for (const id of ['K', 'L', 'M', 'N']) assert.deepEqual(after[id], [11, 11], id);
  assert.deepEqual(after.J, [10, 10]);
});

test('ausente nunca empata com resultado real de mesmo valor (cap com 0 rep, 0 rep, 0 kg, 0 s por repetição)', () => {
  // For Time: quem estourou o cap com 0 de 150 repetições tem o mesmo 870 do ausente.
  const capped = rankWorkoutScores('fortime', '', [absent('aus'), real('cap0', ABSENT_SECONDS)], 2);
  assert.deepEqual(ranksOf(capped), { aus: [2, 2], cap0: [1, 1] });
  // For Time com 0 s por repetição: o ausente fica com o próprio cap (12:00), igual a quem estourou.
  const zeroPenalty = rankWorkoutScores('fortime', '', [absent('aus', 720), real('cap', 720)], 2);
  assert.deepEqual(ranksOf(zeroPenalty), { aus: [2, 2], cap: [1, 1] });
  // AMRAP: 0 repetições de verdade ficam antes do ausente (0).
  const amrap = rankWorkoutScores('amrap', '', [absent('aus', 0, '0'), real('zero', 0, '0')], 2);
  assert.deepEqual(ranksOf(amrap), { aus: [2, 2], zero: [1, 1] });
  // Carga máxima: 0 kg de verdade fica antes do ausente (0 kg), mesmo com desempate por tempo.
  const load = rankWorkoutScores('maxweight', 'Tempo', [absent('aus', 0, '0'), { ...real('zero', 0, '0'), splits: { tieBreaker: '05:00' } }], 2);
  assert.deepEqual(ranksOf(load), { aus: [2, 2], zero: [1, 1] });
});

test('formatos: AMRAP (0 repetições) e carga máxima (0 kg) dão as mesmas posições e pontos do exemplo', () => {
  const expected = ranksOf(rankWorkoutScores('fortime', '', approved(), 14));
  // Mesma ordem dos reais, com mais repetições / carga = melhor.
  const amrapScores = [...Object.entries(REAL_SECONDS).map(([id, value]) => real(id, 1000 - value, String(1000 - value))), absent('L', 0, '0'), absent('M', 0, '0'), absent('N', 0, '0')];
  assert.deepEqual(ranksOf(rankWorkoutScores('amrap', '', amrapScores, 14)), expected);
  const loadScores = [...Object.entries(REAL_SECONDS).map(([id, value]) => real(id, (1000 - value) / 2, String((1000 - value) / 2))), absent('L', 0, '0'), absent('M', 0, '0'), absent('N', 0, '0')];
  assert.deepEqual(ranksOf(rankWorkoutScores('maxweight', 'Tempo', loadScores, 14)), expected);
});

test('ausentes dividem a posição qualquer que seja o valor ou o tie-break; vêm antes de quem não tem resultado', () => {
  const ranked = rankWorkoutScores('fortime', 'Tempo', [
    { ...absent('a1', 870), splits: { tieBreaker: '03:00' } },
    { ...absent('a2', 690), splits: { tieBreaker: '01:00' } },
    real('r1', 600),
    { athleteId: 'p1', result: '-', value: 0, splits: {} }
  ], 4);
  assert.deepEqual(ranksOf(ranked), { a1: [2, 2], a2: [2, 2], r1: [1, 1], p1: [0, 5] });
});

test('regressão: sem resultStatus (ou com outro status), o ranking é idêntico ao de antes', () => {
  const plain = Object.entries(REAL_SECONDS).map(([id, value]) => real(id, value));
  const withOtherStatus = plain.map((score) => ({ ...score, resultStatus: 'validated' }));
  const ranksPlain = ranksOf(rankWorkoutScores('fortime', '', plain, 11));
  assert.deepEqual(ranksPlain, { A: [1, 1], B: [2, 2], C: [3, 3], D: [4, 4], E: [4, 4], F: [6, 6], G: [7, 7], H: [8, 8], I: [9, 9], J: [10, 10], K: [11, 11] });
  assert.deepEqual(ranksOf(rankWorkoutScores('fortime', '', withOtherStatus, 11)), ranksPlain);
  // Ausência do Qualifier (linha virtual com '-' e resultStatus absent) segue como "sem resultado".
  const qualifierVirtual = rankWorkoutScores('fortime', '', [real('A', 522), { athleteId: 'Q', result: '-', value: 0, splits: {}, resultStatus: 'absent' }], 2);
  assert.deepEqual(ranksOf(qualifierVirtual), { A: [1, 1], Q: [0, 3] });
});

test('AC14: L ausente na prova 1 (12) e 5º na prova 2 (5) soma 17; selo só na prova 1; a prova 2 dos outros não muda', () => {
  const athletes = [...'ABCDEFGHIJKLMN'].map((id) => ({ id, name: `Atleta ${id}`, box: '', country: 'BR', divisionId: 'div' }));
  const workouts = [
    { id: 'w1', name: 'Prova 1', description: '', type: 'fortime', code: 'W1', orderIndex: 1 },
    { id: 'w2', name: 'Prova 2', description: '', type: 'fortime', code: 'W2', orderIndex: 2 }
  ];
  const prova1 = rankWorkoutScores('fortime', '', approved(), 14).map((score) => ({ ...score, workoutId: 'w1' }));
  // Prova 2: os 14 competem; L termina em 5º.
  const order2 = ['B', 'A', 'D', 'C', 'L', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'M', 'N'];
  const prova2Input = order2.map((id, index) => real(id, 400 + index * 10));
  const prova2 = rankWorkoutScores('fortime', '', prova2Input, 14).map((score) => ({ ...score, workoutId: 'w2' }));
  const prova2Plain = rankWorkoutScores('fortime', '', prova2Input, 14);

  const standings = computeDivisionStandings({
    event: { date: '2026-11-01', eventType: 'functional_fitness', workouts },
    divisionId: 'div',
    divisionAthletes: athletes,
    scores: [...prova1, ...prova2]
  });
  const L = standings.find((item) => item.athlete.id === 'L');
  assert.equal(L.scores.w1.points, 12);
  assert.equal(L.scores.w1.resultStatus, 'absent');
  assert.equal(L.scores.w2.points, 5);
  assert.equal(L.scores.w2.resultStatus, undefined, 'o selo fica só na prova marcada');
  assert.equal(L.totalPoints, 17);
  // Os pontos dos outros 13 na prova 2 são os mesmos com ou sem a marcação de L na prova 1.
  for (const score of prova2Plain.filter((item) => item.athleteId !== 'L')) {
    assert.equal(standings.find((item) => item.athlete.id === score.athleteId).scores.w2.points, score.points, score.athleteId);
  }
});
