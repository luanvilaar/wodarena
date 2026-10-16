import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { importServerModule } from './support/serverModuleHarness.mjs';

// Story 1.44: modelo de tela, gesto e componente da súmula digital do judge.
// O motor de cálculo é o da Story 1.43; aqui só se confere o que a tela mostra
// e emite. Os gestos (toque, segurar) foram conferidos no navegador; o node não
// tem DOM, então aqui ficam o modelo, a renderização de servidor e a regressão
// estática.

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const { findUndoTarget, buildSheetViewModel, buildResultSummary } = await importServerModule('lib/sheetView.ts');
const { deriveSheetState, computeSheetResult } = await importServerModule('lib/workoutStructure.ts');
const { SheetView } = await importServerModule('components/sheet/SheetView.tsx');
const { HOLD_MS, MOVE_TOLERANCE_PX, MIN_TAP_GAP_MS } = await importServerModule('components/sheet/useTapHold.ts');

// A prova do protótipo aprovado: Thruster e Pull-up em 21, 15 e 9, cap 600, 1 s por repetição, tie-break em s2.
const segment = (id, round, name, reps, load, mark = 'reps') => ({
  id, round, name, reps, load: load === null ? null : { value: load, unit: 'kg' }, note: '', required: true, mark
});
const forTime = (overrides = {}) => ({
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
    segment('s1', 1, 'Thruster', 21, 43),
    segment('s2', 1, 'Pull-up', 21, null),
    segment('s3', 2, 'Thruster', 15, 43),
    segment('s4', 2, 'Pull-up', 15, null),
    segment('s5', 3, 'Thruster', 9, 43),
    segment('s6', 3, 'Pull-up', 9, null)
  ],
  ...overrides
});
// AMRAP: um round de 30 (Thruster 10, Pull-up 10, Burpee 10), 12 minutos.
const amrap = () => ({
  version: 1,
  format: 'amrap',
  totalReps: 30,
  timeCapSeconds: 720,
  incomplete: null,
  tieBreak: { kind: 'split_time', at: 's2', order: 'asc' },
  generator: { kind: 'fixed', reps: [10] },
  customized: false,
  entry: { mode: 'both', marking: 'reps', publish: 'after_review' },
  segments: [segment('s1', 1, 'Thruster', 10, 43), segment('s2', 1, 'Pull-up', 10, null), segment('s3', 1, 'Burpee', 10, null)]
});

// n repetições na ordem dos segmentos, espalhadas até `lastAt`.
const repEvents = (structure, n, lastAt) => {
  const order = structure.segments.flatMap((item) => Array.from({ length: item.reps }, () => item.id));
  return Array.from({ length: n }, (_, index) => ({
    t: 'rep',
    seg: order[index % order.length],
    at: Math.round(((index + 1) / n) * lastAt)
  }));
};

const view = (structure, events) => {
  const state = deriveSheetState(structure, events);
  const result = computeSheetResult(structure, state);
  return { state, result, model: buildSheetViewModel(structure, state, events), summary: buildResultSummary(structure, result) };
};

// ---------------------------------------------------------------------------
// findUndoTarget
// ---------------------------------------------------------------------------

test('findUndoTarget: o último evento desfazível que nenhum undo posterior anulou', () => {
  const rep = (seg = 's1') => ({ t: 'rep', seg, at: 1 });
  assert.equal(findUndoTarget([]), null);
  assert.equal(findUndoTarget([rep(), rep()]), 1);
  assert.equal(findUndoTarget([rep(), rep(), { t: 'undo', of: 1, at: 2 }]), 0);
  assert.equal(findUndoTarget([rep(), { t: 'undo', of: 0, at: 2 }]), null);
  // Desfazer um desfazer não tem efeito (o motor não tem "refazer"): o alvo segue o evento 0.
  assert.equal(findUndoTarget([rep(), rep(), { t: 'undo', of: 1, at: 2 }, { t: 'undo', of: 2, at: 3 }]), 0);
  // Dois undo do mesmo alvo equivalem a um.
  assert.equal(findUndoTarget([rep(), rep(), { t: 'undo', of: 1, at: 2 }, { t: 'undo', of: 1, at: 3 }]), 0);
  // Undo que aponta para o futuro, para si mesmo ou para fora é ignorado.
  assert.equal(findUndoTarget([rep(), { t: 'undo', of: 5, at: 2 }]), 0);
  assert.equal(findUndoTarget([rep(), { t: 'undo', of: 1, at: 2 }]), 0, 'undo de si mesmo é ignorado, e o evento 0 segue desfazível');
  // Eventos de correção e de ajuste de tempo também são desfazíveis.
  assert.equal(findUndoTarget([rep(), { t: 'adj', seg: 's1', d: -1, at: 3 }]), 1);
  assert.equal(findUndoTarget([rep(), { t: 'time', target: 'final', v: 500, at: 3 }]), 1);
  assert.equal(findUndoTarget([{ t: 'fill', seg: 's1', n: 3, at: 3 }, { t: 'set', seg: 's1', v: 2, at: 4 }]), 1);
});

