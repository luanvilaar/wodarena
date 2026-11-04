import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createFakeSupabase } from './support/fakeSupabase.mjs';
import { createRaceClient } from './support/fakeRaceSupabase.mjs';
import { BASE_MS, iso } from './support/raceBroadcastScenario.mjs';
import { EVENT_ID, MANAGER, SECRETS, seedRaceDatabase } from './support/raceBroadcastSeed.mjs';
import { importServerModule, setActiveSupabaseClient } from './support/serverModuleHarness.mjs';

// Story 1.115 (Telão Fitness Race, T5): classificação, espera e a mesa do gestor.
// As telas saem de funções puras (src/lib/raceBroadcastScreens.ts), testadas direto
// e com o payload real do servidor; a mesa, pelas rotas reais com o banco em memória
// (gestor dono, owner, outros papéis, acesso vencido, Qualifier, link, modos e a
// recusa de `mark_heat`); o fonte do painel e da aba, por regex, porque o harness
// não carrega CSS nem React. A conferência visual está no Dev Agent Record da story.

process.env.SUPABASE_URL = 'http://supabase.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';
process.env.WODA_SESSION_SECRET = 'segredo-de-teste-telao-race-mesa';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let database = createFakeSupabase();
const state = { missingRaceTables: false, beforeUpdate: {}, beforeCount: {} };
const client = createRaceClient(() => database, state);
setActiveSupabaseClient(client);

const { GET: getControl, POST: postControl } = await importServerModule('app/api/telao/control/route.ts');
const { GET: getTelao } = await importServerModule('app/api/telao/[token]/route.ts');
const { createSessionToken } = await importServerModule('lib/serverSecurity.ts');
const { BROADCAST_EVENT_TYPE_MESSAGE } = await importServerModule('lib/serverBroadcast.ts');
const { RACE_SHEETS_MIGRATION } = await importServerModule('lib/serverRaceSheets.ts');
const screens = await importServerModule('lib/raceBroadcastScreens.ts');
const view = await importServerModule('lib/raceBroadcastView.ts');
const builder = await importServerModule('lib/serverRaceBroadcast.ts');

const nowAt = (seconds) => BASE_MS + seconds * 1000;

// ---------------------------------------------------------------------------
// Payloads sintéticos, só com o que cada função lê
// ---------------------------------------------------------------------------

const classRow = (key, position, over = {}) => ({
  key, position, name: `Atleta ${key}`, box: `Box ${key}`, waveTitle: 'Onda 3',
  finalSeconds: position === null ? null : 3900 + position * 10,
  timeText: position === null ? null : 'texto do servidor',
  gapSeconds: position === null || position === 1 ? null : (position - 1) * 10,
  dnf: position === null, fresh: false, ...over
});
const division = (key, name, rows, bests = []) => ({ key, name, rows, bests });
const best = (over = {}) => ({ divisionKey: 'open-m', stationId: 'ski-erg', stationKey: 'ski-erg', stationName: 'Ski Erg', seconds: 218, athleteKey: 'rafael', name: 'Rafael Tavares', box: 'Box Aldeota', waveTitle: 'Onda 3', ...over });
const brief = (over = {}) => ({ key: 'w4', title: 'Onda 4', heatNumber: 4, date: '2026-11-14', time: '10:40', divisionNames: ['Open Masculino', 'Open Feminino'], athleteCount: 12, ...over });
const finishers = (count, from = 1) => Array.from({ length: count }, (_, index) => classRow(`m${from + index}`, from + index));

// ---------------------------------------------------------------------------
// AC2: classificação
// ---------------------------------------------------------------------------

test('AC2: a classificação de uma categoria: tabela de 10 linhas, DNF no fim, diferença só para quem não é o 1º e o selo NOVO', () => {
  const rows = [...finishers(10), classRow('dnf1', null)];
  rows[0] = classRow('m1', 1, { fresh: true, name: 'Rafael Tavares', box: 'Box Aldeota' });
  const cls = {
    steps: [{ kind: 'class', divisionKey: 'open-m', page: 0, pageCount: 2 }, { kind: 'class', divisionKey: 'open-m', page: 1, pageCount: 2 }],
    divisions: [division('open-m', 'Open Masculino', rows, [best()])]
  };
  const first = screens.raceClassFrame(cls, brief(), 12_000 * 40 + 1);
  assert.deepEqual([first.title, first.divisionName, first.meta, first.pageIndex, first.pageCount], ['Classificação · Open Masculino', 'Open Masculino', '10 com tempo · 1 DNF', 0, 2]);
  assert.equal(first.rows.length, 10);
  assert.deepEqual(first.rows[0], { key: 'm1', position: '1', name: 'Rafael Tavares', box: 'Box Aldeota', wave: 'Onda 3', time: '1:05:10', gap: '', fresh: true, dnf: false });
  assert.deepEqual([first.rows[1].position, first.rows[1].time, first.rows[1].gap, first.rows[1].fresh], ['2', '1:05:20', '+0:10', false], 'o 2º leva a diferença para o 1º');
  assert.equal(first.rows[9].gap, '+1:30');
  const second = screens.raceClassFrame(cls, brief(), 12_000 * 41 + 1);
  assert.deepEqual([second.pageIndex, second.rows.length], [1, 1]);
  assert.deepEqual(second.rows[0], { key: 'dnf1', position: '–', name: 'Atleta dnf1', box: 'Box dnf1', wave: 'Onda 3', time: 'DNF', gap: '', fresh: false, dnf: true }, 'DNF sem posição, sem diferença');
});

