import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createFakeSupabase } from './support/fakeSupabase.mjs';
import { createRaceClient } from './support/fakeRaceSupabase.mjs';
import { BASE_MS, iso } from './support/raceBroadcastScenario.mjs';
import { EVENT_ID, athleteId, attemptId, runId, seedRaceDatabase } from './support/raceBroadcastSeed.mjs';
import { importServerModule, setActiveSupabaseClient } from './support/serverModuleHarness.mjs';

// Story 1.113 (Telão Fitness Race, T3): a tela ao vivo. Os textos e números saem de
// funções puras (src/lib/raceBroadcastView.ts), testadas direto; o fonte da tela é
// conferido por regex, porque o harness não carrega CSS nem React. A conferência
// visual contra a maquete está no Dev Agent Record da story.

process.env.SUPABASE_URL = 'http://supabase.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';
process.env.WODA_SESSION_SECRET = 'segredo-de-teste-telao-race-tela';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let database = createFakeSupabase();
const client = createRaceClient(() => database, { missingRaceTables: false, beforeUpdate: {}, beforeCount: {} });
setActiveSupabaseClient(client);

const view = await importServerModule('lib/raceBroadcastView.ts');
const builder = await importServerModule('lib/serverRaceBroadcast.ts');

const nowAt = (seconds) => BASE_MS + seconds * 1000;

/**
 * O payload real do servidor para o cenário de referência (o mesmo que a TV recebe). A torre de uma
 * onda é a da mesa ("Fixar uma onda") desde o ranking único (Story 1.116, R4): estes testes fixam a
 * Onda 3; a torre da categoria tem os testes em race-broadcast-ranking-screen.test.mjs.
 */
const payloadAt = async (seconds, options = {}, mutate) => {
  const seeded = seedRaceDatabase({ seconds, mode: 'pin_heat', pinnedHeat: 'w3', ...options });
  database = createFakeSupabase(seeded.seed);
  if (mutate) mutate(database);
  return builder.buildRaceBroadcastState(client, database.rows('events')[0], database.rows('event_broadcasts')[0], { nowMs: nowAt(options.nowSeconds ?? seconds) });
};

const row = (over = {}) => ({
  athleteKey: 'k1', name: 'Atleta Um', box: 'Box Um', position: 1, status: 'racing', isLeader: false,
  where: { kind: 'track', afterStationId: null, afterStationName: null, sinceAt: null, closedWithoutTime: false },
  slot: 0, slotEstimated: true, point: null, pointAt: null, gapSeconds: null, finalSeconds: null, finalText: null, finishedBy: null,
  penaltySeconds: 0, lastPenalty: null, ...over
});
const atStation = (over = {}) => ({
  kind: 'station', stationId: 'sled-pull', stationKey: 'sled-pull', stationName: 'Sled Pull', stationKind: 'sled', waiting: false,
  startedAt: iso(100), progress: { type: 'units', unit: 'trecho', done: 2, target: 4 }, ...over
});

// ---------------------------------------------------------------------------
// Formatação única de tempo (Regra 4) e cadência da consulta (AC2)
// ---------------------------------------------------------------------------

test('AC5: uma função só formata tempo e diferença: m:ss, h:mm:ss, segundo mais próximo, nunca trunca', () => {
  const f = view.formatRaceTime;
  assert.deepEqual([0, 5, 59.4, 59.5, 60, 61, 3599.4, 3599.5, 3982, 4015, 3661].map(f), ['0:00', '0:05', '0:59', '1:00', '1:00', '1:01', '59:59', '1:00:00', '1:06:22', '1:06:55', '1:01:01']);
  assert.deepEqual([Number.NaN, -3, Infinity, -Infinity].map(f), ['0:00', '0:00', '0:00', '0:00'], 'inválido ou negativo vira 0:00');
  const clock = view.formatRaceRunningClock;
  assert.deepEqual([0, 5, 1441.9, 3599.9, 3600, 4979].map(clock), ['00:00', '00:05', '24:01', '59:59', '1:00:00', '1:22:59'], 'relógio corrido: segundos completos, mm:ss');
  assert.equal(view.raceSecondsSince(iso(100), nowAt(172)), 72);
  assert.equal(view.raceSecondsSince(iso(100), nowAt(50)), 0, 'nunca negativo');
  assert.equal(view.raceSecondsSince(null, nowAt(50)), null);
  assert.equal(view.raceSecondsSince('não é data', nowAt(50)), null);
});

test('AC2: a consulta é de 1 s com tela ao vivo ou onda por largar e de 5 s quando todas já largaram', () => {
  const next = { key: 'w4', title: 'Onda 4', heatNumber: 4, date: '2026-11-14', time: '10:40', divisionNames: [], athleteCount: 3 };
  assert.equal(view.racePollMs({ screen: 'live', next: null }), 1000);
  assert.equal(view.racePollMs({ screen: 'live', next }), 1000);
  assert.equal(view.racePollMs({ screen: 'class', next }), 1000, 'há onda por largar: as luzes da D3 pedem a largada vista cedo');
  assert.equal(view.racePollMs({ screen: 'grid', next }), 1000);
  assert.equal(view.racePollMs({ screen: 'class', next: null }), 5000);
  assert.equal(view.racePollMs({ screen: 'standby', next: null }), 5000);
  assert.equal(view.RACE_LIVE_POLL_MS, 1000);
  assert.equal(view.RACE_IDLE_POLL_MS, 5000);
});

