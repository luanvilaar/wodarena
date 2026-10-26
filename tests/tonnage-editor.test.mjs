import assert from 'node:assert/strict';
import test from 'node:test';

import { importServerModule } from './support/serverModuleHarness.mjs';

// Story 1.79: construtor da Tonelagem (docs/design/tonelagem/tonelagem-aprovado.html).
// A lista de exercícios na ordem da prova, o que conta marcado em qualquer
// posição, a origem da carga, o incremento e o time cap obrigatório. Tudo que o
// construtor gera passa em validateWorkoutStructure, o mesmo validador do servidor.

const editor = await importServerModule('lib/workoutStructureEditor.ts');
const { validateWorkoutStructure, deriveLegacyWorkoutFields } = await importServerModule('lib/workoutStructure.ts');

const {
  addLine, analyzeDraft, createDraft, describeStructureRule, draftFromStructure, moveLine, removeLine, setDraftFormat,
  setTonnageLift, summarizeStructure, updateLine, updateTonnage, MAX_TONNAGE_LINES, TONNAGE_FIELDS, TONNAGE_LIFT_ID
} = editor;

const ruleText = (structure) => describeStructureRule(structure).map((part) => part.text).join('');
const errors = (analysis) => analysis.items.filter((item) => item.tone === 'error').map((item) => item.text);
const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
};

// Treino 1: 10 Pull Ups e 10 Burpees liberam, Squat Clean conta (time cap de 10:00).
const treino1 = (patch = {}) => {
  let draft = setDraftFormat(createDraft('for_time'), 'tonnage');
  const [first] = draft.tonnage.lines;
  draft = updateLine(draft, 'tonnage', first.key, { reps: '10', name: 'Pull Ups' });
  draft = addLine(draft, 'tonnage');
  draft = updateLine(draft, 'tonnage', draft.tonnage.lines[1].key, { reps: '10', name: 'Burpees' });
  draft = addLine(draft, 'tonnage');
  const lift = draft.tonnage.lines[2];
  draft = updateLine(draft, 'tonnage', lift.key, { name: 'Squat Clean' });
  draft = setTonnageLift(draft, lift.key);
  return updateTonnage(draft, { duration: '10:00', ...patch });
};
// O primeiro marcado como o que conta: Burpees e Squat Clean ficam depois (precisam de quantidade).
const treino1PrimeiroConta = () => {
  const draft = treino1();
  const [first, , third] = draft.tonnage.lines;
  return updateLine(setTonnageLift(draft, first.key), 'tonnage', third.key, { reps: '5' });
};
// Treino 2: um exercício só (time cap de 03:00).
const treino2 = (patch = {}) => {
  let draft = setDraftFormat(createDraft('for_time'), 'tonnage');
  draft = updateLine(draft, 'tonnage', draft.tonnage.lines[0].key, { name: 'Squat Snatch' });
  return updateTonnage(draft, { duration: '03:00', ...patch });
};

test('Tonelagem: o rascunho novo abre com uma linha marcada, carga livre, carga travada e time cap vazio (obrigatório)', () => {
  const draft = createDraft('tonnage');
  assert.equal(draft.format, 'tonnage');
  assert.equal(draft.tonnage.lines.length, 1);
  assert.equal(draft.tonnage.liftKey, draft.tonnage.lines[0].key);
  assert.deepEqual(
    [draft.tonnage.loadMode, draft.tonnage.prescribed, draft.tonnage.incrementAllowed, draft.tonnage.step, draft.tonnage.duration, draft.tonnage.note],
    ['athlete', '', false, '2,5', '', '']
  );
  assert.equal(createDraft('tonnage', { timeCap: '03:00' }).tonnage.duration, '03:00', 'o time cap legível do formulário vira o inicial');
  assert.equal(createDraft('tonnage', { timeCap: '99:99' }).tonnage.duration, '', 'ilegível: continua vazio');
  assert.equal(createDraft('for_time', { timeCap: '03:00' }).tonnage.duration, '', 'só vale quando o formato é a tonelagem');
  const keys = new Set(['k1', 'k2', 'k3', 'k4', 'k5']);
  assert.equal(keys.has(draft.tonnage.lines[0].key), false, 'a chave da linha não repete a dos outros formatos');
  assert.equal(setDraftFormat(createDraft('amrap'), 'tonnage').format, 'tonnage');
});

