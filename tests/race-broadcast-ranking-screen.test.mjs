import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createFakeSupabase } from './support/fakeSupabase.mjs';
import { createRaceClient } from './support/fakeRaceSupabase.mjs';
import { RANKING_BASE_MS, at, buildRankingInput, rankingStageStart } from './support/raceRankingScenario.mjs';
import { EVENT_ID, athleteId, runId, seedRaceDatabase } from './support/raceBroadcastSeed.mjs';
import { importServerModule, setActiveSupabaseClient } from './support/serverModuleHarness.mjs';

// Stories 1.117 e 1.118 (Telão Fitness Race, T7 e T8): o ranking único pelo servidor e na tela.
// O payload é o real (banco em memória semeado com o cenário do telão simulado aprovado,
// tests/support/raceRankingScenario.mjs); os textos saem das funções puras de
// raceBroadcastView.ts e raceBroadcastMoments.ts; o fonte da tela é conferido por regex
// (o harness não carrega CSS nem React).

process.env.SUPABASE_URL = 'http://supabase.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';
process.env.WODA_SESSION_SECRET = 'segredo-de-teste-ranking-tela';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let database = createFakeSupabase();
const client = createRaceClient(() => database, { missingRaceTables: false, beforeUpdate: {}, beforeCount: {} });
setActiveSupabaseClient(client);

const builder = await importServerModule('lib/serverRaceBroadcast.ts');
const view = await importServerModule('lib/raceBroadcastView.ts');
const moments = await importServerModule('lib/raceBroadcastMoments.ts');

const nowAt = (seconds) => RANKING_BASE_MS + seconds * 1000;
const payloadAt = async (seconds, options = {}, mutate) => {
  const seeded = seedRaceDatabase({ seconds, input: buildRankingInput({ seconds }), ...options });
  database = createFakeSupabase(seeded.seed);
  if (mutate) mutate(database);
  return builder.buildRaceBroadcastState(client, database.rows('events')[0], database.rows('event_broadcasts')[0], { nowMs: nowAt(options.nowSeconds ?? seconds) });
};
const names = (board) => board.rows.map((row) => row.name);
const rowNamed = (board, name) => board.rows.find((row) => row.name === name);

// ---------------------------------------------------------------------------
// Story 1.117: leitura e payload
// ---------------------------------------------------------------------------

test('1.117: às 10:42 o servidor entrega a torre da categoria com as três ondas, na ordem da maquete aprovada', async () => {
  const payload = await payloadAt(2520);
  assert.equal(payload.screen, 'live');
  const live = payload.live;
  assert.equal(live.scope, 'division');
  assert.deepEqual(live.steps, [{ waveKey: null, divisionKey: 'open-m' }]);
  assert.deepEqual(live.waves.map((wave) => [wave.key, wave.title, wave.startedClock, wave.racingCount]), [
    ['o1', 'Onda 1', '10:00:00', 5], ['o2', 'Onda 2', '10:12:00', 5], ['o3', 'Onda 3', '10:24:00', 5]
  ]);
  const board = live.boards[0];
  assert.deepEqual([board.scope, board.waveKey, board.waveTitle, board.divisionName], ['division', null, null, 'Open Masculino']);
  assert.deepEqual(names(board), [
    'Bruno Sampaio', 'Rafael Tavares', 'Diego Martins', 'Igor Nogueira', 'Thiago Bezerra', 'André Moreira', 'Caio Fernandes', 'Mateus Ribeiro',
    'Renan Cavalcante', 'Vitor Barros', 'Pedro Albuquerque', 'Lucas Holanda', 'Felipe Castro', 'Henrique Paiva', 'Gustavo Lima'
  ]);
  const felipe = rowNamed(board, 'Felipe Castro');
  assert.deepEqual([felipe.gapCounting, felipe.gapSeconds, felipe.gapBaseSeconds], [true, null, 1475], 'o "contando" vai com a diferença nula: a tela conta pela base');
  assert.deepEqual([rowNamed(board, 'Rafael Tavares').gapSeconds, rowNamed(board, 'Rafael Tavares').waveNumber, rowNamed(board, 'Rafael Tavares').startedAt], [44, 1, at(0)]);
  assert.equal(JSON.stringify(payload).includes(athleteId('bruno')), false, 'o id do atleta nunca sai');
});