test('AC2: tempo e diferença pela função única de formatação: segundos inteiros, h:mm:ss a partir de 1 h, arredonda e nunca trunca', () => {
  const cls = {
    steps: [{ kind: 'class', divisionKey: 'open-m', page: 0, pageCount: 1 }],
    divisions: [division('open-m', 'Open Masculino', [
      classRow('a', 1, { finalSeconds: 3599.5, gapSeconds: null, timeText: 'x' }),
      classRow('b', 2, { finalSeconds: 3600, gapSeconds: 0.5, timeText: 'y' }),
      classRow('c', 3, { finalSeconds: 4015, gapSeconds: 415.4, timeText: 'z' })
    ])]
  };
  const frame = screens.raceClassFrame(cls, null, 0);
  assert.deepEqual(frame.rows.map((row) => [row.time, row.gap]), [['1:00:00', ''], ['1:00:00', '+0:01'], ['1:06:55', '+6:55']], 'o texto do servidor não é usado: a formatação é uma só');
  assert.equal(view.formatRaceTime(3599.5), '1:00:00');
});

test('AC2: DNF vem no fim mesmo se o payload os trouxer antes; a meta conta com tempo e DNF', () => {
  const cls = {
    steps: [{ kind: 'class', divisionKey: 'open-m', page: 0, pageCount: 1 }],
    divisions: [division('open-m', 'Open Masculino', [classRow('d1', null), classRow('a', 1), classRow('d2', null), classRow('b', 2)])]
  };
  const frame = screens.raceClassFrame(cls, null, 0);
  assert.deepEqual(frame.rows.map((row) => row.key), ['a', 'b', 'd1', 'd2']);
  assert.equal(frame.meta, '2 com tempo · 2 DNF');
  const noDnf = screens.raceClassFrame({ ...cls, divisions: [division('open-m', 'Open Masculino', finishers(3))] }, null, 0);
  assert.equal(noDnf.meta, '3 com tempo', 'sem DNF, a meta não fala de DNF');
});

test('AC2: passos de 12 s: categoria × página, iguais em duas TVs; o passo do grid não é da classificação', () => {
  const cls = {
    steps: [
      { kind: 'class', divisionKey: 'open-m', page: 0, pageCount: 2 },
      { kind: 'class', divisionKey: 'open-m', page: 1, pageCount: 2 },
      { kind: 'class', divisionKey: 'open-f', page: 0, pageCount: 1 },
      { kind: 'grid', waveKey: 'w4', page: 0, pageCount: 1 }
    ],
    divisions: [division('open-m', 'Open Masculino', finishers(12)), division('open-f', 'Open Feminino', finishers(3, 1).map((row) => ({ ...row, key: `f${row.key}` })))]
  };
  const at = (step) => screens.raceClassFrame(cls, null, 12_000 * (40 + step) + 777);
  assert.deepEqual([at(0).divisionName, at(0).pageIndex, at(0).rows.length], ['Open Masculino', 0, 10]);
  assert.deepEqual([at(1).divisionName, at(1).pageIndex, at(1).rows.length], ['Open Masculino', 1, 2]);
  assert.deepEqual([at(2).divisionName, at(2).pageIndex, at(2).pageCount], ['Open Feminino', 0, 1]);
  assert.equal(at(3), null, 'o passo do grid (alternância com a próxima onda)');
  assert.equal(at(4).divisionName, 'Open Masculino', 'volta ao começo');
  assert.deepEqual(screens.raceClassFrame(cls, null, 12_000 * 40 + 1), screens.raceClassFrame(cls, null, 12_000 * 40 + 11_999), 'o mesmo passo durante os 12 s');
  assert.equal(screens.raceClassFrame({ ...cls, steps: [] }, null, 0), null, 'sem passos, sem tela');
  assert.equal(screens.raceClassFrame({ ...cls, steps: [{ kind: 'class', divisionKey: 'sumiu', page: 0, pageCount: 1 }] }, null, 0), null, 'categoria que não veio no payload, sem erro');
  assert.equal(screens.RACE_CLASS_FOOTER.label, 'Resultados');
});

test('AC2: categoria fixada ainda sem resultado: a tabela diz "Nenhum resultado publicado ainda", nunca tela em branco', () => {
  const cls = { steps: [{ kind: 'class', divisionKey: 'open-f', page: 0, pageCount: 1 }], divisions: [division('open-f', 'Open Feminino', [])] };
  const frame = screens.raceClassFrame(cls, brief(), 0);
  assert.deepEqual([frame.title, frame.meta, frame.rows.length, frame.emptyText, frame.pageCount], ['Classificação · Open Feminino', '', 0, 'Nenhum resultado publicado ainda', 1]);
  assert.equal(screens.raceClassFrame({ ...cls, divisions: [division('open-f', 'Open Feminino', finishers(1))] }, null, 0).emptyText, '', 'com resultado, sem o aviso');
});

test('AC2: "Melhores por estação" só lista estações com tempo, com "nome · onda" e a nota; sem nenhuma, a lista diz isso', () => {
  const steps = [{ kind: 'class', divisionKey: 'open-m', page: 0, pageCount: 1 }];
  const withBests = screens.raceClassFrame({ steps, divisions: [division('open-m', 'Open Masculino', finishers(2), [best(), best({ stationId: 'row', stationName: 'Row', seconds: 225, athleteKey: 'bruno', name: 'Bruno Sampaio', waveTitle: '' })])] }, null, 0);
  assert.deepEqual(withBests.bests, [
    { key: 'ski-erg-rafael', station: 'Ski Erg', time: '3:38', who: 'Rafael Tavares · Onda 3' },
    { key: 'row-bruno', station: 'Row', time: '3:45', who: 'Bruno Sampaio' }
  ], 'estação, melhor tempo e "nome · onda"; sem onda conhecida, só o nome');
  assert.equal(withBests.bestsEmpty, '');
  assert.equal(withBests.bestsNote, 'Só estação com judge tem tempo. Somando as ondas do dia.');
  const none = screens.raceClassFrame({ steps, divisions: [division('open-m', 'Open Masculino', finishers(2), [])] }, null, 0);
  assert.deepEqual([none.bests.length, none.bestsEmpty], [0, 'Nenhuma estação com tempo ainda']);
});

