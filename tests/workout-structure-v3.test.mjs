import assert from 'node:assert/strict';
import test from 'node:test';

import { importServerModule } from './support/serverModuleHarness.mjs';

import {
  WORKOUT_STRUCTURE_LIMITS,
  WORKOUT_STRUCTURE_VERSION,
  checkIntervalEntry,
  checkOfficialTime,
  computeIntervalResult,
  deriveIntervalState,
  deriveLegacyWorkoutFields,
  deriveSheetState,
  intervalPhaseAt,
  reconcileWorkoutStructure,
  validateWorkoutStructure
} from '../src/lib/workoutStructure.ts';

// Story 1.60: versão 3 do contrato da estrutura da prova e o motor do
// Intervalado (docs/design/intervalado/README.md e intervalado-aprovado.html).
// Contrato (formato interval, limites, duração igual à soma, fixos e máximo),
// normalização da 1 e da 2 para a 3, motor (round e janela, rd nas correções,
// pontuação do round no estado final), resultado, fase pelo relógio, porta da
// tela com paridade com o motor e o caso de teste aprovado (A, B, C e D). Se o
// caso aprovado falhar, o resultado ou o ranking mudou.

const { computeSheetOutcome, computeAbsentOutcome } = await importServerModule('lib/scoresheet.ts');
const { rankWorkoutScores } = await importServerModule('lib/scoring.ts');

// ---------------------------------------------------------------------------
// Fixtures: 5 rounds de 02:00 ON / 02:00 OFF, 6 Ring Muscle Ups, 15 Box Jump
// Overs e o máximo de Squat Clean 80 kg (duração 18:00)
// ---------------------------------------------------------------------------

const fixed = (id, name, reps, extra = {}) => ({
  id, round: 1, name, reps, unit: 'reps', load: null, note: '', required: true, mark: 'reps', ...extra
});
const MAX = { id: 'mx', name: 'Squat Clean', load: { value: 80, unit: 'kg' }, note: '' };

const intervalInput = (overrides = {}, intervalOverrides = {}) => ({
  version: 3,
  format: 'interval',
  totalReps: 21,
  timeCapSeconds: 1080,
  incomplete: null,
  tieBreak: null,
  generator: null,
  customized: true,
  entry: { mode: 'both', marking: 'reps', publish: 'after_review' },
  segments: [fixed('f1', 'Ring Muscle Up', 6), fixed('f2', 'Box Jump Over', 15, { note: '24/20 in' })],
  maxLoad: null,
  scoreDisplay: null,
  interval: { rounds: 5, onSeconds: 120, offSeconds: 120, max: { ...MAX, load: { ...MAX.load } }, ...intervalOverrides },
  ...overrides
});

