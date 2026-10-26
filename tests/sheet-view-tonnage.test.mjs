import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { importServerModule } from './support/serverModuleHarness.mjs';

// Story 1.80: a súmula do judge para a Tonelagem (Maquete 2 de
// docs/design/tonelagem/tonelagem-aprovado.html). Modelo de tela (relógio,
// liberação, carga vigente, tonelagem, desfazer), texto do resultado, a leitura
// da carga digitada e a renderização de servidor em cada estado. O toque, o
// relógio e o campo foram conferidos no navegador (ver a story).

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const {
  TONNAGE_LOAD_HINT_FREE, TONNAGE_LOAD_HINT_PRESCRIBED, buildTonnageResultSummary, buildTonnageViewModel, findTonnageUndoTarget, findUndoTarget, readTonnageLoadInput
} = await importServerModule('lib/sheetView.ts');
const { computeTonnageResult, deriveTonnageState, validateWorkoutStructure } = await importServerModule('lib/workoutStructure.ts');
const { SheetView } = await importServerModule('components/sheet/SheetView.tsx');

const segmentOf = (id, name, reps) => ({ id, round: 1, name, reps, unit: 'reps', load: null, note: '', required: true, mark: 'reps' });
const valid = (input) => {
  const checked = validateWorkoutStructure(input);
  assert.equal(checked.ok, true, checked.error);
  return checked.structure;
};
const tonnageInput = (overrides = {}, block = {}) => ({
  version: 5, format: 'tonnage', totalReps: 20, timeCapSeconds: 600, incomplete: null, tieBreak: null, generator: null, customized: true,
  entry: { mode: 'both', marking: 'reps', publish: 'after_review' },
  segments: [segmentOf('pu', 'Pull Ups', 10), segmentOf('bp', 'Burpees', 10)],
  maxLoad: null, scoreDisplay: null, interval: null, distance: null,
  tonnage: {
    position: 2, lift: { id: 'tn', name: 'Squat Clean', loadKg: null, note: '' }, loadMode: 'athlete',
    increment: { allowed: false, stepKg: 2.5 }, note: '10 Pull Ups; 10 Burpees; Max. Squat Clean', ...block
  },
  ...overrides
});
const TREINO1 = valid(tonnageInput());
const TREINO2 = valid(tonnageInput({ totalReps: 0, timeCapSeconds: 180, segments: [] }, {
  position: 0, lift: { id: 'tn', name: 'Squat Snatch', loadKg: null, note: '' }, increment: { allowed: true, stepKg: 10 }, note: ''
}));
const PRESCRITA = valid(tonnageInput({ totalReps: 0, timeCapSeconds: 180, segments: [] }, {
  position: 0, lift: { id: 'tn', name: 'Squat Snatch', loadKg: 60, note: '' }, loadMode: 'prescribed', note: ''
}));

const load = (v, at = 0) => ({ t: 'load', v, at });
const lrep = (kg, at) => ({ t: 'lrep', load: kg, at });
const rep = (seg, at) => ({ t: 'rep', seg, at });
const undo = (of, at = 170) => ({ t: 'undo', of, at });
const times = (count, make) => Array.from({ length: count }, (_, index) => make(index));
const liberate = () => [...times(10, (index) => rep('pu', 1 + index)), ...times(10, (index) => rep('bp', 11 + index))];

const modelOf = (structure, events, seconds = 0, running = false) => (
  buildTonnageViewModel(structure, deriveTonnageState(structure, events), events, seconds, running)
);

// ---------------------------------------------------------------------------
// Modelo de tela e textos
// ---------------------------------------------------------------------------

