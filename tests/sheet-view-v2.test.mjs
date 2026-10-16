import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { importServerModule } from './support/serverModuleHarness.mjs';

// Stories 1.47 e 1.48: a súmula do judge para carga máxima (uma tentativa por
// vez, válida ou no-rep) e para metros e calorias, mais os desempates pelo
// último marco concluído e pelo último round completo. Aqui ficam o modelo de
// tela, a renderização de servidor e a regressão estática; o toque foi
// conferido no navegador.

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const {
  buildMaxLoadResultSummary, buildMaxLoadViewModel, buildResultSummary, buildSheetViewModel, findUndoTarget
} = await importServerModule('lib/sheetView.ts');
const {
  computeMaxLoadResult, computeSheetResult, deriveMaxLoadState, deriveSheetState, validateWorkoutStructure
} = await importServerModule('lib/workoutStructure.ts');
const { SheetView } = await importServerModule('components/sheet/SheetView.tsx');

const segment = (id, round, name, reps, extra = {}) => ({
  id, round, name, reps, unit: 'reps', load: null, note: '', required: true, mark: 'reps', ...extra
});
const base = { version: 2, generator: null, customized: true, entry: { mode: 'both', marking: 'reps', publish: 'after_review' }, maxLoad: null, scoreDisplay: null };
const valid = (input) => {
  const checked = validateWorkoutStructure(input);
  assert.equal(checked.ok, true, checked.error);
  return checked.structure;
};

const UNITS = valid({
  ...base, format: 'for_time', totalReps: 550, timeCapSeconds: 900,
  incomplete: { rule: 'penalty_per_rep', secondsPerRep: 1, base: 'time_cap' },
  tieBreak: { kind: 'last_split', at: ['u1', 'u2'], order: 'asc' },
  segments: [
    segment('u1', 1, 'Remo', 500, { unit: 'm', mark: 'end' }),
    segment('u2', 1, 'Bike', 30, { unit: 'cal', mark: 'end' }),
    segment('u3', 1, 'Burpee', 20)
  ]
});
const ROW_ONLY = valid({
  ...base, format: 'for_time', totalReps: 1000, timeCapSeconds: 600,
  incomplete: { rule: 'penalty_per_rep', secondsPerRep: 0, base: 'time_cap' }, tieBreak: null,
  segments: [segment('r1', 1, 'Remo', 1000, { unit: 'm', mark: 'end' })]
});
const CINDY = (scoreDisplay = 'rounds_reps') => valid({
  ...base, format: 'amrap', totalReps: 30, timeCapSeconds: 1200, incomplete: null,
  tieBreak: { kind: 'last_round', order: 'asc' }, scoreDisplay,
  segments: [segment('c1', 1, 'Pull-up', 5), segment('c2', 1, 'Push-up', 10), segment('c3', 1, 'Air squat', 15)]
});
const TOTAL = valid({
  ...base, format: 'max_load', totalReps: 0, timeCapSeconds: 1200, incomplete: null,
  tieBreak: { kind: 'finish_time', order: 'asc' }, segments: [],
  maxLoad: {
    lifts: [
      { id: 'l1', name: 'Back Squat', reps: 1, maxAttempts: 3, startLoadKg: 100, note: '' },
      { id: 'l2', name: 'Press', reps: 1, maxAttempts: 3, startLoadKg: 40, note: '' },
      { id: 'l3', name: 'Deadlift', reps: 1, maxAttempts: 3, startLoadKg: 120, note: '' }
    ],
    order: 'fixed', scoring: 'sum', loadStepKg: 2.5
  }
});
const attempt = (lift, load, ok, at) => ({ t: 'attempt', lift, load, ok, at });
const repsInOrder = (structure, n, step = 5) => {
  const order = structure.segments.flatMap((item) => Array.from({ length: item.reps }, () => item.id));
  return Array.from({ length: n }, (_, index) => ({ t: 'rep', seg: order[index % order.length], at: (index + 1) * step }));
};

// ---------------------------------------------------------------------------
// Unidades e desempates (Story 1.48)
// ---------------------------------------------------------------------------