test('AC2: o payload de cada telão é reconhecido pelo eventType (Functional Fitness não tem o campo)', async () => {
  const race = await payloadAt(1440);
  assert.equal(view.isRaceBroadcastPayload(race), true);
  assert.equal(view.isRaceBroadcastPayload({ screen: 'live', version: 'x', appVersion: '', serverTime: '', event: {}, mode: 'auto', live: null, call: null, interval: null, standby: null, next: null }), false);
});

// ---------------------------------------------------------------------------
// AC5: "onde está" e "dif. líder"
// ---------------------------------------------------------------------------

test('AC5: "onde está": estação com o progresso do tipo, reta final, aguardando início e tempo na estação', () => {
  const where = (r, closing = null, now = nowAt(172)) => view.describeRaceWhere(r, closing, now);
  const units = where(row({ where: atStation() }));
  assert.deepEqual([units.tone, units.main, units.sub], ['station', 'Sled Pull 2/4', 'na estação']);
  assert.deepEqual(units.parts, { name: 'Sled Pull', progress: '2/4', subText: 'na estação', counter: '' });
  assert.equal(where(row({ where: atStation({ progress: { type: 'units', unit: 'volta', done: 5, target: 4 } }) })).main, 'Sled Pull 4/4', 'não passa da meta');

  const reps = where(row({ where: atStation({ stationId: 'wall-balls', stationName: 'Wall Balls', stationKind: 'wall_ball', progress: { type: 'reps', done: 75, target: 100 } }) }), 'wall-balls');
  assert.deepEqual([reps.main, reps.sub], ['Wall Balls 75', 'reta final'], 'a última estação ganha "reta final" no subtexto');

  const timed = where(row({ where: atStation({ stationId: 'row', stationName: 'Row', stationKind: 'ergometer', progress: { type: 'time' } }) }), 'wall-balls');
  assert.deepEqual([timed.main, timed.sub, timed.parts.counter], ['Row', 'na estação · 1:12', '1:12'], 'ergômetro mostra o tempo na estação, sem número no nome');
  const timedLast = where(row({ where: atStation({ stationId: 'row', stationName: 'Row', progress: { type: 'time' } }) }), 'row');
  assert.deepEqual([timedLast.sub, timedLast.parts.counter], ['reta final', ''], 'na última estação, "reta final" no lugar do tempo (o cartão da reta final mostra o tempo)');

  const waiting = where(row({ where: atStation({ waiting: true, startedAt: null, stationId: 'wall-balls', progress: { type: 'reps', done: 0, target: 100 } }) }), 'wall-balls');
  assert.deepEqual([waiting.main, waiting.sub], ['Sled Pull 0', 'aguardando início'], 'cartão aberto e sem início: não é leitura');
});

test('AC5: entre estações é estimado (após a última estação, com o tempo desde a saída); sem leitura, desde a largada', () => {
  const track = view.describeRaceWhere(row({ where: { kind: 'track', afterStationId: 'sled-pull', afterStationName: 'Sled Pull', sinceAt: iso(1416), closedWithoutTime: false } }), null, nowAt(1441));
  assert.deepEqual([track.tone, track.main, track.sub, track.parts], ['track', 'Na pista', 'após Sled Pull · 0:25', { name: 'Na pista', progress: '', subText: 'após Sled Pull', counter: '0:25' }]);
  const start = view.describeRaceWhere(row({ where: { kind: 'track', afterStationId: null, afterStationName: null, sinceAt: iso(0), closedWithoutTime: false } }), null, nowAt(6));
  assert.deepEqual([start.main, start.sub], ['Na pista', 'desde a largada · 0:06']);
  const noInstant = view.describeRaceWhere(row({ where: { kind: 'track', afterStationId: null, afterStationName: null, sinceAt: null, closedWithoutTime: false } }), null, nowAt(6));
  assert.equal(noInstant.sub, 'desde a largada');
});

test('AC5: chegada, DNF e "sem tempo fechado" (D44) têm o texto próprio; a penalidade da chegada vem em "inclui"', () => {
  const where = (r) => view.describeRaceWhere(r, null, nowAt(5000));
  assert.deepEqual([where(row({ status: 'finished', where: { kind: 'finished' } })).main, where(row({ status: 'finished', where: { kind: 'finished' } })).sub], ['Chegada', 'tempo final']);
  assert.equal(where(row({ status: 'finished', where: { kind: 'finished' }, penaltySeconds: 15 })).sub, 'inclui +15 s');
  assert.deepEqual([where(row({ status: 'dnf', where: { kind: 'dnf' } })).main, where(row({ status: 'dnf', where: { kind: 'dnf' } })).sub], ['DNF', 'decisão do organizador']);
  const stalled = where(row({ where: { kind: 'track', afterStationId: 'wall-balls', afterStationName: 'Wall Balls', sinceAt: iso(4000), closedWithoutTime: true } }));
  assert.deepEqual([stalled.tone, stalled.main, stalled.sub], ['stalled', 'Sem tempo fechado', 'aguardando o organizador']);
});