test('modelo de tela: relógio, time cap, barra e aviso de tempo esgotado (só com o relógio rodando)', () => {
  const ready = modelOf(TREINO1, [], 0, false);
  assert.deepEqual([ready.clockLabel, ready.durationLabel, ready.durationSeconds, ready.clockPercent, ready.timeUp, ready.note], ['00:00', '10:00', 600, 0, false, '10 Pull Ups; 10 Burpees; Max. Squat Clean']);
  const middle = modelOf(TREINO1, [], 300, true);
  assert.deepEqual([middle.clockLabel, middle.clockPercent, middle.timeUp], ['05:00', 50, false]);
  assert.equal(modelOf(TREINO1, [], 600, true).timeUp, false, 'o segundo do time cap ainda conta');
  assert.equal(modelOf(TREINO1, [], 600.9, true).timeUp, false);
  assert.equal(modelOf(TREINO1, [], 601, true).timeUp, true, 'depois do time cap');
  assert.equal(modelOf(TREINO1, [], 700, false).timeUp, false, 'parado, o aviso some');
  assert.equal(modelOf(TREINO1, [], 700, false).clockPercent, 100, 'a barra não passa de 100');
  assert.equal(modelOf(TREINO1, [], -5, false).clockLabel, '00:00');
  assert.equal(modelOf(TREINO1, [], Number.NaN, false).clockLabel, '00:00');
  assert.equal(modelOf(TREINO1, [], 300.9, true).clockLabel, '05:00', 'o relógio mostra o mesmo segundo que o evento grava');
});

test('modelo de tela: a liberação mostra o feito de cada exercício e o da vez; o levantamento destrava só no fim', () => {
  const none = modelOf(TREINO1, [load(60)]);
  assert.deepEqual(none.liberation.map((row) => [row.id, row.name, row.done, row.target, row.status, row.percent]), [
    ['pu', 'Pull Ups', 0, 10, 'current', 0],
    ['bp', 'Burpees', 0, 10, 'pending', 0]
  ]);
  assert.deepEqual([none.released, none.current.id, none.declared, none.loadLabel], [false, 'pu', true, '60 kg']);
  const half = modelOf(TREINO1, [load(60), ...times(10, (index) => rep('pu', 1 + index)), ...times(4, (index) => rep('bp', 11 + index))]);
  assert.deepEqual(half.liberation.map((row) => [row.done, row.remaining, row.status]), [[10, 0, 'done'], [4, 6, 'current']]);
  assert.equal(half.current.unitWord, 'repetições');
  const done = modelOf(TREINO1, [load(60), ...liberate()]);
  assert.deepEqual([done.released, done.current, done.liberation.map((row) => row.status)], [true, null, ['done', 'done']]);
  // Sem liberação: nada trava.
  const single = modelOf(TREINO2, []);
  assert.deepEqual([single.liberation, single.released, single.current], [[], true, null]);
});

test('modelo de tela: carga vigente, próxima carga do botão, tonelagem, repetições e cargas', () => {
  const log = [load(60), ...times(8, (index) => lrep(60, 10 + index)), load(70, 40), ...times(5, (index) => lrep(70, 50 + index))];
  const view = modelOf(TREINO2, log);
  assert.deepEqual([view.loadKg, view.loadLabel, view.nextLoadKg, view.incrementAllowed, view.stepKg], [70, '70 kg', 80, true, 10]);
  assert.deepEqual([view.tonnageLabel, view.reps], ['830 kg', 13]);
  assert.deepEqual(view.groups, [{ label: '60 kg × 8', kgLabel: '480 kg' }, { label: '70 kg × 5', kgLabel: '350 kg' }]);
  assert.equal(modelOf(TREINO2, [load(500)]).nextLoadKg, null, 'a próxima carga não passa de 500 kg');
  assert.equal(modelOf(TREINO1, [load(60)]).nextLoadKg, null, 'sem incremento permitido não há próxima carga');
  assert.equal(modelOf(TREINO2, []).nextLoadKg, null, 'sem carga declarada também não');
  assert.equal(modelOf(TREINO2, [load(42.5), lrep(42.5, 3)]).tonnageLabel, '42,5 kg');
  assert.equal(modelOf(TREINO2, [load(500), ...times(5, (index) => lrep(500, 1 + index))]).tonnageLabel, '2.500 kg', 'ponto de milhar');
  assert.equal(modelOf(TREINO2, []).tonnageLabel, '0 kg');
  assert.equal(modelOf(TREINO2, [lrep(60, 5)]).ignored, 1, 'registro que não contou');
});

