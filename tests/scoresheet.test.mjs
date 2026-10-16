import assert from 'node:assert/strict';
import test from 'node:test';

import { importServerModule } from './support/serverModuleHarness.mjs';

// Stories 1.50 e 1.51: o que o servidor aceita do aparelho (validação de cada
// registro da súmula) e o resultado que ele publica, calculado do log pelo
// mesmo motor da súmula.

const { validateClientEvent, computeSheetOutcome, MAX_EVENT_SECONDS, SCORESHEET_STATUS_LABELS } = await importServerModule('lib/scoresheet.ts');
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
