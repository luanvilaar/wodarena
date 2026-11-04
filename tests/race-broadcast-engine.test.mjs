import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createFakeSupabase } from './support/fakeSupabase.mjs';
import { createRaceClient } from './support/fakeRaceSupabase.mjs';
import {
  BASE_MS,
  WAVE3_ATHLETES,
  buildReferenceInput,
  iso,
  isoMs,
  referenceView,
  stageList,
  standingsOf,
  wave3OfficialSeconds
} from './support/raceBroadcastScenario.mjs';
import { importServerModule, setActiveSupabaseClient } from './support/serverModuleHarness.mjs';

// Story 1.111 (Telão Fitness Race, T1): motor puro de posição, diferença e escolha da
// tela (src/lib/raceBroadcast.ts). Sem banco nem rede: o cenário da maquete aprovada
// (docs/design/telao-fitness-race/), montado à mão em tests/support/raceBroadcastScenario.mjs,
// com os valores esperados escritos aqui (conferidos por uma conta independente da tabela
// de durações), e fixtures pequenas para cada regra da matriz do AC10.

process.env.SUPABASE_URL = 'http://supabase.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';
process.env.WODA_SESSION_SECRET = 'segredo-de-teste-motor-telao-race';
setActiveSupabaseClient(createRaceClient(() => createFakeSupabase(), { missingRaceTables: false, beforeUpdate: {}, beforeCount: {} }));

const engine = await importServerModule('lib/raceBroadcast.ts');
const pure = await importServerModule('lib/raceOfficialScore.ts');
const publication = await importServerModule('lib/serverRacePublication.ts');
const broadcastMode = await importServerModule('lib/broadcastMode.ts');

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

// A torre de uma onda (D1 de 03/11) é a da mesa "Fixar uma onda" desde o ranking único (Story 1.116, R4): os
// testes dela fixam a onda; o automático (torre da categoria) tem os testes em race-broadcast-ranking.test.mjs.
const compute = (seconds, options = {}) => {
  const input = buildReferenceInput({ seconds, ...options });
  return { input, out: engine.computeRaceBroadcast(input, referenceView(input, options.view ?? { mode: 'pin_heat', pinnedWaveKey: 'w3' })) };
};
const boardOf = (out, waveKey = 'w3', divisionKey = 'open-m') => out.boards.find((item) => item.waveKey === waveKey && item.divisionKey === divisionKey);
const rowOf = (board, key) => board.rows.find((item) => item.athleteKey === key);
const waveOf = (out, key) => out.waves.find((item) => item.key === key);

const base = (over = {}) => ({
  divisions: [{ key: 'd1', name: 'Open Masculino', orderIndex: 1, stages: stageList() }],
  athletes: [],
  waves: [],
  runs: [],
  attempts: [],
  penalties: [],
  results: [],
  nowMs: BASE_MS + 600_000,
  ...over
});
const person = (key, divisionKey = 'd1') => ({ key, name: `Atleta ${key}`, box: `Box ${key}`, divisionKey });
const wave = (key, athleteKeys, startedAtSeconds = 0, extra = {}) => ({
  key,
  title: `Onda ${key}`,
  date: '2026-11-14',
  time: '10:00',
  heatNumber: 1,
  athleteKeys,
  startedAt: startedAtSeconds === null ? null : iso(startedAtSeconds),
  ...extra
});
const racing = (athleteKey, waveKey = 'w') => ({ athleteKey, waveKey, status: 'racing', officialSeconds: null, timeSource: null, finishAt: null, dnfAt: null });
const finished = (athleteKey, officialSeconds, finishSeconds = 1000, waveKey = 'w', timeSource = 'sheet') => ({
  athleteKey, waveKey, status: 'finished', officialSeconds, timeSource, finishAt: iso(finishSeconds), dnfAt: null
});
const dnf = (athleteKey, atSeconds, waveKey = 'w') => ({
  athleteKey, waveKey, status: 'dnf', officialSeconds: null, timeSource: null, finishAt: null, dnfAt: atSeconds === null ? null : iso(atSeconds)
});
const attempt = (athleteKey, stationId, status, startMs, endMs, extra = {}) => ({
  athleteKey,
  stationId,
  status,
  startedAt: startMs === null ? null : isoMs(startMs),
  endedAt: endMs === null ? null : isoMs(endMs),
  units: null,
  expectedUnits: null,
  validReps: null,
  targetReps: null,
  ...extra
});
const view = (input, over) => referenceView(input, over);
const run = (input, over) => engine.computeRaceBroadcast(input, view(input, over));
const runWave = (input, waveKey = 'w') => run(input, { mode: 'pin_heat', pinnedWaveKey: waveKey });
const rowsSummary = (board) => board.rows.map((item) => [item.position, item.athleteKey, item.gapSeconds]);

// ---------------------------------------------------------------------------
// AC1 e AC11: módulo puro, extração, saída serializável
// ---------------------------------------------------------------------------

test('AC1: o motor é puro (sem server*, react, next, supabase, fetch, relógio) e a extração não puxa node:crypto', () => {
  const source = read('../src/lib/raceBroadcast.ts');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const imports = [...code.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
  assert.ok(imports.length > 0, 'o módulo importa as regras que reaproveita');
  for (const specifier of imports) {
    assert.ok(specifier.startsWith('@/lib/'), `import fora de src/lib: ${specifier}`);
    assert.doesNotMatch(specifier, /server/i, `o motor não importa arquivo server*: ${specifier}`);
  }
  assert.doesNotMatch(code, /from\s+'(react|next|@supabase|node:)/);
  assert.doesNotMatch(code, /\bfetch\s*\(/);
  assert.doesNotMatch(code, /Date\.now/);
  assert.doesNotMatch(code, /new Date\(\s*\)/);
  assert.doesNotMatch(code, /Math\.random/);
  const extracted = read('../src/lib/raceOfficialScore.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(extracted, /node:crypto|supabase|server/i, 'o módulo extraído não puxa nada do servidor');
  assert.deepEqual([...extracted.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]), ['@/lib/scoring']);
});

test('AC1: raceOfficialScore e RACE_NO_RESULT_VALUE moram no módulo puro e seguem exportados por serverRacePublication.ts', () => {
  assert.equal(publication.raceOfficialScore, pure.raceOfficialScore, 'mesma função, reexportada');
  assert.equal(publication.RACE_NO_RESULT_VALUE, 999999);
  assert.equal(pure.RACE_NO_RESULT_VALUE, 999999);
  assert.deepEqual(pure.raceOfficialScore(3599.4), { value: 3599, result: '59:59' });
  assert.deepEqual(pure.raceOfficialScore(3599.5), { value: 3600, result: '1:00:00' });
  const publicationSource = read('../src/lib/serverRacePublication.ts');
  assert.match(publicationSource, /export \{ RACE_NO_RESULT_VALUE, raceOfficialScore \}/);
  assert.doesNotMatch(publicationSource, /export const raceOfficialScore/);
});

test('AC1: a saída é JSON simples, determinística e não altera a entrada', () => {
  const input = buildReferenceInput({ seconds: 4100 });
  const before = JSON.stringify(input);
  const first = run(input);
  const second = run(input);
  assert.equal(JSON.stringify(input), before, 'a entrada não é alterada');
  assert.deepEqual(second, first, 'mesma entrada, mesma saída');
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first, 'sem undefined, Map, Set nem função');
});

test('Regras 2 e 8: o motor não devolve tempo de corrida nem previsão (nenhuma chave de ritmo, previsão ou corrida)', () => {
  const { out } = compute(2300);
  const keys = new Set();
  const walk = (value) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) { keys.add(key); walk(item); }
    }
  };
  walk(out);
  const forbidden = [...keys].filter((key) => /predict|forecast|projected|prevista|previsao|pace|ritmo|runTime|runSeconds|roxzone|eta$/i.test(key));
  assert.deepEqual(forbidden, []);
});

test('constantes do AC7 e do AC9: 3 h, 10 min, 90 s, 10 s, 10 linhas, passos de 20 s, 8 s e 12 s', () => {
  assert.equal(engine.RACE_LIVE_MAX_MS, 3 * 60 * 60_000);
  assert.equal(engine.RACE_QUIET_NOTICE_MS, 10 * 60_000);
  assert.equal(engine.RACE_CLOSING_HOLD_MS, 90_000);
  assert.equal(engine.RACE_CLOSING_HOLD_MS, broadcastMode.INTERVAL_MIN_MS, 'os mesmos 90 s do telão de Functional Fitness');
  assert.equal(engine.RACE_BATTLE_MAX_SECONDS, 10);
  assert.equal(engine.RACE_FINALISTS_MAX, 3);
  assert.equal(engine.RACE_PAGE_SIZE, 10);
  assert.equal(engine.RACE_LIVE_STEP_MS, 20_000);
  assert.equal(engine.RACE_TOWER_PAGE_MS, 8_000);
  assert.equal(engine.RACE_CLASS_STEP_MS, 12_000);
});

// ---------------------------------------------------------------------------
// Percurso
// ---------------------------------------------------------------------------

