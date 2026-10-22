import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { importServerModule } from './support/serverModuleHarness.mjs';

// Story 1.62: a súmula do judge para o Intervalado (Maquete 2 de
// docs/design/intervalado/intervalado-aprovado.html). Modelo de tela (fase,
// round, contagem regressiva, movimento da vez, quadro dos rounds, cartões de
// correção), resumo do resultado, a decisão do toque pela porta da tela (com a
// paridade com o motor) e a renderização de servidor em cada estado. O toque, o
// segurar e o relógio foram conferidos no navegador (ver a story).

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const {
  INTERVAL_HOLD_REFUSED, buildIntervalResultSummary, buildIntervalViewModel, decideIntervalTouch, intervalColumnShort
} = await importServerModule('lib/sheetView.ts');
const {
  computeIntervalResult, deriveIntervalState, intervalPhaseAt, validateWorkoutStructure
} = await importServerModule('lib/workoutStructure.ts');
const { SheetView } = await importServerModule('components/sheet/SheetView.tsx');

const fixed = (id, name, reps, extra = {}) => ({
  id, round: 1, name, reps, unit: 'reps', load: null, note: '', required: true, mark: 'reps', ...extra
});
const valid = (input) => {
  const checked = validateWorkoutStructure(input);
  assert.equal(checked.ok, true, checked.error);
  return checked.structure;
};
const intervalInput = (overrides = {}, intervalOverrides = {}) => ({
  version: 3, format: 'interval', totalReps: 21, timeCapSeconds: 1080, incomplete: null, tieBreak: null, generator: null,
  customized: true, entry: { mode: 'both', marking: 'reps', publish: 'after_review' },
  segments: [fixed('f1', 'Ring Muscle Ups', 6), fixed('f2', 'Box Jump Overs (24/20 in)', 15)],
  maxLoad: null, scoreDisplay: null,
  interval: { rounds: 5, onSeconds: 120, offSeconds: 120, max: { id: 'mx', name: 'Squat Clean', load: { value: 80, unit: 'kg' }, note: '' }, ...intervalOverrides },
  ...overrides
});
// O caso aprovado: 5 × 02:00 ON / 02:00 OFF, 6 Ring Muscle Ups, 15 Box Jump Overs, máximo de Squat Clean 80 kg.
const IV = valid(intervalInput());

const startOf = (round) => (round - 1) * 240;
const reps = (seg, count, from) => Array.from({ length: count }, (_, index) => ({ t: 'rep', seg, at: from + index }));
// Atleta A: 9, 8, 5, 1 e o round 5 com Box Jump Overs 11/15 (4 Squat Clean brutos que não contam).
const athleteA = () => [9, 8, 5, 1, 4].flatMap((max, index) => {
  const round = index + 1;
  const start = startOf(round);
  return [
    { t: 'fill', seg: 'f1', n: 6, at: start + 15 },
    round === 5 ? { t: 'fill', seg: 'f2', n: 11, at: start + 60 } : { t: 'fill', seg: 'f2', n: 15, at: start + 60 },
    ...(round === 5 ? reps('mx', max, start + 61) : reps('mx', max, start + 70))
  ];
});

const model = (events, seconds, structure = IV) => {
  const state = deriveIntervalState(structure, events);
  return buildIntervalViewModel(structure, state, events, seconds, intervalPhaseAt(structure, seconds));
};
const summaryOf = (events, structure = IV) => {
  const state = deriveIntervalState(structure, events);
  return buildIntervalResultSummary(structure, computeIntervalResult(state), state, events);
};
const render = (props) => renderToStaticMarkup(createElement(SheetView, {
  structure: IV, events: [], phase: 'ready', elapsedSeconds: 0, onEvent: () => {}, onStart: () => {}, onStop: () => {}, ...props
}));
const tileOf = (html) => html.match(/<button type="button"[^>]*aria-label="[^"]*"[^>]*class="relative flex min-h-36[\s\S]*?<\/button>/)?.[0] || '';

