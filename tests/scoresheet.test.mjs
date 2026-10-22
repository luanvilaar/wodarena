import assert from 'node:assert/strict';
import test from 'node:test';

import { importServerModule } from './support/serverModuleHarness.mjs';

// Stories 1.50 e 1.51: o que o servidor aceita do aparelho (validação de cada
// registro da súmula) e o resultado que ele publica, calculado do log pelo
// mesmo motor da súmula. Story 1.59: o resultado atribuído ao atleta ausente.

const { validateClientEvent, computeSheetOutcome, computeAbsentOutcome, ABSENT_OUTCOME_TOO_LONG, MAX_EVENT_SECONDS, SCORESHEET_STATUS_LABELS, SCORESHEET_REVIEW_LABELS } = await importServerModule('lib/scoresheet.ts');
const { validateWorkoutStructure } = await importServerModule('lib/workoutStructure.ts');
const scoring = await importServerModule('lib/scoring.ts');

const segment = (id, round, name, reps, extra = {}) => ({ id, round, name, reps, unit: 'reps', load: null, note: '', required: true, mark: 'reps', ...extra });
const base = { version: 2, generator: null, customized: true, entry: { mode: 'both', marking: 'reps', publish: 'after_review' }, maxLoad: null, scoreDisplay: null };
const valid = (input) => {
  const checked = validateWorkoutStructure(input);
  assert.equal(checked.ok, true, checked.error);
  return checked.structure;
};

const FRAN = valid({
  ...base, format: 'for_time', totalReps: 90, timeCapSeconds: 600,
  incomplete: { rule: 'penalty_per_rep', secondsPerRep: 1, base: 'time_cap' },
  tieBreak: { kind: 'split_time', at: 's2', order: 'asc' },
  segments: [
    segment('s1', 1, 'Thruster', 21), segment('s2', 1, 'Pull-up', 21),
    segment('s3', 2, 'Thruster', 15), segment('s4', 2, 'Pull-up', 15),
    segment('s5', 3, 'Thruster', 9), segment('s6', 3, 'Pull-up', 9)
  ]
});
const CINDY = valid({
  ...base, format: 'amrap', totalReps: 30, timeCapSeconds: 1200, incomplete: null,
  tieBreak: { kind: 'last_round', order: 'asc' }, scoreDisplay: 'rounds_reps',
  segments: [segment('c1', 1, 'Pull-up', 5), segment('c2', 1, 'Push-up', 10), segment('c3', 1, 'Air squat', 15)]
});
const TOTAL = valid({
  ...base, format: 'max_load', totalReps: 0, timeCapSeconds: 1200, incomplete: null,
  tieBreak: { kind: 'finish_time', order: 'asc' }, segments: [],
  maxLoad: {
    lifts: [
      { id: 'l1', name: 'Back Squat', reps: 1, maxAttempts: 3, startLoadKg: 100, note: '' },
      { id: 'l2', name: 'Deadlift', reps: 1, maxAttempts: 3, startLoadKg: 120, note: '' }
    ],
    order: 'fixed', scoring: 'sum', loadStepKg: 2.5
  }
});

const ev = (id, event) => ({ id, event });
const accepts = (structure, raw, position = 0) => {
  const checked = validateClientEvent(raw, structure, position);
  assert.equal(checked.ok, true, checked.error);
  return checked;
};
const rejects = (structure, raw, pattern, position = 0) => {
  const checked = validateClientEvent(raw, structure, position);
  assert.equal(checked.ok, false, JSON.stringify(raw));
  if (pattern) assert.match(checked.error, pattern);
};

test('validateClientEvent: aceita e normaliza cada tipo de registro (só os campos do contrato)', () => {
  assert.deepEqual(accepts(FRAN, ev('a1', { t: 'rep', seg: 's1', at: 3, extra: 'x' })), { ok: true, id: 'a1', event: { t: 'rep', seg: 's1', at: 3 } });
  assert.deepEqual(accepts(FRAN, ev('a2', { t: 'fill', seg: 's1', n: 21, at: 60 })).event, { t: 'fill', seg: 's1', n: 21, at: 60 });
  assert.deepEqual(accepts(FRAN, ev('a3', { t: 'set', seg: 's2', v: 0, at: 61 })).event, { t: 'set', seg: 's2', v: 0, at: 61 });
  assert.deepEqual(accepts(FRAN, ev('a4', { t: 'adj', seg: 's2', d: -1, at: 62 })).event, { t: 'adj', seg: 's2', d: -1, at: 62 });
  assert.deepEqual(accepts(FRAN, ev('a5', { t: 'undo', of: 2, at: 63 }), 3).event, { t: 'undo', of: 2, at: 63 });
  assert.deepEqual(accepts(FRAN, ev('a6', { t: 'time', target: 'final', v: 578, at: 600 })).event, { t: 'time', target: 'final', v: 578, at: 600 });
  assert.deepEqual(accepts(TOTAL, ev('b1', { t: 'attempt', lift: 'l1', load: 102.5, ok: true, at: 90 })).event, { t: 'attempt', lift: 'l1', load: 102.5, ok: true, at: 90 });
  assert.equal(accepts(CINDY, ev('c1', { t: 'rep', seg: 'c3', at: MAX_EVENT_SECONDS })).event.at, MAX_EVENT_SECONDS);
});

