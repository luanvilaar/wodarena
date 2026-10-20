import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createFakeSupabase } from './support/fakeSupabase.mjs';
import { importServerModule, setActiveSupabaseClient } from './support/serverModuleHarness.mjs';

// Telão ao vivo (Stories 1.53 a 1.58): progresso ao vivo da súmula, ordem
// parcial da bateria, detecção do que vai ao ar pelas súmulas (sem depender do
// horário do cronograma), geral da categoria com a regra do site, link secreto
// guardado como hash e a mesa de controle do gestor, pelas rotas reais com o
// banco em memória.

process.env.SUPABASE_URL = 'http://supabase.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';
process.env.WODA_SESSION_SECRET = 'segredo-de-teste-telao';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

let database = createFakeSupabase();
let failLiveProgress = false;
const failing = (error) => {
  const chain = { eq: () => chain, in: () => chain, then: (resolve) => resolve({ data: null, error }) };
  return chain;
};
setActiveSupabaseClient({
  from: (table) => {
    const query = database.client.from(table);
    if (failLiveProgress && table === 'scoresheets') {
      const update = query.update.bind(query);
      query.update = (patch) => ('live_progress' in patch
        ? failing({ code: '42703', message: 'column "live_progress" of relation "scoresheets" does not exist' })
        : update(patch));
    }
    return query;
  },
  rpc: (name, args) => database.client.rpc(name, args)
});

const { GET: getTelao } = await importServerModule('app/api/telao/[token]/route.ts');
const { GET: getControl, POST: postControl } = await importServerModule('app/api/telao/control/route.ts');
const { POST: postSheets } = await importServerModule('app/api/sheets/route.ts');
const { createSessionToken } = await importServerModule('lib/serverSecurity.ts');
const { validateWorkoutStructure } = await importServerModule('lib/workoutStructure.ts');
const { summarizeLiveProgress, estimateClockStart, readLiveProgress } = await importServerModule('lib/liveProgress.ts');
const { rankLiveEntries } = await importServerModule('lib/liveHeatRanking.ts');
const { resolveBroadcast, INTERVAL_MIN_MS, LIVE_STALE_MS } = await importServerModule('lib/broadcastMode.ts');
const { computeDivisionStandings } = await importServerModule('lib/leaderboardStandings.ts');

const segment = (id, round, name, reps) => ({ id, round, name, reps, unit: 'reps', load: name === 'Thruster' ? { value: 43, unit: 'kg' } : null, note: '', required: true, mark: 'reps' });
const FRAN = validateWorkoutStructure({
  version: 2, format: 'for_time', totalReps: 90, timeCapSeconds: 600,
  incomplete: { rule: 'penalty_per_rep', secondsPerRep: 1, base: 'time_cap' },
  tieBreak: { kind: 'split_time', at: 's2', order: 'asc' }, generator: { kind: 'descending', reps: [21, 15, 9] }, customized: false,
  entry: { mode: 'both', marking: 'reps', publish: 'after_review' },
  segments: [segment('s1', 1, 'Thruster', 21), segment('s2', 1, 'Pull-up', 21), segment('s3', 2, 'Thruster', 15), segment('s4', 2, 'Pull-up', 15), segment('s5', 3, 'Thruster', 9), segment('s6', 3, 'Pull-up', 9)],
  maxLoad: null, scoreDisplay: null
}).structure;

// ---------------------------------------------------------------------------
// Puro: progresso, ordem parcial e modo
// ---------------------------------------------------------------------------

test('progresso ao vivo resume o log com o motor da súmula e estima o início do relógio', () => {
  const events = [{ t: 'fill', seg: 's1', n: 21, at: 120 }, { t: 'rep', seg: 's2', at: 130 }, { t: 'rep', seg: 's2', at: 133 }];
  const progress = summarizeLiveProgress(FRAN, events, '2026-11-01T13:00:00.000Z');
  assert.deepEqual(
    [progress.seq, progress.repsDone, progress.currentSegmentId, progress.completedAt, progress.lastMarkAt, progress.segments],
    [3, 23, 's2', null, 133, [21, 2, 0, 0, 0, 0]]
  );
  assert.deepEqual(readLiveProgress(JSON.parse(JSON.stringify(progress))), progress, 'o JSON gravado volta igual');
  assert.equal(readLiveProgress({ seq: 'x' }), null);
  assert.equal(readLiveProgress(null), null);

  // Menor "gravado em − instante": o registro que chegou mais rápido é o mais próximo do "Iniciar".
  const recorded = Date.parse('2026-11-01T13:02:05.000Z');
  assert.equal(estimateClockStart(null, recorded, [{ at: 120 }]), '2026-11-01T13:00:05.000Z');
  assert.equal(estimateClockStart('2026-11-01T13:00:05.000Z', recorded + 9000, [{ at: 125 }]), '2026-11-01T13:00:05.000Z');
  assert.equal(estimateClockStart('2026-11-01T13:00:05.000Z', recorded, [{ at: 124 }]), '2026-11-01T13:00:01.000Z');
});

