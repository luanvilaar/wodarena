import assert from 'node:assert/strict';
import test from 'node:test';

import { importServerModule } from './support/serverModuleHarness.mjs';

// Story 1.46 (AC1 a AC4): construtor da súmula por linhas de repetições,
// movimento e carga (desenho aprovado em docs/design/sumula-digital/), com
// For Time, AMRAP e carga máxima (Story 1.47) e unidades e último marco
// (Story 1.48). Tudo que o construtor gera passa em validateWorkoutStructure,
// o mesmo validador que o servidor usa antes de gravar.

const editor = await importServerModule('lib/workoutStructureEditor.ts');
const { validateWorkoutStructure, deriveLegacyWorkoutFields } = await importServerModule('lib/workoutStructure.ts');

const {
  addLift, addLine, analyzeDraft, createDraft, describeStructureRule, detectGeneratorKind, draftFromStructure,
  formatKg, formatRepsField, MAX_BUILDER_LINES, moveLine, parseLoadInput, parseRepsField, parseTimeInput, formatTimeInput,
  removeLift, removeLine, setDraftFormat, setForTimeTieBreak, summarizeStructure, toggleStepMark, updateLift, updateLine
} = editor;

const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
};
const ruleText = (structure) => describeStructureRule(structure).map((part) => part.text).join('');
const errors = (analysis) => analysis.items.filter((item) => item.tone === 'error').map((item) => item.text);

// Fran: "21-15-9 · Thruster · 43" e "21-15-9 · Pull-up".
const fran = () => {
  let draft = createDraft('for_time');
  const first = draft.forTime.lines[0].key;
  draft = updateLine(draft, 'forTime', first, { reps: '21-15-9', name: 'Thruster', load: '43' });
  draft = addLine(draft, 'forTime');
  draft = updateLine(draft, 'forTime', draft.forTime.lines[1].key, { name: 'Pull-up' });
  return draft;
};
const lineKey = (draft, index, list = 'forTime') => draft[list].lines[index].key;

// ---------------------------------------------------------------------------
// Campos
// ---------------------------------------------------------------------------

test('parseRepsField: número, sequência, NxM e unidade no fim, com o limite de cada unidade', () => {
  assert.deepEqual(parseRepsField('50'), { ok: true, list: [50], unit: 'reps' });
  assert.deepEqual(parseRepsField('21-15-9'), { ok: true, list: [21, 15, 9], unit: 'reps' });
  assert.deepEqual(parseRepsField(' 21 , 15 , 9 '), { ok: true, list: [21, 15, 9], unit: 'reps' });
  assert.deepEqual(parseRepsField('10 15 20'), { ok: true, list: [10, 15, 20], unit: 'reps' });
  assert.deepEqual(parseRepsField('3x10'), { ok: true, list: [10, 10, 10], unit: 'reps' });
  assert.deepEqual(parseRepsField('5 X 12'), { ok: true, list: [12, 12, 12, 12, 12], unit: 'reps' });
  assert.deepEqual(parseRepsField('500 m'), { ok: true, list: [500], unit: 'm' });
  assert.deepEqual(parseRepsField('400m'), { ok: true, list: [400], unit: 'm' });
  assert.deepEqual(parseRepsField('30 cal'), { ok: true, list: [30], unit: 'cal' });
  assert.deepEqual(parseRepsField('21-15-9 CAL'), { ok: true, list: [21, 15, 9], unit: 'cal' });
  assert.deepEqual(parseRepsField('3x20 cal'), { ok: true, list: [20, 20, 20], unit: 'cal' });
  assert.deepEqual(parseRepsField('12 reps'), { ok: true, list: [12], unit: 'reps' });
  assert.deepEqual(parseRepsField('10000 m'), { ok: true, list: [10000], unit: 'm' });

  assert.equal(parseRepsField('').error, 'informe as repetições');
  for (const bad of ['abc', '21--', '-5', '21-x-9', 'cal', 'm', '0x10', null, undefined, 21]) {
    const result = parseRepsField(bad);
    assert.equal(result.ok, false, JSON.stringify(bad));
    assert.equal(typeof result.error, 'string');
  }
  assert.match(parseRepsField('100').error, /^cada quantidade vai de 1 a 99 repetições$/);
  assert.match(parseRepsField('1000 cal').error, /^cada quantidade vai de 1 a 999 calorias$/);
  assert.match(parseRepsField('10001 m').error, /^cada quantidade vai de 1 a 10000 metros$/);
  assert.match(parseRepsField('1-2-3-4-5-6-7-8-9-10').error, /^use de 1 a 9 rounds$/);
  assert.match(parseRepsField('0').error, /cada quantidade vai de 1/);
  assert.equal(parseRepsField('1-2-3-4-5-6-7-8-9').ok, true, '9 rounds é o limite');
  assert.equal(formatRepsField([21, 15, 9]), '21-15-9');
  assert.equal(formatRepsField([500], 'm'), '500 m');
  assert.equal(formatRepsField([30, 20], 'cal'), '30-20 cal');
});