test('validateClientEvent: recusa o que não pertence à prova, fora de faixa ou malformado', () => {
  rejects(FRAN, ev('x', { t: 'rep', seg: 's9', at: 1 }), /^Registro 1: etapa inexistente na prova\.$/);
  rejects(FRAN, ev('x', { t: 'rep', seg: 's1', at: -1 }), /instante do relógio inválido/);
  rejects(FRAN, ev('x', { t: 'rep', seg: 's1', at: 1.5 }), /instante/);
  rejects(FRAN, ev('x', { t: 'rep', seg: 's1', at: MAX_EVENT_SECONDS + 1 }), /instante/);
  rejects(FRAN, ev('x', { t: 'fill', seg: 's1', n: -1, at: 1 }), /quantidade inválida/);
  rejects(FRAN, ev('x', { t: 'adj', seg: 's1', d: 0, at: 1 }), /correção inválida/);
  rejects(FRAN, ev('x', { t: 'undo', of: 3, at: 1 }), /^Registro 4: o desfazer aponta para um registro inexistente\.$/, 3);
  rejects(FRAN, ev('x', { t: 'undo', of: 0, at: 1 }), /desfazer/, 0);
  rejects(FRAN, ev('x', { t: 'time', target: 'final', v: 601, at: 1 }), /entre 00:01 e 10:00/);
  rejects(FRAN, ev('x', { t: 'time', target: 'ambos', v: 100, at: 1 }), /sem alvo/);
  rejects(FRAN, ev('x', { t: 'attempt', lift: 'l1', load: 100, ok: true, at: 1 }), /movimento inexistente/);
  rejects(TOTAL, ev('x', { t: 'rep', seg: 's1', at: 1 }), /etapa inexistente/);
  rejects(TOTAL, ev('x', { t: 'time', target: 'tiebreak', v: 10, at: 1 }), /não vale para esta prova/);
  rejects(TOTAL, ev('x', { t: 'attempt', lift: 'l1', load: 100.123, ok: true, at: 1 }), /a carga deve ficar entre 0 e 500 kg/);
  rejects(TOTAL, ev('x', { t: 'attempt', lift: 'l1', load: 501, ok: true, at: 1 }), /carga/);
  rejects(TOTAL, ev('x', { t: 'attempt', lift: 'l1', load: 100, at: 1 }), /válida ou no-rep/);
  rejects(FRAN, ev('com espaço', { t: 'rep', seg: 's1', at: 1 }), /identificador do aparelho/);
  rejects(FRAN, ev('x'.repeat(65), { t: 'rep', seg: 's1', at: 1 }), /identificador do aparelho/);
  rejects(FRAN, ev('x', { t: 'jump', at: 1 }), /tipo de registro desconhecido/);
  for (const raw of [null, 'rep', [], { id: 'x' }, { id: 'x', event: [] }]) rejects(FRAN, raw, /formato inválido|identificador/);
});