test('AC2: rodapé "Próxima largada" com onda, horário previsto, categorias e atletas; sem próxima onda, nada', () => {
  const steps = [{ kind: 'class', divisionKey: 'open-m', page: 0, pageCount: 1 }];
  const cls = { steps, divisions: [division('open-m', 'Open Masculino', finishers(2))] };
  assert.deepEqual(screens.raceClassFrame(cls, brief(), 0).next, { label: 'Próxima largada', wave: 'Onda 4 · 10:40', detail: 'Open Masculino e Open Feminino · 12 atletas' });
  assert.equal(screens.raceClassFrame(cls, brief({ athleteCount: 1, divisionNames: ['Pro Masculino'], time: '' }), 0).next.detail, 'Pro Masculino · 1 atleta');
  assert.equal(screens.raceClassFrame(cls, brief({ time: '' }), 0).next.wave, 'Onda 4', 'sem horário no cronograma, sem horário inventado');
  assert.equal(screens.raceClassFrame(cls, null, 0).next, null, 'sem próxima onda o rodapé não aparece');
});

test('AC2: o payload real da classificação: Open Masculino com a Onda 3 recém-terminada, o grid da Onda 4 no fim da alternância', async () => {
  database = createFakeSupabase(seedRaceDatabase({ seconds: 5300 }).seed);
  const payload = await builder.buildRaceBroadcastState(client, database.rows('events')[0], database.rows('event_broadcasts')[0], { nowMs: nowAt(5300) });
  assert.equal(payload.screen, 'class');
  const stepTime = (index) => 12_000 * (payload.class.steps.length * 10 + index) + 500;
  const frame = screens.raceClassFrame(payload.class, payload.next, stepTime(0));
  assert.deepEqual([frame.title, frame.pageIndex, frame.pageCount, frame.rows.length], ['Classificação · Open Masculino', 0, 2, 10]);
  assert.equal(frame.rows[0].position, '1');
  assert.equal(frame.rows[0].gap, '', 'o 1º não leva diferença');
  assert.ok(frame.rows.every((row) => /^\d+:\d{2}(:\d{2})?$/.test(row.time) || row.time === 'DNF'));
  assert.equal(frame.next.wave, 'Onda 4 · 10:40');
  assert.ok(frame.rows.some((row) => row.fresh), 'o selo NOVO é de quem fechou a última onda');
  const grid = payload.class.steps.findIndex((step) => step.kind === 'grid');
  assert.ok(grid > 0, 'o grid da próxima onda alterna depois da classificação');
  assert.equal(screens.raceClassFrame(payload.class, payload.next, stepTime(grid)), null, 'o passo do grid não é da classificação');
});

// ---------------------------------------------------------------------------
// AC3: espera
// ---------------------------------------------------------------------------

test('AC3: a espera: marca do evento, data e as próximas ondas (até 4) com o horário previsto, categorias e atletas', () => {
  const upcoming = [
    brief({ key: 'w3', title: 'Onda 3', time: '10:12', divisionNames: ['Open Masculino'], athleteCount: 10 }),
    brief({ key: 'w4' }),
    brief({ key: 'w5', title: 'Onda 5', time: '11:05', divisionNames: ['Pro Masculino'], athleteCount: 8 }),
    brief({ key: 'w6', title: 'Onda 6', time: '11:30', divisionNames: ['Duplas Mistas'], athleteCount: 1 }),
    brief({ key: 'w7', title: 'Onda 7', time: '12:00' })
  ];
  const frame = screens.describeRaceStandby({ upcoming }, { name: 'Fitness Race · Etapa Fortaleza', date: '2026-11-14' });
  assert.equal(frame.name, 'Fitness Race · Etapa Fortaleza');
  assert.equal(frame.dateText, 'Sábado, 14 de novembro');
  assert.deepEqual(frame.waves, [
    { key: 'w3', time: '10:12', title: 'Onda 3', detail: 'Open Masculino · 10 atletas' },
    { key: 'w4', time: '10:40', title: 'Onda 4', detail: 'Open Masculino e Open Feminino · 12 atletas' },
    { key: 'w5', time: '11:05', title: 'Onda 5', detail: 'Pro Masculino · 8 atletas' },
    { key: 'w6', time: '11:30', title: 'Onda 6', detail: 'Duplas Mistas · 1 atleta' }
  ], 'até quatro, na ordem do cronograma');
  assert.equal(frame.emptyText, '');
  assert.deepEqual(frame.footer, { label: 'Próxima largada', text: 'Onda 3 · 10:12 · Open Masculino' });
  assert.equal(screens.describeRaceStandby({ upcoming: [brief({ time: '' })] }, { name: 'X', date: '' }).waves[0].time, '–', 'sem horário no cronograma, um traço');
  assert.equal(screens.RACE_STANDBY_MAX, 4);
});

test('AC3: sem próxima onda: só a marca e "Acompanhe o placar ao vivo neste telão.", sem rodapé de próxima largada', () => {
  const frame = screens.describeRaceStandby({ upcoming: [] }, { name: '', date: 'não é data' });
  assert.deepEqual([frame.name, frame.dateText, frame.waves, frame.emptyText, frame.footer], ['WODArena', '', [], 'Acompanhe o placar ao vivo neste telão.', null]);
});

test('AC3: a data do evento sai por extenso e não anda um dia (a data não tem hora)', () => {
  assert.equal(screens.describeRaceEventDate('2026-11-14'), 'Sábado, 14 de novembro');
  assert.equal(screens.describeRaceEventDate('2026-01-01'), 'Quinta-feira, 1 de janeiro');
  assert.equal(screens.describeRaceEventDate('2026-12-31T23:30:00-03:00'), 'Quinta-feira, 31 de dezembro');
  assert.equal(screens.describeRaceEventDate(''), '');
  assert.equal(screens.describeRaceEventDate('amanhã'), '');
});