test('percurso: tipo e meta de cada estação, chave entre categorias e a estação que fecha o tempo (D34)', () => {
  const course = engine.buildRaceCourse(stageList());
  assert.equal(course.stages.length, 16);
  assert.equal(course.stations.length, 8);
  assert.equal(course.closingStationId, 'wall-balls');
  assert.deepEqual(
    course.stations.map((station) => [station.id, station.key, station.kind, station.expectedUnits, station.targetReps, station.stageIndex, station.stationIndex, station.closesTime]),
    [
      ['ski-erg', 'ski-erg', 'ergometer', null, null, 1, 0, false],
      ['sled-push', 'sled-push', 'sled', 4, null, 3, 1, false],
      ['sled-pull', 'sled-pull', 'sled', 4, null, 5, 2, false],
      ['burpee-broad-jump', 'burpee-broad-jump', 'sections', null, null, 7, 3, false],
      ['row', 'row', 'ergometer', null, null, 9, 4, false],
      ['farmers-carry', 'farmers-carry', 'sections', null, null, 11, 5, false],
      ['sandbag-lunges', 'sandbag-lunges', 'sections', 4, null, 13, 6, false],
      ['wall-balls', 'wall-balls', 'wall_ball', null, 100, 15, 7, true]
    ]
  );
  assert.ok(course.stages.filter((stage) => stage.type === 'run').every((stage) => stage.key === null && stage.kind === null && !stage.closesTime));
});

test('percurso: nome repetido ganha sufixo e a ordem vem do orderIndex, não da posição na lista', () => {
  const course = engine.buildRaceCourse([
    { id: 'b', name: 'Sled Push', type: 'station', orderIndex: 4, conferenceKind: 'sled', distance: '50m' },
    { id: 'a', name: 'Sled Push', type: 'station', orderIndex: 2, conferenceKind: 'sled', distance: '50m' },
    { id: 'r', name: 'Corrida', type: 'run', orderIndex: 3 }
  ]);
  assert.deepEqual(course.stages.map((stage) => stage.id), ['a', 'r', 'b']);
  assert.deepEqual(course.stations.map((station) => station.key), ['sled-push', 'sled-push-2']);
  assert.equal(course.closingStationId, 'b');
});

// ---------------------------------------------------------------------------
// AC2 e AC3: onde está cada atleta, ordem e diferença no mesmo ponto (cenário da maquete)
// ---------------------------------------------------------------------------

test('cenário aos 24:00: ordem, diferença no mesmo ponto, onde está cada atleta e penalidade (AC2, AC3, AC4)', () => {
  const { out } = compute(1440);
  assert.deepEqual(out.resolution, { screen: 'live', reason: 'pinned', scope: 'wave', waveKeys: ['w3'], divisionKeys: ['open-m'] });
  const board = boardOf(out);
  assert.equal(out.boards.length, 1);
  assert.deepEqual(rowsSummary(board), [
    [1, 'rafael', null], [2, 'bruno', 2], [3, 'diego', 79], [4, 'thiago', 129], [5, 'lucas', 152],
    [6, 'mateus', 207], [7, 'caio', 246], [8, 'pedro', 244], [9, 'gustavo', 288], [10, 'andre', 340]
  ]);
  assert.deepEqual(board.rows.filter((item) => item.isLeader).map((item) => item.athleteKey), ['rafael']);
  assert.equal(board.hasLeaderReading, true);

  assert.deepEqual(rowOf(board, 'rafael').where, { kind: 'track', afterStationId: 'sled-pull', afterStationName: 'Sled Pull', sinceAt: iso(1416), closedWithoutTime: false });
  assert.deepEqual(rowOf(board, 'bruno').where, { kind: 'track', afterStationId: 'sled-pull', afterStationName: 'Sled Pull', sinceAt: iso(1418), closedWithoutTime: false });
  assert.deepEqual(rowOf(board, 'diego').where, {
    kind: 'station', stationId: 'sled-pull', stationKey: 'sled-pull', stationName: 'Sled Pull', stationKind: 'sled', waiting: false,
    startedAt: iso(1221), progress: { type: 'units', unit: 'trecho', done: 2, target: 4 }
  });
  assert.equal(rowOf(board, 'thiago').where.progress.done, 2);
  assert.equal(rowOf(board, 'lucas').where.progress.done, 2);
  assert.equal(rowOf(board, 'mateus').where.progress.done, 1);
  assert.equal(rowOf(board, 'caio').where.progress.done, 0);
  for (const key of ['pedro', 'gustavo', 'andre']) {
    assert.equal(rowOf(board, key).where.kind, 'track');
    assert.equal(rowOf(board, key).where.afterStationId, 'sled-push');
  }
  assert.equal(rowOf(board, 'pedro').where.sinceAt, iso(1141));

  // Mapa: cartão aberto fica na estação; entre estações, na etapa seguinte à última saída (estimado).
  assert.deepEqual([rowOf(board, 'diego').slot, rowOf(board, 'diego').slotEstimated], [5, false]);
  assert.deepEqual([rowOf(board, 'rafael').slot, rowOf(board, 'rafael').slotEstimated], [6, true]);
  assert.deepEqual([rowOf(board, 'pedro').slot, rowOf(board, 'pedro').slotEstimated], [4, true]);

  assert.deepEqual(rowOf(board, 'thiago').lastPenalty, { seconds: 15, stationId: 'sled-push', at: iso(864) });
  assert.equal(rowOf(board, 'thiago').penaltySeconds, 15);
  assert.equal(rowOf(board, 'rafael').penaltySeconds, 0);
  assert.equal(rowOf(board, 'rafael').lastPenalty, null);
  assert.equal(rowOf(board, 'rafael').point, 5);
  assert.equal(rowOf(board, 'diego').point, 4);
  assert.deepEqual(board.stages.filter((stage) => stage.semJudge), [], 'antes de alguém passar adiante, nada se afirma');
});

test('cenário aos 24:00: disputa pelo 1º lugar com tendência desde a entrada do Sled Pull (AC6)', () => {
  const board = boardOf(compute(1440).out);
  assert.deepEqual(board.battle, {
    position: 1, aheadKey: 'rafael', backKey: 'bruno', intervalSeconds: 2,
    trend: 'closing', trendSeconds: 47, since: { stationName: 'Sled Pull', side: 'in' },
    point: { stationName: 'Sled Pull', side: 'out' }, crossWave: false
  });
  assert.deepEqual(board.finalists, []);
});

test('estação sem judge só aparece depois que alguém já tem cartão mais adiante (AUTO-DECISION 5)', () => {
  const semJudge = (seconds) => boardOf(compute(seconds).out).stages.filter((stage) => stage.semJudge).map((stage) => stage.id);
  assert.deepEqual(semJudge(0), []);
  assert.deepEqual(semJudge(1440), []);
  assert.deepEqual(semJudge(2300), ['burpee-broad-jump'], 'Rafael e Bruno já estão no Row');
  assert.deepEqual(semJudge(3100), ['burpee-broad-jump', 'farmers-carry'], 'Rafael já está nos Lunges');
  assert.ok(boardOf(compute(1440).out).stages.filter((stage) => stage.type === 'run').every((stage) => stage.semJudge === false));
});

test('cenário aos 3700 s: o DNF fica sem posição, sem diferença e no fim; a onda segue na pista (AC4, AC7)', () => {
  const { out } = compute(3700);
  const board = boardOf(out);
  assert.deepEqual(rowsSummary(board), [
    [1, 'rafael', null], [2, 'bruno', 60], [3, 'thiago', 230], [4, 'diego', 250], [5, 'lucas', 402],
    [6, 'mateus', 502], [7, 'caio', 497], [8, 'pedro', 649], [9, 'gustavo', 726], [null, 'andre', null]
  ]);
  const andre = rowOf(board, 'andre');
  assert.deepEqual([andre.status, andre.where, andre.slot, andre.isLeader, andre.finalSeconds], ['dnf', { kind: 'dnf' }, null, false, null]);
  assert.equal(rowOf(board, 'thiago').penaltySeconds, 15);
  assert.equal(rowOf(board, 'caio').penaltySeconds, 0, 'a penalidade de Caio é dos 3824 s e ainda não existe');
  assert.equal(waveOf(out, 'w3').onTrack, true);
  assert.equal(waveOf(out, 'w3').racingCount, 9);
});

test('cenário aos 4100 s: quem fechou o tempo vem antes de quem está mais adiante; reta final na última estação (AC3, AC4, AC6)', () => {
  const { out } = compute(4100);
  const board = boardOf(out);
  assert.deepEqual(rowsSummary(board), [
    [1, 'rafael', null], [2, 'bruno', 33], [3, 'diego', 245], [4, 'thiago', 256], [5, 'lucas', 468],
    [6, 'mateus', 517], [7, 'caio', 649], [8, 'pedro', 830], [9, 'gustavo', 939], [null, 'andre', null]
  ]);
  const rafael = rowOf(board, 'rafael');
  assert.deepEqual([rafael.status, rafael.finishedBy, rafael.finalSeconds, rafael.finalText, rafael.where, rafael.slot], ['finished', 'run', 3982, '1:06:22', { kind: 'finished' }, null]);
  assert.deepEqual([rowOf(board, 'bruno').finalSeconds, rowOf(board, 'bruno').finalText], [4015, '1:06:55']);
  // A diferença entre dois que fecharam é a dos tempos finais.
  assert.equal(rowOf(board, 'bruno').gapSeconds, 4015 - 3982);

  assert.deepEqual(board.finalists.map((item) => [item.athleteKey, item.position, item.stationName, item.progress]), [
    ['diego', 3, 'Wall Balls', { type: 'reps', done: 75, target: 100 }],
    ['thiago', 4, 'Wall Balls', { type: 'reps', done: 66, target: 100 }],
    ['lucas', 5, 'Wall Balls', { type: 'reps', done: 5, target: 100 }]
  ]);
  assert.deepEqual(rowOf(board, 'pedro').where.progress, { type: 'units', unit: 'volta', done: 2, target: 4 }, 'Lunges contam voltas');
  assert.deepEqual(rowOf(board, 'gustavo').where.progress, { type: 'units', unit: 'volta', done: 0, target: 4 });
  assert.deepEqual([rowOf(board, 'mateus').where.afterStationName, rowOf(board, 'mateus').where.sinceAt], ['Sandbag Lunges', iso(3874)]);
  assert.deepEqual(engine.raceFixedKeys(board), ['rafael', 'diego', 'thiago', 'lucas']);
});