test('carga, tempo e gerador', () => {
  assert.deepEqual(parseLoadInput(''), { ok: true, kg: null });
  assert.deepEqual(parseLoadInput('43'), { ok: true, kg: 43 });
  assert.deepEqual(parseLoadInput('42,5'), { ok: true, kg: 42.5 });
  assert.deepEqual(parseLoadInput('42.25'), { ok: true, kg: 42.25 });
  for (const bad of ['501', '-1', 'abc', '42,555', '43/29', '1000']) assert.equal(parseLoadInput(bad).ok, false, bad);
  assert.equal(formatKg(42.5), '42,5');
  assert.deepEqual(parseTimeInput('10:00'), { ok: true, seconds: 600 });
  assert.deepEqual(parseTimeInput('12'), { ok: true, seconds: 720 });
  assert.deepEqual(parseTimeInput('1:10:00'), { ok: true, seconds: 4200 });
  for (const bad of ['', '10:60', 'dez', '10:0']) assert.equal(parseTimeInput(bad).ok, false, bad);
  assert.equal(formatTimeInput(750), '12:30');
  assert.equal(detectGeneratorKind([21, 15, 9]), 'descending');
  assert.equal(detectGeneratorKind([10, 10, 10]), 'fixed');
  assert.equal(detectGeneratorKind([10, 15, 20]), 'ascending');
  assert.equal(detectGeneratorKind([10, 20, 10]), null);
});

// ---------------------------------------------------------------------------
// Rascunho novo
// ---------------------------------------------------------------------------

test('createDraft: uma linha vazia por formato, valores iniciais e o time cap do formulário', () => {
  const draft = createDraft('for_time');
  assert.equal(draft.format, 'for_time');
  assert.equal(draft.forTime.lines.length, 1);
  assert.deepEqual([draft.forTime.cap, draft.forTime.penalty, draft.forTime.rounds, draft.forTime.tieBreak], ['10:00', '1', '1', 'none']);
  assert.equal(draft.amrap.duration, '12:00');
  assert.equal(draft.amrap.scoreDisplay, 'rounds_reps');
  assert.deepEqual([draft.maxLoad.window, draft.maxLoad.order, draft.maxLoad.scoring, draft.maxLoad.step, draft.maxLoad.tieBreak], ['', 'fixed', 'sum', '2,5', 'finish_time']);
  assert.equal(new Set([draft.forTime.lines[0].key, draft.amrap.lines[0].key, draft.maxLoad.lifts[0].key]).size, 3);

  assert.equal(createDraft('for_time', { timeCap: '15:00' }).forTime.cap, '15:00');
  assert.equal(createDraft('amrap', { timeCap: '20' }).amrap.duration, '20:00');
  assert.equal(createDraft('max_load', { timeCap: '20:00' }).maxLoad.window, '20:00');
  assert.equal(createDraft('for_time', { timeCap: 'qualquer' }).forTime.cap, '10:00', 'time cap ilegível é ignorado');
  assert.equal(createDraft('for_time', { timeCap: '00:10' }).forTime.cap, '10:00', 'abaixo do mínimo é ignorado');

  const empty = analyzeDraft(draft);
  assert.equal(empty.structure, null);
  assert.deepEqual(errors(empty), ['Linha 1: informe o movimento; informe as repetições.']);
});

// ---------------------------------------------------------------------------
// For Time
// ---------------------------------------------------------------------------