test('ordem parcial: For Time por chegada, depois repetições e quem chegou antes; sem registro fica no fim pela raia', () => {
  const p = (repsDone, extra = {}) => ({ seq: 1, repsDone, roundsCompleted: 0, segments: [], currentSegmentId: null, completedAt: null, lastMarkAt: 100, scoreKg: null, attemptsUsed: null, currentLiftId: null, clockStartAt: null, ...extra });
  const ranked = rankLiveEntries('for_time', [
    { id: 'a', lane: 1, progress: p(60, { lastMarkAt: 200 }) },
    { id: 'b', lane: 2, progress: p(90, { completedAt: 410 }) },
    { id: 'c', lane: 3, progress: null },
    { id: 'd', lane: 4, progress: p(60, { lastMarkAt: 190 }) },
    { id: 'e', lane: 5, progress: p(90, { completedAt: 380 }) },
    { id: 'f', lane: 6, progress: p(60, { lastMarkAt: 190 }) }
  ]);
  assert.deepEqual(ranked.map((entry) => [entry.id, entry.position]), [['e', 1], ['b', 2], ['d', 3], ['f', 3], ['a', 5], ['c', null]]);

  const amrap = rankLiveEntries('amrap', [{ id: 'x', lane: 1, progress: p(120, { lastMarkAt: 500 }) }, { id: 'y', lane: 2, progress: p(130, { lastMarkAt: 590 }) }]);
  assert.deepEqual(amrap.map((entry) => entry.id), ['y', 'x']);

  const load = rankLiveEntries('max_load', [
    { id: 'l1', lane: 1, progress: p(0, { scoreKg: 150, attemptsUsed: 3 }) },
    { id: 'l2', lane: 2, progress: p(0, { scoreKg: 150, attemptsUsed: 2 }) },
    { id: 'l3', lane: 3, progress: p(0, { scoreKg: 160, attemptsUsed: 3 }) }
  ]);
  assert.deepEqual(load.map((entry) => entry.id), ['l3', 'l2', 'l1']);
});

