import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import {
  FIRST_WORKOUT_TIEBREAK_CUTOFF,
  getTiebreakFirstWorkout,
  sortWorkouts
} from '../src/lib/workoutOrder.ts';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const workoutOrder = read('../src/lib/workoutOrder.ts');
const context = read('../src/context/AppContext.tsx');
const admin = read('../src/app/admin/page.tsx');
const leaderboard = read('../src/components/Leaderboard.tsx');
const qualifierResults = read('../src/components/QualifierResultsManager.tsx');
const bootstrapPayload = read('../src/lib/bootstrapPayload.ts');
const bootstrapRoute = read('../src/app/api/app/bootstrap/route.ts');
const eventStatus = read('../src/lib/eventStatus.ts');

// eventStatus.ts importa '@/types' (só tipos): transpila para usar hasEventDatePassed.
const eventStatusModule = await import(`data:text/javascript;base64,${Buffer.from(
  ts.transpileModule(eventStatus, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText,
).toString('base64')}`);

const wod = (id, code, orderIndex, extra = {}) => ({ id, name: extra.name ?? code, code, orderIndex, ...extra });
const ids = (workouts) => workouts.map((workout) => workout.id);

const permutations = (items) => {
  if (items.length <= 1) return [items];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest])
  );
};

test('sortWorkouts ordena por orderIndex crescente', () => {
  const sorted = sortWorkouts([wod('c', 'WOD 3', 3), wod('a', 'WOD 1', 1), wod('b', 'WOD 2', 2)]);
  assert.deepEqual(ids(sorted), ['a', 'b', 'c']);
});

test('sortWorkouts desempata orderIndex repetido pelo código em ordem natural', () => {
  const sorted = sortWorkouts([
    wod('w10', 'WOD 10', 1),
    wod('w2', 'WOD 2', 1),
    wod('w1-1', 'WOD 1.1', 1),
    wod('w1', 'WOD 1', 1)
  ]);
  // "WOD 2" antes de "WOD 10"; "WOD 1" antes de "WOD 1.1" (caso New City Games)
  assert.deepEqual(ids(sorted), ['w1', 'w1-1', 'w2', 'w10']);
});

test('sortWorkouts usa nome e depois id quando ordem e código empatam', () => {
  const sorted = sortWorkouts([
    wod('z', 'WOD 1', 1, { name: 'Prova B' }),
    wod('y', 'wod 1', 1, { name: 'Prova A' }),
    wod('b', 'WOD 1', 1, { name: 'prova á' }),
    wod('a', 'WOD 1', 1, { name: 'Prova A' })
  ]);
  // Código e nome ignoram maiúsculas/acentos; o id garante a ordem final.
  assert.deepEqual(ids(sorted), ['a', 'b', 'y', 'z']);
});

test('sortWorkouts manda orderIndex nulo, indefinido ou não numérico para o fim', () => {
  const sorted = sortWorkouts([
    wod('sem-ordem', 'WOD 1', null),
    wod('indefinido', 'WOD 2', undefined),
    wod('texto', 'WOD 3', 'abc'),
    wod('infinito', 'WOD 4', Number.POSITIVE_INFINITY),
    wod('ultimo-valido', 'WOD 9', 99),
    wod('primeiro', 'WOD 5', 0)
  ]);
  assert.deepEqual(ids(sorted.slice(0, 2)), ['primeiro', 'ultimo-valido']);
  // Entre os sem ordem válida, vale o código.
  assert.deepEqual(ids(sorted.slice(2)), ['sem-ordem', 'indefinido', 'texto', 'infinito']);
});

test('sortWorkouts não muta a lista recebida', () => {
  const input = [wod('b', 'WOD 2', 2), wod('a', 'WOD 1', 1)];
  const snapshot = JSON.stringify(input);
  const sorted = sortWorkouts(input);
  assert.notEqual(sorted, input);
  assert.equal(JSON.stringify(input), snapshot);
  assert.deepEqual(ids(sorted), ['a', 'b']);
});

test('sortWorkouts é determinístico para qualquer ordem física das linhas', () => {
  const rows = [
    wod('x2', 'WOD 1', 1, { name: 'Iniciante' }),
    wod('x1', 'WOD 1', 1, { name: 'Iniciante' }),
    wod('k', 'WOD 1.1', 1, { name: 'Kids' }),
    wod('g', 'WOD 2', 2),
    wod('n', 'WOD 3', null)
  ];
  const expected = ['x1', 'x2', 'k', 'g', 'n'];
  for (const permutation of permutations(rows)) {
    assert.deepEqual(ids(sortWorkouts(permutation)), expected);
  }
});

test('módulo de ordenação é puro e sem imports de runtime', () => {
  assert.doesNotMatch(workoutOrder, /^\s*import\s/m);
  assert.match(workoutOrder, /export const sortWorkouts = <T extends OrderableWorkout>\(workouts: T\[\]\): T\[\] =>\s*\[\.\.\.workouts\]\.sort\(compareWorkouts\)/);
  assert.match(workoutOrder, /new Intl\.Collator\('pt-BR', \{ numeric: true, sensitivity: 'base' \}\)/);
});

