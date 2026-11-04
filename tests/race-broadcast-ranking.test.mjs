import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createFakeSupabase } from './support/fakeSupabase.mjs';
import { createRaceClient } from './support/fakeRaceSupabase.mjs';
import { BASE_MS, buildReferenceInput, iso, referenceView, stageList } from './support/raceBroadcastScenario.mjs';
import {
  RANKING_BASE_MS,
  at,
  buildRankingInput,
  rankingFinishAt,
  rankingOfficial,
  rankingStageStart
} from './support/raceRankingScenario.mjs';
import { importServerModule, setActiveSupabaseClient } from './support/serverModuleHarness.mjs';

// Story 1.116 (Telão Fitness Race, T6): ranking único da prova. A torre da categoria junta as
// ondas largadas e compara os atletas pelo tempo de prova de cada um (R1 a R3 da proposta
// aprovada em 2026-11-04, docs/design/telao-fitness-race/README.md, seção "Ranking único").
// O cenário principal é o do telão simulado da proposta (tests/support/raceRankingScenario.mjs):
// os valores esperados são os que a maquete aprovada mostra.

process.env.SUPABASE_URL = 'http://supabase.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';
process.env.WODA_SESSION_SECRET = 'segredo-de-teste-ranking-telao-race';
setActiveSupabaseClient(createRaceClient(() => createFakeSupabase(), { missingRaceTables: false, beforeUpdate: {}, beforeCount: {} }));

const engine = await importServerModule('lib/raceBroadcast.ts');

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const boardAt = (seconds, options = {}) => engine.computeRaceDivisionBoard(buildRankingInput({ seconds, ...options }), 'open-m');
const order = (board) => board.rows.map((row) => row.athleteKey);
const rowOf = (board, key) => board.rows.find((row) => row.athleteKey === key);
const indexOf = (board, key) => board.rows.findIndex((row) => row.athleteKey === key);
const ref = (stationName, side) => ({ stationName, side });

// Fixtures pequenas (mesmo percurso do cenário: ski-erg = pontos 0 e 1, sled-push = 2 e 3, sled-pull = 4 e 5).
const base = (over = {}) => ({
  divisions: [{ key: 'd1', name: 'Open Masculino', orderIndex: 1, stages: stageList() }],
  athletes: [],
  waves: [],
  runs: [],
  attempts: [],
  penalties: [],
  results: [],
  nowMs: BASE_MS,
  ...over
});
const person = (key) => ({ key, name: `Atleta ${key}`, box: `Box ${key}`, divisionKey: 'd1' });
const wave = (key, athleteKeys, startSeconds, heatNumber = 1) => ({ key, title: `Onda ${heatNumber}`, date: '2026-11-14', time: '10:00', heatNumber, athleteKeys, startedAt: startSeconds === null ? null : iso(startSeconds) });
const racing = (athleteKey, waveKey, startSeconds) => ({ athleteKey, waveKey, status: 'racing', officialSeconds: null, timeSource: null, finishAt: null, dnfAt: null, startedAt: iso(startSeconds) });
const card = (athleteKey, stationId, startSeconds, endSeconds = null) => ({
  athleteKey, stationId, status: endSeconds === null ? 'running' : 'released', startedAt: iso(startSeconds), endedAt: endSeconds === null ? null : iso(endSeconds),
  units: null, expectedUnits: null, validReps: null, targetReps: null
});

// ---------------------------------------------------------------------------
// Pureza e contrato
// ---------------------------------------------------------------------------