// ---------------------------------------------------------------------------
// Modelo de tela e resultado (vetores da 1.43)
// ---------------------------------------------------------------------------

test('For Time sem eventos: nada feito, primeiro segmento atual, três rounds com título', () => {
  const { model } = view(forTime(), []);
  assert.equal(model.format, 'for_time');
  assert.equal(model.showRoundTitles, true);
  assert.deepEqual(model.groups.map((group) => [group.title, group.rows.length]), [['Round 1', 2], ['Round 2', 2], ['Round 3', 2]]);
  assert.equal(model.current.id, 's1');
  assert.equal(model.current.name, 'Thruster');
  assert.equal(model.current.loadLabel, '43 kg');
  assert.equal(model.groups[0].rows[1].loadLabel, null, 'Pull-up sem carga');
  assert.deepEqual(model.progress, { label: '0/90 repetições', percent: 0, done: 0, target: 90 });
  assert.equal(model.completed, false);
  assert.equal(model.canUndo, false);
  assert.equal(model.roundLabel, null);
});

test('For Time com 30 repetições: segmento 1 concluído, Pull-up em andamento, tie-break marcado e sem tempo ainda', () => {
  const { model } = view(forTime(), repEvents(forTime(), 30, 200));
  const [s1, s2] = model.groups[0].rows;
  assert.deepEqual([s1.status, s1.done, s1.percent], ['done', 21, 100]);
  assert.deepEqual([s2.status, s2.done, s2.target, s2.remaining], ['current', 9, 21, 12]);
  assert.equal(s2.isTieBreak, true);
  assert.equal(s2.tieBreakTimeLabel, null);
  assert.equal(model.groups[1].rows[0].status, 'pending');
  assert.equal(model.current.id, 's2');
  assert.equal(model.progress.label, '30/90 repetições');
  assert.equal(model.progress.percent, 33);
  assert.equal(model.canUndo, true);
  assert.equal(model.undoTarget, 29);
});

test('tie-break: o segmento marcado mostra o tempo quando é concluído (04:31 na prova de 90 em 581 s)', () => {
  const structure = forTime();
  const { model, summary, result } = view(structure, repEvents(structure, 90, 581));
  assert.equal(model.completed, true);
  assert.equal(model.current, null);
  assert.equal(model.groups[0].rows[1].tieBreakTimeLabel, '04:31');
  assert.equal(result.value, 581);
  assert.deepEqual(summary, {
    headline: '09:41',
    caption: 'Tempo final',
    details: ['90 de 90 repetições', 'Tie-break: 04:31'],
    warning: null
  });
});

test('For Time não concluído: 82 de 90 em 598 s vale 10:08, com as repetições restantes e a penalidade à vista', () => {
  const structure = forTime();
  const { model, summary, result } = view(structure, repEvents(structure, 82, 598));
  assert.equal(model.completed, false);
  assert.equal(result.display, '10:08');
  assert.equal(summary.headline, '10:08');
  assert.equal(summary.caption, 'Tempo ajustado pelo time cap');
  assert.deepEqual(summary.details, [
    '82 de 90 repetições',
    '8 restantes × 1 s = +8 s sobre o time cap (10:00)',
    'Tie-break: 05:06'
  ]);
  assert.equal(buildResultSummary(structure, computeSheetResult(structure, deriveSheetState(structure, repEvents(structure, 89, 598)))).details[1], '1 restante × 1 s = +1 s sobre o time cap (10:00)');
});

test('AMRAP: 222 repetições são 7 rounds + 12, no round 8, com o Pull-up em andamento', () => {
  const structure = amrap();
  const { model, summary, result } = view(structure, repEvents(structure, 222, 700));
  assert.equal(model.format, 'amrap');
  assert.equal(model.showRoundTitles, false, 'um round só: sem título');
  assert.equal(model.roundLabel, 'Round 8');
  assert.equal(model.current.name, 'Pull-up');
  assert.equal(model.current.done, 2);
  assert.deepEqual(model.progress, { label: '222 repetições', percent: 40, done: 222, target: null });
  assert.equal(model.completed, false, 'AMRAP nunca "conclui" por repetições');
  assert.equal(result.value, 222);
  assert.equal(summary.headline, '7 rounds + 12 reps');
  assert.equal(summary.caption, 'Resultado');
  assert.deepEqual(summary.details.slice(0, 1), ['Total: 222 repetições']);
});