test('cenário final: posições, tempos finais com penalidade e diferenças para o líder (AC3, AC4)', () => {
  // Gustavo fecha aos 5164 s; 60 s depois a onda ainda está na pista (os 90 s da AC7) e a torre segue no ar.
  const { out } = compute(5164, { nowSeconds: 5164 + 60 });
  assert.deepEqual(out.resolution, { screen: 'live', reason: 'pinned', scope: 'wave', waveKeys: ['w3'], divisionKeys: ['open-m'] });
  const board = boardOf(out);
  assert.deepEqual(rowsSummary(board), [
    [1, 'rafael', null], [2, 'bruno', 33], [3, 'diego', 198], [4, 'thiago', 253], [5, 'lucas', 483],
    [6, 'mateus', 602], [7, 'caio', 755], [8, 'pedro', 1000], [9, 'gustavo', 1182], [null, 'andre', null]
  ]);
  assert.equal(rowOf(board, 'thiago').finalSeconds, 4220 + 15, 'tempo final = fim do Wall Balls + 15 s');
  assert.equal(rowOf(board, 'caio').finalSeconds, 4722 + 15);
  assert.deepEqual([rowOf(board, 'thiago').penaltySeconds, rowOf(board, 'caio').penaltySeconds], [15, 15]);
  for (const athlete of WAVE3_ATHLETES.filter((item) => item.key !== 'andre')) {
    assert.equal(rowOf(board, athlete.key).finalSeconds, wave3OfficialSeconds(athlete.key));
  }
  assert.equal(board.battle, null, 'ninguém corre mais: sem disputa');
  assert.deepEqual(board.finalists, []);
});

// ---------------------------------------------------------------------------
// AC3: ordem e diferença (fixtures)
// ---------------------------------------------------------------------------

test('AC3: ordem completa: fechou o tempo, mais adiante, mesmo ponto (quem passou antes), sem leitura (cronograma), DNF por último', () => {
  const keys = ['n1', 'n2', 'f1', 'f2', 'f3', 'r1', 'r2', 'r3', 'd1'];
  const input = base({
    athletes: keys.map((key) => person(key)),
    waves: [wave('w', keys)],
    runs: [racing('n1'), racing('n2'), finished('f1', 3600), finished('f2', 3500), finished('f3', 3500), racing('r1'), racing('r2'), racing('r3'), dnf('d1', 900)],
    attempts: [
      attempt('r1', 'sled-push', 'released', 400_000, 500_000),
      attempt('r2', 'sled-push', 'released', 300_000, 400_000),
      attempt('r3', 'ski-erg', 'released', 100_000, 300_000)
    ]
  });
  const board = boardOf(runWave(input), 'w', 'd1');
  assert.deepEqual(rowsSummary(board), [
    [1, 'f2', null], [2, 'f3', 0], [3, 'f1', 100], [4, 'r2', null], [5, 'r1', null], [6, 'r3', null], [7, 'n1', null], [8, 'n2', null], [null, 'd1', null]
  ]);
  assert.deepEqual(board.rows.map((item) => item.finalText), ['58:20', '58:20', '1:00:00', null, null, null, null, null, null]);
  assert.equal(board.hasLeaderReading, true);
});

test('AC3: diferença com 0,4, 0,5 e 0,6 s arredonda para o segundo mais próximo e nunca trunca', () => {
  const cases = [[400, 0], [499, 0], [500, 1], [600, 1], [1499, 1], [1500, 2], [2400, 2], [2500, 3]];
  for (const [extraMs, expected] of cases) {
    const input = base({
      athletes: [person('a'), person('b')],
      waves: [wave('w', ['a', 'b'])],
      runs: [racing('a'), racing('b')],
      attempts: [attempt('a', 'ski-erg', 'released', 60_000, 300_000), attempt('b', 'ski-erg', 'released', 70_000, 300_000 + extraMs)]
    });
    const board = boardOf(runWave(input), 'w', 'd1');
    assert.deepEqual(board.rows.map((item) => item.athleteKey), ['a', 'b'], `${extraMs} ms`);
    assert.equal(rowOf(board, 'b').gapSeconds, expected, `${extraMs} ms de atraso dão ${expected} s`);
  }
});

test('AC3: sem ponto comum não há diferença; cartão aguardando não é leitura e não muda ordem nem diferença', () => {
  const input = base({
    athletes: [person('a'), person('b'), person('c')],
    waves: [wave('w', ['a', 'b', 'c'])],
    runs: [racing('a'), racing('b'), racing('c')],
    attempts: [attempt('b', 'ski-erg', 'waiting', null, null), attempt('c', 'ski-erg', 'running', 30_000, null)]
  });
  const board = boardOf(runWave(input), 'w', 'd1');
  assert.deepEqual(rowsSummary(board), [[1, 'c', null], [2, 'a', null], [3, 'b', null]], 'c tem leitura; a e b ficam na ordem do cronograma');
  assert.equal(rowOf(board, 'c').isLeader, true);

  const waiting = rowOf(board, 'b');
  assert.deepEqual(waiting.where, {
    kind: 'station', stationId: 'ski-erg', stationKey: 'ski-erg', stationName: 'Ski Erg', stationKind: 'ergometer',
    waiting: true, startedAt: null, progress: { type: 'time' }
  });
  assert.deepEqual([waiting.point, waiting.pointAt, waiting.slot, waiting.slotEstimated], [null, null, 1, false]);
  const lost = rowOf(board, 'a');
  assert.deepEqual(lost.where, { kind: 'track', afterStationId: null, afterStationName: null, sinceAt: iso(0), closedWithoutTime: false });
  assert.deepEqual([lost.slot, lost.slotEstimated, lost.point], [0, true, null]);
});

test('AC3: se no ponto comum o atleta passou antes do líder, fica sem diferença (nunca negativa)', () => {
  const input = base({
    athletes: [person('lider'), person('outro')],
    waves: [wave('w', ['lider', 'outro'])],
    runs: [racing('lider'), racing('outro')],
    attempts: [
      attempt('outro', 'ski-erg', 'released', 10_000, 100_000),
      attempt('lider', 'ski-erg', 'released', 20_000, 120_000),
      attempt('lider', 'sled-push', 'running', 130_000, null)
    ]
  });
  const board = boardOf(runWave(input), 'w', 'd1');
  assert.deepEqual(rowsSummary(board), [[1, 'lider', null], [2, 'outro', null]]);
});

test('AC3: sem nenhuma leitura ninguém é líder e a tela mostra "aguardando a primeira leitura"', () => {
  const input = base({
    athletes: [person('a'), person('b')],
    waves: [wave('w', ['a', 'b'])],
    runs: [racing('a'), racing('b')]
  });
  const board = boardOf(runWave(input), 'w', 'd1');
  assert.equal(board.hasLeaderReading, false);
  assert.deepEqual(board.rows.map((item) => [item.athleteKey, item.isLeader, item.gapSeconds, item.position]), [['a', false, null, 1], ['b', false, null, 2]]);
});

test('AC3: posição e diferença são por categoria, dentro da onda', () => {
  const input = base({
    divisions: [
      { key: 'dF', name: 'Open Feminino', orderIndex: 2, stages: stageList() },
      { key: 'dM', name: 'Open Masculino', orderIndex: 1, stages: stageList() }
    ],
    athletes: [person('f1', 'dF'), person('m1', 'dM'), person('f2', 'dF'), person('m2', 'dM')],
    waves: [wave('w', ['f1', 'm1', 'f2', 'm2'])],
    runs: [racing('f1'), racing('m1'), racing('f2'), racing('m2')],
    attempts: [
      attempt('f1', 'ski-erg', 'released', 10_000, 100_000),
      attempt('f2', 'ski-erg', 'released', 10_000, 110_000),
      attempt('m1', 'ski-erg', 'released', 10_000, 200_000),
      attempt('m2', 'ski-erg', 'released', 10_000, 230_000)
    ]
  });
  const out = runWave(input);
  assert.deepEqual(rowsSummary(boardOf(out, 'w', 'dM')), [[1, 'm1', null], [2, 'm2', 30]]);
  assert.deepEqual(rowsSummary(boardOf(out, 'w', 'dF')), [[1, 'f1', null], [2, 'f2', 10]]);
});

// ---------------------------------------------------------------------------
// AC4: chegada, tempo final, resultado publicado sem corrida, saída incompleta, penalidade
// ---------------------------------------------------------------------------

