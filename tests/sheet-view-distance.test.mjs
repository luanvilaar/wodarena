import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { importServerModule } from './support/serverModuleHarness.mjs';

// Story 1.68: a súmula do judge para a Distância (Maquete 2 de
// docs/design/distancia/distancia-aprovado.html). Modelo de tela (relógio,
// duração, tempo esgotado, lançamentos e desfazer), texto do resultado e dos
// quilômetros, a decisão do campo pelo parser do motor (com a paridade com a
// tabela de digitação do README) e a renderização de servidor em cada estado.
// O toque no campo e o relógio foram conferidos no navegador (ver a story).

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const {
  DISTANCE_FIELD_HINT, DISTANCE_HISTORY_LIMIT, DISTANCE_SAME_NOTICE, buildDistanceResultSummary, buildDistanceViewModel, decideDistanceEntry, findUndoTarget, formatKm
} = await importServerModule('lib/sheetView.ts');
const {
  computeDistanceResult, deriveDistanceState, parseMetersInput, validateWorkoutStructure
} = await importServerModule('lib/workoutStructure.ts');
const { computeSheetOutcome, computeAbsentOutcome } = await importServerModule('lib/scoresheet.ts');
const { SheetView } = await importServerModule('components/sheet/SheetView.tsx');

const NOTE = '750 m corrida; máx. distância no remo. Os parceiros trocam a cada volta da corrida.';
const valid = (input) => {
  const checked = validateWorkoutStructure(input);
  assert.equal(checked.ok, true, checked.error);
  return checked.structure;
};
const distanceInput = (overrides = {}, distanceOverrides = {}) => ({
  version: 4, format: 'distance', totalReps: 0, timeCapSeconds: 1200, incomplete: null, tieBreak: null, generator: null, customized: true,
  entry: { mode: 'both', marking: 'reps', publish: 'after_review' },
  segments: [], maxLoad: null, scoreDisplay: null, interval: null,
  distance: { unit: 'm', note: NOTE, ...distanceOverrides },
  ...overrides
});
const DISTANCE = valid(distanceInput());

const dist = (v, at = 1200) => ({ t: 'dist', v, at });
const undo = (of, at = 1201) => ({ t: 'undo', of, at });

const modelOf = (events, seconds = 0, running = false, structure = DISTANCE) => (
  buildDistanceViewModel(structure, deriveDistanceState(structure, events), seconds, running)
);

// ---------------------------------------------------------------------------
// Modelo de tela e textos
// ---------------------------------------------------------------------------

test('formatKm: vírgula decimal, até três casas, sem zeros à direita', () => {
  assert.deepEqual([0, 5, 999, 1000, 5915, 6000, 6330, 6350, 12345, 99999].map(formatKm),
    ['0', '0,005', '0,999', '1', '5,915', '6', '6,33', '6,35', '12,345', '99,999']);
  assert.equal(formatKm(-3), '0');
  assert.equal(formatKm(Number.NaN), '0');
  assert.equal(formatKm(6330.8), '6,33');
});

test('modelo de tela: relógio, duração, barra e aviso de tempo esgotado (só com o relógio rodando)', () => {
  const ready = modelOf([], 0, false);
  assert.deepEqual([ready.clockLabel, ready.durationLabel, ready.durationSeconds, ready.clockPercent, ready.timeUp, ready.note], ['00:00', '20:00', 1200, 0, false, NOTE]);
  const middle = modelOf([], 948, true);
  assert.deepEqual([middle.clockLabel, middle.clockPercent, middle.timeUp], ['15:48', 79, false]);
  assert.equal(modelOf([], 1199.9, true).timeUp, false, 'um instante antes da duração');
  assert.equal(modelOf([], 1200, true).timeUp, true, 'na duração');
  assert.equal(modelOf([], 1350, true).timeUp, true, 'depois da duração');
  assert.equal(modelOf([], 1350, false).timeUp, false, 'parado, o aviso some');
  assert.equal(modelOf([], 1350, false).clockPercent, 100, 'a barra não passa de 100');
  assert.equal(modelOf([], -5, false).clockLabel, '00:00');
  assert.equal(modelOf([], Number.NaN, false).clockLabel, '00:00');
  // O relógio mostra o mesmo segundo que o evento grava (arredonda para baixo).
  assert.equal(modelOf([], 948.9, true).clockLabel, '15:48');
  assert.equal(modelOf([], 10, false, valid(distanceInput({}, { note: '' }))).note, '');
});

