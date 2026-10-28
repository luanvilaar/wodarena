import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { importServerModule } from './support/serverModuleHarness.mjs';

// Story 1.91: lista "Provas WODs Cadastradas" agrupada pela prova do evento
// (opção B de docs/design/provas-cadastradas/). Regras puras de workoutStageList.ts.

const { buildWorkoutStageList, shouldShowWorkoutName } = await importServerModule('lib/workoutStageList.ts');
const { WorkoutStageList } = await importServerModule('components/admin/WorkoutStageList.tsx');
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const divisions = [
  { id: 'rxm', name: 'Dupla Rx Masculino', orderIndex: 0 },
  { id: 'scm', name: 'Dupla Scaled Masculino', orderIndex: 1 },
  { id: 'ma', name: 'Dupla Master 35+', orderIndex: 2 }
];
const wod = (id, divisionId, orderIndex, code, name = code) => ({ id, divisionId, orderIndex, code, name });

test('o nome só aparece quando difere do código', () => {
  assert.equal(shouldShowWorkoutName({ code: 'PROVA 1', name: 'PROVA 1' }), false);
  assert.equal(shouldShowWorkoutName({ code: 'PROVA 1', name: ' prova 1 ' }), false);
  assert.equal(shouldShowWorkoutName({ code: 'PROVA 1', name: 'Sincronia' }), true);
  assert.equal(shouldShowWorkoutName({ code: 'PROVA 1', name: '' }), false);
});

test('a mesma prova de duas categorias vira um grupo só, com uma linha por categoria', () => {
  const { groups, unplaced } = buildWorkoutStageList([
    wod('a1', 'rxm', 1, 'PROVA 1'),
    wod('a2', 'scm', 1, 'PROVA 1'),
    wod('a3', 'rxm', 2, 'PROVA 2'),
    wod('a4', 'scm', 2, 'PROVA 2')
  ], divisions.slice(0, 2));

  assert.equal(groups.length, 2);
  assert.equal(groups[0].title, 'PROVA 1');
  assert.equal(groups[0].subtitle, '');
  assert.deepEqual(groups[0].rows.map((row) => row.label), ['Dupla Rx Masculino', 'Dupla Scaled Masculino']);
  assert.deepEqual(groups[0].rows.map((row) => row.ownLabel), ['', '']);
  assert.equal(groups[0].coveredCount, 2);
  assert.equal(groups[0].totalCount, 2);
  assert.deepEqual(groups[0].gaps, []);
  assert.equal(groups[1].title, 'PROVA 2');
  assert.deepEqual(unplaced, []);
});

test('nome comum vira subtítulo; nome próprio de uma categoria aparece só na linha dela', () => {
  const { groups } = buildWorkoutStageList([
    wod('r1', 'rxm', 1, 'PROVA 1', 'Sincronia'),
    wod('s1', 'scm', 1, 'PROVA 1', 'Sincronia'),
    wod('r2', 'rxm', 2, 'PROVA 2', 'Barra e Remo'),
    wod('s2', 'scm', 2, 'PROVA 2', 'Remo leve')
  ], divisions.slice(0, 2));

  assert.equal(groups[0].subtitle, 'Sincronia');
  assert.deepEqual(groups[0].rows.map((row) => row.ownLabel), ['', '']);
  assert.equal(groups[1].subtitle, '');
  assert.deepEqual(groups[1].rows.map((row) => row.ownLabel), ['Barra e Remo', 'Remo leve']);
});

test('códigos diferentes no mesmo lugar: o título é "Prova N" e cada linha traz o próprio código', () => {
  const { groups } = buildWorkoutStageList([
    wod('r1', 'rxm', 1, 'WOD 1', 'DT'),
    wod('s1', 'scm', 1, 'WOD 1A', 'DT')
  ], divisions.slice(0, 2));

  assert.equal(groups[0].title, 'Prova 1');
  assert.equal(groups[0].suggestedCode, '');
  assert.equal(groups[0].subtitle, 'DT');
  assert.deepEqual(groups[0].rows.map((row) => row.ownLabel), ['WOD 1', 'WOD 1A']);
});

