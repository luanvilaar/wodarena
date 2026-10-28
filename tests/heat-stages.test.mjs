import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { importServerModule } from './support/serverModuleHarness.mjs';

// Story 1.87: provas do evento no cronograma. Regras puras de heatStages.ts.

const stages = await importServerModule('lib/heatStages.ts');
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const divisions = [
  { id: 'rx', name: 'RX Masculino', orderIndex: 0 },
  { id: 'sc', name: 'Scale Masculino', orderIndex: 1 },
  { id: 'm35', name: 'Master 35+', orderIndex: 2 }
];
const workouts = [
  { id: 'rx-1', name: 'DT Speed (RX)', code: 'WOD 1', orderIndex: 1, divisionId: 'rx' },
  { id: 'rx-2', name: 'Cardio Burn (RX)', code: 'WOD 2', orderIndex: 2, divisionId: 'rx' },
  { id: 'rx-3', name: 'Heavy Grace (RX)', code: 'WOD 3', orderIndex: 3, divisionId: 'rx' },
  { id: 'sc-1', name: 'DT Speed (Scale)', code: 'WOD 1', orderIndex: 1, divisionId: 'sc' },
  { id: 'sc-2', name: 'Cardio Burn (Scale)', code: 'WOD 2', orderIndex: 2, divisionId: 'sc' },
  { id: 'm35-1', name: 'DT Speed (M35)', code: 'WOD 1', orderIndex: 1, divisionId: 'm35' }
];
const athletes = [
  { id: 'a1', divisionId: 'rx' }, { id: 'a2', divisionId: 'rx' },
  { id: 'a3', divisionId: 'sc' }, { id: 'a4', divisionId: 'm35' }
];

test('quantas provas o evento tem: a categoria com mais provas manda', () => {
  assert.equal(stages.countDefaultStages(workouts, divisions), 3);
  assert.equal(stages.countDefaultStages([], divisions), 0);
  assert.equal(stages.countDefaultStages(workouts.slice(0, 1), divisions), 1);
});

test('a n-ésima prova de cada categoria é a prova n do evento; categoria sem prova fica vazia', () => {
  assert.deepEqual(stages.buildDefaultStageWorkouts(workouts, divisions, 1), { rx: 'rx-1', sc: 'sc-1', m35: 'm35-1' });
  assert.deepEqual(stages.buildDefaultStageWorkouts(workouts, divisions, 2), { rx: 'rx-2', sc: 'sc-2', m35: '' });
  assert.deepEqual(stages.buildDefaultStageWorkouts(workouts, divisions, 3), { rx: 'rx-3', sc: '', m35: '' });
});

test('prova "Geral" (sem categoria) vale para todas e entra na ordem de cada uma', () => {
  const withGeneral = [...workouts, { id: 'geral-4', name: 'Final', code: 'WOD 4', orderIndex: 4, divisionId: null }];
  // Conta pela ordem de cada categoria: a Geral é a 4ª prova do RX, a 3ª do Scale e a 2ª do Master.
  assert.equal(stages.buildDefaultStageWorkouts(withGeneral, divisions, 4).rx, 'geral-4');
  assert.equal(stages.buildDefaultStageWorkouts(withGeneral, divisions, 3).sc, 'geral-4');
  assert.equal(stages.buildDefaultStageWorkouts(withGeneral, divisions, 2).m35, 'geral-4');
  assert.equal(stages.countDefaultStages(withGeneral, divisions), 4);
});

test('a ordem das provas segue a aba Provas, mesmo com a lista fora de ordem', () => {
  const shuffled = [workouts[2], workouts[0], workouts[1]];
  assert.deepEqual(stages.getDivisionWorkoutsInOrder(shuffled, 'rx').map((w) => w.id), ['rx-1', 'rx-2', 'rx-3']);
});

