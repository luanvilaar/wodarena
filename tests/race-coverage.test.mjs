import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { createFakeSupabase } from './support/fakeSupabase.mjs';
import { createRaceClient } from './support/fakeRaceSupabase.mjs';
import { importServerModule, setActiveSupabaseClient } from './support/serverModuleHarness.mjs';

// Story 1.105 (F2 da súmula Fitness Race): painel de cobertura e alerta ao
// vivo. Regras puras (raceCoverage.ts: buildRaceCoverage, estimativa de
// atletas esperando, avisos), a leitura real view=coverage com o banco em
// memória (acesso, judge fora da escala marcado, sem e-mail, onda sem largar,
// corridas encerradas fora da estimativa, tabela da escala ausente) e o
// estático do painel (seção em RaceSheetPanel, 15 s com a aba visível, falha
// sem tela em branco, textos da maquete aprovada telas/cobertura.html, D42).

process.env.SUPABASE_URL = 'http://supabase.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';
process.env.WODA_SESSION_SECRET = 'segredo-de-teste-cobertura';

let database = createFakeSupabase();
const state = { missingRaceTables: false, missingAssignments: false };
const raceClient = createRaceClient(() => database, state);

/** Consulta à tabela que ainda não existe (migration da 1.104 não aplicada): 42P01 em qualquer encadeamento. */
const missingTable = (table) => {
  const result = { data: null, error: { code: '42P01', message: `relation "public.${table}" does not exist` } };
  const query = new Proxy({}, { get: (_, prop) => (prop === 'then' ? (resolve) => resolve(result) : () => query) });
  return query;
};
const client = {
  from: (table) => (table === 'race_judge_assignments' && state.missingAssignments ? missingTable(table) : raceClient.from(table)),
  rpc: (name, args) => raceClient.rpc(name, args)
};
setActiveSupabaseClient(client);

const { GET } = await importServerModule('app/api/race-sheets/route.ts');
const { createSessionToken } = await importServerModule('lib/serverSecurity.ts');
const race = await importServerModule('lib/serverRaceSheets.ts');
const coverage = await importServerModule('lib/raceCoverage.ts');

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
// Regras puras: percurso real (8 estações; Sandbag Lunges só no Men Pro)
// ---------------------------------------------------------------------------

const stage = (key, name, kind, extra = {}) => ({ stationId: `${key}-id`, key, name, kind, meta: '', closesTime: false, ...extra });
const MEN = [
  stage('skierg', 'SkiErg', 'ergometer'),
  stage('sled-push', 'Sled Push', 'sled'),
  stage('sled-pull', 'Sled Pull', 'sled'),
  stage('burpee-broad-jump', 'Burpee Broad Jump', 'sections'),
  stage('rowing', 'Rowing', 'ergometer'),
  stage('farmers-carry', 'Farmers Carry', 'sections'),
  stage('sandbag-lunges', 'Sandbag Lunges', 'sections'),
  stage('wall-balls', 'Wall Balls', 'wall_ball', { closesTime: true })
];
const WOMEN = MEN.filter((item) => item.key !== 'sandbag-lunges');
const COURSES = { men: MEN, women: WOMEN };
const NAMES = { men: 'Men Pro', women: 'Women Pro' };
const J = (id, name) => ({ id, name });
const BIA = J('j-bia', 'Judge Bia');
const PAULA = J('j-paula', 'Judge Paula');
const CAIO = J('j-caio', 'Judge Caio');
const RAFA = J('j-rafa', 'Judge Rafa');
const DUDA = J('j-duda', 'Judge Duda');
const TITO = J('j-tito', 'Judge Tito');
const LIA = J('j-lia', 'Judge Lia');
const JUDGES = [BIA, PAULA, CAIO, RAFA, DUDA, TITO, LIA];

const W3 = { id: 'w3', title: 'Onda 3', date: '2026-11-01', time: '08:40', startedAt: '2026-11-01T11:40:02.000Z', categories: ['Men Pro', 'Women Pro'], divisionIds: ['men', 'women'] };
const W5 = { id: 'w5', title: 'Onda 5', date: '2026-11-01', time: '09:20', startedAt: null, categories: ['Women Pro'], divisionIds: ['women'] };

const runOf = (id, division, status = 'racing', heatId = 'w3') => ({ id, athleteId: id, athleteName: id, divisionId: division, divisionName: NAMES[division], heatId, status, stages: COURSES[division] });
let attemptSeq = 0;
const att = (runId, key, kind, judge, status = 'running', at = '2026-11-01T11:50:00.000Z') => ({
  id: `a${(attemptSeq += 1)}`, runId, stationId: `${key}-id`, stationKind: kind, judgeUserId: judge ? judge.id : null, judgeName: judge ? judge.name : '', status, progress: {}, createdAt: at, updatedAt: at
});
const pair = (judge, stationKey, heatId = null) => ({ judgeUserId: judge.id, stationKey, heatId });
const build = (over = {}) => coverage.buildRaceCoverage({
  timeZone: 'America/Fortaleza', waves: [W3, W5], courses: COURSES, divisionNames: NAMES, runs: [], attempts: [], assignments: [], judges: JUDGES, ...over
});
const waveOf = (result, id) => result.waves.find((wave) => wave.id === id);
const stationOf = (wave, key) => wave.stations.find((station) => station.key === key);
const kinds = (wave) => wave.alerts.map((alert) => `${alert.kind}:${alert.stationKey}`);