test('AC5: "dif. líder": LÍDER, +m:ss, tempo final com a diferença, "–" e a penalidade só em segundos', () => {
  const gap = view.describeRaceGap;
  assert.deepEqual(gap(row({ isLeader: true })), { tone: 'lead', text: 'LÍDER', sub: '', penalty: null, counting: false });
  assert.equal(gap(row({ isLeader: true, penaltySeconds: 15 })).penalty, '+15 s');
  assert.deepEqual(gap(row({ gapSeconds: 79 })), { tone: 'gap', text: '+1:19', sub: '', penalty: null, counting: false });
  assert.equal(gap(row({ gapSeconds: 3700 })).text, '+1:01:40');
  assert.equal(gap(row({ gapSeconds: 0 })).text, '+0:00');
  assert.deepEqual(gap(row({ gapSeconds: null })), { tone: 'none', text: '–', sub: '', penalty: null, counting: false });
  assert.deepEqual(gap(row({ gapSeconds: 129, penaltySeconds: 15 })), { tone: 'gap', text: '+2:09', sub: '', penalty: '+15 s', counting: false });
  assert.deepEqual(gap(row({ status: 'finished', isLeader: true, finalSeconds: 3982 })), { tone: 'final', text: '1:06:22', sub: 'líder', penalty: null, counting: false });
  assert.deepEqual(gap(row({ status: 'finished', finalSeconds: 4015, gapSeconds: 33, penaltySeconds: 15 })), { tone: 'final', text: '1:06:55', sub: '+0:33', penalty: null, counting: false }, 'quem fechou: o "inclui" já está em "onde está"');
  assert.equal(gap(row({ status: 'finished', finalSeconds: 4015, gapSeconds: null })).sub, '');
  assert.deepEqual(gap(row({ status: 'dnf', penaltySeconds: 15 })), { tone: 'none', text: '–', sub: '', penalty: null, counting: false });
  assert.deepEqual([view.raceRowPosition(row({ position: 3 })), view.raceRowPosition(row({ position: null, status: 'dnf' }))], ['3', '–']);
});

// ---------------------------------------------------------------------------
// AC4: setas de variação
// ---------------------------------------------------------------------------

test('AC4: setas: nunca na primeira carga; 5 s para quem mudou; não nascem quando alguém entra ou sai da ordem', () => {
  const arrows = view.nextRankArrows;
  const t0 = 10_000;
  assert.equal(arrows(new Map(), null, ['a', 'b', 'c'], t0).size, 0, 'primeira carga');
  const swapped = arrows(new Map(), ['a', 'b', 'c'], ['b', 'a', 'c'], t0);
  assert.deepEqual([...swapped.entries()].sort(), [['a', { dir: 'down', until: t0 + 5000 }], ['b', { dir: 'up', until: t0 + 5000 }]]);
  assert.equal(swapped.has('c'), false, 'quem não mudou não leva seta');
  assert.equal(arrows(swapped, ['b', 'a', 'c'], ['b', 'a', 'c'], t0 + 3000).size, 2, 'ordem igual: as setas vivas continuam');
  assert.equal(arrows(swapped, ['b', 'a', 'c'], ['b', 'a', 'c'], t0 + 5000).size, 0, 'depois de 5 s somem');
  assert.equal(arrows(new Map(), ['a', 'b', 'c'], ['a', 'c'], t0).size, 0, 'um DNF sai da ordem e os de trás não parecem ter subido');
  assert.equal(arrows(new Map(), ['a', 'b', 'c'], ['a', 'b', 'x'], t0).size, 0, 'mesmo tamanho, outros atletas');
  const three = arrows(new Map(), ['a', 'b', 'c'], ['c', 'a', 'b'], t0);
  assert.deepEqual([three.get('c').dir, three.get('a').dir, three.get('b').dir], ['up', 'down', 'down']);
  assert.deepEqual(view.raceRankOrder([row({ athleteKey: 'a' }), row({ athleteKey: 'b', status: 'dnf' }), row({ athleteKey: 'c', status: 'finished' })]), ['a', 'c'], 'o DNF não entra na ordem');
});

// ---------------------------------------------------------------------------
// AC7: cartões
// ---------------------------------------------------------------------------

const board = (over = {}) => ({
  waveKey: 'w3', waveTitle: 'Onda 3', divisionKey: 'open-m', divisionName: 'Open Masculino', startedAt: iso(0),
  stages: [{ id: 'ski-erg', closesTime: false }, { id: 'wall-balls', closesTime: true }], rows: [], battle: null, finalists: [], hasLeaderReading: true, ...over
});
const wave = { key: 'w3', title: 'Onda 3', heatNumber: 3, time: '10:12', startedAt: iso(0), startedClock: '10:12:05', lastReadingAt: iso(1418), divisionKeys: ['open-m'], athleteCount: 10, racingCount: 10 };

test('AC7: cartão A: a disputa tem prioridade e conta a tendência desde a leitura', () => {
  const rows = [row({ athleteKey: 'a', name: 'Rafael Tavares', box: 'Box Aldeota', position: 1, isLeader: true }), row({ athleteKey: 'b', name: 'Bruno Sampaio', box: 'CT Meireles', position: 2, gapSeconds: 2 })];
  const battle = (over) => ({ position: 1, aheadKey: 'a', backKey: 'b', intervalSeconds: 2, trend: 'closing', trendSeconds: 47, since: { stationName: 'Sled Pull', side: 'in' }, ...over });
  const card = (over) => view.describeRaceCardA(board({ rows, battle: battle(over) }), wave, nowAt(1440));
  assert.deepEqual(card({}), {
    kind: 'battle', eyebrow: 'Disputa pelo 1º lugar', crossWave: false,
    ahead: { position: 1, name: 'Rafael Tavares', box: 'Box Aldeota' }, back: { position: 2, name: 'Bruno Sampaio', box: 'CT Meireles' },
    interval: '0:02', trend: 'caiu 0:47 desde a entrada do Sled Pull'
  });
  assert.equal(card({ trend: 'widening', trendSeconds: 3 }).trend, 'subiu 0:03 desde a entrada do Sled Pull');
  assert.equal(card({ trend: 'steady', trendSeconds: 0, since: { stationName: 'Row', side: 'out' } }).trend, 'estável desde a saída do Row');
  assert.equal(card({ trend: null, trendSeconds: null, since: null }).trend, '', 'sem leitura anterior em comum');
  assert.equal(card({ position: 3 }).eyebrow, 'Disputa pelo 3º lugar');
  const withoutRows = view.describeRaceCardA(board({ rows: [rows[0]], battle: battle({}) }), wave, nowAt(1440));
  assert.equal(withoutRows.kind, 'leader', 'disputa de quem não está na torre cai no líder, sem erro');
});

