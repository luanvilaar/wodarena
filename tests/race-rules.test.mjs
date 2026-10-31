import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { importServerModule } from './support/serverModuleHarness.mjs';

// Story 1.93 (F0 da súmula Fitness Race): regulamento como dado e motor de
// regras puro. Valores dos presets vêm do planonovo.md (a conferir, D6).

const rules = await importServerModule('lib/raceRules.ts');
const presets = await importServerModule('lib/raceRulePresets.ts');
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const P25 = presets.RACE_RULE_PRESET_2025_26;
const P26 = presets.RACE_RULE_PRESET_2026_27;

const stage = (id, name, extra = {}) => rules.toRaceCourseStage({ id, name, type: 'station', orderIndex: 2, ...extra }, extra.units !== undefined ? { expectedUnits: extra.units } : {});
const wallBall = (reps = 100) => stage('wall-balls', 'Wall Balls', { reps });
const sled = (units = 4) => stage('sled-push', 'Sled Push', { distance: '50m', units });
const lunges = (units) => stage('sandbag-lunges', 'Sandbag Lunges', { distance: '100m', ...(units ? { units } : {}) });
const farmers = (units) => stage('farmers-carry', 'Farmers Carry', { distance: '200m', ...(units ? { units } : {}) });

const reps = (count) => Array.from({ length: count }, () => ({ t: 'rep' }));
const sections = (count) => Array.from({ length: count }, () => ({ t: 'section' }));
const pick = (result, key) => result.infractions.map((item) => item[key]);

