import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { importServerModule } from './support/serverModuleHarness.mjs';

// Stories 1.141 a 1.143: aba "Súmulas e Judges" do gestor organizada por prova e
// bateria (desenho aprovado em docs/design/sumulas-organizacao/). As regras
// ficam no módulo puro scoresheetBoard.ts; a lista é um componente só de
// exibição; o painel depende da sessão e da rede, então fica a regressão estática.

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const board = await importServerModule('lib/scoresheetBoard.ts');
const { ScoresheetBoard, groupSummary } = await importServerModule('components/admin/ScoresheetBoard.tsx');

const workout = (id, code, divisionId, orderIndex, structure = true) => ({ id, name: code, code, divisionId, orderIndex, type: 'amrap', structure: structure ? { version: 2 } : null });
let clock = 0;
const sheet = (id, workoutId, athleteId, status, extra = {}) => ({
  id,
  workoutId,
  athleteId,
  athleteName: extra.athleteName ?? `Atleta ${athleteId}`,
  box: extra.box ?? 'Box 1',
  divisionId: extra.divisionId ?? null,
  heatId: extra.heatId ?? null,
  heatNumber: extra.heatNumber ?? null,
  lane: extra.lane ?? null,
  status,
  judgeName: extra.judgeName ?? 'Iara',
  officialResult: status === 'submitted' ? (extra.result ?? '100') : null,
  officialTieBreak: null,
  corrected: extra.corrected ?? false,
  absent: extra.absent ?? false,
  updatedAt: extra.updatedAt ?? `2026-11-15T10:${String(clock++).padStart(2, '0')}:00.000Z`
});
const athlete = (id, divisionId, name = `Atleta ${id}`) => ({ id, name, box: 'Box 1', divisionId });

// Prova 2 do evento: uma prova por categoria (rx e sc), com baterias mistas.
const WORKOUTS = [
  workout('w2-rx', 'PROVA 2', 'rx', 2),
  workout('w2-sc', 'Prova 2 ', 'sc', 2),
  workout('w3', 'PROVA 3.1', null, 3),
  workout('w4', 'PROVA 3.2', null, 4),
  workout('w1', 'PROVA 1', null, 1, false)
];
const ATHLETES = [athlete('a1', 'rx'), athlete('a2', 'rx'), athlete('a3', 'sc'), athlete('a4', 'sc'), athlete('a5', 'sc'), athlete('a6', 'rx')];
const heat = (id, heatNumber, athleteIds, laneWorkoutIds, time = '10:00') => ({ id, kind: 'heat', heatNumber, date: '2026-11-15', time, stageNumber: 2, athleteIds, laneWorkoutIds, workoutId: laneWorkoutIds[0] });
const HEATS = [
  heat('h2', 2, ['a3', 'a4', 'a5'], ['w2-sc', 'w2-sc', 'w2-sc'], '10:20'),
  heat('h1', 1, ['a1', 'a2', '', 'a3'], ['w2-rx', 'w2-rx', '', 'w2-sc'], '10:00')
];

test('1.141: provas pelo código (sem diferença de maiúsculas e espaços), na ordem da aba Provas; sem súmula digital nem súmula, fica de fora', () => {
  const provas = board.groupScoresheetProvas(WORKOUTS, []);
  assert.deepEqual(provas.map((prova) => [prova.key, prova.label, prova.workoutIds]), [
    ['PROVA 2', 'PROVA 2', ['w2-rx', 'w2-sc']],
    ['PROVA 3.1', 'PROVA 3.1', ['w3']],
    ['PROVA 3.2', 'PROVA 3.2', ['w4']]
  ]);
  assert.deepEqual(board.groupScoresheetProvas(WORKOUTS, ['w1']).map((prova) => prova.key), ['PROVA 1', 'PROVA 2', 'PROVA 3.1', 'PROVA 3.2'], 'prova sem estrutura, mas com súmula, aparece');
  assert.equal(board.getScoresheetProvaKey({ id: 'x', code: '', name: '' }), 'id:x');
  assert.equal(board.getScoresheetProvaKey({ id: 'y', code: ' prova   2', name: 'Outra' }), 'PROVA 2');
  assert.equal(board.getScoresheetProvaKey({ id: 'z', code: '', name: 'Final' }), 'FINAL', 'sem código, vale o nome');
});