test('1.117: a version só muda com dado novo (o relógio e o "contando" correm na tela)', async () => {
  const first = await payloadAt(2520);
  const later = await payloadAt(2520, { nowSeconds: 2520.4 });
  assert.equal(later.version, first.version);
  assert.notEqual(later.serverTime, first.serverTime);
});

test('1.117: a base do tempo de prova é a largada da corrida (race_runs.started_at), que acompanha a correção da largada', async () => {
  const shifted = await payloadAt(2520, {}, (db) => {
    db.rows('race_runs').find((row) => row.id === runId('rafael')).started_at = at(120);
  });
  const board = shifted.live.boards[0];
  assert.equal(names(board)[0], 'Rafael Tavares', 'com a largada 2 min depois, o Rafael passa à frente do Bruno');
  assert.equal(rowNamed(board, 'Rafael Tavares').startedAt, at(120));
});

test('1.117: faixa da direção de prova: "entra no ranking" com a posição de quando a pessoa entrou', async () => {
  const entry = rankingStageStart('diego', 1);
  const payload = await payloadAt(entry + 1);
  const last = payload.live.ticker.at(-1);
  assert.deepEqual([last.kind, last.name, last.waveTitle, last.position, last.point, last.divisionKeys], ['enter', 'Diego Martins', 'Onda 3', 1, { stationName: 'Ski Erg', side: 'in' }, ['open-m']]);
  assert.deepEqual(view.describeRaceTicker(last), { clock: '10:28:14', text: 'ENTRA NO RANKING · Diego Martins (Onda 3) em 1º · entrada Ski Erg' });
  assert.ok(payload.live.ticker.length <= 6, 'os 6 últimos da categoria');

  const afterDrop = rankingStageStart('diego', 2) + 5;
  const later = await payloadAt(afterDrop);
  assert.equal(rowNamed(later.live.boards[0], 'Diego Martins').position, 3, 'saiu do Ski Erg e caiu para 3º');
  const diego = later.live.ticker.find((event) => event.kind === 'enter' && event.name === 'Diego Martins');
  assert.ok(diego, 'a entrada dele ainda está entre os 6 últimos eventos da categoria');
  assert.equal(diego.position, 1, 'a posição é a de quando entrou, não a de agora');
});

test('1.117 (R4): categoria fixada mostra a torre dela ao vivo; sem onda dela na pista, a classificação', async () => {
  const live = await payloadAt(2520, { mode: 'pin_standings', pinnedDivision: 'open-m' });
  assert.deepEqual([live.screen, live.live.scope, live.live.steps], ['live', 'division', [{ waveKey: null, divisionKey: 'open-m' }]]);
  const female = await payloadAt(2520, { mode: 'pin_standings', pinnedDivision: 'open-f' });
  assert.equal(female.screen, 'class');
  const wave = await payloadAt(2520, { mode: 'pin_heat', pinnedHeat: 'o2' });
  assert.deepEqual([wave.live.scope, wave.live.steps, names(wave.live.boards[0])], ['wave', [{ waveKey: 'o2', divisionKey: 'open-m' }], ['Bruno Sampaio', 'André Moreira', 'Caio Fernandes', 'Lucas Holanda', 'Felipe Castro']]);
  assert.equal(database.rows('event_broadcasts')[0].event_id, EVENT_ID);
});

// ---------------------------------------------------------------------------
// Story 1.118: apresentação da torre da categoria
// ---------------------------------------------------------------------------