test('motor e presets puros: sem React, Supabase, fetch ou relógio', () => {
  for (const file of ['../src/lib/raceRules.ts', '../src/lib/raceRulePresets.ts']) {
    const source = read(file);
    const imports = source.match(/^import .+$/gm) ?? [];
    assert.deepEqual(imports.filter((line) => !/^import type /.test(line)), [], file);
    assert.doesNotMatch(source, /\bfetch\(|Date\.now|new Date\(|performance\.now|createClient|process\.env/, file);
  }
});

test('nenhum valor de temporada no motor: sem leitura de preset nem comparação com 2025/26 ou 2026/27', () => {
  const source = read('../src/lib/raceRules.ts');
  assert.doesNotMatch(source, /\.preset\b/);
  assert.doesNotMatch(source, /===\s*'202[56]_2[67]'/);
  assert.doesNotMatch(source, /HYROX/i);
});

test('presets: nome "Fitness Race", marcados como a conferir e sem carga, distância ou reps', () => {
  assert.deepEqual(Object.keys(presets.RACE_RULE_PRESETS), ['2025_26', '2026_27']);
  for (const preset of [P25, P26]) {
    assert.match(preset.name, /^Fitness Race 20\d\d\/\d\d$/);
    assert.doesNotMatch(JSON.stringify(preset), /hyrox/i);
    assert.equal(preset.verified, false);
    assert.doesNotMatch(JSON.stringify(preset), /kg|weight|distance|"reps"/i);
    assert.equal(preset.immediateConsumesWarning, true);
  }
  assert.equal(presets.RACE_RULESET_UNVERIFIED_NOTE, 'A conferir com o regulamento oficial');
  assert.equal(P25.preset, '2025_26');
  assert.equal(P26.preset, '2026_27');
});

test('catálogos: motivos de no-rep do Wall Ball, gerais e códigos sem colisão entre estação e gerais', () => {
  assert.deepEqual(P26.wallBall.noRepReasons.map((item) => item.label), [
    'Agachamento raso', 'Errou o alvo', 'Alvo errado', 'Não iniciou em pé', 'Pegou após quicar', 'Lançou com uma mão'
  ]);
  const generalCodes = new Set(P26.general.map((item) => item.code));
  for (const preset of [P25, P26]) {
    for (const kind of Object.keys(preset.stations)) {
      for (const reason of preset.stations[kind].reasons) assert.equal(generalCodes.has(reason.code), false, reason.code);
    }
  }
  assert.equal(P26.stations.wall_ball.warnings, 0);
  assert.equal(P26.stations.sled.warnings, 1);
  assert.equal(P26.stations.sled.secondsAfterWarning, 15);
});

test('regulamento custom sai de um preset, independente dele e sem a marca de conferido', () => {
  const custom = rules.createCustomRaceRuleset({ ...P26, verified: true });
  assert.equal(custom.preset, 'custom');
  assert.equal(custom.name, 'Fitness Race 2026/27 (personalizado)');
  assert.equal(custom.verified, false);
  custom.general.find((item) => item.code === 'external_help').seconds = 180;
  assert.equal(P26.general.find((item) => item.code === 'external_help').seconds, 120);
  assert.equal(rules.createCustomRaceRuleset(P25, 'Meu evento').name, 'Meu evento');
});

test('tipo da estação pelo id da biblioteca ou pelo nome; desconhecida e corrida viram genérica', () => {
  const kind = (id, name, type = 'station') => rules.resolveRaceStationKind({ id, name, type });
  assert.equal(kind('ski-erg', 'Ski Erg'), 'ergometer');
  assert.equal(kind('row', 'Row'), 'ergometer');
  assert.equal(kind('sled-push', 'Sled Push'), 'sled');
  assert.equal(kind('sled-pull', 'Sled Pull'), 'sled');
  assert.equal(kind('burpee-broad-jump', 'Burpee Broad Jump'), 'sections');
  assert.equal(kind('farmers-carry', 'Farmers Carry'), 'sections');
  assert.equal(kind('sandbag-lunges', 'Sandbag Lunges'), 'sections');
  assert.equal(kind('wall-balls', 'Wall Balls'), 'wall_ball');
  assert.equal(kind('station-x', 'Wall Balls'), 'wall_ball');
  assert.equal(kind('custom-1', 'Kettlebell Swing'), 'generic');
  assert.equal(kind('run-1', 'Run 1', 'run'), 'generic');
  const snapshot = rules.toRaceCourseStage({ id: 'sled-pull', name: 'Sled Pull', type: 'station', orderIndex: 6, distance: '50m', maleWeight: '103kg' }, { expectedUnits: 4 });
  assert.deepEqual({ kind: snapshot.kind, expectedUnits: snapshot.expectedUnits, maleWeight: snapshot.maleWeight }, { kind: 'sled', expectedUnits: 4, maleWeight: '103kg' });
});

test('estações 1 a 7: 1ª infração é advertência; 2ª e 3ª valem 15 s mesmo com motivo diferente', () => {
  const result = rules.evaluateRaceStation(P26, sled(), [
    { t: 'start' },
    { t: 'infraction', code: 'lane_invaded' },
    { t: 'infraction', code: 'turned_before_line' },
    { t: 'infraction', code: 'lane_invaded' }
  ]);
  assert.deepEqual(pick(result, 'kind'), ['warning', 'penalty', 'penalty']);
  assert.deepEqual(pick(result, 'seconds'), [0, 15, 15]);
  assert.deepEqual(pick(result, 'status'), ['confirmed', 'confirmed', 'confirmed']);
  assert.equal(result.penaltySeconds, 30);
});

test('D13: infração imediata cobra desde a 1ª e consome a advertência da estação', () => {
  const result = rules.evaluateRaceStation(P26, lunges(), [
    { t: 'start' },
    { t: 'infraction', code: 'sandbag_outside_shoulders' },
    { t: 'infraction', code: 'knee_not_touching' }
  ]);
  assert.deepEqual(pick(result, 'kind'), ['penalty', 'penalty']);
  assert.deepEqual(pick(result, 'seconds'), [15, 15]);
  assert.equal(result.penaltySeconds, 30);
});

test('a regra de consumir a advertência é um campo do regulamento: desligada, a próxima infração vira advertência', () => {
  const ruleset = { ...rules.createCustomRaceRuleset(P26), immediateConsumesWarning: false };
  const result = rules.evaluateRaceStation(ruleset, lunges(), [
    { t: 'start' },
    { t: 'infraction', code: 'sandbag_outside_shoulders' },
    { t: 'infraction', code: 'knee_not_touching' }
  ]);
  assert.deepEqual(pick(result, 'kind'), ['penalty', 'warning']);
  assert.equal(result.penaltySeconds, 15);
});

test('motivo imediato e segundos são configuráveis por motivo no regulamento', () => {
  const ruleset = rules.createCustomRaceRuleset(P26);
  ruleset.stations.sled.reasons.find((item) => item.code === 'push_backwards').immediate = true;
  ruleset.stations.sled.reasons.find((item) => item.code === 'push_backwards').seconds = 30;
  const result = rules.evaluateRaceStation(ruleset, sled(), [{ t: 'start' }, { t: 'infraction', code: 'push_backwards' }]);
  assert.deepEqual(pick(result, 'seconds'), [30]);
  assert.deepEqual(pick(result, 'kind'), ['penalty']);
});

test('Wall Ball: 100 reps travam o contador e o 101º rep é recusado', () => {
  const result = rules.evaluateRaceStation(P26, wallBall(), [{ t: 'start' }, ...reps(101)]);
  assert.equal(result.validReps, 100);
  assert.equal(result.state, 'completed');
  assert.deepEqual(result.rejected, [{ seq: 101, error: 'contador travado em 100 repetições.' }]);
  const check = rules.checkRaceEvent(P26, wallBall(), [{ t: 'start' }, ...reps(100)], { t: 'rep' });
  assert.equal(check.ok, false);
  assert.match(check.error, /travado/);
  assert.deepEqual(rules.checkRaceEvent(P26, wallBall(), [{ t: 'start' }, ...reps(99)], { t: 'rep' }), { ok: true });
});

test('Wall Ball: sair com 94 de 100 gera 6 × 15 s = 90 s; sair com 100 não gera nada', () => {
  const short = rules.evaluateRaceStation(P26, wallBall(), [{ t: 'start' }, ...reps(94), { t: 'exit' }]);
  assert.equal(short.state, 'left_incomplete');
  assert.equal(short.missing, 6);
  assert.deepEqual(short.infractions.map(({ code, seconds, units, status }) => ({ code, seconds, units, status })), [
    { code: 'missing_reps', seconds: 90, units: 6, status: 'confirmed' }
  ]);
  assert.equal(short.penaltySeconds, 90);

  const full = rules.evaluateRaceStation(P26, wallBall(), [{ t: 'start' }, ...reps(100), { t: 'exit' }]);
  assert.equal(full.state, 'released');
  assert.equal(full.penaltySeconds, 0);
  assert.equal(full.infractions.length, 0);

  const released = rules.evaluateRaceStation(P26, wallBall(), [{ t: 'start' }, ...reps(100), { t: 'release' }]);
  assert.equal(released.state, 'released');
  const early = rules.evaluateRaceStation(P26, wallBall(), [{ t: 'start' }, ...reps(94), { t: 'release' }]);
  assert.equal(early.state, 'in_progress');
  // D22: sair antes das reps não fecha o tempo; a recusa orienta a completar, não a registrar a saída.
  assert.equal(early.rejected[0].error, 'faltam 6 repetições: oriente o atleta a completar; o tempo só fecha na liberação com as 100 repetições.');
  assert.doesNotMatch(early.rejected[0].error, /registre a saída/);
});

test('Wall Ball: no-rep não conta, motivo vem do regulamento, magnésio = 120 s e sem advertência', () => {
  const result = rules.evaluateRaceStation(P26, wallBall(), [
    { t: 'start' },
    { t: 'rep' },
    { t: 'norep', reason: 'shallow_squat' },
    { t: 'norep', reason: 'inventado' },
    { t: 'chalk' },
    { t: 'infraction', code: 'litter' }
  ]);
  assert.equal(result.validReps, 1);
  assert.deepEqual(result.noReps, [{ seq: 2, reason: 'shallow_squat' }]);
  assert.deepEqual(result.rejected, [{ seq: 3, error: 'motivo de no-rep desconhecido.' }]);
  assert.deepEqual(pick(result, 'code'), ['wall_ball_chalk', 'litter']);
  assert.deepEqual(pick(result, 'seconds'), [120, 120]);
  assert.equal(result.infractions.some((item) => item.kind === 'warning'), false);
});

test('Wall Ball: undo de rep reduz o contador e destrava; reps lidas do percurso (80 trava em 80)', () => {
  const undone = rules.evaluateRaceStation(P26, wallBall(), [{ t: 'start' }, ...reps(100), { t: 'undo', of: 100 }, { t: 'rep' }]);
  assert.equal(undone.validReps, 100);
  assert.deepEqual(undone.voided, [100]);
  assert.equal(undone.rejected.length, 0);

  const eighty = rules.evaluateRaceStation(P26, wallBall(80), [{ t: 'start' }, ...reps(81), { t: 'exit' }]);
  assert.equal(eighty.validReps, 80);
  assert.equal(eighty.targetReps, 80);
  assert.equal(eighty.rejected.length, 1);
  assert.equal(eighty.penaltySeconds, 0);

  const missing = rules.evaluateRaceStation(P26, wallBall(80), [{ t: 'start' }, ...reps(70), { t: 'exit' }]);
  assert.equal(missing.penaltySeconds, 150);
});

test('devolução incorreta = 30 s, cancelada se corrigida antes de sair da Roxzone', () => {
  const corrected = rules.evaluateRaceStation(P26, farmers(), [
    { t: 'start' },
    { t: 'return_wrong' },
    { t: 'exit' },
    { t: 'return_corrected' },
    { t: 'leave_roxzone' }
  ]);
  assert.deepEqual(pick(corrected, 'status'), ['cancelled']);
  assert.deepEqual(pick(corrected, 'seconds'), [30]);
  assert.equal(corrected.penaltySeconds, 0);

  const late = rules.evaluateRaceStation(P26, farmers(), [
    { t: 'start' },
    { t: 'return_wrong' },
    { t: 'exit' },
    { t: 'leave_roxzone' },
    { t: 'return_corrected' }
  ]);
  assert.deepEqual(pick(late, 'status'), ['confirmed']);
  assert.equal(late.penaltySeconds, 30);
  assert.equal(late.rejected[0].seq, 4);
  assert.match(late.rejected[0].error, /Roxzone/);
});

test('carga errada: REFAZER pendente; refeita segue sem punição; não refeita cobra 3 min, sem DQ', () => {
  const redo = rules.evaluateRaceStation(P26, lunges(), [{ t: 'start' }, { t: 'wrong_load' }]);
  assert.equal(redo.state, 'redo');
  assert.deepEqual(redo.infractions.map(({ kind, status, seconds }) => ({ kind, status, seconds })), [{ kind: 'redo', status: 'pending', seconds: 0 }]);
  assert.equal(redo.rejected.length, 0);
  assert.equal(rules.evaluateRaceStation(P26, lunges(), [{ t: 'start' }, { t: 'wrong_load' }, { t: 'release' }]).rejected.length, 1);

  const done = rules.evaluateRaceStation(P26, lunges(), [{ t: 'start' }, { t: 'wrong_load' }, { t: 'redo_done' }]);
  assert.equal(done.state, 'in_progress');
  assert.equal(done.penaltySeconds, 0);
  assert.equal(done.infractions.length, 1);
  assert.equal(done.infractions[0].resolution, 'redone');

  const declined = rules.evaluateRaceStation(P26, farmers(), [{ t: 'start' }, { t: 'wrong_load' }, { t: 'redo_declined' }]);
  assert.deepEqual(declined.infractions.map(({ kind, status, seconds }) => ({ kind, status, seconds })), [
    { kind: 'redo', status: 'confirmed', seconds: 0 },
    { kind: 'penalty', status: 'confirmed', seconds: 180 }
  ]);
  assert.equal(declined.infractions[0].resolution, 'declined');
  assert.equal(declined.penaltySeconds, 180);
});

test('sandbag fora dos ombros: mesmo log, 15 s por ocorrência nos dois regulamentos (sem DQ na 2ª)', () => {
  const log = [{ t: 'start' }, { t: 'infraction', code: 'sandbag_outside_shoulders' }, { t: 'infraction', code: 'sandbag_outside_shoulders' }];
  const r25 = rules.evaluateRaceStation(P25, lunges(), log);
  const r26 = rules.evaluateRaceStation(P26, lunges(), log);
  assert.deepEqual(r25.infractions.map(({ kind, seconds, status }) => ({ kind, seconds, status })), [
    { kind: 'penalty', seconds: 15, status: 'confirmed' },
    { kind: 'penalty', seconds: 15, status: 'confirmed' }
  ]);
  assert.deepEqual(r26.infractions.map(({ kind, seconds }) => ({ kind, seconds })), [
    { kind: 'penalty', seconds: 15 },
    { kind: 'penalty', seconds: 15 }
  ]);
  assert.equal(r25.penaltySeconds, 30);
  assert.equal(r26.penaltySeconds, 30);
});

test('trecho faltando: mesmo log, 3 min por unidade nos dois regulamentos (sem DQ)', () => {
  const log = [{ t: 'start' }, ...sections(2), { t: 'exit' }];
  const r25 = rules.evaluateRaceStation(P25, sled(4), log);
  const r26 = rules.evaluateRaceStation(P26, sled(4), log);
  assert.equal(r25.missing, 2);
  assert.deepEqual(r25.infractions.map(({ code, kind, seconds, units }) => ({ code, kind, seconds, units })), [
    { code: 'missing_units', kind: 'penalty', seconds: 360, units: 2 }
  ]);
  assert.deepEqual(r26.infractions.map(({ code, kind, seconds, status, units }) => ({ code, kind, seconds, status, units })), [
    { code: 'missing_units', kind: 'penalty', seconds: 360, status: 'confirmed', units: 2 }
  ]);
  assert.equal(r25.penaltySeconds, 360);
  assert.equal(r26.penaltySeconds, 360);
});

test('trechos travam no esperado e só liberam completos', () => {
  const result = rules.evaluateRaceStation(P26, sled(4), [{ t: 'start' }, ...sections(5), { t: 'release' }]);
  assert.equal(result.units, 4);
  assert.equal(result.state, 'released');
  assert.equal(result.rejected.length, 1);
  assert.equal(rules.evaluateRaceStation(P26, sled(4), [{ t: 'start' }, ...sections(4)]).state, 'completed');
});

test('gerais: 2 min sem advertência, ajuda externa configurável, fora de ordem 3 min a cada ocorrência (sem DQ)', () => {
  const result = rules.evaluateRaceStation(P26, sled(), [
    { t: 'start' },
    { t: 'infraction', code: 'spitting' },
    { t: 'infraction', code: 'external_help' },
    { t: 'infraction', code: 'lane_invaded' }
  ]);
  assert.deepEqual(result.infractions.map(({ code, kind, seconds, general }) => ({ code, kind, seconds, general })), [
    { code: 'spitting', kind: 'penalty', seconds: 120, general: true },
    { code: 'external_help', kind: 'penalty', seconds: 120, general: true },
    { code: 'lane_invaded', kind: 'warning', seconds: 0, general: false }
  ]);

  const custom = rules.createCustomRaceRuleset(P26);
  custom.general.find((item) => item.code === 'external_help').seconds = 180;
  assert.equal(rules.evaluateRaceStation(custom, sled(), [{ t: 'infraction', code: 'external_help' }]).penaltySeconds, 180);

  const run = rules.evaluateRaceRun(P26, [
    { stage: sled(), events: [{ t: 'infraction', code: 'station_out_of_order' }] },
    { stage: lunges(), events: [{ t: 'infraction', code: 'station_out_of_order' }] }
  ]);
  assert.deepEqual(run.infractions.map(({ stageId, kind, seconds, status }) => ({ stageId, kind, seconds, status })), [
    { stageId: 'sled-push', kind: 'penalty', seconds: 180, status: 'confirmed' },
    { stageId: 'sandbag-lunges', kind: 'penalty', seconds: 180, status: 'confirmed' }
  ]);
  assert.equal(run.penaltySeconds, 360);
});

test('gerais valem em estação genérica e depois de encerrada; motivo de estação não vale na genérica', () => {
  const generic = stage('custom-1', 'Kettlebell Swing');
  const result = rules.evaluateRaceStation(P26, generic, [
    { t: 'start' },
    { t: 'infraction', code: 'lane_invaded' },
    { t: 'exit' },
    { t: 'infraction', code: 'litter' }
  ]);
  assert.deepEqual(pick(result, 'code'), ['litter']);
  assert.deepEqual(result.rejected, [{ seq: 1, error: 'motivo desconhecido para esta estação.' }]);
});

test('não há DQ: propose_dq é recusado como registro desconhecido e nenhum desfecho vira dq_proposal', () => {
  const result = rules.evaluateRaceStation(P26, wallBall(), [{ t: 'start' }, { t: 'propose_dq', reason: 'x' }]);
  assert.deepEqual(result.rejected, [{ seq: 1, error: 'tipo de registro desconhecido.' }]);
  assert.equal(result.infractions.length, 0);
  assert.equal('dqProposed' in result, false);
  assert.equal(rules.RACE_DQ_REASON_MAX, undefined);
  const allLogs = [
    [{ t: 'start' }, { t: 'wrong_load' }, { t: 'redo_declined' }],
    [{ t: 'start' }, { t: 'infraction', code: 'sandbag_outside_shoulders' }, { t: 'infraction', code: 'sandbag_outside_shoulders' }],
    [{ t: 'start' }, { t: 'exit' }]
  ];
  for (const preset of [P25, P26]) {
    for (const log of allLogs) {
      for (const item of rules.evaluateRaceStation(preset, lunges(4), log).infractions) {
        assert.notEqual(item.kind, 'dq_proposal');
        assert.ok(['pending', 'confirmed', 'cancelled'].includes(item.status));
      }
    }
  }
});

test('computeOfficialSeconds: bruto + só confirmadas', () => {
  const infractions = [
    { kind: 'penalty', status: 'confirmed', seconds: 15 },
    { kind: 'warning', status: 'confirmed', seconds: 0 },
    { kind: 'penalty', status: 'revoked', seconds: 120 },
    { kind: 'penalty', status: 'cancelled', seconds: 30 },
    { kind: 'penalty', status: 'rejected', seconds: 60 },
    { kind: 'penalty', status: 'pending', seconds: 90 },
    { kind: 'penalty', status: 'confirmed', seconds: 180 }
  ];
  assert.equal(rules.computeOfficialSeconds(3600, infractions), 3795);
  assert.equal(rules.computeOfficialSeconds(3600, []), 3600);
  assert.equal(rules.computeOfficialSeconds(null, infractions), null);
  assert.equal(rules.computeOfficialSeconds(-1, infractions), null);
  assert.equal(rules.sumConfirmedPenaltySeconds(infractions), 195);
});

test('undo: efeito some no recálculo, original fica; undo de undo, inexistente e já desfeito são recusados', () => {
  const log = [
    { t: 'start' },
    { t: 'infraction', code: 'lane_invaded' },
    { t: 'infraction', code: 'turned_before_line' },
    { t: 'undo', of: 1 },
    { t: 'undo', of: 3 },
    { t: 'undo', of: 1 },
    { t: 'undo', of: 99 },
    { t: 'undo', of: 7 }
  ];
  const result = rules.evaluateRaceStation(P26, sled(), log);
  assert.deepEqual(result.voided, [1]);
  assert.deepEqual(result.rejected, [
    { seq: 4, error: 'não é possível desfazer um desfazer.' },
    { seq: 5, error: 'este registro já foi desfeito.' },
    { seq: 6, error: 'o desfazer aponta para um registro inexistente.' },
    { seq: 7, error: 'o desfazer aponta para um registro inexistente.' }
  ]);
  // Sem a 1ª infração, a 2ª passa a ser a advertência; o log não muda.
  assert.deepEqual(result.infractions.map(({ sourceSeq, kind }) => ({ sourceSeq, kind })), [{ sourceSeq: 2, kind: 'warning' }]);
  assert.equal(log.length, 8);
});

test('undo de evento recusado é recusado; undo da saída reabre a estação e tira a penalidade', () => {
  const refused = rules.evaluateRaceStation(P26, wallBall(2), [{ t: 'start' }, ...reps(3), { t: 'undo', of: 3 }]);
  assert.equal(refused.validReps, 2);
  assert.equal(refused.rejected.map((item) => item.seq).join(','), '3,4');

  const reopened = rules.evaluateRaceStation(P26, wallBall(), [{ t: 'start' }, ...reps(94), { t: 'exit' }, { t: 'undo', of: 95 }, ...reps(6), { t: 'release' }]);
  assert.equal(reopened.state, 'released');
  assert.equal(reopened.penaltySeconds, 0);
  assert.equal(reopened.infractions.length, 0);
});

test('recálculo determinístico e idempotente; sourceKey estável e derivada da estação, do seq e do código', () => {
  const log = [
    { t: 'start' },
    { t: 'infraction', code: 'knee_not_touching' },
    { t: 'return_wrong' },
    { t: 'infraction', code: 'litter' },
    { t: 'wrong_load' },
    { t: 'redo_declined' }
  ];
  const frozen = JSON.stringify(log);
  const first = rules.evaluateRaceStation(P26, lunges(), log);
  const second = rules.evaluateRaceStation(P26, lunges(), log);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(log), frozen);
  assert.deepEqual(pick(first, 'sourceKey'), [
    'sandbag-lunges:1:knee_not_touching',
    'sandbag-lunges:2:return_wrong',
    'sandbag-lunges:3:litter',
    'sandbag-lunges:4:wrong_load',
    'sandbag-lunges:5:redo_declined'
  ]);
  // Um desfazer que muda a advertência mantém a chave da infração que ficou.
  const after = rules.evaluateRaceStation(P26, lunges(), [...log, { t: 'undo', of: 1 }]);
  assert.equal(after.infractions.find((item) => item.code === 'return_wrong').sourceKey, 'sandbag-lunges:2:return_wrong');
});

test('estados da estação: aguardando, em execução, concluída, refazer, liberada e saiu incompleta', () => {
  const state = (log, target = sled(4)) => rules.evaluateRaceStation(P26, target, log).state;
  assert.equal(state([]), 'waiting');
  assert.equal(state([{ t: 'start' }]), 'in_progress');
  assert.equal(state([{ t: 'start' }, ...sections(4)]), 'completed');
  assert.equal(state([{ t: 'start' }, { t: 'wrong_load' }], lunges()), 'redo');
  assert.equal(state([{ t: 'start' }, ...sections(4), { t: 'release' }]), 'released');
  assert.equal(state([{ t: 'start' }, ...sections(1), { t: 'exit' }]), 'left_incomplete');
  const beforeStart = rules.evaluateRaceStation(P26, wallBall(), [{ t: 'rep' }, { t: 'bogus' }, null]);
  assert.equal(beforeStart.validReps, 0);
  assert.equal(beforeStart.rejected.length, 3);
});

// ---------------------------------------------------------------------------
// Story 1.97 (D24): `abandon`, a saída do Wall Ball que não fecha o tempo
// ---------------------------------------------------------------------------

test('abandon (D24): 94 reps + saída = em andamento, marcada na posição 95, sem infração, sem penalidade e sem faltantes', () => {
  const log = [{ t: 'start' }, ...reps(94), { t: 'abandon' }];
  const result = rules.evaluateRaceStation(P26, wallBall(), log);
  assert.equal(result.state, 'in_progress');
  assert.equal(result.abandoned, true);
  assert.equal(result.abandonSeq, 95);
  assert.deepEqual(result.infractions, []);
  assert.equal(result.penaltySeconds, 0);
  assert.equal(result.missing, 0);
  // O atleta volta: mais 6 reps travam o contador, a marca some e a liberação fecha a estação.
  const back = rules.evaluateRaceStation(P26, wallBall(), [...log, ...reps(6)]);
  assert.equal(back.state, 'completed');
  assert.equal(back.abandoned, false);
  assert.equal(back.abandonSeq, null);
  assert.equal(rules.evaluateRaceStation(P26, wallBall(), [...log, ...reps(6), { t: 'release' }]).state, 'released');
});

test('abandon (D24): desfazer tira a marca e permite nova saída; segunda saída ativa, antes do start, travado, depois do release e fora do Wall Ball são recusados', () => {
  const log = [{ t: 'start' }, ...reps(10), { t: 'abandon' }, { t: 'undo', of: 11 }];
  const undone = rules.evaluateRaceStation(P26, wallBall(), log);
  assert.equal(undone.abandoned, false);
  assert.deepEqual(undone.voided, [11]);
  assert.equal(rules.evaluateRaceStation(P26, wallBall(), [...log, { t: 'abandon' }]).abandoned, true, 'nova saída depois do desfazer');

  const twice = rules.evaluateRaceStation(P26, wallBall(), [{ t: 'start' }, { t: 'abandon' }, { t: 'abandon' }]);
  assert.deepEqual(twice.rejected, [{ seq: 2, error: 'a saída já foi registrada.' }]);
  assert.match(rules.evaluateRaceStation(P26, wallBall(), [{ t: 'abandon' }]).rejected[0].error, /inicie a estação/);
  assert.match(rules.evaluateRaceStation(P26, wallBall(5), [{ t: 'start' }, ...reps(5), { t: 'abandon' }]).rejected[0].error, /contador já está travado/);
  assert.match(rules.evaluateRaceStation(P26, wallBall(5), [{ t: 'start' }, ...reps(5), { t: 'release' }, { t: 'abandon' }]).rejected[0].error, /já foi encerrada/);
  assert.match(rules.evaluateRaceStation(P26, sled(), [{ t: 'start' }, { t: 'abandon' }]).rejected[0].error, /só é registrada no Wall Ball/);
  assert.match(rules.evaluateRaceStation(P26, lunges(), [{ t: 'start' }, { t: 'abandon' }]).rejected[0].error, /só é registrada no Wall Ball/);
});

test('abandon (D24): sem efeito no tempo; o exit do motor segue como na 1.93', () => {
  const withChalk = [{ t: 'start' }, ...reps(20), { t: 'chalk' }];
  const plain = rules.evaluateRaceStation(P26, wallBall(), withChalk);
  const marked = rules.evaluateRaceStation(P26, wallBall(), [...withChalk, { t: 'abandon' }]);
  assert.equal(rules.computeOfficialSeconds(3600, marked.infractions), rules.computeOfficialSeconds(3600, plain.infractions));
  assert.equal(marked.penaltySeconds, plain.penaltySeconds);
  const exited = rules.evaluateRaceStation(P26, wallBall(), [{ t: 'start' }, ...reps(94), { t: 'exit' }]);
  assert.equal(exited.state, 'left_incomplete');
  assert.equal(exited.penaltySeconds, 90);
  assert.equal(exited.abandoned, false);
});