test('AC7: cartão A: sem nenhuma leitura é a onda aguardando; depois, o líder com a vantagem para o 2º', () => {
  const waiting = view.describeRaceCardA(board({ hasLeaderReading: false, rows: [row()] }), wave, nowAt(6));
  assert.deepEqual(waiting, { kind: 'waiting', eyebrow: 'Onda 3 na pista', title: 'Largou às 10:12:05', detail: 'Ordem do cronograma até a primeira leitura', at: 'Aguardando a primeira leitura de um judge', note: '' });

  const leader = row({ athleteKey: 'a', name: 'Rafael Tavares', box: 'Box Aldeota', isLeader: true, where: { kind: 'track', afterStationId: 'sled-pull', afterStationName: 'Sled Pull', sinceAt: iso(1416), closedWithoutTime: false } });
  const known = view.describeRaceCardA(board({ rows: [leader, row({ athleteKey: 'b', gapSeconds: 33 })] }), wave, nowAt(1441));
  assert.deepEqual(known, { kind: 'leader', eyebrow: 'Líder da onda', name: 'Rafael Tavares', box: 'Box Aldeota', at: 'Na pista · após Sled Pull · 0:25', advantage: { label: 'Vantagem para o 2º', value: '+0:33', known: true } });
  const unknown = view.describeRaceCardA(board({ rows: [leader, row({ athleteKey: 'b', gapSeconds: null })] }), wave, nowAt(1441));
  assert.deepEqual(unknown.advantage, { label: 'Vantagem para o 2º', value: 'aguardando leitura', known: false });
  assert.equal(view.describeRaceCardA(board({ rows: [] }), wave, nowAt(6)), null);
  assert.equal(view.describeRaceCardA(board({ rows: [leader, row({ athleteKey: 'dnf', status: 'dnf', gapSeconds: 5 })] }), wave, nowAt(1441)).advantage.known, false, 'DNF não é o 2º');
});

test('AC7: cartão B: reta final com o progresso pelo tipo da estação (reps, trechos ou voltas, tempo, aguardando início)', () => {
  const finalist = (over) => ({ athleteKey: 'k', position: 3, name: 'Diego Martins', box: 'Arena Sul', stationName: 'Wall Balls', waiting: false, startedAt: iso(3855), progress: { type: 'reps', done: 75, target: 100 }, ...over });
  const card = (...finalists) => view.describeRaceCardB(board({ finalists }), null, nowAt(4100));
  const reps = card(finalist({}));
  assert.equal(reps.kind, 'finalists');
  assert.equal(reps.eyebrow, 'Reta final · Wall Balls');
  assert.deepEqual(reps.items[0], { key: 'k', position: 3, name: 'Diego Martins', box: 'Arena Sul', wave: '', target: null, value: '75', of: '/100', fraction: 0.75, caption: '' });
  assert.deepEqual(card(finalist({ progress: { type: 'reps', done: 130, target: 100 } })).items[0].fraction, 1, 'a barra não passa de cheia');
  assert.deepEqual(card(finalist({ progress: { type: 'reps', done: 12, target: null } })).items[0], { key: 'k', position: 3, name: 'Diego Martins', box: 'Arena Sul', wave: '', target: null, value: '12', of: '', fraction: null, caption: '' });

  const sled = card(finalist({ progress: { type: 'units', unit: 'trecho', done: 2, target: 4 } })).items[0];
  assert.deepEqual([sled.value, sled.of, sled.fraction, sled.caption], ['2', '/4', 0.5, 'trechos']);
  const lap = card(finalist({ progress: { type: 'units', unit: 'volta', done: 6, target: 6 } })).items[0];
  assert.deepEqual([lap.value, lap.of, lap.fraction, lap.caption], ['6', '/6', 1, 'voltas']);

  const timed = card(finalist({ progress: { type: 'time' }, startedAt: iso(4000) })).items[0];
  assert.deepEqual([timed.value, timed.of, timed.fraction, timed.caption], ['1:40', '', null, 'na estação'], 'ergômetro e genérica: o tempo na estação, sem barra');
  const waiting = card(finalist({ waiting: true, startedAt: null })).items[0];
  assert.deepEqual([waiting.value, waiting.fraction, waiting.caption], ['–', null, 'aguardando início']);
  assert.equal(card(finalist({ stationName: 'Sandbag Lunges' })).eyebrow, 'Reta final · Sandbag Lunges', 'a última estação do percurso, seja ou não o Wall Ball (D34)');
});

test('AC7: cartão B: sem reta final, a próxima largada; sem próxima onda, o aviso', () => {
  const next = { key: 'w4', title: 'Onda 4', heatNumber: 4, date: '2026-11-14', time: '10:40', divisionNames: ['Open Masculino', 'Open Feminino'], athleteCount: 12 };
  assert.deepEqual(view.describeRaceCardB(board(), next, nowAt(1440)), { kind: 'next', eyebrow: 'Próxima largada', title: 'Onda 4', time: '10:40 prevista', detail: 'Open Masculino e Open Feminino · 12 atletas' });
  assert.equal(view.describeRaceCardB(board(), { ...next, athleteCount: 1, divisionNames: ['Open Masculino'], time: '' }, nowAt(1440)).detail, 'Open Masculino · 1 atleta');
  assert.equal(view.describeRaceCardB(board(), { ...next, time: '' }, nowAt(1440)).time, '');
  const none = view.describeRaceCardB(board(), null, nowAt(1440));
  assert.deepEqual([none.kind, none.title, none.detail], ['next', 'Sem próxima onda', 'Todas as ondas do cronograma já largaram']);
  assert.equal(view.raceClosingStationId(board()), 'wall-balls');
  assert.equal(view.raceClosingStationId({ stages: [] }), null);
});