test('a numeração é a do construtor: a N-ésima prova da categoria, não o orderIndex', () => {
  // A Master só tem provas de ordem 3 e 4: são a Prova 1 e a Prova 2 dela.
  const { groups } = buildWorkoutStageList([
    wod('r1', 'rxm', 1, 'WOD 1'),
    wod('r2', 'rxm', 2, 'WOD 2'),
    wod('m3', 'ma', 3, 'WOD 3'),
    wod('m4', 'ma', 4, 'WOD 4')
  ], [divisions[0], divisions[2]]);

  assert.equal(groups.length, 2);
  assert.equal(groups[0].title, 'Prova 1');
  assert.deepEqual(groups[0].rows.map((row) => row.workout.id), ['r1', 'm3']);
  assert.deepEqual(groups[1].rows.map((row) => row.workout.id), ['r2', 'm4']);
});

test('lacunas: só a primeira prova que falta da categoria pode ser cadastrada; as seguintes dizem o que vem antes', () => {
  const { groups } = buildWorkoutStageList([
    wod('r1', 'rxm', 1, 'PROVA 1'),
    wod('r2', 'rxm', 2, 'PROVA 2'),
    wod('r3', 'rxm', 3, 'PROVA 3'),
    wod('s1', 'scm', 1, 'PROVA 1')
  ], divisions.slice(0, 2));

  assert.equal(groups.length, 3);
  assert.equal(groups[0].gaps.length, 0);
  assert.equal(groups[0].coveredCount, 2);
  assert.equal(groups[1].coveredCount, 1);
  assert.equal(groups[1].suggestedCode, 'PROVA 2');
  assert.deepEqual(groups[1].gaps.map((gap) => [gap.division.id, gap.canAdd, gap.blockedBy]), [['scm', true, 2]]);
  assert.deepEqual(groups[2].gaps.map((gap) => [gap.division.id, gap.canAdd, gap.blockedBy]), [['scm', false, 2]]);
});

test('prova Geral vale para todas as categorias e aparece como uma linha só', () => {
  const { groups, unplaced } = buildWorkoutStageList([
    wod('g1', null, 1, 'FINAL', 'Final geral'),
    wod('r2', 'rxm', 2, 'PROVA 2'),
    wod('s2', 'scm', 2, 'PROVA 2')
  ], divisions.slice(0, 2));

  assert.equal(groups.length, 2);
  assert.equal(groups[0].rows.length, 1);
  assert.equal(groups[0].rows[0].label, 'Todas as categorias');
  assert.equal(groups[0].rows[0].isGeneral, true);
  assert.equal(groups[0].rows[0].divisions.length, 2);
  assert.equal(groups[0].coveredCount, 2);
  assert.equal(groups[0].subtitle, 'Final geral');
  assert.deepEqual(unplaced, []);
});

test('prova Geral em posições diferentes por categoria: uma linha em cada grupo, com as categorias que ela cobre', () => {
  // A Rx tem uma prova própria antes da Geral; a Scaled não. A Geral é a Prova 2 da Rx e a Prova 1 da Scaled.
  const { groups } = buildWorkoutStageList([
    wod('r1', 'rxm', 1, 'PROVA 1'),
    wod('g', null, 2, 'FINAL')
  ], divisions.slice(0, 2));

  assert.equal(groups.length, 2);
  const general = groups.flatMap((group) => group.rows).filter((row) => row.workout.id === 'g');
  assert.equal(general.length, 2);
  assert.deepEqual(general.map((row) => row.label), ['Geral · 1 categoria', 'Geral · 1 categoria']);
  assert.deepEqual(general.map((row) => row.coverageNote), ['Dupla Scaled Masculino', 'Dupla Rx Masculino']);
});

test('prova sem categoria visível vai para "unplaced": categoria removida ou evento sem categorias', () => {
  const orphan = buildWorkoutStageList([
    wod('r1', 'rxm', 1, 'PROVA 1'),
    wod('x1', 'removida', 2, 'PROVA 2')
  ], divisions.slice(0, 2));
  assert.equal(orphan.groups.length, 1);
  assert.deepEqual(orphan.unplaced.map((workout) => workout.id), ['x1']);

  const none = buildWorkoutStageList([wod('g1', null, 1, 'PROVA 1')], []);
  assert.equal(none.groups.length, 0);
  assert.deepEqual(none.unplaced.map((workout) => workout.id), ['g1']);
});