const heat = (overrides = {}) => ({
  id: 'heat-stage-1-1', kind: 'heat', date: '2026-11-14', time: '08:00', title: 'BATERIA 1', description: '',
  heatNumber: 1, stageNumber: 1, stageTitle: 'Prova 1 · DT Speed',
  stageWorkouts: { rx: 'rx-1', sc: 'sc-1', m35: '' },
  athleteIds: ['a1', 'a3', '', 'a2'], laneWorkoutIds: ['rx-1', 'sc-1', '', 'rx-1'], workoutId: 'rx-1', ...overrides
});

test('bateria da prova do evento é reconhecida; a antiga não', () => {
  assert.equal(stages.isStageHeat(heat()), true);
  assert.equal(stages.isStageHeat({ kind: 'heat', workoutId: 'rx-1' }), false);
  assert.equal(stages.isStageHeat({ kind: 'briefing', stageNumber: 1 }), false);
  assert.equal(stages.isStageHeat({ kind: 'heat', stageNumber: 0 }), false);
  assert.equal(stages.getHeatGroupKey(heat()), 'stage-1');
  assert.equal(stages.getHeatGroupKey({ kind: 'heat', workoutId: 'rx-1' }), 'rx-1');
  assert.equal(stages.getHeatGroupKey({ kind: 'heat' }), '');
});

test('a prova da raia: a gravada, ou a da bateria na bateria antiga', () => {
  assert.equal(stages.getLaneWorkoutId(heat(), 0), 'rx-1');
  assert.equal(stages.getLaneWorkoutId(heat(), 1), 'sc-1');
  assert.equal(stages.getLaneWorkoutId({ workoutId: 'rx-2' }, 3), 'rx-2');
  assert.equal(stages.getLaneWorkoutId({ workoutId: 'rx-2', laneWorkoutIds: ['', 'sc-2'] }, 0), 'rx-2');
});

test('a bateria pertence à prova só se tem atleta nela (nova) ou é dela (antiga)', () => {
  assert.equal(stages.heatIncludesWorkout(heat(), 'sc-1'), true);
  assert.equal(stages.heatIncludesWorkout(heat(), 'm35-1'), false);
  // raia livre não conta, mesmo com prova gravada
  assert.equal(stages.heatIncludesWorkout(heat({ athleteIds: ['a1', '', '', ''] }), 'sc-1'), false);
  assert.equal(stages.heatIncludesWorkout({ kind: 'heat', workoutId: 'rx-1' }, 'rx-1'), true);
  assert.equal(stages.heatIncludesWorkout({ kind: 'heat', workoutId: 'rx-1' }, 'rx-2'), false);
  assert.equal(stages.heatIncludesWorkout({ kind: 'event', workoutId: 'rx-1' }, 'rx-1'), false);
});

test('o que o gestor salvou vale; categoria nova entra pelo automático; prova apagada vira "sem prova"', () => {
  const saved = [heat({ stageWorkouts: { rx: 'rx-1', sc: 'rx-2' } })];
  const resolved = stages.resolveStageWorkouts(saved, workouts, divisions, 1);
  assert.deepEqual(resolved, { rx: 'rx-1', sc: 'rx-2', m35: 'm35-1' });

  const withoutRx2 = workouts.filter((w) => w.id !== 'rx-2');
  assert.equal(stages.resolveStageWorkouts(saved, withoutRx2, divisions, 1).sc, '');
  // sem nada salvo: tudo automático
  assert.deepEqual(stages.resolveStageWorkouts([], workouts, divisions, 2), { rx: 'rx-2', sc: 'sc-2', m35: '' });
});

test('o nome da prova: o salvo ou "Prova n · nome da primeira prova"', () => {
  const map = stages.buildDefaultStageWorkouts(workouts, divisions, 1);
  assert.equal(stages.getStageTitle([heat()], workouts, map, 1), 'Prova 1 · DT Speed');
  assert.equal(stages.getStageTitle([], workouts, map, 1), 'Prova 1 · DT Speed');
  assert.equal(stages.getStageTitle([], [], {}, 2), 'Prova 2');
  assert.equal(stages.getStageTitle([heat({ stageTitle: '  Final  ' })], workouts, map, 1), 'Final');
});