test('AMRAP: singular e menos de um round fechado', () => {
  const structure = amrap();
  assert.equal(view(structure, repEvents(structure, 31, 50)).summary.headline, '1 round + 1 rep');
  assert.equal(view(structure, repEvents(structure, 12, 50)).summary.headline, '12 reps');
  assert.equal(view(structure, []).summary.details[0], 'Total: 0 repetições');
  assert.equal(view(structure, repEvents(structure, 1, 5)).model.progress.label, '1 repetição');
});

test('aviso do tie-break depois do fim da prova e tempo oficial aparecem no resumo', () => {
  const structure = forTime();
  const events = [
    ...repEvents(structure, 90, 581),
    { t: 'time', target: 'final', v: 260, at: 590 }
  ];
  const { summary, result } = view(structure, events);
  assert.equal(result.tieBreakAfterEnd, true);
  assert.equal(summary.headline, '04:20');
  assert.equal(summary.caption, 'Tempo oficial');
  assert.ok(summary.details.includes('Tempo da súmula: 09:41'));
  assert.match(summary.warning, /tie-break ficou depois do fim da prova/);
});

test('desfazer: o alvo acompanha o log e some do modelo quando não há mais o que desfazer', () => {
  const structure = forTime();
  const events = repEvents(structure, 3, 10);
  assert.equal(view(structure, events).model.undoTarget, 2);
  const undone = [...events, { t: 'undo', of: 2, at: 11 }];
  const { model, state } = view(structure, undone);
  assert.equal(state.repsDone, 2);
  assert.equal(model.undoTarget, 1);
  const allUndone = [...events, { t: 'undo', of: 2, at: 11 }, { t: 'undo', of: 1, at: 12 }, { t: 'undo', of: 0, at: 13 }];
  assert.equal(view(structure, allUndone).model.canUndo, false);
});

// ---------------------------------------------------------------------------
// Renderização do componente
// ---------------------------------------------------------------------------

const render = (props) => renderToStaticMarkup(createElement(SheetView, {
  structure: forTime(),
  events: [],
  phase: 'ready',
  elapsedSeconds: 0,
  ...props
}));
const noop = () => {};
const handlers = { onEvent: noop, onStart: noop, onStop: noop };

