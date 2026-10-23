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
  formatKg, formatRepsField, MAX_BUILDER_LINES, maskTimeInput, moveLine, parseLoadInput, parseRepsField, parseTimeInput, formatTimeInput,
  removeLift, removeLine, setDraftFormat, setForTimeTieBreak, summarizeStructure, toggleStepMark, updateLift, updateLine,
  DEFAULT_INTERVAL, INTERVAL_FIELDS, INTERVAL_MAX_ID, MAX_INTERVAL_FIXED_LINES, formatMinutes, intervalDurationSeconds,
  updateIntervalMax, updateIntervalTiming
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

// Story 1.70: o teclado numérico do celular não tem ":"; a máscara preenche o
// MM:SS da direita para a esquerda e o resultado tem que passar no parseTimeInput.
test('maskTimeInput: algarismos entram da direita para a esquerda e o ":" aparece sozinho', () => {
  for (const [typed, shown] of [
    ['', ''], ['0', ''], ['000', ''], ['1', '00:01'], ['33', '00:33'], ['133', '01:33'], ['1133', '11:33'],
    ['0033', '00:33'], ['00:33', '00:33'], ['9959', '99:59'], ['12345', '12:34'], ['11:335', '11:33']
  ]) assert.equal(maskTimeInput(typed), shown, JSON.stringify(typed));
  for (const pasted of ['11:33', '11.33', '11,33', ' 11:33 ', '1133', '11h33']) assert.equal(maskTimeInput(pasted), '11:33', pasted);
  for (const notText of [undefined, null, 1133, {}]) assert.equal(maskTimeInput(notText), '', String(notText));
});

test('maskTimeInput: digitando tecla a tecla, com ou sem zeros e com backspace, chega a todo tempo de 00:01 a 99:59', () => {
  // O input é controlado: o valor novo é o valor mostrado + a tecla (cursor no fim), e volta pela máscara.
  const press = (shown, key) => maskTimeInput(key === 'backspace' ? shown.slice(0, -1) : shown + key);
  const type = (keys) => keys.reduce(press, '');
  for (let seconds = 1; seconds <= 5999; seconds++) {
    const digits = `${String(Math.floor(seconds / 60)).padStart(2, '0')}${String(seconds % 60).padStart(2, '0')}`;
    for (const keys of [[...digits], [...digits.replace(/^0+/, '')], ['9', 'backspace', ...digits]]) {
      assert.deepEqual(parseTimeInput(type(keys)), { ok: true, seconds }, `${seconds}: ${keys.join(' ')}`);
    }
  }
  assert.equal(type([...'1133', 'backspace']), '01:13');
  assert.equal(type([...'11335']), '11:33');
});