test('For Time: duas linhas de 21-15-9 geram 6 etapas em ordem de round, com carga, gerador e regra', () => {
  const analysis = analyzeDraft(fran());
  assert.deepEqual(errors(analysis), []);
  const structure = analysis.structure;
  assert.ok(structure);
  assert.equal(validateWorkoutStructure(structure).ok, true);
  assert.deepEqual(structure.segments.map((item) => [item.id, item.round, item.name, item.reps, item.load?.value ?? null]), [
    ['s1', 1, 'Thruster', 21, 43], ['s2', 1, 'Pull-up', 21, null],
    ['s3', 2, 'Thruster', 15, 43], ['s4', 2, 'Pull-up', 15, null],
    ['s5', 3, 'Thruster', 9, 43], ['s6', 3, 'Pull-up', 9, null]
  ]);
  assert.ok(structure.segments.every((item) => item.unit === 'reps' && item.mark === 'reps' && item.required));
  assert.deepEqual(structure.generator, { kind: 'descending', reps: [21, 15, 9] });
  assert.equal(structure.customized, false);
  assert.deepEqual([structure.totalReps, structure.timeCapSeconds, structure.incomplete.secondsPerRep, structure.tieBreak], [90, 600, 1, null]);
  assert.equal(analysis.rounds, 3);
  assert.equal(analysis.derivedRounds, 3);
  assert.equal(analysis.steps.length, 6);
  assert.deepEqual(deriveLegacyWorkoutFields(structure), { type: 'fortime', timeCap: '10:00', tieBreaker: '' });
  assert.equal(summarizeStructure(structure), 'For Time · 6 etapas · 90 repetições · cap 10:00');
  assert.equal(
    ruleText(structure),
    'Quem terminar as 90 repetições antes de 10:00 fica com o tempo real. Quem não terminar fica com 10:00 mais 1 s por repetição que faltou (ex.: 82 de 90 vira 10:08). Sem desempate: empates dividem a posição.'
  );
});

test('For Time: número sozinho se repete nos rounds, o campo Rounds vale sem sequência e a carga aceita decimal', () => {
  let draft = createDraft('for_time');
  draft = updateLine(draft, 'forTime', lineKey(draft, 0), { reps: '10', name: 'Burpee' });
  draft = addLine(draft, 'forTime');
  draft = updateLine(draft, 'forTime', lineKey(draft, 1), { reps: '20', name: 'Wall ball', load: '9' });
  draft = { ...draft, forTime: { ...draft.forTime, rounds: '5' } };
  const five = analyzeDraft(draft).structure;
  assert.equal(five.segments.length, 10);
  assert.equal(five.totalReps, 150);
  assert.equal(five.generator, null, 'linhas diferentes não cabem num gerador');
  assert.equal(five.customized, true);

  // Uma linha fixa junto de uma sequência: a fixa se repete nos 3 rounds.
  draft = updateLine(draft, 'forTime', lineKey(draft, 0), { reps: '21-15-9', name: 'Thruster', load: '42,5' });
  const mixed = analyzeDraft(draft);
  assert.equal(mixed.derivedRounds, 3, 'a sequência manda nos rounds');
  assert.deepEqual(mixed.structure.segments.map((item) => item.reps), [21, 20, 15, 20, 9, 20]);
  assert.equal(mixed.structure.segments[0].load.value, 42.5);

  // Chipper: um round, cada linha com sua quantidade.
  let chipper = createDraft('for_time');
  chipper = updateLine(chipper, 'forTime', lineKey(chipper, 0), { reps: '50', name: 'Double under' });
  chipper = addLine(chipper, 'forTime');
  chipper = updateLine(chipper, 'forTime', lineKey(chipper, 1), { reps: '40', name: 'Pull-up' });
  assert.deepEqual(analyzeDraft(chipper).structure.segments.map((item) => [item.round, item.reps]), [[1, 50], [1, 40]]);
});