test('modelo de tela: total lançado, histórico dos últimos 5 (do mais recente ao mais antigo) e alvo do desfazer', () => {
  const none = modelOf([]);
  assert.deepEqual([none.totalLabel, none.lastAtLabel, none.history, none.undoTarget, none.entries], [null, null, [], null, 0]);

  const two = modelOf([dist(4500, 600), dist(6330, 948)]);
  assert.deepEqual([two.totalLabel, two.lastAtLabel, two.undoTarget, two.entries], ['6.330 m', '15:48', 1, 2]);
  assert.deepEqual(two.history, [
    { position: 1, meters: 6330, metersLabel: '6.330 m', atLabel: '15:48' },
    { position: 0, meters: 4500, metersLabel: '4.500 m', atLabel: '10:00' }
  ]);

  // Desfazer: o último que conta deixa de contar e o anterior volta a valer (o log guarda os dois).
  const afterUndo = modelOf([dist(4500, 600), dist(6330, 948), undo(1, 950)]);
  assert.deepEqual([afterUndo.totalLabel, afterUndo.undoTarget, afterUndo.history.length], ['4.500 m', 0, 1]);
  assert.equal(modelOf([dist(4500, 600), undo(0, 700)]).undoTarget, null, 'sem lançamento que conte, não há o que desfazer');

  // Só os 5 mais recentes aparecem.
  const many = modelOf(Array.from({ length: 8 }, (_, index) => dist(1000 * (index + 1), 100 * index)));
  assert.equal(DISTANCE_HISTORY_LIMIT, 5);
  assert.deepEqual(many.history.map((row) => row.metersLabel), ['8.000 m', '7.000 m', '6.000 m', '5.000 m', '4.000 m']);
  assert.equal(many.entries, 8, 'a contagem total segue inteira');
  assert.equal(many.undoTarget, 7);

  // findUndoTarget (usado pelas outras súmulas) também enxerga o dist como desfazível.
  assert.equal(findUndoTarget([dist(1), { t: 'rep', seg: 'a', at: 2 }]), 1);
  assert.equal(findUndoTarget([dist(1)]), 0);
  assert.equal(findUndoTarget([dist(1), undo(0)]), null);
});

test('resultado: o texto vem do motor, com km, a contagem de lançamentos e o aviso sem lançamento', () => {
  const summary = (events) => buildDistanceResultSummary(computeDistanceResult(deriveDistanceState(DISTANCE, events)));
  assert.deepEqual(summary([dist(6330)]), {
    entered: true,
    headline: '6.330 m',
    detail: '= 6,33 km · 1 lançamento',
    warning: null,
    note: 'O servidor calcula o mesmo resultado a partir dos registros. O número do aparelho não é aceito como está.'
  });
  assert.equal(summary([dist(4500, 600), dist(6330)]).detail, '= 6,33 km · 2 lançamentos');
  assert.equal(summary([dist(6000)]).detail, '= 6 km · 1 lançamento');
  assert.equal(summary([dist(0)]).headline, '0 m', 'o 0 digitado vale');
  assert.deepEqual(
    [summary([]).entered, summary([]).headline, summary([]).detail, summary([]).warning],
    [false, 'Nenhum total lançado', null, 'Informe a distância total antes de enviar.']
  );
  assert.equal(summary([dist(6330), undo(0)]).entered, false);
  // O texto da tela e o do servidor dizem o mesmo número.
  const outcome = computeSheetOutcome(DISTANCE, [dist(6330)]);
  assert.equal(outcome.summary, summary([dist(6330)]).headline);
  assert.equal(computeAbsentOutcome(DISTANCE).summary, 'Atleta ausente · 0 m');
});

// ---------------------------------------------------------------------------
// O campo: a decisão da tela e a paridade com o parser do motor
// ---------------------------------------------------------------------------

test('decideDistanceEntry: emite o dist só quando o parser aceita; recusa com a mensagem dele; não repete o mesmo total', () => {
  assert.deepEqual(decideDistanceEntry('6330', null, 948), { kind: 'emit', event: { t: 'dist', v: 6330, at: 948 } });
  assert.deepEqual(decideDistanceEntry('6.330', 4500, 1200), { kind: 'emit', event: { t: 'dist', v: 6330, at: 1200 } });
  assert.deepEqual(decideDistanceEntry('0', 6330, 1200), { kind: 'emit', event: { t: 'dist', v: 0, at: 1200 } }, 'o 0 é um lançamento válido');
  assert.deepEqual(decideDistanceEntry('0', null, 5), { kind: 'emit', event: { t: 'dist', v: 0, at: 5 } });
  assert.deepEqual(decideDistanceEntry('6330', 6330, 1200), { kind: 'same' });
  assert.deepEqual(decideDistanceEntry('6.330', 6330, 1200), { kind: 'same' }, 'o ponto de milhar também é o mesmo total');
  assert.equal(DISTANCE_SAME_NOTICE, 'Esse total já está lançado.');
  assert.equal(DISTANCE_FIELD_HINT, 'Some tudo por fora (voltas e remo) e informe o total em metros.');
});