test('Tonelagem: o time cap é obrigatório; vazio ou fora de 00:30 a 99:59 não gera estrutura', () => {
  for (const duration of ['', '   ']) {
    const analysis = analyzeDraft(treino1({ duration }));
    assert.equal(analysis.structure, null);
    assert.deepEqual(errors(analysis), ['Time cap: informe o tempo da prova, de 00:30 a 99:59 (obrigatório).']);
    assert.equal(analysis.lineProblems[TONNAGE_FIELDS.duration], errors(analysis)[0]);
  }
  for (const duration of ['00:29', '100:00', 'abc', '10:75']) {
    const analysis = analyzeDraft(treino1({ duration }));
    assert.equal(analysis.structure, null, duration);
    assert.equal(errors(analysis).length, 1, duration);
    assert.ok(analysis.lineProblems[TONNAGE_FIELDS.duration], duration);
  }
  assert.equal(analyzeDraft(treino1({ duration: '00:30' })).structure.timeCapSeconds, 30);
  assert.equal(analyzeDraft(treino1({ duration: '99:59' })).structure.timeCapSeconds, 5999);
});

test('Tonelagem: o Treino 1 gera a estrutura v5 válida (liberação, exercício que conta e conferência)', () => {
  const analysis = analyzeDraft(treino1());
  assert.deepEqual(analysis.problems, []);
  assert.deepEqual(analysis.items, [
    { tone: 'ok', text: 'Exercício que conta: Squat Clean' },
    { tone: 'ok', text: '2 exercícios liberam o atleta (não contam ponto)' },
    { tone: 'ok', text: 'Carga livre: o judge informa antes de iniciar' },
    { tone: 'ok', text: 'Carga travada durante o treino' },
    { tone: 'ok', text: 'Time cap: 10:00' }
  ]);
  const { structure } = analysis;
  assert.equal(structure.version, 5);
  assert.equal(structure.format, 'tonnage');
  assert.equal(structure.timeCapSeconds, 600);
  assert.equal(structure.totalReps, 20);
  assert.deepEqual(structure.segments.map((segment) => [segment.id, segment.name, segment.reps, segment.unit, segment.round, segment.required, segment.mark]), [
    ['s1', 'Pull Ups', 10, 'reps', 1, true, 'reps'],
    ['s2', 'Burpees', 10, 'reps', 1, true, 'reps']
  ]);
  assert.deepEqual(structure.tonnage, {
    position: 2,
    lift: { id: TONNAGE_LIFT_ID, name: 'Squat Clean', loadKg: null, note: '' },
    loadMode: 'athlete',
    increment: { allowed: false, stepKg: 2.5 },
    note: ''
  });
  assert.deepEqual([structure.tieBreak, structure.incomplete, structure.generator, structure.interval, structure.distance, structure.maxLoad, structure.customized], [null, null, null, null, null, null, true]);
  const checked = validateWorkoutStructure(structure);
  assert.equal(checked.ok, true, checked.error);
  assert.deepEqual(checked.structure, structure, 'já sai normalizada');
  assert.deepEqual(deriveLegacyWorkoutFields(structure), { type: 'tonnage', timeCap: '10:00', tieBreaker: '' });
});

test('Tonelagem: o Treino 2 (um exercício só, 03:00) gera a estrutura sem liberação', () => {
  const analysis = analyzeDraft(treino2());
  assert.deepEqual(analysis.problems, []);
  assert.equal(analysis.items[1].text, 'Sem exercícios de liberação');
  assert.deepEqual(analysis.structure.segments, []);
  assert.equal(analysis.structure.tonnage.position, 0);
  assert.equal(analysis.structure.totalReps, 0);
  assert.equal(analysis.structure.timeCapSeconds, 180);
});