// ---------------------------------------------------------------------------
// AC8 e AC9: faixa da direção de prova e aviso de silêncio
// ---------------------------------------------------------------------------

test('AC8: a faixa mostra o último evento da onda, com a hora no fuso do evento e sem o motivo', () => {
  const event = (over) => ({ kind: 'penalty', at: iso(864), clock: '10:26:29', waveKey: 'w3', waveTitle: 'Onda 3', name: 'Thiago Bezerra', seconds: 15, stationName: 'Sled Push', finalSeconds: null, ...over });
  const text = (over) => view.describeRaceTicker(event(over));
  assert.deepEqual(text({}), { clock: '10:26:29', text: 'PENALIDADE · +15 s · Thiago Bezerra · Sled Push' });
  assert.equal(text({ stationName: null }).text, 'PENALIDADE · +15 s · Thiago Bezerra');
  assert.deepEqual(text({ kind: 'start', name: null, seconds: null, stationName: null, clock: '10:12:05' }), { clock: null, text: 'LARGADA · Onda 3 · 10:12:05' });
  assert.deepEqual(text({ kind: 'dnf', seconds: null, stationName: null, name: 'André Moreira' }), { clock: '10:26:29', text: 'DNF · André Moreira · decisão do organizador' });
  assert.equal(text({ kind: 'finish', seconds: null, stationName: null, name: 'Rafael Tavares', finalSeconds: 3982 }).text, 'CHEGADA · Rafael Tavares · 1:06:22');
  assert.equal(text({ kind: 'finish', seconds: null, stationName: null, name: null, finalSeconds: null }).text, 'CHEGADA · Atleta · –');

  const live = { ticker: [event({ at: iso(1), waveKey: 'w3' }), event({ at: iso(2), waveKey: 'w9', name: 'De outra onda' }), event({ at: iso(3), waveKey: 'w3', name: 'Mais novo' })] };
  const waveBoard = (waveKey) => ({ scope: 'wave', waveKey, divisionKey: 'open-m' });
  assert.equal(view.raceLastTickerEvent(live, waveBoard('w3')).name, 'Mais novo');
  assert.equal(view.raceLastTickerEvent(live, waveBoard('w9')).name, 'De outra onda');
  assert.equal(view.raceLastTickerEvent(live, waveBoard('w1')), null);
});

test('AC9: aviso de silêncio aos 10 min sem leitura, em minutos pela hora do servidor; a tela segue ao vivo', () => {
  const notice = (lastReadingAt, seconds) => view.raceSilenceNotice({ lastReadingAt }, nowAt(seconds));
  assert.equal(notice(iso(1418), 1418 + 599), null);
  assert.equal(notice(iso(1418), 1418 + 600), 'Sem leitura há 10 min');
  assert.equal(notice(iso(1418), 1418 + 1200), 'Sem leitura há 20 min');
  assert.equal(notice(iso(1418), 1418 + 750), 'Sem leitura há 12 min');
  assert.equal(notice(iso(0), 700), 'Sem leitura há 11 min', 'sem leitura nenhuma, conta da largada (que é o lastReadingAt da onda)');
  assert.equal(notice(null, 5000), null);
});

// ---------------------------------------------------------------------------
// AC3 e AC4: cabeçalho, passo do rodízio e páginas (com o payload real)
// ---------------------------------------------------------------------------

test('AC3: título "Onda N · Categoria" e o relógio da onda, contado desde a largada oficial pela hora do servidor', async () => {
  const payload = await payloadAt(1440);
  const frame = view.raceLiveFrame(payload.live, nowAt(1441.9));
  assert.deepEqual(view.describeRaceHeader(frame, nowAt(1441.9)), { title: 'Onda 3 · Open Masculino', clock: '24:01', caption: 'Tempo da onda 3', clocks: [] });
  assert.equal(view.describeRaceHeader(frame, nowAt(3600)).clock, '1:00:00', 'a partir de 1 h: h:mm:ss');
  assert.equal(view.describeRaceHeader({ ...frame, wave: { ...frame.wave, startedAt: 'inválido' } }, nowAt(5)).clock, '--:--');
  assert.equal(view.describeRaceHeader({ ...frame, wave: { ...frame.wave, heatNumber: null } }, nowAt(5)).caption, 'Tempo da onda');
});