test('AC4: tempo final é o inteiro que vai ao leaderboard (raceOfficialScore, meio segundo sobe)', () => {
  const input = base({
    athletes: [person('a'), person('b')],
    waves: [wave('w', ['a', 'b'])],
    runs: [finished('a', 3599.4, 3000), finished('b', 3599.5, 3100)]
  });
  const board = boardOf(runWave(input), 'w', 'd1');
  assert.deepEqual(board.rows.map((item) => [item.athleteKey, item.finalSeconds, item.finalText, item.finishedBy]), [
    ['a', 3599, '59:59', 'run'],
    ['b', 3600, '1:00:00', 'run']
  ]);
  assert.equal(rowOf(board, 'b').gapSeconds, 1);
});

test('AC4 (AUTO-DECISION 3): resultado publicado sem corrida fechada conta como chegou; dnf e ausente publicados contam como DNF', () => {
  const keys = ['a', 'b', 'c', 'e', 'x'];
  const input = base({
    athletes: keys.map((key) => person(key)),
    waves: [wave('w', keys)],
    runs: [racing('a')],
    results: [
      { athleteKey: 'a', divisionKey: 'd1', value: 3650, resultStatus: null, splits: {}, at: null },
      { athleteKey: 'b', divisionKey: 'd1', value: 3700.4, resultStatus: null, splits: {}, at: null },
      { athleteKey: 'c', divisionKey: 'd1', value: 999999, resultStatus: 'dnf', splits: {}, at: null },
      { athleteKey: 'e', divisionKey: 'd1', value: 999999, resultStatus: 'absent', splits: {}, at: null }
    ]
  });
  const automatic = run(input);
  assert.deepEqual(automatic.boards, [], 'só resultado lançado à mão: a onda já não está na pista, então o automático não monta torre');
  const out = run(input, { mode: 'pin_heat', pinnedWaveKey: 'w' });
  const board = boardOf(out, 'w', 'd1');
  assert.deepEqual(board.rows.map((item) => [item.position, item.athleteKey, item.status, item.finalText, item.finishedBy]), [
    [1, 'a', 'finished', '1:00:50', 'published'],
    [2, 'b', 'finished', '1:01:40', 'published'],
    [null, 'c', 'dnf', null, null],
    [null, 'e', 'dnf', null, null]
  ], 'x não largou nem tem resultado: não é da onda');
  assert.deepEqual(rowOf(board, 'c').where, { kind: 'dnf' });
  const state = waveOf(out, 'w');
  assert.deepEqual([state.finished, state.onTrack, state.racingCount, state.closedAt], [true, false, 0, null], 'só resultado lançado à mão: sem os 90 s');
});

test('AC4 (D44): saída incompleta na última estação fica "sem tempo fechado": na pista, sem tempo inventado', () => {
  const input = base({
    athletes: [person('a'), person('b'), person('c')],
    waves: [wave('w', ['a', 'b', 'c'])],
    runs: [racing('a'), racing('b'), racing('c')],
    attempts: [
      attempt('a', 'wall-balls', 'exited_incomplete', 3_000_000, 3_100_000, { validReps: 80, targetReps: 100 }),
      attempt('b', 'ski-erg', 'exited_incomplete', 100_000, 200_000)
    ]
  });
  const out = runWave(input);
  const board = boardOf(out, 'w', 'd1');
  const sem = rowOf(board, 'a');
  assert.deepEqual(sem.where, { kind: 'track', afterStationId: 'wall-balls', afterStationName: 'Wall Balls', sinceAt: iso(3100), closedWithoutTime: true });
  assert.deepEqual([sem.status, sem.finalSeconds, sem.finalText, sem.slot], ['racing', null, null, 15]);
  assert.equal(rowOf(board, 'b').where.closedWithoutTime, false, 'saída incompleta no meio do percurso não é "sem tempo fechado"');
  assert.deepEqual([waveOf(out, 'w').onTrack, waveOf(out, 'w').racingCount], [true, 3]);
});

test('AC4 (D2): penalidade só em segundos: soma, último lance por instante e nenhum motivo na saída', () => {
  const input = base({
    athletes: [person('a')],
    waves: [wave('w', ['a'])],
    runs: [racing('a')],
    penalties: [
      { athleteKey: 'a', seconds: 30, stationId: 'row', at: iso(200), reason: 'invadiu a raia vizinha', label: 'Motivo secreto' },
      { athleteKey: 'a', seconds: 15, stationId: 'sled-push', at: iso(100), note: 'observação do árbitro' },
      { athleteKey: 'a', seconds: 0, stationId: 'ski-erg', at: iso(50) },
      { athleteKey: 'a', seconds: Number.NaN, stationId: 'ski-erg', at: iso(60) }
    ]
  });
  const out = runWave(input);
  const a = rowOf(boardOf(out, 'w', 'd1'), 'a');
  assert.equal(a.penaltySeconds, 45);
  assert.deepEqual(a.lastPenalty, { seconds: 30, stationId: 'row', at: iso(200) });
  assert.deepEqual(Object.keys(a.lastPenalty).sort(), ['at', 'seconds', 'stationId']);
  const text = JSON.stringify(out);
  assert.doesNotMatch(text, /invadiu|Motivo secreto|observação do árbitro/, 'o motivo nunca entra no motor');
});

test('AC4: chegadas fechadas pela súmula, em ordem de instante; ajuste manual do organizador não entra', () => {
  const input = base({
    athletes: [person('a'), person('b'), person('c'), person('d')],
    waves: [wave('w', ['a', 'b', 'c', 'd'])],
    runs: [
      finished('b', 3700, 3800),
      finished('a', 3600, 3700),
      finished('c', 3650, 3750, 'w', 'manual'),
      racing('d')
    ]
  });
  const arrivals = engine.computeRaceArrivals(input);
  assert.deepEqual(arrivals.map((item) => [item.athleteKey, item.finishAt, item.finalSeconds, item.finalText, item.divisionName, item.waveKey]), [
    ['a', iso(3700), 3600, '1:00:00', 'Open Masculino', 'w'],
    ['b', iso(3800), 3700, '1:01:40', 'Open Masculino', 'w']
  ]);
  assert.deepEqual(Object.keys(arrivals[0]).sort(), ['athleteKey', 'box', 'divisionKey', 'divisionName', 'finalSeconds', 'finalText', 'finishAt', 'name', 'waveKey']);
  const { out } = compute(4100);
  assert.deepEqual(out.arrivals.map((item) => [item.athleteKey, item.finishAt, item.finalText]), [
    ['rafael', iso(3982), '1:06:22'],
    ['bruno', iso(4015), '1:06:55']
  ]);
});

// ---------------------------------------------------------------------------
// AC5: roxo de melhor estação
// ---------------------------------------------------------------------------

test('AC5: cenário aos 24:00: melhores por estação e recordes batidos com o recorde anterior', () => {
  const { out } = compute(1440);
  assert.deepEqual(
    out.records.filter((item) => item.at !== null).map((item) => [item.stationKey, item.seconds, item.athleteKey, item.at, item.previous]),
    [
      ['ski-erg', 218, 'rafael', iso(452), { seconds: 232, name: 'Felipe Arruda', box: 'Box Aldeota', waveTitle: 'Onda 1' }],
      ['sled-push', 171, 'bruno', iso(924), { seconds: 182, name: 'João Victor Castro', box: 'CT Meireles', waveTitle: 'Onda 2' }],
      ['sled-pull', 227, 'bruno', iso(1418), { seconds: 246, name: 'Felipe Arruda', box: 'Box Aldeota', waveTitle: 'Onda 1' }]
    ]
  );
  assert.deepEqual(out.records.filter((item) => item.at === null).map((item) => [item.stationKey, item.seconds, item.athleteKey, item.previous]), [
    ['ski-erg', 232, 'felipe', null], ['sled-pull', 246, 'felipe', null], ['row', 240, 'renan', null],
    ['sled-push', 182, 'joao', null], ['wall-balls', 356, 'joao', null], ['sandbag-lunges', 262, 'samuel', null]
  ], 'o que veio dos splits publicados não tem instante e nunca tem recorde anterior');
  const bests = Object.fromEntries(out.bests.map((item) => [item.stationKey, [item.seconds, item.athleteKey, item.name, item.waveTitle]]));
  assert.deepEqual(bests, {
    'ski-erg': [218, 'rafael', 'Rafael Tavares', 'Onda 3'],
    'sled-push': [171, 'bruno', 'Bruno Sampaio', 'Onda 3'],
    'sled-pull': [227, 'bruno', 'Bruno Sampaio', 'Onda 3'],
    row: [240, 'renan', 'Renan Pinheiro', 'Onda 1'],
    'sandbag-lunges': [262, 'samuel', 'Samuel Rocha', 'Onda 2'],
    'wall-balls': [356, 'joao', 'João Victor Castro', 'Onda 2']
  });
  assert.ok(out.bests.every((item) => item.divisionKey === 'open-m'));
});