test('For Time: metros e calorias por linha; em metros o judge só conclui o bloco', () => {
  let draft = createDraft('for_time');
  draft = updateLine(draft, 'forTime', lineKey(draft, 0), { reps: '500 m', name: 'Remo', mark: 'reps' });
  draft = addLine(draft, 'forTime');
  draft = updateLine(draft, 'forTime', lineKey(draft, 1), { reps: '30 cal', name: 'Bike' });
  draft = addLine(draft, 'forTime');
  draft = updateLine(draft, 'forTime', lineKey(draft, 2), { reps: '20', name: 'Burpee' });
  const structure = analyzeDraft(draft).structure;
  assert.deepEqual(structure.segments.map((item) => [item.unit, item.reps, item.mark]), [['m', 500, 'end'], ['cal', 30, 'reps'], ['reps', 20, 'reps']]);
  assert.equal(structure.generator, null);
  assert.equal(structure.totalReps, 550);
  assert.match(summarizeStructure(structure), /550 unidades de trabalho/);
  assert.match(ruleText(structure), /por unidade de trabalho que faltou/);
});

test('For Time: problemas por linha, sequências desiguais, rounds, time cap, penalidade e limite de etapas', () => {
  let draft = fran();
  draft = updateLine(draft, 'forTime', lineKey(draft, 1), { reps: '21-15-9-3', name: '', load: '600' });
  let analysis = analyzeDraft(draft);
  assert.equal(analysis.structure, null);
  assert.deepEqual(errors(analysis), [
    'Linha 2: informe o movimento; a carga vai de 0 a 500 kg (ex.: 43 ou 42,5).',
    'As sequências de repetições têm tamanhos diferentes (3 e 4 rounds). Use o mesmo número de rounds em todas as linhas.'
  ]);
  assert.match(analysis.lineProblems[lineKey(draft, 1)], /^Linha 2: /);

  draft = fran();
  draft = { ...draft, forTime: { ...draft.forTime, cap: '99:99', penalty: '61' } };
  assert.deepEqual(errors(analyzeDraft(draft)), [
    'Time cap: use MM:SS entre 00:30 e 99:59.',
    'Penalidade: de 0 a 60 segundos inteiros por repetição.'
  ]);

  let rounds = createDraft('for_time');
  rounds = updateLine(rounds, 'forTime', lineKey(rounds, 0), { reps: '10', name: 'Burpee' });
  rounds = { ...rounds, forTime: { ...rounds.forTime, rounds: '10' } };
  assert.deepEqual(errors(analyzeDraft(rounds)), ['Rounds: de 1 a 9.']);

  let many = createDraft('for_time');
  many = updateLine(many, 'forTime', lineKey(many, 0), { reps: '1-1-1-1-1-1-1-1', name: 'A' });
  for (let index = 1; index < 4; index += 1) {
    many = addLine(many, 'forTime');
    many = updateLine(many, 'forTime', lineKey(many, index), { name: `M${index}` });
  }
  assert.deepEqual(errors(analyzeDraft(many)), ['32 etapas: o limite é 30. Reduza rounds ou movimentos.']);
});

test('For Time: desempate por marco fixo e pelo último marco concluído', () => {
  let draft = fran();
  const pullUp = lineKey(draft, 1);
  draft = toggleStepMark(draft, { line: pullUp, round: 3 });
  assert.equal(draft.forTime.tieBreak, 'split', 'a bandeira liga o marco fixo');
  let structure = analyzeDraft(draft).structure;
  assert.deepEqual(structure.tieBreak, { kind: 'split_time', at: 's6', order: 'asc' });
  assert.match(ruleText(structure), /vence o menor tempo ao concluir 9 Pull-up do round 3\.$/);
  assert.equal(deriveLegacyWorkoutFields(structure).tieBreaker, 'Tempo');

  // No marco fixo a bandeira se move; tocar de novo na mesma desliga.
  draft = toggleStepMark(draft, { line: pullUp, round: 2 });
  assert.deepEqual(analyzeDraft(draft).structure.tieBreak, { kind: 'split_time', at: 's4', order: 'asc' });
  assert.equal(toggleStepMark(draft, { line: pullUp, round: 2 }).forTime.tieBreak, 'none');

  // Último marco concluído: várias bandeiras (o Open 26.2 marca cada set).
  draft = setForTimeTieBreak(draft, 'last_split');
  draft = toggleStepMark(draft, { line: pullUp, round: 1 });
  draft = toggleStepMark(draft, { line: pullUp, round: 3 });
  structure = analyzeDraft(draft).structure;
  assert.deepEqual(structure.tieBreak, { kind: 'last_split', at: ['s2', 's4', 's6'], order: 'asc' });
  assert.match(ruleText(structure), /último marco concluído \(3 marcos\)/);
  assert.equal(analyzeDraft(draft).steps.filter((step) => step.marked).length, 3);

  // Voltar ao marco fixo mantém só a primeira bandeira; "sem desempate" tira todas.
  assert.equal(setForTimeTieBreak(draft, 'split').forTime.marks.length, 1);
  assert.equal(setForTimeTieBreak(draft, 'none').forTime.marks.length, 0);

  // Escolher um modo sem bandeira é um problema a corrigir.
  const unmarked = setForTimeTieBreak(fran(), 'last_split');
  assert.deepEqual(errors(analyzeDraft(unmarked)), ['Desempate: toque na bandeira da etapa em que o judge anota o tempo.']);
  // Remover a linha do marco tira a bandeira.
  assert.equal(removeLine(draft, 'forTime', pullUp).forTime.marks.length, 0);
});