test('AC3: o payload real da espera fixada na mesa: as próximas ondas do cronograma e a marca do evento', async () => {
  database = createFakeSupabase(seedRaceDatabase({ seconds: 0, mode: 'standby' }).seed);
  for (const table of ['race_heat_marks', 'race_runs', 'race_attempts', 'race_infractions', 'race_decisions', 'scores']) database.rows(table).length = 0;
  const payload = await builder.buildRaceBroadcastState(client, database.rows('events')[0], database.rows('event_broadcasts')[0], { nowMs: nowAt(-9000) });
  assert.equal(payload.screen, 'standby');
  const frame = screens.describeRaceStandby(payload.standby, payload.event);
  assert.equal(frame.name, 'Fitness Race Fortaleza');
  assert.equal(frame.dateText, 'Sábado, 14 de novembro');
  assert.deepEqual(frame.waves.map((wave) => [wave.title, wave.time]), [['Onda 1', '08:30'], ['Onda 2', '09:20'], ['Onda 3', '10:12'], ['Onda 4', '10:40']]);
  assert.equal(frame.footer.text, 'Onda 1 · 08:30 · Open Masculino');
});

// ---------------------------------------------------------------------------
// AC6: prévia da mesa
// ---------------------------------------------------------------------------

test('AC6: a prévia "No ar agora": o nome da tela, a onda e a categoria do passo e, ao vivo, a torre em lista', async () => {
  // Onda fixada na mesa: a torre da onda (a do automático antes do ranking único, Story 1.116).
  database = createFakeSupabase(seedRaceDatabase({ seconds: 1440, mode: 'pin_heat', pinnedHeat: 'w3' }).seed);
  const live = await builder.buildRaceBroadcastState(client, database.rows('events')[0], database.rows('event_broadcasts')[0], { nowMs: nowAt(1440) });
  const preview = screens.describeRacePanelPreview(live);
  assert.deepEqual([preview.screenLabel, preview.context, preview.rows.length, preview.hiddenCount], ['Ao vivo', 'Onda 3 · Open Masculino', 10, 0]);
  assert.deepEqual(preview.rows[0], { key: preview.rows[0].key, position: '1', name: 'Rafael Tavares', where: 'Na pista · após Sled Pull · 0:24' }, 'Rafael saiu do Sled Pull aos 1416 s; a prévia conta pela hora do servidor, 1440 s');
  assert.deepEqual(preview.rows[2].where, 'Sled Pull 2/4 · na estação');
  assert.ok(preview.rows.every((row) => !JSON.stringify(row).match(/@|rafael\.segredo|85988887777/i)), 'nada pessoal na prévia');

  // Automático (ranking único, Story 1.117): a torre da categoria, com as ondas já largadas.
  database = createFakeSupabase(seedRaceDatabase({ seconds: 1440 }).seed);
  const auto = screens.describeRacePanelPreview(await builder.buildRaceBroadcastState(client, database.rows('events')[0], database.rows('event_broadcasts')[0], { nowMs: nowAt(1440) }));
  assert.deepEqual([auto.screenLabel, auto.context, auto.rows.length, auto.hiddenCount], ['Ao vivo', 'Open Masculino · ranking da prova', 10, 5]);
  assert.equal(auto.rows.find((row) => row.name === 'Rafael Tavares').where, 'Na pista · após Sled Pull · 0:24');
});

test('AC6: a prévia de grid, classificação e espera; a torre longa mostra 10 e conta os que ficaram de fora', async () => {
  const grid = { screen: 'grid', serverTime: iso(0), grid: { wave: brief({ title: 'Onda 3', divisionNames: ['Open Masculino'] }), athletes: [], courses: [] }, live: null, class: null, standby: null, next: null };
  assert.deepEqual([screens.describeRacePanelPreview(grid).screenLabel, screens.describeRacePanelPreview(grid).context], ['Grid de largada', 'Onda 3 · Open Masculino']);
  const standby = { screen: 'standby', serverTime: iso(0), live: null, grid: null, class: null, standby: { upcoming: [] }, next: null };
  assert.deepEqual([screens.describeRacePanelPreview(standby).screenLabel, screens.describeRacePanelPreview(standby).context], ['Espera', '']);
  const cls = { screen: 'class', serverTime: iso(12_000 * 40 + 5), live: null, grid: null, standby: null, next: brief(), class: {
    steps: [{ kind: 'class', divisionKey: 'open-m', page: 0, pageCount: 1 }],
    divisions: [division('open-m', 'Open Masculino', finishers(2))], lastWave: null, grid: null
  } };
  assert.deepEqual([screens.describeRacePanelPreview(cls).screenLabel, screens.describeRacePanelPreview(cls).context], ['Classificação', 'Open Masculino']);
  const noTime = screens.describeRacePanelPreview({ ...standby, serverTime: 'inválida' });
  assert.equal(noTime.screenLabel, 'Espera', 'hora inválida não derruba a prévia');

  database = createFakeSupabase(seedRaceDatabase({ seconds: 1440, mode: 'pin_heat', pinnedHeat: 'w3' }).seed);
  const live = await builder.buildRaceBroadcastState(client, database.rows('events')[0], database.rows('event_broadcasts')[0], { nowMs: nowAt(1440) });
  const long = { ...live, live: { ...live.live, boards: live.live.boards.map((board) => ({ ...board, rows: [...board.rows, ...board.rows.map((row, index) => ({ ...row, athleteKey: `x${index}` })), ...board.rows.slice(0, 3).map((row, index) => ({ ...row, athleteKey: `y${index}` }))] })) } };
  const preview = screens.describeRacePanelPreview(long);
  assert.deepEqual([preview.rows.length, preview.hiddenCount], [10, 13]);
});