test('modelo de tela: exercício de depois fica só como texto; a prova prescrita leva a carga do gestor', () => {
  const after = valid(tonnageInput({}, { position: 1 }));
  const view = modelOf(after, []);
  assert.deepEqual(view.liberation.map((row) => row.name), ['Pull Ups']);
  assert.deepEqual(view.after, [{ id: 'bp', label: '10 Burpees' }]);
  assert.equal(view.liftName, 'Squat Clean');
  const prescribed = modelOf(PRESCRITA, []);
  assert.deepEqual([prescribed.loadMode, prescribed.prescribedKg, prescribed.declared], ['prescribed', 60, false]);
});

test('desfazer: contagem da liberação, repetição e aumento de carga; a declaração da carga nunca é alvo', () => {
  assert.equal(findTonnageUndoTarget([]), null);
  assert.equal(findTonnageUndoTarget([load(60)]), null, 'só a declaração: nada a desfazer');
  assert.equal(findTonnageUndoTarget([load(60), rep('pu', 1)]), 1);
  assert.equal(findTonnageUndoTarget([load(60), lrep(60, 5), lrep(60, 6)]), 2);
  assert.equal(findTonnageUndoTarget([load(60), lrep(60, 5), load(70, 6)]), 2, 'o aumento de carga se desfaz');
  assert.equal(findTonnageUndoTarget([load(60), lrep(60, 5), lrep(60, 6), undo(2, 7)]), 1, 'o desfeito não é alvo de novo');
  assert.equal(findTonnageUndoTarget([load(60), lrep(60, 5), undo(1, 6)]), null, 'depois de desfazer tudo, só a declaração resta');
  assert.equal(findTonnageUndoTarget([load(60), { t: 'fill', seg: 'pu', n: 10, at: 3 }]), 1);
  assert.equal(findTonnageUndoTarget([load(60), lrep(60, 5), { t: 'time', target: 'final', v: 1, at: 9 }]), 1, 'só os tipos da tonelagem são alvo');
  // O findUndoTarget dos outros formatos não muda: lrep e load não são alvo nele.
  assert.equal(findUndoTarget([load(60), lrep(60, 5)]), null);
  assert.equal(modelOf(TREINO2, [load(60), lrep(60, 5)]).undoTarget, 1);
  assert.equal(modelOf(TREINO2, [load(60)]).canUndo, false);
});

test('resultado: texto da tonelagem e das repetições, aviso sem carga e dos registros que ficaram fora', () => {
  const summaryOf = (structure, events) => {
    const state = deriveTonnageState(structure, events);
    return buildTonnageResultSummary(computeTonnageResult(state), state);
  };
  const ok = summaryOf(TREINO2, [load(60), ...times(8, (index) => lrep(60, 10 + index))]);
  assert.deepEqual([ok.entered, ok.headline, ok.detail, ok.warning, ok.ignoredNote], [true, '480 kg', '8 repetições válidas', null, null]);
  assert.match(ok.note, /Mesma tonelagem divide a posição no ranking\. As repetições aparecem só como informação\./);
  assert.equal(summaryOf(TREINO2, [load(60), lrep(60, 5)]).detail, '1 repetição válida');
  assert.equal(summaryOf(TREINO2, [load(42.5), lrep(42.5, 5), lrep(42.5, 6)]).headline, '85 kg');
  assert.equal(summaryOf(TREINO2, [load(42.5), lrep(42.5, 5), lrep(42.5, 6), lrep(42.5, 7)]).headline, '127,5 kg');
  const none = summaryOf(TREINO2, []);
  assert.deepEqual([none.entered, none.headline, none.detail, none.warning], [false, 'Nenhuma carga informada', null, 'Informe a carga do atleta antes de enviar.']);
  assert.equal(summaryOf(TREINO2, [load(60), lrep(60, 5), lrep(60, 181)]).ignoredNote, '1 registro ficou fora do cálculo (depois do time cap, antes da liberação ou com carga que não é a vigente).');
  assert.match(summaryOf(TREINO2, [load(60), lrep(60, 181), lrep(60, 182)]).ignoredNote, /^2 registros ficaram fora do cálculo/);
});