test('mapper do AppContext entrega event.workouts já ordenado', () => {
  assert.match(context, /import \{ FIRST_WORKOUT_TIEBREAK_CUTOFF, getTiebreakFirstWorkout, sortWorkouts \} from '@\/lib\/workoutOrder';/);
  assert.match(context, /const evWods: Workout\[\] = sortWorkouts\(dbWorkouts\s*\.filter\(w => w\.event_id === evt\.id\)/);
});

test('mutações em memória mantêm as provas ordenadas sem reload', () => {
  // AppContext: reparo de Fitness Racing, criação de evento, prova automática da
  // categoria, criação e edição de prova.
  assert.match(context, /workouts: sortWorkouts\(currentWods\)/);
  assert.match(context, /workouts: sortWorkouts\(defaultFitnessRacing\.workouts\)/);
  assert.match(context, /workouts: autoWorkout \? sortWorkouts\(\[\.\.\.e\.workouts, autoWorkout\]\) : e\.workouts/);
  assert.match(context, /workouts: sortWorkouts\(\[\.\.\.e\.workouts, newWorkout\]\)/);
  assert.match(context, /workouts: sortWorkouts\(e\.workouts\.map\(w => w\.id === workoutId \? \{ \.\.\.w, \.\.\.updatedData \} : w\)\)/);

  // Admin (selectedEventToManage): criar/duplicar categoria, editar e criar prova.
  assert.equal(admin.match(/workouts: autoWorkout \? sortWorkouts\(\[\.\.\.prev\.workouts, autoWorkout\]\) : prev\.workouts/g)?.length, 2);
  assert.match(admin, /workouts: sortWorkouts\(prev\.workouts\.map\(workout => workout\.id === editingWorkoutId/);
  assert.match(admin, /workouts: sortWorkouts\(\[\.\.\.prev\.workouts, newWod\]\)/);

  // Qualquer atribuição que acrescente ou altere provas precisa passar por sortWorkouts.
  for (const [label, source] of [['AppContext', context], ['admin', admin]]) {
    const assignments = source.split('\n').filter((line) =>
      /workouts: /.test(line) && /\[\.\.\.(e|prev|evt)\.workouts|\.workouts\.map\(/.test(line)
    );
    assert.ok(assignments.length > 0, `${label}: nenhuma mutação de provas encontrada`);
    for (const line of assignments) {
      assert.match(line, /sortWorkouts\(/, `${label}: mutação sem sortWorkouts → ${line.trim()}`);
    }
  }
});

test('consultas de bootstrap leem provas em ordem determinística na fonte', () => {
  const orderedWorkoutQuery = /\.from\('workouts'\)\s*\.select\(PUBLIC_WORKOUT_SELECT\)(?:\s*\.(?:eq|in)\('event_id', \w+\))?\s*\.order\('order_index', \{ ascending: true \}\)\s*\.order\('id', \{ ascending: true \}\)/g;

  // buildPublicBootstrapPayload + buildPublicEventBootstrapPayload
  assert.equal(bootstrapPayload.match(/\.from\('workouts'\)/g)?.length, 2);
  assert.equal(bootstrapPayload.match(orderedWorkoutQuery)?.length, 2);

  // Bootstrap privado: ramo gestor/juiz e ramo dono
  assert.equal(bootstrapRoute.match(/\.from\('workouts'\)/g)?.length, 2);
  assert.equal(bootstrapRoute.match(orderedWorkoutQuery)?.length, 2);
});

test('telas usam um único comparador de provas', () => {
  assert.match(admin, /import \{ sortWorkouts \} from '@\/lib\/workoutOrder';/);
  assert.match(admin, /\{sortWorkouts\(workouts\)\.map\(\(wod\) => \{/);
  assert.match(admin, /const divisionWorkouts = sortWorkouts\(workouts\.filter\(w => w\.divisionId === currentWorkout\.divisionId\)\);/);
  assert.doesNotMatch(admin, /\[\.\.\.workouts\]\.sort\(/);

  assert.match(leaderboard, /const ordered = sortWorkouts\(workouts\);/);
  assert.doesNotMatch(leaderboard, /orderIndex - b\.orderIndex/);

  assert.match(qualifierResults, /\(\) => sortWorkouts\(event\.workouts \|\| \[\]\)/);
  assert.doesNotMatch(qualifierResults, /orderIndex - b\.orderIndex/);
});

test('desempate "WOD 1" usa a primeira prova da categoria, calculada uma vez', () => {
  const leaderboardStart = context.indexOf('// 2. Mapear workouts do evento (Functional Fitness)');
  const leaderboardEnd = context.indexOf('// Atualizar configurações de bilheteria e formato do evento');
  const functionalFitness = context.slice(leaderboardStart, leaderboardEnd);
  assert.ok(leaderboardStart > 0 && leaderboardEnd > leaderboardStart);

  assert.match(functionalFitness, /const usesLegacyFirstWorkoutTiebreak = hasEventDatePassed\(event\.date, FIRST_WORKOUT_TIEBREAK_CUTOFF\);/);
  assert.match(functionalFitness, /const firstWorkout = getTiebreakFirstWorkout\(event\.workouts, divisionWorkouts, usesLegacyFirstWorkoutTiebreak\);/);
  assert.equal(context.match(/const firstWorkout =/g)?.length, 1);
  assert.doesNotMatch(context, /\[\.\.\.event\.workouts\]\.sort\(/);

  // O mesmo workout serve à ordenação e à atribuição do rank.
  const definition = functionalFitness.indexOf('const firstWorkout =');
  const sorting = functionalFitness.indexOf('const sortedList = [...list].sort(');
  const ranking = functionalFitness.indexOf('// 5. Aplicar o Rank geral final');
  assert.ok(definition > 0 && definition < sorting && sorting < ranking);
  assert.match(functionalFitness.slice(sorting, ranking), /a\.scores\[firstWorkout\.id\]\?\.rank[\s\S]*b\.scores\[firstWorkout\.id\]\?\.rank/);
  assert.match(functionalFitness.slice(ranking), /item\.scores\[firstWorkout\.id\]\?\.rank[\s\S]*prevItem\.scores\[firstWorkout\.id\]\?\.rank/);
});

test('getTiebreakFirstWorkout escolhe a prova da categoria ou, no legado, a do evento', () => {
  const eventWorkouts = [
    wod('kids-1', 'WOD 1.1', 1, { divisionId: 'kids-f' }),
    wod('ini-1', 'WOD 1', 1, { divisionId: 'ini-m' }),
    wod('scaled-2', 'WOD 2', 2, { divisionId: 'scaled-f' }),
    wod('scaled-1', 'WOD 1', 3, { divisionId: 'scaled-f' })
  ];
  const scaledWorkouts = eventWorkouts.filter((workout) => !workout.divisionId || workout.divisionId === 'scaled-f');

  // Regra nova: primeira prova da categoria, mesmo com a lista fora de ordem.
  assert.equal(getTiebreakFirstWorkout(eventWorkouts, scaledWorkouts, false)?.id, 'scaled-2');
  // Legado: primeira prova do evento inteiro (aqui de outra categoria), o mesmo
  // "WOD 1" que o critério antigo escolhia no empate de order_index.
  assert.equal(getTiebreakFirstWorkout(eventWorkouts, scaledWorkouts, true)?.id, 'ini-1');
  assert.equal(getTiebreakFirstWorkout([], [], false), undefined);
});

test('corte do desempate: encerrados antes de 07/10/2026 mantêm o critério antigo', () => {
  assert.match(workoutOrder, /export const FIRST_WORKOUT_TIEBREAK_CUTOFF = new Date\(2026, 9, 7\);/);
  assert.equal(FIRST_WORKOUT_TIEBREAK_CUTOFF.getFullYear(), 2026);
  assert.equal(FIRST_WORKOUT_TIEBREAK_CUTOFF.getMonth(), 9);
  assert.equal(FIRST_WORKOUT_TIEBREAK_CUTOFF.getDate(), 7);
  assert.equal(FIRST_WORKOUT_TIEBREAK_CUTOFF.getHours(), 0);

  const usesLegacy = (date) => eventStatusModule.hasEventDatePassed(date, FIRST_WORKOUT_TIEBREAK_CUTOFF);
  // Legado: evento já encerrado na data de corte.
  assert.equal(usesLegacy('15/08/2026'), true); // New City Games
  assert.equal(usesLegacy('2026-03-21'), true);
  assert.equal(usesLegacy('06/10/2026'), true); // último dia antes do corte
  // Regra nova: eventos a partir do corte, para sempre (a data não é "agora").
  assert.equal(usesLegacy('07/10/2026'), false);
  assert.equal(usesLegacy('28 de novembro, 2026'), false);
  // Data ilegível ou ausente é tratada como não encerrado (regra nova).
  assert.equal(usesLegacy('07 e 08 de Novembro'), false);
  assert.equal(usesLegacy(''), false);
  assert.equal(usesLegacy(undefined), false);
});

test('Fitness Racing mantém o leaderboard pela prova TOTAL, antes do desempate "WOD 1"', () => {
  const racingBranch = context.indexOf("if (event.eventType === 'fitness_racing') {\n      const totalWorkout = event.workouts.find(w => w.divisionId === divisionId && w.code === 'TOTAL');");
  assert.ok(racingBranch > 0);
  assert.ok(racingBranch < context.indexOf('const firstWorkout = getTiebreakFirstWorkout('));
  assert.match(context, /const sortedList = \[\.\.\.list\]\.sort\(\(a, b\) => a\.totalPoints - b\.totalPoints\);/);
});
