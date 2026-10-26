import assert from 'node:assert/strict';
import test from 'node:test';

import { importServerModule } from './support/serverModuleHarness.mjs';

import {
  WORKOUT_STRUCTURE_LIMITS,
  WORKOUT_STRUCTURE_VERSION,
  checkOfficialTime,
  checkTonnageEntry,
  computeTonnageResult,
  deriveLegacyWorkoutFields,
  deriveSheetState,
  deriveTonnageState,
  formatTonnageKg,
  isTonnageLoad,
  parseTonnageKgInput,
  reconcileWorkoutStructure,
  validateWorkoutStructure
} from '../src/lib/workoutStructure.ts';

// Story 1.77: versão 5 do contrato da estrutura da prova e o motor da
// Tonelagem (docs/design/tonelagem/tonelagem-aprovado.html). Contrato (formato
// tonnage, bloco tonnage, time cap obrigatório), normalização da 1 a 4 para a
// 5, motor (liberação com trava, carga declarada, incremento, janela, teto),
// resultado, registros do servidor, ausente, progresso ao vivo e o caso de
// teste aprovado. Se o caso aprovado falhar, o resultado ou o ranking mudou.

const { computeSheetOutcome, computeAbsentOutcome, validateClientEvent } = await importServerModule('lib/scoresheet.ts');
const { rankWorkoutScores } = await importServerModule('lib/scoring.ts');
const { summarizeLiveProgress, readLiveProgress } = await importServerModule('lib/liveProgress.ts');
const { rankLiveEntries } = await importServerModule('lib/liveHeatRanking.ts');
const { describeWorkoutForBoard } = await importServerModule('lib/serverBroadcast.ts');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const segmentOf = (id, name, reps, extra = {}) => ({
  id, round: 1, name, reps, unit: 'reps', load: null, note: '', required: true, mark: 'reps', ...extra
});

const tonnageBlock = (overrides = {}, liftOverrides = {}, incrementOverrides = {}) => ({
  position: 2,
  lift: { id: 'sc', name: 'Squat Clean', loadKg: null, note: '', ...liftOverrides },
  loadMode: 'athlete',
  increment: { allowed: false, stepKg: 2.5, ...incrementOverrides },
  note: '10 Pull Ups; 10 Burpees; Max. Squat Clean',
  ...overrides
});

// Treino 1: 10 Pull Ups e 10 Burpees liberam, Squat Clean conta (time cap de 10:00).
const tonnageInput = (overrides = {}, blockOverrides = {}, liftOverrides = {}, incrementOverrides = {}) => ({
  version: 5,
  format: 'tonnage',
  totalReps: 20,
  timeCapSeconds: 600,
  incomplete: null,
  tieBreak: null,
  generator: null,
  customized: true,
  entry: { mode: 'both', marking: 'reps', publish: 'after_review' },
  segments: [segmentOf('pu', 'Pull Ups', 10), segmentOf('bp', 'Burpees', 10)],
  maxLoad: null,
  scoreDisplay: null,
  interval: null,
  distance: null,
  tonnage: tonnageBlock(blockOverrides, liftOverrides, incrementOverrides),
  ...overrides
});

// Treino 2: um exercício só, sem liberação (time cap de 03:00).
const snatchInput = (blockOverrides = {}, liftOverrides = {}, incrementOverrides = {}) => tonnageInput({
  totalReps: 0,
  timeCapSeconds: 180,
  segments: []
}, { position: 0, note: '', ...blockOverrides }, { id: 'sn', name: 'Squat Snatch', ...liftOverrides }, incrementOverrides);

const forTimeV2 = () => ({
  version: 2, format: 'for_time', totalReps: 21, timeCapSeconds: 600,
  incomplete: { rule: 'penalty_per_rep', secondsPerRep: 1, base: 'time_cap' }, tieBreak: null, generator: null, customized: true,
  entry: { mode: 'both', marking: 'reps', publish: 'after_review' },
  segments: [segmentOf('a', 'Thruster', 21)], maxLoad: null, scoreDisplay: null
});
const forTimeV1 = () => {
  const input = forTimeV2();
  delete input.maxLoad;
  delete input.scoreDisplay;
  input.version = 1;
  input.segments = input.segments.map((item) => {
    const copy = { ...item };
    delete copy.unit;
    return copy;
  });
  return input;
};
const forTimeV3 = () => ({ ...forTimeV2(), version: 3, interval: null });
const forTimeV4 = () => ({ ...forTimeV3(), version: 4, distance: null });

const valid = (input) => {
  const checked = validateWorkoutStructure(input);
  assert.equal(checked.ok, true, checked.error);
  return checked.structure;
};
const rejects = (input, pattern, label) => {
  const checked = validateWorkoutStructure(input);
  assert.equal(checked.ok, false, label);
  if (pattern) assert.match(checked.error, pattern, label);
  return checked.error;
};

const KEYS = ['version', 'format', 'totalReps', 'timeCapSeconds', 'incomplete', 'tieBreak', 'generator', 'customized', 'entry', 'segments', 'maxLoad', 'scoreDisplay', 'interval', 'distance', 'tonnage'];

const TREINO1 = valid(tonnageInput());
const TREINO2 = valid(snatchInput());
const TREINO2_UP = valid(snatchInput({}, {}, { allowed: true, stepKg: 10 }));
const PRESCRITA = valid(snatchInput({ loadMode: 'prescribed' }, { loadKg: 60 }));

const load = (v, at = 0) => ({ t: 'load', v, at });
const lrep = (loadKg, at) => ({ t: 'lrep', load: loadKg, at });
const rep = (seg, at) => ({ t: 'rep', seg, at });
const undo = (of, at = 170) => ({ t: 'undo', of, at });
const times = (count, make) => Array.from({ length: count }, (_, index) => make(index));
const reps10 = (seg, from = 1) => times(10, (index) => rep(seg, from + index));

// ---------------------------------------------------------------------------
// Contrato v5
// ---------------------------------------------------------------------------