const forTimeV2 = () => ({
  version: 2, format: 'for_time', totalReps: 21, timeCapSeconds: 600,
  incomplete: { rule: 'penalty_per_rep', secondsPerRep: 1, base: 'time_cap' }, tieBreak: null, generator: null, customized: true,
  entry: { mode: 'both', marking: 'reps', publish: 'after_review' },
  segments: [fixed('a', 'Thruster', 21)], maxLoad: null, scoreDisplay: null
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

const INTERVAL = valid(intervalInput());
// Sem descanso: 5 × 02:00, duração 10:00.
const NO_REST = valid(intervalInput({ timeCapSeconds: 600 }, { offSeconds: 0 }));

const rep = (seg, at) => ({ t: 'rep', seg, at });
const fill = (seg, n, at) => ({ t: 'fill', seg, n, at });
const set = (seg, v, rd, at = 1100) => ({ t: 'set', seg, v, rd, at });
const adj = (seg, d, rd, at = 1100) => ({ t: 'adj', seg, d, rd, at });
const undo = (of, at = 1100) => ({ t: 'undo', of, at });

// Um round inteiro no log: os fixos concluídos (ou o segundo parado em `f2`) e o máximo tocado a cada 5 s.
const roundLog = (index, maxReps, f2 = 15) => {
  const start = index * 240;
  return [
    fill('f1', 6, start + 15),
    fill('f2', f2, start + 45),
    ...Array.from({ length: maxReps }, (_, k) => rep('mx', start + 50 + k * 5))
  ];
};
const athleteLog = (perRound, lastRoundF2 = 15) => perRound.flatMap((maxReps, index) => roundLog(index, maxReps, index === perRound.length - 1 ? lastRoundF2 : 15));

// ---------------------------------------------------------------------------
// Contrato v3 (AC1)
// ---------------------------------------------------------------------------

test('versão 3: o caso aprovado é aceito, normalizado e idempotente, com as chaves do contrato na ordem', () => {
  assert.equal(WORKOUT_STRUCTURE_VERSION, 3);
  assert.deepEqual(INTERVAL, {
    version: 3,
    format: 'interval',
    totalReps: 21,
    timeCapSeconds: 1080,
    incomplete: null,
    tieBreak: null,
    generator: null,
    customized: true,
    entry: { mode: 'both', marking: 'reps', publish: 'after_review' },
    segments: [fixed('f1', 'Ring Muscle Up', 6), fixed('f2', 'Box Jump Over', 15, { note: '24/20 in' })],
    maxLoad: null,
    scoreDisplay: null,
    interval: { rounds: 5, onSeconds: 120, offSeconds: 120, max: { id: 'mx', name: 'Squat Clean', load: { value: 80, unit: 'kg' }, note: '' } }
  });
  assert.deepEqual(Object.keys(INTERVAL), ['version', 'format', 'totalReps', 'timeCapSeconds', 'incomplete', 'tieBreak', 'generator', 'customized', 'entry', 'segments', 'maxLoad', 'scoreDisplay', 'interval']);
  assert.deepEqual(valid(JSON.parse(JSON.stringify(INTERVAL))), INTERVAL, 'validar de novo devolve a mesma estrutura');

  // Textos do máximo saem sem espaços nas pontas, e o resultado é um objeto novo.
  const input = intervalInput({}, { max: { id: ' mx ', name: '  Squat Clean ', load: { value: 80, unit: 'kg' }, note: '  ' } });
  const structure = valid(input);
  assert.deepEqual(structure.interval.max, { id: 'mx', name: 'Squat Clean', load: { value: 80, unit: 'kg' }, note: '' });
  assert.notEqual(structure.interval, input.interval);
  assert.notEqual(structure.interval.max, input.interval.max);
  assert.notEqual(structure.interval.max.load, input.interval.max.load);
});

test('versão 3: 0 fixos, OFF = 0, máximo sem carga, fixos em calorias e as bordas dos limites são aceitos', () => {
  const zero = valid(intervalInput({ segments: [], totalReps: 0 }));
  assert.deepEqual([zero.segments, zero.totalReps], [[], 0]);
  assert.equal(NO_REST.timeCapSeconds, 600);
  assert.equal(valid(intervalInput({}, { max: { ...MAX, load: null } })).interval.max.load, null);
  valid(intervalInput({ segments: [fixed('f1', 'Bike', 20, { unit: 'cal', mark: 'end' })], totalReps: 20 }));

  const L = WORKOUT_STRUCTURE_LIMITS;
  assert.deepEqual(
    [L.minIntervalRounds, L.maxIntervalRounds, L.minIntervalOnSeconds, L.maxIntervalOnSeconds, L.minIntervalOffSeconds, L.maxIntervalOffSeconds, L.maxIntervalFixedSegments, L.maxIntervalMaxRepsPerRound],
    [2, 20, 30, 1800, 0, 1800, 9, 999]
  );
  valid(intervalInput({ timeCapSeconds: 2 * 30 + 1800 }, { rounds: 2, onSeconds: 30, offSeconds: 1800 }));
  valid(intervalInput({ timeCapSeconds: 3 * 1800 }, { rounds: 3, onSeconds: 1800, offSeconds: 0 }));
  // 20 × 04:59 + 19 × 00:01 = 5999 s, o maior permitido.
  valid(intervalInput({ timeCapSeconds: 5999 }, { rounds: 20, onSeconds: 299, offSeconds: 1 }));
  const nine = Array.from({ length: 9 }, (_, index) => fixed(`f${index + 1}`, `Movimento ${index + 1}`, 1));
  valid(intervalInput({ segments: nine, totalReps: 9 }));
});

test('versão 3: limites, duração igual à soma e campos que ficam vazios no intervalado', () => {
  rejects(intervalInput({ timeCapSeconds: 1200 }), /^No intervalado, o time cap deve ser igual à duração da prova \(18:00\): rounds × trabalho \+ \(rounds − 1\) × descanso, sem descanso depois do último round\.$/);
  rejects(intervalInput({ timeCapSeconds: 1200 }), /\(18:00\)/, 'diz a soma esperada');
  // Com descanso depois do último round seria 20:00: não vale.
  rejects(intervalInput({ timeCapSeconds: 1200 }), /time cap deve ser igual/);
  rejects(intervalInput({ timeCapSeconds: '1080' }), /time cap deve ser igual/);

  const rounds = /^No intervalado, os rounds devem ser um número inteiro entre 2 e 20\.$/;
  rejects(intervalInput({ timeCapSeconds: 120 }, { rounds: 1 }), rounds);
  rejects(intervalInput({ timeCapSeconds: 21 * 120 + 20 * 120 }, { rounds: 21 }), rounds);
  rejects(intervalInput({}, { rounds: 2.5 }), rounds);
  const on = /^No intervalado, o tempo de trabalho \(onSeconds\) deve ser um número inteiro de segundos entre 30 e 1800 \(de 00:30 a 30:00\)\.$/;
  rejects(intervalInput({}, { onSeconds: 29 }), on);
  rejects(intervalInput({}, { onSeconds: 1801 }), on);
  const off = /^No intervalado, o tempo de descanso \(offSeconds\) deve ser um número inteiro de segundos entre 0 e 1800 \(de 00:00 a 30:00\)\.$/;
  rejects(intervalInput({}, { offSeconds: 1801 }), off);
  rejects(intervalInput({}, { offSeconds: -1 }), off);
  // 20 × 05:00 sem descanso = 6000 s.
  rejects(intervalInput({ timeCapSeconds: 6000 }, { rounds: 20, onSeconds: 300, offSeconds: 0 }), /^No intervalado, a duração total \(rounds × trabalho \+ descansos entre os rounds\) deve ser de até 5999 segundos \(99:59\)\.$/);

  const ten = Array.from({ length: 10 }, (_, index) => fixed(`f${index + 1}`, `Movimento ${index + 1}`, 1));
  rejects(intervalInput({ segments: ten, totalReps: 10 }), /^No intervalado, a prova tem de 0 a 9 movimentos fixos por round\.$/);
  rejects(intervalInput({ segments: [fixed('f1', 'Ring Muscle Up', 6), fixed('f2', 'Box Jump Over', 15, { round: 2 })] }), /^Segmento 2: no intervalado os movimentos fixos descrevem um round: a rodada \(round\) deve ser 1\.$/);
  rejects(intervalInput({}, { max: { ...MAX, id: 'f2' } }), /^Movimento máximo: o identificador repete o de um movimento fixo\.$/);
  rejects(intervalInput({ totalReps: 20 }), /igual à soma das repetições dos segmentos \(21\)/);

  // Sem desempate nesta versão (decisão 7), em qualquer forma.
  const noTieBreak = /^O intervalado não tem desempate nesta versão: o campo fica vazio \(null\)\.$/;
  rejects(intervalInput({ tieBreak: { kind: 'split_time', at: 'f1', order: 'asc' } }), noTieBreak);
  rejects(intervalInput({ tieBreak: { kind: 'last_round', order: 'asc' } }), noTieBreak);
  rejects(intervalInput({ tieBreak: { kind: 'finish_time', order: 'asc' } }), noTieBreak);
  rejects(intervalInput({ tieBreak: { kind: 'last_split', at: ['f1'], order: 'asc' } }), noTieBreak);

  rejects(intervalInput({ incomplete: { rule: 'penalty_per_rep', secondsPerRep: 1, base: 'time_cap' } }), /^No intervalado, a regra de não conclusão deve ficar vazia \(null\)\.$/);
  rejects(intervalInput({ generator: { kind: 'fixed', reps: [6] }, customized: false }), /^No intervalado o gerador deve ficar vazio \(null\)\.$/);
  rejects(intervalInput({ customized: false }), /customized falso\) precisa do gerador/);
  rejects(intervalInput({ maxLoad: { lifts: [], order: 'fixed', scoring: 'sum', loadStepKg: 2.5 } }), /só existem em provas de carga máxima/);
  rejects(intervalInput({ scoreDisplay: 'total' }), /nos outros formatos o campo fica vazio/);
});

test('versão 3: o campo interval é obrigatório no intervalado e vazio nos outros formatos; chaves estranhas e caractere nulo são recusados', () => {
  const shape = /^No intervalado, informe o campo interval com os rounds \(rounds\), o tempo de trabalho \(onSeconds\), o tempo de descanso \(offSeconds\) e o movimento máximo \(max\)\.$/;
  rejects(intervalInput({ interval: null }), shape);
  rejects(intervalInput({ interval: [] }), shape);
  const missing = intervalInput();
  delete missing.interval;
  rejects(missing, shape);

  const onlyThere = /^O campo interval só existe em provas intervaladas: fora delas fica vazio \(null\)\.$/;
  const forTimeV3 = { ...forTimeV2(), version: 3, interval: null };
  const forTime = valid(forTimeV3);
  assert.equal(forTime.interval, null);
  rejects({ ...forTimeV3, interval: INTERVAL.interval }, onlyThere);
  const withoutKey = { ...forTimeV3 };
  delete withoutKey.interval;
  rejects(withoutKey, onlyThere, 'na versão 3 a chave interval faz parte do contrato');

  rejects({ ...intervalInput(), extra: 1 }, /^A estrutura da prova tem um campo que não faz parte do contrato\.$/);
  rejects(intervalInput({}, { cap: 1 }), /^O campo interval tem um campo que não faz parte do contrato\.$/);
  rejects(intervalInput({}, { max: { ...MAX, reps: 10 } }), /^Movimento máximo: o movimento tem um campo que não faz parte do contrato\.$/);
  rejects(intervalInput({}, { max: { ...MAX, load: { value: 80, unit: 'lb' } } }), /^Movimento máximo: a carga deve ser vazia \(null\) ou um valor entre 0 e 500 kg\.$/);
  rejects(intervalInput({}, { max: { ...MAX, load: { value: 80, unit: 'kg', x: 1 } } }), /^Movimento máximo: a carga/);
  rejects(intervalInput({}, { max: { ...MAX, name: '   ' } }), /^Movimento máximo: informe o nome do movimento, com até 60 caracteres\.$/);
  rejects(intervalInput({}, { max: { ...MAX, id: 'com espaço' } }), /^Movimento máximo: o identificador deve ter de 1 a 40 caracteres/);
  rejects(intervalInput({}, { max: { ...MAX, note: 'x'.repeat(301) } }), /^Movimento máximo: a observação deve ser um texto de até 300 caracteres/);
  rejects(intervalInput({}, { max: 'Squat Clean' }), /^Movimento máximo: o movimento máximo deve ser um objeto\.$/);
  for (const key of ['id', 'name', 'note']) {
    rejects(intervalInput({}, { max: { ...MAX, [key]: 'Squat\u0000Clean' } }), /^Movimento máximo: o texto não pode conter o caractere nulo \(U\+0000\)\.$/, key);
  }

  // As mensagens dizem o campo e o limite, sem devolver o que foi enviado.
  const echoed = rejects(intervalInput({}, { max: { ...MAX, name: 'SEGREDO'.repeat(20) } }));
  assert.doesNotMatch(echoed, /SEGREDO|\{|"/);
  // Nunca lança, nem com um getter que lança.
  const hostile = intervalInput();
  Object.defineProperty(hostile.interval, 'rounds', { enumerable: true, get() { throw new Error('boom'); } });
  assert.deepEqual(validateWorkoutStructure(hostile), { ok: false, error: 'A estrutura da prova é inválida.' });
});

test('versões: a 1 e a 2 entram e saem na 3 com interval vazio; nelas o intervalado é recusado com mensagem própria', () => {
  const fromV1 = valid(forTimeV1());
  const fromV2 = valid(forTimeV2());
  for (const structure of [fromV1, fromV2]) {
    assert.equal(structure.version, 3);
    assert.equal(structure.interval, null);
    assert.deepEqual(valid(structure), structure, 'a 3 revalidada é igual');
  }
  assert.deepEqual(fromV1, fromV2);

  const ownMessage = /^O formato intervalado \(interval\) e o campo interval exigem a versão 3 da estrutura\.$/;
  rejects({ ...forTimeV2(), interval: null }, ownMessage);
  rejects({ ...forTimeV1(), interval: null }, ownMessage);
  rejects({ ...intervalInput(), version: 2 }, ownMessage);
  rejects({ ...intervalInput(), version: 1 }, ownMessage);
  const v2Format = { ...forTimeV2(), format: 'interval' };
  rejects(v2Format, ownMessage);
  rejects({ ...forTimeV2(), version: 4 }, /^A versão da estrutura da prova deve ser 1, 2 ou 3\.$/);
});

test('reconcileWorkoutStructure copia o interval por valor e campos legados do intervalado são reps, a duração e sem desempate', () => {
  const copy = reconcileWorkoutStructure(INTERVAL);
  assert.deepEqual(copy, INTERVAL);
  assert.notEqual(copy.interval, INTERVAL.interval);
  assert.notEqual(copy.interval.max, INTERVAL.interval.max);
  assert.notEqual(copy.interval.max.load, INTERVAL.interval.max.load);
  copy.interval.max.load.value = 100;
  assert.equal(INTERVAL.interval.max.load.value, 80, 'a original não muda');
  assert.equal(reconcileWorkoutStructure(valid(forTimeV2())).interval, null);

  assert.deepEqual(deriveLegacyWorkoutFields(INTERVAL), { type: 'reps', timeCap: '18:00', tieBreaker: '' });
  assert.deepEqual(deriveLegacyWorkoutFields(NO_REST), { type: 'reps', timeCap: '10:00', tieBreaker: '' });
});

// ---------------------------------------------------------------------------
// Motor (AC2)
// ---------------------------------------------------------------------------

const countsAt = (structure, at, seg = 'f1') => {
  const state = deriveIntervalState(structure, [rep(seg, at)]);
  return state.ignored.length === 0 && state.lastRound !== null ? state.lastRound : null;
};

test('motor: os vetores de atribuição da maquete (00:35, 01:59, 02:00, 03:30, 04:10, 18:00)', () => {
  assert.equal(countsAt(INTERVAL, 35), 1, '00:35 conta no round 1');
  assert.equal(countsAt(INTERVAL, 119, 'mx'), 1, '01:59 conta no round 1');
  assert.equal(countsAt(INTERVAL, 120, 'mx'), null, '02:00 fora: a janela fechou');
  assert.equal(countsAt(INTERVAL, 210, 'f2'), null, '03:30 fora: descanso do round 1');
  assert.equal(countsAt(INTERVAL, 250), 2, '04:10 conta no round 2');
  assert.equal(countsAt(INTERVAL, 1080, 'mx'), null, '18:00 fora: a prova terminou em 17:59');
  assert.equal(countsAt(INTERVAL, 1079, 'mx'), 5, '17:59 é o último segundo do round 5');
  assert.equal(countsAt(INTERVAL, 119.9), 1, 'o motor aplica Math.floor');
  assert.equal(countsAt(INTERVAL, 240), 2, '04:00 abre o round 2');
  assert.equal(countsAt(INTERVAL, 239), null);

  const log = [rep('f1', 35), rep('mx', 119), rep('mx', 120), rep('f2', 210), rep('f1', 250), rep('mx', 1080)];
  const state = deriveIntervalState(INTERVAL, log);
  assert.deepEqual(state.ignored, [2, 3, 5], 'as posições fora da janela vão para a lista ignored');
  assert.deepEqual(state.rounds.map((round) => [round.fixed, round.maxRaw]), [[[1, 0], 1], [[1, 0], 0], [[0, 0], 0], [[0, 0], 0], [[0, 0], 0]]);
  assert.deepEqual([state.lastRound, state.lastCountedAt], [2, 250], 'o registro fora da janela não é o último que conta');
});

test('motor: com OFF = 0 o ciclo é só o ON e a prova termina em rounds × ON', () => {
  assert.equal(countsAt(NO_REST, 0), 1);
  assert.equal(countsAt(NO_REST, 120), 2);
  assert.equal(countsAt(NO_REST, 599), 5);
  assert.equal(countsAt(NO_REST, 600), null);
});

test('motor: set e adj valem pelo rd; sem rd, rd fora de 1 a rounds ou não inteiro o evento é ignorado por inteiro', () => {
  const state = deriveIntervalState(INTERVAL, [set('mx', 7, 3, 1100), adj('mx', -2, 3, 1101), set('f1', 6, 3, 5), adj('f2', 15, 3)]);
  assert.deepEqual([state.rounds[2].fixed, state.rounds[2].maxRaw, state.rounds[2].maxCounted, state.rounds[2].scored], [[6, 15], 5, 5, true]);
  assert.deepEqual(state.ignored, [], 'correção não passa pela janela');
  assert.equal(state.lastRound, 3);

  for (const rd of [undefined, 0, 6, 2.5, '2', null]) {
    const ignored = deriveIntervalState(INTERVAL, [{ t: 'set', seg: 'mx', v: 7, at: 30, rd }, { t: 'adj', seg: 'mx', d: 3, at: 30, rd }]);
    assert.equal(ignored.rounds.every((round) => round.maxRaw === 0), true, String(rd));
    assert.deepEqual([ignored.ignored, ignored.lastRound, ignored.lastCountedAt], [[], null, null], String(rd));
  }
});

test('motor: o round só pontua com os fixos na meta, avaliado no estado final; a contagem bruta fica guardada', () => {
  // Round 5 de A: Box Jump Overs 11/15 e 3 Squat Cleans registrados.
  const partial = deriveIntervalState(INTERVAL, roundLog(4, 3, 11));
  assert.deepEqual([partial.rounds[4].fixed, partial.rounds[4].maxRaw, partial.rounds[4].maxCounted, partial.rounds[4].scored], [[6, 11], 3, 0, false]);
  assert.equal(partial.total, 0);
  assert.equal(partial.rounds[4].currentId, 'f2', 'a vez é do fixo abaixo da meta');

  // A correção que completa o fixo depois faz o round pontuar, em qualquer ordem.
  const corrected = deriveIntervalState(INTERVAL, [...roundLog(4, 3, 11), set('f2', 15, 5)]);
  const correctedFirst = deriveIntervalState(INTERVAL, [set('f2', 15, 5, 0), ...roundLog(4, 3, 11)]);
  assert.deepEqual([corrected.rounds[4].maxCounted, corrected.total], [3, 3]);
  assert.equal(corrected.rounds[4].currentId, 'mx');
  assert.deepEqual(computeIntervalResult(correctedFirst), computeIntervalResult(corrected), 'a ordem da correção não muda o resultado');

  // Sem fixos, todo round pontua.
  const onlyMax = valid(intervalInput({ segments: [], totalReps: 0 }));
  const free = deriveIntervalState(onlyMax, [rep('mx', 10), rep('mx', 250)]);
  assert.deepEqual([free.roundsScored, free.total, free.rounds[0].currentId], [5, 2, 'mx']);
});

test('motor: contagem limitada (fixo até a meta, máximo até o teto, nada abaixo de 0) e undo como nos outros formatos', () => {
  const capped = deriveIntervalState(INTERVAL, [fill('f1', 50, 10), adj('f2', 99, 1), set('mx', 5000, 1), adj('mx', -9999, 2)]);
  assert.deepEqual([capped.rounds[0].fixed, capped.rounds[0].maxRaw, capped.rounds[1].maxRaw], [[6, 15], WORKOUT_STRUCTURE_LIMITS.maxIntervalMaxRepsPerRound, 0]);
  assert.equal(capped.rounds[0].maxRaw, 999);

  const withUndo = deriveIntervalState(INTERVAL, [...roundLog(0, 2), undo(3), undo(4)]);
  assert.equal(withUndo.rounds[0].maxRaw, 1, 'undo anula o evento apontado; undo de undo não tem efeito');
  const undoOutside = deriveIntervalState(INTERVAL, [rep('mx', 130), undo(0)]);
  assert.deepEqual(undoOutside.ignored, [], 'o registro fora da janela desfeito sai do aviso');
});

test('motor: eventos malformados e de outros formatos são ignorados por inteiro; a função é pura e determinística', () => {
  const noise = [
    { t: 'fill', seg: 'mx', n: 5, at: 10 },
    { t: 'time', target: 'final', v: 100, at: 100 },
    { t: 'attempt', lift: 'mx', load: 80, ok: true, at: 20 },
    { t: 'emom', seg: 'f1', at: 5 },
    rep('zz', 5),
    rep('f1', -1),
    rep('f1', Number.NaN),
    { t: 'fill', seg: 'f1', n: 2.5, at: 5 },
    null,
    'rep',
    [1, 2]
  ];
  const state = deriveIntervalState(INTERVAL, noise);
  assert.deepEqual([state.total, state.ignored, state.lastRound, state.rounds.every((round) => round.maxRaw === 0 && round.fixed.every((done) => done === 0))], [0, [], null, true]);

  const log = athleteLog([9, 8, 5, 1, 3], 11);
  const structureCopy = structuredClone(INTERVAL);
  const logCopy = structuredClone(log);
  const first = deriveIntervalState(INTERVAL, log);
  assert.deepEqual(deriveIntervalState(INTERVAL, log), first);
  assert.deepEqual(INTERVAL, structureCopy, 'a estrutura não muda');
  assert.deepEqual(log, logCopy, 'o log não muda');
  assert.doesNotThrow(() => deriveIntervalState(null, null));
  assert.doesNotThrow(() => deriveIntervalState({ ...INTERVAL, interval: { rounds: 'x' } }, log));
  assert.deepEqual(deriveIntervalState({ ...INTERVAL, interval: null }, log).rounds, []);

  // O motor de For Time contaria o registro do descanso: o intervalado não o reaproveita.
  assert.equal(deriveSheetState(INTERVAL, [rep('f1', 210)]).repsDone, 1);
  assert.equal(deriveIntervalState(INTERVAL, [rep('f1', 210)]).rounds[0].fixed[0], 0);
});

// ---------------------------------------------------------------------------
// Resultado, fase e porta da tela (AC3)
// ---------------------------------------------------------------------------

test('resultado: soma do máximo dos rounds que pontuaram, número e texto, sem desempate, com o detalhe por round', () => {
  const result = computeIntervalResult(deriveIntervalState(INTERVAL, athleteLog([9, 8, 5, 1, 3], 11)));
  assert.deepEqual(result, {
    format: 'interval',
    value: 23,
    display: '23',
    tieBreak: null,
    roundsScored: 4,
    rounds: [
      { round: 1, fixed: [6, 15], maxRaw: 9, maxCounted: 9, scored: true },
      { round: 2, fixed: [6, 15], maxRaw: 8, maxCounted: 8, scored: true },
      { round: 3, fixed: [6, 15], maxRaw: 5, maxCounted: 5, scored: true },
      { round: 4, fixed: [6, 15], maxRaw: 1, maxCounted: 1, scored: true },
      { round: 5, fixed: [6, 11], maxRaw: 3, maxCounted: 0, scored: false }
    ],
    ignoredCount: 0
  });
  const empty = computeIntervalResult(deriveIntervalState(INTERVAL, []));
  assert.deepEqual([empty.value, empty.display, empty.tieBreak, empty.roundsScored], [0, '0', null, 0]);
});

test('fase pelo relógio: 0, 119, 120, 250, 1079 e 1080; com OFF = 0 nunca há descanso', () => {
  assert.deepEqual(intervalPhaseAt(INTERVAL, 0), { phase: 'work', round: 1, secondsLeft: 120 });
  assert.deepEqual(intervalPhaseAt(INTERVAL, 119), { phase: 'work', round: 1, secondsLeft: 1 });
  assert.deepEqual(intervalPhaseAt(INTERVAL, 120), { phase: 'rest', round: 1, secondsLeft: 120 });
  assert.deepEqual(intervalPhaseAt(INTERVAL, 250), { phase: 'work', round: 2, secondsLeft: 110 });
  assert.deepEqual(intervalPhaseAt(INTERVAL, 1079), { phase: 'work', round: 5, secondsLeft: 1 });
  assert.deepEqual(intervalPhaseAt(INTERVAL, 1080), { phase: 'ended' });
  assert.deepEqual(intervalPhaseAt(INTERVAL, 5000), { phase: 'ended' });
  assert.deepEqual(intervalPhaseAt(INTERVAL, 239), { phase: 'rest', round: 1, secondsLeft: 1 });
  assert.deepEqual(intervalPhaseAt(INTERVAL, 119.7), { phase: 'work', round: 1, secondsLeft: 1 });

  for (let second = 0; second < 600; second += 1) assert.equal(intervalPhaseAt(NO_REST, second).phase, 'work', String(second));
  assert.deepEqual(intervalPhaseAt(NO_REST, 600), { phase: 'ended' });
  assert.deepEqual(intervalPhaseAt(valid(forTimeV2()), 10), { phase: 'ended' }, 'sem intervalado, encerrada');
});

test('porta da tela: mensagens aprovadas e paridade com o motor em todos os segundos de 0 a 1080 (e com OFF = 0)', () => {
  assert.deepEqual(checkIntervalEntry(INTERVAL, 35), { ok: true, round: 1 });
  assert.deepEqual(checkIntervalEntry(INTERVAL, 210), { ok: false, error: 'Descanso: o toque não foi aceito.' });
  assert.deepEqual(checkIntervalEntry(INTERVAL, 1080), { ok: false, error: 'Prova encerrada: o toque não foi aceito.' });
  assert.deepEqual(checkIntervalEntry(valid(forTimeV2()), 10), { ok: false, error: 'Esta prova não é intervalada.' });
  assert.deepEqual(checkIntervalEntry(INTERVAL, -1), { ok: false, error: 'Não foi possível conferir o toque.' });
  assert.doesNotThrow(() => checkIntervalEntry(null, 10));

  for (const [structure, end] of [[INTERVAL, 1080], [NO_REST, 600]]) {
    for (let second = 0; second <= end; second += 1) {
      const door = checkIntervalEntry(structure, second);
      const engine = countsAt(structure, second);
      assert.equal(door.ok, engine !== null, `segundo ${second}`);
      if (door.ok) assert.equal(door.round, engine, `round no segundo ${second}`);
    }
  }
});

test('ajuste do tempo oficial não vale para o intervalado (checkOfficialTime)', () => {
  const state = deriveSheetState(INTERVAL, []);
  for (const target of ['final', 'tiebreak']) {
    assert.deepEqual(checkOfficialTime(INTERVAL, state, target, 600), { ok: false, error: 'O ajuste manual do tempo não vale para provas intervaladas: o resultado são as repetições e o tempo é o dos rounds.' });
  }
});

// ---------------------------------------------------------------------------
// Caso de teste aprovado (AC4)
// ---------------------------------------------------------------------------

test('caso aprovado: A 23, B 40, C 40, D ausente 0 → posições 1, 1, 3, 4 e pontos 1, 1, 3, 4', () => {
  const logs = {
    // Round 5 de A com Box Jump Overs 11/15: os 3 Squat Cleans não contam. Mais um toque no descanso.
    A: [...athleteLog([9, 8, 5, 1, 3], 11), rep('mx', 130)],
    B: athleteLog([10, 9, 8, 7, 6]),
    C: athleteLog([8, 8, 8, 8, 8])
  };
  const perRound = (log) => deriveIntervalState(INTERVAL, log).rounds.map((round) => round.maxCounted);
  assert.deepEqual(perRound(logs.A), [9, 8, 5, 1, 0]);
  assert.deepEqual(perRound(logs.B), [10, 9, 8, 7, 6]);
  assert.deepEqual(perRound(logs.C), [8, 8, 8, 8, 8]);
  const stateA = deriveIntervalState(INTERVAL, logs.A);
  assert.deepEqual([stateA.rounds[4].maxRaw, stateA.rounds[4].fixed, stateA.ignored.length], [3, [6, 11], 1]);

  const outcomes = Object.fromEntries(Object.entries(logs).map(([id, log]) => [id, computeSheetOutcome(INTERVAL, log)]));
  assert.deepEqual(outcomes.A, { ok: true, result: '23', value: 23, tieBreak: null, summary: '23 repetições em 5 rounds (4 pontuaram)' });
  assert.deepEqual(outcomes.B, { ok: true, result: '40', value: 40, tieBreak: null, summary: '40 repetições em 5 rounds (5 pontuaram)' });
  assert.deepEqual(outcomes.C, { ok: true, result: '40', value: 40, tieBreak: null, summary: '40 repetições em 5 rounds (5 pontuaram)' });

  const absent = computeAbsentOutcome(INTERVAL);
  assert.deepEqual(absent, { ok: true, result: '0', value: 0, tieBreak: null, summary: 'Atleta ausente · 0 repetições' });
  const empty = computeSheetOutcome(INTERVAL, []);
  assert.deepEqual([empty.result, empty.value, empty.tieBreak], [absent.result, absent.value, absent.tieBreak], 'o ausente coincide com o log vazio');

  const legacyType = deriveLegacyWorkoutFields(INTERVAL).type;
  const ranked = rankWorkoutScores(legacyType, '', [
    { athleteId: 'A', result: outcomes.A.result, value: outcomes.A.value, splits: {} },
    { athleteId: 'B', result: outcomes.B.result, value: outcomes.B.value, splits: {} },
    { athleteId: 'C', result: outcomes.C.result, value: outcomes.C.value, splits: {} },
    { athleteId: 'D', result: absent.result, value: absent.value, splits: {}, resultStatus: 'absent' }
  ], 4);
  assert.deepEqual(Object.fromEntries(ranked.map((score) => [score.athleteId, [score.rank, score.points]])), { A: [3, 3], B: [1, 1], C: [1, 1], D: [4, 4] });
});