test('fase "pronta": relógio parado, segmento atual inativo e "Iniciar" disponível', () => {
  const html = render({ ...handlers, context: { workoutName: 'Fran', athleteName: 'Atleta A', laneLabel: 'Lane 3' } });
  assert.match(html, /Não iniciada/);
  assert.match(html, /00:00/);
  assert.match(html, /Time cap/);
  assert.match(html, />Fran</);
  assert.match(html, /Atleta A/);
  assert.match(html, /Lane 3/);
  assert.match(html, /Inicie o relógio para contar/);
  assert.match(html, /<button type="button"[^>]*disabled=""[^>]*aria-label="Thruster: 0 de 21\./);
  assert.match(html, /Iniciar/);
  assert.doesNotMatch(html, /Parar/);
  assert.doesNotMatch(html, /Concluir segmento/, 'sem relógio rodando não há o que concluir');
  assert.doesNotMatch(html, /Resultado/);
});

test('fase "em andamento": segmento atual ativo com a dica do gesto, "Concluir segmento" e "Parar"', () => {
  const html = render({ ...handlers, phase: 'running', elapsedSeconds: 75, events: repEvents(forTime(), 5, 50) });
  assert.match(html, /Em andamento/);
  assert.match(html, /01:15/);
  assert.match(html, /Toque \+1 · Segure para concluir/);
  assert.match(html, /aria-label="Thruster: 5 de 21\. Toque para somar uma repetição, segure para concluir o segmento"/);
  assert.doesNotMatch(html, /aria-label="Thruster: 5 de 21[^"]*"[^>]*disabled=""/);
  assert.match(html, /Concluir segmento/);
  assert.match(html, /Parar/);
  assert.doesNotMatch(html, /Iniciar/);
  assert.match(html, /5\/90 repetições/);
  assert.match(html, /role="progressbar"/);
  assert.match(html, /aria-live="polite"/);
  assert.doesNotMatch(html, /Time cap atingido/);
});

test('o relógio mostra o mesmo segundo que o evento grava (sem arredondar para cima)', () => {
  const html = render({ ...handlers, phase: 'running', elapsedSeconds: 28.4 });
  assert.match(html, /aria-label="Relógio 00:28"/);
  assert.match(html, />00:28</);
  assert.doesNotMatch(html, /00:29/);
  assert.match(render({ ...handlers, phase: 'running', elapsedSeconds: 599.9 }), />09:59</);
  assert.match(render({ ...handlers, phase: 'running', elapsedSeconds: 0.2 }), />00:00</);
  assert.match(render({ ...handlers, phase: 'running', elapsedSeconds: Number.NaN }), />00:00</);
  const component = read('../src/components/sheet/SheetView.tsx');
  assert.match(component, /const clockLabel = formatWorkoutTime\(at\);/);
  assert.doesNotMatch(component, /formatWorkoutTime\(elapsedSeconds\)/);
});

test('time cap atingido com o relógio rodando avisa o judge (For Time e AMRAP)', () => {
  assert.match(render({ ...handlers, phase: 'running', elapsedSeconds: 600 }), /Time cap atingido\. Pare o relógio\./);
  assert.doesNotMatch(render({ ...handlers, phase: 'running', elapsedSeconds: 599 }), /atingido/);
  assert.doesNotMatch(render({ ...handlers, phase: 'ready', elapsedSeconds: 900 }), /atingido/, 'só com o relógio rodando');
  assert.match(render({ ...handlers, structure: amrap(), phase: 'running', elapsedSeconds: 720 }), /Tempo esgotado\. Pare o relógio\./);
  assert.match(render({ ...handlers, structure: amrap() }), /Duração/);
});

test('fase "parada": resultado do motor, correções por segmento e nenhum alvo de toque', () => {
  const structure = forTime();
  const html = render({ ...handlers, phase: 'stopped', elapsedSeconds: 598, events: repEvents(structure, 82, 598) });
  assert.match(html, /Relógio parado/);
  assert.match(html, /aria-label="Resultado"/);
  assert.match(html, />10:08</);
  assert.match(html, /Tempo ajustado pelo time cap/);
  assert.match(html, /8 restantes × 1 s = \+8 s sobre o time cap \(10:00\)/);
  assert.equal((html.match(/aria-label="Tirar uma repetição de /g) || []).length, 6);
  assert.equal((html.match(/aria-label="Somar uma repetição em /g) || []).length, 6);
  assert.doesNotMatch(html, /Concluir segmento/);
  assert.doesNotMatch(html, /Toque para somar uma repetição/);
  assert.match(html, /Desfazer/);
  assert.doesNotMatch(html, /Parar|Iniciar/);
});

test('prova concluída com o relógio rodando já mostra o resultado e não oferece mais contagem', () => {
  const structure = forTime();
  const html = render({ ...handlers, phase: 'running', elapsedSeconds: 581, events: repEvents(structure, 90, 581) });
  assert.match(html, />09:41</);
  assert.match(html, /Tempo final/);
  assert.doesNotMatch(html, /Toque para somar uma repetição/);
  assert.match(html, /Parar/);
});

test('somente leitura (sem onEvent): sem Desfazer, Iniciar, Parar, correções nem Concluir segmento', () => {
  for (const phase of ['ready', 'running', 'stopped']) {
    const html = render({ phase, elapsedSeconds: 30, events: repEvents(forTime(), 12, 30) });
    assert.doesNotMatch(html, /Desfazer|Iniciar|Parar|Concluir segmento|Tirar uma repetição|Somar uma repetição em/, phase);
    assert.match(html, /5?\/90 repetições|12\/90 repetições/, phase);
  }
  // No andamento, sem onEvent, o alvo grande existe mas está desligado.
  assert.match(render({ phase: 'running', elapsedSeconds: 30 }), /<button type="button"[^>]*disabled=""[^>]*aria-label="Thruster: 0 de 21\./);
});

test('segmento marcado como "end" só conclui segurando: a dica e o rótulo dizem isso', () => {
  const structure = forTime({
    segments: [segment('s1', 1, 'Corrida', 1, null, 'end'), segment('s2', 1, 'Pull-up', 89, null)],
    tieBreak: null,
    generator: null,
    customized: true,
    totalReps: 90
  });
  const html = render({ ...handlers, structure, phase: 'running', elapsedSeconds: 10 });
  assert.match(html, /Segure para concluir o movimento/);
  assert.match(html, /aria-label="Corrida: 0 de 1\. Segure para concluir"/);
  assert.doesNotMatch(html, /Toque \+1/);
});

test('o AMRAP mostra o round em andamento e não mostra título de round', () => {
  const html = render({ ...handlers, structure: amrap(), phase: 'running', elapsedSeconds: 100, events: repEvents(amrap(), 42, 100) });
  assert.match(html, /Round 2/);
  assert.match(html, /42 repetições/);
  assert.doesNotMatch(html, /<h3/);
});

test('tie-break depois do fim da prova gera alerta no painel de resultado', () => {
  const structure = forTime();
  const html = render({
    ...handlers,
    phase: 'stopped',
    elapsedSeconds: 600,
    events: [...repEvents(structure, 90, 581), { t: 'time', target: 'final', v: 260, at: 590 }]
  });
  assert.match(html, /role="alert"/);
  assert.match(html, /tie-break ficou depois do fim da prova/);
});

// ---------------------------------------------------------------------------
// Gesto e regressão estática
// ---------------------------------------------------------------------------

test('gesto: constantes do desenho "Toque e segure" (700 ms, 12 px, 120 ms)', () => {
  assert.equal(HOLD_MS, 700);
  assert.equal(MOVE_TOLERANCE_PX, 12);
  assert.equal(MIN_TAP_GAP_MS, 120);
  const hook = read('../src/components/sheet/useTapHold.ts');
  assert.match(hook, /setTimeout\(\(\) => \{[\s\S]*?callbacks\.current\.onHold\(\);[\s\S]*?\}, HOLD_MS\)/);
  assert.match(hook, /distance > MOVE_TOLERANCE_PX/);
  assert.match(hook, /now - lastTapAt >= MIN_TAP_GAP_MS/);
  assert.match(hook, /onContextMenu: \(event: MouseEvent<HTMLElement>\) => event\.preventDefault\(\)/);
  assert.match(hook, /event\.detail !== 0/, 'Enter e Espaço chegam como click sem ponteiro');
  assert.match(hook, /navigator\.vibrate/);
});

test('anel do segurar: duração por classe (700 ms = HOLD_MS) e sem transição inline, para o reduced-motion valer', () => {
  const component = read('../src/components/sheet/SheetView.tsx');
  assert.equal(HOLD_MS, 700);
  assert.match(component, /transition-\[stroke-dashoffset\] duration-700 ease-linear motion-reduce:transition-none/);
  assert.doesNotMatch(component, /transition: holding/);
});

test('o componente emite eventos e não grava: sem rede, sem useApp, sem banco e sem armazenamento local', () => {
  const component = read('../src/components/sheet/SheetView.tsx');
  const hook = read('../src/components/sheet/useTapHold.ts');
  for (const source of [component, hook, read('../src/lib/sheetView.ts')]) {
    assert.doesNotMatch(source, /fetch\(|useApp|supabase|localStorage|sessionStorage|indexedDB|XMLHttpRequest|WebSocket/);
  }
  assert.match(component, /emit\(\{ t: 'rep', seg: current\.id, at \}\)|onRep=\{\(\) => emit\(\{ t: 'rep', seg: current\.id, at \}\)\}/);
  assert.match(component, /\{ t: 'fill', seg: current\.id, n: current\.remaining, at \}/);
  assert.match(component, /\{ t: 'adj', seg: row\.id, d: delta, at \}/);
  assert.match(component, /\{ t: 'undo', of: view\.undoTarget, at \}/);
  assert.match(component, /const at = Math\.max\(0, Math\.floor\(Number\.isFinite\(elapsedSeconds\) \? elapsedSeconds : 0\)\);/);
  // O motor da 1.43 faz o cálculo; o componente só formata.
  assert.match(component, /computeSheetResult\(structure, state\)/);
  assert.doesNotMatch(component, /penalt|secondsPerRep|timeCapSeconds \+/);
});

test('a pré-visualização existe só em desenvolvimento e o judge de hoje não mudou', () => {
  const page = read('../src/app/[locale]/sumula-preview/page.tsx');
  assert.match(page, /if \(process\.env\.NODE_ENV === 'production'\) notFound\(\);/);
  assert.ok(existsSync(new URL('../src/components/sheet/SheetPreview.tsx', import.meta.url)));
  const judge = read('../src/app/judge/page.tsx');
  assert.doesNotMatch(judge, /SheetView|sheetView|sumula-preview/);
  assert.doesNotMatch(read('../src/app/api/admin/persistence/route.ts'), /SheetView|sheetView/);
  assert.doesNotMatch(read('../src/lib/workoutStructure.ts'), /sheetView|SheetView/);
});