test('as categorias seguem a ordem de exibição e a lista de provas não é alterada', () => {
  const input = [wod('s1', 'scm', 1, 'PROVA 1'), wod('r1', 'rxm', 1, 'PROVA 1')];
  const snapshot = JSON.stringify(input);
  const reversed = [
    { id: 'rxm', name: 'Rx', orderIndex: 5 },
    { id: 'scm', name: 'Scaled', orderIndex: 1 }
  ];
  const { groups } = buildWorkoutStageList(input, reversed);
  assert.deepEqual(groups[0].rows.map((row) => row.label), ['Scaled', 'Rx']);
  assert.equal(JSON.stringify(input), snapshot);
});

test('sem provas não há grupos', () => {
  const { groups, unplaced } = buildWorkoutStageList([], divisions);
  assert.deepEqual(groups, []);
  assert.deepEqual(unplaced, []);
});

const renderList = (workouts, divisionList, props = {}) => renderToStaticMarkup(createElement(WorkoutStageList, {
  workouts: workouts.map((workout) => ({ type: 'fortime', timeCap: '12:00', description: 'Movimentos da prova', ...workout })),
  divisions: divisionList,
  showSubmissionDeadline: false,
  getScoreLabel: () => 'Tempo',
  onEdit: () => {},
  onDelete: () => {},
  onAddMissing: () => {},
  ...props
}));

test('componente: um título por prova do evento, uma linha por categoria e botões que dizem a categoria', () => {
  const html = renderList([
    wod('a1', 'rxm', 1, 'PROVA 1'),
    wod('a2', 'scm', 1, 'PROVA 1'),
    wod('a3', 'rxm', 2, 'PROVA 2')
  ], divisions.slice(0, 2));

  assert.equal((html.match(/>PROVA 1</g) || []).length, 1, 'o código repetido aparece uma vez');
  assert.match(html, /2 de 2 categorias/);
  assert.match(html, /1 de 2 categorias/);
  assert.match(html, /aria-label="Editar prova PROVA 1 · Dupla Rx Masculino"/);
  assert.match(html, /aria-label="Excluir prova PROVA 1 · Dupla Scaled Masculino"/);
  assert.match(html, /aria-expanded="false"[^>]*aria-controls="wod-list-desc-a1"|aria-controls="wod-list-desc-a1"[^>]*aria-expanded="false"/);
  assert.match(html, /<pre id="wod-list-desc-a1" hidden=""/);
  assert.match(html, /Sem prova 2:/);
  assert.match(html, /aria-label="Cadastrar PROVA 2 para Dupla Scaled Masculino"/);
});

test('componente: súmula digital, desempate e prazo do Qualifier continuam visíveis', () => {
  const html = renderList([
    { ...wod('a1', 'rxm', 1, 'PROVA 1'), tieBreaker: 'Colocação no WOD 1', submissionClosesAt: null }
  ], divisions.slice(0, 1), { showSubmissionDeadline: true });

  assert.match(html, /Desempate: Colocação no WOD 1/);
  assert.match(html, /Prazo de submissão: não configurado/);
  assert.doesNotMatch(renderList([wod('a1', 'rxm', 1, 'PROVA 1')], divisions.slice(0, 1)), /Prazo de submissão/);
});

test('componente: prova órfã aparece em "Sem categoria ativa" e continua editável', () => {
  const html = renderList([wod('x1', 'removida', 1, 'PROVA 1')], divisions.slice(0, 1));
  assert.match(html, /Sem categoria ativa/);
  assert.match(html, /aria-label="Editar prova PROVA 1 · Categoria removida"/);
});

test('painel: a lista usa o componente e o atalho só prepara o formulário', () => {
  const admin = read('../src/app/admin/page.tsx');
  assert.match(admin, /import \{ WorkoutStageList \} from '@\/components\/admin\/WorkoutStageList';/);
  assert.match(admin, /<WorkoutStageList[\s\S]*?onAddMissing=\{handleAddMissingWorkout\}/);
  assert.doesNotMatch(admin, /sortWorkouts\(workouts\)\.map\(\(wod\)/, 'a lista corrida de cartões saiu');

  const shortcut = admin.match(/const handleAddMissingWorkout = \([^)]*\) => \{[\s\S]*?\n {2}\};/)?.[0] || '';
  assert.match(shortcut, /resetWorkoutForm\(\);/);
  assert.match(shortcut, /setWodDivisionId\(divisionId\);/);
  assert.match(shortcut, /setWodCode\(suggestedCode\);/);
  assert.doesNotMatch(shortcut, /addWorkout\(|adminPersist|fetch\(/, 'não grava nada: o gestor revisa e salva');
});