test('AC4: rodízio: passos onda × categoria de 20 s, iguais para quem tem a mesma hora do servidor', async () => {
  const payload = await payloadAt(1440, {}, (db) => {
    for (const key of ['ana', 'bia']) {
      db.rows('race_runs').push({ id: runId(key), event_id: EVENT_ID, division_id: 'open-f', athlete_id: athleteId(key), heat_id: 'w3', ruleset_id: 'rs-race-1', status: 'racing', started_at: iso(0), finish_at: null, gross_seconds: null, penalty_seconds: 0, official_seconds: null, time_source: null });
    }
    db.rows('race_attempts').push({ id: attemptId('ana', 'ski-erg'), run_id: runId('ana'), event_id: EVENT_ID, athlete_id: athleteId('ana'), station_id: 'ski-erg', station_kind: 'ergometer', status: 'running', progress: {}, started_at: iso(300), ended_at: null });
  });
  assert.deepEqual(payload.live.steps, [{ waveKey: 'w3', divisionKey: 'open-m' }, { waveKey: 'w3', divisionKey: 'open-f' }]);
  const at = (step) => view.raceLiveFrame(payload.live, 20_000 * (10 + step) + 1_234);
  assert.deepEqual([at(0).board.divisionName, at(1).board.divisionName, at(2).board.divisionName], ['Open Masculino', 'Open Feminino', 'Open Masculino']);
  assert.deepEqual([at(0).stepIndex, at(1).stepIndex, at(0).stepCount], [0, 1, 2]);
  assert.deepEqual(view.raceLiveFrame(payload.live, 20_000 * 10 + 1_234), view.raceLiveFrame(payload.live, 20_000 * 10 + 19_999), 'o mesmo passo durante os 20 s');
  assert.equal(view.describeRaceHeader(at(1), nowAt(1440)).title, 'Onda 3 · Open Feminino', 'o título é da categoria do passo');
  assert.deepEqual(at(1).rows.map((item) => item.name), ['Ana Paula Lima', 'Beatriz Nogueira']);
  assert.equal(view.raceLiveFrame({ ...payload.live, steps: [] }, 1000), null, 'sem passo, sem tela ao vivo');
  assert.equal(view.raceLiveFrame({ ...payload.live, boards: [] }, 1000), null);
});

test('AC4: categoria com mais de 10 atletas alterna páginas de 8 s, com o líder em toda página', async () => {
  const payload = await payloadAt(1440, {}, (db) => {
    const keys = Array.from({ length: 20 }, (_, index) => `zz${String(index).padStart(2, '0')}`);
    db.rows('athletes').push(...keys.map((key) => ({ id: athleteId(key), name: `Atleta ${key}`, box: 'Box Z', division_id: 'open-m', is_team: false })));
    db.rows('leaderboard_entries').push(...keys.map((key) => ({ id: `le-${key}`, event_id: EVENT_ID, division_id: 'open-m', athlete_id: athleteId(key) })));
    db.rows('race_runs').push(...keys.map((key) => ({ id: runId(key), event_id: EVENT_ID, division_id: 'open-m', athlete_id: athleteId(key), heat_id: 'w3', ruleset_id: 'rs-race-1', status: 'racing', started_at: iso(0), finish_at: null, gross_seconds: null, penalty_seconds: 0, official_seconds: null, time_source: null })));
    db.rows('events')[0].event_schedule.find((item) => item.id === 'w3').athleteIds.push(...keys.map(athleteId));
  });
  const total = payload.live.boards[0].rows.length;
  assert.equal(total, 30);
  const frames = [0, 1, 2, 3].map((page) => view.raceLiveFrame(payload.live, 8_000 * (100 + page) + 500));
  assert.ok(frames.every((frame) => frame.rows.length <= 10), 'no máximo 10 linhas por página');
  assert.ok(frames.every((frame) => frame.pageCount === 4), 'líder fixo + 9 por página: 29 restantes em 4 páginas');
  assert.deepEqual(frames.map((frame) => frame.pageIndex), [0, 1, 2, 3]);
  const leaderKey = payload.live.boards[0].rows.find((item) => item.isLeader).athleteKey;
  assert.ok(frames.every((frame) => frame.rows.some((item) => item.athleteKey === leaderKey)), 'o líder está em toda página');
  assert.equal(new Set(frames.flatMap((frame) => frame.rows.map((item) => item.athleteKey))).size, total, 'ninguém fica de fora');
  assert.deepEqual(view.raceLiveFrame(payload.live, 8_000 * 100 + 500), view.raceLiveFrame(payload.live, 8_000 * 100 + 7_999), 'a mesma página durante os 8 s');
});

// ---------------------------------------------------------------------------
// AC6: mapa do percurso
// ---------------------------------------------------------------------------

test('AC6: o trajeto em S tem uma casa por etapa, na ordem, e escala para qualquer número de etapas', () => {
  const layout = view.raceMapLayout(16);
  assert.equal(layout.slots.length, 16);
  // Percurso de 788 + 223 (meia circunferência, raio 71) + 788: 16 casas de ~112 → 7 em cima, 2 na curva, 7 embaixo.
  assert.deepEqual(layout.slots.map((slot) => slot.part), [...Array(7).fill('top'), 'curve', 'curve', ...Array(7).fill('bottom')]);
  assert.deepEqual(layout.slots.map((slot) => slot.index), Array.from({ length: 16 }, (_, index) => index), 'uma casa por etapa, na ordem do percurso');
  assert.equal(layout.slots[0].y, view.RACE_MAP.y1, 'a primeira etapa fica na reta de cima');
  assert.equal(layout.slots[15].y, view.RACE_MAP.y2, 'a última, na reta de baixo');
  assert.ok(layout.slots[0].x < layout.slots[1].x && layout.slots[14].x > layout.slots[15].x, 'vai para a direita em cima e volta para a esquerda embaixo');
  assert.ok(layout.cardWidth <= 104 && layout.cardWidth >= 56);
  assert.match(layout.trackPath, /^M 112 120 H 900 A 71 71 0 0 1 900 262 H 112$/);
  for (const count of [1, 2, 8, 24, 40]) {
    const scaled = view.raceMapLayout(count);
    assert.equal(scaled.slots.length, count);
    assert.ok(scaled.cardWidth >= 56 && scaled.cardWidth <= 104, `largura da caixa com ${count} etapas`);
    assert.ok(scaled.slots.every((slot) => slot.x >= 0 && slot.x <= scaled.width && slot.y >= 0 && slot.y <= scaled.height));
  }
  assert.equal(view.raceMapLayout(0).slots.length, 1, 'sem etapa, sem divisão por zero');
});