test('paridade: para cada texto da tabela de digitação, a tela emite se, e somente se, o parser aceita', () => {
  const table = [
    ['3250', 3250], ['3.250', 3250], ['0', 0], ['99999', 99999], ['99.999', 99999], [' 6330 ', 6330],
    ['3,5', null], ['3.25', null], ['100000', null], ['', null], ['   ', null], ['abc', null], ['-5', null], ['3,250', null], ['99.9999', null]
  ];
  for (const [text, meters] of table) {
    const decision = decideDistanceEntry(text, null, 100);
    const parsed = parseMetersInput(text);
    assert.equal(decision.kind === 'emit', parsed.ok, JSON.stringify(text));
    if (meters === null) {
      assert.equal(decision.kind, 'refused', JSON.stringify(text));
      assert.equal(decision.error, parsed.error, 'a tela mostra a mensagem do parser, sem texto próprio');
    } else {
      assert.deepEqual(decision.event, { t: 'dist', v: meters, at: 100 }, JSON.stringify(text));
      // E o servidor aceita o mesmo evento: o resultado publicado sai do log.
      assert.deepEqual(computeSheetOutcome(DISTANCE, [decision.event]).value, meters);
    }
  }
  const messages = ['3,5', '100000', ''].map((text) => decideDistanceEntry(text, null, 1).error);
  assert.deepEqual(messages, ['Use só metros inteiros (ex.: 3250).', 'O total passa de 99.999 m. Confira o número.', 'Informe o total em metros.']);
});

// ---------------------------------------------------------------------------
// Renderização de servidor em cada estado (SheetView escolhe a súmula pelo formato)
// ---------------------------------------------------------------------------

const noop = () => {};
const render = (props) => renderToStaticMarkup(createElement(SheetView, {
  structure: DISTANCE, events: [], phase: 'ready', elapsedSeconds: 0,
  context: { workoutName: 'W3 · Remo e corrida', athleteName: 'Dupla Fênix', laneLabel: 'Bateria 2 · Raia 4' },
  onEvent: noop, onStart: noop, onStop: noop, ...props
}));

test('SheetView escolhe a súmula da distância pelo formato, sem a de segmentos, a de carga máxima nem a do intervalado', () => {
  const html = render({});
  assert.match(html, /aria-label="Súmula digital da distância"/);
  assert.doesNotMatch(html, /aria-label="Súmula digital"/);
  assert.doesNotMatch(html, /aria-label="Súmula digital do intervalado"/);
  assert.match(read('../src/components/sheet/SheetView.tsx'), /if \(props\.structure\.format === 'distance'\) return <DistanceSheetView \{\.\.\.props\} \/>;/);
});

test('estado pronta: cabeçalho, relógio parado, duração, resumo da prova e o campo desabilitado com a dica para iniciar', () => {
  const html = render({});
  assert.match(html, /W3 · Remo e corrida/);
  assert.match(html, /Dupla Fênix<span[^>]*>Bateria 2 · Raia 4<\/span>/);
  assert.match(html, /Não iniciada/);
  assert.match(html, /aria-label="Relógio 00:00"[^>]*>\s*00:00/);
  assert.match(html, /Duração\s*<span[^>]*>20:00<\/span>/);
  assert.match(html, /750 m corrida; máx\. distância no remo\./);
  assert.match(html, /<label for="[^"]+-distancia"[^>]*>Distância total \(m\)<\/label>/);
  assert.match(html, /<input id="[^"]+-distancia" type="text" inputMode="numeric" autoComplete="off" enterKeyHint="done" disabled=""[^>]*value=""/);
  assert.match(html, /Inicie o relógio para lançar o total\./);
  assert.match(html, /Nenhum total lançado ainda\./);
  assert.match(html, /<button type="button" disabled=""[^>]*>Registrar<\/button>/);
  assert.match(html, /Iniciar<\/button>/);
  assert.doesNotMatch(html, />Parar<\/button>/);
  assert.match(html, /<button type="button" disabled="" class="[^"]*">.*?Desfazer<\/button>/s, 'sem lançamento, não há o que desfazer');
  assert.doesNotMatch(html, /Resultado a publicar/);
});