// ---------------------------------------------------------------------------
// Modelo de tela: fase, round e contagem regressiva (AC2)
// ---------------------------------------------------------------------------

test('fase, round e contagem regressiva nos segundos 0, 119, 120, 250, 1079 e 1080 do caso aprovado', () => {
  const at = (seconds) => {
    const view = model([], seconds);
    return [view.clockLabel, view.clockPhase, view.phaseLabel, view.roundLabel, view.countdownCaption, view.countdownLabel];
  };
  assert.deepEqual(at(0), ['00:00', 'work', 'Trabalho', 'Round 1 de 5', 'Restam no round', '02:00']);
  assert.deepEqual(at(119), ['01:59', 'work', 'Trabalho', 'Round 1 de 5', 'Restam no round', '00:01']);
  assert.deepEqual(at(120), ['02:00', 'rest', 'Descanso', 'Depois do round 1 de 5', 'Próximo round em', '02:00']);
  assert.deepEqual(at(250), ['04:10', 'work', 'Trabalho', 'Round 2 de 5', 'Restam no round', '01:50']);
  assert.deepEqual(at(1079), ['17:59', 'work', 'Trabalho', 'Round 5 de 5', 'Restam no round', '00:01']);
  assert.deepEqual(at(1080), ['18:00', 'ended', 'Prova encerrada', '5 rounds feitos', 'Pare o relógio', '00:00']);
  // O relógio mostra o segundo que o registro grava (Math.floor), não o arredondado para cima.
  assert.equal(model([], 119.9).clockLabel, '01:59');
  assert.equal(model([], 119.9).clockPhase, 'work');
  assert.equal(model([], 0).durationLabel, '18:00');
  assert.equal(model([], 120).announcement, 'Descanso. Depois do round 1 de 5.');
});

test('linha do tempo: um bloco de trabalho por round e descanso só entre eles; com OFF 00:00 não há descanso', () => {
  const view = model([], 540);
  assert.deepEqual(view.timeline.blocks.map((block) => block.kind).join(','), 'work,rest,work,rest,work,rest,work,rest,work');
  assert.equal(view.timeline.markerPercent, 50);
  assert.equal(view.timeline.ariaLabel, '5 rounds de 02:00 de trabalho, 02:00 de descanso entre eles, 18:00 no total');
  assert.equal(model([], 5000).timeline.markerPercent, 100);

  const emom = valid(intervalInput({ timeCapSeconds: 600 }, { offSeconds: 0 }));
  const emomView = model([], 120, emom);
  assert.equal(emomView.timeline.blocks.every((block) => block.kind === 'work'), true);
  assert.equal(emomView.clockPhase, 'work');
  assert.equal(emomView.roundLabel, 'Round 2 de 5');
  assert.equal(emomView.timeline.ariaLabel, '5 rounds de 02:00 de trabalho, sem descanso entre eles, 10:00 no total');
});

// ---------------------------------------------------------------------------
// Movimento da vez (AC3)
// ---------------------------------------------------------------------------

