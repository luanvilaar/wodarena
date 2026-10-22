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
// Erro devolvido na gravação de scoresheets.live_progress (null = grava normal).
let failLiveProgress = null;
// Erro só na gravação do resumo completo (com repsDone); o contador { seq } grava.
let failFullLiveProgress = null;
// Tabelas do telão ainda não criadas (migration pendente).
let missingBroadcastTables = false;
const MISSING_COLUMN = { code: '42703', message: 'column "live_progress" of relation "scoresheets" does not exist' };
const failing = (error) => {
  const chain = new Proxy({}, { get: (_target, prop) => (prop === 'then' ? (resolve) => resolve({ data: null, error }) : () => chain) });
  return chain;
};
setActiveSupabaseClient({
  from: (table) => {
    if (missingBroadcastTables && (table === 'event_broadcasts' || table === 'broadcast_heat_states')) {
      return failing({ code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` });
    }
    const query = database.client.from(table);
    if (failLiveProgress && table === 'scoresheets') {
      const update = query.update.bind(query);
      query.update = (patch) => ('live_progress' in patch ? failing(failLiveProgress) : update(patch));
    }
    if (failFullLiveProgress && table === 'scoresheets') {
      const update = query.update.bind(query);
      query.update = (patch) => (patch.live_progress && 'repsDone' in patch.live_progress ? failing(failFullLiveProgress) : update(patch));
    }
    return query;
  },
  rpc: (name, args) => database.client.rpc(name, args)
});

const { GET: getTelao } = await importServerModule('app/api/telao/[token]/route.ts');
const { GET: getControl, POST: postControl } = await importServerModule('app/api/telao/control/route.ts');
const { GET: getSheets, POST: postSheets } = await importServerModule('app/api/sheets/route.ts');
const { createSessionToken } = await importServerModule('lib/serverSecurity.ts');
const { validateWorkoutStructure } = await importServerModule('lib/workoutStructure.ts');
const { summarizeLiveProgress, estimateClockStart, readLiveProgress } = await importServerModule('lib/liveProgress.ts');
const { rankLiveEntries } = await importServerModule('lib/liveHeatRanking.ts');
const { resolveBroadcast, INTERVAL_MIN_MS, LIVE_STALE_MS } = await importServerModule('lib/broadcastMode.ts');
const { computeDivisionStandings } = await importServerModule('lib/leaderboardStandings.ts');
const { readAllPages, readBroadcastSheets } = await importServerModule('lib/serverBroadcast.ts');

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

test('raia sem toque não prende a bateria na chamada: com registro ou envio no grupo, o fim vem pelo último envio', () => {
  const now = Date.parse('2026-11-01T15:00:00.000Z');
  const iso = (msAgo) => new Date(now - msAgo).toISOString();
  const heats = [{ id: 'h1', order: 0, isCallReleased: false }, { id: 'h2', order: 1, isCallReleased: false }];
  const sheet = (heatId, status, seq, msAgo) => ({ heatId, workoutId: 'w', divisionId: 'd1', status, seq, updatedAt: iso(msAgo), submittedAt: status === 'submitted' ? iso(msAgo) : null });
  const base = { mode: 'auto', pinnedHeatId: null, pinnedDivisionId: null, heats, marks: [], nowMs: now };

  // Antes de qualquer toque (todas com seq 0, nenhuma enviada): continua sendo chamada.
  assert.deepEqual(resolveBroadcast({ ...base, sheets: [sheet('h1', 'in_progress', 0, 8_000), sheet('h1', 'in_progress', 0, 5_000)] }), { screen: 'call', groupKey: 'h1', reason: 'sheets_opened' });

  // 2 enviadas + 1 aberta sem toque (raia de atleta ausente): fim automático pelo último envio, intervalo.
  const ended = [sheet('h1', 'submitted', 30, 40_000), sheet('h1', 'submitted', 30, 20_000), sheet('h1', 'in_progress', 0, 5_000)];
  assert.deepEqual(resolveBroadcast({ ...base, sheets: ended }), { screen: 'interval', groupKey: 'h1', divisionIds: ['d1'], reason: 'auto' });
  // Passados os 90 s, sem chamada nova, o geral continua no ar: não volta para a chamada da bateria que acabou.
  const later = ended.map((item) => ({ ...item, updatedAt: iso(INTERVAL_MIN_MS + 5_000), submittedAt: item.submittedAt ? iso(INTERVAL_MIN_MS + 5_000) : null }));
  assert.deepEqual(resolveBroadcast({ ...base, sheets: later }), { screen: 'interval', groupKey: 'h1', divisionIds: ['d1'], reason: 'auto' });
  // E a chamada da próxima entra normalmente quando as súmulas dela abrem.
  assert.deepEqual(resolveBroadcast({ ...base, sheets: [...later, sheet('h2', 'in_progress', 0, 2_000)] }), { screen: 'call', groupKey: 'h2', reason: 'sheets_opened' });

  // Registro antigo (judge que parou de marcar) + raia sem toque: também não vira chamada.
  assert.deepEqual(resolveBroadcast({ ...base, sheets: [sheet('h1', 'in_progress', 7, LIVE_STALE_MS + 1_000), sheet('h1', 'in_progress', 0, 5_000)] }), { screen: 'standby', reason: 'auto' });
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

const EXPIRED_MANAGER = { id: 'mgr-vencida', name: 'Gestora Vencida', email: 'vencida@example.com', role: 'manager', service_valid_until: '2020-01-31' };

const seed = () => {
  failLiveProgress = null;
  failFullLiveProgress = null;
  missingBroadcastTables = false;
  database = createFakeSupabase({
    users: [MANAGER, OTHER_MANAGER, OWNER, JUDGE, ATHLETE_USER, EXPIRED_MANAGER],
    events: [
      { id: EVENT, name: 'Desafio Litoral', date: '2026-11-01', location: 'Fortaleza', organizer_id: MANAGER.id, event_type: 'functional_fitness', status: 'upcoming', logo_url: null,
        event_schedule: [
          { id: 'heat-1', kind: 'heat', workoutId: 'wod-fran', heatNumber: 1, date: '2026-11-01', time: '10:40', title: 'BATERIA 1', athleteIds: ['ath-caio', '', 'ath-ana'] },
          { id: 'heat-2', kind: 'heat', workoutId: 'wod-fran', heatNumber: 2, date: '2026-11-01', time: '11:00', title: 'BATERIA 2', athleteIds: ['ath-bruno'] }
        ] },
      { id: 'ev-race', name: 'Race', organizer_id: MANAGER.id, event_type: 'fitness_racing', status: 'upcoming', event_schedule: [] },
      { id: 'ev-qualifier', name: 'Qualifier', organizer_id: MANAGER.id, event_type: 'functional_fitness_qualifier', status: 'upcoming', event_schedule: [] },
      { id: 'ev-vencido', name: 'Vencido', organizer_id: EXPIRED_MANAGER.id, event_type: 'functional_fitness', status: 'upcoming', event_schedule: [] }
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
  failLiveProgress = MISSING_COLUMN;
  await append(caio, [e({ t: 'rep', seg: 's1', at: 3 })]);
  assert.equal(database.rows('scoresheet_events').length, 1);
  assert.equal(database.rows('scoresheets')[0].live_progress, undefined);
});

test('raia sem toque pelas rotas: uma enviada e a outra aberta sem registro vai para o intervalo, não para a chamada', async (t) => {
  quiet(t);
  seed();
  const { token } = (await control(MANAGER, { action: 'generate_link' })).body;
  const caio = await open('ath-caio', 1);
  await open('ath-ana', 3);
  assert.equal((await telao(token)).body.screen, 'call');
  await append(caio, fullFran(290));
  await submit(caio);
  const after = await telao(token);
  assert.equal(after.body.screen, 'interval');
  assert.deepEqual(after.body.interval.boards.map((board) => board.divisionName), ['RX Masculino']);
});

test('geral de prova compartilhada entre categorias: a variação compara só com a própria categoria', async (t) => {
  quiet(t);
  seed();
  const EV = 'ev-dividida';
  database.rows('events').push({ id: EV, name: 'Open Misto', date: '2026-11-01', organizer_id: MANAGER.id, event_type: 'functional_fitness', status: 'upcoming', logo_url: null,
    event_schedule: [{ id: 'heat-d1', kind: 'heat', workoutId: 'wod-dividida', heatNumber: 1, date: '2026-11-01', time: '09:00', title: 'BATERIA 1', athleteIds: ['ath-a'] }] });
  database.rows('event_judges').push({ event_id: EV, judge_user_id: JUDGE.id });
  database.rows('divisions').push({ id: 'div-rx2', event_id: EV, name: 'RX', order_index: 1 }, { id: 'div-sc2', event_id: EV, name: 'Scaled', order_index: 2 });
  const people = [['ath-a', 'Atleta A', 'div-rx2'], ['ath-b', 'Atleta B', 'div-rx2'], ['ath-c', 'Atleta C', 'div-rx2'], ['ath-x', 'Atleta X', 'div-sc2'], ['ath-y', 'Atleta Y', 'div-sc2']];
  database.rows('athletes').push(...people.map(([id, name, divisionId]) => ({ id, name, box: 'Box', division_id: divisionId, is_team: false })));
  database.rows('leaderboard_entries').push(...people.map(([id, , divisionId]) => ({ id: `le-${id}`, event_id: EV, division_id: divisionId, athlete_id: id })));
  database.rows('workouts').push(
    { id: 'wod-rx', event_id: EV, name: 'Clean', code: 'W1', order_index: 1, type: 'fortime', time_cap: '10:00', tie_breaker: 'Tempo', division_id: 'div-rx2', structure: null },
    // Prova compartilhada: division_id null, scores de RX e Scaled pela mesma prova.
    { id: 'wod-dividida', event_id: EV, name: 'Fran', code: 'W2', order_index: 2, type: 'fortime', time_cap: '10:00', tie_breaker: 'Tempo', division_id: null, structure: FRAN }
  );
  const score = (athleteId, workoutId, result, value, rank) => ({ athlete_id: athleteId, workout_id: workoutId, result, value, rank, points: rank, splits: {} });
  database.rows('scores').push(
    score('ath-b', 'wod-rx', '01:40', 100, 1), score('ath-a', 'wod-rx', '03:20', 200, 2), score('ath-c', 'wod-rx', '05:00', 300, 3),
    score('ath-c', 'wod-dividida', '04:10', 250, 1), score('ath-b', 'wod-dividida', '05:00', 300, 2),
    score('ath-x', 'wod-dividida', '04:20', 260, 1), score('ath-y', 'wod-dividida', '04:30', 270, 2)
  );
  const { token } = (await control(MANAGER, { action: 'generate_link', eventId: EV })).body;
  const opened = await sheets({ action: 'open', eventId: EV, workoutId: 'wod-dividida', athleteId: 'ath-a', heatId: 'heat-d1', lane: 1 });
  assert.equal(opened.status, 200, opened.body.error);
  const sheetId = opened.body.sheet.id;
  await append(sheetId, fullFran(245));
  await submit(sheetId);

  const interval = await telao(token);
  assert.equal(interval.body.screen, 'interval', interval.body.error);
  assert.deepEqual(interval.body.interval.boards.map((board) => board.divisionName), ['RX'], 'só a categoria da bateria');
  // Antes da bateria, no RX: A 2 pts (W2 pendente), B 1+2 = 3, C 3+1 = 4. Depois: A 3, B 4, C 5.
  // A ordem não mudou, então a variação é 0 para todos (os scores do Scaled não entram no "antes").
  assert.deepEqual(interval.body.interval.boards[0].rows.map((row) => [row.name, row.position, row.points, row.delta]), [
    ['Atleta A', 1, 3, 0],
    ['Atleta B', 2, 4, 0],
    ['Atleta C', 3, 5, 0]
  ]);
});

test('mesa e telão: gestor expirado 403, Qualifier 400 com a mensagem do telão e 503 sem a migration', async (t) => {
  quiet(t);
  seed();
  assert.equal((await controlView(EXPIRED_MANAGER, 'ev-vencido')).status, 403);
  const expired = await control(EXPIRED_MANAGER, { action: 'generate_link', eventId: 'ev-vencido' });
  assert.equal(expired.status, 403);
  assert.match(expired.body.error, /expirou/);
  assert.equal(database.rows('event_broadcasts').length, 0);

  const qualifier = await controlView(MANAGER, 'ev-qualifier');
  assert.equal(qualifier.status, 400);
  assert.match(qualifier.body.error, /telão ao vivo é exclusivo/);
  assert.doesNotMatch(qualifier.body.error, /súmula/i);
  assert.equal((await control(MANAGER, { action: 'generate_link', eventId: 'ev-qualifier' })).status, 400);

  missingBroadcastTables = true;
  const view = await controlView(MANAGER);
  assert.equal(view.status, 503);
  assert.match(view.body.error, /migration do telão/);
  assert.equal((await control(MANAGER, { action: 'generate_link' })).status, 503);
  const screen = await telao('a'.repeat(32), { 'x-forwarded-for': '198.51.100.20' });
  assert.equal(screen.status, 503);
  assert.match(screen.body.error, /migration do telão/);
  assert.equal(screen.headers.get('Cache-Control'), 'no-store');
});

test('telão: toda resposta sai com no-store, noindex e no-referrer; 240/min por link e IP; 120 links inválidos por IP', async (t) => {
  quiet(t);
  seed();
  const { token } = (await control(MANAGER, { action: 'generate_link' })).body;
  const privacy = (response) => [response.headers.get('Cache-Control'), response.headers.get('X-Robots-Tag'), response.headers.get('Referrer-Policy')];
  const expected = ['no-store', 'noindex, nofollow', 'no-referrer'];
  const ip = { 'x-forwarded-for': '198.51.100.7' };

  const first = await telao(token, ip);
  assert.equal(first.status, 200);
  assert.deepEqual(privacy(first), expected);
  const unchanged = await telao(token, { ...ip, 'if-none-match': first.headers.get('ETag') });
  assert.equal(unchanged.status, 304);
  assert.deepEqual(privacy(unchanged), expected);
  const invalid = await telao('curto', { 'x-forwarded-for': '198.51.100.8' });
  assert.equal(invalid.status, 404);
  assert.deepEqual(privacy(invalid), expected);

  for (let index = 2; index < 240; index += 1) assert.equal((await telao(token, ip)).status, 200);
  const limited = await telao(token, ip);
  assert.equal(limited.status, 429, 'a 241ª consulta no minuto é barrada');
  assert.deepEqual(privacy(limited), expected);
  assert.equal((await telao(token, { 'x-forwarded-for': '198.51.100.9' })).status, 200, 'outra TV (outro IP) segue');

  // Varredura de tokens: 120 links inválidos do mesmo IP dão 404; dali em diante 429, sem ir ao banco.
  const scan = { 'x-forwarded-for': '203.0.113.50' };
  for (let index = 0; index < 120; index += 1) {
    assert.equal((await telao(`${'b'.repeat(28)}${String(index).padStart(4, '0')}`, scan)).status, 404);
  }
  const operations = database.operations.length;
  const blocked = await telao('c'.repeat(32), scan);
  assert.equal(blocked.status, 429);
  assert.deepEqual(privacy(blocked), expected);
  assert.equal(database.operations.length, operations, 'IP barrado não consulta o banco');
});

test('telão: a TV com link válido não é barrada pela varredura de tokens no mesmo IP; a varredura segue sem ir ao banco', async (t) => {
  quiet(t);
  seed();
  const { token } = (await control(MANAGER, { action: 'generate_link' })).body;
  const wifi = { 'x-forwarded-for': '203.0.113.77' };
  assert.equal((await telao(token, wifi)).status, 200, 'a TV abre o telão');

  // Alguém no mesmo Wi-Fi varre tokens: 120 links inválidos e o IP fica acima do limite de 404.
  for (let index = 0; index < 120; index += 1) {
    assert.equal((await telao(`${'d'.repeat(28)}${String(index).padStart(4, '0')}`, wifi)).status, 404);
  }
  const operations = database.operations.length;
  assert.equal((await telao('e'.repeat(32), wifi)).status, 429, 'a varredura continua barrada');
  assert.equal(database.operations.length, operations, 'sem consulta ao banco para o token inventado');

  const tv = await telao(token, wifi);
  assert.equal(tv.status, 200, 'a TV com link válido segue no ar');
  assert.equal(tv.body.screen, 'standby');

  // Revogado: o link deixa de pular o bloqueio. A primeira consulta ainda confere no banco
  // (e conta como 404 do IP, já acima do limite); a seguinte é barrada sem ir ao banco.
  await control(MANAGER, { action: 'revoke_link' });
  const beforeRevoked = database.operations.length;
  assert.equal((await telao(token, wifi)).status, 429);
  assert.ok(database.operations.length > beforeRevoked, 'o link revogado foi conferido no banco');
  const afterRevoked = database.operations.length;
  assert.equal((await telao(token, wifi)).status, 429);
  assert.equal(database.operations.length, afterRevoked, 'e depois sai da lista de links válidos');
});

test('mesa: no máximo 60 ações por minuto por pessoa', async (t) => {
  quiet(t);
  seed();
  for (let index = 0; index < 60; index += 1) assert.equal((await control(OWNER, { action: 'mark_heat', heatId: '' })).status, 400);
  const limited = await control(OWNER, { action: 'mark_heat', heatId: 'heat-1', mark: 'start' });
  assert.equal(limited.status, 429);
  assert.equal(database.rows('broadcast_heat_states').length, 0, 'a ação barrada não grava');
});

test('súmulas do telão: lidas em páginas pela ordem do id, só com o seq do progresso e com o mesmo resultado', async () => {
  const rows = Array.from({ length: 2500 }, (_, index) => ({ id: index }));
  const pageOf = (source, calls) => (from, to) => {
    calls.push([from, to]);
    return Promise.resolve({ data: source.slice(from, to + 1), error: null });
  };
  let calls = [];
  assert.equal((await readAllPages(pageOf(rows, calls))).length, 2500);
  assert.deepEqual(calls, [[0, 999], [1000, 1999], [2000, 2999]], 'segue até a página incompleta');
  calls = [];
  assert.equal((await readAllPages(pageOf(rows.slice(0, 2000), calls))).length, 2000);
  assert.equal(calls.length, 3, 'múltiplo exato: a página vazia encerra');
  await assert.rejects(readAllPages(() => Promise.resolve({ data: null, error: { code: 'PGRST205', message: 'tabela' } })), /migration do telão/);

  seed();
  const sheet = (id, eventId, seq) => ({ id, event_id: eventId, workout_id: 'wod-fran', athlete_id: 'ath-caio', division_id: 'div-rx', heat_id: 'heat-1', lane: 1, status: 'in_progress', official_result: null, submitted_at: null, updated_at: '2026-11-01T13:00:00.000Z', live_progress: seq === null ? null : { seq, repsDone: seq } });
  database.rows('scoresheets').push(sheet('s-4', EVENT, 4), sheet('s-1', EVENT, null), sheet('s-5', EVENT, 0), sheet('s-x', 'ev-race', 9), sheet('s-3', EVENT, 3), sheet('s-2', EVENT, 2));
  const selects = () => database.operations.filter((item) => item.table === 'scoresheets' && item.action === 'select').length;
  const start = selects();
  const paged = await readBroadcastSheets(database.client, EVENT, 2);
  assert.equal(selects() - start, 3, '5 súmulas em páginas de 2');
  assert.deepEqual(paged.map((row) => [row.id, row.seq]), [['s-1', null], ['s-2', 2], ['s-3', 3], ['s-4', 4], ['s-5', 0]]);
  assert.ok(paged.every((row) => !('live_progress' in row)), 'o JSON do progresso fica de fora');
  assert.deepEqual(await readBroadcastSheets(database.client, EVENT), paged, 'página única dá o mesmo resultado');

  const source = read('../src/lib/serverBroadcast.ts');
  assert.match(source, /\.order\('id', \{ ascending: true \}\)\s*\.range\(from, to\)/);
  assert.match(source, /seq:live_progress->seq'/);
  assert.doesNotMatch(source, /const SHEET_SELECT = '[^']*, live_progress'/);
});

test('falha ao gravar o progresso ao vivo não derruba o lote: os registros ficam e o updated_at avança', async (t) => {
  quiet(t);
  seed();
  const caio = await open('ath-caio', 1);
  const before = database.rows('scoresheets').find((row) => row.id === caio).updated_at;
  await new Promise((resolve) => setTimeout(resolve, 5));
  failLiveProgress = { code: '57014', message: 'canceling statement due to statement timeout' };
  await append(caio, [e({ t: 'rep', seg: 's1', at: 3 })]);
  const row = database.rows('scoresheets').find((item) => item.id === caio);
  assert.equal(database.rows('scoresheet_events').length, 1);
  assert.equal(row.live_progress, undefined);
  assert.notEqual(row.updated_at, before);
  assert.ok(console.error.mock.calls.some((call) => /progresso ao vivo/.test(String(call.arguments[0]))));
});

test('mesa: "Encerrar" numa bateria sem registro é recusado e não grava; a bateria entra ao vivo quando começa', async (t) => {
  quiet(t);
  seed();
  const { token } = (await control(MANAGER, { action: 'generate_link' })).body;
  // Cenário do QA (REQ-003): súmulas abertas, nenhum toque, telão na Chamada.
  const caio = await open('ath-caio', 1);
  const ana = await open('ath-ana', 3);
  assert.equal((await telao(token)).body.screen, 'call');

  const refused = await control(MANAGER, { action: 'mark_heat', heatId: 'heat-1', mark: 'finish' });
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /ainda não tem nenhum registro/);
  assert.match(refused.body.error, /cancele-as/);
  assert.equal(database.rows('broadcast_heat_states').length, 0, 'nada gravado');
  // Bateria que nem tem súmula também não se encerra.
  assert.equal((await control(MANAGER, { action: 'mark_heat', heatId: 'heat-2', mark: 'finish' })).status, 409);
  assert.equal(database.rows('broadcast_heat_states').length, 0);

  // A bateria corre: súmulas com 12 e 9 registros → ao vivo (antes ia para o intervalo).
  await append(caio, Array.from({ length: 12 }, (_, index) => e({ t: 'rep', seg: 's1', at: 10 + index })));
  await append(ana, Array.from({ length: 9 }, (_, index) => e({ t: 'rep', seg: 's1', at: 10 + index })));
  assert.deepEqual(database.rows('scoresheets').map((row) => row.live_progress.seq).sort((a, b) => a - b), [9, 12]);
  const live = await telao(token);
  assert.equal(live.body.screen, 'live');
  assert.equal(live.body.live.heat.key, 'heat-1');

  // Com registro, "Encerrar" vale.
  const finished = await control(MANAGER, { action: 'mark_heat', heatId: 'heat-1', mark: 'finish' });
  assert.equal(finished.status, 200, finished.body.error);
  assert.equal((await telao(token)).body.screen, 'interval');
});

test('mesa: a Largada limpa o encerramento da bateria, que volta a poder entrar ao vivo', async (t) => {
  quiet(t);
  seed();
  const { token } = (await control(MANAGER, { action: 'generate_link' })).body;
  // Marca de encerramento gravada antes da primeira largada (por exemplo, pela regra antiga, na Chamada).
  database.rows('broadcast_heat_states').push({ event_id: EVENT, heat_id: 'heat-1', started_at: null, started_by: null, finished_at: new Date(Date.now() - 60_000).toISOString(), finished_by: MANAGER.id });
  const caio = await open('ath-caio', 1);
  await append(caio, [e({ t: 'fill', seg: 's1', n: 21, at: 70 })]);
  assert.equal((await telao(token)).body.screen, 'interval', 'a marca segura o intervalo');

  const started = await control(MANAGER, { action: 'mark_heat', heatId: 'heat-1', mark: 'start' });
  assert.equal(started.status, 200, started.body.error);
  const mark = started.body.marks.find((item) => item.heatId === 'heat-1');
  assert.ok(mark.startedAt);
  assert.equal(mark.finishedAt, null, 'a marca de encerramento foi limpa');
  assert.equal(database.rows('broadcast_heat_states')[0].finished_by, null);
  const live = await telao(token);
  assert.equal(live.body.screen, 'live');
  assert.equal(live.body.live.startedAt, mark.startedAt);

  // Encerrar e marcar a largada de novo: a bateria volta ao ar.
  await control(MANAGER, { action: 'mark_heat', heatId: 'heat-1', mark: 'finish' });
  assert.equal((await telao(token)).body.screen, 'interval');
  await control(MANAGER, { action: 'mark_heat', heatId: 'heat-1', mark: 'start' });
  assert.equal((await telao(token)).body.screen, 'live');
});

test('resumo ao vivo que falha ao gravar: fica ao menos o contador, e a bateria em andamento vai ao vivo, não para a Chamada', async (t) => {
  quiet(t);
  seed();
  const { token } = (await control(MANAGER, { action: 'generate_link' })).body;
  const caio = await open('ath-caio', 1);
  await open('ath-ana', 3);
  assert.equal((await telao(token)).body.screen, 'call');

  failFullLiveProgress = { code: '57014', message: 'canceling statement due to statement timeout' };
  await append(caio, [e({ t: 'fill', seg: 's1', n: 21, at: 70 }), e({ t: 'rep', seg: 's2', at: 75 })]);
  assert.deepEqual(database.rows('scoresheets').find((row) => row.id === caio).live_progress, { seq: 2 }, 'só o contador foi gravado');
  assert.ok(console.error.mock.calls.some((call) => /progresso ao vivo/.test(String(call.arguments[0]))));

  const live = await telao(token);
  assert.equal(live.body.screen, 'live');
  // O telão calcula o progresso do log para a raia sem o resumo completo.
  assert.deepEqual(live.body.live.entries.map((entry) => [entry.name, entry.repsDone, entry.status]), [['Caio Reis', 22, 'in_progress'], ['Ana Souza', 0, 'waiting']]);

  // Mesa: com o contador, a bateria conta como começada e pode ser encerrada.
  assert.equal((await control(MANAGER, { action: 'mark_heat', heatId: 'heat-1', mark: 'finish' })).status, 200);
});

test('grupo sem bateria no cronograma: depois do primeiro envio, a próxima leva da mesma prova e categoria não ganha Chamada (troca aceita)', () => {
  const now = Date.parse('2026-11-01T15:00:00.000Z');
  const iso = (msAgo) => new Date(now - msAgo).toISOString();
  const sheet = (status, seq, msAgo) => ({ heatId: null, workoutId: 'w', divisionId: 'd1', status, seq, updatedAt: iso(msAgo), submittedAt: status === 'submitted' ? iso(msAgo) : null });
  const base = { mode: 'auto', pinnedHeatId: null, pinnedDivisionId: null, heats: [], marks: [], nowMs: now };

  // Primeira leva, antes de qualquer toque: Chamada.
  assert.deepEqual(resolveBroadcast({ ...base, sheets: [sheet('in_progress', 0, 5_000)] }), { screen: 'call', groupKey: 'loose:w:d1', reason: 'sheets_opened' });
  // 1 enviada + 1 aberta sem toque (a próxima leva): intervalo, não Chamada.
  const next = [sheet('submitted', 30, 20_000), sheet('in_progress', 0, 5_000)];
  assert.deepEqual(resolveBroadcast({ ...base, sheets: next }), { screen: 'interval', groupKey: 'loose:w:d1', divisionIds: ['d1'], reason: 'auto' });
  // Passados os 90 s, o geral continua no ar.
  const later = [sheet('submitted', 30, INTERVAL_MIN_MS + 20_000), sheet('in_progress', 0, 5_000)];
  assert.equal(resolveBroadcast({ ...base, sheets: later }).screen, 'interval');
  // No primeiro registro da nova leva, vai ao vivo.
  assert.deepEqual(resolveBroadcast({ ...base, sheets: [later[0], sheet('in_progress', 1, 1_000)] }), { screen: 'live', groupKey: 'loose:w:d1', reason: 'auto' });
});

test('súmulas do telão: linha repetida pela paginação (súmula aberta no meio da leitura) sai uma vez só', async () => {
  seed();
  const sheet = (id, seq) => ({ id, event_id: EVENT, workout_id: 'wod-fran', athlete_id: `ath-${id}`, division_id: 'div-rx', heat_id: 'heat-1', lane: 1, status: 'in_progress', official_result: null, submitted_at: null, updated_at: '2026-11-01T13:00:00.000Z', live_progress: { seq } });
  database.rows('scoresheets').push(sheet('s-1', 1), sheet('s-2', 2), sheet('s-3', 3), sheet('s-4', 4), sheet('s-5', 5));
  let pages = 0;
  const client = {
    from: (table) => {
      const query = database.client.from(table);
      const range = query.range.bind(query);
      query.range = (from, to) => {
        pages += 1;
        // Entre a 1ª e a 2ª página, uma súmula nova com id menor que o da borda.
        if (pages === 2) database.rows('scoresheets').push(sheet('s-0', 0));
        return range(from, to);
      };
      return query;
    }
  };
  const rows = await readBroadcastSheets(client, EVENT, 2);
  assert.ok(pages >= 3);
  assert.deepEqual(rows.map((row) => row.id), ['s-1', 's-2', 's-3', 's-4', 's-5'], 's-2 veio nas páginas 1 e 2 e fica uma vez');
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length);
});

test('súmula digital: o Qualifier continua com a mensagem da súmula em /api/sheets (a do telão é só da mesa)', async (t) => {
  quiet(t);
  seed();
  const manage = await getSheets(new Request('http://localhost/api/sheets?view=manage&eventId=ev-qualifier', { headers: { cookie: cookie(MANAGER) } }));
  assert.equal(manage.status, 400);
  const manageBody = await manage.json();
  assert.equal(manageBody.error, 'A súmula digital é exclusiva de eventos Functional Fitness presenciais.');

  const opened = await sheets({ action: 'open', eventId: 'ev-qualifier', workoutId: 'wod-fran', athleteId: 'ath-caio', heatId: 'heat-1', lane: 1 });
  assert.equal(opened.status, 400);
  assert.equal(opened.body.error, 'A súmula digital é exclusiva de eventos Functional Fitness presenciais.');
  assert.doesNotMatch(opened.body.error, /telão/);
  assert.equal(database.rows('scoresheets').length, 0);
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
  assert.match(page, /try \{\s*return decodeURIComponent\(token\);\s*\} catch \{\s*return token;\s*\}/, '"%" malformado não derruba a página');
  const route = read('../src/app/api/telao/[token]/route.ts');
  assert.ok(route.indexOf('findBroadcastByToken(supabaseAdmin, token)') < route.indexOf('key: `telao:${hashBroadcastToken'), 'a chave por token só nasce para link válido');
  const screen = read('../src/components/broadcast/BroadcastScreen.tsx');
  assert.match(screen, /docs\/design\/telao-ao-vivo\//);
  assert.match(screen, /fetch\(`\/api\/telao\/\$\{encodeURIComponent\(token\)\}`/);
  const admin = read('../src/app/admin/page.tsx');
  assert.match(admin, /\{activeEventTab === 'broadcast' && \(selectedEventToManage\.eventType \|\| 'functional_fitness'\) === 'functional_fitness' && <BroadcastPanel event=\{selectedEventToManage\} \/>\}/);
});

// ---------------------------------------------------------------------------
// Story 1.60: progresso ao vivo do intervalado (para o telão da Story 1.63)
// ---------------------------------------------------------------------------

const { describeWorkoutForBoard } = await importServerModule('lib/serverBroadcast.ts');
const INTERVAL = validateWorkoutStructure({
  version: 3, format: 'interval', totalReps: 21, timeCapSeconds: 1080, incomplete: null, tieBreak: null, generator: null, customized: true,
  entry: { mode: 'both', marking: 'reps', publish: 'after_review' },
  segments: [segment('f1', 1, 'Ring Muscle Up', 6), segment('f2', 1, 'Box Jump Over', 15)],
  maxLoad: null, scoreDisplay: null,
  interval: { rounds: 5, onSeconds: 120, offSeconds: 120, max: { id: 'mx', name: 'Squat Clean', load: { value: 80, unit: 'kg' }, note: '' } }
}).structure;

test('progresso ao vivo do intervalado: parcial pelo motor, round do último registro que conta e lastMarkAt sem os de fora da janela', () => {
  const start = '2026-11-01T13:00:00.000Z';
  const empty = summarizeLiveProgress(INTERVAL, [], start);
  assert.deepEqual(
    [empty.seq, empty.repsDone, empty.roundsCompleted, empty.segments, empty.currentSegmentId, empty.round, empty.lastMarkAt],
    [0, 0, 0, [0, 0], 'f1', null, null]
  );

  const round1 = [
    { t: 'fill', seg: 'f1', n: 6, at: 15 }, { t: 'fill', seg: 'f2', n: 15, at: 45 },
    { t: 'rep', seg: 'mx', at: 60 }, { t: 'rep', seg: 'mx', at: 70 }, { t: 'rep', seg: 'mx', at: 119 }
  ];
  const afterRound1 = summarizeLiveProgress(INTERVAL, round1, start);
  assert.deepEqual(
    [afterRound1.repsDone, afterRound1.roundsCompleted, afterRound1.segments, afterRound1.currentSegmentId, afterRound1.round, afterRound1.lastMarkAt],
    [3, 1, [6, 15], 'mx', 1, 119]
  );

  // Um toque no descanso não conta: nem no parcial, nem no round, nem na chegada.
  const withRest = summarizeLiveProgress(INTERVAL, [...round1, { t: 'rep', seg: 'mx', at: 130 }], start);
  assert.deepEqual([withRest.seq, withRest.repsDone, withRest.round, withRest.lastMarkAt], [6, 3, 1, 119]);

  // O round muda no primeiro registro do round seguinte.
  const round2 = summarizeLiveProgress(INTERVAL, [...round1, { t: 'rep', seg: 'mx', at: 130 }, { t: 'rep', seg: 'f1', at: 250 }], start);
  assert.deepEqual(
    [round2.repsDone, round2.roundsCompleted, round2.segments, round2.currentSegmentId, round2.round, round2.lastMarkAt],
    [3, 1, [1, 0], 'f1', 2, 250]
  );
  assert.deepEqual(
    [round2.completedAt, round2.scoreKg, round2.attemptsUsed, round2.currentLiftId, round2.clockStartAt],
    [null, null, null, null, start]
  );
  assert.deepEqual(readLiveProgress(JSON.parse(JSON.stringify(round2))), round2, 'o JSON gravado volta igual, com o round');

  // Fora do intervalado o round fica vazio e o resto não muda.
  assert.equal(summarizeLiveProgress(FRAN, [{ t: 'rep', seg: 's1', at: 3 }], start).round, null);
});

test('readLiveProgress: resumo antigo sem round vale null; round só passa quando é inteiro positivo', () => {
  const old = { seq: 3, repsDone: 23, roundsCompleted: 0, segments: [21, 2, 0, 0, 0, 0], currentSegmentId: 's2', completedAt: null, lastMarkAt: 133, scoreKg: null, attemptsUsed: null, currentLiftId: null, clockStartAt: null };
  assert.equal(readLiveProgress(old).round, null);
  assert.deepEqual({ ...readLiveProgress(old), round: undefined }, { ...old, round: undefined }, 'o resto segue como era');
  assert.equal(readLiveProgress({ ...old, round: 3 }).round, 3);
  for (const round of [0, -1, 2.5, '2', null]) assert.equal(readLiveProgress({ ...old, round }).round, null, String(round));
});

test('ordem parcial do intervalado: mais repetições, depois quem chegou antes ao último registro que conta', () => {
  const p = (repsDone, lastMarkAt, extra = {}) => ({ seq: 1, repsDone, roundsCompleted: 0, segments: [], currentSegmentId: null, completedAt: null, lastMarkAt, scoreKg: null, attemptsUsed: null, currentLiftId: null, clockStartAt: null, round: 1, ...extra });
  const ranked = rankLiveEntries('interval', [
    { id: 'a', lane: 1, progress: p(23, 900) },
    { id: 'b', lane: 2, progress: p(40, 1000) },
    { id: 'c', lane: 3, progress: p(40, 990) },
    { id: 'd', lane: 4, progress: null },
    { id: 'e', lane: 5, progress: p(23, 900, { completedAt: 100 }) }
  ]);
  assert.deepEqual(ranked.map((entry) => [entry.id, entry.position]), [['c', 1], ['b', 2], ['a', 3], ['e', 3], ['d', null]], 'completedAt não conta fora do For Time');

  // Os resumos do motor entram direto.
  const fast = summarizeLiveProgress(INTERVAL, [{ t: 'fill', seg: 'f1', n: 6, at: 10 }, { t: 'fill', seg: 'f2', n: 15, at: 30 }, { t: 'rep', seg: 'mx', at: 40 }], null);
  const slow = summarizeLiveProgress(INTERVAL, [{ t: 'fill', seg: 'f1', n: 6, at: 10 }, { t: 'fill', seg: 'f2', n: 15, at: 30 }, { t: 'rep', seg: 'mx', at: 80 }], null);
  assert.deepEqual(rankLiveEntries('interval', [{ id: 's', lane: 1, progress: slow }, { id: 'f', lane: 2, progress: fast }]).map((entry) => entry.id), ['f', 's']);
});

test('telão: describeWorkoutForBoard aceita a prova intervalada sem lançar (os rótulos são da Story 1.63)', () => {
  const board = describeWorkoutForBoard({ name: 'Intervalado', code: 'W1' }, INTERVAL);
  assert.deepEqual([board.format, board.timeCapSeconds, board.segments.map((item) => item.id)], ['interval', 1080, ['f1', 'f2']]);
});

// ---------------------------------------------------------------------------
// Story 1.63: Intervalado no telão (rótulo, linha do máximo, round e fase)
// ---------------------------------------------------------------------------
// Atenção aos dois "intervalos": `intervalSpec` é o bloco do FORMATO Intervalado
// na prova; `body.interval` / screen 'interval' é a TELA de intervalo (o geral).

const { broadcastIntervalPhase, describeIntervalClock, intervalLaneProgress, intervalSchemeText, intervalMaxLine } = await importServerModule('lib/broadcastPayload.ts');
const { intervalPhaseAt } = await importServerModule('lib/workoutStructure.ts');

const plainSegment = (id, name, reps, load = null) => ({ id, round: 1, name, reps, unit: 'reps', load, note: '', required: true, mark: 'reps' });
const REFERENCE = validateWorkoutStructure({
  version: 3, format: 'interval', totalReps: 21, timeCapSeconds: 1080, incomplete: null, tieBreak: null, generator: null, customized: true,
  entry: { mode: 'both', marking: 'reps', publish: 'after_review' },
  segments: [plainSegment('f1', 'Ring Muscle Ups', 6), plainSegment('f2', 'Box Jump Overs', 15)],
  maxLoad: null, scoreDisplay: null,
  interval: { rounds: 5, onSeconds: 120, offSeconds: 120, max: { id: 'mx', name: 'Squat Clean', load: { value: 80, unit: 'kg' }, note: '' } }
});
assert.equal(REFERENCE.ok, true, REFERENCE.error);
const REF = REFERENCE.structure;
const REF_SPEC = { rounds: 5, onSeconds: 120, offSeconds: 120, max: { id: 'mx', name: 'Squat Clean', loadKg: 80 } };

test('telão 1.63: payload da prova intervalada com o bloco intervalSpec e a linha do máximo por último, inclusive depois do corte de 8 linhas', () => {
  const board = describeWorkoutForBoard({ name: 'Intervalado', code: 'W1' }, REF);
  assert.equal(board.format, 'interval');
  assert.equal(board.timeCapSeconds, 1080, 'a duração da prova');
  assert.equal(board.scheme, null, 'o título continua o nome da prova');
  assert.deepEqual(board.lines, ['6 Ring Muscle Ups', '15 Box Jump Overs', 'Máx. Squat Clean 80 kg']);
  assert.deepEqual(board.segments.map((item) => item.id), ['f1', 'f2'], 'o máximo não tem meta e não entra na barra');
  assert.deepEqual(board.intervalSpec, REF_SPEC);
  assert.equal(intervalSchemeText(board.intervalSpec), '5 rounds · 02:00 ON / 02:00 OFF');
  assert.doesNotMatch(JSON.stringify(board), /@|note/, 'só dados da prova');

  // Máximo sem carga.
  const noLoad = validateWorkoutStructure({ ...REF, interval: { ...REF.interval, max: { ...REF.interval.max, load: null } } }).structure;
  const noLoadBoard = describeWorkoutForBoard({ name: 'Intervalado', code: '' }, noLoad);
  assert.equal(noLoadBoard.lines.at(-1), 'Máx. Squat Clean');
  assert.equal(noLoadBoard.intervalSpec.max.loadKg, null);
  assert.equal(intervalMaxLine({ id: 'x', name: 'Burpee', loadKg: null }), 'Máx. Burpee');

  // 9 fixos + o máximo = 10 linhas: corta em 8 e o máximo continua por último.
  const nine = Array.from({ length: 9 }, (_, index) => plainSegment(`f${index + 1}`, `Mov ${index + 1}`, 5));
  const long = validateWorkoutStructure({ ...REF, totalReps: 45, timeCapSeconds: 1080, segments: nine });
  assert.equal(long.ok, true, long.error);
  const longBoard = describeWorkoutForBoard({ name: 'Longo', code: '' }, long.structure);
  assert.equal(longBoard.lines.length, 8);
  assert.deepEqual(longBoard.lines.slice(5), ['5 Mov 6', '+ 3 etapas', 'Máx. Squat Clean 80 kg']);
  assert.equal(longBoard.segments.length, 9);

  // Sem fixos: só a linha do máximo.
  const onlyMax = validateWorkoutStructure({ ...REF, totalReps: 0, segments: [] });
  assert.equal(onlyMax.ok, true, onlyMax.error);
  assert.deepEqual(describeWorkoutForBoard({ name: 'Só máximo', code: '' }, onlyMax.structure).lines, ['Máx. Squat Clean 80 kg']);
});

test('telão 1.63: For Time, AMRAP e Carga máxima saem com o mesmo payload de antes (intervalSpec null)', () => {
  const v2 = { version: 2, generator: null, customized: true, entry: { mode: 'both', marking: 'reps', publish: 'after_review' }, maxLoad: null, scoreDisplay: null };
  const cindy = validateWorkoutStructure({
    ...v2, format: 'amrap', totalReps: 30, timeCapSeconds: 1200, incomplete: null, tieBreak: { kind: 'last_round', order: 'asc' }, scoreDisplay: 'rounds_reps',
    segments: [plainSegment('c1', 'Pull-up', 5), plainSegment('c2', 'Push-up', 10), plainSegment('c3', 'Air squat', 15)]
  });
  const total = validateWorkoutStructure({
    ...v2, format: 'max_load', totalReps: 0, timeCapSeconds: 1200, incomplete: null, tieBreak: { kind: 'finish_time', order: 'asc' }, segments: [],
    maxLoad: { lifts: [{ id: 'l1', name: 'Back Squat', reps: 1, maxAttempts: 3, startLoadKg: 100, note: '' }, { id: 'l2', name: 'Deadlift', reps: 3, maxAttempts: 3, startLoadKg: 120, note: '' }], order: 'fixed', scoring: 'sum', loadStepKg: 2.5 }
  });
  const ten = validateWorkoutStructure({
    ...v2, format: 'for_time', totalReps: 100, timeCapSeconds: 900, incomplete: { rule: 'penalty_per_rep', secondsPerRep: 1, base: 'time_cap' }, tieBreak: null,
    segments: Array.from({ length: 10 }, (_, index) => plainSegment(`t${index + 1}`, `Mov ${index + 1}`, 10))
  });
  for (const item of [cindy, total, ten]) assert.equal(item.ok, true, item.error);

  const fran = describeWorkoutForBoard({ name: 'Fran', code: 'W1' }, FRAN);
  assert.deepEqual(
    [fran.format, fran.timeCapSeconds, fran.scheme, fran.lines, fran.intervalSpec, fran.totalReps],
    ['for_time', 600, '21-15-9', ['Thruster 43 kg', 'Pull-up'], null, 90]
  );
  const amrap = describeWorkoutForBoard({ name: 'Cindy', code: 'W2' }, cindy.structure);
  assert.deepEqual(
    [amrap.format, amrap.scheme, amrap.lines, amrap.intervalSpec, amrap.scoreDisplay],
    ['amrap', null, ['5 Pull-up', '10 Push-up', '15 Air squat'], null, 'rounds_reps']
  );
  const load = describeWorkoutForBoard({ name: 'Total', code: 'W3' }, total.structure);
  assert.deepEqual([load.format, load.lines, load.lifts, load.intervalSpec], ['max_load', ['Back Squat', 'Deadlift · 3RM'], [{ id: 'l1', name: 'Back Squat' }, { id: 'l2', name: 'Deadlift' }], null]);
  const longFor = describeWorkoutForBoard({ name: 'Chipper', code: '' }, ten.structure);
  assert.equal(longFor.lines.length, 8);
  assert.deepEqual(longFor.lines.slice(6), ['10 Mov 7', '+ 3 etapas'], 'o corte de sempre: 7 linhas e "+ N etapas"');
});

test('telão 1.63: round e fase pelo relógio da bateria com a função da súmula, nos instantes do caso aprovado', () => {
  const at = (seconds) => {
    const phase = broadcastIntervalPhase(REF_SPEC, seconds);
    assert.deepEqual(phase, intervalPhaseAt(REF, seconds), `mesma fase da súmula do judge em ${seconds} s`);
    return describeIntervalClock(REF_SPEC, phase);
  };
  assert.deepEqual(at(0), { line: 'Round 1 de 5 · Trabalho', countdownCaption: 'Restam no round', countdown: '02:00' });
  assert.deepEqual(at(119), { line: 'Round 1 de 5 · Trabalho', countdownCaption: 'Restam no round', countdown: '00:01' });
  assert.deepEqual(at(120), { line: 'Depois do round 1 de 5 · Descanso', countdownCaption: 'Próximo round em', countdown: '02:00' });
  assert.deepEqual(at(250), { line: 'Round 2 de 5 · Trabalho', countdownCaption: 'Restam no round', countdown: '01:50' });
  assert.deepEqual(at(1079), { line: 'Round 5 de 5 · Trabalho', countdownCaption: 'Restam no round', countdown: '00:01' });
  assert.deepEqual(at(1080), { line: 'Prova encerrada', countdownCaption: null, countdown: null });
  assert.deepEqual(at(5000), { line: 'Prova encerrada', countdownCaption: null, countdown: null });
  // O relógio do telão anda em frações de segundo (useNow, 250 ms).
  assert.equal(describeIntervalClock(REF_SPEC, broadcastIntervalPhase(REF_SPEC, 119.75)).countdown, '00:01');
  assert.equal(broadcastIntervalPhase(REF_SPEC, -3).phase, 'work', 'hora do servidor um pouco atrás da largada: round 1');

  // Sem descanso (OFF = 00:00): nunca "Descanso".
  const noRest = { ...REF_SPEC, offSeconds: 0 };
  for (let second = 0; second < 600; second += 1) {
    const clock = describeIntervalClock(noRest, broadcastIntervalPhase(noRest, second));
    assert.doesNotMatch(clock.line, /Descanso/, `${second} s`);
  }
  assert.equal(describeIntervalClock(noRest, broadcastIntervalPhase(noRest, 120)).line, 'Round 2 de 5 · Trabalho');
  assert.equal(describeIntervalClock(noRest, broadcastIntervalPhase(noRest, 600)).line, 'Prova encerrada');
});

test('telão 1.63: barra da raia vazia quando o resumo é de um round anterior ao da fase; descanso e fim mantêm o resumo', () => {
  const board = describeWorkoutForBoard({ name: 'Intervalado', code: 'W1' }, REF);
  const entry = { segments: [6, 15], currentSegmentId: 'mx', round: 1 };
  const phaseAt = (seconds) => broadcastIntervalPhase(REF_SPEC, seconds);
  assert.deepEqual(intervalLaneProgress(entry, board, phaseAt(100)), { segments: [6, 15], currentSegmentId: 'mx', previousRound: false }, 'round 1 em trabalho');
  assert.deepEqual(intervalLaneProgress(entry, board, phaseAt(200)), { segments: [6, 15], currentSegmentId: 'mx', previousRound: false }, 'descanso: o round que acabou de fechar');
  assert.deepEqual(intervalLaneProgress(entry, board, phaseAt(250)), { segments: [0, 0], currentSegmentId: 'f1', previousRound: true }, 'round 2 sem registro: barra vazia');
  assert.deepEqual(intervalLaneProgress(entry, board, phaseAt(1080)), { segments: [6, 15], currentSegmentId: 'mx', previousRound: false }, 'depois do fim: o valor final');
  assert.deepEqual(intervalLaneProgress(entry, board, null), { segments: [6, 15], currentSegmentId: 'mx', previousRound: false }, 'sem relógio: como veio');
  assert.deepEqual(intervalLaneProgress({ ...entry, round: null, segments: [0, 0], currentSegmentId: 'f1' }, board, phaseAt(250)).segments, [0, 0]);
  const onlyMax = describeWorkoutForBoard({ name: 'Só máximo', code: '' }, validateWorkoutStructure({ ...REF, totalReps: 0, segments: [] }).structure);
  assert.deepEqual(intervalLaneProgress({ segments: [], currentSegmentId: 'mx', round: 1 }, onlyMax, phaseAt(250)), { segments: [], currentSegmentId: 'mx', previousRound: true }, 'sem fixos não há barra');
});

test('telão 1.63 pelas rotas: chamada com o bloco do intervalado, bateria ao vivo com o round do resumo e geral com o número inteiro e empate dividindo a posição', async (t) => {
  quiet(t);
  seed();
  const EV = 'ev-intervalado';
  const people = [['ath-ia', 'Iara Melo'], ['ath-ib', 'Ivo Brito 85911112222'], ['ath-ic', 'Inês Cruz']];
  database.rows('events').push({ id: EV, name: 'Intervalado Litoral', date: '2026-11-01', organizer_id: MANAGER.id, event_type: 'functional_fitness', status: 'upcoming', logo_url: null,
    event_schedule: [{ id: 'heat-i1', kind: 'heat', workoutId: 'wod-int', heatNumber: 1, date: '2026-11-01', time: '09:00', title: 'BATERIA 1', athleteIds: people.map(([id]) => id) }] });
  database.rows('event_judges').push({ event_id: EV, judge_user_id: JUDGE.id });
  database.rows('divisions').push({ id: 'div-int', event_id: EV, name: 'RX', order_index: 1 });
  database.rows('athletes').push(...people.map(([id, name]) => ({ id, name, box: 'Box Sul', division_id: 'div-int', is_team: false })));
  database.rows('leaderboard_entries').push(...people.map(([id]) => ({ id: `le-${id}`, event_id: EV, division_id: 'div-int', athlete_id: id })));
  database.rows('workouts').push({ id: 'wod-int', event_id: EV, name: 'Intervalado', code: 'W1', order_index: 1, type: 'reps', time_cap: '18:00', tie_breaker: '', division_id: null, structure: REF });
  const { token } = (await control(MANAGER, { action: 'generate_link', eventId: EV })).body;
  const openLane = async (athleteId, lane) => {
    const opened = await sheets({ action: 'open', eventId: EV, workoutId: 'wod-int', athleteId, heatId: 'heat-i1', lane });
    assert.equal(opened.status, 200, opened.body.error);
    return opened.body.sheet.id;
  };
  const [ia, ib, ic] = [await openLane('ath-ia', 1), await openLane('ath-ib', 2), await openLane('ath-ic', 3)];

  const call = await telao(token);
  assert.equal(call.body.screen, 'call');
  const workout = call.body.call.heat.workout;
  assert.deepEqual([workout.format, workout.timeCapSeconds, workout.lines, workout.intervalSpec], ['interval', 1080, ['6 Ring Muscle Ups', '15 Box Jump Overs', 'Máx. Squat Clean 80 kg'], REF_SPEC]);
  assert.equal(call.body.interval, null, 'a tela de intervalo não está no ar');

  // Round 1 completo para os três; Ivo já no round 2 (1 Ring Muscle Up aos 250 s).
  const roundLog = (index, maxReps, f2 = 15) => {
    const start = index * 240;
    return [
      e({ t: 'fill', seg: 'f1', n: 6, at: start + 15 }),
      e({ t: 'fill', seg: 'f2', n: f2, at: start + 45 }),
      ...Array.from({ length: maxReps }, (_, k) => e({ t: 'rep', seg: 'mx', at: start + 50 + k * 5 }))
    ];
  };
  await append(ia, roundLog(0, 3));
  await append(ib, [...roundLog(0, 5), e({ t: 'rep', seg: 'f1', at: 250 })]);
  await append(ic, roundLog(0, 3).map((item, index, list) => (index === list.length - 1 ? e({ ...item.event, at: 59 }) : item)));
  const live = await telao(token);
  assert.equal(live.body.screen, 'live');
  assert.deepEqual(live.body.live.heat.workout.intervalSpec, REF_SPEC);
  assert.deepEqual(
    live.body.live.entries.map((entry) => [entry.name, entry.position, entry.repsDone, entry.round, entry.segments, entry.currentSegmentId]),
    [
      ['Ivo Brito', 1, 5, 2, [1, 0], 'f1'],
      // Iara e Inês com 3: Inês fez o último Squat Clean antes (59 s contra 60 s).
      ['Inês Cruz', 2, 3, 1, [6, 15], 'mx'],
      ['Iara Melo', 3, 3, 1, [6, 15], 'mx']
    ]
  );
  const text = JSON.stringify(live.body);
  assert.doesNotMatch(text, /85911112222|@example\.com|ath-i[abc]|judge-telao/, 'sem dado pessoal novo');

  // Telão sem a coluna absent (migration da 1.59 pendente): segue respondendo igual.
  database.rows('scoresheets').forEach((row) => { delete row.absent; });
  const withoutAbsent = await telao(token);
  assert.equal(withoutAbsent.status, 200);
  assert.deepEqual(withoutAbsent.body.live.entries.map((entry) => entry.repsDone), [5, 3, 3]);

  // Fim da prova: Ivo 5 + 9 + 8 + 7 + 6 = 35, Inês 3 + 4 × 8 = 35 e Iara 3 + 8 + 5 + 1 = 17 (o round 5 dela não pontua: Box Jump Overs 11/15).
  const rest = {
    ia: [...[8, 5, 1].flatMap((max, index) => roundLog(index + 1, max)), ...roundLog(4, 3, 11)],
    ib: [...roundLog(1, 9).slice(1).filter((item) => item.event.seg !== 'f1'), e({ t: 'fill', seg: 'f1', n: 5, at: 251 }), ...[8, 7, 6].flatMap((max, index) => roundLog(index + 2, max))],
    ic: [8, 8, 8, 8].flatMap((max, index) => roundLog(index + 1, max))
  };
  await append(ia, rest.ia);
  await append(ib, rest.ib);
  await append(ic, rest.ic);
  for (const sheetId of [ia, ib, ic]) await submit(sheetId);
  const interval = await telao(token);
  assert.equal(interval.body.screen, 'interval');
  const [standings] = interval.body.interval.boards;
  assert.deepEqual(standings.columns, [{ label: 'W1', fresh: true }]);
  const cellOf = (name) => standings.rows.find((row) => row.name === name).cells[0];
  assert.deepEqual([cellOf('Ivo Brito'), cellOf('Inês Cruz'), cellOf('Iara Melo')], [{ rank: 1, result: '35' }, { rank: 1, result: '35' }, { rank: 3, result: '17' }], 'empate divide a posição, sem desempate');
});

test('telão 1.63: a tela mostra "Intervalado", "Duração", o esquema e a fase pela função da súmula, sem rede nova', () => {
  const screen = read('../src/components/broadcast/BroadcastScreen.tsx');
  assert.match(screen, /format === 'interval' \? 'Intervalado' : 'For Time'/);
  assert.match(screen, /format === 'amrap' \|\| format === 'interval' \? 'Duração'/);
  assert.match(screen, /capWord\(workout\.format\)/);
  assert.match(screen, /intervalSchemeText\(workout\.intervalSpec\)/);
  assert.match(screen, /broadcastIntervalPhase\(liveSpec, elapsed\)/, 'fase do relógio da bateria no cabeçalho');
  assert.match(screen, /broadcastIntervalPhase\(spec, elapsed\)/, 'a mesma fase nas raias');
  assert.match(screen, /liveSpec && elapsed !== null \?/, 'antes da largada não inventa fase');
  assert.match(screen, /`Máx\. \$\{interval\.max\.name\}`/);
  assert.match(screen, /intervalLaneProgress\(entry, workout, phase\)/);
  assert.doesNotMatch(screen, /onSeconds|offSeconds/, 'nenhuma conta de fase própria do telão');
  assert.equal(screen.match(/fetch\(/g).length, 1, 'nenhuma requisição nova');
  assert.match(screen, /useNow\(250, offset\)/);
  assert.match(screen, /aria-live="off"/);
  const payload = read('../src/lib/broadcastPayload.ts');
  assert.match(payload, /return intervalPhaseAt\(structure, Math\.max\(0, elapsed\)\)/);
  assert.match(payload, /intervalSpec: BroadcastIntervalSpec \| null/);
});