// ---------------------------------------------------------------------------
// AC5, AC7: rotas de controle (acesso, link, modos, mark_heat)
// ---------------------------------------------------------------------------

const OWNER = { id: 'owner-telao-race', name: 'Owner', email: 'owner.race@example.com', role: 'owner' };
const OTHER_MANAGER = { id: 'mgr-outra-race', name: 'Outra Gestora', email: 'outra.race@example.com', role: 'manager', service_valid_until: '2099-12-31' };
const JUDGE = { id: 'judge-race-1', name: 'Judge Race', email: 'judge.race@example.com', role: 'judge', parent_manager_id: MANAGER.id };
const ATHLETE_USER = { id: 'ath-user-race', name: 'Atleta', email: 'atleta.race@example.com', role: 'athlete' };
const EXPIRED_MANAGER = { id: 'mgr-vencida-race', name: 'Gestora Vencida', email: 'vencida.race@example.com', role: 'manager', service_valid_until: '2020-01-31' };

/** O banco do cenário de referência, sem link do telão, com os outros papéis e os outros tipos de evento. */
const loadBoard = ({ seconds = 4100, clear = false, ...options } = {}) => {
  const { seed } = seedRaceDatabase({ seconds, ...options });
  seed.users = [MANAGER, OTHER_MANAGER, OWNER, JUDGE, ATHLETE_USER, EXPIRED_MANAGER];
  seed.event_broadcasts = [];
  seed.events = [
    ...seed.events,
    { id: 'ev-race-vencido', name: 'Race da gestora vencida', organizer_id: EXPIRED_MANAGER.id, event_type: 'fitness_racing', status: 'upcoming', event_schedule: [], time_zone: 'America/Fortaleza' },
    { id: 'ev-qualifier', name: 'Qualifier', organizer_id: MANAGER.id, event_type: 'functional_fitness_qualifier', status: 'upcoming', event_schedule: [] },
    { id: 'ev-ff', name: 'Functional', organizer_id: MANAGER.id, event_type: 'functional_fitness', status: 'upcoming', event_schedule: [] }
  ];
  database = createFakeSupabase(seed);
  if (clear) for (const table of ['race_heat_marks', 'race_runs', 'race_attempts', 'race_infractions', 'race_decisions', 'scores']) database.rows(table).length = 0;
  state.missingRaceTables = false;
};

const cookie = (user) => `woda_session=${createSessionToken({ id: user.id, name: user.name, email: user.email, role: user.role })}`;
const json = async (response) => ({ status: response.status, body: response.status === 304 ? null : await response.json(), headers: response.headers });
const control = async (user, body, eventId = EVENT_ID) => json(await postControl(new Request('http://localhost/api/telao/control', {
  method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie(user) }, body: JSON.stringify({ eventId, ...body })
})));
const controlView = async (user, eventId = EVENT_ID) => json(await getControl(new Request(`http://localhost/api/telao/control${eventId === null ? '' : `?eventId=${eventId}`}`, { headers: { cookie: cookie(user) } })));
let ipCounter = 0;
const telao = async (token) => json(await getTelao(new Request(`http://localhost/api/telao/${token}`, { headers: { 'x-forwarded-for': `198.51.100.${(ipCounter += 1)}` } }), { params: Promise.resolve({ token }) }));
const quiet = (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});
};
const frozen = (t, seconds) => t.mock.method(Date, 'now', () => nowAt(seconds));

test('AC5: quem acessa a mesa do Fitness Race: o gestor dono e o owner; o resto recebe 403, nunca 500', async (t) => {
  quiet(t);
  frozen(t, 4100);
  loadBoard();
  assert.equal((await controlView(MANAGER)).status, 200);
  assert.equal((await controlView(OWNER)).status, 200);
  assert.equal((await controlView(OTHER_MANAGER)).status, 403, 'gestor de outro evento');
  assert.equal((await controlView(JUDGE)).status, 403);
  assert.equal((await controlView(ATHLETE_USER)).status, 403);
  const expired = await controlView(EXPIRED_MANAGER, 'ev-race-vencido');
  assert.equal(expired.status, 403, 'gestor com acesso vencido');
  assert.match(expired.body.error, /expirou/);
  assert.equal((await control(JUDGE, { action: 'generate_link' })).status, 403);
  assert.equal((await control(ATHLETE_USER, { action: 'generate_link' })).status, 403);
  assert.equal((await control(OTHER_MANAGER, { action: 'generate_link' })).status, 403);
  assert.equal((await control(EXPIRED_MANAGER, { action: 'generate_link' }, 'ev-race-vencido')).status, 403);
  assert.equal(database.rows('event_broadcasts').length, 0, 'nada foi gravado para quem não pode');
});

test('AC5: o Qualifier segue 400 com a mensagem do telão; evento inexistente 404; sem evento 400; Functional Fitness segue como hoje', async (t) => {
  quiet(t);
  frozen(t, 4100);
  loadBoard();
  const qualifier = await controlView(MANAGER, 'ev-qualifier');
  assert.equal(qualifier.status, 400);
  assert.equal(qualifier.body.error, BROADCAST_EVENT_TYPE_MESSAGE);
  assert.equal((await control(MANAGER, { action: 'generate_link' }, 'ev-qualifier')).status, 400);
  assert.equal((await controlView(MANAGER, 'ev-nao-existe')).status, 404);
  assert.equal((await controlView(MANAGER, null)).status, 400);
  assert.equal((await control(MANAGER, { action: 'set_mode', mode: 'standby' }, '')).status, 400);
  const functional = await controlView(MANAGER, 'ev-ff');
  assert.equal(functional.status, 200);
  assert.ok(Array.isArray(functional.body.marks), 'a mesa de Functional Fitness segue com a leitura dela (marcas de bateria)');
  assert.equal(functional.body.preview.eventType, undefined, 'e com a prévia dela, não a do Fitness Race');
});