test('movimento da vez: fixos na ordem e o máximo só com os fixos do round em andamento na meta', () => {
  let tile = model([], 10).tile;
  assert.equal(tile.kind, 'fixed');
  assert.equal(tile.label, 'Ring Muscle Ups');
  assert.equal(tile.targetLabel, 'de 6 repetições');
  assert.equal(tile.hint, 'Toque +1 · Segure para concluir');
  assert.equal(tile.remaining, 6);

  tile = model([{ t: 'fill', seg: 'f1', n: 6, at: 10 }], 20).tile;
  assert.equal(tile.id, 'f2');
  assert.equal(tile.label, 'Box Jump Overs (24/20 in)');

  const both = [{ t: 'fill', seg: 'f1', n: 6, at: 10 }, { t: 'fill', seg: 'f2', n: 15, at: 50 }, { t: 'rep', seg: 'mx', at: 60 }];
  tile = model(both, 61).tile;
  assert.deepEqual(
    { kind: tile.kind, label: tile.label, done: tile.done, targetLabel: tile.targetLabel, hint: tile.hint },
    { kind: 'max', label: 'Máx. Squat Clean · 80 kg', done: 1, targetLabel: 'repetição neste round', hint: 'Sem meta · conte até o fim da janela' }
  );
  // O round 2 começa de novo pelos fixos, mesmo com o round 1 completo.
  assert.equal(model(both, 250).tile.id, 'f1');

  // Sem carga no máximo, só o nome; marcação por bloco no fixo, como no For Time.
  const noLoad = valid(intervalInput({
    totalReps: 30, segments: [fixed('f1', 'Bike', 30, { unit: 'cal', mark: 'end' })]
  }, { max: { id: 'mx', name: 'Burpee', load: null, note: '' } }));
  const bike = model([], 5, noLoad).tile;
  assert.equal(bike.hint, 'Segure para concluir o movimento');
  assert.equal(bike.targetLabel, 'de 30 calorias');
  assert.equal(model([{ t: 'fill', seg: 'f1', n: 30, at: 4 }], 5, noLoad).tile.label, 'Máx. Burpee');
});

test('descanso e prova encerrada: o tile mostra o que foi contado e diz que os registros não contam', () => {
  const events = athleteA();
  const rest = model(events, 130).tile;
  assert.deepEqual(
    { kind: rest.kind, label: rest.label, done: rest.done, targetLabel: rest.targetLabel, hint: rest.hint },
    { kind: 'rest', label: 'Descanso', done: 9, targetLabel: 'repetições contadas no round 1', hint: 'Os registros agora não contam' }
  );
  const ended = model(events, 1080).tile;
  assert.deepEqual(
    { kind: ended.kind, label: ended.label, done: ended.done, targetLabel: ended.targetLabel, hint: ended.hint },
    { kind: 'ended', label: 'Tempo esgotado', done: 23, targetLabel: 'repetições no total', hint: 'Toque em Parar para revisar' }
  );
});

// ---------------------------------------------------------------------------
// Porta da tela (AC4): recusa fora da janela, sem emitir; paridade com o motor
// ---------------------------------------------------------------------------

test('toque: 01:59 aceita e 02:00 recusa; descanso e fim recusam com a mensagem, sem evento', () => {
  const state = deriveIntervalState(IV, []);
  assert.deepEqual(decideIntervalTouch(IV, state, 119, 'tap'), { ok: true, event: { t: 'rep', seg: 'f1', at: 119 } });
  assert.deepEqual(decideIntervalTouch(IV, state, 119.8, 'tap'), { ok: true, event: { t: 'rep', seg: 'f1', at: 119 } });
  assert.deepEqual(decideIntervalTouch(IV, state, 120, 'tap'), { ok: false, refused: 'Descanso: o toque não foi aceito.' });
  assert.deepEqual(decideIntervalTouch(IV, state, 210, 'tap'), { ok: false, refused: 'Descanso: o toque não foi aceito.' });
  assert.deepEqual(decideIntervalTouch(IV, state, 1080, 'tap'), { ok: false, refused: 'Prova encerrada: o toque não foi aceito.' });
  assert.deepEqual(decideIntervalTouch(IV, state, 120, 'hold'), { ok: false, refused: INTERVAL_HOLD_REFUSED });
  assert.equal(INTERVAL_HOLD_REFUSED, 'Fora da janela de trabalho: o toque não foi aceito.');
  assert.deepEqual(decideIntervalTouch(IV, state, 30, 'hold'), { ok: true, event: { t: 'fill', seg: 'f1', n: 6, at: 30 } });
});