test('metros e calorias: cada linha com a unidade, total em unidades de trabalho e resultado com a unidade', () => {
  const events = [{ t: 'fill', seg: 'u1', n: 500, at: 110 }, { t: 'set', seg: 'u2', v: 22, at: 900 }];
  const state = deriveSheetState(UNITS, events);
  const model = buildSheetViewModel(UNITS, state, events);
  const rows = model.groups[0].rows;
  assert.deepEqual(rows.map((row) => [row.unit, row.unitShort, row.unitWord]), [['m', 'm', 'metros'], ['cal', 'cal', 'calorias'], ['reps', 'reps', 'repetições']]);
  assert.equal(model.progress.label, '522/550 unidades de trabalho');
  assert.equal(model.current.id, 'u2');
  assert.deepEqual(rows.map((row) => row.isTieBreak), [true, true, false]);
  assert.equal(rows[0].tieBreakTimeLabel, '01:50', 'o tempo vale na etapa que é o último marco concluído');
  assert.equal(rows[1].tieBreakTimeLabel, null);

  const summary = buildResultSummary(UNITS, computeSheetResult(UNITS, state));
  assert.deepEqual(summary.details, [
    '522 de 550 unidades de trabalho',
    '28 restantes × 1 s = +28 s sobre o time cap (15:00)',
    'Tie-break (último marco): 01:50'
  ]);
  assert.equal(buildSheetViewModel(ROW_ONLY, deriveSheetState(ROW_ONLY, []), []).progress.label, '0/1000 metros');
});

test('último round completo: nota no topo da súmula e no resultado; score exibido como total quando escolhido', () => {
  const events = repsInOrder(CINDY(), 222);
  const state = deriveSheetState(CINDY(), events);
  const model = buildSheetViewModel(CINDY(), state, events);
  assert.equal(model.tieBreakNote, 'Último round completo: 17:30');
  const summary = buildResultSummary(CINDY(), computeSheetResult(CINDY(), state));
  assert.equal(summary.headline, '7 rounds + 12 reps');
  assert.deepEqual(summary.details, ['Total: 222 repetições', 'Tie-break (último round completo): 17:30']);

  const total = CINDY('total');
  const totalSummary = buildResultSummary(total, computeSheetResult(total, deriveSheetState(total, events)));
  assert.equal(totalSummary.headline, '222 reps');
  assert.deepEqual(totalSummary.details.slice(0, 2), ['Total: 222 repetições', '7 rounds + 12 reps']);
});