test('1.118: quadro, cabeçalho com um relógio por onda e título "Categoria · ranking da prova"', async () => {
  const payload = await payloadAt(2520);
  const frame = view.raceLiveFrame(payload.live, nowAt(2520));
  assert.equal(frame.wave, null);
  assert.deepEqual(frame.waves.map((wave) => wave.key), ['o1', 'o2', 'o3']);
  assert.deepEqual([frame.pageCount, frame.rows.length], [1, 15], '15 atletas cabem numa página de 15');
  assert.deepEqual(view.describeRaceHeader(frame, nowAt(2520)), {
    title: 'Open Masculino · ranking da prova', clock: '', caption: '',
    clocks: [{ key: 'o1', label: 'Onda 1', clock: '42:00' }, { key: 'o2', label: 'Onda 2', clock: '30:00' }, { key: 'o3', label: 'Onda 3', clock: '18:00' }]
  });
  assert.equal(view.raceFrameRacing(frame), true);
});

test('1.118: "Dif. para o 1º" com o ponto, o "contando" pela hora do servidor e o líder com o tempo de prova', async () => {
  const board = (await payloadAt(2520)).live.boards[0];
  const gap = (name, seconds = 2520) => view.describeRaceGap(rowNamed(board, name), { scope: 'division', nowMs: nowAt(seconds) });
  assert.deepEqual(gap('Bruno Sampaio'), { tone: 'lead', text: 'LÍDER', sub: 'saída Sled Pull · 24:35', penalty: null, counting: false });
  assert.deepEqual(gap('Rafael Tavares'), { tone: 'gap', text: '+0:44', sub: 'saída Sled Pull', penalty: null, counting: false });
  assert.deepEqual(gap('Felipe Castro'), { tone: 'gap', text: '+5:25', sub: 'saída Sled Pull · contando', penalty: null, counting: true });
  assert.equal(gap('Felipe Castro', 2530).text, '+5:35', 'a diferença cresce com o relógio dele');
  assert.equal(gap('Thiago Bezerra').penalty, '+15 s');
  const negative = view.describeRaceGap({ ...rowNamed(board, 'Rafael Tavares'), gapSeconds: -20 }, { scope: 'division', nowMs: nowAt(2520) });
  assert.deepEqual([negative.tone, negative.text], ['ahead', '−0:20'], 'mais rápido que o 1º naquele ponto: verde e com sinal de menos');
  const unranked = view.describeRaceGap({ ...rowNamed(board, 'Rafael Tavares'), position: null }, { scope: 'division', nowMs: nowAt(2520) });
  assert.deepEqual([unranked.tone, unranked.text], ['none', '–']);
  assert.deepEqual([view.formatRaceSignedGap(44), view.formatRaceSignedGap(-0.4), view.formatRaceSignedGap(-20.5)], ['+0:44', '+0:00', '−0:20']);
  assert.deepEqual([view.racePointText({ stationName: 'Row', side: 'in' }), view.racePointText({ stationName: 'Row', side: 'out' }), view.racePointText({ stationName: 'Wall Balls', side: 'finish' }), view.racePointText(null)], ['entrada Row', 'saída Row', 'chegada', '']);
  assert.deepEqual([view.raceWaveTag(3), view.raceWaveTag(null)], ['O3', '']);
});

test('1.118: quem largou e não tem leitura aparece "Largou · aguardando 1ª leitura", sem posição e fora das setas', async () => {
  const entry = rankingStageStart('diego', 1);
  const board = (await payloadAt(entry - 1)).live.boards[0];
  const diego = rowNamed(board, 'Diego Martins');
  assert.equal(diego.position, null);
  assert.deepEqual(view.describeRaceWhere(diego, view.raceClosingStationId(board), nowAt(entry - 1)).main, 'Largou');
  assert.equal(view.describeRaceWhere(diego, view.raceClosingStationId(board), nowAt(entry - 1)).sub, 'aguardando 1ª leitura · 4:13');
  assert.equal(view.raceRankOrder(board.rows).includes(diego.athleteKey), false);
  assert.equal(view.raceRowPosition(diego), '–');
});