test('estado em andamento: relógio, barra, campo habilitado com a dica, total lançado, histórico e "Parar"', () => {
  const html = render({ phase: 'running', elapsedSeconds: 948, events: [dist(4500, 600), dist(6330, 948)] });
  assert.match(html, /Em andamento/);
  assert.match(html, /aria-label="Relógio 15:48"/);
  assert.match(html, /role="progressbar"[^>]*aria-valuenow="79"/);
  assert.doesNotMatch(html, /Tempo esgotado/);
  assert.doesNotMatch(html, /<input id="[^"]+-distancia"[^>]*disabled=""/);
  assert.match(html, /<input id="[^"]+-distancia"[^>]*aria-describedby="[^"]+-dica"[^>]*value="6330"/, 'o campo mostra o último total lançado');
  assert.match(html, new RegExp(`<p id="[^"]+-dica"[^>]*>${DISTANCE_FIELD_HINT.replace(/[.()]/g, '\\$&')}</p>`));
  assert.match(html, /<button type="button"[^>]*>Registrar<\/button>/);
  assert.doesNotMatch(html, /<button type="button" disabled=""[^>]*>Registrar<\/button>/);
  assert.match(html, /Total lançado<\/p><p[^>]*aria-live="polite"[^>]*>6\.330 m<span[^>]*>às 15:48<\/span>/);
  assert.match(html, /<ol aria-label="Últimos lançamentos"[^>]*><li[^>]*>6\.330 m<span[^>]*>15:48<\/span><\/li><li[^>]*>4\.500 m<span[^>]*>10:00<\/span><\/li><\/ol>/);
  assert.match(html, />Parar<\/button>/);
  assert.doesNotMatch(html, />Iniciar<\/button>/);
  assert.doesNotMatch(html, /<button type="button" disabled="" class="[^"]*">.*?Desfazer<\/button>/s, 'com lançamento, dá para desfazer');
  assert.doesNotMatch(html, /Resultado a publicar/, 'o resultado só aparece com o relógio parado');
});

test('estado em andamento sem lançamento: campo vazio habilitado e "Nenhum total lançado ainda."', () => {
  const html = render({ phase: 'running', elapsedSeconds: 30 });
  assert.match(html, /<input id="[^"]+-distancia"[^>]*value=""/);
  assert.doesNotMatch(html, /<input id="[^"]+-distancia"[^>]*disabled=""/);
  assert.match(html, /Nenhum total lançado ainda\./);
  assert.doesNotMatch(html, /Últimos lançamentos/);
});

test('tempo esgotado: o aviso aparece com o relógio rodando na duração e some com o relógio parado', () => {
  const running = render({ phase: 'running', elapsedSeconds: 1200, events: [dist(6330, 1199)] });
  assert.match(running, /<p role="status"[^>]*>Tempo esgotado\. Pare o relógio\.<\/p>/);
  assert.match(running, /role="progressbar"[^>]*aria-valuenow="100"/);
  const stopped = render({ phase: 'stopped', elapsedSeconds: 1200, events: [dist(6330, 1199)] });
  assert.doesNotMatch(stopped, /Tempo esgotado/);
});

test('relógio parado: o resultado a publicar com a unidade, os km e a contagem; sem lançamento, o aviso no lugar do número', () => {
  const html = render({ phase: 'stopped', elapsedSeconds: 1200, events: [dist(4500, 600), dist(6330, 1200)] });
  assert.match(html, /Relógio parado/);
  assert.match(html, /aria-label="Resultado a publicar"/);
  assert.match(html, /Resultado a publicar<\/p><p[^>]*>6\.330 m<\/p><p[^>]*>= 6,33 km · 2 lançamentos<\/p>/);
  assert.match(html, /O servidor calcula o mesmo resultado a partir dos registros\./);
  assert.doesNotMatch(html, /Informe a distância total antes de enviar\./);

  const empty = render({ phase: 'stopped', elapsedSeconds: 1200 });
  assert.match(empty, /Resultado a publicar<\/p><p[^>]*>Nenhum total lançado<\/p>/);
  assert.match(empty, /<p role="status"[^>]*>Informe a distância total antes de enviar\.<\/p>/);
  // Depois de desfazer o único lançamento, volta o aviso.
  const undone = render({ phase: 'stopped', elapsedSeconds: 1200, events: [dist(6330, 900), undo(0, 910)] });
  assert.match(undone, /Nenhum total lançado<\/p>/);
});