test('modo automático: detecta pelas súmulas, segura o geral 90 s, chama pela abertura das súmulas e não depende do horário', () => {
  const now = Date.parse('2026-11-01T15:00:00.000Z');
  const iso = (msAgo) => new Date(now - msAgo).toISOString();
  const heats = [{ id: 'h1', order: 0, isCallReleased: false }, { id: 'h2', order: 1, isCallReleased: false }, { id: 'h3', order: 2, isCallReleased: true }];
  const sheet = (heatId, status, seq, msAgo, extra = {}) => ({ heatId, workoutId: 'w', divisionId: 'd1', status, seq, updatedAt: iso(msAgo), submittedAt: status === 'submitted' ? iso(msAgo) : null, ...extra });
  const base = { mode: 'auto', pinnedHeatId: null, pinnedDivisionId: null, heats, marks: [], nowMs: now };

  assert.deepEqual(resolveBroadcast({ ...base, sheets: [] }), { screen: 'call', groupKey: 'h3', reason: 'call_released' });
  assert.deepEqual(resolveBroadcast({ ...base, heats: heats.slice(0, 2), sheets: [] }), { screen: 'standby', reason: 'auto' });

  // Judges abriram as súmulas da bateria 1 (sem toque): chamada.
  assert.deepEqual(resolveBroadcast({ ...base, sheets: [sheet('h1', 'in_progress', 0, 5_000)] }), { screen: 'call', groupKey: 'h1', reason: 'sheets_opened' });
  // Primeiro registro: ao vivo.
  const live = [sheet('h1', 'in_progress', 4, 2_000), sheet('h1', 'in_progress', 0, 60_000)];
  assert.equal(resolveBroadcast({ ...base, sheets: live }).screen, 'live');

  // Todas enviadas há pouco: geral, mesmo com as súmulas da bateria 2 já abertas.
  const done = [sheet('h1', 'submitted', 30, 20_000), sheet('h1', 'submitted', 30, 10_000), sheet('h2', 'in_progress', 0, 5_000)];
  assert.deepEqual(resolveBroadcast({ ...base, sheets: done }), { screen: 'interval', groupKey: 'h1', divisionIds: ['d1'], reason: 'auto' });
  // Passados os 90 s, a chamada da bateria 2 entra.
  const later = done.map((item) => ({ ...item, updatedAt: iso(INTERVAL_MIN_MS + 1_000), submittedAt: item.submittedAt ? iso(INTERVAL_MIN_MS + 1_000) : null }));
  assert.equal(resolveBroadcast({ ...base, sheets: later }).screen, 'call');
  // Sem chamada nenhuma, o geral da última bateria continua no ar.
  assert.equal(resolveBroadcast({ ...base, heats: heats.slice(0, 1), sheets: later.slice(0, 2) }).screen, 'interval');

  // Súmula esquecida em andamento (sem registro novo há 20 min) não segura a bateria no ar.
  const stale = [sheet('h1', 'in_progress', 12, LIVE_STALE_MS + 1_000), sheet('h1', 'submitted', 30, LIVE_STALE_MS + 1_000)];
  assert.equal(resolveBroadcast({ ...base, heats: heats.slice(0, 2), sheets: stale }).screen, 'interval');
  // "Encerrar bateria" na mesa força o intervalo com súmula pendente.
  assert.equal(resolveBroadcast({ ...base, sheets: live, marks: [{ heatId: 'h1', startedAt: null, finishedAt: iso(1_000) }] }).screen, 'interval');

  // Fixados pelo gestor.
  assert.deepEqual(resolveBroadcast({ ...base, mode: 'standby', sheets: live }), { screen: 'standby', reason: 'pinned' });
  assert.deepEqual(resolveBroadcast({ ...base, mode: 'pin_standings', pinnedDivisionId: 'd9', sheets: live }), { screen: 'interval', groupKey: null, divisionIds: ['d9'], reason: 'pinned' });
  assert.deepEqual(resolveBroadcast({ ...base, mode: 'pin_heat', pinnedHeatId: 'h1', sheets: done }), { screen: 'live', groupKey: 'h1', reason: 'pinned' });
  assert.deepEqual(resolveBroadcast({ ...base, mode: 'pin_heat', pinnedHeatId: 'h2', sheets: done }), { screen: 'call', groupKey: 'h2', reason: 'pinned' });

  // Súmula sem bateria (atleta avulso) forma o grupo pela prova e categoria.
  assert.deepEqual(resolveBroadcast({ ...base, sheets: [sheet(null, 'in_progress', 3, 1_000)] }), { screen: 'live', groupKey: 'loose:w:d1', reason: 'auto' });
});

test('geral da categoria: a função pura soma pontos por colocação e desempata pelo confronto direto', () => {
  const athlete = (id) => ({ id, name: id.toUpperCase(), box: 'Box', country: 'BR', divisionId: 'd1' });
  const workouts = [
    { id: 'w1', name: 'WOD 1', code: 'W1', orderIndex: 1, type: 'fortime', description: '' },
    { id: 'w2', name: 'WOD 2', code: 'W2', orderIndex: 2, type: 'amrap', description: '' }
  ];
  const score = (athleteId, workoutId, rank) => ({ athleteId, workoutId, result: 'x', value: rank, rank, points: rank });
  const standings = computeDivisionStandings({
    event: { date: '2026-11-01', eventType: 'functional_fitness', workouts },
    divisionId: 'd1',
    divisionAthletes: ['a', 'b', 'c'].map(athlete),
    scores: [score('a', 'w1', 1), score('b', 'w1', 2), score('c', 'w1', 3), score('a', 'w2', 3), score('b', 'w2', 2), score('c', 'w2', 1)],
    nowMs: Date.parse('2026-10-20T12:00:00Z')
  });
  // a e c com 4 pontos: empatados no confronto direto (1 a 1), decide a colocação no WOD 1.
  assert.deepEqual(standings.map((item) => [item.athlete.id, item.totalPoints, item.rank]), [['a', 4, 1], ['b', 4, 2], ['c', 4, 3]]);
});