test('o motor continua puro: o ranking único não traz relógio, rede nem server*', () => {
  const source = read('../src/lib/raceBroadcast.ts');
  assert.doesNotMatch(source, /Date\.now\(/);
  assert.doesNotMatch(source, /\bfetch\(/);
  assert.doesNotMatch(source, /from '@\/lib\/server/);
  assert.match(source, /export const RACE_DIVISION_PAGE_SIZE = 15;/);
});

test('constantes do ranking único: 15 linhas por página e passo de pelo menos 20 s, 8 s por página (R3)', () => {
  assert.equal(engine.RACE_DIVISION_PAGE_SIZE, 15);
  const rows = (count) => Array.from({ length: count }, (_, index) => ({ athleteKey: `k${index}` }));
  assert.deepEqual(engine.raceLiveStepDurations([
    { scope: 'division', rows: rows(15) },
    { scope: 'division', rows: rows(16) },
    { scope: 'division', rows: rows(40) },
    { scope: 'wave', rows: rows(40) }
  ]), [20_000, 20_000, 24_000, 20_000], '1 e 2 páginas: 20 s; 3 páginas: 24 s; a torre de uma onda segue em 20 s');
  assert.equal(engine.racePageCount(40, 15), 3);
  assert.equal(engine.raceBoardPageSize({ scope: 'division' }), 15);
  assert.equal(engine.raceBoardPageSize({ scope: 'wave' }), 10);
});

test('passo com duração própria: pela hora do servidor, em ciclo, e um passo só não rodiza', () => {
  const durations = [20_000, 24_000];
  assert.deepEqual([0, 19_999, 20_000, 43_999, 44_000, 64_000].map((ms) => engine.raceTimedStep(ms, durations)), [
    { index: 0, offsetMs: 0 }, { index: 0, offsetMs: 19_999 }, { index: 1, offsetMs: 0 }, { index: 1, offsetMs: 23_999 }, { index: 0, offsetMs: 0 }, { index: 1, offsetMs: 0 }
  ]);
  assert.deepEqual(engine.raceTimedStep(123_456, [24_000]), { index: 0, offsetMs: 123_456 });
  assert.deepEqual(engine.raceTimedStep(5, []), { index: 0, offsetMs: 5 });
});

// ---------------------------------------------------------------------------
// O cenário da maquete aprovada
// ---------------------------------------------------------------------------

test('maquete às 10:42: a ordem da torre da categoria e as diferenças no ponto, como o telão simulado aprovado', () => {
  const board = boardAt(2520);
  assert.equal(board.scope, 'division');
  assert.equal(board.waveKey, null);
  assert.deepEqual(order(board), ['bruno', 'rafael', 'diego', 'igor', 'thiago', 'andre', 'caio', 'mateus', 'renan', 'vitor', 'pedro', 'lucas', 'felipe', 'henrique', 'gustavo']);
  assert.deepEqual(board.rows.map((row) => row.position), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

  const bruno = rowOf(board, 'bruno');
  assert.equal(bruno.isLeader, true);
  assert.deepEqual([bruno.waveKey, bruno.waveTitle, bruno.waveNumber, bruno.startedAt], ['o2', 'Onda 2', 2, at(720)]);
  assert.deepEqual([bruno.lastPointRef, bruno.pointSeconds, bruno.gapSeconds], [ref('Sled Pull', 'out'), 1475, null], 'líder: saída do Sled Pull com 24:35 de prova');

  const gap = (key) => { const row = rowOf(board, key); return [row.gapSeconds, row.gapPoint, row.gapCounting, row.gapBaseSeconds]; };
  assert.deepEqual(gap('rafael'), [44, ref('Sled Pull', 'out'), false, null], 'Rafael (Onda 1) está 3 estações à frente na pista e 0:44 atrás no mesmo ponto');
  assert.deepEqual(gap('diego'), [33, ref('Sled Push', 'out'), false, null]);
  assert.deepEqual(gap('renan'), [108, ref('Sled Push', 'in'), false, null]);
  assert.deepEqual(gap('felipe'), [325, ref('Sled Pull', 'out'), true, 1475], 'Felipe ainda não saiu do Sled Pull e o relógio dele já passou dos 24:35 do Bruno: "contando"');
  assert.equal(rowOf(board, 'thiago').penaltySeconds, 15);
});

test('maquete: Bruno (Onda 2) passa Rafael (Onda 1) às 10:20:28, na saída do Ski Erg', () => {
  const brunoOut = rankingStageStart('bruno', 2);
  assert.equal(brunoOut, 1228, '10:20:28');
  const before = boardAt(brunoOut - 1);
  const after = boardAt(brunoOut);
  assert.ok(indexOf(before, 'rafael') < indexOf(before, 'bruno'));
  assert.ok(indexOf(after, 'bruno') < indexOf(after, 'rafael'));
  assert.equal(rowOf(after, 'bruno').isLeader, true);
  assert.deepEqual([rowOf(after, 'rafael').gapSeconds, rowOf(after, 'rafael').gapPoint], [13, ref('Ski Erg', 'out')]);
});

test('maquete: Diego (Onda 3) entra no Ski Erg às 10:28:14 em 1º e cai para 3º na saída do Ski Erg', () => {
  const entry = rankingStageStart('diego', 1);
  assert.equal(entry, 1694, '10:28:14');
  const waiting = boardAt(entry - 1);
  assert.deepEqual(waiting.rows.filter((row) => row.position === null).map((row) => row.athleteKey), ['diego', 'igor', 'renan', 'vitor', 'henrique'], 'a Onda 3 largou e ainda não tem leitura: fica no fim, sem posição');
  const diegoBefore = rowOf(waiting, 'diego');
  assert.deepEqual([diegoBefore.status, diegoBefore.where.kind, diegoBefore.where.afterStationId, diegoBefore.where.sinceAt], ['racing', 'track', null, at(1440)]);

  const entered = boardAt(entry);
  assert.equal(order(entered)[0], 'diego');
  assert.deepEqual([rowOf(entered, 'diego').position, rowOf(entered, 'diego').pointSeconds], [1, 254]);
  assert.deepEqual([rowOf(entered, 'bruno').gapSeconds, rowOf(entered, 'bruno').gapPoint], [5, ref('Ski Erg', 'in')]);

  const diegoOut = rankingStageStart('diego', 2);
  assert.equal(order(boardAt(diegoOut))[0], 'bruno');
  assert.equal(rowOf(boardAt(diegoOut), 'diego').position, 3);
});

test('maquete: na reta final, Diego corre contra o 1:11:32 do Rafael e fecha 1 s à frente; disputa entre ondas no Wall Balls', () => {
  const wallBallIn = rankingStageStart('diego', 15);
  const duel = boardAt(wallBallIn + 30);
  assert.deepEqual(order(duel).slice(0, 3), ['bruno', 'diego', 'rafael']);
  assert.deepEqual(duel.battle, {
    position: 2, aheadKey: 'diego', backKey: 'rafael', intervalSeconds: 4,
    trend: 'widening', trendSeconds: 4, since: ref('Sandbag Lunges', 'out'),
    point: ref('Wall Balls', 'in'), crossWave: true
  });
  const finalist = duel.finalists.find((item) => item.athleteKey === 'diego');
  assert.deepEqual([finalist.raceStartedAt, finalist.penaltySeconds, finalist.waveNumber, finalist.stationName], [at(1440), 0, 3, 'Wall Balls']);

  assert.equal(rankingOfficial('rafael'), 4292);
  assert.equal(rankingOfficial('diego'), 4291);
  const final = boardAt(rankingFinishAt('henrique') + 60);
  assert.deepEqual(order(final).slice(0, 4), ['bruno', 'diego', 'rafael', 'igor']);
  assert.deepEqual([rowOf(final, 'diego').gapSeconds, rowOf(final, 'diego').gapPoint, rowOf(final, 'rafael').gapSeconds], [123, ref('Wall Balls', 'finish'), 124]);
  assert.deepEqual(rowOf(final, 'gustavo'), { ...rowOf(final, 'gustavo'), position: null, status: 'dnf', gapSeconds: null });
  assert.equal(order(final).at(-1), 'gustavo', 'DNF por último, sem posição');
  assert.equal(final.battle, null, 'todos fecharam: sem disputa');
});

test('maquete: quem fechou e quem corre na mesma tela: quem passou do tempo final de alguém sem fechar fica atrás com "contando"', () => {
  const board = boardAt(5404);
  const lucas = rowOf(board, 'lucas');
  assert.equal(lucas.gapCounting, true);
  assert.deepEqual([lucas.gapPoint, lucas.gapBaseSeconds], [ref('Wall Balls', 'finish'), 4168], 'base: o tempo final do Bruno');
  assert.ok(indexOf(board, 'lucas') > indexOf(board, 'mateus'), 'Lucas não fechou e o relógio dele já passou do tempo final do Mateus');
});

// ---------------------------------------------------------------------------
// R1: confronto
// ---------------------------------------------------------------------------

test('R1: na mesma onda, sem penalidade, a torre da categoria dá a ordem da torre de uma onda em todo instante', () => {
  for (let seconds = 60; seconds <= 5400; seconds += 45) {
    const input = buildReferenceInput({ seconds });
    input.penalties = [];
    const divisionOrder = engine.computeRaceDivisionBoard(input, 'open-m').rows
      .filter((row) => row.waveKey === 'w3' && row.position !== null)
      .map((row) => row.athleteKey);
    const waveBoard = engine.computeRaceBroadcast(input, referenceView(input, { mode: 'pin_heat', pinnedWaveKey: 'w3' })).boards[0];
    const waveOrder = waveBoard.rows.filter((row) => row.status !== 'dnf' && (row.status === 'finished' || row.point !== null)).map((row) => row.athleteKey);
    assert.deepEqual(divisionOrder, waveOrder, `instante ${seconds} s`);
  }
});

test('R1: checagem 3 só vale com judge na onda de quem ainda não passou (escala da onda ou do evento, ou leitura de alguém dela)', () => {
  // A (Onda 1, largou em 0) entrou no Sled Push com 600 s de prova; B (Onda 2, largou em 1000) saiu do Ski Erg com 300 s
  // (A saiu com 350 s) e o relógio dele marca 700 s, sem ter chegado ao Sled Push.
  const input = (coverage) => base({
    athletes: [person('a'), person('b')],
    waves: [wave('w1', ['a'], 0, 1), wave('w2', ['b'], 1000, 2)],
    runs: [racing('a', 'w1', 0), racing('b', 'w2', 1000)],
    attempts: [card('a', 'ski-erg', 100, 350), card('a', 'sled-push', 600), card('b', 'ski-erg', 1100, 1300)],
    coverage,
    nowMs: BASE_MS + 1700 * 1000
  });
  const summary = (coverage) => {
    const board = engine.computeRaceDivisionBoard(input(coverage), 'd1');
    const second = board.rows[1];
    return [order(board), second.gapSeconds, second.gapPoint, second.gapCounting];
  };
  assert.deepEqual(summary([{ stationKey: 'sled-push', waveKey: 'w1' }]), [['b', 'a'], 50, ref('Ski Erg', 'out'), false], 'escala sem judge no Sled Push da Onda 2: vale o último ponto comum');
  assert.deepEqual(summary([{ stationKey: 'sled-push', waveKey: 'w2' }]), [['a', 'b'], 100, ref('Sled Push', 'in'), true], 'com judge na Onda 2: certeza, e a diferença conta');
  assert.deepEqual(summary([{ stationKey: 'sled-push', waveKey: null }]), [['a', 'b'], 100, ref('Sled Push', 'in'), true], 'judge no evento todo vale para toda onda');
  assert.deepEqual(summary([]), [['a', 'b'], 100, ref('Sled Push', 'in'), true], 'evento sem escala: vale a estação com cartão de qualquer onda da categoria (AUTO-DECISION T6-2)');
});

test('R1: ciclo raro de confrontos: a ordem segue as vitórias, o empate fica com quem está mais adiante e a diferença pode ser negativa', () => {
  // A x B no Sled Push (A à frente), B x C e C x A na entrada do Ski Erg (B à frente de C, C à frente de A).
  const input = base({
    athletes: [person('a'), person('b'), person('c')],
    waves: [wave('w1', ['a'], 0, 1), wave('w2', ['b'], 1000, 2), wave('w3', ['c'], 1600, 3)],
    runs: [racing('a', 'w1', 0), racing('b', 'w2', 1000), racing('c', 'w3', 1600)],
    attempts: [
      card('a', 'ski-erg', 300, 600), card('a', 'sled-push', 900, 1200), card('a', 'sled-pull', 1500),
      card('b', 'ski-erg', 1250, 1550), card('b', 'sled-push', 1950),
      card('c', 'ski-erg', 1880)
    ],
    nowMs: BASE_MS + 2000 * 1000
  });
  const board = engine.computeRaceDivisionBoard(input, 'd1');
  assert.deepEqual(order(board), ['a', 'b', 'c']);
  assert.deepEqual(board.rows.map((row) => [row.gapSeconds, row.gapPoint]), [[null, null], [50, ref('Sled Push', 'in')], [-20, ref('Ski Erg', 'in')]]);
  assert.deepEqual(engine.computeRaceDivisionBoard(input, 'd1'), board, 'determinística');
});

test('R1: sem ponto comum e sem certeza, fica à frente quem está mais adiante', () => {
  const input = base({
    athletes: [person('a'), person('b')],
    waves: [wave('w1', ['a'], 0, 1), wave('w2', ['b'], 1000, 2)],
    runs: [racing('a', 'w1', 0), racing('b', 'w2', 1000)],
    attempts: [card('a', 'sled-push', 900), card('b', 'ski-erg', 1100)],
    coverage: [{ stationKey: 'ski-erg', waveKey: 'w2' }],
    nowMs: BASE_MS + 1500 * 1000
  });
  const board = engine.computeRaceDivisionBoard(input, 'd1');
  assert.deepEqual(order(board), ['a', 'b']);
  assert.equal(board.rows[1].gapSeconds, null, 'sem ponto comum, sem diferença');
});

// ---------------------------------------------------------------------------
// R2: penalidade conta a partir do lançamento
// ---------------------------------------------------------------------------

test('R2: a penalidade entra nos pontos lidos depois do lançamento e no relógio; antes dele, não', () => {
  const athleteBoard = (penalties, nowSeconds = 1000) => engine.computeRaceDivisionBoard(base({
    athletes: [person('a'), person('b')],
    waves: [wave('w1', ['a', 'b'], 0, 1)],
    runs: [racing('a', 'w1', 0), racing('b', 'w1', 0)],
    attempts: [card('a', 'ski-erg', 300, 600), card('a', 'sled-push', 700), card('b', 'ski-erg', 305, 590), card('b', 'sled-push', 710)],
    penalties,
    nowMs: BASE_MS + nowSeconds * 1000
  }), 'd1');
  const plain = athleteBoard([]);
  assert.deepEqual(order(plain), ['a', 'b']);
  const penalized = athleteBoard([{ athleteKey: 'a', seconds: 15, stationId: 'ski-erg', at: iso(550) }]);
  assert.deepEqual(order(penalized), ['b', 'a'], 'A entrou no Sled Push com 700 + 15 s e B com 710 s');
  assert.deepEqual([rowOf(penalized, 'a').pointSeconds, rowOf(penalized, 'a').gapSeconds, rowOf(penalized, 'a').penaltySeconds], [715, 5, 15]);
  const later = athleteBoard([{ athleteKey: 'a', seconds: 15, stationId: 'sled-push', at: iso(800) }]);
  assert.deepEqual(order(later), ['a', 'b'], 'lançada depois da entrada no Sled Push: o ponto não muda');
  assert.equal(rowOf(later, 'a').pointSeconds, 700);
  const noInstant = athleteBoard([{ athleteKey: 'a', seconds: 15, stationId: null, at: null }]);
  assert.deepEqual(order(noInstant), ['b', 'a'], 'sem instante, conta sempre');
});

test('R2: no cenário da maquete, o +15 s do Thiago entra a partir do Sled Push', () => {
  const pointsOf = (withPenalties) => rowOf(boardAt(2520, { withPenalties }), 'thiago').pointSeconds;
  assert.equal(pointsOf(true) - pointsOf(false), 15);
});

// ---------------------------------------------------------------------------
// Entrada no ranking e recorte no tempo
// ---------------------------------------------------------------------------

test('entrada no ranking: a primeira leitura de cada atleta, em ordem, e a posição dele naquele instante', () => {
  const input = buildRankingInput({ seconds: 2520 });
  const entries = engine.raceRankingEntries(input, ['open-m']);
  assert.equal(entries.length, 15);
  assert.deepEqual(entries.slice(0, 2).map((item) => item.athleteKey), ['rafael', 'thiago']);
  const diego = entries.find((item) => item.athleteKey === 'diego');
  assert.deepEqual(diego, { athleteKey: 'diego', divisionKey: 'open-m', waveKey: 'o3', at: at(1694), point: ref('Ski Erg', 'in') });
  assert.equal(engine.raceDivisionPositionAt(input, 'open-m', 'diego', Date.parse(diego.at)), 1, 'Diego entrou em 1º');
  const henrique = entries.find((item) => item.athleteKey === 'henrique');
  assert.equal(engine.raceDivisionPositionAt(input, 'open-m', 'henrique', Date.parse(henrique.at)), 13, 'Henrique entrou em 13º');
  assert.equal(engine.raceDivisionPositionAt(input, 'open-m', 'diego', Date.parse(diego.at) - 1000), null, 'um segundo antes ele ainda não tinha leitura');
});

test('recorte no tempo: cartões, chegadas, DNF, penalidades e largadas voltam a como estavam', () => {
  const input = buildRankingInput({ seconds: 7000 });
  const sliced = engine.sliceRaceInputAt(input, RANKING_BASE_MS + 2520 * 1000);
  assert.equal(sliced.nowMs, RANKING_BASE_MS + 2520 * 1000);
  const summary = (board) => board.rows.map((row) => [row.athleteKey, row.position, row.status, row.pointSeconds, row.gapSeconds, row.gapCounting]);
  assert.deepEqual(summary(engine.computeRaceDivisionBoard(sliced, 'open-m')), summary(boardAt(2520)), 'o recorte do fim da prova às 10:42 dá a torre da prova às 10:42 (o progresso dentro da estação fica o último gravado)');
  const early = engine.sliceRaceInputAt(input, RANKING_BASE_MS + 600 * 1000);
  assert.deepEqual(early.waves.map((item) => item.startedAt), [at(0), null, null]);
  assert.ok(early.runs.every((run) => run.status === 'racing'));
  assert.deepEqual(early.penalties, []);
});

// ---------------------------------------------------------------------------
// Escolha da tela e torres
// ---------------------------------------------------------------------------

test('computeRaceBroadcast: automático monta a torre da categoria; categoria fixada também; onda fixada monta a torre da onda', () => {
  const input = buildRankingInput({ seconds: 2520 });
  const view = (over = {}) => ({ mode: 'auto', pinnedWaveKey: null, pinnedDivisionKey: null, standings: [{ divisionKey: 'open-m', rows: 0 }], ...over });
  const auto = engine.computeRaceBroadcast(input, view());
  assert.deepEqual(auto.resolution, { screen: 'live', reason: 'auto', scope: 'division', waveKeys: ['o1', 'o2', 'o3'], divisionKeys: ['open-m'] });
  assert.deepEqual(auto.liveSteps, [{ waveKey: null, divisionKey: 'open-m' }]);
  assert.deepEqual(auto.boards[0], boardAt(2520));

  const pinnedDivision = engine.computeRaceBroadcast(input, view({ mode: 'pin_standings', pinnedDivisionKey: 'open-m' }));
  assert.deepEqual(pinnedDivision.resolution, { screen: 'live', reason: 'pinned', scope: 'division', waveKeys: ['o1', 'o2', 'o3'], divisionKeys: ['open-m'] });

  const pinnedWave = engine.computeRaceBroadcast(input, view({ mode: 'pin_heat', pinnedWaveKey: 'o2' }));
  assert.deepEqual(pinnedWave.liveSteps, [{ waveKey: 'o2', divisionKey: 'open-m' }]);
  assert.deepEqual([pinnedWave.boards[0].scope, pinnedWave.boards[0].waveKey, order(pinnedWave.boards[0])], ['wave', 'o2', ['bruno', 'andre', 'caio', 'lucas', 'felipe']]);
});

test('a torre da categoria só existe com onda largada; atleta repetido em duas ondas aparece uma vez', () => {
  assert.equal(engine.computeRaceDivisionBoard(buildRankingInput({ seconds: -10 }), 'open-m'), null);
  const input = base({
    athletes: [person('a')],
    waves: [wave('w1', ['a'], 0, 1), wave('w2', ['a'], 100, 2)],
    runs: [racing('a', 'w2', 100)],
    nowMs: BASE_MS + 200 * 1000
  });
  const board = engine.computeRaceDivisionBoard(input, 'd1');
  assert.deepEqual(order(board), ['a']);
  assert.deepEqual([board.rows[0].waveKey, board.rows[0].startedAt], ['w2', iso(100)], 'a onda e a largada são as da corrida');
});

test('a saída é JSON simples e sem dado pessoal além de nome e box', () => {
  const board = boardAt(2520);
  assert.deepEqual(JSON.parse(JSON.stringify(board)), board);
  const keys = new Set(board.rows.flatMap((row) => Object.keys(row)));
  for (const forbidden of ['email', 'phone', 'userId', 'registrationId', 'reason', 'note']) assert.equal(keys.has(forbidden), false, forbidden);
});