test('1.118: disputa entre ondas no cartão A e o tempo a bater na reta final', async () => {
  const live = (await payloadAt(2520)).live;
  const frame = view.raceLiveFrame(live, nowAt(2520));
  const battle = view.describeRaceCardA(frame.board, null, nowAt(2520));
  assert.deepEqual([battle.kind, battle.eyebrow, battle.crossWave, battle.ahead.box, battle.back.box, battle.interval, battle.trend], [
    'battle', 'Disputa pelo 2º lugar', true, 'Onda 1 · Box Aldeota', 'Onda 3 · Arena Sul', '0:08', 'na saída Sled Push · subiu 0:14 desde a entrada do Sled Push'
  ]);

  const duelAt = rankingStageStart('diego', 15) + 30;
  const duel = (await payloadAt(duelAt)).live;
  const card = view.describeRaceCardB(duel.boards[0], null, nowAt(duelAt), duel.waves);
  const diego = card.items.find((item) => item.name === 'Diego Martins');
  assert.deepEqual([card.kind, diego.wave, diego.target], ['finalists', 'O3', { name: 'Bruno Sampaio', time: '1:09:28' }], 'com 1:06:04 de prova, Diego ainda pode passar o Bruno');
  const lateAt = 1440 + 4200;
  const late = (await payloadAt(lateAt)).live;
  const lateDiego = view.describeRaceCardB(late.boards[0], null, nowAt(lateAt), late.waves).items.find((item) => item.name === 'Diego Martins');
  assert.deepEqual(lateDiego.target, { name: 'Rafael Tavares', time: '1:11:32' }, 'o relógio passou do tempo do Bruno: o tempo a bater vira o 1:11:32 do Rafael');
});

test('1.118: sem reta final nem próxima onda, o cartão B mostra as ondas na pista', async () => {
  const live = (await payloadAt(2520)).live;
  const card = view.describeRaceCardB(live.boards[0], null, nowAt(2520), live.waves);
  assert.deepEqual(card, { kind: 'waves', eyebrow: 'Ondas na pista', items: [
    { key: 'o1', title: 'Onda 1', clock: '42:00', detail: '5 correndo · 0 chegaram' },
    { key: 'o2', title: 'Onda 2', clock: '30:00', detail: '5 correndo · 0 chegaram' },
    { key: 'o3', title: 'Onda 3', clock: '18:00', detail: '5 correndo · 0 chegaram' }
  ] });
});

test('1.118: novo líder: o cartão entra quando o 1º muda, fica 6,5 s e nunca na primeira carga', async () => {
  const brunoOut = rankingStageStart('bruno', 2);
  const before = (await payloadAt(brunoOut - 1)).live;
  const after = (await payloadAt(brunoOut)).live;
  const firstLoad = moments.nextRaceLeaderState(moments.RACE_LEADER_INITIAL, before, nowAt(brunoOut - 1), true);
  assert.deepEqual(firstLoad.changes, {});
  const changed = moments.nextRaceLeaderState(firstLoad, after, nowAt(brunoOut), false);
  const card = moments.describeRaceNewLeader(after.boards[0], changed, nowAt(brunoOut + 1));
  assert.deepEqual(card, { kind: 'newLeader', eyebrow: 'Novo líder da prova', name: 'Bruno Sampaio', who: 'Onda 2 · CT Meireles', at: 'Passou Rafael Tavares (Onda 1) na saída Ski Erg', advantage: '0:13' });
  assert.equal(moments.describeRaceNewLeader(after.boards[0], changed, nowAt(brunoOut + 7)), null, 'some depois de 6,5 s');
  const frame = view.raceLiveFrame(after, nowAt(brunoOut + 1));
  assert.equal(moments.describeRaceCardAWithPurple(after, frame, nowAt(brunoOut + 1), changed).kind, 'purple', 'o roxo do Ski Erg do Bruno, no mesmo instante, tem prioridade');
  assert.equal(moments.describeRaceCardAWithPurple({ ...after, records: [] }, frame, nowAt(brunoOut + 1), changed).kind, 'newLeader', 'sem roxo, o novo líder vem acima da disputa e do líder');
  assert.deepEqual(moments.nextRaceLeaderState(changed, null, nowAt(brunoOut + 2), false).leaders, {}, 'fora do ao vivo, os líderes saem e não disparam troca na volta');
});