test('1.141: a aba abre na prova da súmula atualizada por último; sem súmula, na primeira', () => {
  const provas = board.groupScoresheetProvas(WORKOUTS, []);
  const sheets = [
    sheet('s1', 'w2-rx', 'a1', 'submitted', { updatedAt: '2026-11-15T10:00:00.000Z' }),
    sheet('s2', 'w4', 'a2', 'in_progress', { updatedAt: '2026-11-15T15:00:00.000Z' }),
    sheet('s3', 'w-outra', 'a3', 'submitted', { updatedAt: '2026-11-15T18:00:00.000Z' })
  ];
  assert.equal(board.pickDefaultProva(provas, sheets), 'PROVA 3.2');
  assert.equal(board.pickDefaultProva(provas, []), 'PROVA 2');
  assert.equal(board.pickDefaultProva([], sheets), null);
});

const prova2Sheets = () => [
  sheet('s-a1', 'w2-rx', 'a1', 'submitted', { heatId: 'h1', heatNumber: 1, lane: 1, divisionId: 'rx', corrected: true }),
  sheet('s-a1-old', 'w2-rx', 'a1', 'cancelled', { heatId: 'h1', heatNumber: 1, lane: 1, divisionId: 'rx' }),
  sheet('s-a2-old', 'w2-rx', 'a2', 'cancelled', { heatId: 'h1', heatNumber: 1, lane: 2, divisionId: 'rx' }),
  sheet('s-a3', 'w2-sc', 'a3', 'in_progress', { heatId: 'h1', heatNumber: 1, lane: 4, divisionId: 'sc' }),
  sheet('s-a6', 'w2-rx', 'a6', 'submitted', { heatNumber: 3, lane: 1, divisionId: 'rx', absent: true })
];

test('1.142: bateria do cronograma raia por raia, com a súmula ativa, as canceladas presas ao atleta e as categorias misturadas', () => {
  const result = board.buildScoresheetBoard({ workoutIds: ['w2-rx', 'w2-sc'], sheets: prova2Sheets(), heats: HEATS, athletes: ATHLETES, divisionOrder: ['rx', 'sc'] });
  assert.deepEqual(result.groups.map((group) => [group.key, group.kind, group.heatNumber]), [
    ['heat:h1', 'heat', 1],
    ['heat:h2', 'heat', 2],
    ['outside', 'outside', null]
  ]);
  const [first, second, outside] = result.groups;
  assert.deepEqual(first.entries.map((entry) => [entry.key, entry.lane, entry.state, entry.sheet?.id ?? null, entry.cancelled.map((item) => item.id)]), [
    ['heat:h1:1', 1, 'submitted', 's-a1', ['s-a1-old']],
    ['heat:h1:2', 2, 'missing', null, ['s-a2-old']],
    ['heat:h1:4', 4, 'in_progress', 's-a3', []]
  ], 'raia vazia no cronograma não vira linha; raia só com cancelada é "sem súmula"');
  assert.equal(first.started, true);
  assert.equal(first.complete, false);
  // a3 já está na bateria 1: não se repete na bateria 2.
  assert.deepEqual(second.entries.map((entry) => [entry.athleteId, entry.state]), [['a4', 'waiting'], ['a5', 'waiting']]);
  assert.equal(second.started, false);
  assert.deepEqual(outside.entries.map((entry) => [entry.key, entry.state, entry.heatNumber]), [['pair:a6|w2-rx', 'submitted', 3]]);
  assert.deepEqual(result.stats, { total: 6, published: 2, inProgress: 1, returned: 0, missing: 1, waiting: 2, cancelled: 2, pending: 2 });
});

