import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

import {
  WORKOUT_STRUCTURE_LIMITS,
  WORKOUT_STRUCTURE_VERSION,
  checkOfficialTime,
  computeSheetResult,
  deriveLegacyWorkoutFields,
  deriveSheetState,
  formatWorkoutTime,
  reconcileWorkoutStructure,
  validateWorkoutStructure
} from '../src/lib/workoutStructure.ts';

// Story 1.43 (AC2 a AC7, AC12): estrutura da prova, validação, campos legados
// e motor da súmula, inclusive o ajuste manual do tempo (REQ-9). O módulo é
// importado direto (sem transpilar), o que prova que ele não tem imports nem
// sintaxe não apagável; scoring.ts é transpilado (sem a linha de import dos
// tipos), como em tests/scoring-parity.test.mjs, só para a paridade.

const moduleSource = readFileSync(new URL('../src/lib/workoutStructure.ts', import.meta.url), 'utf8');
const scoringSource = readFileSync(new URL('../src/lib/scoring.ts', import.meta.url), 'utf8')
  .replace("import { WorkoutType } from '@/types';\n\n", '');
const scoring = await import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(scoringSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText).toString('base64')}`);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const THRUSTER = { load: { value: 43, unit: 'kg' }, note: 'Agachamento completo e extensão total do quadril e dos braços no topo.' };
const PULL_UP = { note: 'Queixo acima da barra e cotovelos estendidos embaixo.' };

const segment = (id, round, name, reps, extra = {}) => ({
  id, round, name, reps, load: null, note: '', required: true, mark: 'reps', ...extra
});

// A prova do protótipo aprovado: Thruster (43 kg) e Pull-up em 21-15-9, cap
// 600, penalidade de 1 s por repetição, desempate no Pull-up do round 1 (s2).
const forTimeInput = () => ({
  version: 1,
  format: 'for_time',
  totalReps: 90,
  timeCapSeconds: 600,
  incomplete: { rule: 'penalty_per_rep', secondsPerRep: 1, base: 'time_cap' },
  tieBreak: { kind: 'split_time', at: 's2', order: 'asc' },
  generator: { kind: 'descending', reps: [21, 15, 9] },
  customized: false,
  entry: { mode: 'both', marking: 'reps', publish: 'after_review' },
  segments: [
    segment('s1', 1, 'Thruster', 21, THRUSTER),
    segment('s2', 1, 'Pull-up', 21, PULL_UP),
    segment('s3', 2, 'Thruster', 15, THRUSTER),
    segment('s4', 2, 'Pull-up', 15, PULL_UP),
    segment('s5', 3, 'Thruster', 9, THRUSTER),
    segment('s6', 3, 'Pull-up', 9, PULL_UP)
  ]
});

// AMRAP de 12 minutos com round de 30 (Thruster 10, Pull-up 10, Burpee 10).
const amrapInput = (overrides = {}) => ({
  version: 1,
  format: 'amrap',
  totalReps: 30,
  timeCapSeconds: 720,
  incomplete: null,
  tieBreak: { kind: 'split_time', at: 'a2', order: 'asc' },
  generator: null,
  customized: true,
  entry: { mode: 'sheet', marking: 'reps', publish: 'auto' },
  segments: [
    segment('a1', 1, 'Thruster', 10, THRUSTER),
    segment('a2', 1, 'Pull-up', 10, PULL_UP),
    segment('a3', 1, 'Burpee', 10)
  ],
  ...overrides
});

const valid = (input) => {
  const checked = validateWorkoutStructure(input);
  assert.equal(checked.ok, true, checked.error);
  return checked.structure;
};

const FOR_TIME = valid(forTimeInput());
const AMRAP = valid(amrapInput());

const withPenalty = (secondsPerRep) => valid({ ...forTimeInput(), incomplete: { rule: 'penalty_per_rep', secondsPerRep, base: 'time_cap' } });
const withTieBreakAt = (at) => valid({ ...forTimeInput(), tieBreak: at ? { kind: 'split_time', at, order: 'asc' } : null });

// n eventos `rep` na ordem dos segmentos, com at = round(k / n × ultimoAt).
const reps = (n, lastAt, structure = FOR_TIME) => {
  const events = [];
  let k = 0;
  for (const item of structure.segments) {
    for (let j = 0; j < item.reps && k < n; j += 1) {
      k += 1;
      events.push({ t: 'rep', seg: item.id, at: Math.round(k / n * lastAt) });
    }
  }
  return events;
};

// AMRAP: os segmentos se repetem em rounds; a k-ésima repetição no instante k.
const amrapReps = (n, structure = AMRAP) => {
  const events = [];
  const order = structure.segments.flatMap((item) => Array.from({ length: item.reps }, () => item.id));
  for (let k = 1; k <= n; k += 1) events.push({ t: 'rep', seg: order[(k - 1) % order.length], at: k });
  return events;
};

const state = (events, structure = FOR_TIME) => deriveSheetState(structure, events);
const result = (events, structure = FOR_TIME) => computeSheetResult(structure, deriveSheetState(structure, events));
const official = (target, v, at = 590, extra = {}) => ({ t: 'time', target, v, at, ...extra });
const undo = (of, at = 599) => ({ t: 'undo', of, at });

// Corrida A: 90 repetições terminando em 581 (desempate capturado em 271).
const RUN_A = reps(90, 581);
// Prova parada no cap: 82 repetições terminando em 598 (desempate capturado em 306).
const RUN_CAP = reps(82, 598);

const deepFreeze = (value) => {
  if (value && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
};

// ---------------------------------------------------------------------------
// Pureza
// ---------------------------------------------------------------------------

test('módulo puro: sem imports, sem enum, sem alias @/ e sem depender de scoring.ts', () => {
  assert.doesNotMatch(moduleSource, /^\s*import\s/m);
  assert.doesNotMatch(moduleSource, /\benum\b/);
  assert.doesNotMatch(moduleSource, /@\//);
  assert.doesNotMatch(moduleSource, /require\(/);
  // Story 1.47: a versão do contrato passou a 2; a 1 continua aceita na entrada (ver tests/workout-structure-v2.test.mjs).
  assert.equal(WORKOUT_STRUCTURE_VERSION, 2);
  assert.deepEqual(
    [WORKOUT_STRUCTURE_LIMITS.minReps, WORKOUT_STRUCTURE_LIMITS.maxReps, WORKOUT_STRUCTURE_LIMITS.maxSegments, WORKOUT_STRUCTURE_LIMITS.maxTimeCapSeconds],
    [1, 99, 30, 5999]
  );
});

test('deriveSheetState e computeSheetResult são determinísticos e não mutam as entradas', () => {
  const structure = deepFreeze(structuredClone(FOR_TIME));
  const events = deepFreeze([...structuredClone(RUN_A), official('final', 578), official('tiebreak', 268), undo(3)]);
  const first = deriveSheetState(structure, events);
  const second = deriveSheetState(structure, events);
  assert.deepEqual(first, second);
  assert.deepEqual(computeSheetResult(structure, first), computeSheetResult(structure, second));
  assert.deepEqual(structure, FOR_TIME);
  assert.notEqual(first.segments, second.segments);
  assert.doesNotThrow(() => checkOfficialTime(structure, deepFreeze(first), 'final', 570));
});

test('deriveSheetState não lança com log ausente, não lista ou com eventos que não são objetos', () => {
  for (const events of [undefined, null, 'rep', 5, {}, [null, 1, 'rep', [], { t: 'rep' }, { t: 'undo' }]]) {
    const current = deriveSheetState(FOR_TIME, events);
    assert.equal(current.repsDone, 0);
    assert.equal(current.currentSegmentId, 's1');
  }
});

// ---------------------------------------------------------------------------
// For Time (REQ-3, AC5)
// ---------------------------------------------------------------------------

test('exemplo obrigatório: cap 600, 82 de 90 com 1 s por repetição = 608 s ("10:08")', () => {
  const current = state(RUN_CAP);
  assert.equal(current.repsDone, 82);
  assert.equal(current.repsRemaining, 8);
  assert.equal(current.segments[0].completedAt, 153);
  assert.equal(current.tieBreakAt, 306);
  assert.equal(current.segments[5].completedAt, null);
  assert.equal(current.currentSegmentId, 's6');

  const outcome = computeSheetResult(FOR_TIME, current);
  assert.equal(outcome.format, 'for_time');
  assert.equal(outcome.completed, false);
  assert.equal(outcome.actualSeconds, 600);
  assert.equal(outcome.repsDone, 82);
  assert.equal(outcome.repsRemaining, 8);
  assert.equal(outcome.penaltySeconds, 8);
  assert.equal(outcome.adjustedSeconds, 608);
  assert.equal(outcome.value, 608);
  assert.equal(outcome.display, '10:08');
  assert.equal(outcome.capturedSeconds, null);
  assert.deepEqual(scoring.parseScoreForWorkout('fortime', outcome.display), { result: '10:08', value: 608 });

  const withThree = computeSheetResult(withPenalty(3), deriveSheetState(withPenalty(3), RUN_CAP));
  assert.equal(withThree.value, 624);
  assert.equal(withThree.display, '10:24');
});

test('concluída: tempo real = tempo ajustado = instante da última repetição', () => {
  const current = state(RUN_A);
  assert.equal(current.repsRemaining, 0);
  assert.equal(current.currentSegmentId, null);
  assert.equal(current.segments[5].completedAt, 581);
  const outcome = computeSheetResult(FOR_TIME, current);
  assert.equal(outcome.completed, true);
  assert.equal(outcome.actualSeconds, 581);
  assert.equal(outcome.adjustedSeconds, 581);
  assert.equal(outcome.penaltySeconds, 0);
  assert.equal(outcome.value, 581);
  assert.equal(outcome.display, '09:41');
  assert.equal(outcome.capturedSeconds, 581);
  assert.equal(outcome.finalAdjusted, false);
  assert.equal(outcome.finalDeltaSeconds, null);
});

test('penalidade 0: quem não concluiu empata com quem concluiu exatamente no cap', () => {
  const zero = withPenalty(0);
  const unfinished = computeSheetResult(zero, deriveSheetState(zero, reps(80, 590, zero)));
  assert.equal(unfinished.value, 600);
  assert.equal(unfinished.penaltySeconds, 0);
  const finishedAtCap = computeSheetResult(zero, deriveSheetState(zero, reps(90, 600, zero)));
  assert.equal(finishedAtCap.value, 600);
  assert.equal(finishedAtCap.completed, true);
});

test('tempo menor ou igual a zero não vira display', () => {
  const tiny = valid({ ...forTimeInput(), totalReps: 1, tieBreak: null, segments: [segment('s1', 1, 'Burpee', 1)] });
  const atZero = computeSheetResult(tiny, deriveSheetState(tiny, [{ t: 'rep', seg: 's1', at: 0 }]));
  assert.equal(atZero.completed, true);
  assert.equal(atZero.value, 0);
  assert.equal(atZero.display, null);
});

test('undo anula um evento anterior sem apagar nada; undo de undo, inválido ou repetido não tem efeito extra', () => {
  const last = RUN_A.length - 1;
  const undone = state([...RUN_A, undo(last)]);
  assert.equal(undone.repsRemaining, 1);
  assert.equal(undone.completedAt, null);
  assert.equal(undone.segments[5].completedAt, null);

  const undoOfUndo = state([...RUN_A, undo(last), undo(last + 1)]);
  assert.deepEqual(undoOfUndo, undone, 'undo de undo não refaz');
  assert.deepEqual(state([...RUN_A, undo(last), undo(last)]), undone, 'dois undo do mesmo alvo equivalem a um');

  const complete = state(RUN_A);
  for (const invalid of [undo(9999), undo(-1), undo(1.5), undo('3'), { t: 'undo', at: 599 }]) {
    assert.deepEqual(state([...RUN_A, invalid]), complete, JSON.stringify(invalid));
  }
  // Para o próprio evento ou para um posterior: ignorado.
  assert.deepEqual(state([...RUN_A, undo(RUN_A.length)]), complete);
  const pointingForward = [...RUN_A.slice(0, 10), undo(11), ...RUN_A.slice(10)];
  assert.equal(state(pointingForward).repsDone, 90);
});

test('set, fill e adj ficam limitados a 0..reps; eventos malformados são ignorados por inteiro', () => {
  assert.equal(state([{ t: 'set', seg: 's1', v: 14, at: 30 }]).segments[0].done, 14);

  const setAbove = state([{ t: 'set', seg: 's1', v: 99, at: 40 }]);
  assert.equal(setAbove.segments[0].done, 21);
  assert.equal(setAbove.segments[0].completedAt, 40);

  const setNegative = state([{ t: 'set', seg: 's1', v: 14, at: 30 }, { t: 'set', seg: 's1', v: -3, at: 31 }]);
  assert.equal(setNegative.segments[0].done, 0);

  const baseline = state([{ t: 'set', seg: 's1', v: 14, at: 30 }]);
  for (const ignored of [
    { t: 'set', seg: 's1', v: 2.5, at: 31 },
    { t: 'set', seg: 's1', v: 5, at: Number.NaN },
    { t: 'set', seg: 's1', v: 5, at: -1 },
    { t: 'set', seg: 's1', v: 5, at: Number.POSITIVE_INFINITY },
    { t: 'set', seg: 's1', v: 5 },
    { t: 'adj', seg: 's1', d: Number.NaN, at: 31 },
    { t: 'fill', seg: 's1', n: '3', at: 31 },
    { t: 'jump', seg: 's1', at: 31 },
    { t: 'rep', seg: 'inexistente', at: 31 },
    { t: 'rep', seg: 0, at: 31 }
  ]) {
    assert.deepEqual(state([{ t: 'set', seg: 's1', v: 14, at: 30 }, ignored]), baseline, JSON.stringify(ignored));
  }

  const filled = state([{ t: 'rep', seg: 's1', at: 5 }, { t: 'fill', seg: 's1', n: 50, at: 60 }]);
  assert.equal(filled.segments[0].done, 21);
  assert.equal(filled.segments[0].completedAt, 60);
  assert.equal(filled.currentSegmentId, 's2');

  const zeroFill = state([{ t: 'rep', seg: 's1', at: 5 }, { t: 'fill', seg: 's1', n: 0, at: 60 }]);
  assert.equal(zeroFill.segments[0].done, 1);
  assert.equal(zeroFill.segments[0].completedAt, null);

  // at fracionário vira segundo inteiro.
  assert.equal(state([{ t: 'fill', seg: 's1', n: 21, at: 59.9 }]).segments[0].completedAt, 59);
});

test('evento duplicado e fora de faixa: rep em segmento concluído e segmento inexistente não mudam o total', () => {
  const firstDone = reps(21, 120);
  const before = state(firstDone);
  const duplicated = state([...firstDone, { t: 'rep', seg: 's1', at: 121 }, { t: 'fill', seg: 's1', n: 21, at: 122 }, { t: 'rep', seg: 'zz', at: 123 }]);
  assert.equal(duplicated.repsDone, before.repsDone);
  assert.equal(duplicated.segments[0].completedAt, before.segments[0].completedAt, 'a conclusão não se move');
});

test('parcial por segmento e segmento atual', () => {
  const current = state(reps(30, 300));
  assert.deepEqual(current.segments.map((item) => item.done), [21, 9, 0, 0, 0, 0]);
  assert.equal(current.currentSegmentId, 's2');
  assert.equal(current.repsTarget, 90);
  assert.equal(current.repsDone, 30);
  assert.equal(current.repsRemaining, 60);
});

test('correção depois de concluir: adj −1 e +1 em s2 movem o desempate e a conclusão para o instante da correção', () => {
  const current = state([...RUN_A, { t: 'adj', seg: 's2', d: -1, at: 590 }, { t: 'adj', seg: 's2', d: 1, at: 595 }]);
  assert.equal(current.tieBreakAt, 595);
  assert.equal(current.completedAt, 595);
  assert.equal(current.capturedCompletedAt, 595);
});

// ---------------------------------------------------------------------------
// Desempate (AC6)
// ---------------------------------------------------------------------------

test('desempate presente ("05:06"), ausente (null) e comparado com compareTimeTieBreaker', () => {
  const present = result(RUN_CAP);
  assert.equal(present.tieBreakSeconds, 306);
  assert.equal(present.tieBreakDisplay, '05:06');
  assert.equal(scoring.timeToSeconds(present.tieBreakDisplay), 306);

  const absent = result(reps(30, 300));
  assert.equal(absent.tieBreakSeconds, null);
  assert.equal(absent.tieBreakDisplay, null);

  const noTieBreak = computeSheetResult(withTieBreakAt(null), deriveSheetState(withTieBreakAt(null), RUN_A));
  assert.equal(noTieBreak.tieBreakSeconds, null);
  assert.equal(noTieBreak.tieBreakDisplay, null);

  assert.ok(scoring.compareTimeTieBreaker(result(RUN_A).tieBreakDisplay, present.tieBreakDisplay) < 0, 'menor vence');
  assert.ok(scoring.compareTimeTieBreaker(present.tieBreakDisplay, absent.tieBreakDisplay ?? undefined) < 0, 'ausente perde');
  assert.ok(scoring.compareTimeTieBreaker(absent.tieBreakDisplay ?? undefined, present.tieBreakDisplay) > 0);
});

test('desempate movido para outro segmento', () => {
  const lastSegment = withTieBreakAt('s6');
  assert.equal(computeSheetResult(lastSegment, deriveSheetState(lastSegment, RUN_A)).tieBreakSeconds, 581);
  const firstSegment = withTieBreakAt('s1');
  assert.equal(computeSheetResult(firstSegment, deriveSheetState(firstSegment, RUN_A)).tieBreakSeconds, Math.round(21 / 90 * 581));
});

test('súmula editada: segmentos reordenados, segmento novo no desempate e segmento do desempate removido', () => {
  const original = forTimeInput().segments;
  const edited = valid({
    ...forTimeInput(),
    totalReps: 100,
    tieBreak: { kind: 'split_time', at: 'sx', order: 'asc' },
    generator: null,
    customized: true,
    segments: [original[1], original[0], segment('sx', 1, 'Burpee', 10), original[2], original[3], original[4], original[5]]
  });
  const editedState = deriveSheetState(edited, reps(100, 500, edited));
  assert.equal(editedState.repsTarget, 100);
  assert.equal(editedState.tieBreakAt, 260, '52ª repetição');

  const withoutSx = { ...edited, segments: edited.segments.filter((item) => item.id !== 'sx') };
  assert.equal(deriveSheetState(withoutSx, reps(90, 581, withoutSx)).tieBreakAt, null);

  const rejected = validateWorkoutStructure(withoutSx);
  assert.equal(rejected.ok, false, 'o validador não reconcilia');

  const reconciled = reconcileWorkoutStructure(withoutSx);
  assert.equal(reconciled.totalReps, 90);
  assert.equal(reconciled.tieBreak, null);
  assert.notEqual(reconciled.segments, withoutSx.segments);
  assert.equal(withoutSx.totalReps, 100, 'reconcile não muta a entrada');
  assert.equal(validateWorkoutStructure(reconciled).ok, true);

  // Com o segmento do desempate presente, reconcile mantém o desempate.
  assert.deepEqual(reconcileWorkoutStructure(FOR_TIME).tieBreak, FOR_TIME.tieBreak);
});

// ---------------------------------------------------------------------------
// AMRAP (AC6, decisão 11 confirmada pelo usuário)
// ---------------------------------------------------------------------------

test('AMRAP: 222 repetições num round de 30 = 7 rounds + 12, value 222 e display "222"', () => {
  const events = amrapReps(222);
  const current = state(events, AMRAP);
  assert.equal(current.roundsCompleted, 7);
  assert.equal(current.repsDone, 222);
  assert.equal(current.repsTarget, 30);
  assert.equal(current.repsRemaining, 18);
  assert.equal(current.currentSegmentId, 'a2', 'segmento atual: Pull-up');
  assert.equal(current.completedAt, null, 'AMRAP não tem instante de conclusão');

  const outcome = computeSheetResult(AMRAP, current);
  assert.equal(outcome.format, 'amrap');
  assert.equal(outcome.rounds, 7);
  assert.equal(outcome.extraReps, 12);
  assert.equal(outcome.totalReps, 222);
  assert.equal(outcome.value, 222);
  assert.equal(outcome.display, '222');
  assert.deepEqual(scoring.parseScoreForWorkout('amrap', outcome.display), { result: '222', value: 222 });

  assert.equal(result([...events, undo(events.length - 1, 230)], AMRAP).value, 221);
});

test('AMRAP: fill grande fecha o round sem carregar excesso; desempate = instante do round 1', () => {
  const events = [...amrapReps(25), { t: 'fill', seg: 'a3', n: 50, at: 40 }];
  const current = state(events, AMRAP);
  assert.equal(current.roundsCompleted, 1);
  assert.equal(current.repsDone, 30);
  assert.deepEqual(current.segments.map((item) => item.done), [0, 0, 0]);
  assert.equal(current.currentSegmentId, 'a1');
  assert.equal(current.tieBreakAt, 20, 'Pull-up fechou no round 1 com a 20ª repetição');
  assert.deepEqual(current.segments.map((item) => item.completedAt), [10, 20, 40]);

  // Os rounds seguintes não movem o instante do round 1.
  const later = state([...events, ...amrapReps(60).map((event) => ({ ...event, at: event.at + 100 }))], AMRAP);
  assert.equal(later.roundsCompleted, 3);
  assert.equal(later.tieBreakAt, 20);
  // adj e set não reabrem round fechado: valem no round em andamento.
  const adjusted = state([...events, { t: 'adj', seg: 'a1', d: -1, at: 41 }], AMRAP);
  assert.equal(adjusted.roundsCompleted, 1);
  assert.equal(adjusted.repsDone, 30);
});

// ---------------------------------------------------------------------------
// Validação (AC3)
// ---------------------------------------------------------------------------

const variant = (mutate) => {
  const input = forTimeInput();
  mutate(input);
  input.totalReps = input.segments.reduce((sum, item) => sum + (Number.isInteger(item?.reps) ? item.reps : 0), 0);
  return input;
};

const accepts = (input, label) => {
  const checked = validateWorkoutStructure(input);
  assert.equal(checked.ok, true, `${label}: ${checked.error}`);
  return checked.structure;
};

const rejects = (input, pattern, label) => {
  const checked = validateWorkoutStructure(input);
  assert.equal(checked.ok, false, label);
  assert.equal(typeof checked.error, 'string');
  if (pattern) assert.match(checked.error, pattern, label);
  return checked.error;
};

const manySegments = (count) => Array.from({ length: count }, (_, index) => segment(`m${index + 1}`, 1, `Movimento ${index + 1}`, 1));

test('validação: limites de repetições, rodada, carga, time cap e penalidade nas bordas', () => {
  for (const [value, ok] of [[0, false], [1, true], [99, true], [100, false], [1.5, false], ['10', false]]) {
    const input = variant((draft) => { draft.segments[2].reps = value; });
    if (ok) accepts(input, `reps ${value}`);
    else rejects(input, /^Segmento 3: as repetições devem ser um número inteiro entre 1 e 99\.$/, `reps ${value}`);
  }
  for (const [value, ok] of [[0, false], [1, true], [9, true], [10, false]]) {
    const input = variant((draft) => { draft.segments[0].round = value; });
    if (ok) accepts(input, `round ${value}`);
    else rejects(input, /^Segmento 1: a rodada deve ser um número inteiro entre 1 e 9\.$/, `round ${value}`);
  }
  for (const [value, ok] of [[-1, false], [0, true], [42.5, true], [500, true], [501, false], [Number.NaN, false]]) {
    const input = variant((draft) => { draft.segments[0].load = { value, unit: 'kg' }; });
    if (ok) assert.deepEqual(accepts(input, `carga ${value}`).segments[0].load, { value, unit: 'kg' });
    else rejects(input, /^Segmento 1: a carga deve ser vazia \(null\) ou um valor entre 0 e 500 kg\.$/, `carga ${value}`);
  }
  rejects(variant((draft) => { draft.segments[0].load = { value: 40, unit: 'lb' }; }), /entre 0 e 500 kg/, 'unidade lb');
  rejects(variant((draft) => { draft.segments[0].load = 40; }), /entre 0 e 500 kg/, 'carga sem objeto');

  for (const [value, ok] of [[29, false], [30, true], [5999, true], [6000, false], [600.5, false]]) {
    const input = variant((draft) => { draft.timeCapSeconds = value; });
    if (ok) accepts(input, `cap ${value}`);
    else rejects(input, /time cap da prova deve ser um número inteiro de segundos entre 30 e 5999/, `cap ${value}`);
  }
  for (const [value, ok] of [[-1, false], [0, true], [60, true], [61, false], [1.5, false]]) {
    const input = variant((draft) => { draft.incomplete.secondsPerRep = value; });
    if (ok) accepts(input, `penalidade ${value}`);
    else rejects(input, /de 0 a 60 segundos inteiros/, `penalidade ${value}`);
  }
});

test('validação: de 1 a 30 segmentos', () => {
  for (const [count, ok] of [[0, false], [1, true], [30, true], [31, false]]) {
    const input = { ...forTimeInput(), tieBreak: null, segments: manySegments(count), totalReps: count };
    if (ok) assert.equal(accepts(input, `${count} segmentos`).segments.length, count);
    else rejects(input, /^A prova deve ter entre 1 e 30 segmentos\.$/, `${count} segmentos`);
  }
  rejects({ ...forTimeInput(), segments: 'Thruster' }, /entre 1 e 30 segmentos/, 'segmentos não lista');
});

test('validação: nome, observação, marcação, obrigatório e identificador dos segmentos', () => {
  rejects(variant((draft) => { draft.segments[1].name = ''; }), /^Segmento 2: informe o nome do movimento, com até 60 caracteres\.$/);
  rejects(variant((draft) => { draft.segments[1].name = '    '; }), /^Segmento 2: informe o nome/);
  accepts(variant((draft) => { draft.segments[1].name = 'x'.repeat(60); }), 'nome de 60');
  rejects(variant((draft) => { draft.segments[1].name = 'x'.repeat(61); }), /até 60 caracteres/);
  accepts(variant((draft) => { draft.segments[1].note = ''; }), 'observação vazia');
  rejects(variant((draft) => { draft.segments[1].note = 'x'.repeat(301); }), /^Segmento 2: a observação deve ser um texto de até 300 caracteres/);
  rejects(variant((draft) => { draft.segments[1].note = null; }), /observação/);
  rejects(variant((draft) => { draft.segments[1].mark = 'tap'; }), /^Segmento 2: a marcação \(mark\) deve ser reps ou end\.$/);
  accepts(variant((draft) => { draft.segments[1].mark = 'end'; }), 'mark end');
  rejects(variant((draft) => { draft.segments[1].required = 'sim'; }), /required deve ser verdadeiro ou falso/);
  rejects(variant((draft) => { draft.segments[3].id = 's1'; }), /^Segmento 4: o identificador repete o de outro segmento\.$/);
  rejects(variant((draft) => { draft.segments[3].id = 'seg 4'; }), /^Segmento 4: o identificador deve ter de 1 a 40 caracteres/);
  rejects(variant((draft) => { draft.segments[3].id = 'ação'; }), /identificador/);
  rejects(variant((draft) => { draft.segments[3].id = ''; }), /identificador/);
  rejects(variant((draft) => { draft.segments[3].id = 'x'.repeat(41); }), /identificador/);
  accepts(variant((draft) => { draft.segments[3].id = 'A-z_09'; }), 'id com A-Z a-z 0-9 _ -');
  rejects(variant((draft) => { draft.segments[3] = 'Pull-up'; }), /^Segmento 4: o segmento deve ser um objeto\.$/);
});

test('validação: total diferente da soma, desempate inexistente, versão, formato e regra de não conclusão', () => {
  rejects({ ...forTimeInput(), totalReps: 91 }, /^O total de repetições da prova deve ser igual à soma das repetições dos segmentos \(90\)\.$/);
  rejects({ ...forTimeInput(), totalReps: '90' }, /total de repetições da prova deve ser um número inteiro/);
  rejects({ ...forTimeInput(), tieBreak: { kind: 'split_time', at: 's9', order: 'asc' } }, /^O desempate aponta para um segmento que não existe na prova\.$/);
  rejects({ ...forTimeInput(), tieBreak: { kind: 'split_time', at: 's2', order: 'desc' } }, /desempate deve ser vazio/);
  rejects({ ...forTimeInput(), tieBreak: { kind: 'reps', at: 's2', order: 'asc' } }, /desempate deve ser vazio/);
  rejects({ ...forTimeInput(), version: 3 }, /^A versão da estrutura da prova deve ser 1 ou 2\.$/);
  rejects({ ...forTimeInput(), version: 0 }, /^A versão da estrutura da prova deve ser 1 ou 2\.$/);
  rejects({ ...forTimeInput(), version: '1' }, /versão/);
  // Story 1.47: a forma da versão 1 com version 2 é recusada (a versão 2 exige a unidade de cada segmento).
  rejects({ ...forTimeInput(), version: 2 }, /^Segmento 1: a unidade \(unit\) deve ser reps, cal ou m\.$/);
  rejects({ ...forTimeInput(), format: 'emom' }, /^O formato da prova deve ser for_time \(For Time\), amrap \(AMRAP\) ou max_load \(Carga máxima\)\.$/);
  rejects({ ...forTimeInput(), format: 'max_load' }, /^A versão 1 da estrutura só aceita for_time \(For Time\) ou amrap \(AMRAP\)/);
  rejects({ ...forTimeInput(), incomplete: null }, /Em For Time, a regra de não conclusão/);
  rejects({ ...forTimeInput(), incomplete: { rule: 'penalty_per_rep', secondsPerRep: 1, base: 'actual' } }, /Em For Time/);
  rejects(amrapInput({ incomplete: { rule: 'penalty_per_rep', secondsPerRep: 1, base: 'time_cap' } }), /^Em AMRAP, a regra de não conclusão deve ficar vazia \(null\)\.$/);
});

test('validação: gerador, customized coerente e forma de lançamento', () => {
  rejects({ ...forTimeInput(), customized: true }, /^Estrutura personalizada \(customized verdadeiro\) não tem gerador/);
  rejects({ ...forTimeInput(), generator: null, customized: false }, /estrutura gerada \(customized falso\) precisa do gerador/);
  accepts({ ...forTimeInput(), generator: null, customized: true }, 'personalizada sem gerador');
  rejects({ ...forTimeInput(), customized: 'nao' }, /customized deve ser verdadeiro ou falso/);
  for (const generator of [
    { kind: 'pyramid', reps: [21] },
    { kind: 'fixed', reps: [] },
    { kind: 'fixed', reps: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
    { kind: 'fixed', reps: [0] },
    { kind: 'fixed', reps: [100] },
    { kind: 'fixed', reps: 21 }
  ]) {
    rejects({ ...forTimeInput(), generator }, /gerador deve ser vazio \(null\) ou ter tipo fixed, descending ou ascending e de 1 a 9/, JSON.stringify(generator));
  }
  accepts({ ...forTimeInput(), generator: { kind: 'ascending', reps: [1, 2, 3, 4, 5, 6, 7, 8, 9] } }, 'gerador com 9 itens');
  for (const entry of [
    { mode: 'auto', marking: 'reps', publish: 'auto' },
    { mode: 'both', marking: 'tap', publish: 'auto' },
    { mode: 'both', marking: 'reps', publish: 'now' },
    null
  ]) {
    rejects({ ...forTimeInput(), entry }, /forma de lançamento deve ter modo manual, sheet ou both/, JSON.stringify(entry));
  }
});

test('validação: chave desconhecida (inclui __proto__) é recusada em qualquer nível', () => {
  rejects({ ...forTimeInput(), extra: true }, /^A estrutura da prova tem um campo que não faz parte do contrato\.$/);
  rejects(JSON.parse(JSON.stringify(forTimeInput()).replace('{"version":1', '{"__proto__":{"admin":true},"version":1')), /campo que não faz parte do contrato/);
  rejects(variant((draft) => { draft.segments[0].weight = 43; }), /^Segmento 1: o segmento tem um campo que não faz parte do contrato\.$/);
  rejects(variant((draft) => { draft.segments[0].load = { value: 43, unit: 'kg', rx: true }; }), /carga/);
  rejects({ ...forTimeInput(), incomplete: { rule: 'penalty_per_rep', secondsPerRep: 1, base: 'time_cap', cap: 1 } }, /Em For Time/);
  rejects({ ...forTimeInput(), tieBreak: { kind: 'split_time', at: 's2', order: 'asc', note: '' } }, /desempate deve ser vazio/);
  rejects({ ...forTimeInput(), generator: { kind: 'descending', reps: [21, 15, 9], movements: [] } }, /gerador/);
  rejects({ ...forTimeInput(), entry: { mode: 'both', marking: 'reps', publish: 'auto', judge: 'x' } }, /forma de lançamento/);
});

test('validação: caractere nulo no texto, entradas que não são objeto e ausência de campos são recusadas', () => {
  rejects(variant((draft) => { draft.segments[0].name = 'Thru\u0000ster'; }), /^Segmento 1: o texto não pode conter o caractere nulo \(U\+0000\)\.$/);
  rejects(variant((draft) => { draft.segments[0].note = 'nota\u0000'; }), /caractere nulo/);
  rejects(variant((draft) => { draft.segments[0].id = 's1\u0000'; }), /caractere nulo/);
  rejects({ ...forTimeInput(), tieBreak: { kind: 'split_time', at: 's2\u0000', order: 'asc' } }, /caractere nulo/);
  for (const input of [null, undefined, [], [forTimeInput()], 'texto', 1, true, new Date()]) {
    rejects(input, /^A estrutura da prova deve ser um objeto\.$/, String(input));
  }
  const withoutTieBreak = forTimeInput();
  delete withoutTieBreak.tieBreak;
  rejects(withoutTieBreak, /desempate deve ser vazio/, 'tieBreak ausente não é null');
  const throwing = new Proxy({}, { ownKeys() { throw new Error('boom'); } });
  assert.doesNotThrow(() => validateWorkoutStructure(throwing));
  rejects(throwing, /^A estrutura da prova é inválida\.$/);
});

test('validação: a mensagem não devolve o JSON enviado', () => {
  const marker = 'MARCADOR_DO_TESTE_143';
  const errors = [
    rejects(variant((draft) => { draft.segments[0].name = `${marker}`; draft.segments[0].reps = 0; })),
    rejects({ ...forTimeInput(), [marker]: marker }),
    rejects({ ...forTimeInput(), tieBreak: { kind: 'split_time', at: marker, order: 'asc' } }),
    rejects({ ...forTimeInput(), format: marker })
  ];
  for (const error of errors) {
    assert.doesNotMatch(error, new RegExp(marker));
    assert.doesNotMatch(error, /[{}]/);
  }
});

test('validação: resultado normalizado, novo e sem a referência recebida', () => {
  const input = forTimeInput();
  input.segments[0].name = '  Thruster  ';
  input.segments[0].note = '  Nota com espaço  ';
  input.segments[0].id = ' s1 ';
  input.tieBreak.at = ' s2 ';
  const structure = accepts(input, 'com espaços');
  assert.equal(structure.segments[0].name, 'Thruster');
  assert.equal(structure.segments[0].note, 'Nota com espaço');
  assert.equal(structure.segments[0].id, 's1');
  assert.equal(structure.tieBreak.at, 's2');
  assert.notEqual(structure, input);
  assert.notEqual(structure.segments, input.segments);
  assert.notEqual(structure.segments[0], input.segments[0]);
  assert.notEqual(structure.segments[0].load, input.segments[0].load);
  assert.notEqual(structure.generator.reps, input.generator.reps);
  assert.notEqual(structure.entry, input.entry);
  assert.equal(input.segments[0].name, '  Thruster  ', 'a entrada não muda');
  // Story 1.47: a entrada na versão 1 sai normalizada na versão 2 (unidade reps, sem carga máxima).
  assert.deepEqual(Object.keys(structure), ['version', 'format', 'totalReps', 'timeCapSeconds', 'incomplete', 'tieBreak', 'generator', 'customized', 'entry', 'segments', 'maxLoad', 'scoreDisplay']);
  assert.equal(structure.version, 2);
  assert.ok(structure.segments.every((item) => item.unit === 'reps'));
  assert.equal(structure.maxLoad, null);
  assert.equal(structure.scoreDisplay, null);
  assert.deepEqual(validateWorkoutStructure(structure).structure, structure, 'normalizar de novo não muda nada');
  assert.deepEqual(valid(JSON.parse(JSON.stringify(FOR_TIME))), FOR_TIME);
});

// ---------------------------------------------------------------------------
// Campos legados e paridade com scoring.ts (AC7)
// ---------------------------------------------------------------------------

test('campos legados derivados da estrutura', () => {
  assert.deepEqual(deriveLegacyWorkoutFields(FOR_TIME), { type: 'fortime', timeCap: '10:00', tieBreaker: 'Tempo' });
  assert.equal(scoring.shouldUseTimeTieBreaker('Tempo'), true);
  const amrapWithoutTieBreak = valid(amrapInput({ tieBreak: null }));
  assert.deepEqual(deriveLegacyWorkoutFields(amrapWithoutTieBreak), { type: 'amrap', timeCap: '12:00', tieBreaker: '' });
  assert.equal(scoring.shouldUseTimeTieBreaker(''), false);
  // "MM:SS" até 59:59; a partir de uma hora, "H:MM:SS", como secondsToTime (AC7).
  for (const [seconds, text] of [[3599, '59:59'], [3600, '1:00:00'], [5999, '1:39:59']]) {
    const cap = valid({ ...forTimeInput(), timeCapSeconds: seconds });
    assert.equal(deriveLegacyWorkoutFields(cap).timeCap, text);
    assert.equal(scoring.timeToSeconds(deriveLegacyWorkoutFields(cap).timeCap), seconds);
  }
});

test('paridade: o formatador do módulo é igual a secondsToTime e todo display volta ao mesmo value', () => {
  for (let seconds = 0; seconds <= 7300; seconds += 1) {
    assert.equal(formatWorkoutTime(seconds), scoring.secondsToTime(seconds), String(seconds));
  }
  const largest = WORKOUT_STRUCTURE_LIMITS.maxTimeCapSeconds + 30 * 99 * WORKOUT_STRUCTURE_LIMITS.maxPenaltySecondsPerRep;
  assert.equal(largest, 184199);
  for (const seconds of [largest, 3600, 3599, 86399, 99999, 12.2, -5]) {
    assert.equal(formatWorkoutTime(seconds), scoring.secondsToTime(seconds), String(seconds));
  }
  for (let seconds = 1; seconds <= 7300; seconds += 1) {
    assert.equal(scoring.parseScoreForWorkout('fortime', formatWorkoutTime(seconds)).value, seconds);
  }
  assert.equal(scoring.parseScoreForWorkout('fortime', formatWorkoutTime(largest)).value, largest);

  // O pior caso real: cap 5999, 30 segmentos de 99 sem nenhuma repetição, 60 s cada.
  const worst = valid({
    ...forTimeInput(),
    timeCapSeconds: 5999,
    incomplete: { rule: 'penalty_per_rep', secondsPerRep: 60, base: 'time_cap' },
    tieBreak: null,
    segments: Array.from({ length: 30 }, (_, index) => segment(`w${index}`, 1, 'Burpee', 99)),
    totalReps: 2970
  });
  const outcome = computeSheetResult(worst, deriveSheetState(worst, []));
  assert.equal(outcome.value, largest);
  assert.deepEqual(scoring.parseScoreForWorkout('fortime', outcome.display), { result: outcome.display, value: largest });
});

// ---------------------------------------------------------------------------
// Ajuste manual do tempo final (REQ-9)
// ---------------------------------------------------------------------------

test('tempo final oficial: troca 09:41 por 09:38 e preserva o capturado', () => {
  const current = state([...RUN_A, official('final', 578)]);
  assert.equal(current.completedAt, 578);
  assert.equal(current.capturedCompletedAt, 581);
  assert.equal(current.finalAdjusted, true);
  assert.equal(current.finalDeltaSeconds, -3);
  assert.equal(current.segments[5].completedAt, 581, 'o instante do último segmento segue o capturado');

  const outcome = computeSheetResult(FOR_TIME, current);
  assert.equal(outcome.value, 578);
  assert.equal(outcome.actualSeconds, 578);
  assert.equal(outcome.adjustedSeconds, 578);
  assert.equal(outcome.display, '09:38');
  assert.equal(outcome.capturedSeconds, 581);
  assert.equal(outcome.finalAdjusted, true);
  assert.equal(outcome.finalDeltaSeconds, -3);
  assert.equal(outcome.tieBreakSeconds, 271, 'o ajuste do final não move o desempate');
  assert.equal(scoring.parseScoreForWorkout('fortime', '09:38').value, 578);
  assert.deepEqual(checkOfficialTime(FOR_TIME, state(RUN_A), 'final', 578), { ok: true });
});

test('tempo final oficial: delta negativo, positivo e zero', () => {
  for (const [value, display, delta] of [[585, '09:45', 4], [581, '09:41', 0], [600, '10:00', 19], [1, '00:01', -580]]) {
    const outcome = result([...RUN_A, official('final', value)]);
    assert.equal(outcome.value, value);
    assert.equal(outcome.display, display);
    assert.equal(outcome.finalAdjusted, true, 'ajustado também com delta 0');
    assert.equal(outcome.finalDeltaSeconds, delta);
    assert.equal(outcome.capturedSeconds, 581);
    assert.deepEqual(checkOfficialTime(FOR_TIME, state(RUN_A), 'final', value), { ok: true }, String(value));
  }
});

test('tempo final oficial inválido: ignorado no estado e recusado na porta com mensagem em português', () => {
  const complete = state(RUN_A);
  const invalid = [
    [{ target: 'final', v: 601 }, 601, 'final', /entre 00:01 e o time cap da prova \(10:00\)/],
    [{ target: 'final', v: 0 }, 0, 'final', /entre 00:01 e o time cap/],
    [{ target: 'final', v: -5 }, -5, 'final', /entre 00:01 e o time cap/],
    [{ target: 'final', v: 580.5 }, 580.5, 'final', /número inteiro de segundos/],
    [{ target: 'final', v: Number.NaN }, Number.NaN, 'final', /número inteiro de segundos/],
    [{ target: 'final', v: '578' }, '578', 'final', /número inteiro de segundos/],
    [{ v: 578 }, 578, undefined, /Informe qual tempo ajustar/],
    [{ target: 'ambos', v: 578 }, 578, 'ambos', /Informe qual tempo ajustar/]
  ];
  for (const [fields, seconds, target, pattern] of invalid) {
    const current = state([...RUN_A, { t: 'time', at: 590, ...fields }]);
    assert.deepEqual(current, complete, JSON.stringify(fields));
    assert.equal(current.finalAdjusted, false);
    assert.equal(current.finalDeltaSeconds, null);
    const gate = checkOfficialTime(FOR_TIME, complete, target, seconds);
    assert.equal(gate.ok, false, JSON.stringify(fields));
    assert.match(gate.error, pattern, JSON.stringify(fields));
  }
});

test('tempo final oficial: undo volta ao capturado, o último vale e um inválido não apaga o válido', () => {
  const adjusted = [...RUN_A, official('final', 578)];
  const undone = state([...adjusted, undo(adjusted.length - 1)]);
  assert.equal(undone.completedAt, 581);
  assert.equal(undone.finalAdjusted, false);
  assert.equal(undone.finalDeltaSeconds, null);

  const twice = [...RUN_A, official('final', 578), official('final', 585, 595)];
  assert.equal(state(twice).completedAt, 585);
  assert.equal(state(twice).finalDeltaSeconds, 4);
  assert.equal(state([...twice, undo(twice.length - 1)]).completedAt, 578);
  assert.equal(state([...twice, undo(twice.length - 1), undo(twice.length - 2)]).completedAt, 581);

  assert.equal(state([...adjusted, official('final', 601, 595)]).completedAt, 578);
});

test('tempo final oficial em prova não concluída: ignorado, e o ajuste anterior à conclusão não vale', () => {
  const capped = [...RUN_CAP, official('final', 590, 599)];
  const outcome = result(capped);
  assert.equal(outcome.value, 608);
  assert.equal(outcome.display, '10:08');
  assert.equal(outcome.capturedSeconds, null);
  assert.equal(outcome.finalAdjusted, false);
  const gate = checkOfficialTime(FOR_TIME, state(RUN_CAP), 'final', 590);
  assert.equal(gate.ok, false);
  assert.match(gate.error, /só pode ser ajustado em prova concluída/);

  const beforeCompletion = [...reps(89, 575), official('final', 570, 576), { t: 'rep', seg: 's6', at: 581 }];
  const current = state(beforeCompletion);
  assert.equal(current.completedAt, 581);
  assert.equal(current.finalAdjusted, false);
});

test('tempo final oficial cai quando a prova é reaberta depois do ajuste', () => {
  const events = [...RUN_A, official('final', 578)];
  const reopened = state([...events, undo(RUN_A.length - 1, 589), { t: 'rep', seg: 's6', at: 590 }]);
  assert.equal(reopened.completedAt, 590);
  assert.equal(reopened.finalAdjusted, false);

  const reopenedByAdj = state([...events, { t: 'adj', seg: 's4', d: -1, at: 589 }, { t: 'adj', seg: 's4', d: 1, at: 592 }]);
  assert.equal(reopenedByAdj.completedAt, 592);
  assert.equal(reopenedByAdj.finalAdjusted, false);
});

test('tempo final oficial não se aplica ao AMRAP', () => {
  const events = amrapReps(222);
  const plain = state(events, AMRAP);
  assert.deepEqual(state([...events, official('final', 700, 720)], AMRAP), plain);
  const gate = checkOfficialTime(AMRAP, plain, 'final', 700);
  assert.equal(gate.ok, false);
  assert.match(gate.error, /não se aplica a provas AMRAP/);
});

// ---------------------------------------------------------------------------
// Ajuste manual do tempo do desempate (REQ-9)
// ---------------------------------------------------------------------------

test('desempate oficial: troca 04:31 por 04:28 e preserva o capturado e o final', () => {
  const current = state([...RUN_A, official('tiebreak', 268)]);
  assert.equal(current.tieBreakAt, 268);
  assert.equal(current.tieBreakCapturedAt, 271);
  assert.equal(current.tieBreakAdjusted, true);
  assert.equal(current.tieBreakDeltaSeconds, -3);
  assert.equal(current.tieBreakAfterEnd, false);
  assert.equal(current.segments[1].completedAt, 271, 'o instante de s2 segue o capturado');
  assert.equal(current.completedAt, 581);

  const outcome = computeSheetResult(FOR_TIME, current);
  assert.equal(outcome.tieBreakSeconds, 268);
  assert.equal(outcome.tieBreakDisplay, '04:28');
  assert.equal(outcome.tieBreakCapturedSeconds, 271);
  assert.equal(outcome.tieBreakAdjusted, true);
  assert.equal(outcome.tieBreakDeltaSeconds, -3);
  assert.equal(outcome.value, 581);

  const up = result([...RUN_A, official('tiebreak', 275)]);
  assert.equal(up.tieBreakDisplay, '04:35');
  assert.equal(up.tieBreakDeltaSeconds, 4);
});

test('desempate oficial: a porta aceita até o fim da prova; o estado só sinaliza o que passa dele', () => {
  const complete = state(RUN_A);
  assert.deepEqual(checkOfficialTime(FOR_TIME, complete, 'tiebreak', 581), { ok: true });
  const gate = checkOfficialTime(FOR_TIME, complete, 'tiebreak', 582);
  assert.equal(gate.ok, false);
  assert.match(gate.error, /^O tempo do desempate não pode passar do fim da prova \(09:41\)\.$/);

  const handWritten = state([...RUN_A, official('tiebreak', 582)]);
  assert.equal(handWritten.tieBreakAt, 582);
  assert.equal(handWritten.tieBreakAfterEnd, true);
  assert.equal(computeSheetResult(FOR_TIME, handWritten).tieBreakAfterEnd, true);

  const capped = state(RUN_CAP);
  assert.deepEqual(checkOfficialTime(FOR_TIME, capped, 'tiebreak', 300), { ok: true });
  const cappedAdjusted = result([...RUN_CAP, official('tiebreak', 300, 599)]);
  assert.equal(cappedAdjusted.tieBreakDisplay, '05:00');
  assert.equal(cappedAdjusted.tieBreakDeltaSeconds, -6);
  assert.equal(checkOfficialTime(FOR_TIME, capped, 'tiebreak', 601).ok, false);
  assert.match(checkOfficialTime(FOR_TIME, capped, 'tiebreak', 601).error, /time cap da prova \(10:00\)/);
});

test('desempate oficial: undo volta ao capturado e o último ajuste vale', () => {
  const adjusted = [...RUN_A, official('tiebreak', 268)];
  const undone = state([...adjusted, undo(adjusted.length - 1)]);
  assert.equal(undone.tieBreakAt, 271);
  assert.equal(undone.tieBreakAdjusted, false);
  assert.equal(undone.tieBreakDeltaSeconds, null);

  const twice = [...adjusted, official('tiebreak', 275, 595)];
  assert.equal(state(twice).tieBreakAt, 275);
  assert.equal(state([...twice, undo(twice.length - 1)]).tieBreakAt, 268);
});

test('desempate oficial com o segmento não concluído: ignorado, recusado e não espera a conclusão', () => {
  const partial = reps(30, 150);
  const current = state([...partial, official('tiebreak', 100, 151)]);
  assert.equal(current.tieBreakAt, null);
  assert.equal(current.tieBreakAdjusted, false);
  const gate = checkOfficialTime(FOR_TIME, state(partial), 'tiebreak', 100);
  assert.equal(gate.ok, false);
  assert.match(gate.error, /depois que o segmento do desempate for concluído/);

  const laterCompleted = state([...partial, official('tiebreak', 100, 151), { t: 'fill', seg: 's2', n: 12, at: 170 }]);
  assert.equal(laterCompleted.tieBreakAt, 170);
  assert.equal(laterCompleted.tieBreakAdjusted, false);
});

test('desempate oficial cai quando o segmento do desempate é reaberto', () => {
  const current = state([...RUN_A, official('tiebreak', 268), { t: 'adj', seg: 's2', d: -1, at: 592 }, { t: 'adj', seg: 's2', d: 1, at: 595 }]);
  assert.equal(current.tieBreakAt, 595);
  assert.equal(current.tieBreakCapturedAt, 595);
  assert.equal(current.tieBreakAdjusted, false);
});

test('desempate oficial: prova sem desempate e AMRAP (o fechamento do round não reabre o segmento)', () => {
  const none = withTieBreakAt(null);
  const plain = deriveSheetState(none, RUN_A);
  assert.deepEqual(deriveSheetState(none, [...RUN_A, official('tiebreak', 268)]), plain);
  assert.match(checkOfficialTime(none, plain, 'tiebreak', 268).error, /não tem desempate por tempo/);

  const firstRound = amrapReps(20);
  assert.deepEqual(checkOfficialTime(AMRAP, state(firstRound, AMRAP), 'tiebreak', 720), { ok: true });
  assert.equal(checkOfficialTime(AMRAP, state(firstRound, AMRAP), 'tiebreak', 721).ok, false);
  const afterRounds = state([...firstRound, official('tiebreak', 18, 21), ...amrapReps(100).slice(20)], AMRAP);
  assert.equal(afterRounds.roundsCompleted, 3);
  assert.equal(afterRounds.tieBreakAt, 18);
  assert.equal(afterRounds.tieBreakCapturedAt, 20);
  assert.equal(afterRounds.tieBreakAdjusted, true);
  assert.equal(computeSheetResult(AMRAP, afterRounds).tieBreakDisplay, '00:18');
  assert.equal(computeSheetResult(AMRAP, afterRounds).tieBreakAfterEnd, false);
});

// ---------------------------------------------------------------------------
// Coerência e ordem dos ajustes (REQ-9)
// ---------------------------------------------------------------------------

test('baixar os dois tempos: as duas ordens dão o mesmo estado e o mesmo resultado', () => {
  const finalFirst = [...RUN_A, official('final', 570), official('tiebreak', 560, 591)];
  const tieBreakFirst = [...RUN_A, official('tiebreak', 560), official('final', 570, 591)];
  assert.deepEqual(state(finalFirst), state(tieBreakFirst));
  assert.deepEqual(result(finalFirst), result(tieBreakFirst));
  const current = state(finalFirst);
  assert.deepEqual(
    [current.completedAt, current.tieBreakAt, current.capturedCompletedAt, current.tieBreakCapturedAt, current.tieBreakAfterEnd],
    [570, 560, 581, 271, false]
  );
  // A porta aceita as duas ordens.
  assert.equal(checkOfficialTime(FOR_TIME, state(RUN_A), 'final', 570).ok, true);
  assert.equal(checkOfficialTime(FOR_TIME, state([...RUN_A, official('final', 570)]), 'tiebreak', 560).ok, true);
  assert.equal(checkOfficialTime(FOR_TIME, state(RUN_A), 'tiebreak', 560).ok, true);
  assert.equal(checkOfficialTime(FOR_TIME, state([...RUN_A, official('tiebreak', 560)]), 'final', 570).ok, true);
});

test('final abaixo do desempate capturado: aceito, sinalizado, e o desempate não se move', () => {
  const lowFinal = state([...RUN_A, official('final', 260)]);
  const outcome = computeSheetResult(FOR_TIME, lowFinal);
  assert.equal(outcome.value, 260);
  assert.equal(outcome.tieBreakSeconds, 271);
  assert.equal(outcome.tieBreakAfterEnd, true);
  assert.equal(checkOfficialTime(FOR_TIME, state(RUN_A), 'final', 260).ok, true, 'o final não é bloqueado pelo desempate');

  assert.equal(checkOfficialTime(FOR_TIME, lowFinal, 'tiebreak', 255).ok, true);
  const fixed = state([...RUN_A, official('final', 260), official('tiebreak', 255, 591)]);
  assert.equal(fixed.tieBreakAfterEnd, false);
  assert.deepEqual(fixed, state([...RUN_A, official('tiebreak', 255), official('final', 260, 591)]));

  const flaggedA = state([...RUN_A, official('final', 260), official('tiebreak', 268, 591)]);
  const flaggedB = state([...RUN_A, official('tiebreak', 268), official('final', 260, 591)]);
  assert.deepEqual(flaggedA, flaggedB);
  assert.equal(flaggedA.tieBreakAfterEnd, true);
  assert.equal(checkOfficialTime(FOR_TIME, lowFinal, 'tiebreak', 268).ok, false, 'pela porta, depois do final 260 o 268 é recusado');
});

test('subir os dois tempos: o final entra primeiro', () => {
  const complete = state(RUN_A);
  assert.equal(checkOfficialTime(FOR_TIME, complete, 'tiebreak', 590).ok, false);
  assert.equal(checkOfficialTime(FOR_TIME, complete, 'final', 590).ok, true);
  const raised = state([...RUN_A, official('final', 590)]);
  assert.equal(checkOfficialTime(FOR_TIME, raised, 'tiebreak', 585).ok, true);
});

test('desempate no último segmento: final oficial menor liga o sinal e o desempate oficial o desliga', () => {
  const lastSegment = withTieBreakAt('s6');
  const plain = deriveSheetState(lastSegment, RUN_A);
  assert.deepEqual([plain.completedAt, plain.tieBreakAt, plain.tieBreakAfterEnd], [581, 581, false]);
  const lowered = deriveSheetState(lastSegment, [...RUN_A, official('final', 578)]);
  assert.equal(lowered.tieBreakAfterEnd, true);
  const both = deriveSheetState(lastSegment, [...RUN_A, official('final', 578), official('tiebreak', 578, 591)]);
  assert.equal(both.tieBreakAfterEnd, false);
});

// ---------------------------------------------------------------------------
// Compatibilidade com compareTimeTieBreaker e sem justificativa (REQ-9)
// ---------------------------------------------------------------------------

test('o desempate publicado é o efetivo, compatível com compareTimeTieBreaker; nenhum motivo é exigido', () => {
  const athleteA = result([...RUN_A, official('tiebreak', 268)]);
  const athleteB = result(RUN_A);
  assert.equal(athleteA.tieBreakDisplay, '04:28');
  assert.equal(athleteB.tieBreakDisplay, '04:31');
  assert.equal(scoring.timeToSeconds(athleteA.tieBreakDisplay), 268);
  assert.ok(scoring.compareTimeTieBreaker(athleteA.tieBreakDisplay, athleteB.tieBreakDisplay) < 0, 'A ganha de B');
  const withoutTieBreak = result(reps(30, 150));
  assert.ok(scoring.compareTimeTieBreaker(athleteB.tieBreakDisplay, withoutTieBreak.tieBreakDisplay ?? undefined) < 0, 'quem não tem perde');

  const bare = state([...RUN_A, { t: 'time', target: 'final', v: 578, at: 590 }]);
  const withExtras = state([...RUN_A, { t: 'time', target: 'final', v: 578, at: 590, reason: 'cronômetro oficial', by: 'judge-1' }]);
  assert.equal(bare.finalAdjusted, true);
  assert.deepEqual(withExtras, bare);
  assert.doesNotMatch(moduleSource, /justificativa obrigat|reason:/i);
});

test('checkOfficialTime nunca lança, mesmo com estrutura ou estado inesperados', () => {
  assert.doesNotThrow(() => checkOfficialTime(null, null, 'final', 10));
  assert.equal(checkOfficialTime(null, null, 'final', 10).ok, false);
  assert.equal(checkOfficialTime(FOR_TIME, null, 'tiebreak', 10).ok, false);
});

// Revisão QA (Story 1.43): o motor aceita qualquer `at` finito e maior ou igual a zero, e um
// `at` enorme virava um `display` que timeToSeconds recusa (horas com mais de dois dígitos).
test('o texto de tempo respeita o que o parser aceita (até 99:59:59); o valor numérico segue no resultado', () => {
  const edge = (lastAt) => {
    const state = deriveSheetState(FOR_TIME, reps(90, lastAt));
    return computeSheetResult(FOR_TIME, state);
  };
  const atLimit = edge(359999);
  assert.equal(atLimit.value, 359999);
  assert.equal(atLimit.display, '99:59:59');
  assert.equal(scoring.parseScoreForWorkout('fortime', atLimit.display).value, 359999);

  const beyond = edge(360000);
  assert.equal(beyond.value, 360000, 'o valor numérico não é cortado');
  assert.equal(beyond.display, null, 'sem texto que o parser recusaria');
  const huge = edge(1e9);
  assert.equal(huge.display, null);
  assert.equal(huge.completed, true);

  // O desempate acompanha a mesma regra.
  const tie = computeSheetResult(FOR_TIME, deriveSheetState(withTieBreakAt('s2'), [{ t: 'fill', seg: 's2', n: 21, at: 1e9 }]));
  assert.equal(tie.tieBreakSeconds, 1e9);
  assert.equal(tie.tieBreakDisplay, null);
});