test('1.118: luzes de largada na torre da categoria: a onda nova entra por cima do mapa com as categorias dela', async () => {
  const before = await payloadAt(1435);
  const after = await payloadAt(1442);
  const start = moments.detectSeenStart(before, after, nowAt(1442));
  assert.deepEqual(start, { waveKey: 'o3', waveTitle: 'Onda 3', divisionsText: 'Open Masculino', startedAt: at(1440), placement: 'map' });
  const board = after.live.boards[0];
  assert.deepEqual(board.rows.filter((row) => row.waveKey === 'o3').map((row) => row.position), [null, null, null, null, null], 'os atletas da onda entram no fim da torre, sem posição');
});

test('1.118: faixa e aviso de silêncio da torre da categoria', async () => {
  const live = (await payloadAt(2520)).live;
  const event = view.raceLastTickerEvent(live, live.boards[0]);
  assert.ok(event && event.divisionKeys.includes('open-m'));
  const quiet = view.raceSilenceNotice([{ lastReadingAt: at(100) }, { lastReadingAt: at(2000) }], nowAt(2000 + 660));
  assert.equal(quiet, 'Sem leitura há 11 min', 'vale a leitura mais nova entre as ondas da categoria');
  assert.equal(view.raceSilenceNotice([{ lastReadingAt: null }], nowAt(10)), null);
});

test('1.118: com duas categorias, cada passo fica o tempo de mostrar as páginas dela', () => {
  const rows = (count, prefix) => Array.from({ length: count }, (_, index) => ({ athleteKey: `${prefix}${index}`, isLeader: index === 0, position: index + 1, status: 'racing' }));
  const board = (divisionKey, count) => ({ scope: 'division', waveKey: null, waveTitle: null, startedAt: null, divisionKey, divisionName: divisionKey, stages: [], rows: rows(count, divisionKey), battle: null, finalists: [], hasLeaderReading: true });
  const live = { scope: 'division', steps: [{ waveKey: null, divisionKey: 'm' }, { waveKey: null, divisionKey: 'f' }], waves: [], boards: [board('m', 40), board('f', 8)], bests: [], records: [], arrivals: [], ticker: [] };
  const at = (ms) => { const frame = view.raceLiveFrame(live, ms); return [frame.board.divisionKey, frame.pageIndex, frame.pageCount, frame.rows.length]; };
  assert.deepEqual(at(0), ['m', 0, 3, 15]);
  assert.deepEqual(at(8_000), ['m', 1, 3, 15]);
  assert.deepEqual(at(16_000), ['m', 2, 3, 12], 'a terceira página: o líder fixo e os 11 que faltavam');
  assert.deepEqual(at(24_000), ['f', 0, 1, 8], 'a categoria de 40 atletas ficou 24 s; a de 8, 20 s');
  assert.deepEqual(at(44_000), ['m', 0, 3, 15]);
});

test('1.118: a tela e o CSS: torre compacta de 15 linhas, selo da onda, relógios por onda, cartões novos', () => {
  const screen = code('../src/components/broadcast/RaceBroadcastScreen.tsx');
  assert.match(screen, /styles\.dense/);
  assert.match(screen, /'Dif\. para o 1º'/);
  assert.match(screen, /'Atleta · onda'/);
  assert.match(screen, /styles\.twTag/);
  assert.match(screen, /styles\.namePen/);
  assert.match(screen, /styles\.clocks/);
  assert.match(screen, /useLeaderChanges\(/);
  assert.match(screen, /card\.kind === 'newLeader'/);
  assert.match(screen, /card\.kind === 'waves'/);
  assert.match(screen, /entre ondas/);
  assert.match(screen, /se fechar antes de/);
  assert.match(screen, /raceLastTickerEvent\(live, frame\.board\)/);
  assert.doesNotMatch(screen, /\bfetch\(/, 'a tela não consulta o servidor');
  const css = read('../src/components/broadcast/RaceBroadcast.module.css');
  assert.match(css, /\.dense \{ --rowH: 2\.74cqw;/);
  assert.match(css, /\.gapAhead b \{ color: var\(--trading-up\); \}/);
  assert.match(css, /\.cardNewLead/);
});