// ---------------------------------------------------------------------------
// AMRAP
// ---------------------------------------------------------------------------

test('AMRAP: as linhas descrevem um round; desempate pelo último round ou por um marco do 1º round', () => {
  let draft = setDraftFormat(createDraft('for_time'), 'amrap');
  const first = lineKey(draft, 0, 'amrap');
  draft = updateLine(draft, 'amrap', first, { reps: '5', name: 'Pull-up' });
  draft = addLine(draft, 'amrap');
  assert.equal(draft.amrap.lines[1].reps, '', 'no AMRAP a linha nova vem vazia');
  draft = updateLine(draft, 'amrap', lineKey(draft, 1, 'amrap'), { reps: '10', name: 'Push-up' });
  draft = addLine(draft, 'amrap');
  draft = updateLine(draft, 'amrap', lineKey(draft, 2, 'amrap'), { reps: '15', name: 'Air squat' });
  draft = { ...draft, amrap: { ...draft.amrap, duration: '20:00', tieBreak: 'last_round' } };

  const structure = analyzeDraft(draft).structure;
  assert.equal(structure.format, 'amrap');
  assert.deepEqual(structure.segments.map((item) => [item.round, item.reps]), [[1, 5], [1, 10], [1, 15]]);
  assert.deepEqual(structure.tieBreak, { kind: 'last_round', order: 'asc' });
  assert.equal(structure.scoreDisplay, 'rounds_reps');
  assert.equal(structure.incomplete, null);
  assert.equal(structure.generator, null);
  assert.match(ruleText(structure), /Cada round tem 30 repetições\. O score aparece como "7 rounds \+ 12" e, no ranking, vale 7 × 30 \+ 12 = 222\. Em caso de empate, vence quem fechou o último round completo/);
  assert.equal(summarizeStructure(structure), 'AMRAP · 3 movimentos · 30 repetições por round · 20:00');

  const total = analyzeDraft({ ...draft, amrap: { ...draft.amrap, scoreDisplay: 'total' } }).structure;
  assert.equal(total.scoreDisplay, 'total');
  assert.match(ruleText(total), /O score aparece como o total/);

  const split = { ...draft, amrap: { ...draft.amrap, tieBreak: 'split', markLine: null } };
  assert.deepEqual(errors(analyzeDraft(split)), ['Desempate: escolha o movimento do 1º round em que o judge anota o tempo.']);
  const marked = analyzeDraft({ ...split, amrap: { ...split.amrap, markLine: lineKey(draft, 1, 'amrap') } }).structure;
  assert.deepEqual(marked.tieBreak, { kind: 'split_time', at: 's2', order: 'asc' });

  const sequence = updateLine(draft, 'amrap', first, { reps: '5-10' });
  assert.deepEqual(errors(analyzeDraft(sequence)), ['Linha 1: no AMRAP use uma quantidade por movimento (o round se repete).']);

  let even = setDraftFormat(createDraft('for_time'), 'amrap');
  even = updateLine(even, 'amrap', lineKey(even, 0, 'amrap'), { reps: '10', name: 'Thruster', load: '43' });
  even = addLine(even, 'amrap');
  even = updateLine(even, 'amrap', lineKey(even, 1, 'amrap'), { reps: '10', name: 'Pull-up' });
  assert.deepEqual(analyzeDraft(even).structure.generator, { kind: 'fixed', reps: [10] });
});