test('versão 5: a tonelagem é aceita, normalizada e idempotente, com as chaves do contrato na ordem', () => {
  assert.equal(WORKOUT_STRUCTURE_VERSION, 5);
  assert.equal(WORKOUT_STRUCTURE_LIMITS.maxTonnageKg, 99999);
  assert.deepEqual(TREINO1, {
    version: 5,
    format: 'tonnage',
    totalReps: 20,
    timeCapSeconds: 600,
    incomplete: null,
    tieBreak: null,
    generator: null,
    customized: true,
    entry: { mode: 'both', marking: 'reps', publish: 'after_review' },
    segments: [segmentOf('pu', 'Pull Ups', 10), segmentOf('bp', 'Burpees', 10)],
    maxLoad: null,
    scoreDisplay: null,
    interval: null,
    distance: null,
    tonnage: {
      position: 2,
      lift: { id: 'sc', name: 'Squat Clean', loadKg: null, note: '' },
      loadMode: 'athlete',
      increment: { allowed: false, stepKg: 2.5 },
      note: '10 Pull Ups; 10 Burpees; Max. Squat Clean'
    }
  });
  assert.deepEqual(Object.keys(TREINO1), KEYS);
  assert.deepEqual(valid(JSON.parse(JSON.stringify(TREINO1))), TREINO1, 'validar de novo devolve a mesma estrutura');

  // Textos sem espaços nas pontas; o resultado é um objeto novo.
  const input = tonnageInput({}, { note: '   ' }, { name: '  Squat Clean  ', id: ' sc ' });
  const normalized = valid(input);
  assert.equal(normalized.tonnage.note, '');
  assert.equal(normalized.tonnage.lift.name, 'Squat Clean');
  assert.equal(normalized.tonnage.lift.id, 'sc');
  assert.notEqual(normalized, input);
  assert.notEqual(normalized.tonnage, input.tonnage);
  assert.notEqual(normalized.tonnage.lift, input.tonnage.lift);
  assert.notEqual(normalized.tonnage.increment, input.tonnage.increment);
  assert.equal(valid(tonnageInput({}, { note: `  ${'x'.repeat(300)}  ` })).tonnage.note.length, 300);
});

test('versão 5: o time cap é obrigatório, de 30 a 5999 s', () => {
  const message = /^Na tonelagem o time cap é obrigatório: informe um número inteiro de segundos entre 30 e 5999 \(de 00:30 a 99:59\)\.$/;
  rejects(tonnageInput({ timeCapSeconds: null }), message, 'sem time cap');
  rejects(tonnageInput({ timeCapSeconds: 29 }), message);
  rejects(tonnageInput({ timeCapSeconds: 6000 }), message);
  rejects(tonnageInput({ timeCapSeconds: 90.5 }), message);
  rejects(tonnageInput({ timeCapSeconds: '600' }), message);
  assert.equal(valid(tonnageInput({ timeCapSeconds: 30 })).timeCapSeconds, 30);
  assert.equal(valid(tonnageInput({ timeCapSeconds: 5999 })).timeCapSeconds, 5999);
});

test('versão 5: exercícios de 0 a 9, posição do que conta, rodada 1 e total igual à soma', () => {
  assert.equal(valid(snatchInput()).segments.length, 0);
  const many = (count) => Array.from({ length: count }, (_, index) => segmentOf(`s${index}`, `Mov ${index}`, 5));
  assert.equal(valid(tonnageInput({ segments: many(9), totalReps: 45 }, { position: 9 })).segments.length, 9);
  rejects(tonnageInput({ segments: many(10), totalReps: 50 }, { position: 9 }), /^Na tonelagem, a lista de segmentos tem de 0 a 9 exercícios além do que conta\.$/);

  // O que conta pode ficar em qualquer posição (0, no meio ou depois de todos).
  for (const position of [0, 1, 2]) assert.equal(valid(tonnageInput({}, { position })).tonnage.position, position);
  const positionMessage = /^Na tonelagem, a posição do exercício que conta \(position\) deve ser um número inteiro de 0 até a quantidade de exercícios da lista de segmentos\.$/;
  rejects(tonnageInput({}, { position: 3 }), positionMessage);
  rejects(tonnageInput({}, { position: -1 }), positionMessage);
  rejects(tonnageInput({}, { position: 1.5 }), positionMessage);
  rejects(tonnageInput({}, { position: '1' }), positionMessage);

  rejects(tonnageInput({ segments: [segmentOf('pu', 'Pull Ups', 10, { round: 2 }), segmentOf('bp', 'Burpees', 10)] }), /^Segmento 1: na tonelagem os exercícios descrevem uma rodada só/);
  rejects(tonnageInput({ totalReps: 21 }), /^O total de repetições da prova deve ser igual à soma das repetições dos segmentos \(20\)\.$/);
  rejects(tonnageInput({}, {}, { id: 'pu' }), /^Exercício da tonelagem: o identificador repete o de outro exercício\.$/);
  rejects(tonnageInput({}, {}, { id: 'a b' }), /^Exercício da tonelagem: o identificador deve ter de 1 a 40 caracteres/);
  rejects(tonnageInput({}, {}, { name: '   ' }), /^Exercício da tonelagem: informe o nome do movimento, com até 60 caracteres\.$/);
  rejects(tonnageInput({}, {}, { name: 'x'.repeat(61) }), /^Exercício da tonelagem: informe o nome do movimento/);
  // Metros e calorias valem nos exercícios de liberação, como no For Time (em metros, o judge só conclui o bloco).
  const run = segmentOf('rn', 'Corrida', 400, { unit: 'm', mark: 'end' });
  assert.equal(valid(tonnageInput({ segments: [run], totalReps: 400 }, { position: 1 })).segments[0].unit, 'm');
});