test('atletas da prova: os das categorias que têm prova nela; a prova de cada raia acompanha a categoria', () => {
  const map = { rx: 'rx-1', sc: 'sc-1', m35: '' };
  assert.deepEqual(stages.eligibleStageAthletes(athletes, map).map((a) => a.id), ['a1', 'a2', 'a3']);
  assert.deepEqual(stages.buildLaneWorkoutIds(['a3', '', 'a1', 'a4', 'ghost'], athletes, map), ['sc-1', '', 'rx-1', '', '']);
  assert.equal(stages.pickRepresentativeWorkoutId(['', 'sc-1', 'rx-1'], map), 'sc-1');
  assert.equal(stages.pickRepresentativeWorkoutId(['', ''], map), 'rx-1');
  assert.equal(stages.pickRepresentativeWorkoutId([], { m35: '' }), '');
});

test('auto-preencher: segue a ordem recebida, completa a bateria com a próxima categoria e informa quem sobrou', () => {
  const ordered = ['a2', 'a1', 'a3', 'a4'];
  const filled = stages.autoFillHeats(ordered, 2, 3);
  assert.deepEqual(filled.heats, [['a2', 'a1', 'a3'], ['a4', '', '']]);
  assert.deepEqual(filled.leftOut, []);
  const short = stages.autoFillHeats(ordered, 1, 3);
  assert.deepEqual(short.heats, [['a2', 'a1', 'a3']]);
  assert.deepEqual(short.leftOut, ['a4']);
  assert.deepEqual(stages.autoFillHeats([], 2, 2).heats, [['', ''], ['', '']]);
});

test('trava: a prova n só abre depois de a prova n-1 ter baterias, novas ou antigas', () => {
  assert.deepEqual(stages.getStageLockStatus([], workouts, divisions, 1), { isLocked: false, previousStage: null });
  assert.deepEqual(stages.getStageLockStatus([], workouts, divisions, 2), { isLocked: true, previousStage: 1 });
  assert.deepEqual(stages.getStageLockStatus([heat()], workouts, divisions, 2), { isLocked: false, previousStage: null });
  const legacy = [{ id: 'old', kind: 'heat', workoutId: 'sc-1', date: '', time: '', title: '', description: '' }];
  assert.equal(stages.getStageLockStatus(legacy, workouts, divisions, 2).isLocked, false);
  const legacyOther = [{ id: 'old', kind: 'heat', workoutId: 'rx-3', date: '', time: '', title: '', description: '' }];
  assert.equal(stages.getStageLockStatus(legacyOther, workouts, divisions, 2).isLocked, true);
});

test('baterias antigas que o construtor novo substitui: as das provas agrupadas pela prova do evento', () => {
  const items = [
    { id: 'o1', kind: 'heat', workoutId: 'rx-1' }, { id: 'o2', kind: 'heat', workoutId: 'sc-1' },
    { id: 'o3', kind: 'heat', workoutId: 'rx-2' }, heat(), { id: 'b', kind: 'briefing', workoutId: 'rx-1' }
  ];
  const old = stages.getLegacyHeatsForStage(items, { rx: 'rx-1', sc: 'sc-1', m35: '' });
  assert.deepEqual(old.map((item) => item.id), ['o1', 'o2']);
});

test('prova excluída: a bateria antiga some; a nova perde só as raias dela e sai se não sobrar prova', () => {
  const items = [
    { id: 'old', kind: 'heat', workoutId: 'rx-1' },
    { id: 'oldKeep', kind: 'heat', workoutId: 'rx-2' },
    { id: 'brief', kind: 'briefing' },
    heat(),
    heat({ id: 'heat-stage-1-2', heatNumber: 2, athleteIds: ['a3'], laneWorkoutIds: ['sc-1'], workoutId: 'sc-1', stageWorkouts: { sc: 'sc-1' } })
  ];
  const out = stages.stripWorkoutsFromHeats(items, ['sc-1']);
  assert.deepEqual(out.map((item) => item.id), ['old', 'oldKeep', 'brief', 'heat-stage-1-1']);
  const first = out.find((item) => item.id === 'heat-stage-1-1');
  assert.deepEqual(first.athleteIds, ['a1', '', '', 'a2']);
  assert.deepEqual(first.laneWorkoutIds, ['rx-1', '', '', 'rx-1']);
  assert.equal(first.stageWorkouts.sc, '');
  assert.equal(first.workoutId, 'rx-1');

  const removedRx = stages.stripWorkoutsFromHeats(items, ['rx-1']);
  assert.deepEqual(removedRx.map((item) => item.id), ['oldKeep', 'brief', 'heat-stage-1-1', 'heat-stage-1-2']);
  assert.equal(removedRx.find((item) => item.id === 'heat-stage-1-1').workoutId, 'sc-1', 'a prova representativa passa para outra prova da bateria');
  // não altera a lista recebida
  assert.equal(items.length, 5);
  assert.deepEqual(items[3].athleteIds, ['a1', 'a3', '', 'a2']);
});

