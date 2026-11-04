import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createFakeSupabase } from './support/fakeSupabase.mjs';
import { createRaceClient } from './support/fakeRaceSupabase.mjs';
import { BASE_MS, iso } from './support/raceBroadcastScenario.mjs';
import { seedRaceDatabase } from './support/raceBroadcastSeed.mjs';
import { importServerModule, setActiveSupabaseClient } from './support/serverModuleHarness.mjs';

// Story 1.114 (Telão Fitness Race, T4): grid de largada, luzes, bandeirada e roxo.
// A lógica de cada momento sai de funções puras (src/lib/raceBroadcastMoments.ts),
// testadas direto e, em parte, com o payload real do servidor; o fonte da tela é
// conferido por regex, porque o harness não carrega CSS nem React. A conferência
// visual contra a maquete está no Dev Agent Record da story.

process.env.SUPABASE_URL = 'http://supabase.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';
process.env.WODA_SESSION_SECRET = 'segredo-de-teste-telao-race-momentos';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let database = createFakeSupabase();
const client = createRaceClient(() => database, { missingRaceTables: false, beforeUpdate: {}, beforeCount: {} });
setActiveSupabaseClient(client);

const moments = await importServerModule('lib/raceBroadcastMoments.ts');
const view = await importServerModule('lib/raceBroadcastView.ts');
const builder = await importServerModule('lib/serverRaceBroadcast.ts');

const nowAt = (seconds) => BASE_MS + seconds * 1000;

/** O payload real do servidor para o cenário de referência (o que a TV recebe). */
const realPayload = async (seconds, { nowSeconds = seconds, clear = false, ...options } = {}) => {
  const seeded = seedRaceDatabase({ seconds, ...options });
  database = createFakeSupabase(seeded.seed);
  if (clear) for (const table of ['race_heat_marks', 'race_runs', 'race_attempts', 'race_infractions', 'race_decisions', 'scores']) database.rows(table).length = 0;
  return builder.buildRaceBroadcastState(client, database.rows('events')[0], database.rows('event_broadcasts')[0], { nowMs: nowAt(nowSeconds) });
};

// ---------------------------------------------------------------------------
// Payloads sintéticos, só com o que cada função lê
// ---------------------------------------------------------------------------

const base = { eventType: 'fitness_racing', version: 'v', appVersion: '', serverTime: '', event: { name: 'Fitness Race Fortaleza', logoUrl: '', date: '2026-11-14', timeZone: 'America/Fortaleza' }, mode: 'auto' };

const wave = (key, title, startedAtSeconds, over = {}) => ({
  key, title, heatNumber: Number(title.replace(/\D+/g, '')) || null, time: '10:12', startedAt: iso(startedAtSeconds), startedClock: '10:12:05',
  lastReadingAt: null, divisionKeys: ['open-m'], athleteCount: 10, racingCount: 10, ...over
});
const board = (waveKey, waveTitle, divisionKey = 'open-m', divisionName = 'Open Masculino') => ({
  waveKey, waveTitle, divisionKey, divisionName, startedAt: null, stages: [], rows: [], battle: null, finalists: [], hasLeaderReading: false
});
const livePayload = ({ waves, boards, steps, records = [], arrivals = [] }) => ({
  ...base, screen: 'live', next: null, grid: null, class: null, standby: null,
  live: { steps: steps ?? boards.map((item) => ({ waveKey: item.waveKey, divisionKey: item.divisionKey })), waves, boards, bests: [], records, arrivals, ticker: [] }
});
const brief = (key, title, over = {}) => ({ key, title, heatNumber: Number(title.replace(/\D+/g, '')) || null, date: '2026-11-14', time: '10:40', divisionNames: ['Open Masculino'], athleteCount: 10, ...over });
const gridPayload = (key = 'w3', title = 'Onda 3') => ({ ...base, screen: 'grid', next: brief(key, title), live: null, grid: { wave: brief(key, title), athletes: [], courses: [] }, class: null, standby: null });
const classPayload = () => ({ ...base, screen: 'class', next: brief('w4', 'Onda 4'), live: null, grid: null, class: { steps: [], divisions: [], lastWave: null, grid: null }, standby: null });
const standbyPayload = () => ({ ...base, screen: 'standby', next: null, live: null, grid: null, class: null, standby: { upcoming: [] } });

/** Uma onda no ar, com a torre da categoria. */
const onAir = (key, title, startedAtSeconds, divisions = [['open-m', 'Open Masculino']]) => ({
  waves: [wave(key, title, startedAtSeconds)],
  boards: divisions.map(([divisionKey, divisionName]) => board(key, title, divisionKey, divisionName))
});
const mergeLive = (...parts) => livePayload({ waves: parts.flatMap((part) => part.waves), boards: parts.flatMap((part) => part.boards) });

// ---------------------------------------------------------------------------
// AC3: a largada que o telão viu
// ---------------------------------------------------------------------------

test('AC3: a largada vista: onda que a resposta anterior não trazia, largada há menos de 15 s pela hora do servidor', () => {
  const before = gridPayload('w3');
  const after = livePayload(onAir('w3', 'Onda 3', 5));
  assert.deepEqual(moments.detectSeenStart(before, after, nowAt(7)), {
    waveKey: 'w3', waveTitle: 'Onda 3', divisionsText: 'Open Masculino', startedAt: iso(5), placement: 'screen'
  });
  assert.notEqual(moments.detectSeenStart(before, after, nowAt(5 + 14.999)), null, 'com 14,999 s ainda vale');
  assert.equal(moments.detectSeenStart(before, after, nowAt(5 + 15)), null, 'com 15 s não vale mais');
  assert.equal(moments.RACE_LIGHTS_FRESH_MS, 15_000);
});

test('AC3: a TV que volta de uma queda de rede e acha a onda largada há minutos não pisca luz atrasada', () => {
  assert.equal(moments.detectSeenStart(gridPayload('w3'), livePayload(onAir('w3', 'Onda 3', 0)), nowAt(180)), null);
});