test('versão 5: a origem da carga, o incremento e o resumo têm formato fixo', () => {
  // Livre: loadKg vazio. Prescrita: loadKg de 0,25 a 500, em múltiplos de 0,25.
  const prescribed = /^Na tonelagem com carga prescrita, informe a carga do exercício \(loadKg\) entre 0\.25 e 500 kg, em múltiplos de 0\.25; com carga livre ela fica vazia \(null\)\.$/;
  assert.equal(valid(snatchInput({ loadMode: 'prescribed' }, { loadKg: 60 })).tonnage.lift.loadKg, 60);
  assert.equal(valid(snatchInput({ loadMode: 'prescribed' }, { loadKg: 42.5 })).tonnage.lift.loadKg, 42.5);
  rejects(snatchInput({ loadMode: 'prescribed' }, { loadKg: null }), prescribed);
  rejects(snatchInput({ loadMode: 'prescribed' }, { loadKg: 0 }), prescribed);
  rejects(snatchInput({ loadMode: 'prescribed' }, { loadKg: 501 }), prescribed);
  rejects(snatchInput({ loadMode: 'prescribed' }, { loadKg: 60.1 }), prescribed);
  rejects(snatchInput({ loadMode: 'athlete' }, { loadKg: 60 }), prescribed);
  rejects(snatchInput({ loadMode: 'qualquer' }), /^Na tonelagem, a origem da carga \(loadMode\) deve ser athlete \(livre\) ou prescribed \(prescrita pelo gestor\)\.$/);

  const increment = /^Na tonelagem, o incremento deve informar se é permitido \(allowed\) e o passo \(stepKg\) entre 0\.25 e 25 kg, em múltiplos de 0\.25\.$/;
  assert.deepEqual(valid(snatchInput({}, {}, { allowed: true, stepKg: 10 })).tonnage.increment, { allowed: true, stepKg: 10 });
  assert.equal(valid(snatchInput({}, {}, { allowed: false, stepKg: 0.25 })).tonnage.increment.stepKg, 0.25);
  assert.equal(valid(snatchInput({}, {}, { allowed: true, stepKg: 25 })).tonnage.increment.stepKg, 25);
  rejects(snatchInput({}, {}, { stepKg: 0.2 }), increment);
  rejects(snatchInput({}, {}, { stepKg: 26 }), increment);
  rejects(snatchInput({}, {}, { stepKg: 2.6 }), increment);
  rejects(snatchInput({}, {}, { allowed: 'sim' }), increment);
  rejects(snatchInput({ increment: null }), increment);
  rejects(snatchInput({ increment: { allowed: true, stepKg: 2.5, extra: 1 } }), increment);

  rejects(snatchInput({ note: 'x'.repeat(301) }), /^Na tonelagem, o resumo da prova \(note\) deve ser um texto de até 300 caracteres \(pode ficar vazio\)\.$/);
  rejects(snatchInput({ note: 5 }), /^Na tonelagem, o resumo da prova \(note\)/);
});

