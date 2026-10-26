import assert from 'node:assert/strict';
import test from 'node:test';

import { importServerModule } from './support/serverModuleHarness.mjs';

import {
  WORKOUT_STRUCTURE_LIMITS,
  WORKOUT_STRUCTURE_VERSION,
  checkOfficialTime,
  computeDistanceResult,
  deriveDistanceState,
  deriveLegacyWorkoutFields,
  deriveSheetState,
  formatMeters,
  parseMetersInput,
  reconcileWorkoutStructure,
  validateWorkoutStructure
} from '../src/lib/workoutStructure.ts';

// Story 1.66: versão 4 do contrato da estrutura da prova e o motor da
// Distância (docs/design/distancia/README.md e distancia-aprovado.html).
// Contrato (formato distance, campo distance, limite, duração), normalização
// da 1, da 2 e da 3 para a 4, parser e formatador do total em metros, motor
// (último lançamento não desfeito, sem janela), resultado e o caso de teste
// aprovado (A, B, C e D). Se o caso aprovado falhar, o resultado ou o ranking
// mudou.

const { computeSheetOutcome, computeAbsentOutcome, validateClientEvent } = await importServerModule('lib/scoresheet.ts');
const { rankWorkoutScores } = await importServerModule('lib/scoring.ts');
const { summarizeLiveProgress, readLiveProgress } = await importServerModule('lib/liveProgress.ts');
const { rankLiveEntries } = await importServerModule('lib/liveHeatRanking.ts');
const { describeWorkoutForBoard } = await importServerModule('lib/serverBroadcast.ts');

// ---------------------------------------------------------------------------
// Fixtures: prova de 20:00, resumo do treino de referência
// ---------------------------------------------------------------------------

const NOTE = '750 m corrida; máx. distância no remo. Os parceiros trocam a cada volta da corrida.';

const distanceInput = (overrides = {}, distanceOverrides = {}) => ({
  version: 4,
  format: 'distance',
  totalReps: 0,
  timeCapSeconds: 1200,
  incomplete: null,
  tieBreak: null,
  generator: null,
  customized: true,
  entry: { mode: 'both', marking: 'reps', publish: 'after_review' },
  segments: [],
  maxLoad: null,
  scoreDisplay: null,
  interval: null,
  distance: { unit: 'm', note: NOTE, ...distanceOverrides },
  ...overrides
});

const segmentOf = (id, name, reps, extra = {}) => ({
  id, round: 1, name, reps, unit: 'reps', load: null, note: '', required: true, mark: 'reps', ...extra
});
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

const DISTANCE = valid(distanceInput());

const dist = (v, at = 1200) => ({ t: 'dist', v, at });
const undo = (of, at = 1201) => ({ t: 'undo', of, at });

const KEYS = ['version', 'format', 'totalReps', 'timeCapSeconds', 'incomplete', 'tieBreak', 'generator', 'customized', 'entry', 'segments', 'maxLoad', 'scoreDisplay', 'interval', 'distance', 'tonnage'];

// ---------------------------------------------------------------------------
// Contrato v4 (AC1)
// ---------------------------------------------------------------------------

test('versão 4: a distância é aceita, normalizada e idempotente, com as chaves do contrato na ordem', () => {
  // Story 1.77: a versão do contrato passou a 5; a 4 continua aceita e sai normalizada na 5, com tonnage vazio.
  assert.equal(WORKOUT_STRUCTURE_VERSION, 5);
  assert.equal(WORKOUT_STRUCTURE_LIMITS.maxDistanceMeters, 99999);
  assert.deepEqual(DISTANCE, {
    version: 5,
    format: 'distance',
    totalReps: 0,
    timeCapSeconds: 1200,
    incomplete: null,
    tieBreak: null,
    generator: null,
    customized: true,
    entry: { mode: 'both', marking: 'reps', publish: 'after_review' },
    segments: [],
    maxLoad: null,
    scoreDisplay: null,
    interval: null,
    distance: { unit: 'm', note: NOTE },
    tonnage: null
  });
  assert.deepEqual(Object.keys(DISTANCE), KEYS);
  assert.deepEqual(valid(JSON.parse(JSON.stringify(DISTANCE))), DISTANCE, 'validar de novo devolve a mesma estrutura');

  // O resumo sai sem espaços nas pontas, pode ficar vazio, e o resultado é um objeto novo.
  const input = distanceInput({}, { note: '   ' });
  const normalized = valid(input);
  assert.equal(normalized.distance.note, '');
  assert.notEqual(normalized, input);
  assert.notEqual(normalized.distance, input.distance);
  assert.equal(valid(distanceInput({}, { note: `  ${'x'.repeat(300)}  ` })).distance.note.length, 300);
});