test('readTonnageLoadInput: a carga digitada de 0,25 a 500 kg em múltiplos de 0,25, com vírgula ou ponto', () => {
  assert.deepEqual(readTonnageLoadInput('60'), { ok: true, kg: 60 });
  assert.deepEqual(readTonnageLoadInput(' 42,5 '), { ok: true, kg: 42.5 });
  assert.deepEqual(readTonnageLoadInput('42.25'), { ok: true, kg: 42.25 });
  assert.deepEqual(readTonnageLoadInput('0,25'), { ok: true, kg: 0.25 });
  assert.deepEqual(readTonnageLoadInput('500'), { ok: true, kg: 500 });
  for (const typed of ['0', '501', '60,3', '-5', 'abc', '1.000', '6,0,1', '1e2']) {
    assert.deepEqual(readTonnageLoadInput(typed), { ok: false, error: 'Use de 0,25 a 500 kg, em múltiplos de 0,25.' }, typed);
  }
  for (const empty of ['', '   ', null, undefined, 60]) {
    assert.deepEqual(readTonnageLoadInput(empty), { ok: false, error: 'Informe a carga do atleta em kg.' }, String(empty));
  }
});

// ---------------------------------------------------------------------------
// Renderização de servidor em cada estado (SheetView escolhe a súmula pelo formato)
// ---------------------------------------------------------------------------

const noop = () => {};
const render = (props) => renderToStaticMarkup(createElement(SheetView, {
  structure: TREINO1, events: [], phase: 'ready', elapsedSeconds: 0,
  context: { workoutName: 'W1 · Squat Clean', athleteName: 'Atleta de exemplo', laneLabel: 'Bateria 2 · Raia 4' },
  onEvent: noop, onStart: noop, onStop: noop, ...props
}));

test('SheetView escolhe a súmula da tonelagem pelo formato, sem a de segmentos, a de carga máxima, a do intervalado nem a da distância', () => {
  const html = render({});
  assert.match(html, /aria-label="Súmula digital da tonelagem"/);
  assert.doesNotMatch(html, /aria-label="Súmula digital"/);
  assert.doesNotMatch(html, /aria-label="Súmula digital do intervalado"/);
  assert.doesNotMatch(html, /aria-label="Súmula digital da distância"/);
  assert.match(read('../src/components/sheet/SheetView.tsx'), /if \(props\.structure\.format === 'tonnage'\) return <TonnageSheetView \{\.\.\.props\} \/>;/);
});

test('antes de iniciar: cabeçalho, relógio parado com o time cap, campo da carga e a liberação esperando; Iniciar desligado sem carga', () => {
  const html = render({});
  assert.match(html, /W1 · Squat Clean/);
  assert.match(html, /Atleta de exemplo/);
  assert.match(html, /Não iniciada/);
  assert.match(html, /aria-label="Relógio 00:00"/);
  assert.match(html, /Time cap<span[^>]*>10:00<\/span>/);
  assert.match(html, /10 Pull Ups; 10 Burpees; Max\. Squat Clean/);
  assert.match(html, /<label for="[^"]+-carga"[^>]*>Carga do atleta · Squat Clean \(kg\)<\/label>/);
  assert.match(html, /<input id="[^"]+-carga" type="text" inputMode="decimal" autoComplete="off" enterKeyHint="done" placeholder="ex\.: 60"[^>]*value=""/);
  assert.ok(html.includes(TONNAGE_LOAD_HINT_FREE));
  assert.doesNotMatch(html, /readOnly/);
  assert.match(html, /Liberação<\/p><p[^>]*>aguardando<\/p>/);
  assert.match(html, /Pull Ups/);
  assert.match(html, /Burpees/);
  assert.doesNotMatch(html, /conta a tonelagem/, 'o cartão do levantamento só aparece depois de iniciar');
  assert.match(html, /<button type="button" disabled="" class="[^"]*flex-\[2\] border-primary[^"]*"><svg[^>]*lucide-play[^>]*>.*?<\/svg>Iniciar<\/button>/s);
  assert.match(html, /Desfazer/);
  assert.doesNotMatch(html, /Resultado a publicar/);
});