// ---------------------------------------------------------------------------
// Carga máxima
// ---------------------------------------------------------------------------

test('Carga máxima: movimentos com repetições por tentativa, carga inicial e tentativas, janela opcional', () => {
  let draft = setDraftFormat(createDraft('for_time'), 'max_load');
  const first = draft.maxLoad.lifts[0].key;
  draft = updateLift(draft, first, { name: 'Back Squat', load: '100' });
  draft = addLift(draft);
  draft = updateLift(draft, draft.maxLoad.lifts[1].key, { name: 'Press', load: '40', attempts: '2' });
  draft = addLift(draft);
  draft = updateLift(draft, draft.maxLoad.lifts[2].key, { name: 'Deadlift', reps: '3', attempts: 'unlimited' });

  let structure = analyzeDraft(draft).structure;
  assert.equal(structure.format, 'max_load');
  assert.deepEqual(structure.maxLoad.lifts, [
    { id: 'l1', name: 'Back Squat', reps: 1, maxAttempts: 3, startLoadKg: 100, note: '' },
    { id: 'l2', name: 'Press', reps: 1, maxAttempts: 2, startLoadKg: 40, note: '' },
    { id: 'l3', name: 'Deadlift', reps: 3, maxAttempts: null, startLoadKg: null, note: '' }
  ]);
  assert.deepEqual([structure.timeCapSeconds, structure.maxLoad.order, structure.maxLoad.scoring, structure.maxLoad.loadStepKg], [null, 'fixed', 'sum', 2.5]);
  assert.deepEqual(structure.tieBreak, { kind: 'finish_time', order: 'asc' });
  assert.deepEqual(deriveLegacyWorkoutFields(structure), { type: 'maxweight', timeCap: '', tieBreaker: 'Tempo' });
  assert.match(ruleText(structure), /^Cada atleta tem o número de tentativas de cada movimento, na ordem fixa\. Vale a maior carga válida de cada movimento, somadas\./);
  assert.equal(summarizeStructure(structure), 'Carga máxima · 3 movimentos · soma das cargas · sem janela');

  draft = { ...draft, maxLoad: { ...draft.maxLoad, window: '20:00', scoring: 'best', order: 'free', step: '1', tieBreak: 'fewest_attempts' } };
  structure = analyzeDraft(draft).structure;
  assert.deepEqual([structure.timeCapSeconds, structure.maxLoad.order, structure.maxLoad.scoring, structure.maxLoad.loadStepKg], [1200, 'free', 'best', 1]);
  assert.deepEqual(structure.tieBreak, { kind: 'fewest_attempts', order: 'asc' });
  assert.match(ruleText(structure), /dentro de 20:00 \(levantamento concluído depois da janela não conta\)\. Vale a maior carga válida entre os movimentos\. Em caso de empate, vence quem usou menos tentativas\./);
  assert.equal(deriveLegacyWorkoutFields(structure).tieBreaker, '');

  const broken = {
    ...updateLift(draft, first, { name: '', reps: '11', load: '700' }),
    maxLoad: { ...updateLift(draft, first, { name: '', reps: '11', load: '700' }).maxLoad, window: '99:99', step: '0' }
  };
  assert.deepEqual(errors(analyzeDraft(broken)), [
    'Linha 1: informe o movimento; as repetições por tentativa vão de 1 a 10; a carga inicial vai de 0 a 500 kg.',
    'Janela: use MM:SS entre 00:30 e 99:59.',
    'Incremento: de 0,25 a 25 kg.'
  ]);
  assert.equal(analyzeDraft({ ...draft, maxLoad: { ...draft.maxLoad, tieBreak: 'none' } }).structure.tieBreak, null);
});

// ---------------------------------------------------------------------------
// Editar uma súmula gravada
// ---------------------------------------------------------------------------