test('1.142: sem bateria no cronograma vale a bateria da súmula; sem nenhuma, "Sem bateria" por categoria e nome; nenhuma súmula some', () => {
  const sheets = [
    sheet('b2', 'w4', 'a1', 'submitted', { heatNumber: 2, lane: 1, divisionId: 'rx' }),
    sheet('n1', 'w4', 'a4', 'submitted', { divisionId: 'sc', athleteName: 'Zé' }),
    sheet('n2', 'w4', 'a2', 'submitted', { divisionId: 'rx', athleteName: 'Bruno' }),
    sheet('n3', 'w4', 'a5', 'submitted', { divisionId: 'sc', athleteName: 'Ana' }),
    sheet('c1', 'w4', 'a6', 'cancelled', { divisionId: 'rx' }),
    sheet('b1', 'w4', 'a3', 'returned', { heatNumber: 1, lane: 2, divisionId: 'sc' }),
    sheet('d1', 'w4', 'a3', 'submitted', { heatNumber: 1, lane: 3, divisionId: 'sc', updatedAt: '2026-11-15T09:00:00.000Z' })
  ];
  const result = board.buildScoresheetBoard({ workoutIds: ['w4'], sheets, heats: HEATS, athletes: ATHLETES, divisionOrder: ['rx', 'sc'] });
  assert.deepEqual(result.groups.map((group) => [group.key, group.kind, group.entries.map((entry) => entry.athleteName)]), [
    ['sheet-heat:1', 'sheet_heat', ['Atleta a3', 'Atleta a3']],
    ['sheet-heat:2', 'sheet_heat', ['Atleta a1']],
    ['no-heat', 'no_heat', ['Atleta a6', 'Bruno', 'Ana', 'Zé']]
  ]);
  assert.equal(result.groups[2].entries[0].state, 'cancelled', 'só cancelada: aparece com o filtro de canceladas');
  assert.equal(result.stats.total, 6);
  assert.equal(result.stats.returned, 1);
  assert.equal(result.stats.missing, 0, 'sem cronograma não há raia faltando');
});

test('1.142: bateria antiga (por prova) e atleta que saiu do evento sem súmula', () => {
  const old = { id: 'old', kind: 'heat', heatNumber: 1, date: '', time: '', athleteIds: ['a1', 'fantasma', 'a2'], workoutId: 'w3' };
  const result = board.buildScoresheetBoard({ workoutIds: ['w3'], sheets: [sheet('x', 'w3', 'a2', 'submitted', { lane: 3 })], heats: [old], athletes: ATHLETES });
  assert.deepEqual(result.groups[0].entries.map((entry) => [entry.lane, entry.athleteId, entry.state]), [[1, 'a1', 'missing'], [3, 'a2', 'submitted']]);
});

test('1.141: filtros por categoria, busca sem acento, só pendências e canceladas', () => {
  const entry = (state, extra = {}) => ({ key: 'k', athleteId: 'a', workoutId: 'w', divisionId: 'rx', athleteName: 'Joaquim Árvore', box: 'CF Maré', heatNumber: 1, lane: 1, sheet: null, cancelled: [], state, ...extra });
  const filter = { divisionId: null, query: '', pendingOnly: false, showCancelled: false };
  assert.equal(board.boardEntryMatches(entry('submitted'), filter), true);
  assert.equal(board.boardEntryMatches(entry('submitted'), { ...filter, divisionId: 'sc' }), false);
  assert.equal(board.boardEntryMatches(entry('submitted'), { ...filter, query: '  arvore ' }), true);
  assert.equal(board.boardEntryMatches(entry('submitted'), { ...filter, query: 'mare' }), true, 'busca no box');
  assert.equal(board.boardEntryMatches(entry('submitted'), { ...filter, pendingOnly: true }), false);
  for (const state of ['in_progress', 'returned', 'missing']) assert.equal(board.boardEntryMatches(entry(state), { ...filter, pendingOnly: true }), true, state);
  assert.equal(board.boardEntryMatches(entry('waiting'), { ...filter, pendingOnly: true }), false, 'bateria que não começou não é pendência');
  assert.equal(board.boardEntryMatches(entry('cancelled'), filter), false);
  assert.equal(board.boardEntryMatches(entry('cancelled'), { ...filter, showCancelled: true }), true);
  assert.equal(board.isBoardFilterActive(filter), false);
  assert.equal(board.isBoardFilterActive({ ...filter, showCancelled: true }), false, 'mostrar canceladas não abre tudo');
  assert.equal(board.isBoardFilterActive({ ...filter, query: ' x ' }), true);
});