test('estação sem judge escalado: visão de preparação e ao vivo; estação só de uma categoria; limite 1 no Wall Ball', () => {
  const result = build({ assignments: [pair(BIA, 'skierg'), pair(LIA, 'wall-balls')] });
  const prep = waveOf(result, 'w5');
  assert.equal(prep.startedAt, null);
  assert.equal(prep.stations.length, 7, 'Women Pro sem Sandbag Lunges');
  assert.equal(stationOf(prep, 'skierg').judges[0].state, 'scheduled');
  assert.equal(stationOf(prep, 'skierg').judges[0].label, 'Escalado');
  assert.equal(stationOf(prep, 'skierg').waiting, null, 'antes da largada não estima');
  assert.deepEqual(kinds(prep).filter((item) => item.startsWith('no_judge_scheduled')).length, 5);
  assert.equal(prep.alerts[0].text, 'Onda 5 · Sled Push: nenhum judge na escala desta onda.');
  assert.match(prep.alerts[0].hint, /sem registro e sem split/);
  assert.equal(prep.alerts[0].openAssignments, true);

  const live = waveOf(result, 'w3');
  assert.equal(live.stations.length, 8);
  assert.deepEqual(stationOf(live, 'sandbag-lunges').onlyIn, ['Men Pro']);
  assert.deepEqual(stationOf(live, 'skierg').onlyIn, []);
  assert.equal(stationOf(live, 'wall-balls').limit, 1);
  assert.equal(stationOf(live, 'skierg').limit, 2);
  assert.equal(stationOf(live, 'sled-push').status, 'attention');
  assert.equal(stationOf(live, 'skierg').status, 'covered');
  assert.equal(live.source, 'default');
});

test('estimativa de atletas esperando (AC3): sem tentativa espera a 1ª; estação pulada sem judge não conta; cartão aberto está na estação; encerradas não esperam', () => {
  const runs = [
    runOf('r-novo', 'men'),
    runOf('r-pulou', 'men'),
    runOf('r-aberto', 'women'),
    runOf('r-dnf', 'men', 'dnf'),
    runOf('r-fim', 'women', 'finished'),
    runOf('r-saiu-final', 'women')
  ];
  const attempts = [
    att('r-pulou', 'skierg', 'ergometer', BIA, 'released'),
    // Sled Push sem judge: nenhuma tentativa. Sled Pull encerrado: espera o Burpee Broad Jump.
    att('r-pulou', 'sled-pull', 'sled', CAIO, 'released'),
    att('r-aberto', 'skierg', 'ergometer', BIA, 'released'),
    att('r-aberto', 'sled-push', 'sled', PAULA, 'running'),
    att('r-saiu-final', 'wall-balls', 'wall_ball', LIA, 'exited_incomplete')
  ];
  const run = (id) => runs.find((item) => item.id === id);
  const of = (id) => attempts.filter((item) => item.runId === id);
  assert.equal(coverage.estimateRaceWaitingStationKey(run('r-novo'), of('r-novo')), 'skierg');
  assert.equal(coverage.estimateRaceWaitingStationKey(run('r-pulou'), of('r-pulou')), 'burpee-broad-jump');
  assert.equal(coverage.estimateRaceWaitingStationKey(run('r-aberto'), of('r-aberto')), null, 'com cartão aberto, está na estação');
  assert.equal(coverage.estimateRaceWaitingStationKey(run('r-dnf'), []), null);
  assert.equal(coverage.estimateRaceWaitingStationKey(run('r-fim'), []), null);
  assert.equal(coverage.estimateRaceWaitingStationKey(run('r-saiu-final'), of('r-saiu-final')), null, 'passou da última estação');
  // Tentativa cancelada não conta como posição.
  assert.equal(coverage.estimateRaceWaitingStationKey(run('r-novo'), [att('r-novo', 'skierg', 'ergometer', BIA, 'cancelled')]), 'skierg');

  const live = waveOf(build({ runs, attempts, assignments: MEN.map((item) => pair(BIA, item.key)) }), 'w3');
  assert.equal(stationOf(live, 'skierg').waiting, 1);
  assert.equal(stationOf(live, 'sled-push').waiting, 0, 'quem pulou o Sled Push não conta nele');
  assert.equal(stationOf(live, 'burpee-broad-jump').waiting, 1);
  assert.equal(live.summary.waiting, 2);
});

