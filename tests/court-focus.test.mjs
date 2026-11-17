import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { importServerModule } from './support/serverModuleHarness.mjs';

// Story 1.147 (docs/design/quadra-por-raia/, D1, D2, D3 e D7): a quadra do
// judge por raia. Regras puras em courtFocus.ts e regressão estática da tela.

const focus = await importServerModule('lib/courtFocus.ts');
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const heat = (id, time, laneStatuses, heatNumber = null, date = '2026-11-15') => ({ id, date, time, heatNumber, laneStatuses });
const N = 'not_started', P = 'in_progress', S = 'submitted', R = 'returned';

test('bateria atual: nenhuma tocada → a primeira do cronograma, sem chamada', () => {
  const heats = [heat('b2', '10:10', [N, N], 2), heat('b1', '10:00', [N, N], 1)];
  assert.deepEqual(focus.findCurrentHeat(heats), { heatId: 'b1', called: false, finished: false });
  assert.equal(focus.findCurrentHeat([]), null);
});

test('bateria atual: a última tocada que não terminou; "em chamada" com súmula aberta', () => {
  const heats = [heat('b1', '10:00', [S, S], 1), heat('b2', '10:10', [S, S], 2), heat('b3', '10:20', [P, N], 3), heat('b4', '10:30', [N, N], 4)];
  assert.deepEqual(focus.findCurrentHeat(heats), { heatId: 'b3', called: true, finished: false });
  const returned = [heat('b1', '10:00', [R, S], 1)];
  assert.deepEqual(focus.findCurrentHeat(returned), { heatId: 'b1', called: true, finished: false });
});

test('bateria atual: terminou → a próxima sem súmula (regra do telão); tudo enviado → a última', () => {
  const heats = [heat('b1', '10:00', [S, S], 1), heat('b2', '10:10', [N, N], 2)];
  assert.deepEqual(focus.findCurrentHeat(heats), { heatId: 'b2', called: false, finished: false });
  assert.deepEqual(focus.findCurrentHeat([heat('b1', '10:00', [S], 1)]), { heatId: 'b1', called: false, finished: true });
});

test('bateria atual: súmula esquecida numa bateria antiga não segura a quadra', () => {
  const heats = [heat('b1', '10:00', [S, P], 1), heat('b2', '10:10', [S, S], 2), heat('b3', '10:20', [N, N], 3)];
  assert.equal(focus.findCurrentHeat(heats).heatId, 'b3');
});

test('ordem oficial: dia e horário, depois o número; a seguinte vem dessa ordem', () => {
  const heats = [heat('d2', '08:00', [N], 1, '2026-11-16'), heat('b2', '10:00', [N], 2), heat('b1', '10:00', [N], 1)];
  assert.deepEqual(focus.orderHeats(heats).map((item) => item.id), ['b1', 'b2', 'd2']);
  assert.equal(focus.followingHeatId(heats, 'b2'), 'd2');
  assert.equal(focus.followingHeatId(heats, 'd2'), null);
});

test('raia no aparelho: número de 1 a 99 ou "multi"; o resto é "sem raia"', () => {
  assert.equal(focus.parseCourtLane('3'), 3);
  assert.equal(focus.parseCourtLane('multi'), 'multi');
  for (const raw of [null, '', '0', '3.5', 'abc', '100', 3]) assert.equal(focus.parseCourtLane(raw), null, String(raw));
  assert.equal(focus.courtLaneStorageKey('ev1'), 'woda:court-lane:ev1');
});

test('abrir (D3): direto só na própria raia da bateria atual ou na súmula que já é do judge', () => {
  const base = { myLane: 3, lane: 3, heatId: 'b4', currentHeatId: 'b4', ownSheet: false };
  assert.deepEqual(focus.openDecision(base), { direct: true, warnings: [] });
  assert.deepEqual(focus.openDecision({ ...base, lane: 5 }), { direct: false, warnings: ['Você está na Raia 3'] });
  assert.deepEqual(focus.openDecision({ ...base, heatId: 'b5' }), { direct: false, warnings: ['Esta bateria não é a que está em chamada'] });
  assert.deepEqual(focus.openDecision({ ...base, myLane: 'multi', lane: 7 }), { direct: false, warnings: [] });
  assert.deepEqual(focus.openDecision({ ...base, heatId: null, lane: null }), { direct: false, warnings: ['Atleta fora das baterias do cronograma'] });
  assert.deepEqual(focus.openDecision({ ...base, lane: 5, heatId: 'b1', ownSheet: true }), { direct: true, warnings: [] });
});

test('lista sem bateria (D7): ordem alfabética e busca sem acento por nome ou box', () => {
  const list = [{ name: 'Yasmin Barreto', box: 'Box Serra' }, { name: 'Ágata Lima', box: 'Forja CF' }, { name: 'Caio Queiroz', box: 'CF Norte' }];
  assert.deepEqual(focus.filterLooseAthletes(list, '').map((item) => item.name), ['Ágata Lima', 'Caio Queiroz', 'Yasmin Barreto']);
  assert.deepEqual(focus.filterLooseAthletes(list, 'agata').map((item) => item.name), ['Ágata Lima']);
  assert.deepEqual(focus.filterLooseAthletes(list, 'serra').map((item) => item.name), ['Yasmin Barreto']);
});

test('tela: escolhe a raia, abre em "Agora", confirma fora da raia e guarda a raia no aparelho', () => {
  const board = read('../src/components/judge/CourtBoard.tsx');
  assert.match(board, /Em qual raia você está\?/);
  assert.match(board, /Vou cobrir várias raias/);
  assert.match(board, /setMyLane\(loadCourtLane\(eventId\)\)/);
  assert.match(board, /saveCourtLane\(eventId, lane\);/);
  assert.match(read('../src/lib/courtFocus.ts'), /window\.localStorage\.setItem\(courtLaneStorageKey\(eventId\), String\(lane\)\)/);
  assert.match(board, /const current = useMemo\(\(\) => findCurrentHeat\(focusHeats\), \[focusHeats\]\);/);
  assert.match(board, /aria-label="Agora na sua raia"/);
  assert.match(board, /if \(decision\.direct\) void open\(/);
  assert.match(board, /role="dialog"/);
  assert.match(board, /'Abrir mesmo assim'/);
  assert.match(board, /Sua súmula aberta/);
  assert.match(board, /Todas as provas e baterias/);
  assert.match(board, /filterLooseAthletes\(looseAthletes, looseQuery\)/);
  // Sem bateria nenhuma no evento, a quadra não pede raia e mostra a lista completa.
  assert.match(board, /!hasHeats \? \(\s*fullList/);
});