test('o máximo é sempre o último: o toque só vai a ele com os fixos do round na meta, e o segurar nele não faz nada', () => {
  let events = [];
  const tapAt = (seconds, gesture = 'tap') => decideIntervalTouch(IV, deriveIntervalState(IV, events), seconds, gesture);
  for (let index = 0; index < 6; index += 1) events = [...events, tapAt(5 + index).event];
  assert.deepEqual(events.map((event) => event.seg), ['f1', 'f1', 'f1', 'f1', 'f1', 'f1']);
  assert.equal(tapAt(20).event.seg, 'f2', 'com o primeiro fixo na meta, o segundo');
  events = [...events, tapAt(20, 'hold').event];
  assert.deepEqual(events.at(-1), { t: 'fill', seg: 'f2', n: 15, at: 20 });
  assert.deepEqual(tapAt(30), { ok: true, event: { t: 'rep', seg: 'mx', at: 30 } });
  assert.deepEqual(tapAt(30, 'hold'), { ok: false, refused: null }, 'nenhum fill no máximo');
  // Fixo por bloco: só o segurar conclui.
  const block = valid(intervalInput({ totalReps: 30, segments: [fixed('f1', 'Bike', 30, { unit: 'cal', mark: 'end' })] }));
  assert.deepEqual(decideIntervalTouch(block, deriveIntervalState(block, []), 10, 'tap'), { ok: false, refused: null });
  assert.deepEqual(decideIntervalTouch(block, deriveIntervalState(block, []), 10, 'hold').event, { t: 'fill', seg: 'f1', n: 30, at: 10 });
});