test('atletas sem judge substitui "sem judge escalado" na mesma estação; judges lotados com 2 cartões e com 1 no Wall Ball', () => {
  const runs = [runOf('r1', 'men'), runOf('r2', 'men'), runOf('r3', 'men'), runOf('r4', 'men'), runOf('r5', 'women'), runOf('r6', 'women'), runOf('r7', 'women'), runOf('r8', 'women'), runOf('r9', 'women')];
  const attempts = [
    // Sled Push: Paula e Caio com 2 cartões cada; r5 já passou do SkiErg e espera o Sled Push.
    ...['r1', 'r2', 'r3', 'r4'].map((id) => att(id, 'skierg', 'ergometer', BIA, 'released')),
    att('r1', 'sled-push', 'sled', PAULA), att('r2', 'sled-push', 'sled', PAULA),
    att('r3', 'sled-push', 'sled', CAIO), att('r4', 'sled-push', 'sled', CAIO),
    att('r5', 'skierg', 'ergometer', BIA, 'released'),
    // Rowing: r6 saiu do Burpee; ninguém escalado no Rowing e nenhum cartão aberto.
    ...['skierg', 'sled-push', 'sled-pull'].map((key) => att('r6', key, key === 'skierg' ? 'ergometer' : 'sled', BIA, 'released')),
    att('r6', 'burpee-broad-jump', 'sections', RAFA, 'released'),
    // Wall Ball: Lia com 1 cartão (limite 1), r8 e r9 esperando.
    att('r7', 'wall-balls', 'wall_ball', LIA),
    att('r8', 'farmers-carry', 'sections', DUDA, 'released'),
    att('r9', 'farmers-carry', 'sections', DUDA, 'released')
  ];
  const assignments = [pair(BIA, 'skierg'), pair(PAULA, 'sled-push'), pair(CAIO, 'sled-push'), pair(DUDA, 'farmers-carry'), pair(LIA, 'wall-balls'), pair(RAFA, 'burpee-broad-jump'), pair(TITO, 'sled-pull'), pair(TITO, 'sandbag-lunges')];
  const live = waveOf(build({ runs, attempts, assignments }), 'w3');

  assert.deepEqual(stationOf(live, 'rowing').alerts, ['athletes_without_judge'], 'só um aviso por estação sem judge com gente esperando');
  const rowing = live.alerts.find((alert) => alert.kind === 'athletes_without_judge');
  assert.equal(rowing.text, 'Onda 3 · Rowing: cerca de 1 atleta esperando, sem judge escalado e sem cartão aberto.');
  assert.equal(rowing.hint, 'Escale um judge nesta estação ou peça a um judge livre que abra a estação.');

  const sled = live.alerts.find((alert) => alert.kind === 'judges_full' && alert.stationKey === 'sled-push');
  assert.equal(sled.text, 'Onda 3 · Sled Push: cerca de 1 atleta esperando e os 2 judges escalados estão no limite (2 de 2).');
  assert.equal(sled.hint, 'Escale mais um judge nesta estação.');
  assert.deepEqual(stationOf(live, 'sled-push').judges.map((judge) => judge.label), ['2 de 2 · no limite', '2 de 2 · no limite']);

  const wall = live.alerts.find((alert) => alert.kind === 'judges_full' && alert.stationKey === 'wall-balls');
  assert.equal(wall.text, 'Onda 3 · Wall Balls: cerca de 2 atletas esperando e o judge escalado está no limite (1 de 1: o Wall Ball é 1 atleta por judge).');
  assert.equal(stationOf(live, 'wall-balls').judges[0].label, '1 de 1 · no limite');
  assert.equal(stationOf(live, 'skierg').judges[0].state, 'free');
  // Ordem da maquete: Atletas sem judge, Judges lotados, Cartão sem judge, Judge acima do limite, Sem judge escalado.
  assert.deepEqual(kinds(live), ['athletes_without_judge:rowing', 'judges_full:sled-push', 'judges_full:wall-balls']);
});

test('judge acima do limite (3 cartões ou estação de 1 atleta misturada) e cartão sem judge', () => {
  const runs = [runOf('r1', 'men'), runOf('r2', 'men'), runOf('r3', 'men'), runOf('r4', 'women'), runOf('r5', 'women'), runOf('r6', 'women')];
  const attempts = [
    att('r1', 'burpee-broad-jump', 'sections', RAFA), att('r2', 'burpee-broad-jump', 'sections', RAFA), att('r3', 'burpee-broad-jump', 'sections', RAFA),
    att('r4', 'wall-balls', 'wall_ball', LIA), att('r5', 'farmers-carry', 'sections', LIA),
    att('r6', 'sled-push', 'sled', null, 'running', '2026-11-01T13:41:00.000Z')
  ];
  const assignments = [pair(RAFA, 'burpee-broad-jump'), pair(LIA, 'wall-balls'), pair(PAULA, 'sled-push')];
  const live = waveOf(build({ runs, attempts, assignments }), 'w3');

  const over = live.alerts.filter((alert) => alert.kind === 'judge_over_limit');
  const rafa = over.find((alert) => alert.stationKey === 'burpee-broad-jump');
  assert.equal(rafa.text, 'Onda 3 · Burpee Broad Jump: Judge Rafa está com 3 cartões abertos; o limite é 2.');
  assert.equal(rafa.hint, 'Peça ao judge que libere, solte ou dispense um cartão.');
  assert.equal(stationOf(live, 'burpee-broad-jump').judges[0].label, '3 de 2 · acima do limite');

  const lia = over.find((alert) => alert.stationKey === 'wall-balls');
  assert.equal(lia.text, 'Onda 3 · Wall Balls: Judge Lia está com o Wall Ball aberto junto de outro cartão; o Wall Ball é conferido sozinho.');
  assert.doesNotMatch(lia.hint, /solte|dispense/, 'D39: na estação de 1 atleta só o organizador libera');
  assert.match(lia.hint, /só o organizador libera/);
  // Lia abriu Farmers Carry sem estar escalada lá: aparece fora da escala e acima do limite (o aviso olha qualquer judge).
  const farmers = stationOf(live, 'farmers-carry');
  assert.equal(farmers.judges[0].outside, true);
  assert.equal(farmers.judges[0].state, 'over');

  const loose = live.alerts.find((alert) => alert.kind === 'card_without_judge');
  assert.equal(loose.text, 'Onda 3 · Sled Push: o cartão de r6 está sem judge desde 10:41. Os registros seguem guardados.');
  assert.equal(loose.hint, 'Peça a um judge da estação que assuma o cartão.');
  assert.equal(loose.openAssignments, false);
  assert.equal(stationOf(live, 'sled-push').cards[0].looseSince, '10:41');
  assert.equal(live.summary.looseCards, 1);
});

