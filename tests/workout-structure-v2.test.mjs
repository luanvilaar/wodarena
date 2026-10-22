import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

import {
  WORKOUT_STRUCTURE_LIMITS,
  checkAttempt,
  checkOfficialTime,
  computeMaxLoadResult,
  computeSheetResult,
  deriveLegacyWorkoutFields,
  deriveMaxLoadState,
  deriveSheetState,
  maxSegmentAmount,
  reconcileWorkoutStructure,
  validateWorkoutStructure
} from '../src/lib/workoutStructure.ts';

// Stories 1.47 e 1.48: versão 2 do contrato da estrutura da prova. Carga
// máxima (formato, validação, motor de tentativas, resultado e porta), unidade
// de cada segmento (repetições, calorias, metros), desempates pelo último
// marco concluído e pelo último round completo, forma de exibir o AMRAP e a
// entrada na versão 1 normalizada para a 2. O módulo é importado direto, sem
// transpilar; scoring.ts é transpilado só para conferir a paridade.

const scoringSource = readFileSync(new URL('../src/lib/scoring.ts', import.meta.url), 'utf8')
  .replace("import { WorkoutType } from '@/types';\n\n", '');
const scoring = await import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(scoringSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText).toString('base64')}`);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const segment = (id, round, name, reps, extra = {}) => ({
  id, round, name, reps, unit: 'reps', load: null, note: '', required: true, mark: 'reps', ...extra
});

const base = {
  version: 2,
  generator: null,
  customized: true,
  entry: { mode: 'both', marking: 'reps', publish: 'after_review' },
  maxLoad: null,
  scoreDisplay: null
};

// Fran (21-15-9 de Thruster e Pull-up) com o desempate no último set de pull-up concluído.
const franInput = (overrides = {}) => ({
  ...base,
  format: 'for_time',
  totalReps: 90,
  timeCapSeconds: 600,
  incomplete: { rule: 'penalty_per_rep', secondsPerRep: 1, base: 'time_cap' },
  tieBreak: { kind: 'last_split', at: ['s2', 's4', 's6'], order: 'asc' },
  generator: { kind: 'descending', reps: [21, 15, 9] },
  customized: false,
  segments: [
    segment('s1', 1, 'Thruster', 21, { load: { value: 43, unit: 'kg' } }),
    segment('s2', 1, 'Pull-up', 21),
    segment('s3', 2, 'Thruster', 15, { load: { value: 43, unit: 'kg' } }),
    segment('s4', 2, 'Pull-up', 15),
    segment('s5', 3, 'Thruster', 9, { load: { value: 43, unit: 'kg' } }),
    segment('s6', 3, 'Pull-up', 9)
  ],
  ...overrides
});

// Remo de 500 m, 30 cal de bike e 20 burpees.
const unitsInput = (overrides = {}) => ({
  ...base,
  format: 'for_time',
  totalReps: 550,
  timeCapSeconds: 900,
  incomplete: { rule: 'penalty_per_rep', secondsPerRep: 0, base: 'time_cap' },
  tieBreak: { kind: 'split_time', at: 'u2', order: 'asc' },
  segments: [
    segment('u1', 1, 'Remo', 500, { unit: 'm', mark: 'end' }),
    segment('u2', 1, 'Bike', 30, { unit: 'cal', mark: 'end' }),
    segment('u3', 1, 'Burpee', 20)
  ],
  ...overrides
});

// Cindy (5 pull-ups, 10 push-ups, 15 squats) em 20 min, desempate no último round completo.
const cindyInput = (overrides = {}) => ({
  ...base,
  format: 'amrap',
  totalReps: 30,
  timeCapSeconds: 1200,
  incomplete: null,
  tieBreak: { kind: 'last_round', order: 'asc' },
  scoreDisplay: 'rounds_reps',
  segments: [segment('c1', 1, 'Pull-up', 5), segment('c2', 1, 'Push-up', 10), segment('c3', 1, 'Air squat', 15)],
  ...overrides
});

// CrossFit Total: agachamento, press e deadlift, até 3 tentativas cada, ordem fixa, soma, desempate por tempo.
const totalInput = (overrides = {}, maxLoadOverrides = {}) => ({
  ...base,
  format: 'max_load',
  totalReps: 0,
  timeCapSeconds: 1200,
  incomplete: null,
  tieBreak: { kind: 'finish_time', order: 'asc' },
  segments: [],
  maxLoad: {
    lifts: [
      { id: 'l1', name: 'Back Squat', reps: 1, maxAttempts: 3, startLoadKg: 100, note: '' },
      { id: 'l2', name: 'Press', reps: 1, maxAttempts: 3, startLoadKg: 40, note: '' },
      { id: 'l3', name: 'Deadlift', reps: 1, maxAttempts: 3, startLoadKg: 120, note: '' }
    ],
    order: 'fixed',
    scoring: 'sum',
    loadStepKg: 2.5,
    ...maxLoadOverrides
  },
  ...overrides
});

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

const FRAN = valid(franInput());
const CINDY = valid(cindyInput());
const TOTAL = valid(totalInput());

// n repetições na ordem dos segmentos, a k-ésima no instante k × passo.
const repsInOrder = (structure, n, step = 2) => {
  const order = structure.segments.flatMap((item) => Array.from({ length: item.reps }, () => item.id));
  return Array.from({ length: n }, (_, index) => ({ t: 'rep', seg: order[index % order.length], at: (index + 1) * step }));
};
const attempt = (lift, load, ok, at) => ({ t: 'attempt', lift, load, ok, at });
const undo = (of, at = 1199) => ({ t: 'undo', of, at });

// ---------------------------------------------------------------------------
// Versão 1 aceita e normalizada para a 2
// ---------------------------------------------------------------------------

test('versão 1 vira 2: segmentos em repetições, sem carga máxima e AMRAP em rounds + repetições', () => {
  const v1ForTime = {
    version: 1, format: 'for_time', totalReps: 21, timeCapSeconds: 600,
    incomplete: { rule: 'penalty_per_rep', secondsPerRep: 1, base: 'time_cap' },
    tieBreak: { kind: 'split_time', at: 'a', order: 'asc' }, generator: { kind: 'fixed', reps: [21] }, customized: false,
    entry: { mode: 'both', marking: 'reps', publish: 'after_review' },
    segments: [{ id: 'a', round: 1, name: 'Thruster', reps: 21, load: null, note: '', required: true, mark: 'reps' }]
  };
  const upgraded = valid(v1ForTime);
  // Story 1.66: a versão 1 sai normalizada na 4, com interval e distance vazios.
  assert.equal(upgraded.version, 4);
  assert.equal(upgraded.interval, null);
  assert.equal(upgraded.distance, null);
  assert.equal(upgraded.segments[0].unit, 'reps');
  assert.equal(upgraded.maxLoad, null);
  assert.equal(upgraded.scoreDisplay, null);
  assert.deepEqual(valid(upgraded), upgraded, 'normalizar a versão 3 de novo não muda nada');

  const v1Amrap = { ...v1ForTime, format: 'amrap', incomplete: null, tieBreak: null };
  assert.equal(valid(v1Amrap).scoreDisplay, 'rounds_reps');

  // Na versão 1 não existem os campos novos.
  rejects({ ...v1ForTime, maxLoad: null }, /^A estrutura da prova tem um campo que não faz parte do contrato\.$/);
  rejects({ ...v1ForTime, segments: [{ ...v1ForTime.segments[0], unit: 'reps' }] }, /^Segmento 1: o segmento tem um campo que não faz parte do contrato\.$/);
  rejects({ ...v1ForTime, tieBreak: { kind: 'last_split', at: ['a'], order: 'asc' } }, /^O desempate deve ser vazio \(null\) ou o tempo de um segmento \(split_time\)/);
});

test('versão 2: idempotente e com as chaves do contrato na ordem', () => {
  for (const structure of [FRAN, CINDY, TOTAL, valid(unitsInput())]) {
    assert.deepEqual(valid(JSON.parse(JSON.stringify(structure))), structure);
    // Story 1.66: a versão 2 sai normalizada na 4, com as chaves interval e distance (vazias) no fim.
    assert.deepEqual(Object.keys(structure), ['version', 'format', 'totalReps', 'timeCapSeconds', 'incomplete', 'tieBreak', 'generator', 'customized', 'entry', 'segments', 'maxLoad', 'scoreDisplay', 'interval', 'distance']);
    assert.equal(structure.version, 4);
    assert.equal(structure.interval, null);
    assert.equal(structure.distance, null);
  }
});

// ---------------------------------------------------------------------------
// Unidades (Story 1.48)
// ---------------------------------------------------------------------------

test('unidades: limites por unidade nas bordas e metros só como bloco', () => {
  assert.deepEqual(['reps', 'cal', 'm'].map(maxSegmentAmount), [99, 999, 10000]);
  const withAmount = (unit, reps, mark = unit === 'm' ? 'end' : 'reps') => {
    const input = unitsInput({ tieBreak: null });
    input.segments[2] = segment('u3', 1, 'Movimento', reps, { unit, mark });
    input.totalReps = input.segments.reduce((sum, item) => sum + item.reps, 0);
    return input;
  };
  for (const [unit, max, message] of [
    ['reps', 99, /^Segmento 3: as repetições devem ser um número inteiro entre 1 e 99\.$/],
    ['cal', 999, /^Segmento 3: as calorias devem ser um número inteiro entre 1 e 999\.$/],
    ['m', 10000, /^Segmento 3: os metros devem ser um número inteiro entre 1 e 10000\.$/]
  ]) {
    valid(withAmount(unit, 1));
    valid(withAmount(unit, max));
    rejects(withAmount(unit, max + 1), message, `${unit} ${max + 1}`);
    rejects(withAmount(unit, 0), message, `${unit} 0`);
  }
  valid(withAmount('cal', 30, 'reps'));
  rejects(withAmount('m', 400, 'reps'), /^Segmento 3: em metros, o judge só conclui o bloco: a marcação \(mark\) deve ser end\.$/);
  rejects(withAmount('km', 4), /^Segmento 3: a unidade \(unit\) deve ser reps, cal ou m\.$/);
  const missing = unitsInput();
  delete missing.segments[0].unit;
  rejects(missing, /^Segmento 1: a unidade \(unit\) deve ser reps, cal ou m\.$/);
});

test('unidades: o motor conta metros e calorias como unidades de trabalho, e a penalidade vale por unidade', () => {
  const structure = valid(unitsInput({ incomplete: { rule: 'penalty_per_rep', secondsPerRep: 1, base: 'time_cap' } }));
  const events = [
    { t: 'fill', seg: 'u1', n: 500, at: 110 },
    { t: 'fill', seg: 'u2', n: 30, at: 200 },
    ...Array.from({ length: 12 }, (_, index) => ({ t: 'rep', seg: 'u3', at: 210 + index * 5 }))
  ];
  const state = deriveSheetState(structure, events);
  assert.deepEqual(state.segments.map((item) => item.done), [500, 30, 12]);
  assert.equal(state.repsDone, 542);
  assert.equal(state.repsRemaining, 8);
  assert.equal(state.tieBreakAt, 200);
  const result = computeSheetResult(structure, state);
  assert.equal(result.value, 908);
  assert.equal(result.display, '15:08');

  // Parou no meio do remo: o judge informa onde parou (set).
  const partial = deriveSheetState(structure, [{ t: 'set', seg: 'u1', v: 350, at: 900 }]);
  assert.equal(partial.segments[0].done, 350);
  assert.equal(partial.currentSegmentId, 'u1');
});

// ---------------------------------------------------------------------------
// Desempate pelo último marco concluído (For Time, Story 1.48)
// ---------------------------------------------------------------------------

test('último marco: valida marcos, normaliza na ordem da prova e só vale em For Time', () => {
  assert.deepEqual(FRAN.tieBreak, { kind: 'last_split', at: ['s2', 's4', 's6'], order: 'asc' });
  assert.deepEqual(valid(franInput({ tieBreak: { kind: 'last_split', at: [' s6', 's2 '], order: 'asc' } })).tieBreak.at, ['s2', 's6']);
  rejects(franInput({ tieBreak: { kind: 'last_split', at: [], order: 'asc' } }), /^O desempate pelo último marco precisa de 1 a 30 marcos diferentes/);
  rejects(franInput({ tieBreak: { kind: 'last_split', at: ['s2', 's2'], order: 'asc' } }), /marcos diferentes/);
  rejects(franInput({ tieBreak: { kind: 'last_split', at: ['s9'], order: 'asc' } }), /^O desempate aponta para um segmento que não existe na prova\.$/);
  rejects(franInput({ tieBreak: { kind: 'last_split', at: 's2', order: 'asc' } }), /^O desempate de For Time deve ser vazio/);
  rejects(franInput({ tieBreak: { kind: 'last_split', at: ['s2'], order: 'desc' } }), /^O desempate de For Time deve ser vazio/);
  rejects(franInput({ tieBreak: { kind: 'last_split', at: ['s2\u0000'], order: 'asc' } }), /caractere nulo/);
  rejects(franInput({ tieBreak: { kind: 'last_round', order: 'asc' } }), /^O desempate de For Time deve ser vazio/);
  rejects(cindyInput({ tieBreak: { kind: 'last_split', at: ['c1'], order: 'asc' } }), /^O desempate de AMRAP deve ser vazio/);
  valid(cindyInput({ tieBreak: { kind: 'split_time', at: 'c2', order: 'asc' } }));
});

test('último marco: vale o tempo do último set de pull-up concluído (padrão do Open 26.2)', () => {
  // 82 de 90: Pull-up do round 2 (s4) concluído na 72ª repetição; o do round 3 (s6) não.
  const capped = deriveSheetState(FRAN, repsInOrder(FRAN, 82));
  assert.equal(capped.tieBreakSegmentId, 's4');
  assert.equal(capped.tieBreakAt, 144);
  assert.equal(capped.tieBreakCapturedAt, 144);
  const result = computeSheetResult(FRAN, capped);
  assert.equal(result.display, '10:08');
  assert.equal(result.tieBreakDisplay, '02:24');
  assert.ok(scoring.compareTimeTieBreaker('02:20', result.tieBreakDisplay) < 0, 'menor vence entre empatados em repetições');

  // Antes do primeiro set completo não há desempate.
  const early = deriveSheetState(FRAN, repsInOrder(FRAN, 30));
  assert.equal(early.tieBreakAt, null);
  assert.equal(early.tieBreakSegmentId, null);

  // Concluiu: o último marco é o último set (s6).
  const finished = deriveSheetState(FRAN, repsInOrder(FRAN, 90));
  assert.equal(finished.tieBreakSegmentId, 's6');
  assert.equal(finished.tieBreakAt, 180);
  assert.equal(finished.tieBreakAfterEnd, false);

  // Desfazer a última repetição de s4 volta o marco para s2.
  const events = repsInOrder(FRAN, 72);
  const reopened = deriveSheetState(FRAN, [...events, undo(71, 150)]);
  assert.equal(reopened.tieBreakSegmentId, 's2');
  assert.equal(reopened.tieBreakAt, 84);
});

test('último marco: o ajuste oficial vale para o marco em que foi informado e cai quando o próximo marco é concluído', () => {
  const events = [...repsInOrder(FRAN, 72), { t: 'time', target: 'tiebreak', v: 140, at: 145 }];
  const adjusted = deriveSheetState(FRAN, events);
  assert.equal(adjusted.tieBreakAt, 140);
  assert.equal(adjusted.tieBreakCapturedAt, 144);
  assert.equal(adjusted.tieBreakAdjusted, true);
  assert.equal(adjusted.tieBreakDeltaSeconds, -4);
  assert.deepEqual(checkOfficialTime(FRAN, deriveSheetState(FRAN, repsInOrder(FRAN, 72)), 'tiebreak', 140), { ok: true });

  const moved = deriveSheetState(FRAN, [...events, ...repsInOrder(FRAN, 90).slice(72)]);
  assert.equal(moved.tieBreakSegmentId, 's6');
  assert.equal(moved.tieBreakAt, 180);
  assert.equal(moved.tieBreakAdjusted, false, 'o ajuste do set anterior não vale para o último set');

  const undone = deriveSheetState(FRAN, [...events, undo(events.length - 1, 146)]);
  assert.equal(undone.tieBreakAt, 144);
  assert.equal(undone.tieBreakAdjusted, false);
});

// ---------------------------------------------------------------------------
// AMRAP: último round completo e forma de exibir (Story 1.48)
// ---------------------------------------------------------------------------

test('último round completo: o instante em que o último round fechou, com ajuste oficial que cai no round seguinte', () => {
  const sevenRounds = repsInOrder(CINDY, 222, 5);
  const state = deriveSheetState(CINDY, sevenRounds);
  assert.equal(state.roundsCompleted, 7);
  assert.equal(state.tieBreakAt, 1050, '210ª repetição fecha o 7º round');
  assert.equal(state.tieBreakSegmentId, null);
  const result = computeSheetResult(CINDY, state);
  assert.equal(result.value, 222);
  assert.equal(result.display, '222');
  assert.equal(result.tieBreakDisplay, '17:30');

  assert.equal(deriveSheetState(CINDY, repsInOrder(CINDY, 29, 5)).tieBreakAt, null, 'sem round completo, sem desempate');
  assert.match(checkOfficialTime(CINDY, deriveSheetState(CINDY, repsInOrder(CINDY, 29, 5)), 'tiebreak', 100).error, /depois que o primeiro round for concluído/);

  const withOfficial = [...sevenRounds, { t: 'time', target: 'tiebreak', v: 1048, at: 1112 }];
  assert.equal(deriveSheetState(CINDY, withOfficial).tieBreakAt, 1048);
  const nextRound = deriveSheetState(CINDY, [...withOfficial, ...repsInOrder(CINDY, 240, 5).slice(222).map((event) => ({ ...event, at: event.at + 10 }))]);
  assert.equal(nextRound.roundsCompleted, 8);
  assert.equal(nextRound.tieBreakAt, 1210);
  assert.equal(nextRound.tieBreakAdjusted, false);
});

test('AMRAP: a forma de exibir é obrigatória no AMRAP e vazia nos outros formatos; o valor é sempre o total', () => {
  assert.equal(valid(cindyInput({ scoreDisplay: 'total' })).scoreDisplay, 'total');
  rejects(cindyInput({ scoreDisplay: null }), /^No AMRAP, o score aparece como rounds \+ repetições/);
  rejects(cindyInput({ scoreDisplay: 'rounds' }), /No AMRAP/);
  rejects(franInput({ scoreDisplay: 'total' }), /No AMRAP/);
  const total = valid(cindyInput({ scoreDisplay: 'total' }));
  assert.equal(computeSheetResult(total, deriveSheetState(total, repsInOrder(total, 222, 5))).value, 222);
});

// ---------------------------------------------------------------------------
// Carga máxima: contrato (Story 1.47)
// ---------------------------------------------------------------------------

test('carga máxima: estrutura válida, sem segmentos, com janela opcional e campos legados', () => {
  assert.equal(TOTAL.format, 'max_load');
  assert.deepEqual(TOTAL.segments, []);
  assert.equal(TOTAL.totalReps, 0);
  assert.deepEqual(deriveLegacyWorkoutFields(TOTAL), { type: 'maxweight', timeCap: '20:00', tieBreaker: 'Tempo' });
  const noWindow = valid(totalInput({ timeCapSeconds: null, tieBreak: { kind: 'fewest_attempts', order: 'asc' } }));
  assert.equal(noWindow.timeCapSeconds, null);
  assert.deepEqual(deriveLegacyWorkoutFields(noWindow), { type: 'maxweight', timeCap: '', tieBreaker: '' });
  assert.deepEqual(deriveLegacyWorkoutFields(valid(totalInput({ tieBreak: null }))).tieBreaker, '');
  assert.deepEqual(deriveLegacyWorkoutFields(CINDY), { type: 'amrap', timeCap: '20:00', tieBreaker: 'Tempo' });
});

test('carga máxima: validação de formato, janela, segmentos, gerador, regra de não conclusão e desempate', () => {
  rejects(totalInput({ timeCapSeconds: 29 }), /^A janela da prova de carga máxima deve ficar vazia \(null\) ou ser um número inteiro de segundos entre 30 e 5999\.$/);
  rejects(totalInput({ timeCapSeconds: 600.5 }), /janela/);
  rejects(franInput({ timeCapSeconds: null }), /^O time cap da prova deve ser um número inteiro de segundos entre 30 e 5999\.$/);
  rejects(totalInput({ segments: [segment('s1', 1, 'Burpee', 1)], totalReps: 1 }), /^Em carga máxima a prova não tem segmentos/);
  rejects(totalInput({ totalReps: 3 }), /igual à soma das repetições dos segmentos \(0\)/);
  rejects(totalInput({ incomplete: { rule: 'penalty_per_rep', secondsPerRep: 1, base: 'time_cap' } }), /^Em carga máxima, a regra de não conclusão deve ficar vazia \(null\)\.$/);
  rejects(totalInput({ generator: { kind: 'fixed', reps: [1] }, customized: false }), /^Em carga máxima o gerador deve ficar vazio \(null\)\.$/);
  rejects(totalInput({ tieBreak: { kind: 'split_time', at: 'l1', order: 'asc' } }), /^O desempate de carga máxima deve ser vazio/);
  rejects(totalInput({ tieBreak: { kind: 'finish_time', order: 'asc', at: 'x' } }), /desempate de carga máxima/);
  rejects(totalInput({ scoreDisplay: 'total' }), /No AMRAP/);
  rejects(totalInput({ maxLoad: null }), /^Em carga máxima, informe de 1 a 5 movimentos/);
  rejects(franInput({ maxLoad: totalInput().maxLoad }), /^Os movimentos de carga só existem em provas de carga máxima/);
});

test('carga máxima: limites dos movimentos nas bordas', () => {
  const lift = (overrides = {}) => ({ id: 'l1', name: 'Snatch', reps: 1, maxAttempts: 3, startLoadKg: null, note: '', ...overrides });
  const withLifts = (lifts, overrides = {}) => totalInput({}, { lifts, ...overrides });
  valid(withLifts([lift()]));
  valid(withLifts([1, 2, 3, 4, 5].map((n) => lift({ id: `l${n}` }))));
  rejects(withLifts([]), /de 1 a 5 movimentos/);
  rejects(withLifts([1, 2, 3, 4, 5, 6].map((n) => lift({ id: `l${n}` }))), /de 1 a 5 movimentos/);
  rejects(withLifts([lift(), lift()]), /^Movimento de carga 2: o identificador repete o de outro movimento\.$/);
  for (const [reps, ok] of [[0, false], [1, true], [10, true], [11, false], [1.5, false]]) {
    if (ok) valid(withLifts([lift({ reps })]));
    else rejects(withLifts([lift({ reps })]), /^Movimento de carga 1: as repetições por tentativa devem ser um número inteiro entre 1 e 10\.$/);
  }
  for (const [maxAttempts, ok] of [[null, true], [1, true], [3, true], [0, false], [4, false], ['3', false]]) {
    if (ok) valid(withLifts([lift({ maxAttempts })]));
    else rejects(withLifts([lift({ maxAttempts })]), /^Movimento de carga 1: as tentativas devem ser de 1 a 3 ou ilimitadas \(null\)\.$/);
  }
  for (const [startLoadKg, ok] of [[null, true], [0, true], [42.5, true], [500, true], [501, false], [-1, false]]) {
    if (ok) valid(withLifts([lift({ startLoadKg })]));
    else rejects(withLifts([lift({ startLoadKg })]), /^Movimento de carga 1: a carga inicial deve ficar vazia \(null\) ou entre 0 e 500 kg\.$/);
  }
  rejects(withLifts([lift({ name: '  ' })]), /^Movimento de carga 1: informe o nome do movimento/);
  rejects(withLifts([lift({ id: 'l 1' })]), /identificador/);
  rejects(withLifts([lift({ extra: 1 })]), /campo que não faz parte do contrato/);
  rejects(withLifts([lift({ note: 'x\u0000' })]), /caractere nulo/);
  for (const [loadStepKg, ok] of [[0.25, true], [25, true], [0.2, false], [26, false], [Number.NaN, false]]) {
    if (ok) valid(withLifts([lift()], { loadStepKg }));
    else rejects(withLifts([lift()], { loadStepKg }), /incremento de carga entre 0.25 e 25 kg/);
  }
  rejects(withLifts([lift()], { order: 'any' }), /a ordem \(fixed ou free\)/);
  rejects(withLifts([lift()], { scoring: 'avg' }), /o score \(sum ou best\)/);
  const trimmed = valid(withLifts([lift({ id: ' l1 ', name: '  Snatch ', note: ' nota ' })]));
  assert.deepEqual(trimmed.maxLoad.lifts[0], { id: 'l1', name: 'Snatch', reps: 1, maxAttempts: 3, startLoadKg: null, note: 'nota' });
});

// ---------------------------------------------------------------------------
// Carga máxima: motor (Story 1.47)
// ---------------------------------------------------------------------------

// Uma Total completa: agachamento 140 ✓, 150 ✗, 150 ✓; press 60 ✓, 65 ✓, 70 ✗; deadlift 180 ✓, 190 ✓, 200 ✗.
const TOTAL_RUN = [
  attempt('l1', 140, true, 60), attempt('l1', 150, false, 180), attempt('l1', 150, true, 300),
  attempt('l2', 60, true, 420), attempt('l2', 65, true, 540), attempt('l2', 70, false, 660),
  attempt('l3', 180, true, 780), attempt('l3', 190, true, 900), attempt('l3', 200, false, 1020)
];

test('carga máxima: soma das maiores cargas válidas, instante da última tentativa e texto aceito pelo ranking', () => {
  const state = deriveMaxLoadState(TOTAL, TOTAL_RUN);
  assert.deepEqual(state.lifts.map((lift) => [lift.bestKg, lift.used, lift.remaining, lift.exhausted]), [
    [150, 3, 0, true], [65, 3, 0, true], [190, 3, 0, true]
  ]);
  assert.equal(state.lifts[0].bestAt, 300);
  assert.equal(state.scoreKg, 405);
  assert.equal(state.attemptsUsed, 9);
  assert.equal(state.lastAttemptAt, 1020);
  assert.equal(state.currentLiftId, null, 'tudo concluído');
  assert.deepEqual(state.ignored, []);

  const result = computeMaxLoadResult(TOTAL, state);
  assert.equal(result.value, 405);
  assert.equal(result.display, '405');
  assert.deepEqual(scoring.parseScoreForWorkout('maxweight', result.display), { result: '405', value: 405 });
  assert.equal(result.tieBreakSeconds, 1020);
  assert.equal(result.tieBreakDisplay, '17:00');
  assert.equal(result.tieBreakAttempts, null);
  assert.deepEqual(result.lifts, [{ id: 'l1', bestKg: 150 }, { id: 'l2', bestKg: 65 }, { id: 'l3', bestKg: 190 }]);
});

test('carga máxima: ordem fixa, limite de tentativas, janela e undo', () => {
  const going = deriveMaxLoadState(TOTAL, TOTAL_RUN.slice(0, 2));
  assert.equal(going.currentLiftId, 'l1');
  assert.equal(going.lifts[0].remaining, 1);
  assert.equal(deriveMaxLoadState(TOTAL, TOTAL_RUN.slice(0, 3)).currentLiftId, 'l2', 'três tentativas usadas: passa ao press');
  assert.equal(deriveMaxLoadState(TOTAL, []).currentLiftId, 'l1');

  const fourth = deriveMaxLoadState(TOTAL, [...TOTAL_RUN.slice(0, 3), attempt('l1', 155, true, 310)]);
  assert.equal(fourth.lifts[0].bestKg, 150);
  assert.deepEqual(fourth.ignored, [3]);

  const back = deriveMaxLoadState(TOTAL, [attempt('l1', 140, true, 60), attempt('l2', 60, true, 120), attempt('l1', 160, true, 200)]);
  assert.equal(back.lifts[0].bestKg, 140, 'em ordem fixa, não se volta ao agachamento');
  assert.deepEqual(back.ignored, [2]);
  assert.equal(back.currentLiftId, 'l2');

  const skipped = deriveMaxLoadState(TOTAL, [attempt('l1', 140, true, 60), attempt('l3', 180, true, 120)]);
  assert.equal(skipped.lifts[1].used, 0, 'pular para a frente é permitido');
  assert.equal(skipped.currentLiftId, 'l3');

  const late = deriveMaxLoadState(TOTAL, [attempt('l1', 140, true, 1200), attempt('l1', 150, true, 1201)]);
  assert.equal(late.lifts[0].bestKg, 140, 'no último segundo da janela conta; depois, não');
  assert.deepEqual(late.ignored, [1]);
  const noWindow = valid(totalInput({ timeCapSeconds: null }));
  assert.equal(deriveMaxLoadState(noWindow, [attempt('l1', 150, true, 5000)]).lifts[0].bestKg, 150);

  const undone = deriveMaxLoadState(TOTAL, [...TOTAL_RUN.slice(0, 3), undo(2, 310)]);
  assert.equal(undone.lifts[0].bestKg, 140);
  assert.equal(undone.lifts[0].remaining, 1);
  assert.equal(undone.currentLiftId, 'l1');
  const replaced = deriveMaxLoadState(TOTAL, [...TOTAL_RUN.slice(0, 3), undo(2, 310), attempt('l1', 152.5, true, 320)]);
  assert.equal(replaced.lifts[0].bestKg, 152.5);
});

test('carga máxima: ordem livre, maior carga única, decimais e tentativas ilimitadas', () => {
  const free = valid(totalInput({}, { order: 'free', scoring: 'best', lifts: [
    { id: 'fs', name: 'Front Squat', reps: 1, maxAttempts: null, startLoadKg: null, note: '' },
    { id: 'hpc', name: 'Hang Power Clean', reps: 1, maxAttempts: null, startLoadKg: null, note: '' }
  ] }));
  const events = [attempt('hpc', 92.5, true, 60), attempt('fs', 120, true, 180), attempt('hpc', 97.5, false, 300), attempt('hpc', 95.25, true, 400)];
  const state = deriveMaxLoadState(free, events);
  assert.deepEqual(state.ignored, []);
  assert.deepEqual(state.lifts.map((lift) => lift.bestKg), [120, 95.25]);
  assert.equal(state.scoreKg, 120);
  assert.equal(state.currentLiftId, 'hpc');
  assert.equal(state.lifts[1].remaining, null);
  assert.equal(computeMaxLoadResult(free, state).display, '120');

  const sum = valid(totalInput({}, { order: 'free', lifts: free.maxLoad.lifts }));
  const summed = computeMaxLoadResult(sum, deriveMaxLoadState(sum, events));
  assert.equal(summed.value, 215.25);
  assert.equal(summed.display, '215.25');
  assert.equal(scoring.parseScoreForWorkout('maxweight', summed.display).value, 215.25);
});

test('carga máxima: sem tentativa válida o score é 0; desempate por menos tentativas e sem desempate', () => {
  const failed = computeMaxLoadResult(TOTAL, deriveMaxLoadState(TOTAL, [attempt('l1', 150, false, 60)]));
  assert.equal(failed.value, 0);
  assert.equal(failed.display, '0');
  const empty = computeMaxLoadResult(TOTAL, deriveMaxLoadState(TOTAL, []));
  assert.equal(empty.tieBreakSeconds, null, 'sem tentativa, sem desempate');

  const fewest = valid(totalInput({ tieBreak: { kind: 'fewest_attempts', order: 'asc' } }));
  const result = computeMaxLoadResult(fewest, deriveMaxLoadState(fewest, TOTAL_RUN.slice(0, 5)));
  assert.equal(result.tieBreakAttempts, 5);
  assert.equal(result.tieBreakSeconds, null);
  assert.equal(computeMaxLoadResult(fewest, deriveMaxLoadState(fewest, [])).tieBreakAttempts, null);

  const none = valid(totalInput({ tieBreak: null }));
  const plain = computeMaxLoadResult(none, deriveMaxLoadState(none, TOTAL_RUN));
  assert.equal(plain.tieBreakSeconds, null);
  assert.equal(plain.tieBreakAttempts, null);
});

test('carga máxima: eventos malformados são ignorados e o motor é puro, determinístico e não lança', () => {
  const baseline = deriveMaxLoadState(TOTAL, [attempt('l1', 140, true, 60)]);
  for (const bad of [
    { t: 'attempt', lift: 'l9', load: 150, ok: true, at: 70 },
    { t: 'attempt', lift: 'l1', load: 501, ok: true, at: 70 },
    { t: 'attempt', lift: 'l1', load: -1, ok: true, at: 70 },
    { t: 'attempt', lift: 'l1', load: '150', ok: true, at: 70 },
    { t: 'attempt', lift: 'l1', load: 150, ok: 'sim', at: 70 },
    { t: 'attempt', lift: 'l1', load: 150, ok: true },
    { t: 'rep', seg: 'l1', at: 70 },
    null, 5, 'attempt'
  ]) {
    assert.deepEqual(deriveMaxLoadState(TOTAL, [attempt('l1', 140, true, 60), bad]), baseline, JSON.stringify(bad));
  }
  for (const events of [undefined, null, 'x', {}]) assert.equal(deriveMaxLoadState(TOTAL, events).attemptsUsed, 0);
  assert.doesNotThrow(() => deriveMaxLoadState(null, TOTAL_RUN));
  assert.equal(deriveMaxLoadState(null, TOTAL_RUN).scoreKg, 0);

  const frozen = structuredClone(TOTAL);
  const log = structuredClone(TOTAL_RUN);
  Object.freeze(frozen.maxLoad.lifts);
  Object.freeze(log);
  assert.deepEqual(deriveMaxLoadState(frozen, log), deriveMaxLoadState(frozen, log));
  assert.deepEqual(frozen, TOTAL);
  // A súmula de segmentos ignora tentativas, e a de carga máxima ignora repetições.
  assert.equal(deriveSheetState(TOTAL, TOTAL_RUN).repsDone, 0);
  assert.match(checkOfficialTime(TOTAL, deriveSheetState(TOTAL, []), 'final', 10).error, /ainda não vale para provas de carga máxima/);
});

test('checkAttempt: recusa o que o motor não contaria, com mensagem em português', () => {
  const fresh = deriveMaxLoadState(TOTAL, []);
  assert.deepEqual(checkAttempt(TOTAL, fresh, 'l1', 140, 60), { ok: true });
  assert.match(checkAttempt(TOTAL, fresh, 'l9', 140, 60).error, /^Escolha um movimento da prova\.$/);
  assert.match(checkAttempt(TOTAL, fresh, 'l1', 501, 60).error, /^A carga deve ficar entre 0 e 500 kg\.$/);
  assert.match(checkAttempt(TOTAL, fresh, 'l1', Number.NaN, 60).error, /entre 0 e 500 kg/);
  assert.match(checkAttempt(TOTAL, fresh, 'l1', 140, 1201).error, /^A janela de tempo terminou/);
  const done = deriveMaxLoadState(TOTAL, TOTAL_RUN.slice(0, 3));
  assert.match(checkAttempt(TOTAL, done, 'l1', 160, 400).error, /^As 3 tentativas de Back Squat já foram usadas\.$/);
  const onPress = deriveMaxLoadState(TOTAL, [attempt('l1', 140, true, 60), attempt('l2', 60, true, 120)]);
  assert.match(checkAttempt(TOTAL, onPress, 'l1', 150, 200).error, /^A ordem é fixa: Back Squat já ficou para trás\.$/);
  const single = valid(totalInput({}, { lifts: [{ id: 'sn', name: 'Snatch', reps: 1, maxAttempts: 1, startLoadKg: null, note: '' }] }));
  assert.match(checkAttempt(single, deriveMaxLoadState(single, [attempt('sn', 80, true, 10)]), 'sn', 85, 20).error, /^A tentativa de Snatch já foi usada\.$/);
  assert.match(checkAttempt(FRAN, fresh, 'l1', 140, 60).error, /^Esta prova não é de carga máxima\.$/);
  assert.doesNotThrow(() => checkAttempt(null, null, 'l1', 1, 1));
});

test('reconcile: tira do último marco os segmentos removidos e mantém a carga máxima', () => {
  const withoutS4 = { ...FRAN, segments: FRAN.segments.filter((item) => item.id !== 's4') };
  const reconciled = reconcileWorkoutStructure(withoutS4);
  assert.deepEqual(reconciled.tieBreak, { kind: 'last_split', at: ['s2', 's6'], order: 'asc' });
  assert.equal(reconciled.totalReps, 75);
  const noMarks = reconcileWorkoutStructure({ ...FRAN, segments: FRAN.segments.filter((item) => !['s2', 's4', 's6'].includes(item.id)) });
  assert.equal(noMarks.tieBreak, null);
  const totalCopy = reconcileWorkoutStructure(TOTAL);
  assert.deepEqual(totalCopy, TOTAL);
  assert.notEqual(totalCopy.maxLoad.lifts, TOTAL.maxLoad.lifts);
  assert.equal(WORKOUT_STRUCTURE_LIMITS.maxLifts, 5);
});