// ---------------------------------------------------------------------------
// Rotas: link, telão e mesa
// ---------------------------------------------------------------------------

const MANAGER = { id: 'mgr-telao', name: 'Gestora Telão', email: 'telao@example.com', role: 'manager', service_valid_until: '2099-12-31' };
const OTHER_MANAGER = { id: 'mgr-outra', name: 'Outra', email: 'outra@example.com', role: 'manager', service_valid_until: '2099-12-31' };
const OWNER = { id: 'owner-telao', name: 'Owner', email: 'owner@example.com', role: 'owner' };
const JUDGE = { id: 'judge-telao', name: 'Judge Telão', email: 'judge@example.com', role: 'judge', parent_manager_id: MANAGER.id };
const ATHLETE_USER = { id: 'ath-user', name: 'Atleta', email: 'atleta@example.com', role: 'athlete' };
const EVENT = 'ev-telao';

const seed = () => {
  failLiveProgress = false;
  database = createFakeSupabase({
    users: [MANAGER, OTHER_MANAGER, OWNER, JUDGE, ATHLETE_USER],
    events: [
      { id: EVENT, name: 'Desafio Litoral', date: '2026-11-01', location: 'Fortaleza', organizer_id: MANAGER.id, event_type: 'functional_fitness', status: 'upcoming', logo_url: null,
        event_schedule: [
          { id: 'heat-1', kind: 'heat', workoutId: 'wod-fran', heatNumber: 1, date: '2026-11-01', time: '10:40', title: 'BATERIA 1', athleteIds: ['ath-caio', '', 'ath-ana'] },
          { id: 'heat-2', kind: 'heat', workoutId: 'wod-fran', heatNumber: 2, date: '2026-11-01', time: '11:00', title: 'BATERIA 2', athleteIds: ['ath-bruno'] }
        ] },
      { id: 'ev-race', name: 'Race', organizer_id: MANAGER.id, event_type: 'fitness_racing', status: 'upcoming', event_schedule: [] }
    ],
    event_judges: [{ event_id: EVENT, judge_user_id: JUDGE.id }],
    divisions: [{ id: 'div-rx', event_id: EVENT, name: 'RX Masculino', order_index: 1 }],
    athletes: [
      { id: 'ath-caio', name: 'Caio Reis 85999998888', box: 'Tropa Fit', division_id: 'div-rx', is_team: false },
      { id: 'ath-ana', name: 'Ana Souza', box: 'CrossFit Litoral', division_id: 'div-rx', is_team: false },
      { id: 'ath-bruno', name: 'Bruno Lima', box: 'Box Norte', division_id: 'div-rx', is_team: false }
    ],
    leaderboard_entries: ['ath-caio', 'ath-ana', 'ath-bruno'].map((athleteId) => ({ id: `le-${athleteId}`, event_id: EVENT, division_id: 'div-rx', athlete_id: athleteId })),
    workouts: [
      { id: 'wod-fran', event_id: EVENT, name: 'Fran', code: 'W1', order_index: 1, type: 'fortime', time_cap: '10:00', tie_breaker: 'Tempo', division_id: null, structure: FRAN }
    ],
    scores: [{ athlete_id: 'ath-bruno', workout_id: 'wod-fran', result: '05:00', value: 300, rank: 1, points: 1, splits: {} }],
    registrations: []
  });
};

const cookie = (user) => `woda_session=${createSessionToken({ id: user.id, name: user.name, email: user.email, role: user.role })}`;
const json = async (response) => ({ status: response.status, body: response.status === 304 ? null : await response.json(), headers: response.headers });
const control = async (user, body) => json(await postControl(new Request('http://localhost/api/telao/control', {
  method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie(user) }, body: JSON.stringify({ eventId: EVENT, ...body })
})));
const controlView = async (user, eventId = EVENT) => json(await getControl(new Request(`http://localhost/api/telao/control?eventId=${eventId}`, { headers: { cookie: cookie(user) } })));
const telao = async (token, headers = {}) => json(await getTelao(new Request(`http://localhost/api/telao/${token}`, { headers }), { params: Promise.resolve({ token }) }));
const sheets = async (body) => json(await postSheets(new Request('http://localhost/api/sheets', {
  method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie(JUDGE) }, body: JSON.stringify(body)
})));
const quiet = (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});
};