test('Tonelagem: o exercício que conta pode estar em qualquer posição; os de antes liberam e os de depois só aparecem', () => {
  let draft = treino1();
  const [first, second, third] = draft.tonnage.lines;
  // Marcar o do meio: Pull Ups libera, Squat Clean (já era o terceiro) fica depois.
  draft = setTonnageLift(draft, second.key);
  draft = updateLine(draft, 'tonnage', third.key, { reps: '12', name: 'Squat Clean' });
  const middle = analyzeDraft(draft);
  assert.deepEqual(middle.problems, []);
  assert.equal(middle.structure.tonnage.position, 1);
  assert.equal(middle.structure.tonnage.lift.name, 'Burpees');
  assert.deepEqual(middle.structure.segments.map((segment) => segment.name), ['Pull Ups', 'Squat Clean']);
  assert.equal(middle.structure.totalReps, 22);
  assert.ok(middle.items.some((item) => item.text === '1 exercício depois da tonelagem: não conta nem trava'));
  // Marcar o primeiro: nada libera, os dois outros ficam depois.
  const firstMarked = analyzeDraft(setTonnageLift(draft, first.key));
  assert.equal(firstMarked.structure.tonnage.position, 0);
  assert.equal(firstMarked.structure.tonnage.lift.name, 'Pull Ups');
  assert.equal(setTonnageLift(draft, 'inexistente'), draft, 'chave desconhecida não muda nada');
  // Mover as linhas muda a posição.
  const moved = moveLine(treino1(), 'tonnage', treino1().tonnage.liftKey, 'up');
  assert.equal(analyzeDraft(moved).structure.tonnage.position, 1);
});

test('Tonelagem: o exercício que conta não se remove; os outros saem; o limite é de 10 linhas', () => {
  let draft = treino1();
  const liftKey = draft.tonnage.liftKey;
  assert.equal(removeLine(draft, 'tonnage', liftKey), draft, 'marque outro antes de remover');
  const without = removeLine(draft, 'tonnage', draft.tonnage.lines[0].key);
  assert.equal(without.tonnage.lines.length, 2);
  assert.equal(analyzeDraft(without).structure.tonnage.position, 1);
  for (let index = 0; index < 20; index += 1) draft = addLine(draft, 'tonnage');
  assert.equal(draft.tonnage.lines.length, MAX_TONNAGE_LINES);
  assert.equal(MAX_TONNAGE_LINES, 10);
  assert.equal(addLine(draft, 'tonnage'), draft);
});

test('Tonelagem: cada linha de liberação exige nome e uma quantidade; o exercício que conta só o nome', () => {
  let draft = treino1();
  const [first, second] = draft.tonnage.lines;
  draft = updateLine(draft, 'tonnage', first.key, { reps: '' });
  draft = updateLine(draft, 'tonnage', second.key, { reps: '21-15-9', name: '' });
  const analysis = analyzeDraft(draft);
  assert.equal(analysis.structure, null);
  assert.deepEqual(errors(analysis), [
    'Linha 1: informe as repetições.',
    'Linha 2: informe o movimento.'
  ]);
  assert.deepEqual(Object.keys(analysis.lineProblems).sort(), [first.key, second.key].sort());
  // Sequência de rounds não vale aqui (uma quantidade por exercício).
  const sequence = analyzeDraft(updateLine(treino1(), 'tonnage', first.key, { reps: '21-15-9' }));
  assert.equal(sequence.structure, null);
  assert.deepEqual(errors(sequence), ['Linha 1: na Tonelagem use uma quantidade por exercício.']);
  // O que conta: nome obrigatório, repetições e carga da linha não entram na conta.
  const noName = analyzeDraft(updateLine(treino1(), 'tonnage', treino1().tonnage.liftKey, { name: '  ' }));
  assert.equal(noName.structure, null);
  assert.deepEqual(errors(noName), ['Linha 3: informe o movimento.']);
  const ignored = analyzeDraft(updateLine(treino1(), 'tonnage', treino1().tonnage.liftKey, { reps: 'lixo', load: 'lixo' }));
  assert.deepEqual(ignored.problems, []);
  // Metros e calorias valem na liberação; em metros o judge só conclui o bloco.
  const run = analyzeDraft(updateLine(treino1(), 'tonnage', first.key, { reps: '400 m', name: 'Corrida' }));
  assert.equal(run.structure.segments[0].unit, 'm');
  assert.equal(run.structure.segments[0].mark, 'end');
});