test('paridade: em todo segundo da prova, a tela aceita o toque se, e somente se, o motor conta o registro', () => {
  for (const structure of [IV, valid(intervalInput({ timeCapSeconds: 600 }, { offSeconds: 0 })), valid(intervalInput({ timeCapSeconds: 290 }, { rounds: 2, onSeconds: 125, offSeconds: 40 }))]) {
    const end = structure.timeCapSeconds;
    for (let second = 0; second <= end + 5; second += 1) {
      for (const offset of [0, 0.5, 0.99]) {
        const decision = decideIntervalTouch(structure, deriveIntervalState(structure, []), second + offset, 'tap');
        const event = decision.ok ? decision.event : { t: 'rep', seg: 'f1', at: second };
        const counted = deriveIntervalState(structure, [event]).ignored.length === 0;
        assert.equal(decision.ok, counted, `segundo ${second + offset} de ${end}`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Quadro dos rounds (AC5) e cartões de correção (AC7)
// ---------------------------------------------------------------------------

test('quadro dos rounds do atleta A: fixo incompleto no round 5, máximo bruto visível, Conta 0 e total 23', () => {
  const view = model(athleteA(), 250);
  assert.deepEqual(view.columns.map((column) => column.short), ['RMU', 'BJO', 'Squat Clean']);
  assert.deepEqual(view.columns.map((column) => column.name), ['Ring Muscle Ups', 'Box Jump Overs (24/20 in)', 'Squat Clean']);
  assert.deepEqual(view.rows.map((row) => row.counted), [9, 8, 5, 1, 0]);
  assert.deepEqual(view.rows[4], { round: 5, fixed: ['6/6', '11/15'], maxRaw: 4, counted: 0, current: false, flagged: true });
  assert.equal(view.rows[1].current, true, 'o round 2 está em andamento às 04:10');
  assert.equal(view.rows.filter((row) => row.current).length, 1);
  assert.equal(model(athleteA(), 130).rows.some((row) => row.current), false, 'no descanso nenhum round está em andamento');
  assert.equal(view.total, 23);
  assert.equal(view.total, computeIntervalResult(deriveIntervalState(IV, athleteA())).value);
});

test('siglas dos cabeçalhos: sem parênteses e sem palavras que não começam por letra; uma palavra fica inteira', () => {
  assert.equal(intervalColumnShort('Ring Muscle Ups'), 'RMU');
  assert.equal(intervalColumnShort('Box Jump Overs (24/20 in)'), 'BJO');
  assert.equal(intervalColumnShort('Box Jump Overs #24/20in'), 'BJO');
  assert.equal(intervalColumnShort('Thruster'), 'Thruster');
  assert.equal(intervalColumnShort('Pull-up'), 'Pull-up');
  assert.equal(intervalColumnShort('Dumbbell Hang Power Clean Jerk'), 'DHPC', 'até 4 letras');
  assert.equal(intervalColumnShort('toes to bar'), 'TTB');
});

test('cartões de correção: o máximo sempre, o fixo incompleto aberto, os completos recolhidos e o aviso do round ruim', () => {
  const cards = model(athleteA(), 1080).cards;
  assert.equal(cards.length, 5);
  assert.equal(cards[0].statusLabel, 'Trabalho fixo completo');
  assert.equal(cards[0].max.valueLabel, '9');
  assert.deepEqual(cards[0].openFixed, []);
  assert.deepEqual(cards[0].collapsedFixed.map((item) => item.id), ['f1', 'f2']);
  assert.equal(cards[0].warning, null);

  const bad = cards[4];
  assert.equal(bad.scored, false);
  assert.equal(bad.statusLabel, 'Fixo incompleto');
  assert.deepEqual(bad.openFixed.map((item) => [item.name, item.valueLabel]), [['Box Jump Overs (24/20 in)', '11/15']]);
  assert.deepEqual(bad.collapsedFixed.map((item) => item.id), ['f1']);
  assert.equal(bad.max.valueLabel, '4');
  assert.equal(bad.warning, 'O Squat Clean deste round só conta se os fixos chegarem à meta.');
  assert.equal(bad.openFixed[0].canIncrease, true);
  assert.equal(cards[0].collapsedFixed[0].canIncrease, false, 'fixo na meta não passa dela');
  assert.equal(cards[0].max.canDecrease, true);
  assert.equal(model([], 1080).cards[0].max.canDecrease, false);

  // Prova sem fixos: o round sempre pontua e o cartão não tem estado de fixo.
  const onlyMax = valid(intervalInput({ totalReps: 0, segments: [] }));
  assert.equal(model([], 1080, onlyMax).cards[0].statusLabel, null);
});

test('correção por round: adj e set com rd no round do cartão; completar os fixos faz o máximo contar', () => {
  const events = athleteA();
  // O que os cartões emitem (o componente acrescenta at do relógio parado e rd do cartão).
  const stoppedAt = 1080;
  const fix = [...events, { t: 'adj', seg: 'f2', d: 4, at: stoppedAt, rd: 5 }];
  const view = model(fix, stoppedAt);
  assert.equal(view.rows[4].counted, 4);
  assert.equal(view.rows[4].flagged, false);
  assert.equal(view.total, 27);
  assert.equal(view.cards[4].statusLabel, 'Trabalho fixo completo');
  assert.equal(view.cards[4].warning, null);
  // O at do relógio parado não diz o round: vale o rd.
  const set = model([...events, { t: 'set', seg: 'mx', v: 6, at: stoppedAt, rd: 3 }], stoppedAt);
  assert.deepEqual(set.rows.map((row) => row.counted), [9, 8, 6, 1, 0]);
  assert.equal(set.total, 24);

  const component = read('../src/components/sheet/IntervalSheetView.tsx');
  assert.match(component, /onAdjust=\{\(seg, delta\) => emit\(\{ t: 'adj', seg, d: delta, at, rd: card\.round \}\)\}/);
  assert.match(component, /onSet=\{\(seg, value\) => emit\(\{ t: 'set', seg, v: value, at, rd: card\.round \}\)\}/);
});

// ---------------------------------------------------------------------------
// Resultado (AC8)
// ---------------------------------------------------------------------------

test('resultado do atleta A: "23 repetições", o máximo de cada round e o round 5 que não contou', () => {
  const summary = summaryOf(athleteA());
  assert.equal(summary.caption, 'Soma do Squat Clean nos 5 rounds');
  assert.equal(summary.headline, '23 repetições');
  assert.equal(summary.value, '23');
  assert.deepEqual(summary.details, [
    'Round 1: 9 · Round 2: 8 · Round 3: 5 · Round 4: 1',
    'Round 5: 0 (Box Jump Overs (24/20 in) 11/15, o máximo não conta)'
  ]);
  assert.equal(summary.warning, null);
  assert.equal(summary.note, 'O servidor calcula o mesmo resultado a partir dos registros. O número do aparelho não é aceito como está.');
  assert.equal(summaryOf([]).headline, '0 repetições');
  assert.equal(summaryOf([{ t: 'fill', seg: 'f1', n: 6, at: 1 }, { t: 'fill', seg: 'f2', n: 15, at: 2 }, { t: 'rep', seg: 'mx', at: 3 }]).headline, '1 repetição');
});

test('registros fora da janela: aviso no singular e no plural, com horário e motivo de até 3 registros', () => {
  const one = summaryOf([...athleteA(), { t: 'rep', seg: 'mx', at: 120 }]);
  assert.equal(one.warning, '1 registro fora da janela não contou (chegou do aparelho às 02:00, depois do fim do round 1).');
  assert.equal(one.headline, '23 repetições', 'o registro ignorado não muda o resultado');

  const three = summaryOf([{ t: 'rep', seg: 'f1', at: 120 }, { t: 'rep', seg: 'f2', at: 210 }, { t: 'rep', seg: 'mx', at: 1080 }]);
  assert.equal(three.warning, '3 registros fora da janela não contaram (chegaram do aparelho às 02:00, depois do fim do round 1; às 03:30, depois do fim do round 1; às 18:00, depois do fim da prova).');

  const five = summaryOf([120, 130, 360, 1080, 1500].map((at) => ({ t: 'rep', seg: 'mx', at })));
  assert.equal(five.warning, '5 registros fora da janela não contaram (chegaram do aparelho às 02:00, depois do fim do round 1; às 02:10, depois do fim do round 1; às 06:00, depois do fim do round 2; e mais 2).');
});

// ---------------------------------------------------------------------------
// Renderização de servidor em cada estado (AC1 a AC10)
// ---------------------------------------------------------------------------

test('SheetView escolhe a súmula do intervalado pelo formato, sem cair na de segmentos', () => {
  const html = render({});
  assert.match(html, /aria-label="Súmula digital do intervalado"/);
  assert.doesNotMatch(html, /aria-label="Súmula digital"|Súmula digital de carga máxima|Concluir segmento|Time cap/);
  const source = read('../src/components/sheet/SheetView.tsx');
  assert.match(source, /if \(props\.structure\.format === 'interval'\) return <IntervalSheetView \{\.\.\.props\} \/>;/);
  assert.match(source, /props\.structure\.format === 'max_load' \? <MaxLoadSheetView \{\.\.\.props\} \/> : <SegmentSheetView \{\.\.\.props\} \/>/);
});

test('pronta: duração, rounds, o movimento da vez desabilitado com "Inicie o relógio para contar" e o Iniciar', () => {
  const html = render({ context: { workoutName: 'Intervalado 5 × 2′', athleteName: 'Atleta A', laneLabel: 'Raia 3' } });
  assert.match(html, /Intervalado 5 × 2′/);
  assert.match(html, /Não iniciada/);
  assert.match(html, /aria-label="Relógio 00:00"/);
  assert.match(html, /Duração<span[^>]*>18:00<\/span>/);
  assert.match(html, />Round 1 de 5</);
  const tile = tileOf(html);
  assert.match(tile, /disabled=""/);
  assert.match(tile, />Inicie o relógio para contar</);
  assert.match(tile, />Ring Muscle Ups</);
  assert.match(html, />Iniciar</);
  assert.match(html, /role="img" aria-label="5 rounds de 02:00 de trabalho, 02:00 de descanso entre eles, 18:00 no total"/);
  assert.doesNotMatch(html, /Corrigir por round|Soma do Squat Clean/);
  assert.doesNotMatch(html, /bg-primary\/20 font-bold|em andamento/, 'antes do Iniciar nenhum round está em andamento');
});

test('em trabalho: selo, round, contagem regressiva, tile ativo e o round em andamento destacado no quadro', () => {
  const html = render({ phase: 'running', elapsedSeconds: 250, events: athleteA().filter((event) => event.at < 240) });
  assert.match(html, /Relógio da prova/);
  assert.match(html, />Trabalho<\/span><span class="text-sm font-bold">Round 2 de 5<\/span>/);
  assert.match(html, /Restam no round<\/span><span[^>]*>01:50<\/span>/);
  const tile = tileOf(html);
  assert.doesNotMatch(tile, /disabled=""|aria-disabled/);
  assert.match(tile, />Toque \+1 · Segure para concluir</);
  assert.match(html, /<tr class="bg-primary\/20 font-bold"><th scope="row"[^>]*><span aria-hidden="true">R2<\/span><span class="sr-only">Round 2, em andamento<\/span>/);
  assert.match(html, /<th scope="col" title="Ring Muscle Ups"[^>]*><span aria-hidden="true">RMU<\/span><span class="sr-only">Ring Muscle Ups<\/span><\/th>/);
  assert.match(html, /<th scope="col" title="Squat Clean"[^>]*>Squat Clean<\/th>/);
  assert.match(html, />Parar</);
  assert.match(html, /<p class="sr-only" aria-live="polite">Trabalho\. Round 2 de 5\.<\/p>/);
  assert.doesNotMatch(html, /Restam no round[^<]*<\/span><span[^>]*aria-live/, 'a contagem regressiva não é anunciada a cada segundo');
});

test('em descanso e depois do fim: o tile com aria-disabled e o texto do estado', () => {
  const rest = render({ phase: 'running', elapsedSeconds: 130, events: athleteA() });
  assert.match(rest, />Descanso<\/span><span class="text-sm font-bold">Depois do round 1 de 5<\/span>/);
  assert.match(rest, /Próximo round em<\/span><span[^>]*>01:50<\/span>/);
  const restTile = tileOf(rest);
  assert.match(restTile, /aria-disabled="true"/);
  assert.doesNotMatch(restTile, /disabled=""/, 'o toque ainda chega à porta, que recusa com a mensagem');
  assert.match(restTile, />repetições contadas no round 1</);
  assert.match(restTile, />Os registros agora não contam</);

  const ended = render({ phase: 'running', elapsedSeconds: 1085, events: athleteA() });
  assert.match(ended, />Prova encerrada<\/span><span class="text-sm font-bold">5 rounds feitos<\/span>/);
  assert.match(ended, /Pare o relógio<\/span><span[^>]*>00:00<\/span>/);
  const endedTile = tileOf(ended);
  assert.match(endedTile, /aria-disabled="true"/);
  assert.match(endedTile, />Tempo esgotado</);
  assert.match(endedTile, />23</);
  assert.match(endedTile, />Toque em Parar para revisar</);
  assert.match(ended, /Fixo incompleto/, 'o round 5 com máximo bruto aparece destacado em texto');
});

test('parada: correção por round, resultado do motor, aviso de registro fora da janela e nota do servidor', () => {
  const events = [...athleteA(), { t: 'rep', seg: 'mx', at: 120 }];
  const html = render({ phase: 'stopped', elapsedSeconds: 1080, events });
  assert.match(html, /Relógio parado/);
  assert.doesNotMatch(html, /class="relative flex min-h-36/, 'parado, sem o tile de toque');
  assert.doesNotMatch(html, /Restam no round|Pare o relógio/);
  assert.match(html, />Corrigir por round</);
  assert.match(html, /Parado, o relógio não diz a que round um ajuste pertence\. Por isso a correção é feita dentro do round\./);
  assert.equal((html.match(/>Trabalho fixo completo</g) || []).length, 4);
  assert.equal((html.match(/<span class="text-trading-down">Fixo incompleto<\/span>/g) || []).length, 1);
  assert.match(html, /O Squat Clean deste round só conta se os fixos chegarem à meta\./);
  assert.match(html, /aria-label="Somar uma repetição em Box Jump Overs \(24\/20 in\) no round 5"/);
  assert.match(html, /aria-label="Tirar uma repetição de Squat Clean no round 1"/);
  assert.match(html, /!min-h-12 w-12/, '− e + com 48 px');
  assert.match(html, /aria-expanded="false"[^>]*>Ajustar fixos/);
  assert.match(html, /Soma do Squat Clean nos 5 rounds/);
  assert.match(html, />23 <span class="text-lg">repetições<\/span>/);
  assert.match(html, /<li>Round 1: 9 · Round 2: 8 · Round 3: 5 · Round 4: 1<\/li>/);
  assert.match(html, /<li>Round 5: 0 \(Box Jump Overs \(24\/20 in\) 11\/15, o máximo não conta\)<\/li>/);
  assert.match(html, /role="alert"[^>]*>1 registro fora da janela não contou \(chegou do aparelho às 02:00, depois do fim do round 1\)\.</);
  assert.match(html, /O servidor calcula o mesmo resultado a partir dos registros\. O número do aparelho não é aceito como está\./);
  assert.match(html, />Desfazer</);
  assert.doesNotMatch(html, />Iniciar<|>Parar</);
});

test('somente leitura: o estado e o resultado, sem botões de ação nem correção', () => {
  const running = render({ phase: 'running', elapsedSeconds: 250, events: athleteA(), onEvent: undefined, onStart: undefined, onStop: undefined });
  assert.doesNotMatch(running, /Desfazer|Iniciar|>Parar</);
  assert.match(tileOf(running), /disabled=""/);
  const stopped = render({ phase: 'stopped', elapsedSeconds: 1080, events: athleteA(), onEvent: undefined, onStart: undefined, onStop: undefined });
  assert.doesNotMatch(stopped, /Desfazer|Corrigir por round|Ajustar fixos|aria-label="Somar/);
  assert.match(stopped, /Soma do Squat Clean nos 5 rounds/);
});

test('duas súmulas do intervalado na mesma tela não repetem ids', () => {
  const props = { structure: IV, events: athleteA(), phase: 'stopped', elapsedSeconds: 1080, onEvent: () => {} };
  const html = renderToStaticMarkup(createElement('div', null, createElement(SheetView, props), createElement(SheetView, props)));
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(ids.length > 0);
  assert.equal(new Set(ids).size, ids.length);
});

// ---------------------------------------------------------------------------
// Regressão estática do componente
// ---------------------------------------------------------------------------

test('a súmula do intervalado emite pela porta, usa o motor e não grava', () => {
  const component = read('../src/components/sheet/IntervalSheetView.tsx');
  assert.doesNotMatch(component, /fetch\(|useApp|supabase|localStorage|sessionStorage|indexedDB|XMLHttpRequest|WebSocket|text-white|navigator\.vibrate/);
  assert.match(component, /const at = Math\.max\(0, Math\.floor\(Number\.isFinite\(elapsedSeconds\) \? elapsedSeconds : 0\)\);/);
  assert.match(component, /const decision = decideIntervalTouch\(structure, state, at, gesture\);/);
  assert.match(component, /if \(decision\.ok\) emit\(decision\.event\);\n\s+else if \(decision\.refused\) refuse\(decision\.refused\);/);
  assert.match(component, /if \(!counting\) return;/);
  assert.match(component, /deriveIntervalState\(structure, events\)/);
  assert.match(component, /computeIntervalResult\(state\)/);
  assert.match(component, /intervalPhaseAt\(structure, at\)/);
  assert.match(component, /emit\(\{ t: 'undo', of: view\.undoTarget, at \}\)/);
  assert.match(component, /export const REFUSAL_MESSAGE_MS = 2600;/);
  assert.match(component, /motion-reduce:transition-none/);
  const view = read('../src/lib/sheetView.ts');
  assert.match(view, /const check = checkIntervalEntry\(structure, at\);/);
});