test('somente leitura (sem onEvent): mostra o estado e o total, sem campo, sem botões e sem desfazer', () => {
  const html = render({ phase: 'stopped', elapsedSeconds: 1200, events: [dist(6330, 1100)], onEvent: undefined, onStart: undefined, onStop: undefined });
  assert.match(html, /aria-label="Súmula digital da distância"/);
  assert.match(html, /Total lançado<\/p><p[^>]*>6\.330 m<span[^>]*>às 18:20<\/span>/);
  assert.match(html, /Resultado a publicar<\/p><p[^>]*>6\.330 m<\/p>/);
  assert.doesNotMatch(html, /<input|<textarea|<button/);
  assert.doesNotMatch(html, /Distância total \(m\)/);
});

test('sem resumo da prova: o cabeçalho e a duração aparecem e nenhum texto vazio sobra', () => {
  const html = render({ structure: valid(distanceInput({}, { note: '' })) });
  assert.match(html, /Duração\s*<span[^>]*>20:00<\/span>/);
  assert.doesNotMatch(html, /750 m corrida/);
  assert.doesNotMatch(html, /<p class="text-sm font-semibold leading-snug text-muted"><\/p>/);
});

// ---------------------------------------------------------------------------
// Quadra e painel do gestor: a unidade e o rótulo da distância
// ---------------------------------------------------------------------------

test('CourtSheet: resultado em metros na conferência, na confirmação, no cartão publicado e no ausente; sem cronômetro oficial', () => {
  const court = read('../src/components/judge/CourtSheet.tsx');
  assert.match(court, /import \{[^}]*formatMeters[^}]*\} from '@\/lib\/workoutStructure';/s);
  // Story 1.80: a tonelagem entra no meio, em kg ("1.652,5 kg"); a distância e os outros formatos seguem como estavam.
  assert.match(court, /const resultText = \(result: string, value: number\) => \(\s*structure\.format === 'distance' \? `\$\{formatMeters\(value\)\} m`\s*: structure\.format === 'tonnage' \? `\$\{formatTonnageKg\(value\)\} kg`\s*: `\$\{result\.replace\('\.', ','\)\}\$\{resultUnit\(value\)\}`\s*\);/);
  assert.match(court, /<p className="font-number text-4xl font-extrabold">\{resultText\(outcome\.result, outcome\.value\)\}<\/p>/);
  assert.match(court, /Enviar \{outcome\.ok \? resultText\(outcome\.result, outcome\.value\) : ''\} de \{context\.athleteName\}\?/);
  assert.match(court, /structure\.format === 'distance' && published\.result\s*\? `\$\{formatMeters\(Number\(published\.result\)\)\} m`\s*: structure\.format === 'tonnage' && published\.result \? `\$\{formatTonnageKg\(Number\(published\.result\)\)\} kg` : published\.result/);
  assert.match(court, /structure\.format === 'distance' \? `\$\{formatMeters\(absentOutcome\.value\)\} m`/);
  // A revisão abre com o relógio parado (a distância nunca "termina antes") e o cronômetro oficial só vale para For Time e AMRAP.
  assert.match(court, /if \(structure\.format === 'interval'\) return false;/);
  assert.match(court, /return structure\.format === 'for_time' && state\.repsRemaining === 0 && state\.completedAt !== null;/);
  assert.match(court, /\(structure\.format === 'for_time' \|\| structure\.format === 'amrap'\) && <OfficialTimeForm/);
  // Enviar e confirmar ficam desligados enquanto o resultado for recusado (sem lançamento).
  assert.match(court, /disabled=\{submitting \|\| !syncReady \|\| !outcome\.ok\}/);
  assert.match(court, /disabled=\{!syncReady \|\| !outcome\.ok\}/);
});

test('painel do gestor: a correção da súmula de distância pede "Distância em metros"', () => {
  assert.match(read('../src/components/admin/ScoresheetsPanel.tsx'), /distance: 'Distância em metros'/);
});

test('o formato da súmula de distância não tem toque nem segurar: o componente não usa useTapHold', () => {
  const source = read('../src/components/sheet/DistanceSheetView.tsx');
  assert.doesNotMatch(source, /useTapHold/);
  assert.match(source, /onEvent\(decision\.event\)/);
  assert.match(source, /onEvent\(\{ t: 'undo', of: view\.undoTarget, at \}\)/);
});