test('AC5: cenário final: oito recordes na ordem do instante e sem contar duas vezes quem aparece nas tentativas e nos splits', () => {
  const withResults = compute(5300, { withResults: true });
  const withoutResults = compute(5300, { withResults: false });
  assert.deepEqual(
    withResults.out.records.filter((item) => item.at !== null).map((item) => [item.stationKey, item.seconds, item.athleteKey, item.at, item.previous.seconds, item.previous.name]),
    [
      ['ski-erg', 218, 'rafael', iso(452), 232, 'Felipe Arruda'],
      ['sled-push', 171, 'bruno', iso(924), 182, 'João Victor Castro'],
      ['sled-pull', 227, 'bruno', iso(1418), 246, 'Felipe Arruda'],
      ['row', 225, 'rafael', iso(2439), 240, 'Renan Pinheiro'],
      ['sandbag-lunges', 261, 'bruno', iso(3398), 262, 'Samuel Rocha'],
      ['sandbag-lunges', 253, 'thiago', iso(3587), 261, 'Bruno Sampaio'],
      ['wall-balls', 345, 'bruno', iso(4015), 356, 'João Victor Castro'],
      ['wall-balls', 325, 'diego', iso(4180), 345, 'Bruno Sampaio']
    ]
  );
  assert.deepEqual(withResults.out.records, withoutResults.out.records, 'os splits de quem tem tentativa não contam de novo');
  assert.deepEqual(withResults.out.bests, withoutResults.out.bests);
  const best = Object.fromEntries(withResults.out.bests.map((item) => [item.stationKey, [item.seconds, item.athleteKey]]));
  assert.deepEqual(best['wall-balls'], [325, 'diego']);
  assert.deepEqual(best['sandbag-lunges'], [253, 'thiago']);
});

test('AC5: empate fica com quem fez antes; saída incompleta, cartão sem início e estação sem judge não contam', () => {
  const input = base({
    athletes: ['a', 'b', 'c', 'd', 'e', 'f'].map((key) => person(key)),
    waves: [wave('w', ['a', 'b', 'c', 'd', 'e', 'f'])],
    runs: ['a', 'b', 'c', 'd', 'e', 'f'].map((key) => racing(key)),
    attempts: [
      attempt('b', 'ski-erg', 'released', 70_000, 270_000),
      attempt('a', 'ski-erg', 'released', 60_000, 260_000),
      attempt('c', 'ski-erg', 'released', 210_000, 400_000),
      attempt('d', 'ski-erg', 'exited_incomplete', 50_000, 200_000),
      attempt('e', 'ski-erg', 'released', null, 300_000),
      attempt('f', 'ski-erg', 'running', 100_000, null),
      attempt('a', 'estacao-fora-do-percurso', 'released', 10_000, 20_000)
    ]
  });
  const { bests, records } = engine.computeRaceStationRecords(input);
  assert.deepEqual(records.map((item) => [item.athleteKey, item.seconds, item.at, item.previous && item.previous.name]), [
    ['a', 200, iso(260), null],
    ['c', 190, iso(400), 'Atleta a']
  ], 'b empatou com a e não é recorde');
  assert.deepEqual(bests.map((item) => [item.stationId, item.stationKey, item.seconds, item.athleteKey]), [['ski-erg', 'ski-erg', 190, 'c']]);
});

test('AC5: splits publicados valem para quem não tem tentativa; chaves race:, estação desconhecida e texto inválido são ignorados', () => {
  const input = base({
    athletes: [person('g'), person('h')],
    waves: [wave('w', ['g', 'h'])],
    runs: [racing('g'), racing('h')],
    attempts: [attempt('g', 'ski-erg', 'released', 0, 200_000)],
    results: [
      { athleteKey: 'g', divisionKey: 'd1', value: 4000, resultStatus: null, splits: { 'ski-erg': '03:20', 'sled-push': '03:00' }, at: null },
      {
        athleteKey: 'h', divisionKey: 'd1', value: 4100, resultStatus: null, at: null,
        splits: { 'ski-erg': '03:10', 'race:penalty_seconds': '15', 'race:penalties': '[]', 'sled-push': 'abc', 'run-1': '01:00', 'fantasma': '02:00', row: '00:00' }
      }
    ]
  });
  const { bests, records } = engine.computeRaceStationRecords(input);
  assert.deepEqual(records.map((item) => [item.stationKey, item.seconds, item.athleteKey, item.at]), [['ski-erg', 190, 'h', null]]);
  assert.deepEqual(bests.map((item) => [item.stationKey, item.seconds]), [['ski-erg', 190]], 'o push de g não vem do split: g tem tentativa');
  assert.equal(engine.parseSplitSeconds('03:42'), 222);
  assert.equal(engine.parseSplitSeconds('1:05:07'), 3907);
  assert.equal(engine.parseSplitSeconds('00:00'), null);
  assert.equal(engine.parseSplitSeconds('abc'), null);
  assert.equal(engine.parseSplitSeconds(222), null);
});

// ---------------------------------------------------------------------------
// AC6: disputa e reta final
// ---------------------------------------------------------------------------

const battleInput = ({ aheadIn = 60_000, backIn = 60_000, aheadOut = 300_000, backOut = 308_000, backAtOut = true } = {}) => base({
  athletes: [person('a'), person('b')],
  waves: [wave('w', ['a', 'b'])],
  runs: [racing('a'), racing('b')],
  attempts: [
    attempt('a', 'ski-erg', 'released', aheadIn, aheadOut),
    ...(backAtOut ? [attempt('b', 'ski-erg', 'released', backIn, backOut)] : [attempt('b', 'ski-erg', 'running', backIn, null)])
  ]
});

test('AC6: disputa vale a até 10 s pela diferença já arredondada (10,4 vale, 10,5 não)', () => {
  const battleOf = (backOut) => boardOf(runWave(battleInput({ backOut })), 'w', 'd1').battle;
  assert.deepEqual(battleOf(300_000 + 10_400) && [battleOf(300_000 + 10_400).intervalSeconds], [10]);
  assert.deepEqual(battleOf(300_000 + 10_499) && [battleOf(300_000 + 10_499).intervalSeconds], [10]);
  assert.equal(battleOf(300_000 + 10_500), null, '10,5 arredonda para 11');
  assert.equal(battleOf(300_000 + 40_000), null);
  assert.equal(battleOf(300_000)?.intervalSeconds, 0, 'empate no ponto também é disputa');
});

test('AC6: tendência desde a leitura anterior: "caiu" e "subiu" com 0,5 s ou mais, senão "estável"', () => {
  const trendOf = (backIn, backOut) => {
    const battle = boardOf(runWave(battleInput({ backIn, backOut })), 'w', 'd1').battle;
    return battle && [battle.trend, battle.trendSeconds, battle.since];
  };
  // antes: o de trás largava 20 s depois; agora, 8 s depois: a diferença caiu 12 s.
  assert.deepEqual(trendOf(80_000, 308_000), ['closing', 12, { stationName: 'Ski Erg', side: 'in' }]);
  assert.deepEqual(trendOf(65_000, 308_000), ['widening', 3, { stationName: 'Ski Erg', side: 'in' }]);
  assert.deepEqual(trendOf(60_000 + 8_000, 308_400), ['steady', 0, { stationName: 'Ski Erg', side: 'in' }], '0,4 s não conta');
  assert.deepEqual(trendOf(60_000 + 8_000, 308_500), ['widening', 1, { stationName: 'Ski Erg', side: 'in' }], '0,5 s conta e arredonda para 1');
  assert.deepEqual(trendOf(60_000 + 8_500, 308_000), ['closing', 1, { stationName: 'Ski Erg', side: 'in' }]);
});

test('AC6: sem leitura anterior em comum a tendência fica nula', () => {
  const input = base({
    athletes: [person('a'), person('b')],
    waves: [wave('w', ['a', 'b'])],
    runs: [racing('a'), racing('b')],
    attempts: [attempt('a', 'ski-erg', 'released', null, 300_000), attempt('b', 'ski-erg', 'released', null, 305_000)]
  });
  const battle = boardOf(runWave(input), 'w', 'd1').battle;
  assert.deepEqual([battle.intervalSeconds, battle.trend, battle.trendSeconds, battle.since], [5, null, null, null]);
});

test('AC6: disputa só entre vizinhos no mesmo ponto, sem tempo fechado nem DNF; vale a primeira da torre', () => {
  // vizinhos em pontos diferentes: sem disputa
  const apart = battleInput({ backAtOut: false });
  assert.equal(boardOf(runWave(apart), 'w', 'd1').battle, null);

  // o primeiro par fechou o tempo e o segundo não: a disputa é a do par que ainda corre
  const keys = ['a', 'b', 'c', 'd', 'e'];
  const input = base({
    athletes: keys.map((key) => person(key)),
    waves: [wave('w', keys)],
    runs: [finished('a', 3500), finished('b', 3503), racing('c'), racing('d'), racing('e')],
    attempts: [
      attempt('c', 'ski-erg', 'released', 60_000, 300_000),
      attempt('d', 'ski-erg', 'released', 60_000, 304_000),
      attempt('e', 'ski-erg', 'released', 60_000, 307_000)
    ]
  });
  const battle = boardOf(runWave(input), 'w', 'd1').battle;
  assert.deepEqual([battle.position, battle.aheadKey, battle.backKey, battle.intervalSeconds], [3, 'c', 'd', 4], 'o par c e d é o primeiro da torre; d e e vêm depois');

  // DNF não entra
  const withDnf = base({
    athletes: [person('a'), person('b')],
    waves: [wave('w', ['a', 'b'])],
    runs: [racing('a'), dnf('b', 500)],
    attempts: [attempt('a', 'ski-erg', 'released', 60_000, 300_000), attempt('b', 'ski-erg', 'released', 60_000, 303_000)]
  });
  assert.equal(boardOf(runWave(withDnf), 'w', 'd1').battle, null);
});