test('D40: evento sem escala não tem aviso nenhum (nem cartão sem judge nem acima do limite), nem estimativa, nem selo; só o resumo', () => {
  const runs = [runOf('r1', 'men'), runOf('r2', 'men'), runOf('r3', 'men'), runOf('r4', 'women')];
  const attempts = [
    att('r1', 'burpee-broad-jump', 'sections', RAFA), att('r2', 'burpee-broad-jump', 'sections', RAFA), att('r3', 'burpee-broad-jump', 'sections', RAFA),
    att('r4', 'sled-push', 'sled', null)
  ];
  const result = build({ runs, attempts, assignments: [] });
  assert.equal(result.hasAssignments, false);
  for (const wave of result.waves) {
    assert.deepEqual(wave.alerts, []);
    assert.equal(wave.source, null);
    assert.equal(wave.summary.waiting, null);
    for (const station of wave.stations) {
      assert.equal(station.status, 'no_schedule');
      assert.equal(station.waiting, null);
      assert.deepEqual(station.alerts, []);
    }
  }
  const live = waveOf(result, 'w3');
  const burpee = stationOf(live, 'burpee-broad-jump');
  assert.deepEqual(burpee.judges.map((judge) => [judge.name, judge.state, judge.outside, judge.label]), [['Judge Rafa', 'neutral', true, '3 cartões']]);
  assert.equal(stationOf(live, 'sled-push').cards[0].judgeUserId, null, 'cartão sem judge aparece como dado');
  assert.equal(live.summary.cards, 4);
  assert.equal(live.summary.judgesWithCard, 1);
  assert.equal(live.summary.stationsWithCard, 2);
  assert.equal(coverage.RACE_COVERAGE_NO_SCHEDULE_GUIDE, 'Este evento ainda não tem escala de judges. Sem escala, o painel não dá avisos de cobertura: abaixo fica só o que os judges já abriram, e quem abriu cartão está fora da escala. Monte a escala para ver a cobertura de cada onda.');
});

test('D41: judge fora da escala aparece marcado, não é aviso e não conta em lotados nem em escalados; estação só com judge de fora mantém "Sem judge escalado"', () => {
  const runs = [runOf('r1', 'men'), runOf('r2', 'men'), runOf('r3', 'women'), runOf('r4', 'women'), runOf('r5', 'women')];
  const attempts = [
    att('r1', 'farmers-carry', 'sections', DUDA), att('r2', 'farmers-carry', 'sections', TITO),
    att('r3', 'rowing', 'ergometer', TITO),
    att('r4', 'skierg', 'ergometer', BIA), att('r5', 'skierg', 'ergometer', BIA, 'released'),
    att('r5', 'sled-push', 'sled', CAIO), att('r4', 'sled-push', 'sled', PAULA, 'released')
  ];
  const assignments = [pair(DUDA, 'farmers-carry'), pair(BIA, 'skierg'), pair(PAULA, 'sled-push')];
  const live = waveOf(build({ runs, attempts, assignments }), 'w3');

  const farmers = stationOf(live, 'farmers-carry');
  assert.deepEqual(farmers.judges.map((judge) => [judge.name, judge.scheduled, judge.outside]), [['Judge Duda', true, false], ['Judge Tito', false, true]]);
  assert.equal(farmers.status, 'covered', 'fora da escala não acende Atenção');
  assert.equal(live.alerts.some((alert) => alert.stationKey === 'farmers-carry'), false);

  // Rowing só com Tito (de fora): continua "Sem judge escalado" (AUTO-DECISION v1.2), sem "Atletas sem judge".
  assert.deepEqual(stationOf(live, 'rowing').alerts, ['no_judge_scheduled']);
  assert.equal(stationOf(live, 'rowing').judges[0].outside, true);
  assert.equal(live.summary.outside, 2, 'Tito e Caio, fora da escala');
  assert.equal(live.summary.judgesScheduled, 3);

  // Sled Push: Paula escalada e livre, Caio de fora; com alguém esperando não há "Judges lotados".
  const waitingSled = waveOf(build({ runs: [...runs, runOf('r6', 'men')], attempts: [...attempts, att('r6', 'skierg', 'ergometer', BIA, 'released')], assignments }), 'w3');
  assert.equal(stationOf(waitingSled, 'sled-push').waiting, 1);
  assert.equal(waitingSled.alerts.some((alert) => alert.kind === 'judges_full'), false);
  // Paula lotada e Caio (de fora) com vaga: o de fora não alivia a conta, o aviso aparece.
  const paulaFull = waveOf(build({
    runs: [...runs, runOf('r6', 'men'), runOf('r7', 'men'), runOf('r8', 'men')],
    attempts: [...attempts, att('r6', 'skierg', 'ergometer', BIA, 'released'), att('r7', 'sled-push', 'sled', PAULA), att('r8', 'sled-push', 'sled', PAULA)],
    assignments
  }), 'w3');
  assert.equal(paulaFull.alerts.some((alert) => alert.kind === 'judges_full' && alert.stationKey === 'sled-push'), true);
  assert.match(paulaFull.alerts.find((alert) => alert.kind === 'judges_full').text, /o judge escalado está no limite \(2 de 2\)/);
});