test('carga prescrita: o campo vem pronto e somente leitura, com o texto da prescrição, e Iniciar liga', () => {
  const html = render({ structure: PRESCRITA });
  assert.match(html, /<input id="[^"]+-carga"[^>]*readOnly=""[^>]*value="60"/);
  assert.ok(html.includes(TONNAGE_LOAD_HINT_PRESCRIBED));
  assert.doesNotMatch(html, /Liberação/, 'sem exercícios de liberação o cartão não aparece');
  assert.match(html, /<button type="button" class="[^"]*flex-\[2\] border-primary[^"]*"><svg[^>]*lucide-play[^>]*>.*?<\/svg>Iniciar<\/button>/s);
  assert.doesNotMatch(html, /<button type="button" disabled="" class="[^"]*flex-\[2\] border-primary[^"]*"><svg[^>]*lucide-play/);
});

test('em andamento, com liberação: o segmento da vez é o toque e segure, o levantamento está travado e o botão de repetição desligado', () => {
  const html = render({ phase: 'running', elapsedSeconds: 30, events: [load(60), ...times(4, (index) => rep('pu', 1 + index))] });
  assert.match(html, /Em andamento/);
  assert.match(html, /Liberação<\/p><p[^>]*>em andamento<\/p>/);
  assert.match(html, /Pull Ups: 4 de 10\. Toque para somar uma repetição, segure para concluir o segmento/);
  assert.match(html, /Squat Clean · conta a tonelagem<\/p><p[^>]*>travado<\/p>/);
  assert.match(html, /<button type="button" disabled="" aria-label="Conclua a liberação para registrar repetições"[^>]*>Conclua a liberação<\/button>/);
  assert.match(html, /60<span[^>]*>kg vigente<\/span>/);
  assert.match(html, /aria-label="Parar"|>Parar<\/button>/);
  assert.doesNotMatch(html, />Iniciar<\/button>/);
  assert.doesNotMatch(html, /Carga do atleta · /, 'o campo da carga só existe antes de iniciar');
});