const finalistsOf = (lastStage, attempts, extra = {}) => {
  const keys = ['a', 'b', 'c', 'd', 'e'];
  const input = base({
    divisions: [{
      key: 'd1',
      name: 'Open',
      orderIndex: 1,
      stages: [
        { id: 'run-1', name: 'Corrida 1', type: 'run', orderIndex: 1 },
        { id: 'ski-erg', name: 'Ski Erg', type: 'station', orderIndex: 2, distance: '1000m', conferenceKind: 'ergometer' },
        { id: 'run-2', name: 'Corrida 2', type: 'run', orderIndex: 3 },
        { id: 'last', name: 'Estação Final', type: 'station', orderIndex: 4, ...lastStage }
      ]
    }],
    athletes: keys.map((key) => person(key)),
    waves: [wave('w', keys)],
    runs: keys.map((key) => racing(key)),
    attempts,
    ...extra
  });
  return boardOf(runWave(input), 'w', 'd1');
};
const atLast = (key, startMs, over = {}) => attempt(key, 'last', 'running', startMs, null, over);

test('AC6: reta final é a última estação do percurso (D34), até 3 por posição, com o progresso do tipo da estação', () => {
  const fourAtLast = [atLast('a', 100_000), atLast('b', 110_000), atLast('c', 120_000), atLast('d', 130_000), attempt('e', 'ski-erg', 'released', 10_000, 90_000)];
  const reps = finalistsOf({ conferenceKind: 'reps', reps: 100 }, fourAtLast.map((item, index) => (item.stationId === 'last' ? { ...item, validReps: 40 + index, targetReps: 100 } : item)));
  assert.deepEqual(reps.finalists.map((item) => [item.athleteKey, item.position, item.progress]), [
    ['a', 1, { type: 'reps', done: 40, target: 100 }],
    ['b', 2, { type: 'reps', done: 41, target: 100 }],
    ['c', 3, { type: 'reps', done: 42, target: 100 }]
  ], 'quatro na estação, no máximo três por posição');

  const sled = finalistsOf({ conferenceKind: 'sled', distance: '50m' }, [atLast('a', 100_000, { units: 2, expectedUnits: 4 })]);
  assert.deepEqual(sled.finalists[0].progress, { type: 'units', unit: 'trecho', done: 2, target: 4 });
  const sledByDistance = finalistsOf({ conferenceKind: 'sled', distance: '50m' }, [atLast('a', 100_000, { units: 1 })]);
  assert.deepEqual(sledByDistance.finalists[0].progress, { type: 'units', unit: 'trecho', done: 1, target: 4 }, 'sem meta no cartão, vale a do percurso (50 m / 12,5 m)');

  const sections = finalistsOf({ conferenceKind: 'sections', units: 6 }, [atLast('a', 100_000, { units: 3, expectedUnits: 6 })]);
  assert.deepEqual(sections.finalists[0].progress, { type: 'units', unit: 'volta', done: 3, target: 6 });

  for (const stage of [{ conferenceKind: 'ergometer', distance: '1000m' }, { conferenceKind: 'generic' }, { conferenceKind: 'sections' }]) {
    const timed = finalistsOf(stage, [atLast('a', 100_000)]);
    assert.deepEqual(timed.finalists[0].progress, { type: 'time' }, JSON.stringify(stage));
    assert.equal(timed.finalists[0].startedAt, iso(100));
  }

  const waiting = finalistsOf({ conferenceKind: 'reps', reps: 100 }, [attempt('a', 'last', 'waiting', null, null, { targetReps: 100 })]);
  assert.deepEqual(waiting.finalists.map((item) => [item.waiting, item.startedAt, item.progress]), [[true, null, { type: 'reps', done: 0, target: 100 }]]);
});

test('AC6: Wall Ball no meio do percurso é só uma estação com contagem, não é reta final (D32, D43)', () => {
  const input = base({
    divisions: [{
      key: 'd1',
      name: 'Open',
      orderIndex: 1,
      stages: [
        { id: 'run-1', name: 'Corrida 1', type: 'run', orderIndex: 1 },
        { id: 'wall-balls', name: 'Wall Balls', type: 'station', orderIndex: 2, conferenceKind: 'reps', reps: 100 },
        { id: 'run-2', name: 'Corrida 2', type: 'run', orderIndex: 3 },
        { id: 'row', name: 'Row', type: 'station', orderIndex: 4, distance: '1000m', conferenceKind: 'ergometer' }
      ]
    }],
    athletes: [person('a'), person('b'), person('c')],
    waves: [wave('w', ['a', 'b', 'c'])],
    runs: [racing('a'), racing('b'), racing('c')],
    attempts: [
      attempt('a', 'wall-balls', 'running', 100_000, null, { validReps: 30, targetReps: 100 }),
      attempt('b', 'wall-balls', 'released', 90_000, 180_000, { validReps: 100, targetReps: 100 }),
      attempt('b', 'row', 'running', 250_000, null)
    ]
  });
  const board = boardOf(runWave(input), 'w', 'd1');
  assert.deepEqual(board.finalists.map((item) => [item.athleteKey, item.stationName, item.progress]), [['b', 'Row', { type: 'time' }]]);
  assert.deepEqual(rowOf(board, 'a').where.progress, { type: 'reps', done: 30, target: 100 }, 'o Wall Ball do meio mostra a contagem na linha');
  assert.equal(board.stages.find((stage) => stage.id === 'wall-balls').closesTime, false);
  assert.equal(board.stages.find((stage) => stage.id === 'row').closesTime, true);
});

// ---------------------------------------------------------------------------
// AC7: onda na pista, onda terminada, silêncio
// ---------------------------------------------------------------------------

test('AC7: onda largada com corrida em andamento está na pista até o teto de 3 h desde a largada', () => {
  const waveOnTrack = (nowMs) => engine.computeRaceWaveStates(base({
    athletes: [person('a')], waves: [wave('w', ['a'])], runs: [racing('a')], nowMs
  }))[0];
  assert.equal(waveOnTrack(BASE_MS + engine.RACE_LIVE_MAX_MS - 1000).onTrack, true);
  assert.equal(waveOnTrack(BASE_MS + engine.RACE_LIVE_MAX_MS).onTrack, false, 'esquecida: sai do ar no teto');
  assert.equal(waveOnTrack(BASE_MS + engine.RACE_LIVE_MAX_MS).finished, false);
});

test('AC7: depois que a última corrida fecha, a onda fica na pista por mais 90 s (tempo final do cenário)', () => {
  const closing = 5164;
  const wavesAt = (nowSeconds) => compute(5300, { nowSeconds }).out.waves.find((item) => item.key === 'w3');
  const closed = wavesAt(closing + 89);
  assert.deepEqual([closed.finished, closed.onTrack, closed.closedAt, closed.racingCount], [true, true, iso(closing), 0]);
  assert.equal(wavesAt(closing + 90).onTrack, false);
  assert.equal(wavesAt(closing + 90).closedAt, iso(closing));
  const during = compute(5000).out.waves.find((item) => item.key === 'w3');
  assert.deepEqual([during.finished, during.onTrack, during.closedAt], [false, true, null]);
});

test('AC7: o instante do DNF é o da decisão (não o da última alteração); sem ele, vale a última corrida fechada', () => {
  const stateWith = (dnfAt, nowSeconds) => engine.computeRaceWaveStates(base({
    athletes: [person('a'), person('b')],
    waves: [wave('w', ['a', 'b'])],
    runs: [finished('a', 1000, 1000), dnf('b', dnfAt)],
    nowMs: BASE_MS + nowSeconds * 1000
  }))[0];
  assert.deepEqual([stateWith(1200, 1289).closedAt, stateWith(1200, 1289).onTrack], [iso(1200), true]);
  assert.equal(stateWith(1200, 1290).onTrack, false);
  assert.deepEqual([stateWith(null, 1050).closedAt, stateWith(null, 1050).onTrack], [iso(1000), true]);
  assert.equal(stateWith(null, 1090).onTrack, false);
});

test('AC7 (AUTO-DECISION 7e): terminar só por resultado lançado à mão não tem os 90 s; com chegada da súmula, eles contam dela', () => {
  const mixed = (nowSeconds) => engine.computeRaceWaveStates(base({
    athletes: [person('x'), person('y')],
    waves: [wave('w', ['x', 'y'])],
    runs: [finished('x', 500, 500)],
    results: [{ athleteKey: 'y', divisionKey: 'd1', value: 600, resultStatus: null, splits: {}, at: null }],
    nowMs: BASE_MS + nowSeconds * 1000
  }))[0];
  assert.deepEqual([mixed(560).finished, mixed(560).onTrack, mixed(560).closedAt], [true, true, iso(500)]);
  assert.equal(mixed(590).onTrack, false);
});