test('versão 4: duração de 30 a 5999 s, sem segmentos e sem as regras dos outros formatos', () => {
  for (const seconds of [30, 900, 5999]) assert.equal(valid(distanceInput({ timeCapSeconds: seconds })).timeCapSeconds, seconds);
  const timeCap = /^O time cap da prova deve ser um número inteiro de segundos entre 30 e 5999\.$/;
  for (const seconds of [29, 6000, 0, -1, 600.5, '1200', null]) rejects(distanceInput({ timeCapSeconds: seconds }), timeCap, String(seconds));

  rejects(distanceInput({ segments: [segmentOf('a', 'Run', 750)], totalReps: 750 }), /^Na distância a prova não tem movimentos: a lista de segmentos fica vazia\.$/);
  rejects(distanceInput({ segments: undefined }), /^Na distância a prova não tem movimentos/);
  rejects(distanceInput({ totalReps: 5 }), /^O total de repetições da prova deve ser igual à soma das repetições dos segmentos \(0\)\.$/);

  const noTieBreak = /^A distância não tem desempate nesta versão: o campo fica vazio \(null\)\.$/;
  rejects(distanceInput({ tieBreak: { kind: 'split_time', at: 'a', order: 'asc' } }), noTieBreak);
  rejects(distanceInput({ tieBreak: { kind: 'last_round', order: 'asc' } }), noTieBreak);
  rejects(distanceInput({ tieBreak: { kind: 'finish_time', order: 'asc' } }), noTieBreak);
  rejects(distanceInput({ incomplete: { rule: 'penalty_per_rep', secondsPerRep: 1, base: 'time_cap' } }), /^Na distância, a regra de não conclusão deve ficar vazia \(null\)\.$/);
  rejects(distanceInput({ generator: { kind: 'fixed', reps: [6] }, customized: false }), /^Na distância o gerador deve ficar vazio \(null\)\.$/);
  rejects(distanceInput({ customized: false }), /customized falso\) precisa do gerador/);
  rejects(distanceInput({ maxLoad: { lifts: [], order: 'fixed', scoring: 'sum', loadStepKg: 2.5 } }), /só existem em provas de carga máxima/);
  rejects(distanceInput({ scoreDisplay: 'total' }), /nos outros formatos o campo fica vazio/);
  rejects(distanceInput({ interval: { rounds: 2, onSeconds: 60, offSeconds: 0, max: { id: 'mx', name: 'x', load: null, note: '' } } }), /^O campo interval só existe em provas intervaladas/);
});