test('o módulo é puro e o tipo do cronograma leva os campos novos', () => {
  const source = read('../src/lib/heatStages.ts');
  assert.doesNotMatch(source, /from '@\/lib\/(?!workoutOrder)/);
  const types = read('../src/types/index.ts');
  for (const field of ['stageNumber?: number', 'stageTitle?: string', 'stageWorkouts?: Record<string, string>', 'laneWorkoutIds?: string[]']) {
    assert.ok(types.includes(field), field);
  }
});

// --- Story 1.90: cronograma público, contestação e remoção de provas ---

test('cronograma público: agrupa pela prova do evento, mostra o nome dela e não perde bateria da prova do evento como "órfã"', () => {
  const page = read('../src/app/[locale]/event/[id]/EventView.tsx');
  assert.match(page, /import \{ getHeatGroupKey, isStageHeat \} from '@\/lib\/heatStages';/);
  assert.match(page, /const id = getHeatGroupKey\(item\) \|\| getHeatGroupFallbackTitle\(item, heatFallbackTitle\)/);
  assert.match(page, /const groupId = getHeatGroupKey\(item\) \|\| getHeatGroupFallbackTitle\(item, scheduleHeatFallbackTitle\)/);
  assert.match(page, /if \(isStageHeat\(item\)\) return item\.stageTitle\?\.trim\(\) \|\| getHeatGroupFallbackTitle\(item, fallbackTitle\);/);
  assert.match(page, /if \(isStageHeat\(item\)\) return \[item\.workoutId, \.\.\.\(item\.laneWorkoutIds \|\| \[\]\)\]\.some\(id => id && currentWorkoutIds\.has\(id\)\);/);
});

test('contestação: a bateria da prova do evento serve à prova de qualquer atleta dela', async () => {
  const contestations = await importServerModule('lib/contestations.ts');
  const items = [
    { id: 'old', kind: 'heat', workoutId: 'rx-1' },
    heat()
  ];
  assert.equal(contestations.findWorkoutHeat(items, 'rx-1', 'old')?.id, 'old');
  assert.equal(contestations.findWorkoutHeat(items, 'rx-2', 'old'), undefined);
  assert.equal(contestations.findWorkoutHeat(items, 'sc-1', 'heat-stage-1-1')?.id, 'heat-stage-1-1');
  assert.equal(contestations.findWorkoutHeat(items, 'm35-1', 'heat-stage-1-1'), undefined, 'ninguém da prova na bateria');
});

test('remover prova ou categoria usa a mesma regra da bateria da prova do evento', () => {
  const context = read('../src/context/AppContext.tsx');
  assert.match(context, /import \{ stripWorkoutsFromHeats \} from '@\/lib\/heatStages';/);
  assert.match(context, /const cleanedSchedule = stripWorkoutsFromHeats\(event\.scheduleItems \|\| \[\], linkedWorkoutIds\);/);
  assert.match(context, /const cleanedSchedule = stripWorkoutsFromHeats\(event\.scheduleItems \|\| \[\], \[workoutId\]\);/);
  assert.match(context, /JSON\.stringify\(cleanedSchedule\) !== JSON\.stringify\(event\.scheduleItems \|\| \[\]\)/);
});

// --- Story 1.88: construtor de baterias por prova do evento ---

test('gerar as baterias: horários, raias e a prova de cada raia pela categoria do atleta; categoria sem prova fica de fora', () => {
  const slots = [
    { time: '08:00', warmupTime: '07:40', checkinTime: '07:55', endTime: '08:10' },
    { time: '08:15', warmupTime: '07:55', checkinTime: '08:10', endTime: '08:25' }
  ];
  const items = stages.buildStageHeatItems({
    stageNumber: 2,
    stageTitle: 'Prova 2 · Cardio Burn',
    stageWorkouts: { rx: 'rx-2', sc: 'sc-2', m35: '' },
    slots,
    capacity: 3,
    allocations: {
      'heat-stage-2-1': ['a3', 'a1', 'a4', 'extra-ignorado'],
      'heat-stage-2-2': ['a2']
    },
    athletes,
    date: '2026-11-14',
    location: 'Recife',
    isPublished: true
  });

  assert.equal(items.length, 2);
  const [first, second] = items;
  assert.equal(first.id, 'heat-stage-2-1');
  assert.equal(first.kind, 'heat');
  assert.equal(first.title, 'BATERIA 1 - Prova 2 · Cardio Burn');
  assert.equal(first.description, 'Aquecimento: 07:40 | Fila: 07:55 | Início: 08:00 | Final: 08:10');
  assert.deepEqual([first.date, first.time, first.warmupTime, first.checkinTime, first.endTime, first.location], ['2026-11-14', '08:00', '07:40', '07:55', '08:10', 'Recife']);
  assert.deepEqual([first.stageNumber, first.stageTitle, first.heatNumber, first.capacity, first.isPublished], [2, 'Prova 2 · Cardio Burn', 1, 3, true]);
  assert.deepEqual(first.stageWorkouts, { rx: 'rx-2', sc: 'sc-2', m35: '' });
  // a4 é Master 35+ (sem prova nesta etapa): a raia fica livre
  assert.deepEqual(first.athleteIds, ['a3', 'a1', '']);
  assert.deepEqual(first.laneWorkoutIds, ['sc-2', 'rx-2', '']);
  assert.equal(first.workoutId, 'sc-2', 'a prova representativa é a da primeira raia ocupada');

  assert.equal(second.id, 'heat-stage-2-2');
  assert.deepEqual(second.athleteIds, ['a2', '', '']);
  assert.deepEqual(second.laneWorkoutIds, ['rx-2', '', '']);
  assert.equal(second.time, '08:15');
});

test('gerar baterias vazias: a prova representativa vem da prova da etapa; as raias livres não levam prova', () => {
  const [empty] = stages.buildStageHeatItems({
    stageNumber: 1, stageTitle: 'Prova 1', stageWorkouts: { rx: 'rx-1', sc: 'sc-1' },
    slots: [{ time: '08:00', warmupTime: '07:40', checkinTime: '07:55', endTime: '08:10' }],
    capacity: 2, allocations: {}, athletes, date: '2026-11-14', isPublished: false
  });
  assert.deepEqual(empty.athleteIds, ['', '']);
  assert.deepEqual(empty.laneWorkoutIds, ['', '']);
  assert.equal(empty.workoutId, 'rx-1');
  assert.equal(empty.isPublished, false);
  assert.equal(empty.location, undefined);
});

test('o que foi gerado é lido de volta pelas mesmas regras: prova da raia, bateria da prova e remoção de prova', () => {
  const [first] = stages.buildStageHeatItems({
    stageNumber: 1, stageTitle: 'Prova 1 · DT Speed', stageWorkouts: { rx: 'rx-1', sc: 'sc-1', m35: 'm35-1' },
    slots: [{ time: '08:00', warmupTime: '07:40', checkinTime: '07:55', endTime: '08:10' }],
    capacity: 3, allocations: { 'heat-stage-1-1': ['a1', 'a3', 'a4'] }, athletes, date: '2026-11-14', isPublished: true
  });
  assert.equal(stages.isStageHeat(first), true);
  assert.deepEqual([0, 1, 2].map((lane) => stages.getLaneWorkoutId(first, lane)), ['rx-1', 'sc-1', 'm35-1']);
  assert.equal(stages.heatIncludesWorkout(first, 'm35-1'), true);
  assert.equal(stages.getHeatGroupKey(first), 'stage-1');
  assert.deepEqual(stages.getSavedStageNumbers([first]), [1]);
  const stripped = stages.stripWorkoutsFromHeats([first], ['m35-1']);
  assert.deepEqual(stripped[0].athleteIds, ['a1', 'a3', '']);
});

test('construtor do painel: provas do evento, prova de cada categoria, salvar, limpar, publicar e travar', () => {
  const admin = read('../src/app/admin/page.tsx');
  // estado e carga
  assert.match(admin, /const \[heatStageNumber, setHeatStageNumber\] = useState\(0\);/);
  assert.match(admin, /const loadHeatStage = \(evt: Event, stageNumber: number\) => \{/);
  assert.match(admin, /resolveStageWorkouts\(items, eventWorkouts, eventDivisions, stageNumber\)/);
  assert.match(admin, /loadHeatStage\(evt, 1\);/);
  assert.match(admin, /countDefaultStages\(evt\.workouts, evt\.divisions \|\| \[\]\)/);
  assert.doesNotMatch(admin, /setHeatWorkoutId|heatWorkoutId/, 'o construtor não escolhe mais uma prova de categoria');
  // escopo: Fitness Race segue com largadas únicas; Functional Fitness usa a prova do evento
  assert.match(admin, /`fitness-race-\$\{selectedEventToManage\.id\}`/);
  assert.match(admin, /stageNumber > 0 \? `stage-\$\{stageNumber\}` : ''/);
  assert.match(admin, /return isStageHeat\(item\) && item\.stageNumber === stageNumber;/);
  // salvar substitui as baterias da prova e as antigas que ela agrupa (D5)
  assert.match(admin, /getLegacyHeatsForStage\(savedScheduleItems, heatStageWorkouts\)/);
  assert.match(admin, /newHeatItems\.push\(\.\.\.buildStageHeatItems\(\{/);
  assert.match(admin, /existingItems\.filter\(item => !isHeatReplacedByStage\(item\)\)/);
  assert.match(admin, /Escolha a prova de pelo menos uma categoria nesta prova do evento\./);
  // limpar e publicar só a prova aberta
  assert.match(admin, /filter\(item => !isHeatInActiveScope\(item\)\)/);
  assert.match(admin, /if \(isHeatInActiveScope\(item\)\) \{\s*return \{ \.\.\.item, isPublished: true \};/);
  // trava pela prova anterior e auto-preencher por categoria (D3)
  assert.match(admin, /getStageLockStatus\(savedScheduleItems, workouts, eventDivisions, stageNumber\)/);
  assert.match(admin, /sortDivisions\(eventDivisions\)\.forEach\(division => \{/);
  assert.match(admin, /getLeaderboard\(selectedEventToManage\.id, division\.id\)[^;]*\.reverse\(\)/);
  assert.match(admin, /eligibleStageAthletes\(approvedEventAthletes, heatStageWorkouts\)/);
  // tela: quantas provas, chips, nome, tabela de provas por categoria, aviso das antigas
  for (const text of ['Quantas provas tem o evento', 'Montar as baterias da', 'Prova de cada categoria', 'Sem prova nesta etapa', 'formato antigo (uma categoria por bateria)']) {
    assert.ok(admin.includes(text), text);
  }
  assert.match(admin, /aria-label="Uma prova a menos"/);
  assert.match(admin, /aria-label="Uma prova a mais"/);
  assert.match(admin, /aria-pressed=\{number === stageNumber\}/);
  assert.match(admin, /aria-label=\{`Prova de \$\{division\.name\} nesta etapa`\}/);
  // não reduz abaixo das provas que já têm bateria salva
  assert.match(admin, /disabled=\{heatStageCount <= Math\.max\(1, maxSavedStageNumber\)\}/);
});