test('computeSheetOutcome: For Time concluído, no cap e com desempate depois do fim', () => {
  const finished = computeSheetOutcome(FRAN, [
    { t: 'fill', seg: 's1', n: 21, at: 120 }, { t: 'fill', seg: 's2', n: 21, at: 271 },
    { t: 'fill', seg: 's3', n: 15, at: 380 }, { t: 'fill', seg: 's4', n: 15, at: 470 },
    { t: 'fill', seg: 's5', n: 9, at: 530 }, { t: 'fill', seg: 's6', n: 9, at: 581 }
  ]);
  assert.deepEqual(finished, { ok: true, result: '09:41', value: 581, tieBreak: '04:31', summary: 'Concluída em 09:41' });
  assert.deepEqual(scoring.parseScoreForWorkout('fortime', finished.result), { result: '09:41', value: 581 });

  const capped = computeSheetOutcome(FRAN, [{ t: 'fill', seg: 's1', n: 21, at: 200 }, { t: 'fill', seg: 's2', n: 21, at: 400 }, { t: 'set', seg: 's3', v: 10, at: 600 }]);
  assert.equal(capped.result, '10:38');
  assert.equal(capped.value, 638);
  assert.equal(capped.summary, '52 de 90 no cap (10:38)');

  const after = computeSheetOutcome(FRAN, [
    { t: 'fill', seg: 's1', n: 21, at: 120 }, { t: 'fill', seg: 's2', n: 21, at: 271 },
    { t: 'fill', seg: 's3', n: 15, at: 380 }, { t: 'fill', seg: 's4', n: 15, at: 470 },
    { t: 'fill', seg: 's5', n: 9, at: 530 }, { t: 'fill', seg: 's6', n: 9, at: 581 },
    { t: 'time', target: 'final', v: 260, at: 590 }
  ]);
  assert.deepEqual(after, { ok: false, error: 'O tempo do tie-break ficou depois do fim da prova. Ajuste antes de enviar.' });
});

test('computeSheetOutcome: AMRAP pelo total e carga máxima em kg; carga máxima sem tentativa não envia', () => {
  const reps = Array.from({ length: 222 }, (_, index) => ({ t: 'rep', seg: ['c1', 'c2', 'c3'][[...Array(5).fill(0), ...Array(10).fill(1), ...Array(15).fill(2)][index % 30]], at: (index + 1) * 5 }));
  const amrap = computeSheetOutcome(CINDY, reps);
  assert.equal(amrap.ok, true);
  assert.equal(amrap.result, '222');
  assert.equal(amrap.value, 222);
  assert.equal(amrap.tieBreak, '17:30');
  assert.equal(amrap.summary, '7 rounds + 12 (total 222)');

  const total = computeSheetOutcome(TOTAL, [
    { t: 'attempt', lift: 'l1', load: 140, ok: true, at: 60 },
    { t: 'attempt', lift: 'l1', load: 147.5, ok: true, at: 200 },
    { t: 'attempt', lift: 'l2', load: 180, ok: false, at: 400 }
  ]);
  assert.deepEqual(total, { ok: true, result: '147.5', value: 147.5, tieBreak: '06:40', summary: '147,5 kg em 3 tentativas' });
  assert.deepEqual(scoring.parseScoreForWorkout('maxweight', total.result), { result: '147.5', value: 147.5 });
  assert.deepEqual(computeSheetOutcome(TOTAL, []), { ok: false, error: 'Registre ao menos uma tentativa antes de enviar.' });
});

test('rótulos dos estados seguem a seção 7 do documento (enviada = publicada, decisão 3)', () => {
  assert.deepEqual(SCORESHEET_STATUS_LABELS, {
    not_started: 'Não iniciada', in_progress: 'Em andamento', submitted: 'Publicada', returned: 'Devolvida para correção', cancelled: 'Cancelada'
  });
});

// ---------------------------------------------------------------------------
// Atleta ausente (Story 1.59, AC2 e AC10)
// ---------------------------------------------------------------------------

// For Time do exemplo aprovado: cap 12:00, 150 repetições, 1 s por repetição faltante, sem desempate.
const forTime150 = (secondsPerRep) => valid({
  ...base, format: 'for_time', totalReps: 150, timeCapSeconds: 720,
  incomplete: { rule: 'penalty_per_rep', secondsPerRep, base: 'time_cap' },
  tieBreak: null,
  segments: [
    segment('f1', 1, 'Wall ball', 50), segment('f2', 1, 'Pull-up', 50), segment('f3', 1, 'Burpee', 50)
  ]
});

test('computeAbsentOutcome: For Time = cap + repetições × penalidade (exemplo aprovado 14:30) e o cap com 0 s', () => {
  const absent = computeAbsentOutcome(forTime150(1));
  assert.deepEqual(absent, { ok: true, result: '14:30', value: 870, tieBreak: null, summary: 'Atleta ausente · 14:30' });
  assert.deepEqual(scoring.parseScoreForWorkout('fortime', absent.result), { result: '14:30', value: 870 });
  assert.deepEqual(computeAbsentOutcome(forTime150(0)), { ok: true, result: '12:00', value: 720, tieBreak: null, summary: 'Atleta ausente · 12:00' });
  // Fran: cap 10:00 + 90 × 1 s.
  assert.deepEqual([computeAbsentOutcome(FRAN).result, computeAbsentOutcome(FRAN).value], ['11:30', 690]);
});

