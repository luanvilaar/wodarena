import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { importServerModule } from './support/serverModuleHarness.mjs';

// Story 1.133: busca, chips, estados, meses e ?status= da home.

const {
  EMPTY_HOME_FILTERS,
  matchesQuery,
  matchesTime,
  matchesModality,
  matchesHomeFilters,
  countActiveFilters,
  availableUfs,
  groupByMonth,
  formatMonthLabel,
  parseStatusParam,
} = await importServerModule('lib/homeFilters.ts');

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const sheet = read('../src/components/home/HomeFilterSheet.tsx');
const home = read('../src/app/[locale]/HomeView.tsx');

const NOW = new Date('2026-11-11T15:00:00Z');
const ev = (over = {}) => ({
  name: 'Bravos Games 2.0', location: 'Box Bravos do Sertão', city: 'Russas', state: 'CE',
  status: 'upcoming', date: '28 de novembro', startDate: '2026-11-28', endDate: '2026-11-28',
  timeZone: 'America/Fortaleza', eventType: 'functional_fitness', ...over,
});

test('busca por nome, local, cidade e estado sem acento nem maiúscula', () => {
  assert.equal(matchesQuery(ev(), 'bravos'), true);
  assert.equal(matchesQuery(ev(), 'sertao'), true);
  assert.equal(matchesQuery(ev(), 'RUSSAS'), true);
  assert.equal(matchesQuery(ev(), 'ce'), true);
  assert.equal(matchesQuery(ev({ state: 'Ceará' }), 'ce'), true, 'sigla vinda do nome do estado');
  assert.equal(matchesQuery(ev(), 'maceio'), false);
  assert.equal(matchesQuery(ev(), '  '), true);
});

test('esta semana e este mês, contando o que já está acontecendo', () => {
  assert.equal(matchesTime(ev({ startDate: '2026-11-14', endDate: '2026-11-14' }), 'week', NOW), true);
  assert.equal(matchesTime(ev({ startDate: '2026-11-18', endDate: '2026-11-18' }), 'week', NOW), false);
  assert.equal(matchesTime(ev({ startDate: '2026-11-28', endDate: '2026-11-28' }), 'month', NOW), true);
  assert.equal(matchesTime(ev({ startDate: '2026-12-12', endDate: '2026-12-12' }), 'month', NOW), false);
  assert.equal(matchesTime(ev({ startDate: '2026-10-05', endDate: '2026-11-20' }), 'week', NOW), true, 'em andamento');
  assert.equal(matchesTime(ev({ startDate: undefined, endDate: undefined }), 'week', NOW), false);
  assert.equal(matchesTime(ev(), null, NOW), true);
});

test('modalidade: Qualifier conta como Functional Fitness', () => {
  assert.equal(matchesModality(ev({ eventType: 'functional_fitness_qualifier' }), 'functional'), true);
  assert.equal(matchesModality(ev({ eventType: 'fitness_racing' }), 'functional'), false);
  assert.equal(matchesModality(ev({ eventType: 'fitness_racing' }), 'race'), true);
});

test('filtros combinados, contagem e UFs disponíveis', () => {
  const filters = { ...EMPTY_HOME_FILTERS, uf: 'CE', modality: 'functional' };
  assert.equal(matchesHomeFilters(ev(), filters, NOW), true);
  assert.equal(matchesHomeFilters(ev({ state: 'PB - PARAÍBA' }), filters, NOW), false);
  assert.equal(matchesHomeFilters(ev({ status: 'upcoming' }), { ...EMPTY_HOME_FILTERS, live: true }, NOW), false);
  assert.equal(countActiveFilters(filters), 2);
  assert.equal(countActiveFilters({ ...EMPTY_HOME_FILTERS, query: 'x' }), 0, 'a busca não conta como filtro');
  assert.deepEqual(availableUfs([ev(), ev({ state: 'PB - PARAÍBA' }), ev({ state: 'Lisboa' }), ev({ state: 'ce' })]), ['CE', 'PB']);
});

test('agrupa por mês de início, com "a confirmar" por último', () => {
  const list = [ev({ name: 'A', startDate: '2026-11-14' }), ev({ name: 'B', startDate: '2026-12-12' }), ev({ name: 'C', startDate: undefined, endDate: undefined }), ev({ name: 'D', startDate: '2026-11-28' })];
  assert.deepEqual(groupByMonth(list, 'asc', NOW).map((g) => [g.key, g.events.map((e) => e.name)]), [['2026-11', ['A', 'D']], ['2026-12', ['B']], ['tbd', ['C']]]);
  assert.deepEqual(groupByMonth(list, 'desc', NOW).map((g) => g.key), ['2026-12', '2026-11', 'tbd']);
  // Começou antes de hoje e não acabou: "acontecendo agora", no topo dos próximos.
  const ongoing = ev({ name: 'Q', startDate: '2026-10-05', endDate: '2026-11-20' });
  assert.deepEqual(groupByMonth([ongoing, ...list], 'asc', NOW).map((g) => g.key), ['now', '2026-11', '2026-12', 'tbd']);
  assert.equal(formatMonthLabel('2026-11', 'pt-BR'), 'Novembro de 2026');
  assert.equal(formatMonthLabel('2026-11', 'en-GB'), 'November 2026');
});

test('?status= vira aba e chip', () => {
  assert.deepEqual(parseStatusParam('live'), { tab: 'upcoming', live: true });
  assert.deepEqual(parseStatusParam('finished'), { tab: 'results', live: false });
  assert.deepEqual(parseStatusParam('all'), { tab: 'upcoming', live: false });
  assert.equal(parseStatusParam(null), null);
  assert.equal(parseStatusParam('x'), null);
});

test('folha de filtros acessível e chips com estado pressionado', () => {
  assert.match(sheet, /role="dialog"\s+aria-modal="true"\s+aria-labelledby="home-filter-title"/);
  assert.match(sheet, /if \(event\.key === 'Escape'\) onClose\(\);/);
  assert.match(sheet, /aria-pressed=\{selected\}/);
  assert.match(home, /aria-pressed=\{filters\.live\}/);
  assert.match(home, /aria-pressed=\{tab === id\}/);
  assert.match(home, /const closeFilterSheet = useCallback\(\(\) => setIsFilterSheetOpen\(false\), \[\]\);/);
});