test('Tonelagem: carga prescrita exige kg de 0,25 a 500 em múltiplos de 0,25; carga livre ignora o campo', () => {
  const ok = analyzeDraft(treino2({ loadMode: 'prescribed', prescribed: '42,5' }));
  assert.deepEqual(ok.problems, []);
  assert.deepEqual([ok.structure.tonnage.loadMode, ok.structure.tonnage.lift.loadKg], ['prescribed', 42.5]);
  assert.ok(ok.items.some((item) => item.text === 'Carga prescrita: 42,5 kg'));
  for (const typed of ['', '0', '501', '60,3', 'abc']) {
    const analysis = analyzeDraft(treino2({ loadMode: 'prescribed', prescribed: typed }));
    assert.equal(analysis.structure, null, typed);
    assert.match(errors(analysis)[0], /^Carga prescrita: de 0,25 a 500 kg, em múltiplos de 0,25/, typed);
    assert.ok(analysis.lineProblems[TONNAGE_FIELDS.prescribed], typed);
  }
  const free = analyzeDraft(treino2({ loadMode: 'athlete', prescribed: 'lixo' }));
  assert.deepEqual(free.problems, []);
  assert.equal(free.structure.tonnage.lift.loadKg, null);
});

test('Tonelagem: o incremento é permitido ou não; o passo só vale (e só dá erro) quando permitido', () => {
  const allowed = analyzeDraft(treino2({ incrementAllowed: true, step: '5' }));
  assert.deepEqual(allowed.problems, []);
  assert.deepEqual(allowed.structure.tonnage.increment, { allowed: true, stepKg: 5 });
  assert.ok(allowed.items.some((item) => item.text === 'Incremento permitido, de 5 em 5 kg'));
  assert.equal(analyzeDraft(treino2({ incrementAllowed: true, step: '0,25' })).structure.tonnage.increment.stepKg, 0.25);
  assert.equal(analyzeDraft(treino2({ incrementAllowed: true, step: '25' })).structure.tonnage.increment.stepKg, 25);
  for (const typed of ['', '0', '26', '2,6', 'abc']) {
    const analysis = analyzeDraft(treino2({ incrementAllowed: true, step: typed }));
    assert.equal(analysis.structure, null, typed);
    assert.match(errors(analysis)[0], /^Incremento: de 0,25 a 25 kg, em múltiplos de 0,25\.$/, typed);
    assert.ok(analysis.lineProblems[TONNAGE_FIELDS.step], typed);
  }
  // Travado: o passo digitado não atrapalha e a estrutura leva o padrão válido.
  const locked = analyzeDraft(treino2({ incrementAllowed: false, step: 'lixo' }));
  assert.deepEqual(locked.problems, []);
  assert.deepEqual(locked.structure.tonnage.increment, { allowed: false, stepKg: 2.5 });
});

test('Tonelagem: o resumo da prova é opcional e tem até 300 caracteres', () => {
  const noted = analyzeDraft(treino1({ note: '  10 Pull Ups; 10 Burpees; Max. Squat Clean  ' }));
  assert.equal(noted.structure.tonnage.note, '10 Pull Ups; 10 Burpees; Max. Squat Clean');
  assert.deepEqual(noted.problems, []);
  const long = analyzeDraft(treino1({ note: 'x'.repeat(301) }));
  assert.equal(long.structure, null);
  assert.equal(errors(long)[0], 'Resumo da prova: até 300 caracteres (tem 301).');
  assert.ok(long.lineProblems[TONNAGE_FIELDS.note]);
});