test('1.142: bateria completa ou que não começou fica recolhida; contagem por categoria; nome do time separado', () => {
  assert.equal(board.isBoardGroupOpenByDefault({ kind: 'heat', started: true, complete: true }), false);
  assert.equal(board.isBoardGroupOpenByDefault({ kind: 'heat', started: false, complete: false }), false);
  assert.equal(board.isBoardGroupOpenByDefault({ kind: 'heat', started: true, complete: false }), true);
  assert.equal(board.isBoardGroupOpenByDefault({ kind: 'no_heat', started: true, complete: false }), true);
  const result = board.buildScoresheetBoard({ workoutIds: ['w2-rx', 'w2-sc'], sheets: prova2Sheets(), heats: HEATS, athletes: ATHLETES });
  assert.deepEqual(board.countBoardDivisions(result), { rx: 3, sc: 3 });
  assert.deepEqual(board.splitTeamName('Os Insistentes (Ana Lima / Bia Souza)'), { primary: 'Os Insistentes', secondary: 'Ana Lima / Bia Souza' });
  assert.deepEqual(board.splitTeamName('Lucas Barros'), { primary: 'Lucas Barros', secondary: '' });
});

const DIVISION_NAMES = { rx: 'Rx Individual', sc: 'Dupla Scaled' };
const render = (groups, filter = {}, openGroups = {}) => renderToStaticMarkup(createElement(ScoresheetBoard, {
  idPrefix: 't',
  groups,
  filter: { divisionId: null, query: '', pendingOnly: false, showCancelled: false, ...filter },
  openGroups,
  divisionNames: DIVISION_NAMES,
  onToggleGroup: () => {},
  onSelect: () => {},
  formatWhen: () => '15/11, 10:30'
}));