test('AC6: o nome inteiro da estação vai em até duas linhas que cabem; o que passar vira reticências', () => {
  assert.deepEqual(view.raceStageLines('Burpee Broad Jump', 12), ['Burpee Broad', 'Jump']);
  assert.deepEqual(view.raceStageLines('Sandbag Lunges', 12), ['Sandbag', 'Lunges']);
  assert.deepEqual(view.raceStageLines('Wall Balls', 12), ['Wall Balls']);
  assert.deepEqual(view.raceStageLines('Ski Erg', 12), ['Ski Erg']);
  assert.deepEqual(view.raceStageLines('Supercalifragilisticoexpialidoso', 10), ['Supercali…'], 'a linha cortada nunca passa do limite, com a reticência dentro dele');
  assert.deepEqual(view.raceStageLines('Estação com um nome muito comprido mesmo', 10), ['Estação', 'com um no…']);
  assert.deepEqual(view.raceStageLines('', 10), ['']);
  assert.equal(view.raceRunLabel({ name: 'Corrida 3' }, 2), 'C3');
  assert.equal(view.raceRunLabel({ name: 'Run 8' }, 7), 'C8');
  assert.equal(view.raceRunLabel({ name: 'Trecho de corrida' }, 4), 'C5', 'sem número no nome: a ordem da corrida');
});

test('AC6: marcadores: cheio na estação, vazado entre estações, líder em amarelo, quem chegou ou foi DNF sai do mapa', async () => {
  const live = (await payloadAt(4100)).live;
  const markers = view.raceBoardMarkers(live.boards[0]);
  assert.equal(markers.length, 7, 'dos 10: 2 chegaram e 1 foi DNF');
  assert.deepEqual(markers.map((marker) => marker.position), [3, 4, 5, 6, 7, 8, 9]);
  assert.ok(markers.filter((marker) => marker.position <= 5).every((marker) => marker.estimated === false), 'Diego, Thiago e Lucas estão com cartão aberto na estação');
  assert.ok(markers.filter((marker) => marker.position >= 6 && marker.position <= 7).every((marker) => marker.estimated === true), 'Mateus e Caio estão entre estações');
  assert.equal(markers.some((marker) => marker.leader), false, 'o líder chegou e saiu do mapa');
  assert.equal(view.raceFinishedCount(live.boards[0]), 2);
  const early = view.raceBoardMarkers((await payloadAt(1440)).live.boards[0]);
  assert.deepEqual(early.filter((marker) => marker.leader).map((marker) => [marker.position, marker.estimated]), [[1, true]]);
});

test('AC6: os marcadores não se cobrem e ficam dentro do desenho, mesmo com casa lotada ou casas vizinhas cheias', () => {
  const layout = view.raceMapLayout(16);
  const crowd = (slot, count, from = 0) => Array.from({ length: count }, (_, index) => ({ key: `s${slot}-${from + index}`, slot, position: from + index + 1, estimated: false, leader: false }));
  const minDistance = (places) => {
    let min = Infinity;
    places.forEach((a, i) => places.slice(i + 1).forEach((b) => { min = Math.min(min, Math.hypot(a.x - b.x, a.y - b.y) - (a.radius + b.radius)); }));
    return min;
  };
  for (const slot of [1, 3, 5, 8, 12, 14]) {
    for (const count of [1, 3, 6, 12]) {
      const places = view.placeRaceMarkers(layout, crowd(slot, count));
      assert.equal(places.length, count);
      assert.ok(minDistance(places) >= -0.01, `sem sobreposição: casa ${slot}, ${count} marcadores`);
      assert.ok(places.every((p) => p.x - p.radius >= 0 && p.x + p.radius <= layout.width && p.y - p.radius >= 0 && p.y + p.radius <= layout.height), `dentro do desenho: casa ${slot}, ${count} marcadores`);
    }
  }
  assert.equal(view.placeRaceMarkers(layout, crowd(3, 1))[0].radius, 18, 'poucos marcadores: tamanho normal');
  assert.ok(view.placeRaceMarkers(layout, crowd(3, 12))[0].radius < 18, 'casa lotada: marcadores menores');
  const neighbours = view.placeRaceMarkers(layout, [...crowd(3, 6), ...crowd(4, 6, 6)]);
  assert.ok(minDistance(neighbours) >= -0.01, 'casas vizinhas cheias não se cobrem');
  assert.deepEqual(view.placeRaceMarkers(layout, []), []);
});

// ---------------------------------------------------------------------------
// AC1, AC2, AC10, AC11: fonte da tela
// ---------------------------------------------------------------------------