test('parseTimeInput: segundos de 60 a 99 recebem o aviso dos segundos; o resto mantém o aviso de formato', () => {
  assert.deepEqual(parseTimeInput(maskTimeInput('1175')), { ok: false, error: 'Os segundos vão de 00 a 59 (ex.: 10:30).' });
  assert.deepEqual(parseTimeInput('10:60'), { ok: false, error: 'Os segundos vão de 00 a 59 (ex.: 10:30).' });
  for (const bad of ['', 'dez', '10:0', '1:10:75', '1000']) {
    assert.deepEqual(parseTimeInput(bad), { ok: false, error: 'Informe o tempo no formato MM:SS (ex.: 10:00).' }, bad);
  }
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

// ---------------------------------------------------------------------------
// Intervalado (Story 1.61, decisões e Maquete 1 em docs/design/intervalado/)
// ---------------------------------------------------------------------------

const ivKey = (draft, index) => draft.interval.lines[index].key;
// O treino de referência: 5 rounds, 02:00 ON / 02:00 OFF, 6 Ring Muscle Ups, 15 Box Jump Overs, máximo de Squat Clean 80 kg.
const reference = () => {
  let draft = setDraftFormat(createDraft('for_time'), 'interval');
  draft = updateLine(draft, 'interval', ivKey(draft, 0), { reps: '6', name: 'Ring Muscle Ups' });
  draft = addLine(draft, 'interval');
  draft = updateLine(draft, 'interval', ivKey(draft, 1), { reps: '15', name: 'Box Jump Overs (24/20 in)' });
  return updateIntervalMax(draft, { name: 'Squat Clean', load: '80' });
};
const strongText = (structure) => describeStructureRule(structure).map((part) => (part.strong ? `[${part.text}]` : part.text)).join('');

test('Intervalado: rascunho novo com 5 rounds, 02:00 / 02:00, uma linha de fixo vazia e o máximo vazio', () => {
  assert.deepEqual(DEFAULT_INTERVAL, { rounds: 5, onSeconds: 120, offSeconds: 120 });
  const draft = createDraft('interval');
  assert.equal(draft.format, 'interval');
  assert.deepEqual([draft.interval.rounds, draft.interval.on, draft.interval.off], ['5', '02:00', '02:00']);
  assert.equal(draft.interval.lines.length, 1);
  assert.deepEqual(draft.interval.lines[0], { key: draft.interval.lines[0].key, reps: '', name: '', load: '', mark: 'reps', note: '' });
  assert.deepEqual(draft.interval.max, { key: draft.interval.max.key, name: '', load: '', note: '' });
  const keys = [draft.forTime.lines[0].key, draft.amrap.lines[0].key, draft.maxLoad.lifts[0].key, draft.interval.lines[0].key, draft.interval.max.key];
  assert.equal(new Set(keys).size, 5, 'chaves únicas no rascunho');
  assert.ok(keys.every((key) => Number(key.slice(1)) < draft.nextKey));
  assert.equal(MAX_INTERVAL_FIXED_LINES, 9);

  // Trocar de formato preserva os rascunhos dos outros formatos (e o do Intervalado).
  const ft = fran();
  const switched = setDraftFormat(ft, 'interval');
  assert.equal(switched.forTime, ft.forTime);
  assert.equal(switched.amrap, ft.amrap);
  assert.equal(switched.maxLoad, ft.maxLoad);
  const filled = reference();
  assert.equal(setDraftFormat(setDraftFormat(filled, 'for_time'), 'interval').interval, filled.interval);

  const empty = analyzeDraft(draft);
  assert.equal(empty.structure, null);
  assert.deepEqual(errors(empty), ['Linha 1: informe o movimento; informe as repetições.', 'Movimento máximo: informe o movimento.']);
  assert.deepEqual(empty.intervalTiming, { rounds: 5, onSeconds: 120, offSeconds: 120, totalSeconds: 1080 }, 'os tempos padrão já valem');
});

test('Intervalado: o treino de referência gera a estrutura v3 válida (18:00, 21 repetições por round, máximo com id próprio)', () => {
  const analysis = analyzeDraft(reference());
  assert.deepEqual(analysis.problems, []);
  assert.deepEqual(analysis.items, [
    { tone: 'ok', text: '5 rounds de 02:00 de trabalho e 02:00 de descanso · 18:00 no total' },
    { tone: 'ok', text: '2 movimentos fixos (21 repetições por round)' },
    { tone: 'ok', text: '1 movimento máximo: Squat Clean 80 kg' },
    { tone: 'muted', text: 'Sem desempate (opcional)' }
  ]);
  const structure = analysis.structure;
  assert.deepEqual(structure, {
    version: 4,
    format: 'interval',
    totalReps: 21,
    timeCapSeconds: 1080,
    incomplete: null,
    tieBreak: null,
    generator: null,
    customized: true,
    entry: { mode: 'both', marking: 'reps', publish: 'after_review' },
    segments: [
      { id: 's1', round: 1, name: 'Ring Muscle Ups', reps: 6, unit: 'reps', load: null, note: '', required: true, mark: 'reps' },
      { id: 's2', round: 1, name: 'Box Jump Overs (24/20 in)', reps: 15, unit: 'reps', load: null, note: '', required: true, mark: 'reps' }
    ],
    maxLoad: null,
    scoreDisplay: null,
    interval: { rounds: 5, onSeconds: 120, offSeconds: 120, max: { id: INTERVAL_MAX_ID, name: 'Squat Clean', load: { value: 80, unit: 'kg' }, note: '' } },
    distance: null
  });
  const checked = validateWorkoutStructure(structure);
  assert.equal(checked.ok, true, checked.error);
  assert.deepEqual(checked.structure, structure, 'já sai normalizada');
  assert.deepEqual(analysis.intervalTiming, { rounds: 5, onSeconds: 120, offSeconds: 120, totalSeconds: 1080 });
  // Decisão 8: o painel grava o tipo legado reps, com a duração como time cap e sem desempate.
  assert.deepEqual(deriveLegacyWorkoutFields(structure), { type: 'reps', timeCap: '18:00', tieBreaker: '' });
  assert.equal(intervalDurationSeconds(5, 120, 120), 1080);
  assert.equal(intervalDurationSeconds(20, 120, 120), 4680, '20 × 02:00 / 02:00 = 78:00 (R4)');
});

test('Intervalado: fixos com unidade, contagem, observação e carga; máximo com observação', () => {
  let draft = reference();
  draft = updateLine(draft, 'interval', ivKey(draft, 0), { reps: '30 cal', name: 'Bike', load: '', mark: 'end', note: 'no monitor' });
  draft = updateLine(draft, 'interval', ivKey(draft, 1), { reps: '200 m', name: 'Run', mark: 'reps' });
  draft = addLine(draft, 'interval');
  draft = updateLine(draft, 'interval', ivKey(draft, 2), { reps: '5', name: 'Thruster', load: '42,5' });
  draft = updateIntervalMax(draft, { note: ' peito no chão ' });
  const structure = analyzeDraft(draft).structure;
  assert.deepEqual(structure.segments.map((item) => [item.id, item.unit, item.reps, item.mark, item.note, item.load?.value ?? null]), [
    ['s1', 'cal', 30, 'end', 'no monitor', null], ['s2', 'm', 200, 'end', '', null], ['s3', 'reps', 5, 'reps', '', 42.5]
  ]);
  assert.equal(structure.totalReps, 235);
  assert.equal(structure.interval.max.note, 'peito no chão');
  assert.equal(validateWorkoutStructure(structure).ok, true);
  assert.match(analyzeDraft(draft).items[1].text, /^3 movimentos fixos \(235 unidades de trabalho por round\)$/);
});

test('Intervalado: erros de rounds, trabalho, descanso e duração, com os textos da maquete e o campo marcado', () => {
  const timing = (patch) => analyzeDraft(updateIntervalTiming(reference(), patch));
  for (const rounds of ['1', '21', '', 'cinco', '2.5']) {
    const analysis = timing({ rounds });
    assert.deepEqual(errors(analysis), ['Rounds: de 2 a 20.'], rounds);
    assert.equal(analysis.lineProblems[INTERVAL_FIELDS.rounds], 'Rounds: de 2 a 20.');
    assert.equal(analysis.structure, null);
    assert.equal(analysis.intervalTiming, null);
  }
  for (const on of ['00:29', '30:01', '', '2:5']) {
    const analysis = timing({ on });
    assert.deepEqual(errors(analysis), ['Trabalho: de 00:30 a 30:00 (MM:SS).'], on);
    assert.ok(analysis.lineProblems[INTERVAL_FIELDS.on]);
  }
  for (const off of ['30:01', '', 'x']) {
    const analysis = timing({ off });
    assert.deepEqual(errors(analysis), ['Descanso: de 00:00 a 30:00 (MM:SS).'], off);
    assert.ok(analysis.lineProblems[INTERVAL_FIELDS.off]);
  }
  assert.deepEqual(errors(timing({ rounds: '1', on: '00:10', off: '31:00' })), [
    'Rounds: de 2 a 20.', 'Trabalho: de 00:30 a 30:00 (MM:SS).', 'Descanso: de 00:00 a 30:00 (MM:SS).'
  ]);

  // A duração passa de 99:59 (decisão 10, R4): a mensagem traz o valor calculado, em minutos.
  const long = timing({ rounds: '20', on: '03:00', off: '03:00' });
  assert.deepEqual(errors(long), ['A prova passa de 99:59 (117:00). Reduza rounds ou tempos.']);
  assert.ok(long.lineProblems[INTERVAL_FIELDS.duration]);
  assert.equal(long.intervalTiming, null);
  assert.equal(long.structure, null);

  // Os limites exatos valem: 2 rounds, 00:30 de trabalho, 30:00 de trabalho e de descanso, 99:59 no total.
  assert.equal(timing({ rounds: '2', on: '00:30', off: '00:00' }).structure.timeCapSeconds, 60);
  assert.equal(timing({ rounds: '2', on: '30:00', off: '30:00' }).structure.timeCapSeconds, 5400);
  assert.equal(timing({ rounds: '20', on: '02:00', off: '02:00' }).structure.timeCapSeconds, 4680);
  assert.equal(timing({ rounds: '3', on: '33:19', off: '00:01' }).structure, null, 'trabalho acima de 30:00');
  const exact = timing({ rounds: '20', on: '04:59', off: '00:00' });
  assert.equal(exact.structure.timeCapSeconds, 5980);
  assert.match(exact.items[0].text, /^20 rounds de 04:59 de trabalho, sem descanso · 99:40 no total$/);
  assert.equal(timing({ on: '2' }).structure.interval.onSeconds, 120, 'minutos sozinhos, como nos outros tempos');
  assert.equal(formatMinutes(4680), '78:00');
});

test('Intervalado: erros dos fixos e do máximo; 0 fixos e OFF em 00:00 são aceitos', () => {
  let draft = reference();
  draft = updateLine(draft, 'interval', ivKey(draft, 0), { name: '' });
  draft = updateLine(draft, 'interval', ivKey(draft, 1), { reps: 'abc', load: '600' });
  draft = updateIntervalMax(draft, { name: ' ', load: '501' });
  let analysis = analyzeDraft(draft);
  assert.deepEqual(errors(analysis), [
    'Linha 1: informe o movimento.',
    'Linha 2: repetições: use 50, 21-15-9, 3x10, 500 m ou 30 cal; a carga vai de 0 a 500 kg (ex.: 43 ou 42,5).',
    'Movimento máximo: informe o movimento; a carga vai de 0 a 500 kg (ex.: 43 ou 42,5).'
  ]);
  assert.match(analysis.lineProblems[ivKey(draft, 0)], /^Linha 1: /);
  assert.match(analysis.lineProblems[draft.interval.max.key], /^Movimento máximo: /);
  assert.equal(analysis.structure, null);
  assert.equal(analysis.items.some((item) => /movimentos? fixos? \(/.test(item.text)), false, 'sem o item certo dos fixos enquanto houver erro');

  // Um número por movimento, como no AMRAP: sequência e 3x10 são recusadas.
  for (const reps of ['5-10', '3x10']) {
    analysis = analyzeDraft(updateLine(reference(), 'interval', ivKey(reference(), 0), { reps }));
    assert.deepEqual(errors(analysis), ['Linha 1: no Intervalado use uma quantidade por movimento (o round se repete).'], reps);
  }
  assert.deepEqual(errors(analyzeDraft(updateLine(reference(), 'interval', ivKey(reference(), 0), { reps: '100' }))), ['Linha 1: cada quantidade vai de 1 a 99 repetições.']);

  // 10 fixos (só por fora do botão, que para em 9): erro de limite.
  const ten = reference();
  const lines = Array.from({ length: 10 }, (_, index) => ({ key: `x${index}`, reps: '1', name: `M${index}`, load: '', mark: 'reps', note: '' }));
  assert.deepEqual(errors(analyzeDraft({ ...ten, interval: { ...ten.interval, lines } })), ['Movimentos fixos: de 0 a 9.']);
  const nine = analyzeDraft({ ...ten, interval: { ...ten.interval, lines: lines.slice(0, 9) } });
  assert.equal(nine.structure.segments.length, 9);
  assert.equal(nine.items[1].text, '9 movimentos fixos (9 repetições por round)');

  // 0 fixos: o "máximo a cada intervalo".
  let none = reference();
  none = removeLine(removeLine(none, 'interval', ivKey(none, 1)), 'interval', ivKey(none, 0));
  analysis = analyzeDraft(none);
  assert.deepEqual(analysis.problems, []);
  assert.equal(analysis.items[1].text, 'Nenhum movimento fixo');
  assert.deepEqual([analysis.structure.segments, analysis.structure.totalReps], [[], 0]);
  assert.equal(validateWorkoutStructure(analysis.structure).ok, true);

  // Um fixo, sem carga no máximo, OFF em 00:00 (EMOM).
  let emom = updateIntervalTiming(removeLine(reference(), 'interval', ivKey(reference(), 1)), { rounds: '10', on: '01:00', off: '00:00' });
  emom = updateIntervalMax(emom, { load: '' });
  analysis = analyzeDraft(emom);
  assert.deepEqual(analysis.items.map((item) => item.text), [
    '10 rounds de 01:00 de trabalho, sem descanso · 10:00 no total',
    '1 movimento fixo (6 repetições por round)',
    '1 movimento máximo: Squat Clean',
    'Sem desempate (opcional)'
  ]);
  assert.deepEqual([analysis.structure.timeCapSeconds, analysis.structure.interval.offSeconds, analysis.structure.interval.max.load], [600, 0, null]);
  assert.equal(validateWorkoutStructure(analysis.structure).ok, true);
});

test('Intervalado: frase da regra (exemplo, OFF em 00:00 e 0 fixos) e resumo da prova', () => {
  const structure = analyzeDraft(reference()).structure;
  assert.equal(
    strongText(structure),
    'São [5 rounds] de [02:00] de trabalho, com [02:00] de descanso entre eles ([18:00] no total). Em cada round o atleta faz [6 Ring Muscle Ups] e [15 Box Jump Overs (24/20 in)] e, com o tempo que sobrar, o máximo de [Squat Clean 80 kg]. Vale a [soma das repetições de Squat Clean] dos rounds. Round em que os movimentos fixos não terminam dentro da janela vale 0. Sem desempate: empates dividem a posição.'
  );
  assert.equal(summarizeStructure(structure), 'Intervalado · 5 rounds · 02:00 ON / 02:00 OFF · 18:00');

  const emom = analyzeDraft(updateIntervalTiming(reference(), { rounds: '20', on: '04:00', off: '00:00' })).structure;
  assert.match(strongText(emom), /^São \[20 rounds\] de \[04:00\] de trabalho, sem descanso entre eles \(\[80:00\] no total\)\. /);
  assert.equal(summarizeStructure(emom), 'Intervalado · 20 rounds · 04:00 ON / 00:00 OFF · 80:00');

  let none = reference();
  none = removeLine(removeLine(none, 'interval', ivKey(none, 1)), 'interval', ivKey(none, 0));
  assert.equal(
    strongText(analyzeDraft(none).structure),
    'São [5 rounds] de [02:00] de trabalho, com [02:00] de descanso entre eles ([18:00] no total). Em cada round o atleta faz o máximo de [Squat Clean 80 kg]. Vale a [soma das repetições de Squat Clean] dos rounds. Sem desempate: empates dividem a posição.'
  );

  // Três fixos, com unidade e carga, separados por vírgula e "e".
  let three = addLine(reference(), 'interval');
  three = updateLine(three, 'interval', ivKey(three, 2), { reps: '10 cal', name: 'Bike' });
  three = updateLine(three, 'interval', ivKey(three, 0), { load: '20' });
  assert.match(strongText(analyzeDraft(three).structure), /faz \[6 Ring Muscle Ups 20 kg\], \[15 Box Jump Overs \(24\/20 in\)\] e \[10 cal de Bike\] e, com o tempo/);

  // A frase e o resumo saem da estrutura gravada (do servidor), não do rascunho.
  const stored = validateWorkoutStructure(structuredClone(structure)).structure;
  assert.deepEqual(describeStructureRule(stored), describeStructureRule(structure));
  assert.equal(summarizeStructure(stored), summarizeStructure(structure));
});

test('Intervalado: editar a prova gravada volta ao rascunho e gera a mesma estrutura; o que não cabe é avisado', () => {
  const cases = [reference()];
  let none = reference();
  none = removeLine(removeLine(none, 'interval', ivKey(none, 1)), 'interval', ivKey(none, 0));
  cases.push(updateIntervalTiming(none, { off: '00:00', rounds: '12', on: '00:45' }));
  let units = updateLine(reference(), 'interval', ivKey(reference(), 0), { reps: '500 m', name: 'Remo', note: 'damper 5' });
  units = updateLine(units, 'interval', ivKey(units, 1), { reps: '12 cal', name: 'Bike', mark: 'end' });
  cases.push(updateIntervalMax(units, { load: '42,5', note: 'até a coxa paralela' }));

  for (const draft of cases) {
    const original = analyzeDraft(draft).structure;
    assert.ok(original, JSON.stringify(analyzeDraft(draft).problems));
    const loaded = draftFromStructure(original);
    assert.equal(loaded.ok, true);
    assert.equal(loaded.draft.format, 'interval');
    assert.deepEqual(analyzeDraft(loaded.draft).structure, original, 'ida e volta idempotente');
    const again = draftFromStructure(analyzeDraft(loaded.draft).structure);
    assert.deepEqual(analyzeDraft(again.draft).structure, original);
  }

  const loaded = draftFromStructure(analyzeDraft(reference()).structure).draft;
  assert.deepEqual([loaded.interval.rounds, loaded.interval.on, loaded.interval.off], ['5', '02:00', '02:00']);
  assert.deepEqual(loaded.interval.lines.map((line) => [line.reps, line.name, line.load]), [['6', 'Ring Muscle Ups', ''], ['15', 'Box Jump Overs (24/20 in)', '']]);
  assert.deepEqual([loaded.interval.max.name, loaded.interval.max.load, loaded.interval.max.note], ['Squat Clean', '80', '']);
  const keys = [...loaded.interval.lines.map((line) => line.key), loaded.interval.max.key];
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.every((key) => Number(key.slice(1)) < loaded.nextKey), 'a próxima linha não repete chave');
  const unitsLoaded = draftFromStructure(analyzeDraft(cases[2]).structure).draft;
  assert.deepEqual(unitsLoaded.interval.lines.map((line) => [line.reps, line.mark, line.note]), [['500 m', 'end', 'damper 5'], ['12 cal', 'end', '']]);
  assert.equal(unitsLoaded.interval.max.load, '42,5');
  assert.equal(draftFromStructure(analyzeDraft(cases[1]).structure).draft.interval.off, '00:00');

  // O servidor aceita mais do que o construtor gera (R3): um fixo opcional (required false) não cabe nas linhas.
  const structure = analyzeDraft(reference()).structure;
  const optional = { ...structure, segments: structure.segments.map((item, index) => (index === 0 ? { ...item, required: false } : item)) };
  assert.equal(validateWorkoutStructure(optional).ok, true, 'o servidor aceita');
  const result = draftFromStructure(optional);
  assert.equal(result.ok, false);
  assert.match(result.error, /montada etapa por etapa e não cabe em linhas/);
  // Ids gravados diferentes dos do construtor (f1, f2...) ainda cabem: o rascunho guarda o conteúdo.
  const otherIds = { ...structure, segments: structure.segments.map((item, index) => ({ ...item, id: `f${index + 1}` })) };
  assert.equal(validateWorkoutStructure(otherIds).ok, true);
  assert.equal(draftFromStructure(otherIds).ok, true);
});

test('Intervalado: operações das linhas (limite de 9 fixos, remover até zero, mover) e do máximo, sem mutar', () => {
  const draft = deepFreeze(reference());
  let full = draft;
  for (let index = 0; index < 12; index += 1) full = addLine(full, 'interval');
  assert.equal(full.interval.lines.length, MAX_INTERVAL_FIXED_LINES, 'o botão "Movimento" para em 9');
  assert.equal(addLine(full, 'interval'), full);
  assert.equal(addLine(draft, 'interval').interval.lines[2].reps, '', 'a linha nova vem vazia, como no AMRAP');

  const one = removeLine(draft, 'interval', ivKey(draft, 0));
  assert.deepEqual(one.interval.lines.map((line) => line.name), ['Box Jump Overs (24/20 in)']);
  const zero = removeLine(one, 'interval', ivKey(one, 0));
  assert.equal(zero.interval.lines.length, 0);
  assert.equal(removeLine(zero, 'interval', 'inexistente'), zero);
  assert.equal(removeLine(draft, 'interval', draft.interval.max.key), draft, 'o máximo não sai pela lista dos fixos');

  const moved = moveLine(draft, 'interval', ivKey(draft, 1), 'up');
  assert.deepEqual(analyzeDraft(moved).structure.segments.map((item) => item.name), ['Box Jump Overs (24/20 in)', 'Ring Muscle Ups']);
  assert.equal(moveLine(draft, 'interval', ivKey(draft, 1), 'down'), draft, 'o último fixo não desce para depois do máximo');

  const renamed = updateIntervalMax(draft, { name: 'Power Clean' });
  assert.equal(renamed.interval.max.name, 'Power Clean');
  assert.equal(renamed.interval.lines, draft.interval.lines);
  assert.equal(renamed.forTime, draft.forTime);
  assert.equal(updateIntervalTiming(draft, { rounds: '7' }).interval.rounds, '7');
  assert.equal(draft.interval.max.name, 'Squat Clean', 'não muta');
});

test('Intervalado: tudo que o construtor gera passa no validador do servidor (rascunhos aleatórios)', () => {
  const words = ['Thruster', 'Pull-up', 'Burpee', 'Remo', 'Bike', 'Wall ball', 'Squat Clean'];
  const repsTexts = ['10', '6', '15', '500 m', '30 cal', '1', '99', '21-15-9', ''];
  const times = ['00:30', '01:00', '02:00', '00:00', '03:30', '30:00', '10', '00:20'];
  let seed = 11;
  const random = (max) => {
    seed = (seed * 48271) % 2147483647;
    return seed % max;
  };
  let produced = 0;
  for (let round = 0; round < 200; round += 1) {
    let draft = updateIntervalTiming(createDraft('interval'), {
      rounds: String(1 + random(22)), on: times[random(times.length)], off: times[random(times.length)]
    });
    const fixed = random(5);
    if (fixed === 0) draft = removeLine(draft, 'interval', ivKey(draft, 0));
    for (let index = 0; index < fixed; index += 1) {
      if (index > 0) draft = addLine(draft, 'interval');
      draft = updateLine(draft, 'interval', ivKey(draft, index), {
        name: words[random(words.length)], reps: repsTexts[random(repsTexts.length)], load: random(2) ? `${random(120)},5` : '', mark: random(4) ? 'reps' : 'end'
      });
    }
    draft = updateIntervalMax(draft, { name: random(8) ? words[random(words.length)] : '', load: random(2) ? String(random(200)) : '' });
    const analysis = analyzeDraft(draft);
    if (analysis.structure) {
      produced += 1;
      const checked = validateWorkoutStructure(analysis.structure);
      assert.equal(checked.ok, true, checked.error);
      assert.deepEqual(checked.structure, analysis.structure, 'já sai normalizada');
      assert.deepEqual(analyzeDraft(draftFromStructure(analysis.structure).draft).structure, analysis.structure, 'ida e volta');
    } else {
      assert.ok(analysis.problems.length > 0, 'sem estrutura, há um problema a corrigir');
    }
  }
  assert.ok(produced > 40, `rascunhos válidos: ${produced}`);
});

// ---------------------------------------------------------------------------
// Story 1.67: Distância (docs/design/distancia/): duração e resumo opcional
// ---------------------------------------------------------------------------

const distanceDraft = (patch = {}) => {
  const draft = setDraftFormat(createDraft('for_time'), 'distance');
  return { ...draft, distance: { ...draft.distance, ...patch } };
};

test('Distância: o rascunho novo abre com 20:00 e resumo vazio; o time cap legível do formulário vira a duração', () => {
  const draft = createDraft('distance');
  assert.deepEqual(draft.distance, { duration: '20:00', note: '' });
  assert.equal(editor.DEFAULT_TIME_CAP_SECONDS.distance, 1200);
  assert.equal(createDraft('distance', { timeCap: '15:00' }).distance.duration, '15:00');
  assert.equal(createDraft('distance', { timeCap: '99:99' }).distance.duration, '20:00', 'ilegível: fica o padrão');
  assert.equal(createDraft('for_time', { timeCap: '15:00' }).distance.duration, '20:00', 'só vale quando o formato é a distância');
  assert.equal(setDraftFormat(createDraft('amrap'), 'distance').format, 'distance');
});

test('Distância: a estrutura gerada é a v4 válida, sem segmentos e sem desempate, e a conferência diz o que foi lido', () => {
  const analysis = analyzeDraft(distanceDraft({ note: '  750 m corrida; máx. distância no remo.  ' }));
  assert.deepEqual(analysis.problems, []);
  assert.deepEqual(analysis.items, [
    { tone: 'ok', text: 'Duração: 20:00' },
    { tone: 'ok', text: 'Resultado em metros, maior vence' },
    { tone: 'muted', text: 'Sem desempate nesta versão' },
    { tone: 'ok', text: 'Resumo para o judge preenchido' }
  ]);
  assert.deepEqual(analysis.steps, []);
  const { structure } = analysis;
  assert.deepEqual(structure, {
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
    distance: { unit: 'm', note: '750 m corrida; máx. distância no remo.' }
  });
  const checked = validateWorkoutStructure(structure);
  assert.equal(checked.ok, true, checked.error);
  assert.deepEqual(checked.structure, structure, 'já sai normalizada');
  // Decisão 6: o painel grava o tipo legado distance, com a duração como time cap e sem desempate.
  assert.deepEqual(deriveLegacyWorkoutFields(structure), { type: 'distance', timeCap: '20:00', tieBreaker: '' });

  const empty = analyzeDraft(distanceDraft());
  assert.deepEqual(empty.items.at(-1), { tone: 'muted', text: 'Resumo para o judge: opcional, vazio' });
  assert.equal(empty.structure.distance.note, '');
});

test('Distância: duração fora de 00:30 a 99:59 e resumo acima de 300 caracteres são problemas marcados no campo, sem estrutura', () => {
  for (const duration of ['00:29', '100:00', '', 'abc', '2000', '20:60']) {
    const analysis = analyzeDraft(distanceDraft({ duration }));
    assert.equal(analysis.structure, null, duration);
    assert.deepEqual(errors(analysis), ['Duração: use MM:SS entre 00:30 e 99:59.'], duration);
    assert.equal(analysis.lineProblems[editor.DISTANCE_FIELDS.duration], 'Duração: use MM:SS entre 00:30 e 99:59.', duration);
  }
  assert.equal(analyzeDraft(distanceDraft({ duration: '20' })).structure.timeCapSeconds, 1200, 'só minutos vale como no AMRAP');
  for (const duration of ['00:30', '99:59', '1:00:00']) {
    const analysis = analyzeDraft(distanceDraft({ duration }));
    assert.notEqual(analysis.structure, null, duration);
  }
  assert.equal(analyzeDraft(distanceDraft({ note: 'x'.repeat(300) })).structure.distance.note.length, 300);
  const long = analyzeDraft(distanceDraft({ note: 'x'.repeat(301) }));
  assert.equal(long.structure, null);
  assert.deepEqual(errors(long), ['Resumo da prova: até 300 caracteres (tem 301).']);
  assert.equal(long.lineProblems[editor.DISTANCE_FIELDS.note], 'Resumo da prova: até 300 caracteres (tem 301).');
  // Espaços nas pontas não contam para o limite.
  assert.notEqual(analyzeDraft(distanceDraft({ note: `  ${'x'.repeat(300)}  ` })).structure, null);
});

test('Distância: frase da regra, resumo da lista e ida e volta pela estrutura gravada', () => {
  const structure = analyzeDraft(distanceDraft({ duration: '15:00', note: 'Corrida' })).structure;
  assert.equal(ruleText(structure), 'Vale a maior distância total em 15:00. O judge informa o total em metros. Empates dividem a posição, sem desempate.');
  const parts = describeStructureRule(structure);
  assert.deepEqual(parts.filter((part) => part.strong).map((part) => part.text), ['maior distância total', '15:00']);
  assert.equal(summarizeStructure(structure), 'Distância · 15:00 · maior vence');

  const reopened = draftFromStructure(structure);
  assert.equal(reopened.ok, true);
  assert.equal(reopened.draft.format, 'distance');
  assert.deepEqual(reopened.draft.distance, { duration: '15:00', note: 'Corrida' });
  assert.deepEqual(analyzeDraft(reopened.draft).structure, structure, 'ida e volta');
  // A estrutura de outro formato segue como estava, e uma distância sem o campo não cabe em linhas.
  assert.equal(draftFromStructure({ ...structure, distance: null }).ok, false);
  assert.equal(draftFromStructure(fran().structure ?? analyzeDraft(fran()).structure).ok, true);
  // Editar a duração gera outra estrutura válida com o time cap novo.
  const edited = analyzeDraft({ ...reopened.draft, distance: { ...reopened.draft.distance, duration: '12:30' } }).structure;
  assert.deepEqual([edited.timeCapSeconds, deriveLegacyWorkoutFields(edited).timeCap], [750, '12:30']);
});

test('Distância: o rascunho dos outros formatos não muda ao trocar de formato e voltar', () => {
  let draft = fran();
  const before = JSON.stringify(analyzeDraft(draft).structure);
  draft = setDraftFormat(draft, 'distance');
  draft = { ...draft, distance: { duration: '10:00', note: 'x' } };
  draft = setDraftFormat(draft, 'for_time');
  assert.equal(JSON.stringify(analyzeDraft(draft).structure), before);
  assert.deepEqual(draft.distance, { duration: '10:00', note: 'x' }, 'o rascunho da distância fica guardado');
});