let counter = 0;
const e = (event) => ({ id: `t${(counter += 1)}`, event });
const open = async (athleteId, lane) => (await sheets({ action: 'open', eventId: EVENT, workoutId: 'wod-fran', athleteId, heatId: 'heat-1', lane })).body.sheet.id;
const append = async (sheetId, events) => {
  const fromSeq = database.rows('scoresheet_events').filter((row) => row.sheet_id === sheetId).length;
  const response = await sheets({ action: 'append', sheetId, fromSeq, events });
  assert.equal(response.status, 200, response.body?.error);
};
const fullFran = (finish) => [
  e({ t: 'fill', seg: 's1', n: 21, at: 60 }), e({ t: 'fill', seg: 's2', n: 21, at: 120 }), e({ t: 'fill', seg: 's3', n: 15, at: 170 }),
  e({ t: 'fill', seg: 's4', n: 15, at: 210 }), e({ t: 'fill', seg: 's5', n: 9, at: 240 }), e({ t: 'fill', seg: 's6', n: 9, at: finish })
];
const submit = async (sheetId) => {
  const expectedCount = database.rows('scoresheet_events').filter((row) => row.sheet_id === sheetId).length;
  const response = await sheets({ action: 'submit', sheetId, expectedCount });
  assert.equal(response.status, 200, response.body?.error);
};

test('mesa do telão: só o gestor dono (ou owner); o link é mostrado uma vez e só o hash fica no banco', async (t) => {
  quiet(t);
  seed();
  assert.equal((await controlView(ATHLETE_USER)).status, 403);
  assert.equal((await controlView(JUDGE)).status, 403);
  assert.equal((await controlView(OTHER_MANAGER)).status, 403);
  assert.equal((await controlView(MANAGER, 'ev-race')).status, 400, 'Fitness Race fica fora');
  assert.equal((await controlView(OWNER)).status, 200);

  const view = await controlView(MANAGER);
  assert.equal(view.status, 200, view.body.error);
  assert.deepEqual(view.body.link, { active: false, createdAt: null });
  assert.equal(view.body.mode, 'auto');
  assert.deepEqual(view.body.heats.map((heat) => heat.label), ['Bateria 1 · W1 · 10:40', 'Bateria 2 · W1 · 11:00']);
  assert.equal(view.body.preview.screen, 'standby');

  const generated = await control(MANAGER, { action: 'generate_link' });
  assert.equal(generated.status, 200, generated.body.error);
  assert.match(generated.body.token, /^[A-Za-z0-9_-]{32}$/);
  const stored = database.rows('event_broadcasts');
  assert.equal(stored.length, 1);
  assert.equal(stored[0].token_hash, createHash('sha256').update(generated.body.token).digest('hex'));
  assert.doesNotMatch(JSON.stringify(database.snapshot()), new RegExp(generated.body.token), 'o token não fica gravado');
  assert.equal((await controlView(MANAGER)).body.link.active, true);
  assert.equal((await control(OTHER_MANAGER, { action: 'generate_link' })).status, 403);
  assert.equal((await control(MANAGER, { action: 'apagar_tudo' })).status, 400);
});