test('computeAbsentOutcome: AMRAP 0 repetições e carga máxima 0 kg, sem desempate', () => {
  assert.deepEqual(computeAbsentOutcome(CINDY), { ok: true, result: '0', value: 0, tieBreak: null, summary: 'Atleta ausente · 0 repetições' });
  assert.deepEqual(computeAbsentOutcome(TOTAL), { ok: true, result: '0', value: 0, tieBreak: null, summary: 'Atleta ausente · 0 kg' });
  assert.deepEqual(scoring.parseScoreForWorkout('amrap', '0'), { result: '0', value: 0 });
  assert.deepEqual(scoring.parseScoreForWorkout('maxweight', '0'), { result: '0', value: 0 });
});

test('computeAbsentOutcome: For Time e AMRAP dão o mesmo resultado que o motor com o log vazio', () => {
  for (const structure of [forTime150(1), forTime150(0), FRAN, CINDY]) {
    const engine = computeSheetOutcome(structure, []);
    const absent = computeAbsentOutcome(structure);
    assert.equal(engine.ok, true);
    assert.deepEqual([absent.result, absent.value], [engine.result, engine.value]);
  }
});

test('computeAbsentOutcome: estrutura extrema (tempo acima de 99:59:59) devolve erro, como computeSheetOutcome', () => {
  const extreme = valid({
    ...base, format: 'for_time', totalReps: 10000, timeCapSeconds: 5999,
    incomplete: { rule: 'penalty_per_rep', secondsPerRep: 60, base: 'time_cap' },
    tieBreak: null,
    segments: [{ ...segment('m1', 1, 'Row', 10000), unit: 'm', mark: 'end' }]
  });
  assert.deepEqual(computeAbsentOutcome(extreme), { ok: false, error: ABSENT_OUTCOME_TOO_LONG });
  assert.equal(computeSheetOutcome(extreme, []).ok, false);
});

test('histórico: a ação absent tem o rótulo "Atleta ausente"', () => {
  assert.equal(SCORESHEET_REVIEW_LABELS.absent, 'Atleta ausente');
});

// ---------------------------------------------------------------------------
// Story 1.60: Intervalado (5 × 02:00 ON / 02:00 OFF, fixos 6 + 15, máximo Squat Clean)
// ---------------------------------------------------------------------------

const INTERVAL = valid({
  ...base, version: 3, format: 'interval', totalReps: 21, timeCapSeconds: 1080, incomplete: null, tieBreak: null,
  segments: [segment('f1', 1, 'Ring Muscle Up', 6), segment('f2', 1, 'Box Jump Over', 15)],
  interval: { rounds: 5, onSeconds: 120, offSeconds: 120, max: { id: 'mx', name: 'Squat Clean', load: { value: 80, unit: 'kg' }, note: '' } }
});