test('tudo coberto: sem avisos; escala da onda própria; onda que o filtro abre', () => {
  const runs = [runOf('r1', 'women')];
  const attempts = [att('r1', 'skierg', 'ergometer', BIA)];
  const assignments = WOMEN.map((item) => pair(BIA, item.key, 'w3')).concat(MEN.map((item) => pair(TITO, item.key)));
  const result = build({ runs, attempts, assignments });
  const live = waveOf(result, 'w3');
  // Sandbag Lunges (só Men Pro) não está na escala própria da onda 3.
  assert.deepEqual(kinds(live), ['no_judge_scheduled:sandbag-lunges']);
  assert.equal(live.source, 'wave');
  assert.equal(waveOf(result, 'w5').source, 'default');
  const all = waveOf(build({ runs, attempts, assignments: MEN.map((item) => pair(BIA, item.key, 'w3')) }), 'w3');
  assert.deepEqual(all.alerts, []);
  assert.equal(all.summary.covered, all.summary.stations);
  assert.equal(result.defaultWaveId, 'w3', 'a onda em andamento');
  assert.equal(coverage.pickDefaultRaceCoverageWave([{ id: 'a', startedAt: '2026-11-01T10:00:00Z', inProgress: false }, { id: 'b', startedAt: null, inProgress: false }]), 'b');
  assert.equal(coverage.pickDefaultRaceCoverageWave([{ id: 'a', startedAt: '2026-11-01T10:00:00Z', inProgress: false }]), 'a');
  assert.equal(coverage.pickDefaultRaceCoverageWave([
    { id: 'a', startedAt: '2026-11-01T10:00:00Z', inProgress: true }, { id: 'b', startedAt: '2026-11-01T10:20:00Z', inProgress: true }
  ]), 'b', 'a que largou por último');
  assert.equal(coverage.RACE_COVERAGE_REFRESH_MS, 15_000);
  assert.deepEqual(coverage.describeRaceCoverageFailure('10:44:12'), {
    title: 'Não foi possível atualizar a cobertura.', detail: 'Mostrando a leitura das 10:44:12. Nova tentativa em 15 s.'
  });
});

// ---------------------------------------------------------------------------
// view=coverage (AC2) com o banco em memória
// ---------------------------------------------------------------------------

const MANAGER = { id: 'mgr-cobertura', name: 'Gestora Cobertura', email: 'cobertura@example.com', role: 'manager', service_valid_until: '2099-12-31' };
const OTHER_MANAGER = { id: 'mgr-outra-cobertura', name: 'Outra Gestora', email: 'outra-cob@example.com', role: 'manager', service_valid_until: '2099-12-31' };
const OWNER = { id: 'owner-cobertura', name: 'Dona', email: 'dona-cob@example.com', role: 'owner' };
const JP = { id: 'judge-cob-paula', name: 'Judge Paula', email: 'paula-cob@example.com', role: 'judge', parent_manager_id: MANAGER.id };
const JR = { id: 'judge-cob-rafa', name: 'Judge Rafa', email: 'rafa-cob@example.com', role: 'judge', parent_manager_id: MANAGER.id };
const JT = { id: 'judge-cob-tito', name: 'Judge Tito', email: 'tito-cob@example.com', role: 'judge', parent_manager_id: MANAGER.id };