test('telão: link inválido ou revogado dá 404; o estado segue as súmulas da chamada ao intervalo, sem dados pessoais', async (t) => {
  quiet(t);
  seed();
  assert.equal((await telao('curto')).status, 404);
  assert.equal((await telao('x'.repeat(32))).status, 404);
  const { token } = (await control(MANAGER, { action: 'generate_link' })).body;

  const idle = await telao(token);
  assert.equal(idle.status, 200, idle.body.error);
  assert.equal(idle.body.screen, 'standby');
  assert.deepEqual(idle.body.standby.upcoming.map((item) => item.title), ['Bateria 1', 'Bateria 2']);
  assert.equal(idle.headers.get('Referrer-Policy'), 'no-referrer');
  assert.match(idle.headers.get('X-Robots-Tag'), /noindex/);
  assert.equal((await telao(token, { 'if-none-match': idle.headers.get('ETag') })).status, 304, 'sem mudança, 304');

  // Judges nas raias: súmulas abertas, nenhum toque → chamada.
  const caio = await open('ath-caio', 1);
  const ana = await open('ath-ana', 3);
  const call = await telao(token);
  assert.equal(call.body.screen, 'call');
  assert.equal(call.body.call.heat.title, 'Bateria 1');
  assert.equal(call.body.call.heat.workout.scheme, '21-15-9');
  assert.deepEqual(call.body.call.heat.workout.lines, ['Thruster 43 kg', 'Pull-up']);
  assert.deepEqual(call.body.call.lanes.map((lane) => [lane.lane, lane.name, lane.sheetOpened]), [[1, 'Caio Reis', true], [3, 'Ana Souza', true]]);

  // Primeiro registro: ao vivo, com o progresso calculado no servidor.
  await append(caio, [e({ t: 'fill', seg: 's1', n: 21, at: 70 })]);
  const sheetRow = database.rows('scoresheets').find((row) => row.id === caio);
  assert.equal(sheetRow.live_progress.repsDone, 21);
  assert.ok(sheetRow.live_progress.clockStartAt, 'início do relógio estimado');
  let live = await telao(token);
  assert.equal(live.body.screen, 'live');
  assert.ok(live.body.live.startedAt);
  assert.deepEqual(live.body.live.entries.map((entry) => [entry.name, entry.position, entry.repsDone, entry.status]), [['Caio Reis', 1, 21, 'in_progress'], ['Ana Souza', null, 0, 'waiting']]);

  await append(ana, [e({ t: 'fill', seg: 's1', n: 21, at: 55 }), e({ t: 'rep', seg: 's2', at: 60 })]);
  live = await telao(token);
  assert.deepEqual(live.body.live.entries.map((entry) => [entry.name, entry.position, entry.repsDone, entry.currentSegmentId]), [['Ana Souza', 1, 22, 's2'], ['Caio Reis', 2, 21, 's2']]);

  const text = JSON.stringify(live.body);
  assert.doesNotMatch(text, /@example\.com/);
  assert.doesNotMatch(text, /85999998888/, 'telefone no nome sai pela sanitização');
  assert.doesNotMatch(text, /ath-caio|ath-ana|judge-telao/, 'sem ids de atleta ou de usuário');

  // Envio das duas súmulas: o geral da categoria entra na hora, com a prova recém-publicada.
  await append(caio, fullFran(290).slice(1));
  await append(ana, fullFran(260).slice(1));
  await submit(caio);
  await submit(ana);
  const interval = await telao(token);
  assert.equal(interval.body.screen, 'interval');
  const [board] = interval.body.interval.boards;
  assert.equal(board.divisionName, 'RX Masculino');
  assert.deepEqual(board.columns, [{ label: 'W1', fresh: true }]);
  // Variação contra o que o leaderboard do site mostrava antes desta bateria: lá, quem ainda não
  // tinha resultado somava 0 ponto e aparecia empatado em 1º (a prova pendente não penaliza).
  assert.deepEqual(board.rows.map((row) => [row.name, row.position, row.points, row.fresh, row.delta]), [
    ['Ana Souza', 1, 1, true, 0],
    ['Caio Reis', 2, 2, true, -1],
    ['Bruno Lima', 3, 3, false, 0]
  ]);
  assert.equal(interval.body.next.title, 'Bateria 2');

  // Revogado: o telão aberto passa a receber 404.
  await control(MANAGER, { action: 'revoke_link' });
  assert.equal((await telao(token)).status, 404);
});