test('versão 4: o campo distance é obrigatório na distância e vazio nos outros formatos; chaves estranhas e caractere nulo são recusados', () => {
  const shape = /^Na distância, informe o campo distance com a unidade \(unit, m de metros\) e o resumo da prova \(note, pode ficar vazio\)\.$/;
  rejects(distanceInput({ distance: null }), shape);
  rejects(distanceInput({ distance: [] }), shape);
  rejects(distanceInput({ distance: 'm' }), shape);
  const missing = distanceInput();
  delete missing.distance;
  rejects(missing, shape);

  const onlyThere = /^O campo distance só existe em provas de distância: fora delas fica vazio \(null\)\.$/;
  const forTime = { ...forTimeV3(), version: 4, distance: null };
  assert.equal(valid(forTime).distance, null);
  rejects({ ...forTime, distance: { unit: 'm', note: '' } }, onlyThere);
  const withoutKey = { ...forTime };
  delete withoutKey.distance;
  rejects(withoutKey, onlyThere, 'na versão 4 a chave distance faz parte do contrato');

  rejects({ ...distanceInput(), extra: 1 }, /^A estrutura da prova tem um campo que não faz parte do contrato\.$/);
  rejects(distanceInput({}, { rounds: 1 }), /^O campo distance tem um campo que não faz parte do contrato\.$/);
  for (const unit of ['km', 'cal', 'reps', 'M', '', null, 1]) {
    rejects(distanceInput({}, { unit }), /^Na distância, a unidade \(unit\) deve ser m \(metros\)\.$/, String(unit));
  }
  const noteMessage = /^Na distância, o resumo da prova \(note\) deve ser um texto de até 300 caracteres \(pode ficar vazio\)\.$/;
  rejects(distanceInput({}, { note: 'x'.repeat(301) }), noteMessage);
  rejects(distanceInput({}, { note: 5 }), noteMessage);
  rejects(distanceInput({}, { note: null }), noteMessage);
  rejects(distanceInput({}, { note: 'Corrida\u0000' }), /^Os textos da estrutura da prova não podem conter o caractere nulo \(U\+0000\)\.$/);

  // As mensagens dizem o campo e o limite, sem devolver o que foi enviado.
  const echoed = rejects(distanceInput({}, { note: 'SEGREDO'.repeat(60) }));
  assert.doesNotMatch(echoed, /SEGREDO|\{|"/);
  // Nunca lança, nem com um getter que lança.
  const hostile = distanceInput();
  Object.defineProperty(hostile.distance, 'unit', { enumerable: true, get() { throw new Error('boom'); } });
  assert.equal(validateWorkoutStructure(hostile).ok, false);
});

test('versões: a 1, a 2 e a 3 entram e saem na 5 com distance vazio; nelas a distância é recusada com mensagem própria', () => {
  const fromV1 = valid(forTimeV1());
  const fromV2 = valid(forTimeV2());
  const fromV3 = valid(forTimeV3());
  for (const structure of [fromV1, fromV2, fromV3]) {
    assert.equal(structure.version, 5);
    assert.equal(structure.distance, null);
    assert.deepEqual(Object.keys(structure), KEYS);
    assert.deepEqual(valid(structure), structure, 'a 5 revalidada é igual');
  }
  assert.deepEqual(fromV1, fromV2);
  assert.deepEqual(fromV2, fromV3);

  const ownMessage = /^O formato distância \(distance\) e o campo distance exigem a versão 4 da estrutura\.$/;
  rejects({ ...forTimeV3(), distance: null }, ownMessage);
  rejects({ ...forTimeV2(), distance: null }, ownMessage);
  rejects({ ...forTimeV1(), distance: null }, ownMessage);
  const withoutInterval = (input) => {
    const copy = { ...input };
    delete copy.interval;
    return copy;
  };
  rejects({ ...distanceInput(), version: 3 }, ownMessage);
  rejects(withoutInterval({ ...distanceInput(), version: 2 }), ownMessage);
  rejects(withoutInterval({ ...distanceInput(), version: 1 }), ownMessage);
  // Com a chave interval, a recusa é a do intervalado (a versão 2 não conhece nenhum dos dois formatos novos).
  rejects({ ...distanceInput(), version: 2 }, /^O formato intervalado \(interval\) e o campo interval exigem a versão 3 da estrutura\.$/);
  rejects({ ...forTimeV3(), format: 'distance' }, ownMessage);
  rejects({ ...forTimeV3(), version: 6 }, /^A versão da estrutura da prova deve ser 1, 2, 3, 4 ou 5\.$/);
  // O intervalado continua exigindo a versão 3 ou mais.
  rejects({ ...forTimeV2(), interval: null }, /^O formato intervalado \(interval\) e o campo interval exigem a versão 3 da estrutura\.$/);
});

test('reconcileWorkoutStructure copia o distance por valor; campos legados da distância são distance, a duração e sem desempate', () => {
  const copy = reconcileWorkoutStructure(DISTANCE);
  assert.deepEqual(copy, DISTANCE);
  assert.notEqual(copy.distance, DISTANCE.distance);
  copy.distance.note = 'outro';
  assert.equal(DISTANCE.distance.note, NOTE, 'a original não muda');
  assert.equal(reconcileWorkoutStructure(valid(forTimeV2())).distance, null);

  assert.deepEqual(deriveLegacyWorkoutFields(DISTANCE), { type: 'distance', timeCap: '20:00', tieBreaker: '' });
  assert.deepEqual(deriveLegacyWorkoutFields(valid(distanceInput({ timeCapSeconds: 900 }))), { type: 'distance', timeCap: '15:00', tieBreaker: '' });
  assert.equal(deriveLegacyWorkoutFields(valid(forTimeV2())).type, 'fortime', 'os outros formatos não mudam');
});

// ---------------------------------------------------------------------------
// Parser e formatador do total (AC2)
// ---------------------------------------------------------------------------

test('parseMetersInput: aceita dígitos e ponto de milhar, recusa o resto com a mensagem da tela', () => {
  for (const [text, meters] of [['3250', 3250], ['3.250', 3250], ['0', 0], ['99999', 99999], ['99.999', 99999], [' 6330 ', 6330], ['6 330', 6330], ['007', 7], ['1.000', 1000], ['12.345', 12345]]) {
    assert.deepEqual(parseMetersInput(text), { ok: true, meters }, JSON.stringify(text));
  }
  const format = 'Use só metros inteiros (ex.: 3250).';
  for (const text of ['3,5', '3.25', '3,250', '-5', '+5', 'abc', '1.2.3', '99.9999', '3.2500', '.5', '5.', '6330 m', '1e3', '0x10', '3 250,5']) {
    assert.deepEqual(parseMetersInput(text), { ok: false, error: format }, JSON.stringify(text));
  }
  for (const text of ['100000', '100.000', '3.250.000', '99999999999999999999']) {
    assert.deepEqual(parseMetersInput(text), { ok: false, error: 'O total passa de 99.999 m. Confira o número.' }, text);
  }
  for (const text of ['', '   ', null, undefined, 6330, {}, []]) {
    assert.deepEqual(parseMetersInput(text), { ok: false, error: 'Informe o total em metros.' }, String(text));
  }
});

test('formatMeters: ponto de milhar sem depender de Intl', () => {
  assert.deepEqual([0, 7, 999, 1000, 5915, 6330, 12345, 99999].map(formatMeters), ['0', '7', '999', '1.000', '5.915', '6.330', '12.345', '99.999']);
  assert.equal(formatMeters(6330.9), '6.330');
  assert.equal(formatMeters(-4), '0');
  assert.equal(formatMeters(Number.NaN), '0');
  // Ida e volta com o parser, em todos os totais de uma amostra.
  for (const meters of [0, 1, 999, 1000, 4500, 6330, 10000, 99999]) {
    assert.deepEqual(parseMetersInput(formatMeters(meters)), { ok: true, meters });
  }
});

// ---------------------------------------------------------------------------
// Motor (AC3)
// ---------------------------------------------------------------------------

test('motor: vale o último lançamento não desfeito, sem janela de tempo', () => {
  const state = (events) => deriveDistanceState(DISTANCE, events);
  assert.deepEqual(state([]), { format: 'distance', meters: null, entries: 0, lastEntryAt: null, history: [] });

  const two = state([dist(4500, 600), dist(6330, 1200)]);
  assert.equal(two.meters, 6330);
  assert.equal(two.entries, 2);
  assert.equal(two.lastEntryAt, 1200);
  assert.deepEqual(two.history, [{ position: 0, meters: 4500, at: 600 }, { position: 1, meters: 6330, at: 1200 }]);

  assert.equal(state([dist(4500, 600), dist(6330, 1200), undo(1)]).meters, 4500, 'desfazer volta ao anterior');
  assert.deepEqual(state([dist(4500, 600), dist(6330, 1200), undo(1)]).history, [{ position: 0, meters: 4500, at: 600 }]);
  assert.equal(state([dist(4500, 600), dist(6330, 1200), undo(1), undo(2)]).meters, 4500, 'undo de undo não tem efeito: o primeiro desfazer continua valendo');
  assert.equal(state([dist(6330), undo(0)]).meters, null, 'desfazer o único deixa sem lançamento');
  assert.equal(state([dist(6330), dist(0, 1300)]).meters, 0, 'o último vale, mesmo 0');
  assert.equal(state([dist(6330, 1300)]).meters, 6330, 'depois da duração (20:00) ainda vale');
  assert.equal(state([dist(6330, 0)]).meters, 6330, 'no instante 0 também');
  assert.equal(state([undo(0), dist(500)]).meters, 500, 'undo que aponta para a frente não anula');
  assert.equal(state([dist(500), dist(700), undo(5)]).meters, 700, 'undo de um evento inexistente não anula');
  assert.equal(state([dist(500.4, 1200)]).lastEntryAt, null, 'não inteiro: ignorado por inteiro');
});

test('motor: evento malformado, de outro formato e estrutura que não é de distância são ignorados por inteiro', () => {
  const bad = [
    dist(100000), dist(-1), dist(3.5), dist('6330'), dist(null), { t: 'dist', at: 5 }, { t: 'dist', v: 5 },
    { t: 'dist', v: 5, at: -1 }, { t: 'dist', v: 5, at: Number.NaN }, { t: 'dist', v: 5, at: '3' },
    null, 'dist', 7, [], { t: 'rep', seg: 'a', at: 3 }, { t: 'fill', seg: 'a', n: 2, at: 3 }, { t: 'set', seg: 'a', v: 2, at: 3 },
    { t: 'adj', seg: 'a', d: 1, at: 3 }, { t: 'time', target: 'final', v: 100, at: 3 }, { t: 'attempt', lift: 'l1', load: 100, ok: true, at: 3 }, { t: 'xyz', at: 1 }
  ];
  const state = deriveDistanceState(DISTANCE, bad);
  assert.deepEqual([state.meters, state.entries, state.lastEntryAt, state.history], [null, 0, null, []]);
  // Os válidos no meio de lixo contam, e a posição é a do log.
  const mixed = deriveDistanceState(DISTANCE, [dist(100000), dist(2500, 300), { t: 'rep', seg: 'a', at: 4 }, dist(2600, 301)]);
  assert.deepEqual(mixed.history, [{ position: 1, meters: 2500, at: 300 }, { position: 3, meters: 2600, at: 301 }]);
  // Estrutura que não é de distância, ou log que não é lista: sem lançamentos, sem lançar.
  assert.equal(deriveDistanceState(valid(forTimeV2()), [dist(5000)]).meters, null);
  assert.equal(deriveDistanceState(null, [dist(5000)]).meters, null);
  assert.equal(deriveDistanceState(DISTANCE, null).meters, null);
  assert.equal(deriveDistanceState(DISTANCE, 'x').meters, null);
});

test('motor: puro, determinístico e sem mutar as entradas; o For Time não vê o dist', () => {
  const events = [dist(4500, 600), dist(6330, 1200), undo(0)];
  const frozen = JSON.parse(JSON.stringify(events));
  const first = deriveDistanceState(DISTANCE, events);
  const second = deriveDistanceState(DISTANCE, events);
  assert.deepEqual(first, second);
  assert.deepEqual(events, frozen, 'o log não muda');
  first.history.push({ position: 9, meters: 1, at: 1 });
  assert.equal(deriveDistanceState(DISTANCE, events).history.length, 1, 'a saída não é compartilhada');
  const sheet = deriveSheetState(valid(forTimeV2()), events);
  assert.equal(sheet.repsDone, 0, 'dist não conta como repetição em outro formato');
});

test('resultado: o total como número e como texto, sem desempate; sem lançamento não há resultado a publicar', () => {
  const result = (events) => computeDistanceResult(deriveDistanceState(DISTANCE, events));
  assert.deepEqual(result([dist(6330)]), { format: 'distance', value: 6330, display: '6330', tieBreak: null, entered: true, entries: 1 });
  assert.deepEqual(result([dist(0)]), { format: 'distance', value: 0, display: '0', tieBreak: null, entered: true, entries: 1 });
  assert.deepEqual(result([]), { format: 'distance', value: 0, display: '0', tieBreak: null, entered: false, entries: 0 });
  assert.deepEqual(result([dist(4500), dist(6330), undo(1)]), { format: 'distance', value: 4500, display: '4500', tieBreak: null, entered: true, entries: 1 });
});

// ---------------------------------------------------------------------------
// Registros e resultado no servidor (AC4, AC5, AC8)
// ---------------------------------------------------------------------------

test('validateClientEvent: dist só na distância, com o total de 0 a 99.999; os outros registros são recusados nela', () => {
  const check = (event, structure = DISTANCE, position = 0) => validateClientEvent({ id: 'c1', event }, structure, position);
  assert.deepEqual(check({ t: 'dist', v: 6330, at: 1200 }), { ok: true, id: 'c1', event: { t: 'dist', v: 6330, at: 1200 } });
  assert.deepEqual(check({ t: 'dist', v: 0, at: 0, extra: 1 }).event, { t: 'dist', v: 0, at: 0 }, 'só os campos do contrato');
  assert.equal(check({ t: 'dist', v: 99999, at: 1 }).ok, true);
  for (const v of [100000, -1, 3.5, '6330', null, undefined]) {
    const checked = check({ t: 'dist', v, at: 1 });
    assert.equal(checked.ok, false, String(v));
    assert.match(checked.error, /^Registro 1: o total deve ser um número inteiro de metros entre 0 e 99\.999\.$/, String(v));
  }
  assert.match(check({ t: 'dist', v: 5, at: -1 }).error, /instante do relógio inválido/);

  assert.match(check({ t: 'dist', v: 5000, at: 10 }, valid(forTimeV2())).error, /^Registro 1: o total de distância não vale para esta prova\.$/);
  for (const event of [
    { t: 'rep', seg: 'a', at: 5 }, { t: 'fill', seg: 'a', n: 2, at: 5 }, { t: 'set', seg: 'a', v: 2, at: 5 }, { t: 'adj', seg: 'a', d: 1, at: 5 }
  ]) {
    assert.match(check(event).error, /etapa inexistente na prova/, event.t);
  }
  assert.match(check({ t: 'attempt', lift: 'l1', load: 100, ok: true, at: 5 }).error, /movimento inexistente na prova/);
  assert.match(check({ t: 'time', target: 'final', v: 600, at: 5 }).error, /o ajuste do tempo não vale para esta prova/);
  assert.equal(check({ t: 'undo', of: 0, at: 5 }, DISTANCE, 1).ok, true);
  assert.match(check({ t: 'undo', of: 3, at: 5 }, DISTANCE, 1).error, /desfazer aponta para um registro inexistente/);
});

test('checkOfficialTime recusa a distância com mensagem própria (ela tem time cap numérico, mas não tem tempo a ajustar)', () => {
  const state = deriveSheetState(DISTANCE, []);
  for (const target of ['final', 'tiebreak']) {
    assert.deepEqual(checkOfficialTime(DISTANCE, state, target, 600), { ok: false, error: 'O ajuste manual do tempo não vale para provas de distância: o resultado são os metros lançados pelo judge.' });
  }
});

test('computeSheetOutcome e computeAbsentOutcome da distância: o total publicado, a recusa sem lançamento e o ausente com 0 m', () => {
  assert.deepEqual(computeSheetOutcome(DISTANCE, [dist(6000, 900), dist(6330, 1200)]), { ok: true, result: '6330', value: 6330, tieBreak: null, summary: '6.330 m' });
  assert.deepEqual(computeSheetOutcome(DISTANCE, [dist(0)]), { ok: true, result: '0', value: 0, tieBreak: null, summary: '0 m' });
  assert.deepEqual(computeSheetOutcome(DISTANCE, [dist(5915), dist(6330), undo(1)]), { ok: true, result: '5915', value: 5915, tieBreak: null, summary: '5.915 m' });
  const empty = { ok: false, error: 'Informe a distância total antes de enviar.' };
  assert.deepEqual(computeSheetOutcome(DISTANCE, []), empty);
  assert.deepEqual(computeSheetOutcome(DISTANCE, [dist(6330), undo(0)]), empty, 'desfazer o único lançamento volta a recusar');
  assert.deepEqual(computeSheetOutcome(DISTANCE, [{ t: 'rep', seg: 'a', at: 1 }]), empty, 'registro de outro formato não conta');

  assert.deepEqual(computeAbsentOutcome(DISTANCE), { ok: true, result: '0', value: 0, tieBreak: null, summary: 'Atleta ausente · 0 m' });
  // Os outros formatos seguem como estavam.
  const fran = valid(forTimeV2());
  assert.match(computeSheetOutcome(fran, []).result, /^\d\d:\d\d$/, 'For Time sem registro continua publicando o time cap mais a penalidade');
  assert.match(computeAbsentOutcome(fran).result, /^\d\d:\d\d$/);
});

// ---------------------------------------------------------------------------
// Progresso ao vivo e telão (AC7, AC8)
// ---------------------------------------------------------------------------

test('progresso ao vivo da distância: os metros em repsDone, o instante do último lançamento que conta e nenhum campo novo', () => {
  const live = (events) => summarizeLiveProgress(DISTANCE, events, '2026-11-01T12:00:00.000Z');
  assert.deepEqual(live([dist(4500, 600), dist(6330, 1200)]), {
    seq: 2, lastMarkAt: 1200, clockStartAt: '2026-11-01T12:00:00.000Z', repsDone: 6330, roundsCompleted: 0, segments: [], currentSegmentId: null,
    round: null, completedAt: null, scoreKg: null, attemptsUsed: null, currentLiftId: null
  });
  const afterUndo = live([dist(4500, 600), dist(6330, 1200), undo(1, 1210)]);
  assert.deepEqual([afterUndo.seq, afterUndo.repsDone, afterUndo.lastMarkAt], [3, 4500, 600], 'o undo não é a chegada');
  const none = live([]);
  assert.deepEqual([none.seq, none.repsDone, none.lastMarkAt], [0, 0, null]);
  assert.deepEqual(readLiveProgress(JSON.parse(JSON.stringify(live([dist(5915, 1100)])))), live([dist(5915, 1100)]));
});

test('rankLiveEntries da distância: maior total primeiro e, no empate, quem lançou antes; raia sem lançamento no fim', () => {
  const progress = (events) => summarizeLiveProgress(DISTANCE, events, null);
  const ranked = rankLiveEntries('distance', [
    { lane: 4, progress: progress([]) },
    { lane: 3, progress: progress([dist(5915, 1100)]) },
    { lane: 2, progress: progress([dist(6330, 1190)]) },
    { lane: 1, progress: progress([dist(6330, 1100)]) }
  ]);
  assert.deepEqual(ranked.map((entry) => [entry.lane, entry.position]), [[1, 1], [2, 2], [3, 3], [4, null]]);
  const tied = rankLiveEntries('distance', [
    { lane: 1, progress: progress([dist(6000, 1000)]) },
    { lane: 2, progress: progress([dist(6000, 1000)]) }
  ]);
  assert.deepEqual(tied.map((entry) => entry.position), [1, 1]);
});

test('describeWorkoutForBoard aceita a distância sem lançar (os rótulos do telão são da Story 1.69)', () => {
  const board = describeWorkoutForBoard({ name: 'Remo e corrida', code: 'W3' }, DISTANCE);
  assert.equal(board.format, 'distance');
  assert.equal(board.timeCapSeconds, 1200);
  assert.deepEqual(board.segments, []);
  assert.equal(board.totalReps, 0);
});

// ---------------------------------------------------------------------------
// Caso de teste aprovado (AC9): prova de 20:00, A 6330, B 6330, C 5915, D ausente
// ---------------------------------------------------------------------------

test('caso aprovado: resultados 6330, 6330, 5915 e 0; posições 1, 1, 3, 4 e pontos 1, 1, 3, 4 pelo caminho real do ranking', () => {
  const logs = {
    A: [dist(4500, 600), dist(6330, 1200)],
    B: [dist(6330, 1205)],
    C: [dist(5915, 1198)]
  };
  const scores = Object.entries(logs).map(([athleteId, events]) => {
    const outcome = computeSheetOutcome(DISTANCE, events);
    assert.equal(outcome.ok, true, athleteId);
    return { athleteId, result: outcome.result, value: outcome.value };
  });
  assert.deepEqual(scores.map((score) => [score.athleteId, score.result, score.value]), [['A', '6330', 6330], ['B', '6330', 6330], ['C', '5915', 5915]]);
  const absent = computeAbsentOutcome(DISTANCE);
  scores.push({ athleteId: 'D', result: absent.result, value: absent.value, resultStatus: 'absent' });

  const legacy = deriveLegacyWorkoutFields(DISTANCE);
  assert.equal(legacy.type, 'distance');
  const ranked = rankWorkoutScores(legacy.type, legacy.tieBreaker, scores, 4);
  assert.deepEqual(
    Object.fromEntries(ranked.map((score) => [score.athleteId, [score.rank, score.points]])),
    { A: [1, 1], B: [1, 1], C: [3, 3], D: [4, 4] }
  );
});