test('AC7: ao vivo não sai do ar por falta de leitura; o aviso de silêncio entra aos 10 min', () => {
  const quietAfter = 1200;
  const { out } = compute(1440, { nowSeconds: 1440 + quietAfter, view: {} });
  assert.deepEqual(out.resolution, { screen: 'live', reason: 'auto', scope: 'division', waveKeys: ['w3'], divisionKeys: ['open-m'] }, 'passaram 20 min sem leitura e a tela segue ao vivo');
  const state = waveOf(out, 'w3');
  assert.equal(state.onTrack, true);
  assert.equal(state.lastReadingAt, iso(1418), 'a última leitura é a saída do Sled Pull do Bruno');
  const nowOf = (seconds) => BASE_MS + seconds * 1000;
  assert.equal(engine.raceQuietMs(state.lastReadingAt, nowOf(1418 + 599)), null);
  assert.equal(engine.raceQuietMs(state.lastReadingAt, nowOf(1418 + 600)), 600_000);
  assert.equal(engine.raceQuietMs(state.lastReadingAt, nowOf(1418 + 1200)), 1_200_000);
  assert.equal(engine.raceQuietMs(null, nowOf(5000)), null);
});

test('AC7: última leitura da onda é o maior início ou saída; sem nenhum cartão, a largada', () => {
  const stateOf = (attempts) => engine.computeRaceWaveStates(base({
    athletes: [person('a'), person('b')], waves: [wave('w', ['a', 'b'])], runs: [racing('a'), racing('b')], attempts
  }))[0];
  assert.equal(stateOf([]).lastReadingAt, iso(0));
  assert.equal(stateOf([attempt('a', 'ski-erg', 'waiting', null, null)]).lastReadingAt, iso(0), 'cartão aguardando não é leitura');
  assert.equal(stateOf([attempt('a', 'ski-erg', 'released', 60_000, 200_000), attempt('b', 'ski-erg', 'running', 250_000, null)]).lastReadingAt, iso(250));
});

test('AC7: onda que ainda não largou: sem tempo, na ordem do cronograma, com as categorias na ordem do painel', () => {
  const input = base({
    divisions: [
      { key: 'd1', name: 'Open Masculino', orderIndex: 2, stages: stageList() },
      { key: 'd2', name: 'Open Feminino', orderIndex: 1, stages: stageList() }
    ],
    athletes: [person('a', 'd1'), person('b', 'd2'), person('c', 'd1')],
    waves: [wave('wn', ['a', 'b', 'fantasma', 'c'], null)]
  });
  const [state] = engine.computeRaceWaveStates(input);
  assert.deepEqual(
    [state.started, state.startedAt, state.onTrack, state.finished, state.lastReadingAt, state.athleteCount, state.divisionKeys],
    [false, null, false, false, null, 3, ['d2', 'd1']]
  );
});

// ---------------------------------------------------------------------------
// AC8: escolha da tela
// ---------------------------------------------------------------------------

const ws = (key, over = {}) => ({
  key, title: key, order: 0, startedAt: null, started: false, onTrack: false, finished: false, closedAt: null,
  lastReadingAt: null, athleteCount: 4, racingCount: 0, divisionKeys: ['d1'], ...over
});
const screenOf = (over) => engine.resolveRaceScreen({ mode: 'auto', pinnedWaveKey: null, pinnedDivisionKey: null, waves: [], standings: [], ...over });

test('AC8 (R4 da 1.116): modos da mesa: espera, categoria fixada e onda fixada', () => {
  assert.deepEqual(screenOf({ mode: 'standby', waves: [ws('a', { onTrack: true, started: true })] }), { screen: 'standby', reason: 'pinned' });
  assert.deepEqual(
    screenOf({ mode: 'pin_standings', pinnedDivisionKey: 'd2', waves: [ws('a', { onTrack: true, started: true })] }),
    { screen: 'class', reason: 'pinned', divisionKeys: ['d2'], gridWaveKey: null },
    'categoria sem onda na pista: a classificação dela'
  );
  assert.deepEqual(
    screenOf({ mode: 'pin_standings', pinnedDivisionKey: 'd1', waves: [ws('a', { onTrack: true, started: true })] }),
    { screen: 'live', reason: 'pinned', scope: 'division', waveKeys: ['a'], divisionKeys: ['d1'] },
    'categoria com onda na pista: a torre da categoria ao vivo'
  );
  assert.equal(screenOf({ mode: 'pin_standings', pinnedDivisionKey: null, waves: [ws('a', { onTrack: true, started: true })] }).screen, 'live', 'sem categoria fixada cai no automático');

  assert.deepEqual(screenOf({ mode: 'pin_heat', pinnedWaveKey: 'a', waves: [ws('a')] }), { screen: 'grid', reason: 'pinned', waveKey: 'a' });
  assert.deepEqual(
    screenOf({ mode: 'pin_heat', pinnedWaveKey: 'a', waves: [ws('a', { started: true, finished: true }), ws('b', { started: true, onTrack: true })] }),
    { screen: 'live', reason: 'pinned', scope: 'wave', waveKeys: ['a'], divisionKeys: ['d1'] },
    'onda largada vai ao vivo (a torre da onda) mesmo terminada'
  );
  assert.deepEqual(
    screenOf({ mode: 'pin_heat', pinnedWaveKey: 'fantasma', waves: [ws('b', { started: true, onTrack: true })] }),
    { screen: 'live', reason: 'auto', scope: 'division', waveKeys: ['b'], divisionKeys: ['d1'] },
    'onda fixada que não existe cai no automático'
  );
});

test('AC8 (R1 da 1.116): automático: ao vivo com onda na pista, ondas mais antigas primeiro e uma torre por categoria delas', () => {
  const resolution = screenOf({
    waves: [
      ws('b', { order: 0, started: true, onTrack: true, startedAt: iso(100), divisionKeys: ['d2', 'd1'] }),
      ws('a', { order: 1, started: true, onTrack: true, startedAt: iso(0) }),
      ws('c', { order: 2, divisionKeys: ['d3'] })
    ],
    standings: [{ divisionKey: 'd1', rows: 5 }, { divisionKey: 'd2', rows: 0 }, { divisionKey: 'd3', rows: 0 }]
  });
  assert.deepEqual(resolution, { screen: 'live', reason: 'auto', scope: 'division', waveKeys: ['a', 'b'], divisionKeys: ['d1', 'd2'] }, 'categorias na ordem de standings; a da onda que não largou fica de fora');
});

test('AC8: automático: sem onda na pista, a classificação alterna com o grid da próxima onda', () => {
  const waves = [ws('w1', { started: true, finished: true }), ws('vazia', { athleteCount: 0 }), ws('w2'), ws('w3')];
  assert.deepEqual(
    screenOf({ waves, standings: [{ divisionKey: 'd1', rows: 3 }, { divisionKey: 'd2', rows: 0 }, { divisionKey: 'd3', rows: 7 }] }),
    { screen: 'class', reason: 'auto', divisionKeys: ['d1', 'd3'], gridWaveKey: 'w2' },
    'categorias sem resultado ficam de fora; a próxima onda é a primeira sem largada que tem atleta'
  );
  assert.deepEqual(
    screenOf({ waves: [ws('w1', { started: true, finished: true })], standings: [{ divisionKey: 'd1', rows: 3 }] }),
    { screen: 'class', reason: 'auto', divisionKeys: ['d1'], gridWaveKey: null },
    'sem próxima onda, só a classificação'
  );
});

test('AC8: automático: sem resultado e com próxima onda é o grid sozinho; sem próxima onda nem resultado, a espera', () => {
  assert.deepEqual(screenOf({ waves: [ws('w1'), ws('w2')], standings: [{ divisionKey: 'd1', rows: 0 }] }), { screen: 'grid', reason: 'auto', waveKey: 'w1' });
  assert.deepEqual(screenOf({ waves: [ws('w1', { started: true, finished: true })], standings: [] }), { screen: 'standby', reason: 'auto' });
  assert.deepEqual(screenOf({ waves: [], standings: [] }), { screen: 'standby', reason: 'auto' });
  assert.deepEqual(screenOf({ waves: [ws('w1', { athleteCount: 0 })] }), { screen: 'standby', reason: 'auto' }, 'onda sem atleta não é próxima onda');
});

test('AC8: o gatilho é a súmula, não o cronograma: horário do cronograma não muda a tela', () => {
  const early = base({ athletes: [person('a')], waves: [wave('w', ['a'], null, { time: '00:00', date: '2020-01-01' })] });
  const late = base({ athletes: [person('a')], waves: [wave('w', ['a'], null, { time: '23:59', date: '2099-12-31' })] });
  assert.deepEqual(run(early).resolution, run(late).resolution);
  assert.deepEqual(run(early).resolution, { screen: 'grid', reason: 'auto', waveKey: 'w' });
});