const EVENT = 'ev-cobertura';
const runStage = (id, orderIndex) => ({ id, name: `Corrida ${orderIndex}`, type: 'run', orderIndex, distance: '1km' });
const LAYOUT = {
  'div-pro': [
    runStage('run-1', 0), { id: 'ski', name: 'SkiErg', type: 'station', orderIndex: 1, distance: '1000m' },
    runStage('run-2', 2), { id: 'sled', name: 'Sled Push', type: 'station', orderIndex: 3, distance: '50m' },
    runStage('run-3', 4), { id: 'wb', name: 'Wall Balls', type: 'station', orderIndex: 5, reps: 100 }
  ],
  'div-duo': [
    runStage('run-1', 0), { id: 'sled-duo', name: 'Sled Push', type: 'station', orderIndex: 1, distance: '50m' },
    runStage('run-2', 2), { id: 'box', name: 'Box Jump', type: 'station', orderIndex: 3, conferenceKind: 'generic' }
  ]
};
const ATHLETES = [['ath-ana', 'Ana', 'div-pro'], ['ath-bia', 'Bia', 'div-pro'], ['ath-cris', 'Cris', 'div-pro'], ['ath-davi', 'Davi', 'div-pro'], ['ath-dupla', 'Dupla', 'div-duo'], ['ath-eva', 'Eva', 'div-pro']];

const seed = async () => {
  database = createFakeSupabase({
    users: [MANAGER, OTHER_MANAGER, OWNER, JP, JR, JT],
    events: [
      {
        id: EVENT, name: 'Race Cobertura', date: '2026-11-01', location: 'Recife', organizer_id: MANAGER.id, event_type: 'fitness_racing', status: 'upcoming', time_zone: 'America/Fortaleza',
        event_schedule: [
          { id: 'heat-1', kind: 'heat', date: '2026-11-01', time: '08:00', title: 'Onda 1', heatNumber: 1, athleteIds: ['ath-ana', 'ath-bia', 'ath-cris', 'ath-davi', 'ath-dupla'] },
          { id: 'heat-2', kind: 'heat', date: '2026-11-01', time: '08:20', title: 'Onda 2', heatNumber: 2, athleteIds: ['ath-eva'] }
        ]
      },
      { id: 'ev-outra-cobertura', name: 'Race da Outra', date: '2026-11-03', location: 'Natal', organizer_id: OTHER_MANAGER.id, event_type: 'fitness_racing', status: 'upcoming', event_schedule: [] }
    ],
    event_judges: [JP, JR, JT].map((judge, index) => ({ event_id: EVENT, judge_user_id: judge.id, created_at: `2026-10-01T10:0${index}:00Z` })),
    divisions: Object.entries(LAYOUT).map(([id, course]) => ({ id, event_id: EVENT, name: id === 'div-pro' ? 'Pro' : 'Dupla', type: id === 'div-duo' ? 'duo' : 'individual', category: 'female', course_layout: course })),
    athletes: ATHLETES.map(([id, name, division]) => ({ id, name, box: 'Box Norte', division_id: division, email: `${id}@example.com` })),
    race_judge_assignments: [
      { id: 'rja-1', event_id: EVENT, judge_user_id: JP.id, station_key: 'sled-push', heat_id: null },
      { id: 'rja-2', event_id: EVENT, judge_user_id: JR.id, station_key: 'skierg', heat_id: null }
    ],
    workouts: [], scores: [], registrations: []
  });
  Object.assign(state, { missingRaceTables: false, missingAssignments: false });
  const ruleset = await race.ensureRaceRuleset(client, EVENT);
  const row = database.rows('race_rulesets').find((item) => item.id === ruleset.id);
  row.locked_at = '2026-11-01T11:00:00.000Z';
  database.rows('race_heat_marks').push({ event_id: EVENT, heat_id: 'heat-1', started_at: '2026-11-01T11:00:00.000Z', started_by_user_id: MANAGER.id, started_by_name: MANAGER.name });
  const statuses = { 'ath-ana': 'racing', 'ath-bia': 'racing', 'ath-cris': 'dnf', 'ath-davi': 'finished', 'ath-dupla': 'racing' };
  for (const [athleteId, status] of Object.entries(statuses)) {
    database.rows('race_runs').push({
      id: `run-${athleteId}`, event_id: EVENT, division_id: ATHLETES.find(([id]) => id === athleteId)[2], athlete_id: athleteId, heat_id: 'heat-1', ruleset_id: ruleset.id,
      status, started_at: '2026-11-01T11:00:00.000Z', finish_at: null, gross_seconds: null, penalty_seconds: 0, official_seconds: null, time_source: null,
      created_at: '2026-11-01T11:00:00.000Z', updated_at: '2026-11-01T11:00:00.000Z'
    });
  }
  const attempt = (id, athleteId, stationId, kind, judge, status) => database.rows('race_attempts').push({
    id, run_id: `run-${athleteId}`, event_id: EVENT, athlete_id: athleteId, station_id: stationId, station_kind: kind, lane: null,
    judge_user_id: judge ? judge.id : null, judge_name: judge ? judge.name : '', status, progress: { started: true, units: 2, expectedUnits: 4 }, started_at: null, ended_at: null,
    created_at: '2026-11-01T11:10:00.000Z', updated_at: '2026-11-01T11:10:00.000Z'
  });
  // Ana passou pelo SkiErg com Rafa e está no Sled Push com Tito (fora da escala).
  attempt('att-1', 'ath-ana', 'ski', 'ergometer', JR, 'released');
  attempt('att-2', 'ath-ana', 'sled', 'sled', JT, 'running');
  // Cris (DNF) e Davi (finished) não esperam estação; Bia e a dupla não têm tentativa: esperam a 1ª estação.
};