test('AC2: um único fetch no BroadcastScreen; a tela do Fitness Race não faz requisição e recebe o payload dele', () => {
  const broadcast = read('../src/components/broadcast/BroadcastScreen.tsx');
  assert.equal(broadcast.match(/fetch\(/g).length, 1, 'nenhuma requisição nova');
  assert.match(broadcast, /fetch\(`\/api\/telao\/\$\{encodeURIComponent\(token\)\}`/);
  assert.match(broadcast, /RaceBroadcastScreen payload=\{racePayload\}/);
  assert.match(broadcast, /isRaceBroadcastPayload\(received\)/);
  assert.match(broadcast, /pollBase\.current = isRaceBroadcastPayload\(data\) \? racePollMs\(data\) : data\.screen === 'live' \? LIVE_POLL_MS : IDLE_POLL_MS;/, 'Functional Fitness segue com 1 s e 5 s');
  assert.match(broadcast, /const LIVE_POLL_MS = 1_000;/);
  assert.match(broadcast, /const IDLE_POLL_MS = 5_000;/);
  assert.match(broadcast, /useNow\(250, offset\)/);
  assert.match(broadcast, /status === 'ok' && racePayload/, 'link revogado ou sem resposta continua na moldura de sempre');
  const race = code('../src/components/broadcast/RaceBroadcastScreen.tsx');
  assert.doesNotMatch(race, /\bfetch\s*\(/);
  assert.doesNotMatch(race, /XMLHttpRequest|EventSource|WebSocket/);
  assert.match(race, /'use client'/);
});

test('AC1: a tela cita o desenho aprovado, escala em cqw, respeita prefers-reduced-motion e é escura', () => {
  const screen = read('../src/components/broadcast/RaceBroadcastScreen.tsx');
  assert.match(screen, /docs\/design\/telao-fitness-race\//);
  assert.match(read('../src/components/broadcast/RaceBroadcast.module.css'), /docs\/design\/telao-fitness-race\//);
  const css = read('../src/components/broadcast/RaceBroadcast.module.css');
  assert.ok((css.match(/cqw/g) || []).length > 100, 'tamanhos em cqw');
  const fontSizes = [...css.matchAll(/font-size:\s*([^;}]+)[;}]/g)].map((match) => match[1].trim());
  assert.ok(fontSizes.length > 0 && fontSizes.every((value) => /^[\d.]+cqw$/.test(value)), `todo texto escala com a largura do quadro (cqw), nunca em px/rem: ${fontSizes.filter((value) => !/^[\d.]+cqw$/.test(value)).join(', ')}`);
  assert.match(css, /container-type: inline-size/);
  assert.match(css, /aspect-ratio: 16 \/ 9/);
  assert.match(css, /\.tv \{[^}]*background: #090b0e/, 'quadro 16:9 escuro');
  assert.match(css, /\.stage \{[^}]*background: #000/, 'faixas pretas fora do 16:9');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /animation: none !important/);
  assert.match(css, /transition-duration: 0\.01ms !important/);
});

test('AC1: nenhum dado pessoal, motivo de penalidade nem previsão é lido ou mostrado pela tela', () => {
  for (const path of ['../src/components/broadcast/RaceBroadcastScreen.tsx', '../src/lib/raceBroadcastView.ts']) {
    const source = code(path);
    assert.doesNotMatch(source, /\.(email|phone|birth\w*|instagram|city|team_?members|athlete_?id|run_?id|attempt_?id|user_?id|registration_?id|judge\w*|infraction\w*|reason|note|createdBy|author)\b/i, `${path}: campo de pessoa, id interno ou motivo lido do payload`);
    assert.doesNotMatch(source, /predict|forecast|projected|pace\b|ritmo|ultrapassagem|runSeconds|roxzone/i, `${path}: nada de previsão de resultado (Regra 8)`);
    assert.doesNotMatch(source, /Date\.now\(\)/, `${path}: a hora vem do servidor, por parâmetro`);
  }
  // O contrato público: o payload não tem campo de motivo, rótulo livre nem código de infração.
  const payloadTypes = code('../src/lib/raceBroadcastPayload.ts');
  assert.doesNotMatch(payloadTypes, /\b(reason|note|label|code|email|phone|birth\w*|instagram|city|athleteId|runId|attemptId|userId|registrationId|judge\w*)\??:/i, 'tipos do payload: nenhum campo de pessoa, id interno ou motivo');
  const view = code('../src/lib/raceBroadcastView.ts');
  assert.equal(view.match(/prevista/g).length, 1, '"prevista" só aparece na hora do cronograma da próxima onda');
  assert.match(view, /time: next\.time \? `\$\{next\.time\} prevista` : ''/);
  assert.deepEqual([...view.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]).sort(), ['@/lib/broadcastPayload', '@/lib/raceBroadcast', '@/lib/raceBroadcastPayload'], 'módulo puro: nenhum import de servidor, react ou rede');
});

test('AC10: grid, classificação e espera mostram um aviso neutro (marca do evento e o nome da tela), nunca tela em branco', () => {
  const screen = read('../src/components/broadcast/RaceBroadcastScreen.tsx');
  assert.match(screen, /Esta tela ainda está sendo preparada\./);
  assert.match(screen, /NeutralScreen payload=\{payload\}/);
  assert.match(screen, /grid: 'Grid de largada'/);
  assert.match(screen, /class: 'Classificação'/);
  assert.match(screen, /standby: 'Espera'/);
  assert.match(screen, /Nenhuma onda com atletas no ar neste momento\./, 'ao vivo sem passo também não fica em branco');
  assert.match(screen, /payload\.event\.logoUrl \|\| '\/icon\.svg'/, 'a marca do evento, ou a do WODArena');
});

test('AC3: moldura reaproveitada: cabeçalho, rodapé, "Atualizado há N s", "Sem conexão", tela cheia e a recarga por appVersion', () => {
  const screen = read('../src/components/broadcast/RaceBroadcastScreen.tsx');
  assert.match(screen, /Atualizado há <b className=\{styles\.num\}>\{agoSeconds\} s<\/b>/);
  assert.match(screen, /Sem conexão · mostrando/);
  assert.match(screen, /requestFullscreen/);
  assert.match(screen, /aria-live="off"/);
  assert.match(screen, /Direção de prova/);
  assert.match(screen, /WODARENA/);
  const broadcast = read('../src/components/broadcast/BroadcastScreen.tsx');
  assert.match(broadcast, /window\.location\.reload\(\)/, 'a recarga por appVersion continua no hook compartilhado');
  assert.match(broadcast, /Link do telão desativado/);
  assert.match(broadcast, /Conectando ao evento/);
});