test('AC3: nunca na primeira carga, nem para onda que já vinha largada, nem quando o gestor só corrige a largada', () => {
  const live = livePayload(onAir('w3', 'Onda 3', 0));
  assert.equal(moments.detectSeenStart(null, live, nowAt(2)), null, 'primeira carga: TV aberta no meio da onda');
  assert.equal(moments.detectSeenStart(live, livePayload(onAir('w3', 'Onda 3', 0)), nowAt(2)), null, 'a onda já vinha largada');
  const corrected = livePayload(onAir('w3', 'Onda 3', 1.5));
  assert.equal(moments.detectSeenStart(live, corrected, nowAt(2)), null, 'corrigir `started_at` de onda largada não dispara');
});

test('AC3: se o gestor zera a largada (1.107) e larga de novo, as luzes disparam de novo', () => {
  const started = livePayload(onAir('w3', 'Onda 3', 0));
  const reset = gridPayload('w3');
  const again = livePayload(onAir('w3', 'Onda 3', 60));
  assert.equal(moments.detectSeenStart(started, reset, nowAt(30)), null, 'zerar não dispara nada: a tela volta ao grid');
  assert.deepEqual(moments.detectSeenStart(reset, again, nowAt(61)), {
    waveKey: 'w3', waveTitle: 'Onda 3', divisionsText: 'Open Masculino', startedAt: iso(60), placement: 'screen'
  });
});

test('AC3: duas ondas vistas na mesma consulta fazem uma sequência só, para a mais recente', () => {
  const next = mergeLive(onAir('w3', 'Onda 3', 5), onAir('w4', 'Onda 4', 9));
  const seen = moments.detectSeenStart(gridPayload('w3'), next, nowAt(10));
  assert.equal(seen.waveKey, 'w4');
  assert.equal(seen.waveTitle, 'Onda 4');
});

test('AC3: onde as luzes aparecem: cobrem a tela no grid, na classificação e na espera; vão por cima do mapa com o ao vivo de outra onda', () => {
  const next = livePayload(onAir('w3', 'Onda 3', 5));
  assert.equal(moments.detectSeenStart(gridPayload('w3'), next, nowAt(6)).placement, 'screen', 'grid (inclui a primeira onda do dia)');
  assert.equal(moments.detectSeenStart(classPayload(), next, nowAt(6)).placement, 'screen', 'classificação do automático');
  assert.equal(moments.detectSeenStart(standbyPayload(), next, nowAt(6)).placement, 'screen', 'espera do automático');
  const other = livePayload(onAir('w2', 'Onda 2', -600));
  const both = mergeLive(onAir('w2', 'Onda 2', -600), onAir('w3', 'Onda 3', 5));
  const seen = moments.detectSeenStart(other, both, nowAt(6));
  assert.equal(seen.placement, 'map', 'a torre de outra onda está no ar: o painel entra por cima do mapa, nunca da torre');
  assert.equal(seen.waveKey, 'w3', 'a onda que já vinha largada não entra na disputa');
});

test('AC3: sem luzes quando a mesa fixou outra onda, a classificação ou a espera (a tela fixada continua)', () => {
  const pinnedOther = livePayload(onAir('w2', 'Onda 2', -600));
  assert.equal(moments.detectSeenStart(pinnedOther, livePayload(onAir('w2', 'Onda 2', -600)), nowAt(6)), null, 'fixada na onda 2 enquanto a 3 larga: a 3 nem está nos passos');
  assert.equal(moments.detectSeenStart(gridPayload('w3'), classPayload(), nowAt(6)), null, 'fixada na classificação');
  assert.equal(moments.detectSeenStart(gridPayload('w3'), standbyPayload(), nowAt(6)), null, 'fixada na espera');
  const outsideSteps = { ...mergeLive(onAir('w2', 'Onda 2', -600), onAir('w3', 'Onda 3', 5)) };
  outsideSteps.live = { ...outsideSteps.live, steps: outsideSteps.live.steps.filter((step) => step.waveKey === 'w2') };
  assert.equal(moments.detectSeenStart(pinnedOther, outsideSteps, nowAt(6)), null, 'a onda que largou precisa ir ao ar');
});

test('AC3: as categorias da onda que largou vão na mensagem das luzes', () => {
  const next = livePayload(onAir('w4', 'Onda 4', 3, [['open-m', 'Open Masculino'], ['open-f', 'Open Feminino']]));
  const seen = moments.detectSeenStart(gridPayload('w4', 'Onda 4'), next, nowAt(4));
  assert.equal(seen.divisionsText, 'Open Masculino e Open Feminino');
  const lights = moments.raceLightsPlan(false);
  assert.equal(moments.raceLightsMessage(seen, moments.raceLightsFrame(lights, 100)), 'Onda 4 · Open Masculino e Open Feminino');
  assert.equal(moments.raceLightsMessage(seen, moments.raceLightsFrame(lights, 1500)), 'Largada!');
});

test('AC3: o payload real: do grid de uma onda para o ao vivo dela, as luzes cobrem a tela', async () => {
  const before = await realPayload(0, { nowSeconds: -9000, clear: true });
  assert.equal(before.screen, 'grid');
  const after = await realPayload(5);
  assert.equal(after.screen, 'live');
  const seen = moments.detectSeenStart(before, after, nowAt(6));
  assert.deepEqual([seen.waveTitle, seen.divisionsText, seen.placement, seen.startedAt], ['Onda 3', 'Open Masculino', 'screen', iso(0)]);
  assert.equal(moments.detectSeenStart(after, await realPayload(6), nowAt(7)), null, 'a segunda resposta da mesma onda não repete as luzes');
});

// ---------------------------------------------------------------------------
// AC3: a sequência das luzes
// ---------------------------------------------------------------------------