test('draftFromStructure: a estrutura gravada volta em linhas e gera a mesma estrutura', () => {
  const marked = setForTimeTieBreak(toggleStepMark(toggleStepMark(fran(), { line: lineKey(fran(), 1), round: 1 }), { line: lineKey(fran(), 1), round: 3 }), 'last_split');
  const cases = [fran(), marked];

  let units = createDraft('for_time');
  units = updateLine(units, 'forTime', lineKey(units, 0), { reps: '500 m', name: 'Remo' });
  units = addLine(units, 'forTime');
  units = updateLine(units, 'forTime', lineKey(units, 1), { reps: '21-15-9 cal', name: 'Bike' });
  cases.push(units);

  let fixed = createDraft('for_time');
  fixed = updateLine(fixed, 'forTime', lineKey(fixed, 0), { reps: '10', name: 'Burpee', note: 'Peito no chão' });
  fixed = { ...fixed, forTime: { ...fixed.forTime, rounds: '4' } };
  cases.push(fixed);

  for (const draft of cases) {
    const original = analyzeDraft(draft).structure;
    assert.ok(original, JSON.stringify(analyzeDraft(draft).problems));
    const loaded = draftFromStructure(original);
    assert.equal(loaded.ok, true);
    assert.deepEqual(analyzeDraft(loaded.draft).structure, original);
  }
  const loadedFran = draftFromStructure(analyzeDraft(fran()).structure).draft;
  assert.deepEqual(loadedFran.forTime.lines.map((line) => [line.reps, line.name, line.load]), [['21-15-9', 'Thruster', '43'], ['21-15-9', 'Pull-up', '']]);
  const loadedFixed = draftFromStructure(analyzeDraft(fixed).structure).draft;
  assert.deepEqual([loadedFixed.forTime.lines[0].reps, loadedFixed.forTime.rounds], ['10', '4']);
  assert.equal(draftFromStructure(analyzeDraft(units).structure).draft.forTime.lines[0].reps, '500 m');
});

test('draftFromStructure: AMRAP e carga máxima voltam ao rascunho; o que não cabe em linhas é avisado', () => {
  let amrap = setDraftFormat(createDraft('for_time'), 'amrap');
  amrap = updateLine(amrap, 'amrap', lineKey(amrap, 0, 'amrap'), { reps: '10', name: 'Thruster', load: '43' });
  amrap = addLine(amrap, 'amrap');
  amrap = updateLine(amrap, 'amrap', lineKey(amrap, 1, 'amrap'), { reps: '30 cal', name: 'Bike' });
  amrap = { ...amrap, amrap: { ...amrap.amrap, tieBreak: 'split', markLine: lineKey(amrap, 1, 'amrap'), scoreDisplay: 'total' } };
  const amrapStructure = analyzeDraft(amrap).structure;
  const loadedAmrap = draftFromStructure(amrapStructure);
  assert.equal(loadedAmrap.draft.format, 'amrap');
  assert.deepEqual(analyzeDraft(loadedAmrap.draft).structure, amrapStructure);

  let maxLoad = setDraftFormat(createDraft('for_time'), 'max_load');
  maxLoad = updateLift(maxLoad, maxLoad.maxLoad.lifts[0].key, { name: 'Snatch', load: '42,5', attempts: '1' });
  maxLoad = { ...maxLoad, maxLoad: { ...maxLoad.maxLoad, window: '12:00', step: '0,5', tieBreak: 'none' } };
  const maxStructure = analyzeDraft(maxLoad).structure;
  const loadedMax = draftFromStructure(maxStructure);
  assert.deepEqual(analyzeDraft(loadedMax.draft).structure, maxStructure);
  assert.deepEqual([loadedMax.draft.maxLoad.lifts[0].load, loadedMax.draft.maxLoad.step], ['42,5', '0,5']);

  // Ordem dos movimentos mudando entre rounds: montada etapa por etapa (Story 1.45), não cabe em linhas.
  const frans = analyzeDraft(fran()).structure;
  const swapped = { ...frans, segments: [frans.segments[0], frans.segments[1], frans.segments[3], frans.segments[2], frans.segments[4], frans.segments[5]] };
  const notLines = draftFromStructure(swapped);
  assert.equal(notLines.ok, false);
  assert.match(notLines.error, /montada etapa por etapa e não cabe em linhas/);
  assert.equal(draftFromStructure({ ...amrapStructure, segments: amrapStructure.segments.map((item, index) => ({ ...item, round: index + 1 })) }).ok, false, 'AMRAP com mais de um round');
});

// ---------------------------------------------------------------------------
// Operações do rascunho
// ---------------------------------------------------------------------------