test('renderização: unidade no segmento atual, correção por quantidade em metros e calorias e nota do último round', () => {
  const noop = () => {};
  const running = renderToStaticMarkup(createElement(SheetView, { structure: UNITS, events: [], phase: 'running', elapsedSeconds: 30, onEvent: noop, onStart: noop, onStop: noop }));
  assert.match(running, /aria-label="Remo: 0 de 500\. Segure para concluir"/);
  assert.match(running, /de <span class="font-number text-foreground">500<\/span> metros/);
  assert.match(running, /0\/550 unidades de trabalho/);

  const stopped = renderToStaticMarkup(createElement(SheetView, {
    structure: UNITS, events: [{ t: 'fill', seg: 'u1', n: 500, at: 110 }], phase: 'stopped', elapsedSeconds: 900, onEvent: noop, onStart: noop, onStop: noop
  }));
  assert.equal((stopped.match(/>Definir</g) || []).length, 2, 'metros e calorias se corrigem informando a quantidade');
  assert.match(stopped, /<label for="[^"]*-u1" class="sr-only">Quanto foi feito de Remo, em metros<\/label>/);
  assert.equal((stopped.match(/aria-label="Tirar uma repetição de /g) || []).length, 1, 'repetições seguem com − e +');

  const amrap = renderToStaticMarkup(createElement(SheetView, { structure: CINDY(), events: repsInOrder(CINDY(), 40), phase: 'running', elapsedSeconds: 200, onEvent: noop }));
  assert.match(amrap, /Último round completo: 02:30/);
});

// ---------------------------------------------------------------------------
// Carga máxima (Story 1.47)
// ---------------------------------------------------------------------------

test('modelo de carga máxima: movimento atual, carga sugerida, tentativas e estados dos movimentos', () => {
  const fresh = buildMaxLoadViewModel(TOTAL, deriveMaxLoadState(TOTAL, []), []);
  assert.equal(fresh.current.id, 'l1');
  assert.equal(fresh.suggestedLoadKg, 100, 'abre com a carga inicial');
  assert.equal(fresh.current.remainingLabel, '3 de 3 tentativas restantes');
  assert.equal(fresh.current.startLoadLabel, 'abre com 100 kg');
  assert.equal(fresh.scoreLabel, '0 kg');
  assert.equal(fresh.canUndo, false);

  const events = [attempt('l1', 140, true, 60), attempt('l1', 150, false, 180)];
  const going = buildMaxLoadViewModel(TOTAL, deriveMaxLoadState(TOTAL, events), events);
  assert.equal(going.suggestedLoadKg, 150, 'depois de um no-rep, repete a carga');
  assert.deepEqual(going.current.attempts.map((chip) => [chip.number, chip.loadLabel, chip.ok, chip.atLabel]), [[1, '140 kg', true, '01:00'], [2, '150 kg', false, '03:00']]);
  assert.equal(going.current.bestLabel, '140 kg');
  assert.equal(going.current.remainingLabel, '1 de 3 tentativas restantes');
  assert.equal(going.undoTarget, 1);

  const afterValid = [...events, attempt('l1', 150, true, 300)];
  const passed = buildMaxLoadViewModel(TOTAL, deriveMaxLoadState(TOTAL, afterValid), afterValid);
  assert.equal(passed.current.id, 'l2', 'tentativas do agachamento encerradas: vai ao press');
  assert.equal(passed.suggestedLoadKg, 40);
  assert.equal(passed.lifts[0].status, 'done');
  assert.equal(passed.lifts[0].remainingLabel, 'Tentativas encerradas');
  assert.equal(passed.scoreLabel, '150 kg');

  // Escolha do judge: avançar para o deadlift deixa o press para trás (ordem fixa).
  const chosen = buildMaxLoadViewModel(TOTAL, deriveMaxLoadState(TOTAL, afterValid), afterValid, 'l3');
  assert.equal(chosen.current.id, 'l3');
  const skipped = [...afterValid, attempt('l3', 180, true, 400)];
  const after = buildMaxLoadViewModel(TOTAL, deriveMaxLoadState(TOTAL, skipped), skipped, 'l2');
  assert.equal(after.current.id, 'l3', 'não volta ao press');
  assert.equal(after.lifts[1].status, 'locked');
  assert.equal(after.lifts[1].selectable, false);
  assert.equal(after.suggestedLoadKg, 182.5, 'depois de válida, sobe um incremento');
  assert.equal(findUndoTarget(skipped), 3);
});

test('resultado de carga máxima: total, melhor de cada movimento, desempate e aviso de tentativa que não contou', () => {
  const events = [
    attempt('l1', 140, true, 60), attempt('l1', 150, true, 180), attempt('l2', 60, true, 300),
    attempt('l3', 180, true, 420), attempt('l3', 190, false, 540), attempt('l1', 155, true, 600)
  ];
  const state = deriveMaxLoadState(TOTAL, events);
  const summary = buildMaxLoadResultSummary(TOTAL, computeMaxLoadResult(TOTAL, state), state);
  assert.equal(summary.headline, '390 kg');
  assert.equal(summary.caption, 'Soma das melhores cargas');
  assert.deepEqual(summary.details, ['Back Squat: 150 kg', 'Press: 60 kg', 'Deadlift: 180 kg', '5 tentativas', 'Tie-break (fim das tentativas): 09:00']);
  assert.equal(summary.warning, '1 tentativa não contou (depois da janela, acima do limite ou fora da ordem).');
});

test('renderização de carga máxima: pronta, em andamento, parada e somente leitura', () => {
  const noop = () => {};
  const render = (props) => renderToStaticMarkup(createElement(SheetView, { structure: TOTAL, events: [], phase: 'ready', elapsedSeconds: 0, ...props }));
  const handlers = { onEvent: noop, onStart: noop, onStop: noop };

  const ready = render({ ...handlers, context: { workoutName: 'Total', athleteName: 'Atleta A', laneLabel: 'Lane 2' } });
  assert.match(ready, /aria-label="Súmula digital de carga máxima"/);
  assert.match(ready, /Inicie o relógio para registrar as tentativas/);
  assert.match(ready, /<label for="([^"]+-carga)" class="sr-only">Carga da tentativa em kg<\/label><input id="\1"[^>]*disabled=""[^>]*value="100"/);
  assert.match(ready, /<button type="button" disabled=""[^>]*aria-label="Registrar 100 kg em Back Squat como válida"/);
  assert.match(ready, /Iniciar/);
  assert.match(ready, /Janela/);
  assert.match(ready, />20:00</);

  const running = render({ ...handlers, phase: 'running', elapsedSeconds: 75, events: [attempt('l1', 140, true, 60)] });
  assert.match(running, /<button type="button"[^>]*aria-label="Registrar 142,5 kg em Back Squat como válida"/);
  assert.doesNotMatch(running, /<button type="button" disabled=""[^>]*aria-label="Registrar 142,5 kg em Back Squat como válida"/);
  assert.match(running, /No-rep/);
  assert.match(running, /Passar para Press/);
  assert.match(running, /Parar/);
  assert.match(running, /2 de 3 tentativas restantes/);
  assert.match(running, /aria-label="Tentativas de Back Squat"/);
  assert.doesNotMatch(running, /aria-label="Resultado"/);

  const late = render({ ...handlers, phase: 'running', elapsedSeconds: 1201 });
  assert.match(late, /Janela encerrada: levantamento depois dela não conta\. Pare o relógio\./);

  const stopped = render({ ...handlers, phase: 'stopped', elapsedSeconds: 900, events: [attempt('l1', 140, true, 60), attempt('l2', 60, true, 300)] });
  assert.match(stopped, /aria-label="Resultado"/);
  assert.match(stopped, />200 kg</);
  assert.doesNotMatch(stopped, /Válida<\/button>/, 'parado, não há registro de tentativa');
  assert.match(stopped, /Desfazer/);

  const readOnly = render({ phase: 'running', elapsedSeconds: 30 });
  assert.doesNotMatch(readOnly, /Desfazer|Iniciar|Parar|Passar para/);
  assert.match(readOnly, /<button type="button" disabled=""[^>]*aria-label="Registrar 100 kg em Back Squat como válida"/);
});

test('a súmula de carga máxima emite tentativas, confere na porta e não grava', () => {
  const component = read('../src/components/sheet/MaxLoadSheetView.tsx');
  assert.doesNotMatch(component, /fetch\(|useApp|supabase|localStorage|sessionStorage|indexedDB|XMLHttpRequest|WebSocket/);
  assert.match(component, /const check = checkAttempt\(structure, state, current\.id, load, at\);/);
  assert.match(component, /emit\(\{ t: 'attempt', lift: current\.id, load, ok, at \}\);/);
  assert.match(component, /emit\(\{ t: 'undo', of: view\.undoTarget, at \}\)/);
  assert.match(component, /const at = Math\.max\(0, Math\.floor\(Number\.isFinite\(elapsedSeconds\) \? elapsedSeconds : 0\)\);/);
  assert.match(component, /computeMaxLoadResult\(structure, state\)/);
  const sheet = read('../src/components/sheet/SheetView.tsx');
  assert.match(sheet, /props\.structure\.format === 'max_load' \? <MaxLoadSheetView \{\.\.\.props\} \/> : <SegmentSheetView \{\.\.\.props\} \/>/);
  assert.match(sheet, /onSet=\{\(value\) => emit\(\{ t: 'set', seg: row\.id, v: value, at \}\)\}/);
});

// Revisão QA (QA-147-1): duas súmulas na mesma tela (o carrossel de raias da E3) não repetem ids.
test('duas súmulas na mesma tela não repetem os ids dos campos', () => {
  const noop = () => {};
  const two = renderToStaticMarkup(createElement('div', null,
    createElement(SheetView, { structure: TOTAL, events: [], phase: 'ready', elapsedSeconds: 0, onEvent: noop }),
    createElement(SheetView, { structure: TOTAL, events: [], phase: 'ready', elapsedSeconds: 0, onEvent: noop }),
    createElement(SheetView, { structure: UNITS, events: [{ t: 'fill', seg: 'u1', n: 500, at: 110 }], phase: 'stopped', elapsedSeconds: 900, onEvent: noop }),
    createElement(SheetView, { structure: UNITS, events: [{ t: 'fill', seg: 'u1', n: 500, at: 110 }], phase: 'stopped', elapsedSeconds: 900, onEvent: noop })
  ));
  const ids = [...two.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(ids.length >= 6, `ids encontrados: ${ids.length}`);
  assert.equal(new Set(ids).size, ids.length, 'ids repetidos');
});