test('validateClientEvent no intervalado: fixos e máximo, rd nas correções, fill só nos fixos, time recusado, fora da janela aceito', () => {
  assert.deepEqual(accepts(INTERVAL, ev('i1', { t: 'rep', seg: 'f1', at: 35 })).event, { t: 'rep', seg: 'f1', at: 35 });
  assert.deepEqual(accepts(INTERVAL, ev('i2', { t: 'rep', seg: 'mx', at: 119 })).event, { t: 'rep', seg: 'mx', at: 119 });
  assert.deepEqual(accepts(INTERVAL, ev('i3', { t: 'fill', seg: 'f2', n: 15, at: 60 })).event, { t: 'fill', seg: 'f2', n: 15, at: 60 });
  // Fora da janela (descanso, depois do fim) é aceito e gravado: o motor ignora e a súmula avisa.
  assert.deepEqual(accepts(INTERVAL, ev('i4', { t: 'rep', seg: 'mx', at: 210 })).event, { t: 'rep', seg: 'mx', at: 210 });
  assert.deepEqual(accepts(INTERVAL, ev('i5', { t: 'fill', seg: 'f1', n: 6, at: 1080 })).event, { t: 'fill', seg: 'f1', n: 6, at: 1080 });
  // set e adj levam o round da correção no evento normalizado.
  assert.deepEqual(accepts(INTERVAL, ev('i6', { t: 'set', seg: 'mx', v: 7, at: 1100, rd: 3, extra: 1 })).event, { t: 'set', seg: 'mx', v: 7, at: 1100, rd: 3 });
  assert.deepEqual(accepts(INTERVAL, ev('i7', { t: 'adj', seg: 'f2', d: -1, at: 1100, rd: 5 })).event, { t: 'adj', seg: 'f2', d: -1, at: 1100, rd: 5 });
  assert.deepEqual(accepts(INTERVAL, ev('i8', { t: 'undo', of: 0, at: 40 }), 1).event, { t: 'undo', of: 0, at: 40 });

  for (const rd of [undefined, 0, 6, 2.5, '3', null]) {
    rejects(INTERVAL, ev('x', { t: 'set', seg: 'mx', v: 7, at: 1100, rd }), /^Registro 1: informe o round da correção \(de 1 a 5\)\.$/);
    rejects(INTERVAL, ev('x', { t: 'adj', seg: 'f1', d: 1, at: 1100, rd }), /informe o round da correção/);
  }
  rejects(INTERVAL, ev('x', { t: 'fill', seg: 'mx', n: 5, at: 30 }), /^Registro 1: o movimento máximo não tem meta a concluir\.$/);
  rejects(INTERVAL, ev('x', { t: 'rep', seg: 's1', at: 30 }), /etapa inexistente na prova/);
  rejects(INTERVAL, ev('x', { t: 'time', target: 'final', v: 600, at: 1080 }), /^Registro 1: o ajuste do tempo não vale para esta prova\.$/);
  rejects(INTERVAL, ev('x', { t: 'time', target: 'tiebreak', v: 600, at: 1080 }), /não vale para esta prova/);
  rejects(INTERVAL, ev('x', { t: 'attempt', lift: 'mx', load: 80, ok: true, at: 30 }), /movimento inexistente/);

  // Nos outros formatos o rd recebido é descartado.
  assert.deepEqual(accepts(FRAN, ev('f1', { t: 'set', seg: 's2', v: 3, at: 61, rd: 2 })).event, { t: 'set', seg: 's2', v: 3, at: 61 });
  assert.deepEqual(accepts(CINDY, ev('f2', { t: 'adj', seg: 'c1', d: 1, at: 61, rd: 'x' })).event, { t: 'adj', seg: 'c1', d: 1, at: 61 });
  // O id do máximo não vale fora do intervalado, nem o máximo de outra prova.
  rejects(FRAN, ev('x', { t: 'rep', seg: 'mx', at: 1 }), /etapa inexistente/);
});

test('computeSheetOutcome e computeAbsentOutcome no intervalado: repetições, sem desempate; o ausente coincide com o log vazio', () => {
  const log = [
    { t: 'fill', seg: 'f1', n: 6, at: 10 }, { t: 'fill', seg: 'f2', n: 15, at: 40 },
    { t: 'rep', seg: 'mx', at: 60 }, { t: 'rep', seg: 'mx', at: 70 }, { t: 'rep', seg: 'mx', at: 119 },
    { t: 'rep', seg: 'mx', at: 120 },
    { t: 'fill', seg: 'f1', n: 6, at: 250 }, { t: 'rep', seg: 'mx', at: 300 },
    { t: 'set', seg: 'f2', v: 15, at: 1100, rd: 2 }
  ];
  const outcome = computeSheetOutcome(INTERVAL, log);
  assert.deepEqual(outcome, { ok: true, result: '4', value: 4, tieBreak: null, summary: '4 repetições em 5 rounds (2 pontuaram)' });
  assert.deepEqual(scoring.parseScoreForWorkout('reps', outcome.result), { result: '4', value: 4 });
  assert.notEqual(outcome.result, '18:00', 'não cai no caminho de For Time');

  const one = computeSheetOutcome(INTERVAL, [{ t: 'fill', seg: 'f1', n: 6, at: 10 }, { t: 'fill', seg: 'f2', n: 15, at: 40 }, { t: 'rep', seg: 'mx', at: 60 }]);
  assert.equal(one.summary, '1 repetição em 5 rounds (1 pontuou)');
  assert.deepEqual(computeSheetOutcome(INTERVAL, []), { ok: true, result: '0', value: 0, tieBreak: null, summary: '0 repetições em 5 rounds (0 pontuaram)' });

  const absent = computeAbsentOutcome(INTERVAL);
  assert.deepEqual(absent, { ok: true, result: '0', value: 0, tieBreak: null, summary: 'Atleta ausente · 0 repetições' });
  const empty = computeSheetOutcome(INTERVAL, []);
  assert.deepEqual([absent.result, absent.value, absent.tieBreak], [empty.result, empty.value, empty.tieBreak]);
});