test('versão 5: o campo tonnage é obrigatório na tonelagem e vazio nos outros formatos; chaves estranhas e caractere nulo são recusados', () => {
  const onlyThere = /^O campo tonnage só existe em provas de tonelagem: fora delas fica vazio \(null\)\.$/;
  const shape = /^Na tonelagem, informe o campo tonnage/;
  rejects(tonnageInput({ tonnage: null }), shape);
  rejects(tonnageInput({ tonnage: 'x' }), shape);
  rejects(tonnageInput({ tonnage: { ...tonnageBlock(), lift: null } }), shape);
  rejects({ ...forTimeV4(), version: 5 }, /^O campo interval só existe|^O campo distance só existe|^O campo tonnage só existe/);
  rejects({ ...forTimeV4(), version: 5, tonnage: tonnageBlock() }, onlyThere);
  assert.equal(valid({ ...forTimeV4(), version: 5, tonnage: null }).tonnage, null);

  const unknown = /^O campo tonnage tem um campo que não faz parte do contrato\.$/;
  rejects(tonnageInput({ tonnage: { ...tonnageBlock(), extra: 1 } }), unknown);
  rejects(tonnageInput({}, {}, { extra: 1 }), unknown);
  rejects({ ...tonnageInput(), extra: 1 }, /^A estrutura da prova tem um campo que não faz parte do contrato\.$/);
  const nullChar = /caractere nulo/;
  rejects(tonnageInput({}, { note: 'a\u0000b' }), nullChar);
  rejects(tonnageInput({}, {}, { name: 'a\u0000b' }), nullChar);
  rejects(tonnageInput({}, {}, { note: 'a\u0000b' }), nullChar);

  // Sem eco do que foi enviado e sem lançar, mesmo com um getter hostil.
  const echoed = rejects(snatchInput({}, {}, { stepKg: 'SEGREDO'.repeat(20) }));
  assert.doesNotMatch(echoed, /SEGREDO|\{|"/);
  const hostile = snatchInput();
  Object.defineProperty(hostile.tonnage, 'position', { enumerable: true, get() { throw new Error('boom'); } });
  assert.deepEqual(validateWorkoutStructure(hostile), { ok: false, error: 'A estrutura da prova é inválida.' });
});

test('versão 5: tonelagem não tem desempate, regra de não conclusão, gerador nem os campos dos outros formatos', () => {
  rejects(tonnageInput({ tieBreak: { kind: 'split_time', at: 'pu', order: 'asc' } }), /^A tonelagem não tem desempate nesta versão: o campo fica vazio \(null\)\.$/);
  rejects(tonnageInput({ tieBreak: { kind: 'last_round', order: 'asc' } }), /^A tonelagem não tem desempate/);
  rejects(tonnageInput({ incomplete: { rule: 'penalty_per_rep', secondsPerRep: 1, base: 'time_cap' } }), /^Na tonelagem, a regra de não conclusão deve ficar vazia \(null\)\.$/);
  rejects(tonnageInput({ generator: { kind: 'fixed', reps: [10] }, customized: false }), /^Na tonelagem o gerador deve ficar vazio \(null\)\.$/);
  rejects(tonnageInput({ maxLoad: { lifts: [], order: 'fixed', scoring: 'sum', loadStepKg: 2.5 } }), /^Os movimentos de carga só existem/);
  rejects(tonnageInput({ interval: { rounds: 2 } }), /^O campo interval só existe/);
  rejects(tonnageInput({ distance: { unit: 'm', note: '' } }), /^O campo distance só existe/);
  rejects(tonnageInput({ scoreDisplay: 'total' }), /^No AMRAP, o score aparece/);
  rejects(tonnageInput({ customized: false }), /^Estrutura personalizada/);
});

test('versões: a 1, a 2, a 3 e a 4 entram e saem na 5 com tonnage vazio; nelas a tonelagem é recusada com mensagem própria', () => {
  const fromV1 = valid(forTimeV1());
  const fromV2 = valid(forTimeV2());
  const fromV3 = valid(forTimeV3());
  const fromV4 = valid(forTimeV4());
  for (const structure of [fromV1, fromV2, fromV3, fromV4]) {
    assert.equal(structure.version, 5);
    assert.equal(structure.tonnage, null);
    assert.deepEqual(Object.keys(structure), KEYS);
    assert.deepEqual(valid(structure), structure, 'a 5 revalidada é igual');
  }
  assert.deepEqual(fromV1, fromV2);
  assert.deepEqual(fromV2, fromV3);
  assert.deepEqual(fromV3, fromV4);

  const ownMessage = /^O formato tonelagem \(tonnage\) e o campo tonnage exigem a versão 5 da estrutura\.$/;
  rejects({ ...tonnageInput(), version: 4 }, ownMessage, 'v4 com o formato e a chave');
  for (const [version, base] of [[1, forTimeV1()], [2, forTimeV2()], [3, forTimeV3()], [4, forTimeV4()]]) {
    rejects({ ...base, format: 'tonnage' }, ownMessage, `v${version} com o formato`);
  }
  rejects({ ...forTimeV4(), tonnage: null }, ownMessage, 'v4 com a chave');
  rejects({ ...forTimeV3(), tonnage: null }, ownMessage);
  rejects({ ...forTimeV1(), tonnage: null }, ownMessage);
  rejects({ ...forTimeV2(), format: 'tonnage' }, ownMessage);
  rejects({ ...tonnageInput(), version: 6 }, /^A versão da estrutura da prova deve ser 1, 2, 3, 4 ou 5\.$/);
});

test('reconcileWorkoutStructure copia o tonnage por valor; campos legados da tonelagem são tonnage, o time cap e sem desempate', () => {
  const copy = reconcileWorkoutStructure(TREINO1);
  assert.deepEqual(copy, TREINO1);
  assert.notEqual(copy.tonnage, TREINO1.tonnage);
  assert.notEqual(copy.tonnage.lift, TREINO1.tonnage.lift);
  assert.notEqual(copy.tonnage.increment, TREINO1.tonnage.increment);
  copy.tonnage.lift.name = 'Outro';
  assert.equal(TREINO1.tonnage.lift.name, 'Squat Clean');
  assert.deepEqual(deriveLegacyWorkoutFields(TREINO1), { type: 'tonnage', timeCap: '10:00', tieBreaker: '' });
  assert.deepEqual(deriveLegacyWorkoutFields(TREINO2), { type: 'tonnage', timeCap: '03:00', tieBreaker: '' });
});

// ---------------------------------------------------------------------------
// Carga válida, total digitado e formatação
// ---------------------------------------------------------------------------

test('isTonnageLoad: de 0,25 a 500 kg em múltiplos de 0,25', () => {
  for (const ok of [0.25, 0.5, 2.5, 42.5, 60, 100.75, 500]) assert.equal(isTonnageLoad(ok), true, String(ok));
  for (const bad of [0, -5, 0.1, 60.3, 500.25, 501, Number.NaN, Infinity, '60', null, undefined]) assert.equal(isTonnageLoad(bad), false, String(bad));
});

test('parseTonnageKgInput: kg com vírgula decimal e ponto de milhar; recusa o resto com a mensagem da tela', () => {
  const accepted = [
    ['830', 830], ['0', 0], ['1652.5', 1652.5], ['1.652,5', 1652.5], ['1652,5', 1652.5], ['1.652', 1652], ['99.999', 99999],
    ['830,25', 830.25], ['42.5', 42.5], ['  1.652,50 ', 1652.5], ['12.345.678', null]
  ];
  for (const [typed, kg] of accepted) {
    const parsed = parseTonnageKgInput(typed);
    if (kg === null) assert.equal(parsed.ok, false, typed);
    else assert.deepEqual(parsed, { ok: true, kg }, typed);
  }
  const format = /^Use kg com até duas casas \(ex\.: 830 ou 1\.652,5\)\.$/;
  for (const typed of ['1,652.5', '830,255', '-5', 'abc', '1..5', '1,2,3', '8 30a', '1.65.2']) {
    const parsed = parseTonnageKgInput(typed);
    assert.equal(parsed.ok, false, typed);
    assert.match(parsed.error, format, typed);
  }
  assert.deepEqual(parseTonnageKgInput(''), { ok: false, error: 'Informe a tonelagem em kg.' });
  assert.deepEqual(parseTonnageKgInput('   '), { ok: false, error: 'Informe a tonelagem em kg.' });
  assert.deepEqual(parseTonnageKgInput('100.000'), { ok: false, error: 'A tonelagem passa de 99.999 kg. Confira o número.' });
  assert.deepEqual(parseTonnageKgInput('99999,5'), { ok: false, error: 'A tonelagem passa de 99.999 kg. Confira o número.' });
  assert.deepEqual(parseTonnageKgInput('830.255,5'), { ok: false, error: 'A tonelagem passa de 99.999 kg. Confira o número.' }, '830.255,5 é um número válido, grande demais');
  // O ponto seguido de exatamente três dígitos é de milhar: "1.652" é 1652, nunca 1,652.
  assert.deepEqual(parseTonnageKgInput('1.652'), { ok: true, kg: 1652 });
  for (const hostile of [null, undefined, 830, {}, [], () => 1]) assert.deepEqual(parseTonnageKgInput(hostile), { ok: false, error: 'Informe a tonelagem em kg.' });
});

test('formatTonnageKg: vírgula decimal e ponto de milhar sem depender de Intl', () => {
  assert.equal(formatTonnageKg(0), '0');
  assert.equal(formatTonnageKg(830), '830');
  assert.equal(formatTonnageKg(1652.5), '1.652,5');
  assert.equal(formatTonnageKg(99999), '99.999');
  assert.equal(formatTonnageKg(42.25), '42,25');
  assert.equal(formatTonnageKg(-3), '0');
  assert.equal(formatTonnageKg(Number.NaN), '0');
});

// ---------------------------------------------------------------------------
// Motor
// ---------------------------------------------------------------------------

test('motor: Treino 2 com incremento permitido soma 60 kg × 8 e 70 kg × 5 = 830 kg em 13 repetições', () => {
  const events = [load(60), ...times(8, (index) => lrep(60, 10 + index)), load(70, 40), ...times(5, (index) => lrep(70, 50 + index))];
  const state = deriveTonnageState(TREINO2_UP, events);
  assert.equal(state.format, 'tonnage');
  assert.equal(state.tonnageKg, 830);
  assert.equal(state.reps, 13);
  assert.deepEqual(state.groups, [{ loadKg: 60, reps: 8, kg: 480 }, { loadKg: 70, reps: 5, kg: 350 }]);
  assert.deepEqual([state.declaredKg, state.loadKg, state.lastRepAt, state.released, state.releasedAt], [60, 70, 54, true, 0]);
  assert.deepEqual(state.ignored, []);
  const result = computeTonnageResult(state);
  assert.deepEqual([result.value, result.display, result.tieBreak, result.entered, result.reps], [830, '830', null, true, 13]);
});

test('motor: incremento não permitido mantém a carga declarada; o novo load e as repetições com ele não contam', () => {
  const events = [load(60), lrep(60, 10), lrep(60, 11), load(70, 20), lrep(70, 21), lrep(60, 22)];
  const state = deriveTonnageState(TREINO2, events);
  assert.equal(state.tonnageKg, 180, '3 repetições de 60 kg');
  assert.equal(state.loadKg, 60);
  assert.deepEqual(state.ignored, [3, 4], 'o load 70 e a repetição com 70 ficam fora');
});

test('motor: o incremento só sobe, em múltiplos do passo, e a repetição precisa usar a carga vigente', () => {
  const events = [
    load(60), lrep(60, 5),
    load(60, 6),   // não sobe
    load(65, 7),   // não é múltiplo do passo (10)
    load(50, 8),   // desce
    lrep(70, 9),   // 70 ainda não é a carga vigente
    load(80, 10),  // 2 passos de 10: vale
    lrep(80, 11), lrep(70, 12)
  ];
  const state = deriveTonnageState(TREINO2_UP, events);
  assert.equal(state.loadKg, 80);
  assert.equal(state.tonnageKg, 140, '60 + 80');
  assert.deepEqual(state.ignored, [2, 3, 4, 5, 8]);
});

test('motor: a carga prescrita só vale como a declarada pelo gestor', () => {
  assert.equal(deriveTonnageState(PRESCRITA, [load(50), lrep(50, 5)]).declaredKg, null, 'outra carga não declara');
  assert.deepEqual(deriveTonnageState(PRESCRITA, [load(50), lrep(50, 5)]).ignored, [0, 1]);
  const ok = deriveTonnageState(PRESCRITA, [load(60), lrep(60, 5), lrep(60, 6)]);
  assert.deepEqual([ok.declaredKg, ok.tonnageKg, ok.reps], [60, 120, 2]);
});

test('motor: sem carga declarada nenhuma repetição conta', () => {
  const state = deriveTonnageState(TREINO2, [lrep(60, 5), lrep(60, 6)]);
  assert.deepEqual([state.declaredKg, state.loadKg, state.tonnageKg, state.reps], [null, null, 0, 0]);
  assert.deepEqual(state.ignored, [0, 1]);
  assert.equal(computeTonnageResult(state).entered, false);
});

test('motor: a liberação trava o levantamento até os exercícios antes do marcado chegarem à meta', () => {
  const early = [load(60), lrep(60, 1), ...reps10('pu'), ...reps10('bp', 11), lrep(60, 40), lrep(60, 41)];
  const state = deriveTonnageState(TREINO1, early);
  assert.equal(state.released, true);
  assert.equal(state.releasedAt, 20, 'o instante da última repetição de liberação');
  assert.equal(state.currentSegmentId, null);
  assert.equal(state.tonnageKg, 120, 'a repetição antes da liberação ficou fora');
  assert.deepEqual(state.ignored, [1]);
  assert.deepEqual(state.segments.map((segment) => [segment.id, segment.done, segment.target]), [['pu', 10, 10], ['bp', 10, 10]]);

  // No meio da liberação: a vez é do segmento incompleto e nada do levantamento conta.
  const middle = deriveTonnageState(TREINO1, [load(60), ...reps10('pu'), ...times(4, (index) => rep('bp', 11 + index)), lrep(60, 20)]);
  assert.deepEqual([middle.released, middle.releasedAt, middle.currentSegmentId, middle.tonnageKg], [false, null, 'bp', 0]);
});

test('motor: desfazer uma repetição da liberação trava de novo o que veio depois dela', () => {
  const log = [load(60), ...reps10('pu'), ...reps10('bp', 11), lrep(60, 40), lrep(60, 41)];
  assert.equal(deriveTonnageState(TREINO1, log).tonnageKg, 120);
  // undo do rep da posição 5 (Pull Ups): na reprodução, as lreps ficam antes de a liberação fechar.
  const relocked = deriveTonnageState(TREINO1, [...log, undo(5, 50)]);
  assert.equal(relocked.released, false);
  assert.equal(relocked.tonnageKg, 0);
  assert.equal(relocked.currentSegmentId, 'pu');
  // Concluir de novo (mais uma repetição) destrava para o que vier depois, não para o que ficou para trás.
  const again = deriveTonnageState(TREINO1, [...log, undo(5, 50), rep('pu', 51), lrep(60, 52)]);
  assert.equal(again.released, true);
  assert.equal(again.tonnageKg, 60, 'só a repetição depois de liberar de novo');
});

test('motor: exercício de depois do marcado não conta nem trava; as contagens dele são ignoradas', () => {
  const after = valid(tonnageInput({
    segments: [segmentOf('pu', 'Pull Ups', 10), segmentOf('bp', 'Burpees', 10)],
    totalReps: 20
  }, { position: 1 }));
  const state = deriveTonnageState(after, [load(60), ...reps10('pu'), lrep(60, 20), rep('bp', 21), lrep(60, 22)]);
  assert.equal(state.position, 1);
  assert.equal(state.tonnageKg, 120, 'Burpees (depois) não trava nem conta');
  assert.deepEqual(state.ignored, [12], 'a contagem do exercício de depois fica fora');
  assert.deepEqual(state.segments.map((segment) => segment.done), [10, 0]);
});

test('motor: o time cap vale para tudo; registro depois dele fica no log e não conta', () => {
  const state = deriveTonnageState(TREINO2, [load(60), lrep(60, 179), lrep(60, 180), lrep(60, 181), load(70, 185)]);
  assert.equal(state.tonnageKg, 120, 'o segundo do time cap ainda conta');
  assert.deepEqual(state.ignored, [3, 4]);
  // A liberação gasta o time cap: contagem depois dele não libera.
  const late = deriveTonnageState(TREINO1, [load(60), ...reps10('pu'), ...times(9, (index) => rep('bp', 11 + index)), rep('bp', 601), lrep(60, 602)]);
  assert.equal(late.released, false);
  assert.equal(late.tonnageKg, 0);
});

test('motor: o teto de 99.999 kg ignora a repetição que o passaria', () => {
  const events = [load(500), ...times(200, (index) => lrep(500, 1 + index))];
  const state = deriveTonnageState(TREINO2, events.map((event) => ({ ...event, at: Math.min(event.at, 179) })));
  assert.equal(state.reps, 199);
  assert.equal(state.tonnageKg, 99500);
  assert.equal(state.ignored.length, 1);
});

test('motor: desfazer o aumento deixa as repetições já feitas com a própria carga e ignora as que dependiam dele', () => {
  const log = [load(60), lrep(60, 10), lrep(60, 11), load(70, 20), lrep(70, 21), lrep(70, 22)];
  assert.equal(deriveTonnageState(TREINO2_UP, log).tonnageKg, 60 + 60 + 70 + 70);
  // Desfazer só a última repetição (o caso normal da tela): as outras seguem como estão.
  assert.equal(deriveTonnageState(TREINO2_UP, [...log, undo(5)]).tonnageKg, 60 + 60 + 70);
  // Desfazer o próprio aumento: as repetições de 60 kg não são recalculadas e as de 70 kg deixam de valer.
  const state = deriveTonnageState(TREINO2_UP, [...log, undo(3)]);
  assert.equal(state.tonnageKg, 120);
  assert.equal(state.loadKg, 60);
  assert.deepEqual(state.groups, [{ loadKg: 60, reps: 2, kg: 120 }]);
});

test('motor: undo de undo não tem efeito e o undo de uma declaração volta a exigir a carga', () => {
  const log = [load(60), lrep(60, 5), undo(1, 6)];
  assert.equal(deriveTonnageState(TREINO2, log).tonnageKg, 0);
  assert.equal(deriveTonnageState(TREINO2, [...log, undo(2, 7)]).tonnageKg, 0, 'undo de undo é ignorado');
  const withoutLoad = deriveTonnageState(TREINO2, [load(60), undo(0, 1), lrep(60, 5)]);
  assert.deepEqual([withoutLoad.declaredKg, withoutLoad.tonnageKg], [null, 0]);
});

test('motor: evento malformado, de outro formato e estrutura que não é de tonelagem são ignorados por inteiro', () => {
  const bad = [
    { t: 'load', v: 0, at: 0 }, { t: 'load', v: 60.3, at: 0 }, { t: 'load', v: 501, at: 0 }, { t: 'load', v: '60', at: 0 },
    { t: 'lrep', load: 0, at: 5 }, { t: 'lrep', load: 60, at: -1 }, { t: 'lrep', load: 60 }, { t: 'lrep', load: 60, at: 'x' },
    { t: 'time', target: 'final', v: 100, at: 5 }, { t: 'attempt', lift: 'sn', load: 60, ok: true, at: 5 }, { t: 'dist', v: 100, at: 5 },
    { t: 'rep', seg: 'inexistente', at: 5 }, null, 'x', 7, [], { t: 'xyz', at: 5 }
  ];
  const state = deriveTonnageState(TREINO2, [load(60), ...bad, lrep(60, 10)]);
  assert.deepEqual([state.declaredKg, state.tonnageKg, state.reps], [60, 60, 1]);
  assert.deepEqual(state.ignored, [], 'os malformados nem entram como ignorados');
  for (const structure of [valid(forTimeV4()), null, undefined, {}]) {
    const empty = deriveTonnageState(structure, [load(60), lrep(60, 5)]);
    assert.deepEqual([empty.tonnageKg, empty.reps, empty.declaredKg, empty.segments], [0, 0, null, []]);
  }
  assert.deepEqual(deriveTonnageState(TREINO2, null).groups, []);
});

test('motor: puro, determinístico e sem mutar as entradas; o For Time e o AMRAP não veem load nem lrep', () => {
  const structure = JSON.parse(JSON.stringify(TREINO2_UP));
  const events = JSON.parse(JSON.stringify([load(60), lrep(60, 5), load(70, 6), lrep(70, 7), undo(3, 8)]));
  Object.freeze(structure.tonnage);
  Object.freeze(events);
  const first = deriveTonnageState(structure, events);
  const second = deriveTonnageState(structure, events);
  assert.deepEqual(first, second);
  assert.notEqual(first.groups, second.groups);
  assert.deepEqual(structure, JSON.parse(JSON.stringify(TREINO2_UP)));
  const forTime = valid(forTimeV4());
  assert.equal(deriveSheetState(forTime, [load(60), lrep(60, 5)]).repsDone, 0);
});

test('resultado: o total como número e como texto, sem desempate; sem carga não há resultado a publicar', () => {
  const half = deriveTonnageState(TREINO2, [load(42.5), lrep(42.5, 5), lrep(42.5, 6), lrep(42.5, 7)]);
  const result = computeTonnageResult(half);
  assert.deepEqual([result.value, result.display, result.tieBreak, result.reps], [127.5, '127.5', null, 3]);
  assert.notEqual(result.groups, half.groups);
  const empty = computeTonnageResult(deriveTonnageState(TREINO2, []));
  assert.deepEqual([empty.value, empty.display, empty.entered, empty.reps], [0, '0', false, 0]);
  const declared = computeTonnageResult(deriveTonnageState(TREINO2, [load(60)]));
  assert.deepEqual([declared.value, declared.entered], [0, true], 'carga declarada e nenhuma repetição vale 0 kg');
});

// ---------------------------------------------------------------------------
// checkTonnageEntry
// ---------------------------------------------------------------------------

test('checkTonnageEntry: recusa com mensagem o que o motor ignoraria por regra da prova', () => {
  const say = (structure, events, entry) => checkTonnageEntry(structure, events, entry);

  // Carga fora da faixa ou que não é múltiplo de 0,25.
  const faixa = { ok: false, error: 'A carga deve ficar entre 0.25 e 500 kg, em múltiplos de 0.25.' };
  assert.deepEqual(say(TREINO2, [], { t: 'load', v: 0 }), faixa);
  assert.deepEqual(say(TREINO2, [], { t: 'load', v: 60.3 }), faixa);
  assert.deepEqual(say(TREINO2, [load(60)], { t: 'lrep', load: 600 }), faixa);
  assert.deepEqual(say(TREINO2, [], { t: 'load', v: 60 }), { ok: true });

  // Prescrita: a declaração tem que ser a prescrita.
  assert.deepEqual(say(PRESCRITA, [], { t: 'load', v: 50 }), { ok: false, error: 'A carga desta prova é prescrita pelo gestor: use a carga indicada.' });
  assert.deepEqual(say(PRESCRITA, [], { t: 'load', v: 60 }), { ok: true });

  // Incremento: travado, só sobe e no passo.
  assert.deepEqual(say(TREINO2, [load(60)], { t: 'load', v: 70 }), { ok: false, error: 'Nesta prova a carga não pode mudar durante o treino.' });
  assert.deepEqual(say(TREINO2_UP, [load(60)], { t: 'load', v: 60 }), { ok: false, error: 'A carga só pode subir.' });
  assert.deepEqual(say(TREINO2_UP, [load(60)], { t: 'load', v: 50 }), { ok: false, error: 'A carga só pode subir.' });
  assert.deepEqual(say(TREINO2_UP, [load(60)], { t: 'load', v: 65 }), { ok: false, error: 'O incremento deve ser de 10 em 10 kg.' });
  assert.deepEqual(say(TREINO2_UP, [load(60)], { t: 'load', v: 70 }), { ok: true });

  // Repetição: precisa de carga, de liberação e da carga vigente.
  assert.deepEqual(say(TREINO2, [], { t: 'lrep', load: 60 }), { ok: false, error: 'Informe a carga do atleta antes das repetições.' });
  assert.deepEqual(say(TREINO1, [load(60)], { t: 'lrep', load: 60 }), { ok: false, error: 'Conclua os exercícios de liberação antes de registrar repetições.' });
  assert.deepEqual(say(TREINO1, [load(60), ...reps10('pu'), ...reps10('bp', 11)], { t: 'lrep', load: 60 }), { ok: true });
  assert.deepEqual(say(TREINO2, [load(60)], { t: 'lrep', load: 70 }), { ok: false, error: 'A repetição deve usar a carga vigente (60 kg).' });

  // Teto e time cap: o teto é recusado; o time cap não (o registro é gravado e o motor o ignora).
  const full = [load(500), ...times(199, (index) => lrep(500, 1 + index % 170))];
  assert.deepEqual(say(TREINO2, full, { t: 'lrep', load: 500 }), { ok: false, error: 'A tonelagem passaria de 99.999 kg. Confira os registros.' });
  assert.deepEqual(say(TREINO2, [load(60)], { t: 'lrep', load: 60 }), { ok: true });

  // Não é de tonelagem, e nunca lança.
  assert.deepEqual(say(valid(forTimeV4()), [], { t: 'load', v: 60 }), { ok: false, error: 'Esta prova não é de tonelagem.' });
  assert.equal(say(null, [], { t: 'load', v: 60 }).ok, false);
  assert.equal(say(TREINO2, 'não é lista', { t: 'lrep', load: 60 }).ok, false);
});

// ---------------------------------------------------------------------------
// Servidor: registros, resultado, ausente e ao vivo
// ---------------------------------------------------------------------------

test('validateClientEvent: load e lrep só na tonelagem, com carga válida; a contagem vale só na liberação', () => {
  const ev = (event, structure = TREINO1, position = 0) => validateClientEvent({ id: 'ev-1', event }, structure, position);

  assert.deepEqual(ev({ t: 'load', v: 60, at: 0 }), { ok: true, id: 'ev-1', event: { t: 'load', v: 60, at: 0 } });
  assert.deepEqual(ev({ t: 'lrep', load: 62.5, at: 31, extra: 'x' }), { ok: true, id: 'ev-1', event: { t: 'lrep', load: 62.5, at: 31 } });
  assert.match(ev({ t: 'load', v: 60.3, at: 0 }).error, /a carga deve ficar entre 0\.25 e 500 kg, em múltiplos de 0\.25/);
  assert.match(ev({ t: 'lrep', load: 0, at: 1 }).error, /a carga deve ficar entre 0\.25 e 500 kg/);
  assert.match(ev({ t: 'lrep', load: '60', at: 1 }).error, /a carga deve ficar entre/);

  // Liberação: rep, fill, set e adj valem nos exercícios antes do marcado.
  assert.deepEqual(ev({ t: 'rep', seg: 'pu', at: 3 }), { ok: true, id: 'ev-1', event: { t: 'rep', seg: 'pu', at: 3 } });
  assert.equal(ev({ t: 'fill', seg: 'bp', n: 10, at: 3 }).ok, true);
  assert.equal(ev({ t: 'set', seg: 'bp', v: 4, at: 3 }).ok, true);
  assert.equal(ev({ t: 'adj', seg: 'pu', d: -1, at: 3 }).ok, true);
  assert.match(ev({ t: 'rep', seg: 'sc', at: 3 }).error, /etapa inexistente na prova/, 'o exercício que conta não tem contagem de segmento');
  assert.match(ev({ t: 'rep', seg: 'x', at: 3 }).error, /etapa inexistente na prova/);

  // Exercício de depois do marcado: só texto.
  const after = valid(tonnageInput({}, { position: 1 }));
  assert.equal(ev({ t: 'rep', seg: 'pu', at: 3 }, after).ok, true);
  assert.match(ev({ t: 'rep', seg: 'bp', at: 3 }, after).error, /etapa inexistente na prova/);

  // Outros registros não valem na tonelagem.
  assert.match(ev({ t: 'time', target: 'final', v: 100, at: 3 }).error, /o ajuste do tempo não vale para esta prova/);
  assert.match(ev({ t: 'attempt', lift: 'sc', load: 60, ok: true, at: 3 }).error, /movimento inexistente na prova/);
  assert.match(ev({ t: 'dist', v: 100, at: 3 }).error, /o total de distância não vale para esta prova/);
  assert.equal(ev({ t: 'undo', of: 0, at: 4 }, TREINO1, 1).ok, true);

  // load e lrep são recusados nos outros formatos.
  for (const structure of [valid(forTimeV4()), valid({ ...forTimeV4(), format: 'amrap', incomplete: null, tieBreak: null, scoreDisplay: 'total' })]) {
    assert.match(ev({ t: 'load', v: 60, at: 0 }, structure).error, /a carga da tonelagem não vale para esta prova/);
    assert.match(ev({ t: 'lrep', load: 60, at: 1 }, structure).error, /a repetição com carga não vale para esta prova/);
  }
});

test('checkOfficialTime recusa a tonelagem com mensagem própria (ela tem time cap numérico, mas não tem tempo a ajustar)', () => {
  const state = deriveSheetState(TREINO1, []);
  assert.deepEqual(checkOfficialTime(TREINO1, state, 'final', 300), {
    ok: false,
    error: 'O ajuste manual do tempo não vale para provas de tonelagem: o resultado são os kg das repetições registradas pelo judge.'
  });
});

test('computeSheetOutcome e computeAbsentOutcome da tonelagem: o total publicado, a recusa sem carga e o ausente com 0 kg', () => {
  const events = [load(60), ...times(8, (index) => lrep(60, 10 + index)), load(70, 40), ...times(5, (index) => lrep(70, 50 + index))];
  assert.deepEqual(computeSheetOutcome(TREINO2_UP, events), { ok: true, result: '830', value: 830, tieBreak: null, summary: '830 kg em 13 repetições' });
  assert.deepEqual(computeSheetOutcome(TREINO2, [load(42.5), lrep(42.5, 5)]), { ok: true, result: '42.5', value: 42.5, tieBreak: null, summary: '42,5 kg em 1 repetição' });
  assert.deepEqual(computeSheetOutcome(TREINO2, [load(60)]), { ok: true, result: '0', value: 0, tieBreak: null, summary: '0 kg em 0 repetições' });
  assert.deepEqual(computeSheetOutcome(TREINO2, []), { ok: false, error: 'Informe a carga do atleta antes de enviar.' });
  assert.deepEqual(computeSheetOutcome(TREINO2, [load(60), undo(0, 2)]), { ok: false, error: 'Informe a carga do atleta antes de enviar.' });
  assert.deepEqual(computeAbsentOutcome(TREINO1), { ok: true, result: '0', value: 0, tieBreak: null, summary: 'Atleta ausente · 0 kg' });
  assert.deepEqual(computeAbsentOutcome(TREINO2), { ok: true, result: '0', value: 0, tieBreak: null, summary: 'Atleta ausente · 0 kg' });
});

test('progresso ao vivo da tonelagem: a tonelagem em scoreKg, as repetições em repsDone e a liberação em segments', () => {
  const log = [load(60), ...reps10('pu'), ...times(4, (index) => rep('bp', 11 + index)), lrep(60, 20)];
  const middle = summarizeLiveProgress(TREINO1, log, '2026-10-27T12:00:00.000Z');
  assert.deepEqual(
    [middle.seq, middle.repsDone, middle.scoreKg, middle.segments, middle.currentSegmentId, middle.lastMarkAt, middle.round, middle.completedAt, middle.attemptsUsed, middle.currentLiftId],
    [16, 0, 0, [10, 4], 'bp', null, null, null, null, null]
  );
  const done = [load(60), ...reps10('pu'), ...reps10('bp', 11), lrep(60, 30), lrep(60, 31), lrep(60, 32), undo(23, 33)];
  const live = summarizeLiveProgress(TREINO1, done, null);
  assert.deepEqual([live.repsDone, live.scoreKg, live.segments, live.currentSegmentId, live.lastMarkAt, live.roundsCompleted], [2, 120, [10, 10], null, 31, 0]);
  assert.deepEqual(readLiveProgress(JSON.parse(JSON.stringify(live))), live);
  const before = summarizeLiveProgress(TREINO2, [load(60)], null);
  assert.deepEqual([before.repsDone, before.scoreKg, before.lastMarkAt], [0, 0, 0], 'sem liberação, o relógio da "chegada" começa em 0');
});

test('rankLiveEntries da tonelagem: maior tonelagem primeiro e, no empate, quem chegou antes; raia sem registro no fim', () => {
  const progress = (kg, lastMarkAt, seq = 5) => ({ seq, repsDone: 0, roundsCompleted: 0, segments: [], currentSegmentId: null, completedAt: null, lastMarkAt, scoreKg: kg, attemptsUsed: null, currentLiftId: null, clockStartAt: null, round: null });
  const ranked = rankLiveEntries('tonnage', [
    { id: 'a', lane: 1, progress: progress(660, 100) },
    { id: 'b', lane: 2, progress: progress(830, 150) },
    { id: 'c', lane: 3, progress: progress(830, 120) },
    { id: 'd', lane: 4, progress: null },
    { id: 'e', lane: 5, progress: progress(400, 90) }
  ]);
  assert.deepEqual(ranked.map((entry) => [entry.id, entry.position]), [['c', 1], ['b', 2], ['a', 3], ['e', 4], ['d', null]]);
});

test('describeWorkoutForBoard aceita a tonelagem sem lançar (os rótulos do telão são da Story 1.81)', () => {
  const board = describeWorkoutForBoard({ name: 'Squat Clean', code: 'W3' }, TREINO1);
  assert.equal(board.format, 'tonnage');
  assert.equal(board.timeCapSeconds, 600);
  assert.equal(board.totalReps, 20);
});

// ---------------------------------------------------------------------------
// Caso de teste aprovado: Treino 2, cinco atletas
// ---------------------------------------------------------------------------

test('caso aprovado: 830, 830, 660, 400 e ausente; posições 1, 1, 3, 4, 5 pelo caminho real do ranking, sem desempate', () => {
  const sheets = {
    A: [load(60), ...times(8, (index) => lrep(60, 10 + index)), load(70, 40), ...times(5, (index) => lrep(70, 50 + index))],
    B: [load(83), ...times(10, (index) => lrep(83, 10 + index))],
    C: [load(55), ...times(12, (index) => lrep(55, 10 + index))],
    D: [load(40), ...times(10, (index) => lrep(40, 10 + index))]
  };
  const outcomes = Object.fromEntries(Object.entries(sheets).map(([id, events]) => [id, computeSheetOutcome(TREINO2_UP, events)]));
  assert.deepEqual(Object.fromEntries(Object.entries(outcomes).map(([id, outcome]) => [id, outcome.value])), { A: 830, B: 830, C: 660, D: 400 });
  const absent = computeAbsentOutcome(TREINO2_UP);

  const scores = [
    ...Object.entries(outcomes).map(([athleteId, outcome]) => ({ athleteId, result: outcome.result, value: outcome.value, splits: {} })),
    { athleteId: 'E', result: absent.result, value: absent.value, splits: {}, resultStatus: 'absent' }
  ];
  assert.equal(deriveLegacyWorkoutFields(TREINO2_UP).type, 'tonnage');
  const ranked = rankWorkoutScores('tonnage', '', scores, 5);
  assert.deepEqual(
    Object.fromEntries(ranked.map((score) => [score.athleteId, [score.rank, score.points]])),
    { A: [1, 1], B: [1, 1], C: [3, 3], D: [4, 4], E: [5, 5] },
    'mesma tonelagem divide a posição, qualquer que seja o número de repetições'
  );
});

test('tabela de digitação do gestor: o parser de kg dá os resultados esperados', () => {
  assert.deepEqual(parseTonnageKgInput('830'), { ok: true, kg: 830 });
  assert.deepEqual(parseTonnageKgInput('1.652,5'), { ok: true, kg: 1652.5 });
  assert.deepEqual(parseTonnageKgInput('0'), { ok: true, kg: 0 });
  assert.equal(parseTonnageKgInput('830,255').ok, false);
  assert.equal(parseTonnageKgInput('100000').ok, false);
  assert.equal(parseTonnageKgInput('').ok, false);
});