const cookie = (user) => `woda_session=${createSessionToken({ id: user.id, name: user.name, email: user.email, role: user.role })}`;
const get = async (user, query) => {
  const response = await GET(new Request(`http://localhost/api/race-sheets?${new URLSearchParams(query)}`, { headers: { cookie: cookie(user) } }));
  return { status: response.status, body: await response.json() };
};

test('view=coverage: judge fora da escala marcado, cartões, estimativa só de corridas racing, onda sem largar, sem e-mail', async () => {
  await seed();
  const response = await get(MANAGER, { view: 'coverage', eventId: EVENT });
  assert.equal(response.status, 200, response.body.error);
  const body = response.body;
  assert.equal(body.hasAssignments, true);
  assert.equal(body.assignmentsAvailable, true);
  assert.equal(body.defaultWaveId, 'heat-1');
  assert.deepEqual(body.waves.map((wave) => wave.id), ['heat-1', 'heat-2']);

  const wave1 = body.waves[0];
  assert.deepEqual(wave1.stations.map((station) => station.key), ['skierg', 'sled-push', 'box-jump', 'wall-balls'], 'posição no percurso, como na escala (1.104)');
  const sled = wave1.stations.find((station) => station.key === 'sled-push');
  assert.deepEqual(sled.judges.map((judge) => [judge.name, judge.scheduled, judge.outside]), [['Judge Paula', true, false], ['Judge Tito', false, true]]);
  assert.deepEqual(sled.cards.map((card) => [card.athleteName, card.judgeName, card.progress]), [['Ana', 'Judge Tito', '2 de 4 trechos · em andamento']]);
  // Bia (Pro) espera o SkiErg; a dupla espera o Sled Push (1ª do percurso dela); Cris e Davi não esperam.
  assert.equal(wave1.stations.find((station) => station.key === 'skierg').waiting, 1);
  assert.equal(sled.waiting, 1);
  assert.equal(wave1.summary.waiting, 2);
  assert.deepEqual(wave1.stations.find((station) => station.key === 'wall-balls').onlyIn, ['Pro']);
  assert.equal(wave1.stations.find((station) => station.key === 'wall-balls').limit, 1);
  assert.equal(wave1.stations.find((station) => station.key === 'box-jump').limit, 1, 'estação final da dupla (D39)');
  assert.ok(wave1.alerts.some((alert) => alert.kind === 'no_judge_scheduled' && alert.stationKey === 'wall-balls'));
  assert.equal(wave1.alerts.some((alert) => alert.stationKey === 'sled-push' && alert.kind === 'no_judge_scheduled'), false);

  const wave2 = body.waves[1];
  assert.equal(wave2.startedAt, null);
  assert.equal(wave2.summary.waiting, null);
  assert.ok(wave2.stations.every((station) => station.waiting === null && station.cards.length === 0));

  const text = JSON.stringify(body);
  assert.doesNotMatch(text, /@example\.com|email|payment|paymentStatus|amount/i, 'sem e-mail e sem pagamento');
});

test('view=coverage: gestor dono e owner leem; judge 403; gestor de outro evento recusado; evento obrigatório', async () => {
  await seed();
  assert.equal((await get(OWNER, { view: 'coverage', eventId: EVENT })).status, 200);
  const judge = await get(JP, { view: 'coverage', eventId: EVENT });
  assert.equal(judge.status, 403);
  assert.equal((await get(OTHER_MANAGER, { view: 'coverage', eventId: EVENT })).status, 403);
  assert.equal((await get(MANAGER, { view: 'coverage' })).status, 400);
});

test('view=coverage sem a tabela da escala (migration da 1.104 não aplicada): segue como evento sem escala, sem quebrar', async () => {
  await seed();
  state.missingAssignments = true;
  const response = await get(MANAGER, { view: 'coverage', eventId: EVENT });
  assert.equal(response.status, 200, response.body.error);
  assert.equal(response.body.assignmentsAvailable, false);
  assert.equal(response.body.assignmentsMigration, '20261101120000_race_judge_assignments.sql');
  assert.equal(response.body.hasAssignments, false);
  assert.ok(response.body.waves.every((wave) => wave.alerts.length === 0 && wave.summary.waiting === null));
  const sled = response.body.waves[0].stations.find((station) => station.key === 'sled-push');
  assert.deepEqual(sled.judges.map((judge) => [judge.name, judge.state, judge.label]), [['Judge Tito', 'neutral', '1 cartão']]);
  // Sem nenhuma linha de escala também é evento sem escala.
  state.missingAssignments = false;
  database.rows('race_judge_assignments').splice(0);
  const empty = await get(MANAGER, { view: 'coverage', eventId: EVENT });
  assert.equal(empty.body.assignmentsAvailable, true);
  assert.equal(empty.body.hasAssignments, false);
  assert.ok(empty.body.waves.every((wave) => wave.alerts.length === 0));
});