test('AC5: o GET da mesa devolve o link (sem o token), o modo, as fixações, as ondas do cronograma, as categorias e a prévia do telão', async (t) => {
  quiet(t);
  frozen(t, 4100);
  loadBoard();
  const view_ = await controlView(MANAGER);
  assert.equal(view_.status, 200, view_.body.error);
  assert.deepEqual(view_.body.link, { active: false, createdAt: null });
  assert.deepEqual([view_.body.mode, view_.body.pinnedHeatId, view_.body.pinnedDivisionId], ['auto', null, null]);
  assert.deepEqual(view_.body.heats.map((heat) => heat.label), [
    'Onda 1 · 08:30 · Open Masculino', 'Onda 2 · 09:20 · Open Masculino', 'Onda 3 · 10:12 · Open Masculino', 'Onda 4 · 10:40 · Open Masculino e Open Feminino'
  ]);
  assert.deepEqual(view_.body.heats.map((heat) => heat.id), ['w1', 'w2', 'w3', 'w4']);
  assert.deepEqual(view_.body.divisions, [{ id: 'open-m', name: 'Open Masculino' }, { id: 'open-f', name: 'Open Feminino' }]);
  assert.equal(view_.body.preview.eventType, 'fitness_racing');
  assert.equal(view_.body.preview.screen, 'live');
  assert.equal(view_.headers.get('cache-control'), 'no-store');
  const everything = JSON.stringify(view_.body);
  for (const secret of Object.values(SECRETS)) assert.equal(everything.includes(secret), false, `vazou: ${secret}`);
  assert.doesNotMatch(everything, /token_hash|"token"/);
});