test('operações de linha: adicionar (For Time copia as repetições), limites, mover e não mutar', () => {
  const draft = deepFreeze(fran());
  const added = addLine(draft, 'forTime');
  assert.equal(added.forTime.lines[2].reps, '21-15-9');
  assert.equal(added.nextKey, draft.nextKey + 1);
  assert.notEqual(added, draft);

  let full = createDraft('for_time');
  for (let index = 1; index < MAX_BUILDER_LINES + 3; index += 1) full = addLine(full, 'forTime');
  assert.equal(full.forTime.lines.length, MAX_BUILDER_LINES);

  const single = createDraft('for_time');
  assert.equal(removeLine(single, 'forTime', lineKey(single, 0)), single, 'não remove a última linha');
  assert.equal(removeLine(draft, 'forTime', 'inexistente'), draft);

  const moved = moveLine(draft, 'forTime', lineKey(draft, 1), 'up');
  assert.deepEqual(moved.forTime.lines.map((line) => line.name), ['Pull-up', 'Thruster']);
  assert.equal(moveLine(draft, 'forTime', lineKey(draft, 0), 'up'), draft);
  assert.deepEqual(analyzeDraft(moved).structure.segments.slice(0, 2).map((item) => item.name), ['Pull-up', 'Thruster']);

  let lifts = setDraftFormat(createDraft('for_time'), 'max_load');
  for (let index = 0; index < 8; index += 1) lifts = addLift(lifts);
  assert.equal(lifts.maxLoad.lifts.length, 5);
  const one = setDraftFormat(createDraft('for_time'), 'max_load');
  assert.equal(removeLift(one, one.maxLoad.lifts[0].key), one);
  assert.equal(removeLift(lifts, lifts.maxLoad.lifts[4].key).maxLoad.lifts.length, 4);
  assert.equal(setDraftFormat(draft, 'amrap').forTime, draft.forTime, 'trocar de formato não perde o rascunho do outro');
});

test('tudo que o construtor gera passa no validador do servidor (rascunhos aleatórios)', () => {
  const words = ['Thruster', 'Pull-up', 'Burpee', 'Remo', 'Bike', 'Wall ball'];
  const repsTexts = ['21-15-9', '10', '3x10', '500 m', '30 cal', '50', '15-12-9', '5x5', '200 m', '12'];
  let seed = 7;
  const random = (max) => {
    seed = (seed * 48271) % 2147483647;
    return seed % max;
  };
  let produced = 0;
  for (let round = 0; round < 200; round += 1) {
    let draft = setDraftFormat(createDraft('for_time'), ['for_time', 'amrap', 'max_load'][random(3)]);
    const lines = 1 + random(4);
    for (let index = 0; index < lines; index += 1) {
      if (index > 0) draft = draft.format === 'max_load' ? addLift(draft) : addLine(draft, draft.format === 'amrap' ? 'amrap' : 'forTime');
      if (draft.format === 'max_load') {
        const lift = draft.maxLoad.lifts[draft.maxLoad.lifts.length - 1];
        draft = updateLift(draft, lift.key, { name: words[random(words.length)], reps: String(1 + random(5)), load: random(2) ? String(random(200)) : '', attempts: ['1', '2', '3', 'unlimited'][random(4)] });
      } else {
        const list = draft.format === 'amrap' ? 'amrap' : 'forTime';
        const line = draft[list].lines[draft[list].lines.length - 1];
        draft = updateLine(draft, list, line.key, { name: words[random(words.length)], reps: repsTexts[random(repsTexts.length)], load: random(2) ? `${random(120)},5` : '' });
      }
    }
    if (draft.format === 'for_time' && random(2)) {
      const steps = analyzeDraft(draft).steps;
      if (steps.length) draft = toggleStepMark(draft, steps[random(steps.length)].ref);
    }
    const analysis = analyzeDraft(draft);
    if (analysis.structure) {
      produced += 1;
      const checked = validateWorkoutStructure(analysis.structure);
      assert.equal(checked.ok, true, checked.error);
      assert.deepEqual(checked.structure, analysis.structure, 'já sai normalizada');
    } else {
      assert.ok(analysis.problems.length > 0, 'sem estrutura, há um problema a corrigir');
    }
  }
  assert.ok(produced > 80, `rascunhos válidos: ${produced}`);
});