test('AC8: computeRaceBroadcast: ao vivo, onda fixada terminada, grid fixado e classificação com o grid da próxima onda', () => {
  const live = compute(1440, { view: {} }).out;
  assert.equal(live.resolution.screen, 'live');
  assert.deepEqual(live.classSteps, []);
  assert.deepEqual(live.boards.map((board) => [board.scope, board.divisionKey]), [['division', 'open-m']], 'automático: a torre da categoria');

  const input = buildReferenceInput({ seconds: 5300, nowSeconds: 5300 + 600 });
  const finishedWave = run(input, { mode: 'pin_heat', pinnedWaveKey: 'w3' });
  assert.deepEqual(finishedWave.resolution, { screen: 'live', reason: 'pinned', scope: 'wave', waveKeys: ['w3'], divisionKeys: ['open-m'] });
  assert.equal(finishedWave.boards.length, 1, 'a onda fixada aparece com os resultados dela');
  assert.equal(waveOf(finishedWave, 'w3').onTrack, false);

  const gridPinned = run(input, { mode: 'pin_heat', pinnedWaveKey: 'w4' });
  assert.deepEqual(gridPinned.resolution, { screen: 'grid', reason: 'pinned', waveKey: 'w4' });
  assert.deepEqual(gridPinned.boards, []);

  const auto = run(input);
  assert.deepEqual(auto.resolution, { screen: 'class', reason: 'auto', divisionKeys: ['open-m'], gridWaveKey: 'w4' }, 'Open Feminino ainda não tem resultado');
  assert.deepEqual(auto.boards, []);
  assert.deepEqual(auto.classSteps, [
    { kind: 'class', divisionKey: 'open-m', page: 0, pageCount: 2 },
    { kind: 'class', divisionKey: 'open-m', page: 1, pageCount: 2 },
    { kind: 'grid', waveKey: 'w4', page: 0, pageCount: 1 }
  ]);
  assert.equal(standingsOf(input).find((item) => item.divisionKey === 'open-m').rows, 15);

  const pinnedDivision = run(input, { mode: 'pin_standings', pinnedDivisionKey: 'open-f' });
  assert.deepEqual(pinnedDivision.resolution, { screen: 'class', reason: 'pinned', divisionKeys: ['open-f'], gridWaveKey: null });
  assert.deepEqual(pinnedDivision.classSteps, [{ kind: 'class', divisionKey: 'open-f', page: 0, pageCount: 1 }], 'categoria fixada sem resultado ainda tem um passo');
});

test('AC8: sem onda nenhuma o telão fica na espera; antes da primeira onda, no grid sozinho', () => {
  assert.deepEqual(run(base()).resolution, { screen: 'standby', reason: 'auto' });
  const beforeFirst = base({ athletes: [person('a'), person('b')], waves: [wave('w', ['a', 'b'], null)] });
  const out = run(beforeFirst);
  assert.deepEqual(out.resolution, { screen: 'grid', reason: 'auto', waveKey: 'w' });
  assert.deepEqual([out.boards, out.classSteps, out.liveSteps], [[], [], []]);
});

// ---------------------------------------------------------------------------
// AC9: rodízio e páginas
// ---------------------------------------------------------------------------

test('AC9: o passo do rodízio vem da hora do servidor: 20 s por passo, um passo só não rodiza', () => {
  const step = engine.raceStepIndex;
  assert.deepEqual([0, 19_999, 20_000, 39_999, 40_000, 59_999, 60_000].map((ms) => step(ms, engine.RACE_LIVE_STEP_MS, 3)), [0, 0, 1, 1, 2, 2, 0]);
  assert.deepEqual([0, 20_000, 40_000, 123_456].map((ms) => step(ms, engine.RACE_LIVE_STEP_MS, 1)), [0, 0, 0, 0]);
  assert.deepEqual([0, 7_999, 8_000, 16_000].map((ms) => step(ms, engine.RACE_TOWER_PAGE_MS, 2)), [0, 0, 1, 0]);
  assert.deepEqual([0, 11_999, 12_000, 24_000, 36_000].map((ms) => step(ms, engine.RACE_CLASS_STEP_MS, 3)), [0, 0, 1, 2, 0]);
  assert.equal(step(BASE_MS + 5_000, 20_000, 4), step(BASE_MS + 5_000, 20_000, 4), 'duas TVs com a mesma hora mostram o mesmo passo');
  assert.equal(step(BASE_MS, 20_000, 0), 0);
});

test('AC9 (R1 e R4 da 1.116): passos da torre = categoria no automático; onda × categoria só com a onda fixada', () => {
  const input = base({
    divisions: [
      { key: 'dF', name: 'Open Feminino', orderIndex: 2, stages: stageList() },
      { key: 'dM', name: 'Open Masculino', orderIndex: 1, stages: stageList() }
    ],
    athletes: [person('b1', 'dF'), person('a1', 'dM'), person('a2', 'dM'), person('c2', 'dF'), person('c1', 'dM')],
    waves: [wave('w1', ['b1', 'a1', 'a2'], 0), wave('w2', ['c2', 'c1'], 300), wave('w3', ['a1'], null)],
    runs: [racing('a1', 'w1'), racing('a2', 'w1'), racing('b1', 'w1'), racing('c1', 'w2'), racing('c2', 'w2')]
  });
  const standings = [{ divisionKey: 'dM', rows: 0 }, { divisionKey: 'dF', rows: 0 }];
  const out = run(input, { standings });
  assert.deepEqual(out.resolution, { screen: 'live', reason: 'auto', scope: 'division', waveKeys: ['w1', 'w2'], divisionKeys: ['dM', 'dF'] });
  assert.deepEqual(out.liveSteps, [{ waveKey: null, divisionKey: 'dM' }, { waveKey: null, divisionKey: 'dF' }]);
  assert.deepEqual(out.boards.map((item) => [item.scope, item.waveKey, item.divisionKey, item.divisionName, item.rows.map((row) => row.athleteKey)]), [
    ['division', null, 'dM', 'Open Masculino', ['a1', 'a2', 'c1']],
    ['division', null, 'dF', 'Open Feminino', ['b1', 'c2']]
  ], 'a torre da categoria junta as ondas largadas; sem leitura, na ordem das ondas e do cronograma');
  assert.deepEqual(engine.buildRaceLiveSteps(out.boards), out.liveSteps);

  const pinned = run(input, { standings, mode: 'pin_heat', pinnedWaveKey: 'w1' });
  assert.deepEqual(pinned.liveSteps, [{ waveKey: 'w1', divisionKey: 'dM' }, { waveKey: 'w1', divisionKey: 'dF' }]);
  assert.deepEqual(pinned.boards.map((item) => [item.scope, item.waveKey, item.divisionKey, item.rows.map((row) => row.athleteKey)]), [
    ['wave', 'w1', 'dM', ['a1', 'a2']],
    ['wave', 'w1', 'dF', ['b1']]
  ]);
});

test('AC9: categoria com mais de 10 atletas: páginas de 10 com o líder e a reta final fixos em toda página', () => {
  const rows = Array.from({ length: 14 }, (_, index) => ({ athleteKey: `k${index + 1}` }));
  const pages = engine.raceTowerPages(rows, ['k1', 'k13', 'k14']);
  assert.deepEqual(pages, [
    ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8', 'k13', 'k14'],
    ['k1', 'k9', 'k10', 'k11', 'k12', 'k13', 'k14']
  ]);
  assert.ok(pages.every((page) => page.length <= engine.RACE_PAGE_SIZE));
  assert.deepEqual([...new Set(pages.flat())].sort(), rows.map((item) => item.athleteKey).sort(), 'ninguém fica de fora');
  assert.deepEqual(engine.raceTowerPages(rows.slice(0, 10), ['k1']), [rows.slice(0, 10).map((item) => item.athleteKey)], 'até 10 atletas: uma página');
  assert.deepEqual(engine.raceTowerPages([], []), [[]]);
  const crowded = engine.raceTowerPages(rows, rows.map((item) => item.athleteKey));
  assert.ok(crowded.every((page) => page.length <= engine.RACE_PAGE_SIZE), 'fixos demais não estouram a página');
});

test('AC9: a página da torre usa o líder e a reta final do cenário', () => {
  const board = boardOf(compute(4100).out);
  assert.deepEqual(engine.raceFixedKeys(board), ['rafael', 'diego', 'thiago', 'lucas']);
  assert.deepEqual(engine.raceTowerPages(board.rows, engine.raceFixedKeys(board)), [board.rows.map((row) => row.athleteKey)], '10 atletas: uma página');
});

test('AC9: passos da classificação: categoria × página de 10 linhas e o grid da próxima onda, uma página por 10 vagas', () => {
  assert.deepEqual(engine.racePageCount(0), 1);
  assert.deepEqual([10, 11, 20, 21].map((rows) => engine.racePageCount(rows)), [1, 2, 2, 3]);
  const steps = engine.buildRaceClassSteps({
    divisionKeys: ['d1', 'd2'],
    standings: [{ divisionKey: 'd1', rows: 12 }, { divisionKey: 'd2', rows: 5 }],
    gridWaveKey: 'w',
    gridAthleteCount: 11
  });
  assert.deepEqual(steps, [
    { kind: 'class', divisionKey: 'd1', page: 0, pageCount: 2 },
    { kind: 'class', divisionKey: 'd1', page: 1, pageCount: 2 },
    { kind: 'class', divisionKey: 'd2', page: 0, pageCount: 1 },
    { kind: 'grid', waveKey: 'w', page: 0, pageCount: 2 },
    { kind: 'grid', waveKey: 'w', page: 1, pageCount: 2 }
  ]);
  assert.deepEqual(
    engine.buildRaceClassSteps({ divisionKeys: ['d1'], standings: [{ divisionKey: 'd1', rows: 3 }], gridWaveKey: null, gridAthleteCount: 0 }),
    [{ kind: 'class', divisionKey: 'd1', page: 0, pageCount: 1 }],
    'sem próxima onda, só a classificação'
  );
});