test('liberada: a repetição liga com a carga vigente e a tonelagem aparece com as cargas', () => {
  const log = [load(60), ...liberate(), lrep(60, 30), lrep(60, 31), lrep(60, 32)];
  const html = render({ phase: 'running', elapsedSeconds: 33, events: log });
  assert.match(html, /Liberação<\/p><p[^>]*>concluída<\/p>/);
  assert.match(html, /Squat Clean · conta a tonelagem<\/p><p[^>]*>liberado<\/p>/);
  assert.match(html, /aria-label="Somar uma repetição de Squat Clean com 60 kg"[^>]*>\+1 repetição<\/button>/);
  assert.doesNotMatch(html, /<button type="button" disabled="" aria-label="Somar uma repetição/);
  assert.match(html, /Tonelagem até agora<\/p><p[^>]*>180 kg<span[^>]*>3 repetições<\/span>/);
  assert.match(html, /aria-label="Cargas e repetições"[^>]*><li[^>]*>60 kg × 3<span[^>]*>180 kg<\/span>/);
  assert.doesNotMatch(html, /Subir carga/, 'sem incremento permitido o botão não existe');
  assert.doesNotMatch(html, /Pull Ups: \d+ de 10\. Toque/, 'a liberação terminou: sem o segmento da vez');
});

test('incremento permitido: o botão "Subir carga" mostra o passo e fica ligado só liberado e dentro do tempo', () => {
  const log = [load(60), lrep(60, 10)];
  const html = render({ structure: TREINO2, phase: 'running', elapsedSeconds: 11, events: log });
  assert.match(html, /Subir carga \+10 kg<\/button>/);
  assert.doesNotMatch(html, /<button type="button" disabled="" class="[^"]*">Subir carga/);
  // Depois do time cap: contar e subir ficam desligados e a tela avisa.
  const late = render({ structure: TREINO2, phase: 'running', elapsedSeconds: 181, events: log });
  assert.match(late, /Tempo esgotado\. Pare o relógio\./);
  assert.match(late, /<button type="button" disabled="" class="[^"]*">Subir carga \+10 kg<\/button>/);
  assert.match(late, /<button type="button" disabled="" aria-label="Tempo esgotado: não é possível registrar repetições"/);
  // Na carga máxima de 500 kg não há próxima carga.
  const top = render({ structure: TREINO2, phase: 'running', elapsedSeconds: 11, events: [load(500)] });
  assert.match(top, /<button type="button" disabled="" class="[^"]*">Subir carga \+10 kg<\/button>/);
});

test('relógio parado: o resultado a publicar traz a tonelagem, as repetições, o aviso dos registros fora e a nota do ranking', () => {
  const log = [load(60), ...times(8, (index) => lrep(60, 10 + index)), lrep(60, 181)];
  const html = render({ structure: TREINO2, phase: 'stopped', elapsedSeconds: 200, events: log });
  assert.match(html, /Relógio parado/);
  assert.match(html, /aria-label="Resultado a publicar"/);
  assert.match(html, /Resultado a publicar<\/p><p[^>]*>480 kg<\/p><p[^>]*>8 repetições válidas<\/p>/);
  assert.match(html, /1 registro ficou fora do cálculo/);
  assert.match(html, /Mesma tonelagem divide a posição no ranking\./);
  assert.doesNotMatch(html, />Parar<\/button>/);
  assert.doesNotMatch(html, />Iniciar<\/button>/);
  // Sem carga declarada o resultado avisa em vez de somar.
  const empty = render({ structure: TREINO2, phase: 'stopped', elapsedSeconds: 10, events: [] });
  assert.match(empty, /Nenhuma carga informada/);
  assert.match(empty, /Informe a carga do atleta antes de enviar\./);
});

test('exercício de depois do que conta aparece só como texto; sem onEvent a súmula é somente leitura', () => {
  const after = valid(tonnageInput({}, { position: 1 }));
  const html = render({ structure: after, phase: 'running', elapsedSeconds: 5, events: [load(60)] });
  assert.match(html, /Depois da tonelagem \(não conta, não trava\): 10 Burpees\./);
  const readOnly = render({ structure: TREINO2, phase: 'running', elapsedSeconds: 5, events: [load(60), lrep(60, 3)], onEvent: undefined, onStart: undefined, onStop: undefined });
  assert.match(readOnly, /Tonelagem até agora<\/p><p[^>]*>60 kg/);
  assert.doesNotMatch(readOnly, /<button/);
  assert.doesNotMatch(readOnly, /Carga do atleta/);
});

test('o componente emite eventos e não grava: sem rede, sem useApp, sem banco e sem armazenamento local', () => {
  const component = read('../src/components/sheet/TonnageSheetView.tsx');
  for (const source of [component, read('../src/lib/sheetView.ts')]) {
    assert.doesNotMatch(source, /fetch\(|useApp|supabase|localStorage|sessionStorage|indexedDB|XMLHttpRequest|WebSocket/);
  }
  // A declaração da carga é o primeiro registro; depois o relógio começa. Repetição e aumento levam a carga do estado.
  assert.match(component, /if \(!view\.declared && parsed\.ok\) onEvent\?\.\(\{ t: 'load', v: parsed\.kg, at: 0 \}\);\s*setDraft\(null\);\s*onStart\(\);/);
  assert.match(component, /onEvent\?\.\(\{ t: 'lrep', load: view\.loadKg, at \}\)/);
  assert.match(component, /onEvent\?\.\(\{ t: 'load', v: view\.nextLoadKg, at \}\)/);
  assert.match(component, /onEvent\(\{ t: 'undo', of: view\.undoTarget, at \}\)/);
  assert.match(component, /onEvent\?\.\(\{ t: 'rep', seg: view\.current\?\.id \?\? '', at \}\)/);
  // A liberação usa as mesmas peças do For Time (toque e segure), e não há correção por segmento aqui.
  assert.match(component, /import \{ CurrentSegment, SegmentRow \} from '@\/components\/sheet\/SegmentParts';/);
  assert.match(component, /corrections=\{false\}/);
});

test('as peças de segmento foram para SegmentParts.tsx sem mudar o For Time: o SheetView as importa de lá', () => {
  const parts = read('../src/components/sheet/SegmentParts.tsx');
  const sheet = read('../src/components/sheet/SheetView.tsx');
  for (const name of ['CurrentSegment', 'SegmentRow', 'TieBreakBadge']) assert.match(parts, new RegExp(`export function ${name}\\(`));
  assert.match(sheet, /import \{ CurrentSegment, SegmentRow \} from '@\/components\/sheet\/SegmentParts';/);
  assert.doesNotMatch(sheet, /function CurrentSegment\(|function SegmentRow\(|function SetAmount\(|function TieBreakBadge\(/);
});