test('1.142: a lista mostra a bateria com o resumo, as raias, a categoria, "+1 cancelada", "Sem súmula" e "Ausente"', () => {
  const result = board.buildScoresheetBoard({ workoutIds: ['w2-rx', 'w2-sc'], sheets: prova2Sheets(), heats: HEATS, athletes: ATHLETES });
  const html = render(result.groups);
  assert.match(html, /Bateria 1/);
  assert.match(html, /10:00/);
  assert.match(html, /Rx Individual, Dupla Scaled/);
  assert.match(html, /1\/3 publicadas · 1 sem súmula · 1 em andamento/);
  assert.match(html, /aria-expanded="true"/, 'bateria começada e incompleta abre');
  assert.match(html, /Aguardando · 2 raias/);
  assert.match(html, /Fora das baterias do cronograma/);
  assert.match(html, /1\/1 publicadas/);
  assert.match(html, /\+1 cancelada/);
  assert.match(html, /Sem súmula/);
  assert.match(html, />corrigido</);
  assert.doesNotMatch(html, />Ausente</, 'grupo completo fica recolhido');
  assert.match(render(result.groups, {}, { outside: true }), />Ausente</);
  assert.match(html, /Iara · 15\/11, 10:30/);
  assert.equal((html.match(/data-entry="heat:h2:/g) || []).length, 0, 'bateria que não começou fica recolhida');
  assert.doesNotMatch(html, /s-a1-old/, 'cancelada escondida por padrão');

  const withCancelled = render(result.groups, { showCancelled: true });
  assert.match(withCancelled, /data-sheet="s-a1-old"/);
  assert.match(withCancelled, /opacity-60/);
  assert.doesNotMatch(withCancelled, /\+1 cancelada/);

  const onlyRx = render(result.groups, { divisionId: 'rx' });
  assert.doesNotMatch(onlyRx, /Bateria 2/, 'bateria sem atleta da categoria some');
  assert.doesNotMatch(onlyRx, /Rx Individual · /, 'com uma categoria filtrada a linha não repete a categoria');

  assert.match(render(result.groups, { query: 'ninguém' }), /Nenhuma súmula com esses filtros\./);
  assert.match(render([]), /Nenhuma súmula aberta ainda\./);
  const closed = render(result.groups, {}, { 'heat:h1': false });
  assert.equal((closed.match(/data-entry="heat:h1:/g) || []).length, 0, 'a escolha do gestor manda');
});

test('1.142: resumo da bateria completa e da que não começou', () => {
  const counts = (submitted, live) => ({ submitted, in_progress: 0, returned: 0, missing: live - submitted, waiting: 0, cancelled: 0 });
  assert.equal(groupSummary({ kind: 'heat', started: true, counts: counts(7, 7), entries: Array(7) }), '7/7 publicadas');
  assert.equal(groupSummary({ kind: 'heat', started: false, counts: { ...counts(0, 0), waiting: 1 }, entries: Array(1) }), 'Aguardando · 1 raia');
});

test('1.141 e 1.143: painel com sub-abas, prova por código, atenção, filtros e painel de detalhe com as ações de antes', () => {
  const panel = read('../src/components/admin/ScoresheetsPanel.tsx');
  assert.match(panel, /\[\['sheets', 'Súmulas'\], \['judges', `Judges · \$\{judges\.length\}`\]\]/);
  assert.match(panel, /groupScoresheetProvas\(event\.workouts, \(sheets \|\| \[\]\)\.map\(\(sheet\) => sheet\.workoutId\)\)/);
  assert.match(panel, /setChosenProva\(\(current\) => current \?\? pickDefaultProva\(/, 'a prova inicial só vale até o gestor escolher');
  assert.match(panel, /aria-label="Precisa de atenção"/);
  assert.match(panel, /placeholder="Buscar atleta, time ou box"/);
  assert.match(panel, /Só pendências \(\{activeBoard\.stats\.pending\}\)/);
  assert.match(panel, /Canceladas \(\{activeBoard\.stats\.cancelled\}\)/);
  assert.match(panel, /const EMPTY_FILTER: BoardFilter = \{ divisionId: null, query: '', pendingOnly: false, showCancelled: false \};/);
  // Painel de detalhe (1.143)
  assert.match(panel, /role="dialog"\s+aria-modal="true"/);
  assert.match(panel, /if \(keyEvent\.key === 'Escape'\)/);
  assert.match(panel, /\{\(sheet\.status === 'submitted' \|\| sheet\.status === 'returned'\) && \(/, 'Corrigir: publicada ou devolvida');
  assert.match(panel, /\{sheet\.status === 'submitted' && \(/, 'Devolver: publicada');
  assert.match(panel, /\{sheet && sheet\.status !== 'cancelled' && \(/, 'Cancelar: não cancelada');
  assert.match(panel, /await load\(\);\s+\/\/ Só recarrega o histórico se o painel ainda está nesta súmula\.\s+if \(historyRequestRef\.current === sheet\.id\) await loadHistory\(sheet\.id\);/, 'lista e histórico recarregados depois da ação, se o painel ainda está na súmula');
  assert.match(panel, /current && current\.entryKey === entryKey \? \{ \.\.\.current, sheetId: sheet\.id \} : current/, 'cancelar não mexe no painel se o gestor trocou de linha');
  assert.match(panel, /if \(historyRequestRef\.current !== sheetId \|\| historySeqRef\.current !== seq\) return;/, 'resposta atrasada do histórico (de outra súmula ou mais antiga da mesma) é descartada');
  assert.match(panel, /if \(receiptRequestRef\.current !== sheetId\) return;/, 'resposta atrasada do link é descartada');
  assert.match(panel, /if \(target\) void loadHistory\(target\);/, 'histórico ao abrir');
  assert.match(panel, /O judge abre a súmula pela Quadra e pode marcar o atleta como ausente\./);
  assert.doesNotMatch(panel, /kind: 'correct' \| 'return' \| 'cancel' \| 'history'/, 'histórico deixou de ser um botão por cartão');
});