test('view=coverage é só leitura: não grava em nenhuma tabela', async () => {
  await seed();
  const snapshot = JSON.stringify(['race_runs', 'race_attempts', 'race_judge_assignments', 'race_rulesets', 'race_heat_marks'].map((table) => database.rows(table)));
  assert.equal((await get(MANAGER, { view: 'coverage', eventId: EVENT })).status, 200);
  assert.equal(JSON.stringify(['race_runs', 'race_attempts', 'race_judge_assignments', 'race_rulesets', 'race_heat_marks'].map((table) => database.rows(table))), snapshot);
});

// ---------------------------------------------------------------------------
// Estático do painel e regressão
// ---------------------------------------------------------------------------

test('painel: seção em RaceSheetPanel, 15 s com a aba visível, Atualizar, falha sem tela em branco, selos e textos da maquete; admin/page.tsx sem edição', () => {
  const container = read('../src/components/admin/RaceSheetPanel.tsx');
  assert.match(container, /import \{ RaceCoveragePanel \} from '@\/components\/admin\/RaceCoveragePanel';/);
  assert.match(container, /<RaceCoveragePanel event=\{event\} \/>\s*<RacePenaltiesPanel event=\{event\} \/>/, 'primeira seção, acima de Penalidades');
  const panel = read('../src/components/admin/RaceCoveragePanel.tsx');
  assert.match(panel, /view=coverage/);
  assert.match(panel, /visibilitychange/);
  assert.match(panel, /document\.visibilityState === 'visible'/);
  assert.match(panel, /RACE_COVERAGE_REFRESH_MS/);
  assert.match(panel, /clearInterval/);
  assert.match(panel, /refreshButton\('Atualizar'\)/);
  assert.match(panel, /Atualizado às/);
  assert.match(panel, /refreshButton\('Tentar de novo'\)/);
  assert.match(panel, /Falha de rede mantém o último dado/);
  assert.match(panel, /Cobertura ao vivo/);
  assert.match(panel, />Fora da escala</);
  assert.match(panel, /Judges com cartão aberto/);
  assert.match(panel, /Montar a escala/);
  assert.match(panel, /Escala desta onda/);
  assert.match(panel, /Abrir a escala da onda/);
  assert.match(panel, /Ver a estação/);
  assert.match(panel, />Sem escala</);
  assert.match(panel, />Coberta</);
  assert.match(panel, />Atenção</);
  assert.match(panel, /Atletas esperando \(estimativa\)/);
  assert.match(panel, /Carregando a cobertura…/);
  assert.match(panel, /focusRaceAssignmentsWave/);
  assert.doesNotMatch(panel, /<table/, 'cartões altos, sem tabela (D20)');
  assert.doesNotMatch(panel, /method: 'POST'|claim_attempt|release_attempt|dismiss_attempt/, 'só avisa, não age (D3)');
  assert.doesNotMatch(panel.replace(/^\/\/[^\n]*$/gm, ''), /\bDQ\b|desclassific/i, 'sem DQ (D27)');
  const escala = read('../src/components/admin/RaceAssignmentsPanel.tsx');
  assert.match(escala, /RACE_ASSIGNMENTS_FOCUS_EVENT/);
  assert.match(escala, /id="race-assignments"/);
  assert.doesNotMatch(read('../src/app/admin/page.tsx'), /RaceCoveragePanel|view=coverage|raceCoverage/);
  // Maquete aprovada citada (AC1, D42).
  assert.ok(existsSync(new URL('../docs/design/fitness-race-sumula/telas/cobertura.html', import.meta.url)));
  assert.match(read('../src/lib/raceCoverage.ts'), /telas\/cobertura\.html/);
  assert.match(read('../docs/design/fitness-race-sumula/DECISOES.md'), /D42[^\n]*cobertura\.html/);
});

test('regressão: rota com view=coverage de gestor, nada no bootstrap, RacePenaltiesPanel intocado, open_attempt não lê a cobertura, FF intacto', () => {
  const route = read('../src/app/api/race-sheets/route.ts');
  assert.match(route, /view === 'coverage'[\s\S]{0,200}assertRaceManagerAccess/);
  assert.match(route, /import \{ readRaceCoverage \} from '@\/lib\/serverRaceCoverage';/);
  for (const file of ['../src/app/api/app/bootstrap/route.ts', '../src/app/api/app/bootstrap/public/route.ts']) {
    assert.doesNotMatch(read(file), /coverage|raceCoverage|race_judge_assignments/i);
  }
  assert.doesNotMatch(read('../src/components/admin/RacePenaltiesPanel.tsx'), /coverage|Cobertura/i);
  const server = read('../src/lib/serverRaceCoverage.ts');
  assert.doesNotMatch(server, /\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(/, 'só leitura');
  const sheets = read('../src/lib/serverRaceSheets.ts');
  assert.doesNotMatch(sheets, /raceCoverage|readRaceCoverage/);
  assert.doesNotMatch(read('../src/app/api/sheets/route.ts'), /coverage/i);
});