test('AC3: sequência: cinco unidades acendem uma a uma (170 ms), apagam juntas, "Largada!" e o painel sai', () => {
  const plan = moments.raceLightsPlan(false);
  assert.equal(moments.RACE_LIGHTS_UNITS, 5);
  assert.equal(moments.RACE_LIGHTS_STEP_MS, 170);
  assert.deepEqual(plan.litAtMs, [170, 340, 510, 680, 850]);
  assert.deepEqual([plan.offAtMs, plan.endMs], [1400, 2750]);
  const frame = (ms) => moments.raceLightsFrame(plan, ms);
  assert.deepEqual([0, 169, 170, 339, 340, 509, 510, 679, 680, 849, 850, 1399].map((ms) => frame(ms).lit), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  assert.ok([0, 850, 1399].every((ms) => frame(ms).phase === 'lights'));
  assert.deepEqual(frame(1400), { phase: 'go', lit: 0 }, 'apagam juntas e aparece "Largada!"');
  assert.deepEqual(frame(2749), { phase: 'go', lit: 0 });
  assert.deepEqual(frame(2750), { phase: 'done', lit: 0 });
});

test('AC3: com prefers-reduced-motion não há passo a passo: as cinco aparecem e apagam juntas e "Largada!" fica 400 ms', () => {
  const plan = moments.raceLightsPlan(true);
  assert.equal(plan.reduced, true);
  assert.ok(plan.litAtMs.every((at) => at === 0), 'sem passo a passo');
  assert.equal(plan.endMs - plan.offAtMs, 400, '"Largada!" fica 400 ms');
  const frame = (ms) => moments.raceLightsFrame(plan, ms);
  assert.deepEqual([frame(0), frame(499)], [{ phase: 'lights', lit: 5 }, { phase: 'lights', lit: 5 }]);
  assert.deepEqual(frame(500), { phase: 'go', lit: 0 });
  assert.deepEqual(frame(899), { phase: 'go', lit: 0 });
  assert.deepEqual(frame(900), { phase: 'done', lit: 0 });
});

// ---------------------------------------------------------------------------
// AC4: bandeirada
// ---------------------------------------------------------------------------

const arrival = (key, finishSeconds, over = {}) => ({
  athleteKey: key, name: `Atleta ${key}`, box: `Box ${key}`, divisionKey: 'open-m', divisionName: 'Open Masculino', waveKey: 'w3',
  finishAt: iso(finishSeconds), finishClock: '11:19:00', finalSeconds: finishSeconds, finalText: '', position: 1, penaltySeconds: 0, holds: [], ...over
});

test('AC4: uma chegada vale enquanto o `finish_at` está nos últimos 30 s pela hora do servidor', () => {
  const state = moments.RACE_FLAG_INITIAL;
  const next = moments.nextRaceFlagState(state, [arrival('a', 4015)], nowAt(4045));
  assert.equal(next.current.arrival.athleteKey, 'a', 'com 30 s ainda vale');
  assert.equal(moments.nextRaceFlagState(state, [arrival('a', 4015)], nowAt(4045.001)), state, 'com mais de 30 s não entra na fila e o estado nem muda');
  assert.equal(moments.RACE_FLAG_WINDOW_MS, 30_000);
});

test('AC4: recarregar a TV depois da janela não repete a bandeirada; dentro dela, mostra uma vez', () => {
  const state = moments.RACE_FLAG_INITIAL;
  assert.equal(moments.nextRaceFlagState(state, [arrival('a', 3982), arrival('b', 4015)], nowAt(4615)), state, '10 min depois: nada');
  const reopened = moments.nextRaceFlagState(state, [arrival('a', 3982), arrival('b', 4015)], nowAt(4020));
  assert.equal(reopened.current.arrival.athleteKey, 'b', 'a de 38 s atrás já saiu da janela; a de 5 s entra');
  assert.deepEqual(reopened.seen, ['b']);
});

test('AC4: chegadas seguidas entram em fila por instante: 4,5 s quando há outra esperando e 6,5 s a última', () => {
  const arrivals = [arrival('b', 4015), arrival('a', 4010), arrival('c', 4012)];
  const t0 = nowAt(4016);
  let state = moments.nextRaceFlagState(moments.RACE_FLAG_INITIAL, arrivals, t0);
  assert.deepEqual([state.current.arrival.athleteKey, state.current.until - t0, state.queue.map((item) => item.athleteKey)], ['a', 4_500, ['c', 'b']], 'a mais antiga primeiro, com outras na fila');
  state = moments.nextRaceFlagState(state, arrivals, t0 + 4_499);
  assert.equal(state.current.arrival.athleteKey, 'a', 'ainda não venceu');
  state = moments.nextRaceFlagState(state, arrivals, t0 + 4_500);
  assert.deepEqual([state.current.arrival.athleteKey, state.current.until - (t0 + 4_500), state.queue.map((item) => item.athleteKey)], ['c', 4_500, ['b']]);
  state = moments.nextRaceFlagState(state, arrivals, t0 + 9_000);
  assert.deepEqual([state.current.arrival.athleteKey, state.current.until - (t0 + 9_000), state.queue.length], ['b', 6_500, 0], 'a última da fila fica 6,5 s');
  assert.equal(moments.RACE_FLAG_MS, 6_500);
  assert.equal(moments.RACE_FLAG_QUEUED_MS, 4_500);
  state = moments.nextRaceFlagState(state, arrivals, t0 + 15_500);
  assert.equal(state.current, null, 'venceu');
  assert.equal(state.last.athleteKey, 'b', 'a última fica para a saída com transição');
  assert.equal(moments.nextRaceFlagState(state, arrivals, t0 + 16_000), state, 'ninguém aparece duas vezes na mesma abertura, e o estado não muda à toa');
});

test('AC4: chegada nova durante a bandeirada espera a atual vencer', () => {
  const t0 = nowAt(4016);
  let state = moments.nextRaceFlagState(moments.RACE_FLAG_INITIAL, [arrival('a', 4015)], t0);
  assert.equal(state.current.until - t0, 6_500);
  state = moments.nextRaceFlagState(state, [arrival('a', 4015), arrival('b', 4017)], t0 + 2_000);
  assert.deepEqual([state.current.arrival.athleteKey, state.queue.map((item) => item.athleteKey)], ['a', ['b']]);
  state = moments.nextRaceFlagState(state, [arrival('a', 4015), arrival('b', 4017)], t0 + 6_500);
  assert.deepEqual([state.current.arrival.athleteKey, state.current.until - (t0 + 6_500)], ['b', 6_500]);
});

test('AC4: duas respostas com a mesma chegada, ou a mesma chave repetida, entram uma vez', () => {
  const state = moments.nextRaceFlagState(moments.RACE_FLAG_INITIAL, [arrival('a', 4015), arrival('a', 4015)], nowAt(4016));
  assert.deepEqual([state.seen, state.queue.length, state.current.arrival.athleteKey], [['a'], 0, 'a']);
});

test('AC4: o texto da bandeirada: posição, nome, box e categoria, tempo final com os segundos de penalidade e o melhor da categoria', () => {
  const flag = moments.describeRaceFlag(arrival('a', 4015, { finishClock: '10:26:29', position: 3, penaltySeconds: 15, holds: [{ stationName: 'Wall Balls', seconds: 345 }] }), 'Onda 3');
  assert.deepEqual(flag, {
    eyebrow: 'Chegada · Onda 3 · 10:26:29',
    position: '3º',
    positionCaption: 'na categoria até agora',
    name: 'Atleta a',
    who: 'Box a · Open Masculino',
    time: '1:06:55',
    timeCaption: 'Tempo final · inclui +15 s de penalidade',
    best: 'Melhor da categoria: Wall Balls 5:45'
  });
  const plain = moments.describeRaceFlag(arrival('a', 3982, { position: null }), null);
  assert.deepEqual([plain.eyebrow, plain.position, plain.timeCaption, plain.best], ['Chegada · 11:19:00', '–', 'Tempo final', ''], 'sem resultado publicado a posição é "–"; sem roxo, sem a linha');
  assert.equal(moments.describeRaceFlag(arrival('a', 3982), 'Onda 3').timeCaption, 'Tempo final', 'sem penalidade, sem "inclui"');
});

test('AC4: com mais de um roxo, a linha traz o mais novo e conta quantos mais há (T4-7)', () => {
  const holds = [{ stationName: 'Sled Pull', seconds: 227 }, { stationName: 'Sled Push', seconds: 171 }, { stationName: 'Wall Balls', seconds: 345 }];
  const item = arrival('bruno', 4015, { holds });
  const record = (stationName, at) => ({ athleteKey: 'bruno', stationName, at: at === null ? null : iso(at), seconds: 1, divisionKey: 'open-m' });
  const records = [record('Sled Push', 924), record('Sled Pull', 1418), record('Wall Balls', 4015), { ...record('Wall Balls', 5000), athleteKey: 'outro' }];
  assert.equal(moments.describeRaceFlag(item, 'Onda 3', records).best, 'Melhor da categoria: Wall Balls 5:45 e mais 2', 'o instante mais novo é o de Wall Balls');
  assert.equal(moments.describeRaceFlag(item, 'Onda 3', []).best, 'Melhor da categoria: Sled Pull 3:47 e mais 2', 'sem instantes, a ordem do payload');
});

test('AC4: o título da bandeirada diz a onda da chegada, que pode não ser a do passo no ar', () => {
  const live = mergeLive(onAir('w3', 'Onda 3', 0), onAir('w4', 'Onda 4', 10)).live;
  assert.equal(moments.raceArrivalWaveTitle(live, { waveKey: 'w4' }), 'Onda 4');
  assert.equal(moments.raceArrivalWaveTitle(live, { waveKey: 'w9' }), null);
  assert.equal(moments.raceArrivalWaveTitle(live, { waveKey: null }), null);
  const onlyBoard = { waves: [], boards: [board('w5', 'Onda 5')] };
  assert.equal(moments.raceArrivalWaveTitle(onlyBoard, { waveKey: 'w5' }), 'Onda 5');
});

test('AC4: o payload real: a chegada de Bruno entra na janela, a de Rafael (38 s) já saiu, e o texto confere', async () => {
  const payload = await realPayload(4020);
  const state = moments.nextRaceFlagState(moments.RACE_FLAG_INITIAL, payload.live.arrivals, nowAt(4020));
  assert.equal(state.current.arrival.name, 'Bruno Sampaio');
  assert.equal(state.queue.length, 0);
  const flag = moments.describeRaceFlag(state.current.arrival, moments.raceArrivalWaveTitle(payload.live, state.current.arrival), payload.live.records);
  assert.deepEqual(
    [flag.eyebrow, flag.position, flag.who, flag.time, flag.timeCaption, flag.best],
    ['Chegada · Onda 3 · 11:19:00', '3º', 'CT Meireles · Open Masculino', '1:06:55', 'Tempo final', 'Melhor da categoria: Wall Balls 5:45 e mais 2']
  );
});

// ---------------------------------------------------------------------------
// AC5: roxo de melhor estação
// ---------------------------------------------------------------------------

const record = (over = {}) => ({
  divisionKey: 'open-m', stationId: 'sandbag-lunges', stationKey: 'sandbag-lunges', stationName: 'Sandbag Lunges', seconds: 253, athleteKey: 'thiago',
  name: 'Thiago Bezerra', box: 'Box Iracema', waveTitle: 'Onda 3', at: iso(3587),
  previous: { seconds: 261, name: 'Bruno Sampaio', box: 'CT Meireles', waveTitle: 'Onda 3' }, ...over
});

test('AC5: a linha da torre e o marcador ficam roxos por 9 s a partir do instante do recorde', () => {
  const records = [record()];
  assert.equal(moments.racePurpleByAthlete(records, nowAt(3587 + 8.999)).get('thiago').stationName, 'Sandbag Lunges');
  assert.equal(moments.racePurpleByAthlete(records, nowAt(3587 + 9)).size, 0, 'aos 9 s acaba');
  assert.equal(moments.racePurpleByAthlete(records, nowAt(3587 + 600)).size, 0, 'TV reaberta depois do tempo não pisca');
  assert.equal(moments.racePurpleByAthlete([record({ at: null })], nowAt(3590)).size, 0, 'recorde sem instante (split publicado) nunca é roxo');
  const two = [record({ stationName: 'Row', at: iso(3580), seconds: 220 }), record({ stationName: 'Sandbag Lunges', at: iso(3587) })];
  assert.equal(moments.racePurpleByAthlete(two, nowAt(3589)).get('thiago').stationName, 'Sandbag Lunges', 'dois recordes do mesmo atleta: vale o mais novo');
  assert.equal(moments.RACE_PURPLE_ROW_MS, 9_000);
  assert.equal(moments.RACE_PURPLE_CARD_MS, 11_000);
});

test('AC5: o texto da linha roxa: "{ESTAÇÃO}" e "melhor da categoria · m:ss", só para quem ainda corre', () => {
  const where = { tone: 'station', main: 'Sandbag Lunges 2/4', sub: 'na estação', parts: { name: 'Sandbag Lunges', progress: '2/4', subText: 'na estação', counter: '' } };
  const purple = moments.withRacePurple(where, { status: 'racing' }, record());
  assert.deepEqual([purple.tone, purple.main, purple.sub], ['purple', 'Sandbag Lunges', 'melhor da categoria · 4:13']);
  assert.deepEqual(purple.parts, { name: 'Sandbag Lunges', progress: '', subText: 'melhor da categoria', counter: '4:13' });
  assert.equal(moments.withRacePurple(where, { status: 'finished' }, record()), where, 'quem chegou mostra a chegada');
  assert.equal(moments.withRacePurple(where, { status: 'dnf' }, record()), where, 'DNF mostra o DNF');
  assert.equal(moments.withRacePurple(where, { status: 'racing' }, undefined), where, 'sem roxo, nada muda');
});

test('AC5: o marcador do mapa fica roxo só para quem tem roxo em curso; o líder segue amarelo', () => {
  const row = (key, over = {}) => ({ athleteKey: key, name: key, box: '', position: 1, status: 'racing', isLeader: false, slot: 2, slotEstimated: false, ...over });
  const markers = view.raceBoardMarkers({ rows: [row('lider', { isLeader: true }), row('thiago', { position: 2 }), row('caio', { position: 3 }), row('chegou', { status: 'finished' })] }, new Set(['thiago', 'chegou']));
  assert.deepEqual(markers.map((marker) => [marker.key, marker.purple, marker.leader]), [['lider', false, true], ['thiago', true, false], ['caio', false, false]], 'quem chegou sai do mapa, mesmo com roxo');
  assert.equal(view.raceBoardMarkers({ rows: [row('lider')] }).every((marker) => marker.purple === false), true, 'sem conjunto, ninguém é roxo');
});

test('AC5: o cartão A do roxo: 11 s, com a estação, o tempo, "nome · box" e o tempo de antes', () => {
  const live = { records: [record()], boards: [board('w3', 'Onda 3')] };
  const frame = { board: board('w3', 'Onda 3'), wave: wave('w3', 'Onda 3', 0) };
  assert.deepEqual(moments.describeRacePurpleCard(live, frame, nowAt(3590)), {
    kind: 'purple', eyebrow: 'Melhor da categoria · roxo', station: 'Sandbag Lunges', time: '4:13', who: 'Thiago Bezerra · Box Iracema', was: 'Antes: 4:21 · Bruno Sampaio (Onda 3)'
  });
  assert.notEqual(moments.describeRacePurpleCard(live, frame, nowAt(3587 + 10.999)), null, 'aos 10,999 s ainda vale');
  assert.equal(moments.describeRacePurpleCard(live, frame, nowAt(3587 + 11)), null, 'aos 11 s acaba');
  const first = moments.describeRacePurpleCard({ ...live, records: [record({ previous: null })] }, frame, nowAt(3590));
  assert.equal(first.was, 'Primeiro tempo da categoria nesta estação');
  const noWave = moments.describeRacePurpleCard({ ...live, records: [record({ previous: { seconds: 261, name: 'Bruno Sampaio', box: '', waveTitle: '' } })] }, frame, nowAt(3590));
  assert.equal(noWave.was, 'Antes: 4:21 · Bruno Sampaio', 'sem onda conhecida, sem parênteses');
  const newest = moments.describeRacePurpleCard({ ...live, records: [record({ stationName: 'Row', at: iso(3585), seconds: 220 }), record()] }, frame, nowAt(3590));
  assert.equal(newest.station, 'Sandbag Lunges', 'dois recordes em curso: o mais novo');
});

test('AC5: o roxo tem prioridade no cartão A sobre a disputa, a onda sem leitura e o líder; passado o tempo, volta a prioridade da 1.113', async () => {
  const payload = await realPayload(3590);
  const frame = view.raceLiveFrame(payload.live, nowAt(3590));
  const card = moments.describeRaceCardAWithPurple(payload.live, frame, nowAt(3590));
  assert.deepEqual([card.kind, card.station, card.time, card.who, card.was], ['purple', 'Sandbag Lunges', '4:13', 'Thiago Bezerra · Box Iracema', 'Antes: 4:21 · Bruno Sampaio (Onda 3)']);
  assert.ok(['battle', 'leader'].includes(view.describeRaceCardA(frame.board, frame.wave, nowAt(3590)).kind), 'embaixo continua a prioridade da 1.113');
  const later = moments.describeRaceCardAWithPurple(payload.live, frame, nowAt(3590 + 30));
  assert.ok(['battle', 'leader', 'waiting'].includes(later.kind), 'depois de 11 s, o cartão volta à disputa ou ao líder');
  const waiting = { ...frame, board: { ...frame.board, hasLeaderReading: false, battle: null } };
  assert.equal(moments.describeRaceCardAWithPurple(payload.live, waiting, nowAt(3590)).kind, 'purple', 'também sobre "aguardando a primeira leitura"');
});

test('AC5: com rodízio, o cartão do roxo entra no passo no ar, com a onda e a categoria no título quando forem outras', () => {
  const live = mergeLive(onAir('w3', 'Onda 3', 0), onAir('w4', 'Onda 4', 600, [['open-f', 'Open Feminino']])).live;
  const feminine = record({ divisionKey: 'open-f', waveTitle: 'Onda 4', athleteKey: 'ana', name: 'Ana Paula Lima', box: 'Box Centro', previous: null });
  const withRecord = { ...live, records: [feminine] };
  const masculineStep = { board: live.boards[0], wave: live.waves[0] };
  const feminineStep = { board: live.boards[1], wave: live.waves[1] };
  assert.equal(moments.describeRacePurpleCard(withRecord, masculineStep, nowAt(3590)).eyebrow, 'Melhor da categoria · roxo · Onda 4 · Open Feminino', 'o passo no ar é outro: a onda e a categoria no título');
  assert.equal(moments.describeRacePurpleCard(withRecord, feminineStep, nowAt(3590)).eyebrow, 'Melhor da categoria · roxo', 'o passo é o do atleta: título limpo');
  const sameWaveOtherDivision = moments.describeRacePurpleCard({ ...withRecord, records: [{ ...feminine, waveTitle: 'Onda 3' }] }, masculineStep, nowAt(3590));
  assert.equal(sameWaveOtherDivision.eyebrow, 'Melhor da categoria · roxo · Onda 3 · Open Feminino', 'mesma onda, outra categoria: a categoria também entra');
  // A linha e o marcador roxos só existem na torre do próprio atleta: os do passo no ar não o têm.
  const purple = moments.racePurpleByAthlete([feminine], nowAt(3590));
  const markers = view.raceBoardMarkers({ rows: [{ athleteKey: 'caio', name: 'Caio', box: '', position: 1, status: 'racing', isLeader: true, slot: 1, slotEstimated: false }] }, new Set(purple.keys()));
  assert.equal(markers[0].purple, false);
});

test('AC5: o payload real: a linha, o marcador e o cartão do roxo de Thiago aparecem aos 3 s e somem depois do tempo', async () => {
  const payload = await realPayload(3590);
  const frame = view.raceLiveFrame(payload.live, nowAt(3590));
  const purple = moments.racePurpleByAthlete(payload.live.records, nowAt(3590));
  const thiago = frame.board.rows.find((row) => row.name === 'Thiago Bezerra');
  assert.equal(purple.size, 1);
  assert.equal(purple.has(thiago.athleteKey), true);
  const where = moments.withRacePurple(view.describeRaceWhere(thiago, view.raceClosingStationId(frame.board), nowAt(3590)), thiago, purple.get(thiago.athleteKey));
  assert.deepEqual([where.tone, where.main, where.sub], ['purple', 'Sandbag Lunges', 'melhor da categoria · 4:13']);
  assert.equal(view.raceBoardMarkers(frame.board, new Set(purple.keys())).filter((marker) => marker.purple).length, 1);
  assert.equal(moments.racePurpleByAthlete(payload.live.records, nowAt(3590 + 9)).size, 0);
});

// ---------------------------------------------------------------------------
// AC2: grid de largada
// ---------------------------------------------------------------------------

const gridOf = (athletes, over = {}) => ({
  wave: brief('w3', 'Onda 3', { time: '10:12', divisionNames: ['Open Masculino'], athleteCount: athletes.length }),
  athletes,
  courses: [{ divisionKey: 'open-m', divisionName: 'Open Masculino', stages: [{ id: 'run-1', key: null, name: 'Corrida 1', type: 'run', kind: null, target: '1000m', load: '', closesTime: false, semJudge: false }, { id: 'sled-push', key: 'sled-push', name: 'Sled Push', type: 'station', kind: 'sled', target: '4 trechos · 50m', load: '152kg', closesTime: false, semJudge: false }, { id: 'ski-erg', key: 'ski-erg', name: 'Ski Erg', type: 'station', kind: 'ergometer', target: '1000m', load: '', closesTime: false, semJudge: false }] }],
  ...over
});
const people = (count, divisionKey = 'open-m', divisionName = 'Open Masculino', from = 0) => Array.from({ length: count }, (_, index) => ({ key: `k${from + index}`, name: `Atleta ${from + index + 1}`, box: `Box ${from + index + 1}`, divisionKey, divisionName }));

test('AC2: o grid: título, onda, resumo, vagas numeradas na ordem do cronograma, hora prevista, percurso e rodapé', () => {
  const frame = moments.raceGridFrame(gridOf(people(10)), nowAt(0));
  assert.deepEqual([frame.title, frame.heading, frame.summary], ['Grid de largada · Onda 3', 'Onda 3', 'Open Masculino · 10 atletas · ordem do cronograma']);
  assert.deepEqual(frame.slots.map((slot) => slot.number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(frame.slots[0], { number: 1, name: 'Atleta 1', box: 'Box 1', division: 'Open Masculino' });
  assert.deepEqual([frame.pageIndex, frame.pageCount, frame.showDivision], [0, 1, false]);
  assert.deepEqual(frame.when, { label: 'Largada prevista', time: '10:12', hint: 'Aguardando o sinal do organizador' });
  assert.deepEqual(frame.course, { label: 'Percurso', stations: [{ name: 'Sled Push', meta: '4 trechos · 50m · 152kg' }, { name: 'Ski Erg', meta: '1000m' }] });
  assert.deepEqual(frame.footer, { label: 'Largada', text: 'Onda 3 · prevista 10:12 · o relógio começa no sinal do organizador' });
  assert.equal(moments.raceGridFrame(gridOf(people(1)), nowAt(0)).summary, 'Open Masculino · 1 atleta · ordem do cronograma', 'singular');
});

test('AC2: sem horário no cronograma, a largada não inventa hora', () => {
  const grid = gridOf(people(2));
  grid.wave = { ...grid.wave, time: '' };
  const frame = moments.raceGridFrame(grid, nowAt(0));
  assert.deepEqual(frame.when, { label: 'Largada', time: '', hint: 'Aguardando o sinal do organizador' });
  assert.equal(frame.footer.text, 'Onda 3 · o relógio começa no sinal do organizador');
});

test('AC2: onda com mais de 10 atletas alterna páginas de 8 s no grid sozinho, e a numeração segue', () => {
  const grid = gridOf(people(14));
  const frameAt = (ms) => moments.raceGridFrame(grid, ms);
  const first = frameAt(8_000 * 10 + 1);
  const second = frameAt(8_000 * 11 + 1);
  assert.deepEqual([first.pageIndex, first.pageCount, first.slots.length, first.slots[0].number, first.slots[9].number], [0, 2, 10, 1, 10]);
  assert.deepEqual([second.pageIndex, second.slots.length, second.slots[0].number, second.slots[3].number, second.slots[0].name], [1, 4, 11, 14, 'Atleta 11']);
  assert.deepEqual(frameAt(8_000 * 10 + 1), frameAt(8_000 * 10 + 7_999), 'a mesma página durante os 8 s (e a mesma em duas TVs)');
  assert.equal(frameAt(8_000 * 12 + 1).pageIndex, 0, 'volta à primeira');
  assert.equal(moments.raceGridFrame(gridOf(people(0)), nowAt(0)).pageCount, 1, 'sem atleta, uma página vazia e sem erro');
});

test('AC2: na alternância com a classificação, o grid mostra a página que o passo de 12 s indica', () => {
  const grid = gridOf(people(14));
  const steps = [{ kind: 'class', divisionKey: 'open-m', page: 0, pageCount: 1 }, { kind: 'grid', waveKey: 'w3', page: 0, pageCount: 2 }, { kind: 'grid', waveKey: 'w3', page: 1, pageCount: 2 }];
  const cls = { steps, grid };
  const at = (step) => moments.raceClassGridFrame(cls, 12_000 * (30 + step) + 500);
  assert.equal(at(0), null, 'o passo da classificação não mostra o grid');
  assert.deepEqual([at(1).pageIndex, at(1).slots[0].number, at(1).slots.length], [0, 1, 10]);
  assert.deepEqual([at(2).pageIndex, at(2).slots[0].number, at(2).slots.length], [1, 11, 4]);
  assert.equal(at(3), null, 'volta à classificação');
  assert.equal(moments.raceClassGridFrame({ steps, grid: null }, 12_000 * 31), null, 'sem grid, nada');
  assert.equal(moments.raceClassGridFrame({ steps: [], grid }, 12_000 * 31), null, 'sem passos, nada');
  assert.equal(moments.raceGridFrame(grid, 0, 99).pageIndex, 1, 'página fora do intervalo vira a última');
  assert.equal(moments.raceGridFrame(grid, 0, -3).pageIndex, 0, 'e nunca negativa');
});

test('AC2: onda com mais de uma categoria: a categoria em cada linha; o percurso alterna a cada 12 s só quando os percursos diferem', () => {
  const masculine = people(3);
  const feminine = people(2, 'open-f', 'Open Feminino', 3);
  const stages = (loadText) => gridOf([]).courses[0].stages.map((stage) => (stage.id === 'sled-push' ? { ...stage, load: loadText } : stage));
  const same = gridOf([...masculine, ...feminine], {
    wave: brief('w3', 'Onda 3', { divisionNames: ['Open Masculino', 'Open Feminino'], athleteCount: 5 }),
    courses: [{ divisionKey: 'open-m', divisionName: 'Open Masculino', stages: stages('152kg') }, { divisionKey: 'open-f', divisionName: 'Open Feminino', stages: stages('152kg') }]
  });
  const frame = moments.raceGridFrame(same, nowAt(0));
  assert.equal(frame.showDivision, true);
  assert.equal(frame.summary, 'Open Masculino e Open Feminino · 5 atletas · ordem do cronograma');
  assert.deepEqual(frame.slots.map((slot) => slot.division), ['Open Masculino', 'Open Masculino', 'Open Masculino', 'Open Feminino', 'Open Feminino']);
  assert.equal(frame.course.label, 'Percurso', 'percursos iguais: uma lista só, sem alternar');
  assert.equal(moments.raceGridFrame(same, 12_000 * 7 + 1).course.label, 'Percurso');

  const different = { ...same, courses: [{ divisionKey: 'open-m', divisionName: 'Open Masculino', stages: stages('152kg') }, { divisionKey: 'open-f', divisionName: 'Open Feminino', stages: stages('102kg') }] };
  const courseAt = (step) => moments.raceGridFrame(different, 12_000 * step + 500).course;
  assert.equal(courseAt(10).label, 'Percurso · Open Masculino');
  assert.equal(courseAt(11).label, 'Percurso · Open Feminino');
  assert.equal(courseAt(12).label, 'Percurso · Open Masculino');
  assert.equal(courseAt(10).stations[0].meta, '4 trechos · 50m · 152kg');
  assert.equal(courseAt(11).stations[0].meta, '4 trechos · 50m · 102kg');
  assert.equal(moments.raceGridFrame(gridOf(people(1), { courses: [] }), nowAt(0)).course.stations.length, 0, 'sem percurso, a lista fica vazia sem erro');
});

test('AC2: o payload real do grid: vagas da onda fixada, hora prevista do cronograma, percurso com meta e carga', async () => {
  const payload = await realPayload(0, { nowSeconds: -9000, clear: true, mode: 'pin_heat', pinnedHeat: 'w3' });
  assert.equal(payload.screen, 'grid');
  const frame = moments.raceGridFrame(payload.grid, nowAt(-9000));
  assert.deepEqual([frame.title, frame.summary, frame.when.time, frame.footer.text], [
    'Grid de largada · Onda 3', 'Open Masculino · 10 atletas · ordem do cronograma', '10:12', 'Onda 3 · prevista 10:12 · o relógio começa no sinal do organizador'
  ]);
  assert.deepEqual(frame.slots.slice(0, 2).map((slot) => [slot.number, slot.name, slot.box]), [[1, 'Rafael Tavares', 'Box Aldeota'], [2, 'Bruno Sampaio', 'CT Meireles']]);
  assert.deepEqual(frame.course.stations.map((station) => station.name), ['Ski Erg', 'Sled Push', 'Sled Pull', 'Burpee Broad Jump', 'Row', 'Farmers Carry', 'Sandbag Lunges', 'Wall Balls']);
  assert.deepEqual(frame.course.stations.map((station) => station.meta), ['1000m', '4 trechos · 50m · 152kg', '4 trechos · 50m · 103kg', '80m', '1000m', '200m · 2x24kg', '4 voltas · 100m · 20kg', '100 reps · 9kg']);
});

// ---------------------------------------------------------------------------
// AC1, AC6: fonte das telas e do módulo
// ---------------------------------------------------------------------------

test('AC1: o telão só lê: nenhum botão, rota ou ação de largada, nem requisição, nas telas dos momentos', () => {
  for (const path of ['../src/components/broadcast/RaceBroadcastScreen.tsx', '../src/lib/raceBroadcastMoments.ts']) {
    const source = code(path);
    assert.doesNotMatch(source, /start_heat|adjust_heat_start|reset_heat|\/api\/race-sheets|\/api\/admin/, `${path}: nada que largue ou mexa em onda`);
    assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|EventSource|WebSocket/, `${path}: sem requisição`);
    assert.doesNotMatch(source, /Date\.now\(\)/, `${path}: a hora vem do servidor, por parâmetro`);
    assert.doesNotMatch(source, /\.(email|phone|birth\w*|instagram|city|team_?members|athlete_?id|run_?id|attempt_?id|user_?id|registration_?id|judge\w*|infraction\w*|reason|note|createdBy|author)\b/i, `${path}: nenhum campo de pessoa, id interno ou motivo`);
  }
  const screen = code('../src/components/broadcast/RaceBroadcastScreen.tsx');
  assert.equal((screen.match(/<button\b/g) || []).length, 1, 'o único botão é o de tela cheia');
  assert.match(screen, /<button type="button" className=\{styles\.fullscreen\} onClick=\{toggleFullscreen\}>/);
});

test('AC1: o módulo dos momentos é puro (só tipos e funções do motor e da visão) e a tela cita a maquete', () => {
  const imports = [...code('../src/lib/raceBroadcastMoments.ts').matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]).sort();
  assert.deepEqual(imports, ['@/lib/raceBroadcast', '@/lib/raceBroadcastPayload', '@/lib/raceBroadcastView'], 'nenhum import de servidor, react ou rede');
  assert.match(read('../src/lib/raceBroadcastMoments.ts'), /docs\/design\/telao-fitness-race\//);
  const screen = read('../src/components/broadcast/RaceBroadcastScreen.tsx');
  assert.match(screen, /docs\/design\/telao-fitness-race\//);
  assert.match(screen, /raceBroadcastMoments/);
  assert.doesNotMatch(code('../src/lib/raceBroadcastMoments.ts'), /predict|forecast|projected|pace\b|ritmo|ultrapassagem|runSeconds|roxzone/i, 'nada de previsão de resultado (Regra 8)');
});

test('AC1: movimento reduzido: a tela lê `prefers-reduced-motion` para as luzes e o CSS desliga as animações do painel, da bandeirada e do roxo', () => {
  const screen = code('../src/components/broadcast/RaceBroadcastScreen.tsx');
  assert.match(screen, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
  assert.match(screen, /raceLightsPlan\(reduced\)/);
  const css = read('../src/components/broadcast/RaceBroadcast.module.css');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /animation: none !important/);
  const fontSizes = [...css.matchAll(/font-size:\s*([^;}]+)[;}]/g)].map((match) => match[1].trim());
  assert.ok(fontSizes.every((value) => /^[\d.]+cqw$/.test(value)), 'todo texto em cqw');
  assert.match(css, /--purple: #b47cff/, 'o roxo da maquete, só para o melhor da categoria');
  assert.match(css, /--lamp: #ff2d2d/);
  assert.match(css, /\.flagStrip/);
  assert.match(css, /\.lightsOv/);
});

test('AC1: o painel das luzes e a bandeirada não são lidos por leitor de tela e não tomam o foco', () => {
  const screen = code('../src/components/broadcast/RaceBroadcastScreen.tsx');
  assert.match(screen, /styles\.lightsOv[\s\S]{0,200}aria-hidden="true"/, 'painel das luzes com aria-hidden');
  assert.match(screen, /styles\.flag[\s\S]{0,160}aria-hidden=/, 'bandeirada com aria-hidden');
  assert.match(screen, /aria-live="off"/, 'a tela de baixo segue com aria-live="off"');
  assert.doesNotMatch(screen, /tabIndex|autoFocus/, 'nada de foco');
});

test('AC2: o grid entra sozinho (`grid`) e na alternância com a classificação, pelo passo de 12 s; o corpo do grid é reaproveitável', () => {
  const screen = code('../src/components/broadcast/RaceBroadcastScreen.tsx');
  assert.match(screen, /payload\.screen === 'grid' && payload\.grid\s*\? raceGridFrame\(payload\.grid, now\)/);
  assert.match(screen, /payload\.screen === 'class' && payload\.class \? raceClassGridFrame\(payload\.class, now\) : null/);
  assert.match(screen, /export function RaceGridBody\(\{ frame \}: \{ frame: RaceGridFrame \}\)/, 'a 1.115 reaproveita o corpo do grid');
  assert.match(screen, /gridFrame \|\| payload\.screen === 'grid'\) pill = \{ text: 'GRID'/, 'pílula GRID nas duas entradas');
  assert.match(screen, /<RaceGridBody frame=\{gridFrame\} \/>/);
  // As luzes apagadas do grid são as mesmas cinco unidades do painel.
  assert.match(screen, /<Gantry lit=\{0\} \/>/);
  assert.match(screen, /RACE_LIGHTS_UNITS/);
});