test('AC7: generate_link: o token só na resposta, só o hash no banco, e o telão abre com ele; o novo link desativa o anterior', async (t) => {
  quiet(t);
  frozen(t, 4100);
  loadBoard();
  const generated = await control(MANAGER, { action: 'generate_link' });
  assert.equal(generated.status, 200, generated.body.error);
  assert.match(generated.body.token, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(generated.headers.get('cache-control'), 'no-store');
  const stored = database.rows('event_broadcasts');
  assert.equal(stored.length, 1);
  assert.equal(stored[0].token_hash, createHash('sha256').update(generated.body.token).digest('hex'));
  assert.doesNotMatch(JSON.stringify(database.snapshot()), new RegExp(generated.body.token), 'o token não fica gravado');
  const view_ = await controlView(MANAGER);
  assert.equal(view_.body.link.active, true);
  assert.equal(typeof view_.body.link.createdAt, 'string');
  assert.doesNotMatch(JSON.stringify(view_.body), new RegExp(generated.body.token), 'o GET não devolve o token');
  const onAir = await telao(generated.body.token);
  assert.equal(onAir.status, 200, onAir.body?.error);
  assert.equal(onAir.body.eventType, 'fitness_racing');

  const second = await control(OWNER, { action: 'generate_link' });
  assert.notEqual(second.body.token, generated.body.token);
  assert.equal((await telao(generated.body.token)).status, 404, 'o link anterior parou de funcionar');
  assert.equal((await telao(second.body.token)).status, 200);
});

test('AC7: revoke_link: o telão para de abrir e a mesa mostra o link inativo', async (t) => {
  quiet(t);
  frozen(t, 4100);
  loadBoard();
  const { token } = (await control(MANAGER, { action: 'generate_link' })).body;
  const revoked = await control(MANAGER, { action: 'revoke_link' });
  assert.equal(revoked.status, 200, revoked.body.error);
  assert.equal(revoked.body.link.active, false);
  assert.equal(revoked.body.link.createdAt, null);
  assert.equal((await telao(token)).status, 404);
  assert.equal(database.rows('event_broadcasts')[0].token_hash, null, 'nem o hash fica');
});

test('AC7: set_mode nos quatro modos, refletidos na prévia e no telão; categoria de outro evento 404; modo inválido 400', async (t) => {
  quiet(t);
  frozen(t, 5300);
  loadBoard({ seconds: 5300 });
  const { token } = (await control(MANAGER, { action: 'generate_link' })).body;
  assert.equal((await telao(token)).body.screen, 'class', 'automático: sem onda na pista e com resultado, a classificação');

  const standby = await control(MANAGER, { action: 'set_mode', mode: 'standby' });
  assert.deepEqual([standby.status, standby.body.mode, standby.body.preview.screen], [200, 'standby', 'standby']);
  const onTv = await telao(token);
  assert.deepEqual([onTv.body.mode, onTv.body.screen], ['standby', 'standby'], 'o modo escolhido vai ao telão');

  const standings = await control(MANAGER, { action: 'set_mode', mode: 'pin_standings', divisionId: 'open-f' });
  assert.deepEqual([standings.body.mode, standings.body.pinnedDivisionId, standings.body.pinnedHeatId, standings.body.preview.screen], ['pin_standings', 'open-f', null, 'class']);
  const classTv = await telao(token);
  assert.deepEqual(classTv.body.class.divisions.map((item) => item.key), ['open-f'], 'só a categoria fixada');

  const pinned = await control(OWNER, { action: 'set_mode', mode: 'pin_heat', heatId: 'w4' });
  assert.deepEqual([pinned.body.mode, pinned.body.pinnedHeatId, pinned.body.pinnedDivisionId, pinned.body.preview.screen], ['pin_heat', 'w4', null, 'grid']);
  assert.equal((await telao(token)).body.grid.wave.key, 'w4');

  const auto = await control(MANAGER, { action: 'set_mode', mode: 'auto' });
  assert.deepEqual([auto.body.mode, auto.body.pinnedHeatId, auto.body.pinnedDivisionId, auto.body.preview.screen], ['auto', null, null, 'class']);

  assert.equal((await control(MANAGER, { action: 'set_mode', mode: 'pin_standings', divisionId: 'div-de-outro-evento' })).status, 404);
  assert.equal((await control(MANAGER, { action: 'set_mode', mode: 'pin_standings' })).status, 400);
  assert.equal((await control(MANAGER, { action: 'set_mode', mode: 'pin_heat' })).status, 400);
  assert.equal((await control(MANAGER, { action: 'set_mode', mode: 'qualquer' })).status, 400);
  assert.equal((await control(MANAGER, { action: 'apagar_tudo' })).status, 400);
  assert.equal(database.rows('event_broadcasts')[0].mode, 'auto', 'os pedidos recusados não mudaram o modo');
});

test('AC5, AC7: mark_heat em evento Fitness Race responde 400 e não grava em broadcast_heat_states (D45)', async (t) => {
  quiet(t);
  frozen(t, 4100);
  loadBoard();
  const raceMarksBefore = JSON.stringify(database.rows('race_heat_marks'));
  for (const mark of ['start', 'finish', 'reopen']) {
    const refused = await control(MANAGER, { action: 'mark_heat', heatId: 'w4', mark });
    assert.equal(refused.status, 400, `mark_heat ${mark}`);
    assert.match(refused.body.error, /seção Ondas da aba Súmula Fitness Race/);
  }
  assert.equal((await control(OWNER, { action: 'mark_heat', heatId: 'w3', mark: 'start' })).status, 400, 'nem o owner');
  assert.equal(database.rows('broadcast_heat_states').length, 0, 'nada gravado');
  assert.equal(JSON.stringify(database.rows('race_heat_marks')), raceMarksBefore, 'e a largada do Fitness Race (race_heat_marks) não foi tocada');
  assert.equal((await control(JUDGE, { action: 'mark_heat', heatId: 'w3', mark: 'start' })).status, 403, 'o judge nem chega lá');
});

test('AC5: banco sem a migration da súmula Race: a mesa responde 503 com a migration citada, nunca 500', async (t) => {
  quiet(t);
  frozen(t, 4100);
  loadBoard();
  state.missingRaceTables = true;
  const view_ = await controlView(MANAGER);
  assert.equal(view_.status, 503);
  assert.match(view_.body.error, new RegExp(RACE_SHEETS_MIGRATION));
  assert.equal((await control(MANAGER, { action: 'set_mode', mode: 'standby' })).status, 503, 'o modo grava, mas a resposta com a prévia depende das tabelas');
  state.missingRaceTables = false;
});

test('AC5: o evento Race sem nenhuma onda, categoria ou atleta: a mesa abre e a prévia é a espera', async (t) => {
  quiet(t);
  frozen(t, 4100);
  loadBoard();
  database.rows('events').find((row) => row.id === 'ev-race-vencido').organizer_id = MANAGER.id;
  const empty = await controlView(MANAGER, 'ev-race-vencido');
  assert.equal(empty.status, 200, empty.body.error);
  assert.deepEqual([empty.body.heats, empty.body.divisions, empty.body.preview.screen], [[], [], 'standby']);
  assert.deepEqual(empty.body.preview.standby.upcoming, []);
});

// ---------------------------------------------------------------------------
// AC4, AC6: aba, painel e rota (fonte)
// ---------------------------------------------------------------------------

test('AC4: a aba "Telão" do Fitness Race entra só em linhas novas no admin/page.tsx; as travas das abas atuais seguem intactas', () => {
  const page = read('../src/app/admin/page.tsx');
  const racePanel = "...(selectedEventToManage.eventType === 'fitness_racing' ? [{ id: 'race', label: 'Súmula Fitness Race' }] : []),";
  const newTab = "...(selectedEventToManage.eventType === 'fitness_racing' ? [{ id: 'broadcast', label: 'Telão' }] : []),";
  const lines = page.split('\n').map((line) => line.trim());
  assert.equal(lines.filter((line) => line === newTab).length, 2, 'a aba nova na lista do celular e nas abas do desktop');
  lines.forEach((line, index) => {
    if (line === newTab) assert.equal(lines[index - 1], racePanel, 'logo depois da aba "Súmula Fitness Race"');
  });
  assert.equal(lines.filter((line) => line === racePanel).length, 2, 'as linhas da aba race não mudaram');
  assert.equal(lines.filter((line) => line === "{activeEventTab === 'broadcast' && selectedEventToManage.eventType === 'fitness_racing' && <RaceBroadcastPanel event={selectedEventToManage} />}").length, 1);
  assert.ok(lines.includes("{activeEventTab === 'broadcast' && (selectedEventToManage.eventType || 'functional_fitness') === 'functional_fitness' && <BroadcastPanel event={selectedEventToManage} />}"), 'a aba de Functional Fitness não muda');
  assert.equal((page.match(/\? \[\{ id: 'sheets', label: 'Súmulas e Judges' \}, \{ id: 'broadcast', label: 'Telão' \}\]/g) || []).length, 2, 'a trava do court-ui');
  assert.equal((page.match(/\| 'sheets' \| 'broadcast' \| 'race'/g) || []).length, 3, 'a trava do race-judges: a união do estado já tem o tipo');
  assert.match(page, /import \{ RaceBroadcastPanel \} from '@\/components\/admin\/RaceBroadcastPanel';/);
});

test('AC6: o painel do Telão do Race: link, quatro modos, aviso da largada, prévia; sem botão de largada, de encerrar nem de reabrir', () => {
  const panel = code('../src/components/admin/RaceBroadcastPanel.tsx');
  assert.doesNotMatch(panel, /mark_heat|Encerrar bateria|Reabrir|Marcar largada|start_heat|\/api\/race-sheets/, 'D45: nada de largada, encerrar nem reabrir');
  assert.equal((panel.match(/<button\b/g) || []).length, 3, 'os únicos botões são os do link: copiar, gerar e revogar');
  assert.doesNotMatch(panel, />\s*Largada\s*</);
  const source = read('../src/components/admin/RaceBroadcastPanel.tsx');
  assert.match(source, /A largada é feita na seção Ondas da aba Súmula Fitness Race/);
  for (const title of ['Automático', 'Fixar uma onda', 'Fixar uma categoria', 'Espera']) assert.match(source, new RegExp(`title: '${title}'`));
  assert.match(source, /A espera só aparece sem próxima onda e sem resultado/, 'o Automático descreve a regra e não promete espera antes da primeira onda');
  assert.doesNotMatch(source, /espera antes da primeira onda|antes da primeira onda, a espera/i);
  assert.match(source, /aria-label="Onda fixada"/);
  assert.match(source, /aria-label="Categoria fixada"/);
  assert.match(source, /REFRESH_MS = 5_000/);
  assert.match(source, /Copie agora: por segurança, o link completo não fica salvo/);
  assert.match(source, /min-h-10/, 'alvos de toque do padrão da mesa de Functional Fitness');
  assert.match(source, /describeRacePanelPreview\(state\.preview\)/);
  assert.match(source, /fetch\('\/api\/telao\/control'/);
  assert.doesNotMatch(source, /\.(email|phone|birth\w*|instagram|athlete_?id|run_?id|judge\w*|infraction\w*|reason)\b/i, 'nenhum dado pessoal lido na prévia');
});

test('AC5: a rota decide pelo tipo: acesso do Race, erro do Race com o status dele, mark_heat recusado antes de gravar', () => {
  const route = code('../src/app/api/telao/control/route.ts');
  assert.match(route, /assertRaceManagerAccess\(supabaseAdmin, actor, body\.eventId\)/);
  assert.match(route, /assertRaceManagerAccess\(supabaseAdmin, auth\.user, eventId\)/);
  assert.match(route, /error instanceof RaceSheetAccessError/, 'RaceSheetAccessError sai com o status dele, nunca 500');
  assert.match(route, /if \(race && action === 'mark_heat'\) throw new BroadcastError\(RACE_MARK_HEAT_MESSAGE, 400\);/);
  assert.ok(route.indexOf("race && action === 'mark_heat'") < route.indexOf('await markBroadcastHeat('), 'a recusa vem antes de qualquer gravação');
  assert.match(route, /readRaceBroadcastControl\(supabaseAdmin, event\.id\)/);
  assert.match(route, /assertSheetManagerAccess\(supabaseAdmin, actor, body\.eventId, ACCESS\)/, 'Functional Fitness segue como hoje');
  assert.match(route, /const ROLES = \['manager', 'owner'\] as const;/);
});

// ---------------------------------------------------------------------------
// AC1: fonte das telas de classificação e espera
// ---------------------------------------------------------------------------

test('AC1: a classificação e a espera: em cqw, sem dado pessoal, sem previsão e cobrindo os estados vazios', () => {
  const screen = code('../src/components/broadcast/RaceBroadcastScreen.tsx');
  assert.match(screen, /function RaceClassBody\(\{ frame \}: \{ frame: RaceClassFrame \}\)/);
  assert.match(screen, /function RaceStandbyBody\(\{ frame, logoUrl \}/);
  assert.match(screen, /classFrame \? <RaceClassBody frame=\{classFrame\} \/>|\} else if \(classFrame\) \{\s*body = <RaceClassBody frame=\{classFrame\} \/>/);
  assert.match(screen, /payload\.screen === 'class' && payload\.class \? raceClassFrame\(payload\.class, payload\.next, now\) : null/);
  assert.match(screen, /payload\.screen === 'standby' && payload\.standby \? describeRaceStandby\(payload\.standby, payload\.event\) : null/);
  assert.match(screen, /NOVO/);
  assert.match(screen, /frame\.emptyText/, 'categoria fixada sem resultado');
  assert.match(screen, /frame\.bestsEmpty/);
  assert.match(screen, /RACE_CLASS_FOOTER/);
  for (const path of ['../src/components/broadcast/RaceBroadcastScreen.tsx', '../src/lib/raceBroadcastScreens.ts']) {
    const source = code(path);
    assert.doesNotMatch(source, /\.(email|phone|birth\w*|instagram|city|team_?members|athlete_?id|run_?id|attempt_?id|user_?id|registration_?id|judge\w*|infraction\w*|reason|note|createdBy|author)\b/i, `${path}: nenhum campo de pessoa, id interno ou motivo`);
    assert.doesNotMatch(source, /predict|forecast|projected|pace\b|ritmo|ultrapassagem|runSeconds|roxzone|Date\.now\(\)/i, `${path}: sem previsão e sem relógio próprio`);
    assert.doesNotMatch(source, /\bfetch\s*\(/, `${path}: sem requisição`);
  }
  const imports = [...code('../src/lib/raceBroadcastScreens.ts').matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]).sort();
  assert.deepEqual(imports, ['@/lib/raceBroadcast', '@/lib/raceBroadcastMoments', '@/lib/raceBroadcastPayload', '@/lib/raceBroadcastView'], 'módulo puro: nenhum import de servidor, react ou rede');
  const css = read('../src/components/broadcast/RaceBroadcast.module.css');
  const fontSizes = [...css.matchAll(/font-size:\s*([^;}]+)[;}]/g)].map((match) => match[1].trim());
  assert.ok(fontSizes.every((value) => /^[\d.]+cqw$/.test(value)), 'todo texto em cqw');
  for (const selector of ['.classScr', '.cTable', '.cBest', '.cNext', '.tagNew', '.waitScr', '.wItem']) assert.ok(css.includes(selector), `CSS de ${selector}`);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(read('../src/lib/raceBroadcastScreens.ts'), /docs\/design\/telao-fitness-race\//);
});