test('Tonelagem: ida e volta pela estrutura gravada (editar a prova) e rascunhos variados', () => {
  const variants = [
    treino1(),
    treino2(),
    treino1({ loadMode: 'prescribed', prescribed: '60', incrementAllowed: true, step: '10', note: 'x' }),
    treino1PrimeiroConta(),
    updateLine(treino1(), 'tonnage', treino1().tonnage.lines[0].key, { reps: '400 m', name: 'Corrida' })
  ];
  for (const draft of variants) {
    const analysis = analyzeDraft(draft);
    assert.deepEqual(analysis.problems, []);
    const back = draftFromStructure(analysis.structure);
    assert.equal(back.ok, true, back.error);
    assert.equal(back.draft.format, 'tonnage');
    assert.deepEqual(analyzeDraft(back.draft).structure, analysis.structure, 'ida e volta');
    assert.equal(back.draft.tonnage.lines.length, analysis.structure.segments.length + 1);
    assert.equal(back.draft.tonnage.lines.findIndex((line) => line.key === back.draft.tonnage.liftKey), analysis.structure.tonnage.position);
  }
  // Prova gravada com algo que o construtor não gera (exercício não obrigatório, rodada 2): não cabe em linhas.
  const base = analyzeDraft(treino1()).structure;
  for (const patch of [
    { segments: base.segments.map((segment) => ({ ...segment, required: false })) },
    { segments: base.segments.map((segment) => ({ ...segment, round: 1 })).slice(0, 1).map((segment) => ({ ...segment, round: 2 })), totalReps: 10, tonnage: { ...base.tonnage, position: 1 } },
    { tonnage: null }
  ]) {
    const checked = draftFromStructure({ ...base, ...patch });
    assert.equal(checked.ok, false);
    assert.match(checked.error, /não cabe em linhas/);
  }
});

test('Tonelagem: a regra em uma frase e o resumo da lista dizem o que foi configurado', () => {
  const t1 = analyzeDraft(treino1({ incrementAllowed: true, step: '2,5', note: '' })).structure;
  assert.equal(
    ruleText(t1),
    'Para liberar o atleta: 10 Pull Ups e 10 Burpees (não contam ponto). A tonelagem é a soma de carga × repetições válidas de Squat Clean. Carga livre, informada pelo judge antes de iniciar. A carga pode subir de 2,5 em 2,5 kg. Time cap da prova: 10:00. Mesma tonelagem divide a posição.'
  );
  const t2 = analyzeDraft(treino2({ loadMode: 'prescribed', prescribed: '60' })).structure;
  assert.equal(
    ruleText(t2),
    'A tonelagem é a soma de carga × repetições válidas de Squat Snatch. Carga prescrita: 60 kg. A carga fica travada. Time cap da prova: 03:00. Mesma tonelagem divide a posição.'
  );
  const after = analyzeDraft(treino1PrimeiroConta()).structure;
  assert.match(ruleText(after), /Depois da tonelagem \(não conta, não trava\): 10 Burpees, 5 Squat Clean\./);
  assert.equal(summarizeStructure(t1), 'Tonelagem · Squat Clean · 3 exercícios · cap 10:00');
  assert.equal(summarizeStructure(t2), 'Tonelagem · Squat Snatch · 1 exercício · cap 03:00');
});

test('Tonelagem: o construtor é puro (não muda o rascunho recebido) e a estrutura passa no validador do servidor', () => {
  const draft = deepFreeze(treino1({ loadMode: 'prescribed', prescribed: '60' }));
  const first = analyzeDraft(draft);
  const second = analyzeDraft(draft);
  assert.deepEqual(first, second);
  assert.equal(validateWorkoutStructure(first.structure).ok, true);
  assert.equal(removeLine(draft, 'tonnage', draft.tonnage.lines[0].key).tonnage.lines.length, 2);
  assert.equal(draft.tonnage.lines.length, 3, 'o rascunho congelado não mudou');
  assert.equal(updateTonnage(draft, { duration: '05:00' }).tonnage.duration, '05:00');
});