test('mesa: fixar bateria, geral e espera; encerrar força o intervalo e reabrir volta ao vivo', async (t) => {
  quiet(t);
  seed();
  const { token } = (await control(MANAGER, { action: 'generate_link' })).body;
  const caio = await open('ath-caio', 1);
  await append(caio, [e({ t: 'fill', seg: 's1', n: 21, at: 70 })]);
  assert.equal((await telao(token)).body.screen, 'live');

  const finished = await control(MANAGER, { action: 'mark_heat', heatId: 'heat-1', mark: 'finish' });
  assert.equal(finished.status, 200, finished.body.error);
  assert.equal((await telao(token)).body.screen, 'interval');
  await control(MANAGER, { action: 'mark_heat', heatId: 'heat-1', mark: 'reopen' });
  assert.equal((await telao(token)).body.screen, 'live');

  const started = await control(MANAGER, { action: 'mark_heat', heatId: 'heat-1', mark: 'start' });
  const mark = started.body.marks.find((item) => item.heatId === 'heat-1');
  assert.equal((await telao(token)).body.live.startedAt, mark.startedAt, 'a largada da mesa vence a estimativa');

  assert.equal((await control(MANAGER, { action: 'set_mode', mode: 'standby' })).body.preview.screen, 'standby');
  assert.equal((await control(MANAGER, { action: 'set_mode', mode: 'pin_standings', divisionId: 'div-rx' })).body.preview.screen, 'interval');
  assert.equal((await control(MANAGER, { action: 'set_mode', mode: 'pin_standings', divisionId: 'div-outra' })).status, 404);
  assert.equal((await control(MANAGER, { action: 'set_mode', mode: 'pin_heat', heatId: 'heat-2' })).body.preview.screen, 'call');
  assert.equal((await control(MANAGER, { action: 'set_mode', mode: 'qualquer' })).status, 400);
  assert.equal((await control(MANAGER, { action: 'mark_heat', heatId: 'heat-1', mark: 'apagar' })).status, 400);
  assert.equal((await control(MANAGER, { action: 'set_mode', mode: 'auto' })).body.preview.screen, 'live');
});

test('súmula segue gravando se a coluna live_progress ainda não existe (migration do telão pendente)', async (t) => {
  quiet(t);
  seed();
  const caio = await open('ath-caio', 1);
  failLiveProgress = true;
  await append(caio, [e({ t: 'rep', seg: 's1', at: 3 })]);
  assert.equal(database.rows('scoresheet_events').length, 1);
  assert.equal(database.rows('scoresheets')[0].live_progress, undefined);
});

// ---------------------------------------------------------------------------
// Estático: migration, cabeçalhos e página
// ---------------------------------------------------------------------------

test('migration do telão: RLS ligada, sem acesso anônimo, idempotente e sem mexer em dado existente', () => {
  const migration = read('../supabase/migrations/20261020120000_live_broadcast.sql');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.event_broadcasts/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.broadcast_heat_states/);
  assert.match(migration, /ALTER TABLE public\.scoresheets ADD COLUMN IF NOT EXISTS live_progress JSONB;/);
  assert.match(migration, /ALTER TABLE public\.event_broadcasts ENABLE ROW LEVEL SECURITY;/);
  assert.match(migration, /ALTER TABLE public\.broadcast_heat_states ENABLE ROW LEVEL SECURITY;/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.event_broadcasts, public\.broadcast_heat_states FROM PUBLIC, anon, authenticated;/);
  assert.doesNotMatch(migration, /CREATE POLICY|GRANT .* TO (anon|authenticated)|UPDATE public\.|DELETE FROM/);
  assert.match(migration, /token_hash TEXT/);
  assert.doesNotMatch(migration, /\btoken TEXT/, 'o token em claro nunca vai para o banco');
});

test('página do telão: fora dos buscadores, sem referer e com o desenho aprovado', () => {
  const config = read('../next.config.ts');
  assert.match(config, /source: "\/:locale\/telao\/:token",\s*headers: telaoHeaders/);
  assert.match(config, /\{ key: "Referrer-Policy", value: "no-referrer" \}/);
  const page = read('../src/app/[locale]/telao/[token]/page.tsx');
  assert.match(page, /robots: \{ index: false, follow: false \}/);
  assert.match(page, /referrer: 'no-referrer'/);
  const screen = read('../src/components/broadcast/BroadcastScreen.tsx');
  assert.match(screen, /docs\/design\/telao-ao-vivo\//);
  assert.match(screen, /fetch\(`\/api\/telao\/\$\{encodeURIComponent\(token\)\}`/);
  const admin = read('../src/app/admin/page.tsx');
  assert.match(admin, /\{activeEventTab === 'broadcast' && \(selectedEventToManage\.eventType \|\| 'functional_fitness'\) === 'functional_fitness' && <BroadcastPanel event=\{selectedEventToManage\} \/>\}/);
});
