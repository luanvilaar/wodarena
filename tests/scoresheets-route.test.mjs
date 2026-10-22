import assert from 'node:assert/strict';
import test from 'node:test';

import { createFakeSupabase } from './support/fakeSupabase.mjs';
import { importServerModule, setActiveSupabaseClient } from './support/serverModuleHarness.mjs';

// Stories 1.49 a 1.52 (etapa E3): arbitragem presencial pela rota real, com o
// banco em memória. Acesso por evento (judge atribuído, gestor dono, owner),
// abrir e retomar a súmula, gravar em lote com reenvio sem duplicar, enviar e
// publicar na hora com o ranking recalculado no servidor, revisão do gestor
// (devolver, corrigir, cancelar), trava da estrutura, lançamento manual por
// cima da súmula e judges em evento presencial. Story 1.59: atleta ausente
// (judge, gestor sobre a súmula, gestor sem súmula), desfazer, a súmula sem
// judge assumida pelo judge e o banco sem a migration da coluna absent.

process.env.SUPABASE_URL = 'http://supabase.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';
process.env.WODA_SESSION_SECRET = 'segredo-de-teste-sumula-presencial';

let database = createFakeSupabase();
let missingTables = false;
// Story 1.59: coluna scoresheets.absent ainda não criada (o banco em memória não
// valida colunas, então o erro do PostgREST é injetado aqui): select que pede a
// coluna e gravação que a leva falham como no Supabase.
let missingAbsent = false;
const failingQuery = (error) => {
  const failing = new Proxy({}, {
    get: (_, prop) => (prop === 'then' ? (resolve) => resolve({ data: null, error }) : () => failing)
  });
  return failing;
};
const hasAbsentKey = (payload) => (Array.isArray(payload) ? payload : [payload]).some((row) => row && typeof row === 'object' && 'absent' in row);
const withoutAbsentColumn = (query) => new Proxy(query, {
  get(target, prop) {
    if (prop === 'select') {
      return (columns, options) => (/\babsent\b/.test(String(columns))
        ? failingQuery({ code: '42703', message: 'column scoresheets.absent does not exist' })
        : target.select(columns, options));
    }
    if (prop === 'insert' || prop === 'update' || prop === 'upsert') {
      return (payload, options) => (hasAbsentKey(payload)
        ? failingQuery({ code: 'PGRST204', message: "Could not find the 'absent' column of 'scoresheets' in the schema cache" })
        : target[prop](payload, options));
    }
    const value = target[prop];
    return typeof value === 'function' ? value.bind(target) : value;
  }
});
setActiveSupabaseClient({
  from: (table) => {
    if (missingTables && table.startsWith('scoresheet')) {
      const failing = {
        select: () => failing, eq: () => failing, in: () => failing, order: () => failing, maybeSingle: () => failing, insert: () => failing,
        then: (resolve) => resolve({ data: null, error: { code: '42P01', message: `relation "public.${table}" does not exist` } })
      };
      return failing;
    }
    if (missingAbsent && table === 'scoresheets') return withoutAbsentColumn(database.client.from(table));
    return database.client.from(table);
  },
  rpc: (name, args) => database.client.rpc(name, args)
});

const { GET: getSheets, POST: postSheets } = await importServerModule('app/api/sheets/route.ts');
const { POST: postPersistence } = await importServerModule('app/api/admin/persistence/route.ts');
const { createSessionToken } = await importServerModule('lib/serverSecurity.ts');
const { validateWorkoutStructure } = await importServerModule('lib/workoutStructure.ts');

const MANAGER = { id: 'mgr-quadra', name: 'Gestora Quadra', email: 'quadra@example.com', role: 'manager', service_valid_until: '2099-12-31' };
const OTHER_MANAGER = { id: 'mgr-outra', name: 'Outra Gestora', email: 'outra@example.com', role: 'manager', service_valid_until: '2099-12-31' };
const OWNER = { id: 'owner-quadra', name: 'Owner', email: 'owner-quadra@example.com', role: 'owner' };
const JUDGE = { id: 'judge-rafa', name: 'Judge Rafa', email: 'rafa@example.com', role: 'judge', parent_manager_id: MANAGER.id };
const JUDGE_2 = { id: 'judge-paula', name: 'Judge Paula', email: 'paula@example.com', role: 'judge', parent_manager_id: MANAGER.id };
const JUDGE_FREE = { id: 'judge-sem-evento', name: 'Judge Sem Evento', email: 'sem@example.com', role: 'judge', parent_manager_id: MANAGER.id };
const JUDGE_OTHER = { id: 'judge-outro', name: 'Judge de Outra', email: 'outro@example.com', role: 'judge', parent_manager_id: OTHER_MANAGER.id };
const ATHLETE_USER = { id: 'ath-user', name: 'Atleta', email: 'atleta@example.com', role: 'athlete' };

const segment = (id, round, name, reps) => ({ id, round, name, reps, unit: 'reps', load: null, note: '', required: true, mark: 'reps' });
const FRAN = validateWorkoutStructure({
  version: 2, format: 'for_time', totalReps: 90, timeCapSeconds: 600,
  incomplete: { rule: 'penalty_per_rep', secondsPerRep: 1, base: 'time_cap' },
  tieBreak: { kind: 'split_time', at: 's2', order: 'asc' }, generator: { kind: 'descending', reps: [21, 15, 9] }, customized: false,
  entry: { mode: 'both', marking: 'reps', publish: 'after_review' },
  segments: [segment('s1', 1, 'Thruster', 21), segment('s2', 1, 'Pull-up', 21), segment('s3', 2, 'Thruster', 15), segment('s4', 2, 'Pull-up', 15), segment('s5', 3, 'Thruster', 9), segment('s6', 3, 'Pull-up', 9)],
  maxLoad: null, scoreDisplay: null
}).structure;
const TOTAL = validateWorkoutStructure({
  version: 2, format: 'max_load', totalReps: 0, timeCapSeconds: 1200, incomplete: null,
  tieBreak: { kind: 'finish_time', order: 'asc' }, generator: null, customized: true,
  entry: { mode: 'both', marking: 'reps', publish: 'after_review' }, segments: [],
  maxLoad: { lifts: [{ id: 'l1', name: 'Back Squat', reps: 1, maxAttempts: 3, startLoadKg: 100, note: '' }], order: 'fixed', scoring: 'sum', loadStepKg: 2.5 },
  scoreDisplay: null
}).structure;

const EVENT = 'ev-presencial';
const seed = () => {
  database = createFakeSupabase({
    users: [MANAGER, OTHER_MANAGER, OWNER, JUDGE, JUDGE_2, JUDGE_FREE, JUDGE_OTHER],
    events: [
      { id: EVENT, name: 'Híbrido Games', date: '2026-11-01', location: 'Recife', organizer_id: MANAGER.id, event_type: 'functional_fitness', status: 'upcoming',
        event_schedule: [
          { id: 'heat-1', kind: 'heat', workoutId: 'wod-fran', heatNumber: 1, date: '2026-11-01', time: '10:40', title: 'BATERIA 1', athleteIds: ['ath-caio', '', 'ath-ana'] },
          { id: 'heat-text', kind: 'heat', workoutId: 'wod-texto', heatNumber: 1, athleteIds: ['ath-caio'] },
          { id: 'brief', kind: 'briefing', title: 'Briefing' }
        ] },
      { id: 'ev-qualifier', name: 'Qualifier', organizer_id: MANAGER.id, event_type: 'functional_fitness_qualifier', status: 'upcoming', event_schedule: [] },
      { id: 'ev-race', name: 'Race', organizer_id: MANAGER.id, event_type: 'fitness_racing', status: 'upcoming', event_schedule: [] },
      { id: 'ev-outra', name: 'Evento da Outra', organizer_id: OTHER_MANAGER.id, event_type: 'functional_fitness', status: 'upcoming', event_schedule: [] }
    ],
    event_judges: [
      { event_id: EVENT, judge_user_id: JUDGE.id },
      { event_id: EVENT, judge_user_id: JUDGE_2.id },
      { event_id: 'ev-outra', judge_user_id: JUDGE_OTHER.id }
    ],
    divisions: [{ id: 'div-rx', event_id: EVENT, name: 'RX Masculino' }, { id: 'div-outra', event_id: 'ev-outra', name: 'RX' }],
    athletes: [
      { id: 'ath-caio', name: 'Caio Reis', box: 'Tropa Fit', division_id: 'div-rx' },
      { id: 'ath-ana', name: 'Ana Souza', box: 'CrossFit Litoral', division_id: 'div-rx' },
      { id: 'ath-bruno', name: 'Bruno Lima', box: 'Box Norte', division_id: 'div-rx' },
      { id: 'ath-fora', name: 'De Outro Evento', box: 'X', division_id: 'div-outra' }
    ],
    workouts: [
      { id: 'wod-fran', event_id: EVENT, name: 'Fran', code: 'W1', order_index: 1, type: 'fortime', time_cap: '10:00', tie_breaker: 'Tempo', division_id: null, structure: FRAN },
      { id: 'wod-total', event_id: EVENT, name: 'Total', code: 'W2', order_index: 2, type: 'maxweight', time_cap: '20:00', tie_breaker: 'Tempo', division_id: null, structure: TOTAL },
      { id: 'wod-texto', event_id: EVENT, name: 'Só texto', code: 'W3', order_index: 3, type: 'reps', time_cap: null, tie_breaker: '', division_id: null, structure: null }
    ],
    scores: [
      // Bruno já tem um resultado lançado à mão: o ranking da súmula precisa considerá-lo.
      { athlete_id: 'ath-bruno', workout_id: 'wod-fran', result: '08:00', value: 480, rank: 1, points: 1, splits: { tieBreaker: '04:00' } }
    ],
    registrations: []
  });
  missingTables = false;
  missingAbsent = false;
};

const cookie = (user) => `woda_session=${createSessionToken({ id: user.id, name: user.name, email: user.email, role: user.role })}`;
const get = async (user, query) => {
  const response = await getSheets(new Request(`http://localhost/api/sheets?${new URLSearchParams(query)}`, { headers: { cookie: cookie(user) } }));
  return { status: response.status, body: await response.json() };
};
const post = async (user, body) => {
  const response = await postSheets(new Request('http://localhost/api/sheets', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie(user) }, body: JSON.stringify(body)
  }));
  return { status: response.status, body: await response.json() };
};
const persist = async (user, action, payload) => {
  const response = await postPersistence(new Request('http://localhost/api/admin/persistence', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie(user) }, body: JSON.stringify({ action, payload })
  }));
  return { status: response.status, body: await response.json() };
};
const quiet = (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'info', () => {});
};
const rows = (table) => structuredClone(database.rows(table));
const scoreOf = (athleteId, workoutId = 'wod-fran') => rows('scores').find((row) => row.athlete_id === athleteId && row.workout_id === workoutId);

let counter = 0;
const e = (event) => ({ id: `c${(counter += 1)}`, event });
// Fran inteira em 09:41, com o Pull-up do round 1 (desempate) em 04:31.
const franRun = () => [
  e({ t: 'fill', seg: 's1', n: 21, at: 120 }), e({ t: 'fill', seg: 's2', n: 21, at: 271 }),
  e({ t: 'fill', seg: 's3', n: 15, at: 380 }), e({ t: 'fill', seg: 's4', n: 15, at: 470 }),
  e({ t: 'fill', seg: 's5', n: 9, at: 530 }), e({ t: 'fill', seg: 's6', n: 9, at: 581 })
];
const openFran = async (user = JUDGE, athleteId = 'ath-caio') => post(user, { action: 'open', eventId: EVENT, workoutId: 'wod-fran', athleteId, heatId: 'heat-1', lane: 1 });

// ---------------------------------------------------------------------------
// Acesso (Story 1.49)
// ---------------------------------------------------------------------------

test('eventos da quadra: judge vê os eventos presenciais atribuídos; gestor, os dele; owner, todos; atleta não entra', async (t) => {
  quiet(t);
  seed();
  assert.deepEqual((await get(JUDGE, { view: 'events' })).body.events.map((event) => event.id), [EVENT]);
  assert.deepEqual((await get(JUDGE_FREE, { view: 'events' })).body.events, []);
  assert.deepEqual((await get(MANAGER, { view: 'events' })).body.events.map((event) => event.id), [EVENT], 'sem Qualifier nem Fitness Racing');
  assert.deepEqual((await get(OWNER, { view: 'events' })).body.events.map((event) => event.id).sort(), ['ev-outra', EVENT]);
  assert.equal((await get(ATHLETE_USER, { view: 'events' })).status, 403);
});

test('quadro do evento: só provas estruturadas, baterias com raias e nomes, sem e-mail; acesso conferido', async (t) => {
  quiet(t);
  seed();
  const board = await get(JUDGE, { view: 'board', eventId: EVENT });
  assert.equal(board.status, 200, board.body.error);
  assert.deepEqual(board.body.workouts.map((workout) => workout.id), ['wod-fran', 'wod-total']);
  assert.equal(board.body.heats.length, 1, 'a bateria da prova só com texto fica de fora');
  assert.deepEqual(board.body.heats[0].lanes, [
    { lane: 1, athleteId: 'ath-caio', athleteName: 'Caio Reis', box: 'Tropa Fit', divisionId: 'div-rx', divisionName: 'RX Masculino' },
    { lane: 3, athleteId: 'ath-ana', athleteName: 'Ana Souza', box: 'CrossFit Litoral', divisionId: 'div-rx', divisionName: 'RX Masculino' }
  ]);
  assert.equal(board.body.athletes.length, 3);
  assert.doesNotMatch(JSON.stringify(board.body), /@example\.com/);

  assert.equal((await get(JUDGE_FREE, { view: 'board', eventId: EVENT })).status, 403);
  assert.match((await get(JUDGE_FREE, { view: 'board', eventId: EVENT })).body.error, /não atribuído/);
  assert.equal((await get(JUDGE_OTHER, { view: 'board', eventId: EVENT })).status, 403);
  assert.equal((await get(OTHER_MANAGER, { view: 'board', eventId: EVENT })).status, 403);
  assert.equal((await get(MANAGER, { view: 'board', eventId: 'ev-qualifier' })).status, 400);
  assert.equal((await get(MANAGER, { view: 'board', eventId: 'nao-existe' })).status, 404);
  assert.equal((await get(OWNER, { view: 'board', eventId: EVENT })).status, 200);
});

// ---------------------------------------------------------------------------
// Abrir e gravar (Story 1.50)
// ---------------------------------------------------------------------------

test('abrir: cria com a cópia da estrutura e a bateria; a mesma pessoa retoma; outra pessoa recebe 409', async (t) => {
  quiet(t);
  seed();
  const opened = await openFran();
  assert.equal(opened.status, 200, opened.body.error);
  const sheet = opened.body.sheet;
  assert.equal(sheet.status, 'in_progress');
  assert.deepEqual([sheet.heatId, sheet.heatNumber, sheet.lane, sheet.judgeName, sheet.divisionId], ['heat-1', 1, 1, 'Judge Rafa', 'div-rx']);
  assert.deepEqual(sheet.structure, FRAN);
  assert.deepEqual(opened.body.context, { athleteName: 'Caio Reis', box: 'Tropa Fit', workoutName: 'Fran', workoutCode: 'W1', divisionName: 'RX Masculino' });
  assert.deepEqual(rows('scoresheet_reviews').map((review) => [review.action, review.actor_name]), [['opened', 'Judge Rafa']]);

  const again = await openFran();
  assert.equal(again.body.sheet.id, sheet.id);
  assert.equal(rows('scoresheets').length, 1);

  const other = await openFran(JUDGE_2);
  assert.equal(other.status, 409);
  assert.match(other.body.error, /^Esta súmula está com Judge Rafa\./);

  assert.equal((await post(JUDGE, { action: 'open', eventId: EVENT, workoutId: 'wod-texto', athleteId: 'ath-caio' })).status, 404);
  assert.equal((await post(JUDGE, { action: 'open', eventId: EVENT, workoutId: 'wod-fran', athleteId: 'ath-fora' })).status, 400);
  assert.equal((await post(JUDGE_FREE, { action: 'open', eventId: EVENT, workoutId: 'wod-fran', athleteId: 'ath-ana' })).status, 403);
});

test('gravar em lote: sequência contígua, reenvio do mesmo lote não duplica, outro aparelho dá 409 e registro inválido não grava nada', async (t) => {
  quiet(t);
  seed();
  const sheetId = (await openFran()).body.sheet.id;
  const first = [e({ t: 'rep', seg: 's1', at: 3 }), e({ t: 'rep', seg: 's1', at: 5 })];
  assert.deepEqual((await post(JUDGE, { action: 'append', sheetId, fromSeq: 0, events: first })).body, { count: 2 });
  // Resposta perdida: o aparelho reenvia o mesmo lote (e mais um registro).
  const retry = [...first, e({ t: 'rep', seg: 's1', at: 7 })];
  assert.deepEqual((await post(JUDGE, { action: 'append', sheetId, fromSeq: 0, events: retry })).body, { count: 3 });
  assert.deepEqual(rows('scoresheet_events').map((row) => [row.seq, row.client_event_id]), [[0, first[0].id], [1, first[1].id], [2, retry[2].id]]);
  assert.ok(rows('scoresheet_events').every((row) => row.author_user_id === JUDGE.id && !('id' in row.event)));

  const conflict = await post(JUDGE, { action: 'append', sheetId, fromSeq: 1, events: [e({ t: 'rep', seg: 's1', at: 9 })] });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.serverCount, 3);
  assert.match(conflict.body.error, /alterada em outro aparelho/);

  const before = rows('scoresheet_events').length;
  const invalid = await post(JUDGE, { action: 'append', sheetId, fromSeq: 3, events: [e({ t: 'rep', seg: 's1', at: 9 }), e({ t: 'rep', seg: 'zz', at: 10 })] });
  assert.equal(invalid.status, 400);
  assert.match(invalid.body.error, /^Registro 5: etapa inexistente na prova\.$/);
  assert.equal(rows('scoresheet_events').length, before, 'o lote inteiro é recusado');
  assert.equal((await post(JUDGE, { action: 'append', sheetId, fromSeq: 3, events: [e({ t: 'undo', of: 3, at: 9 })] })).status, 400, 'desfazer não aponta para a frente');
  assert.equal((await post(JUDGE_2, { action: 'append', sheetId, fromSeq: 3, events: [e({ t: 'rep', seg: 's1', at: 9 })] })).status, 403);
  assert.equal((await post(JUDGE, { action: 'append', sheetId, fromSeq: 3, events: [] })).status, 400);
  assert.equal((await post(JUDGE, { action: 'append', sheetId: 'nao-existe', fromSeq: 0, events: [e({ t: 'rep', seg: 's1', at: 1 })] })).status, 404);
});

// ---------------------------------------------------------------------------
// Enviar e publicar (Story 1.51)
// ---------------------------------------------------------------------------

test('enviar: o servidor calcula, publica na hora em scores e recalcula o ranking da categoria', async (t) => {
  quiet(t);
  seed();
  const sheetId = (await openFran()).body.sheet.id;
  const events = franRun();
  await post(JUDGE, { action: 'append', sheetId, fromSeq: 0, events });

  const early = await post(JUDGE, { action: 'submit', sheetId, expectedCount: 5 });
  assert.equal(early.status, 409, 'o aparelho ainda não mandou tudo');
  assert.equal(early.body.serverCount, 6);

  const submitted = await post(JUDGE, { action: 'submit', sheetId, expectedCount: 6 });
  assert.equal(submitted.status, 200, submitted.body.error);
  assert.equal(submitted.body.sheet.status, 'submitted');
  assert.deepEqual([submitted.body.sheet.officialResult, submitted.body.sheet.officialTieBreak, submitted.body.summary], ['09:41', '04:31', 'Concluída em 09:41']);
  // Story 1.59 (AUTO-DECISION 5): a publicação grava result_status sempre (null no envio normal).
  assert.deepEqual(scoreOf('ath-caio'), { athlete_id: 'ath-caio', workout_id: 'wod-fran', result: '09:41', value: 581, splits: { tieBreaker: '04:31' }, scoresheet_id: sheetId, result_status: null, rank: 2, points: 2 });
  assert.deepEqual([scoreOf('ath-bruno').rank, scoreOf('ath-bruno').points], [1, 1]);
  assert.deepEqual(submitted.body.ranking.map((score) => [score.athleteId, score.rank]).sort(), [['ath-bruno', 1], ['ath-caio', 2]]);
  assert.deepEqual(rows('scoresheet_reviews').map((review) => review.action), ['opened', 'submitted']);

  assert.equal((await post(JUDGE, { action: 'submit', sheetId, expectedCount: 6 })).status, 409, 'já enviada');
  assert.equal((await post(JUDGE, { action: 'append', sheetId, fromSeq: 6, events: [e({ t: 'rep', seg: 's1', at: 600 })] })).status, 409);
  // Depois de publicada, outra pessoa pode ver (somente leitura).
  assert.equal((await openFran(JUDGE_2)).body.sheet.status, 'submitted');
});

test('enviar: tie-break depois do fim é recusado; carga máxima publica a soma em kg', async (t) => {
  quiet(t);
  seed();
  const sheetId = (await openFran()).body.sheet.id;
  await post(JUDGE, { action: 'append', sheetId, fromSeq: 0, events: [...franRun(), e({ t: 'time', target: 'final', v: 260, at: 590 })] });
  const refused = await post(JUDGE, { action: 'submit', sheetId, expectedCount: 7 });
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /tie-break ficou depois do fim da prova/);
  assert.equal(scoreOf('ath-caio'), undefined, 'nada é publicado');

  const totalId = (await post(JUDGE, { action: 'open', eventId: EVENT, workoutId: 'wod-total', athleteId: 'ath-ana' })).body.sheet.id;
  await post(JUDGE, { action: 'append', sheetId: totalId, fromSeq: 0, events: [
    e({ t: 'attempt', lift: 'l1', load: 140, ok: true, at: 60 }), e({ t: 'attempt', lift: 'l1', load: 152.5, ok: true, at: 240 })
  ] });
  const total = await post(JUDGE, { action: 'submit', sheetId: totalId, expectedCount: 2 });
  assert.equal(total.status, 200, total.body.error);
  assert.deepEqual([scoreOf('ath-ana', 'wod-total').result, scoreOf('ath-ana', 'wod-total').value, scoreOf('ath-ana', 'wod-total').splits], ['152.5', 152.5, { tieBreaker: '04:00' }]);
});

test('enviar por cima de um lançamento manual: a súmula vale e o histórico guarda o resultado substituído', async (t) => {
  quiet(t);
  seed();
  const sheetId = (await post(JUDGE, { action: 'open', eventId: EVENT, workoutId: 'wod-fran', athleteId: 'ath-bruno' })).body.sheet.id;
  await post(JUDGE, { action: 'append', sheetId, fromSeq: 0, events: franRun() });
  assert.equal((await post(JUDGE, { action: 'submit', sheetId, expectedCount: 6 })).status, 200);
  assert.deepEqual([scoreOf('ath-bruno').result, scoreOf('ath-bruno').scoresheet_id], ['09:41', sheetId]);
  const review = rows('scoresheet_reviews').at(-1);
  assert.deepEqual(
    [review.action, review.reason, review.previous_result, review.previous_value, review.previous_tie_break, review.applied_result],
    ['submitted', 'Substituiu um resultado lançado à mão.', '08:00', 480, '04:00', '09:41']
  );
});

// ---------------------------------------------------------------------------
// Revisão do gestor (Story 1.51)
// ---------------------------------------------------------------------------

const publishedFran = async () => {
  const sheetId = (await openFran()).body.sheet.id;
  await post(JUDGE, { action: 'append', sheetId, fromSeq: 0, events: franRun() });
  await post(JUDGE, { action: 'submit', sheetId, expectedCount: 6 });
  return sheetId;
};

test('devolver: o resultado publicado fica; o judge corrige no log e reenvia, e o novo resultado substitui', async (t) => {
  quiet(t);
  seed();
  const sheetId = await publishedFran();
  assert.equal((await post(MANAGER, { action: 'review', sheetId, review: 'return', reason: '' })).status, 400, 'motivo obrigatório');
  const returned = await post(MANAGER, { action: 'review', sheetId, review: 'return', reason: 'Conferir o cronômetro oficial' });
  assert.equal(returned.status, 200, returned.body.error);
  assert.deepEqual([returned.body.sheet.status, returned.body.sheet.returnReason], ['returned', 'Conferir o cronômetro oficial']);
  assert.equal(scoreOf('ath-caio').result, '09:41', 'continua no ranking até o reenvio');

  assert.equal((await post(JUDGE, { action: 'append', sheetId, fromSeq: 6, events: [e({ t: 'time', target: 'final', v: 578, at: 600 })] })).status, 200);
  const resubmitted = await post(JUDGE, { action: 'submit', sheetId, expectedCount: 7 });
  assert.equal(resubmitted.status, 200, resubmitted.body.error);
  assert.equal(scoreOf('ath-caio').result, '09:38');
  assert.equal(resubmitted.body.sheet.returnReason, null);
  const last = rows('scoresheet_reviews').at(-1);
  assert.deepEqual([last.action, last.previous_result, last.applied_result], ['submitted', '09:41', '09:38']);
});

test('corrigir: o gestor troca o resultado publicado com justificativa, sem apagar o log, e o ranking acompanha', async (t) => {
  quiet(t);
  seed();
  const sheetId = await publishedFran();
  assert.equal((await post(MANAGER, { action: 'review', sheetId, review: 'correct', reason: 'No-rep não marcado', result: 'xx' })).status, 400);
  assert.match((await post(MANAGER, { action: 'review', sheetId, review: 'correct', reason: 'No-rep', result: '07:00', tieBreak: '99' })).body.error, /tie-break no formato MM:SS/);
  const corrected = await post(MANAGER, { action: 'review', sheetId, review: 'correct', reason: 'Cronômetro oficial', result: '7:50', tieBreak: '3:59' });
  assert.equal(corrected.status, 200, corrected.body.error);
  assert.deepEqual([corrected.body.sheet.officialResult, corrected.body.sheet.officialTieBreak, corrected.body.sheet.corrected], ['07:50', '03:59', true]);
  assert.deepEqual([scoreOf('ath-caio').result, scoreOf('ath-caio').value, scoreOf('ath-caio').rank, scoreOf('ath-bruno').rank], ['07:50', 470, 1, 2]);
  assert.equal(rows('scoresheet_events').length, 6, 'o log do judge fica');
  const review = rows('scoresheet_reviews').at(-1);
  assert.deepEqual([review.action, review.reason, review.previous_result, review.applied_result, review.actor_role], ['corrected', 'Cronômetro oficial', '09:41', '07:50', 'manager']);

  assert.equal((await post(JUDGE, { action: 'review', sheetId, review: 'correct', reason: 'x'.repeat(5), result: '07:00' })).status, 403, 'judge não revisa');
  assert.equal((await post(OTHER_MANAGER, { action: 'review', sheetId, review: 'correct', reason: 'abcdef', result: '07:00' })).status, 403);
  assert.equal((await post(OWNER, { action: 'review', sheetId, review: 'correct', reason: 'Owner corrige', result: '07:55' })).status, 200);
});

test('cancelar: tira do ranking o resultado que veio da súmula e libera abrir outra', async (t) => {
  quiet(t);
  seed();
  const sheetId = await publishedFran();
  const cancelled = await post(MANAGER, { action: 'review', sheetId, review: 'cancel', reason: 'Atleta trocou de bateria' });
  assert.equal(cancelled.status, 200, cancelled.body.error);
  assert.equal(cancelled.body.sheet.status, 'cancelled');
  assert.equal(scoreOf('ath-caio'), undefined);
  assert.deepEqual([scoreOf('ath-bruno').rank, scoreOf('ath-bruno').points], [1, 1]);
  assert.equal((await post(MANAGER, { action: 'review', sheetId, review: 'cancel', reason: 'De novo' })).status, 409);
  const reopened = await openFran(JUDGE_2);
  assert.equal(reopened.status, 200);
  assert.notEqual(reopened.body.sheet.id, sheetId);

  const manage = await get(MANAGER, { view: 'manage', eventId: EVENT });
  assert.equal(manage.status, 200);
  assert.deepEqual(manage.body.sheets.map((sheet) => [sheet.status, sheet.athleteName]).sort(), [['cancelled', 'Caio Reis'], ['in_progress', 'Caio Reis']]);
  assert.deepEqual(manage.body.locks, { 'wod-fran': 1 });
  assert.ok(manage.body.sheets.every((sheet) => !('structure' in sheet)));
  assert.equal((await get(JUDGE, { view: 'manage', eventId: EVENT })).status, 403);
});

// ---------------------------------------------------------------------------
// Trava da estrutura (Story 1.52) e lançamento manual (Story 1.51)
// ---------------------------------------------------------------------------

test('trava: com súmula aberta a estrutura não muda nem a prova é excluída; a mesma estrutura passa', async (t) => {
  quiet(t);
  seed();
  await openFran();
  const changed = { ...FRAN, timeCapSeconds: 720 };
  const locked = await persist(MANAGER, 'updateWorkout', { eventId: EVENT, workoutId: 'wod-fran', data: { structure: changed } });
  assert.equal(locked.status, 409);
  assert.match(locked.body.error, /^A estrutura desta prova está travada: 1 súmula já foi aberta\./);
  assert.equal((await persist(MANAGER, 'updateWorkout', { eventId: EVENT, workoutId: 'wod-fran', data: { structure: null } })).status, 409);
  assert.equal((await persist(MANAGER, 'updateWorkout', { eventId: EVENT, workoutId: 'wod-fran', data: { structure: FRAN, name: 'Fran (final)' } })).status, 200, 'mesma estrutura');
  assert.equal((await persist(MANAGER, 'updateWorkout', { eventId: EVENT, workoutId: 'wod-fran', data: { name: 'Fran!' } })).status, 200, 'sem estrutura no payload');
  const deleted = await persist(MANAGER, 'deleteWorkout', { eventId: EVENT, workoutId: 'wod-fran' });
  assert.equal(deleted.status, 409);
  assert.match(deleted.body.error, /Cancele as súmulas na aba Súmulas e Judges antes de excluir a prova/);

  const sheetId = rows('scoresheets')[0].id;
  await post(MANAGER, { action: 'review', sheetId, review: 'cancel', reason: 'Liberar a prova' });
  assert.equal((await persist(MANAGER, 'updateWorkout', { eventId: EVENT, workoutId: 'wod-fran', data: { structure: changed, time_cap: '12:00' } })).status, 200, 'sem súmula ativa, destrava');
});

test('trava: banco sem a migration da súmula não trava nada (tabela ausente conta como zero súmulas)', async (t) => {
  quiet(t);
  seed();
  missingTables = true;
  const changed = { ...FRAN, timeCapSeconds: 720 };
  assert.equal((await persist(MANAGER, 'updateWorkout', { eventId: EVENT, workoutId: 'wod-fran', data: { structure: changed, time_cap: '12:00' } })).status, 200);
  const unavailable = await get(JUDGE, { view: 'board', eventId: EVENT });
  assert.equal(unavailable.status, 503);
  assert.match(unavailable.body.error, /Aplique as migrations pendentes/);
});

test('lançamento manual por cima da súmula: muda a origem, entra no histórico e o ranking sai do que está gravado', async (t) => {
  quiet(t);
  seed();
  const sheetId = await publishedFran();
  // O painel do gestor abriu antes da súmula: manda Bruno 08:00 (sem mudança) e Caio 07:30 à mão, com ranks velhos.
  const manual = await persist(MANAGER, 'upsertScores', { scores: [
    { athlete_id: 'ath-bruno', workout_id: 'wod-fran', result: '08:00', value: 480, rank: 1, points: 1, splits: { tieBreaker: '04:00' } },
    { athlete_id: 'ath-caio', workout_id: 'wod-fran', result: '07:30', value: 450, rank: 1, points: 1, splits: {} }
  ] });
  assert.equal(manual.status, 200, manual.body.error);
  assert.equal(scoreOf('ath-caio').scoresheet_id, null, 'o resultado à mão não aponta mais para a súmula');
  assert.deepEqual([scoreOf('ath-caio').rank, scoreOf('ath-bruno').rank], [1, 2], 'ranking recalculado no servidor');
  const review = rows('scoresheet_reviews').at(-1);
  assert.deepEqual([review.sheet_id, review.action, review.previous_result, review.applied_result], [sheetId, 'manual_override', '09:41', '07:30']);

  // Sem súmula na prova, o lançamento manual segue exatamente como antes (sem coluna nova no payload).
  seed();
  const plain = await persist(MANAGER, 'upsertScores', { scores: [{ athlete_id: 'ath-ana', workout_id: 'wod-fran', result: '09:00', value: 540, rank: 2, points: 2, splits: {} }] });
  assert.equal(plain.status, 200);
  assert.equal('scoresheet_id' in scoreOf('ath-ana'), false);
  assert.equal(scoreOf('ath-ana').rank, 2, 'o rank do painel é gravado como veio');
});

// ---------------------------------------------------------------------------
// Judges em evento presencial (Story 1.49)
// ---------------------------------------------------------------------------

test('judges: o painel cria, atribui e remove judge em evento presencial pelas funções novas; Qualifier segue igual', async (t) => {
  quiet(t);
  seed();
  const created = await persist(MANAGER, 'createJudge', { eventId: EVENT, name: 'Judge Nova', email: 'nova@example.com', password: 'senha-forte-1' });
  assert.equal(created.status, 200, created.body.error);
  assert.equal(database.rpcCalls.at(-1).name, 'sheet_create_and_assign_judge');
  assert.equal(database.rpcCalls.at(-1).args.p_event_id, EVENT);
  assert.match(database.rpcCalls.at(-1).args.p_password_hash, /^scrypt\$/);
  await persist(MANAGER, 'assignJudgeToEvent', { eventId: EVENT, judgeId: JUDGE_FREE.id });
  assert.equal(database.rpcCalls.at(-1).name, 'sheet_assign_judge');
  await persist(MANAGER, 'removeJudgeFromEvent', { eventId: EVENT, judgeId: JUDGE.id });
  assert.equal(database.rpcCalls.at(-1).name, 'sheet_remove_judge');
  const listed = await persist(MANAGER, 'listJudges', { eventId: EVENT });
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.judges.map((judge) => judge.id).sort(), [JUDGE.id, JUDGE_2.id].sort());

  await persist(MANAGER, 'createJudge', { eventId: 'ev-qualifier', name: 'Judge Q', email: 'q@example.com', password: 'senha-forte-1' });
  assert.equal(database.rpcCalls.at(-1).name, 'qualifier_create_and_assign_judge');
  const race = await persist(MANAGER, 'createJudge', { eventId: 'ev-race', name: 'Judge R', email: 'r@example.com', password: 'senha-forte-1' });
  assert.equal(race.status, 400);
  assert.match(race.body.error, /Judges são exclusivos de eventos Functional Fitness/);
});

// ---------------------------------------------------------------------------
// Atleta ausente (Story 1.59)
// ---------------------------------------------------------------------------

// Fran: cap 10:00 + 90 repetições × 1 s = 11:30 (690 s).
const FRAN_ABSENT = { result: '11:30', value: 690 };
const reviewsOf = (sheetId) => rows('scoresheet_reviews').filter((review) => review.sheet_id === sheetId);
const sheetRow = (sheetId) => rows('scoresheets').find((row) => row.id === sheetId);
const markAbsent = (user, athleteId, extra = {}) => post(user, { action: 'mark_absent', eventId: EVENT, workoutId: 'wod-fran', athleteId, reason: 'Não compareceu à bateria', ...extra });

test('ausente (judge): súmula sem registro vira enviada e ausente, com o resultado do servidor, o selo e o ranking', async (t) => {
  quiet(t);
  seed();
  const sheetId = (await openFran()).body.sheet.id;
  // Resultado inventado no corpo é ignorado: o servidor calcula da estrutura.
  const marked = await post(JUDGE, { action: 'absent', sheetId, result: '01:00', value: 60, officialResult: '01:00' });
  assert.equal(marked.status, 200, marked.body.error);
  const { sheet } = marked.body;
  assert.deepEqual(
    [sheet.status, sheet.absent, sheet.computedResult, sheet.officialResult, sheet.officialTieBreak, sheet.corrected, sheet.returnReason, sheet.judgeUserId],
    ['submitted', true, '11:30', '11:30', null, false, null, JUDGE.id]
  );
  assert.equal(marked.body.summary, 'Atleta ausente · 11:30');
  assert.deepEqual(scoreOf('ath-caio'), {
    athlete_id: 'ath-caio', workout_id: 'wod-fran', result: '11:30', value: 690, splits: {}, scoresheet_id: sheetId, result_status: 'absent', rank: 2, points: 2
  });
  assert.deepEqual([scoreOf('ath-bruno').rank, scoreOf('ath-bruno').points], [1, 1]);
  assert.deepEqual(marked.body.ranking.find((score) => score.athleteId === 'ath-caio').resultStatus, 'absent');
  const stored = sheetRow(sheetId);
  assert.deepEqual([stored.absent, stored.official_value, stored.computed_value, Boolean(stored.submitted_at), Boolean(stored.published_at)], [true, 690, 690, true, true]);
  const absentReview = reviewsOf(sheetId).at(-1);
  assert.deepEqual(
    [absentReview.action, absentReview.actor_name, absentReview.actor_role, absentReview.reason, absentReview.previous_result, absentReview.applied_result],
    ['absent', 'Judge Rafa', 'judge', null, null, '11:30']
  );

  // Repetir: já enviada (409), sem duplicar o histórico.
  const again = await post(JUDGE, { action: 'absent', sheetId });
  assert.equal(again.status, 409);
  assert.equal(reviewsOf(sheetId).filter((review) => review.action === 'absent').length, 1);

  // O quadro (view=board) leva absent no resumo da súmula; o painel (view=manage), o selo nos scores.
  const board = await get(JUDGE, { view: 'board', eventId: EVENT });
  assert.equal(board.body.sheets.find((item) => item.id === sheetId).absent, true);
  const manage = await get(MANAGER, { view: 'manage', eventId: EVENT });
  assert.equal(manage.body.sheets.find((item) => item.id === sheetId).absent, true);
  assert.equal(manage.body.scores['wod-fran'].find((score) => score.athleteId === 'ath-caio').resultStatus, 'absent');
});

test('ausente (judge): só sem registro e só na própria súmula; devolvida sem registro aceita; carga máxima 0 kg', async (t) => {
  quiet(t);
  seed();
  const withRecord = (await openFran(JUDGE, 'ath-ana')).body.sheet.id;
  await post(JUDGE, { action: 'append', sheetId: withRecord, fromSeq: 0, events: [e({ t: 'rep', seg: 's1', at: 3 })] });
  const refused = await post(JUDGE, { action: 'absent', sheetId: withRecord });
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /já tem registros/);
  assert.equal(scoreOf('ath-ana'), undefined, 'nada é publicado');
  assert.equal(sheetRow(withRecord).status, 'in_progress');
  assert.equal(reviewsOf(withRecord).some((review) => review.action === 'absent'), false);

  const sheetId = (await openFran()).body.sheet.id;
  assert.equal((await post(JUDGE_2, { action: 'absent', sheetId })).status, 403, 'judge de outra súmula');
  assert.equal((await post(MANAGER, { action: 'absent', sheetId })).status, 403, 'o gestor usa a revisão, com motivo');
  assert.equal((await post(JUDGE, { action: 'absent', sheetId })).status, 200);

  // Devolvida (AUTO-DECISION 4: devolver não mexe em absent) e ainda sem registro: o judge pode marcar de novo.
  assert.equal((await post(MANAGER, { action: 'review', sheetId, review: 'return', reason: 'Conferir a chamada' })).status, 200);
  assert.equal(scoreOf('ath-caio').result_status, 'absent', 'o selo fica até o reenvio');
  const remarked = await post(JUDGE, { action: 'absent', sheetId });
  assert.equal(remarked.status, 200, remarked.body.error);
  assert.equal(remarked.body.sheet.returnReason, null);

  const totalId = (await post(JUDGE, { action: 'open', eventId: EVENT, workoutId: 'wod-total', athleteId: 'ath-ana' })).body.sheet.id;
  const total = await post(JUDGE, { action: 'absent', sheetId: totalId });
  assert.equal(total.status, 200, total.body.error);
  assert.deepEqual([scoreOf('ath-ana', 'wod-total').result, scoreOf('ath-ana', 'wod-total').value, scoreOf('ath-ana', 'wod-total').splits], ['0', 0, {}]);
  assert.equal(total.body.summary, 'Atleta ausente · 0 kg');
});

test('ausente sobre lançamento manual: substitui e o histórico guarda o antes', async (t) => {
  quiet(t);
  seed();
  const sheetId = (await post(JUDGE, { action: 'open', eventId: EVENT, workoutId: 'wod-fran', athleteId: 'ath-bruno' })).body.sheet.id;
  assert.equal((await post(JUDGE, { action: 'absent', sheetId })).status, 200);
  assert.deepEqual([scoreOf('ath-bruno').result, scoreOf('ath-bruno').scoresheet_id, scoreOf('ath-bruno').result_status], ['11:30', sheetId, 'absent']);
  const review = reviewsOf(sheetId).at(-1);
  assert.deepEqual(
    [review.action, review.reason, review.previous_result, review.previous_value, review.previous_tie_break, review.applied_result],
    ['absent', 'Substituiu um resultado lançado à mão.', '08:00', 480, '04:00', '11:30']
  );
});

test('ausente (gestor, review absent): motivo, permissões, estados; judge mantido; enviada com resultado real guarda o substituído', async (t) => {
  quiet(t);
  seed();
  const sheetId = (await openFran()).body.sheet.id;
  await post(JUDGE, { action: 'append', sheetId, fromSeq: 0, events: [e({ t: 'rep', seg: 's1', at: 3 }), e({ t: 'rep', seg: 's1', at: 5 })] });
  assert.equal((await post(MANAGER, { action: 'review', sheetId, review: 'absent', reason: '' })).status, 400, 'motivo obrigatório');
  assert.equal((await post(MANAGER, { action: 'review', sheetId, review: 'absent', reason: 'x'.repeat(501) })).status, 400);
  assert.equal((await post(JUDGE, { action: 'review', sheetId, review: 'absent', reason: 'Não veio' })).status, 403);
  assert.equal((await post(OTHER_MANAGER, { action: 'review', sheetId, review: 'absent', reason: 'Não veio' })).status, 403);
  assert.equal((await post(ATHLETE_USER, { action: 'review', sheetId, review: 'absent', reason: 'Não veio' })).status, 403);

  // Em andamento e com registro: aceita (o gestor não exige log vazio).
  const marked = await post(MANAGER, { action: 'review', sheetId, review: 'absent', reason: 'Atleta não se apresentou', result: '00:10' });
  assert.equal(marked.status, 200, marked.body.error);
  assert.deepEqual([marked.body.sheet.absent, marked.body.sheet.officialResult, marked.body.sheet.judgeUserId, marked.body.sheet.judgeName], [true, '11:30', JUDGE.id, 'Judge Rafa']);
  assert.equal(scoreOf('ath-caio').result_status, 'absent');
  assert.equal(rows('scoresheet_events').length, 2, 'o log do judge fica');
  const review = reviewsOf(sheetId).at(-1);
  assert.deepEqual([review.action, review.actor_name, review.actor_role, review.reason], ['absent', 'Gestora Quadra', 'manager', 'Atleta não se apresentou']);
  const again = await post(MANAGER, { action: 'review', sheetId, review: 'absent', reason: 'De novo' });
  assert.equal(again.status, 409);
  assert.match(again.body.error, /já está marcado como ausente/);

  // Enviada com resultado real (decisão 14): o owner marca e o histórico guarda o 09:41.
  const anaId = (await openFran(JUDGE, 'ath-ana')).body.sheet.id;
  await post(JUDGE, { action: 'append', sheetId: anaId, fromSeq: 0, events: franRun() });
  assert.equal((await post(JUDGE, { action: 'submit', sheetId: anaId, expectedCount: 6 })).status, 200);
  const byOwner = await post(OWNER, { action: 'review', sheetId: anaId, review: 'absent', reason: 'Trocou de bateria sem avisar' });
  assert.equal(byOwner.status, 200, byOwner.body.error);
  const ownerReview = reviewsOf(anaId).at(-1);
  assert.deepEqual([ownerReview.action, ownerReview.actor_role, ownerReview.previous_result, ownerReview.applied_result], ['absent', 'owner', '09:41', '11:30']);

  // Cancelada: 409.
  const brunoId = (await post(JUDGE, { action: 'open', eventId: EVENT, workoutId: 'wod-fran', athleteId: 'ath-bruno' })).body.sheet.id;
  await post(MANAGER, { action: 'review', sheetId: brunoId, review: 'cancel', reason: 'Aberta por engano' });
  assert.equal((await post(MANAGER, { action: 'review', sheetId: brunoId, review: 'absent', reason: 'Não veio' })).status, 409);
});

test('recálculo: um segundo ausente muda os pontos do primeiro', async (t) => {
  quiet(t);
  seed();
  const caioId = (await openFran()).body.sheet.id;
  await post(JUDGE, { action: 'absent', sheetId: caioId });
  const anaId = (await openFran(JUDGE, 'ath-ana')).body.sheet.id;
  await post(JUDGE, { action: 'append', sheetId: anaId, fromSeq: 0, events: franRun() });
  await post(JUDGE, { action: 'submit', sheetId: anaId, expectedCount: 6 });
  assert.deepEqual([scoreOf('ath-bruno').points, scoreOf('ath-ana').points, scoreOf('ath-caio').points], [1, 2, 3]);
  assert.equal((await post(MANAGER, { action: 'review', sheetId: anaId, review: 'absent', reason: 'Resultado era de outra atleta' })).status, 200);
  assert.deepEqual([scoreOf('ath-bruno').points, scoreOf('ath-ana').points, scoreOf('ath-caio').points], [1, 2, 2], 'os ausentes dividem a última posição');
});

test('AC13 mark_absent: cria a súmula já enviada e ausente, sem judge, na bateria e raia do cronograma', async (t) => {
  quiet(t);
  seed();
  const marked = await markAbsent(MANAGER, 'ath-ana', { result: '00:30', value: 30 });
  assert.equal(marked.status, 200, marked.body.error);
  const sheetId = marked.body.sheet.id;
  const stored = sheetRow(sheetId);
  assert.deepEqual(
    [stored.status, stored.absent, stored.judge_user_id, stored.judge_name, stored.heat_id, stored.heat_number, stored.lane, stored.division_id],
    ['submitted', true, null, 'Gestora Quadra', 'heat-1', 1, 3, 'div-rx']
  );
  assert.deepEqual(stored.structure, FRAN);
  assert.deepEqual(
    [stored.computed_result, stored.computed_value, stored.official_result, stored.official_value, stored.official_tie_break, Boolean(stored.submitted_at), Boolean(stored.published_at)],
    ['11:30', 690, '11:30', 690, null, true, true]
  );
  assert.equal(rows('scoresheet_events').filter((event) => event.sheet_id === sheetId).length, 0, 'nenhum registro no log');
  assert.deepEqual(scoreOf('ath-ana'), {
    athlete_id: 'ath-ana', workout_id: 'wod-fran', result: '11:30', value: 690, splits: {}, scoresheet_id: sheetId, result_status: 'absent', rank: 2, points: 2
  });
  assert.deepEqual(reviewsOf(sheetId).map((review) => [review.action, review.actor_name, review.actor_role, review.reason, review.applied_result]), [
    ['absent', 'Gestora Quadra', 'manager', 'Não compareceu à bateria', '11:30']
  ]);
  assert.equal(marked.body.summary, 'Atleta ausente · 11:30');

  // De novo: já ausente (409), continua uma súmula só.
  assert.equal((await markAbsent(MANAGER, 'ath-ana')).status, 409);
  assert.equal(rows('scoresheets').filter((row) => row.athlete_id === 'ath-ana').length, 1);

  // Fora de qualquer bateria da prova: súmula sem bateria. O owner pode.
  const bruno = await markAbsent(OWNER, 'ath-bruno');
  assert.equal(bruno.status, 200, bruno.body.error);
  assert.deepEqual([sheetRow(bruno.body.sheet.id).heat_id, sheetRow(bruno.body.sheet.id).lane, sheetRow(bruno.body.sheet.id).judge_name], [null, null, 'Owner']);
  assert.equal(reviewsOf(bruno.body.sheet.id)[0].actor_role, 'owner');
});

test('AC13 mark_absent: validações e recusas (motivo, papéis, gestor expirado, bateria, atleta, prova, categoria, tipo de evento)', async (t) => {
  quiet(t);
  seed();
  database.rows('divisions').push({ id: 'div-fem', event_id: EVENT, name: 'RX Feminino' });
  database.rows('workouts').push({ id: 'wod-fem', event_id: EVENT, name: 'Fran Fem', code: 'W4', order_index: 4, type: 'fortime', time_cap: '10:00', tie_breaker: '', division_id: 'div-fem', structure: FRAN });
  const before = database.snapshot();
  const expectStatus = async (promise, status, pattern) => {
    const response = await promise;
    assert.equal(response.status, status, JSON.stringify(response.body));
    if (pattern) assert.match(response.body.error, pattern);
  };
  await expectStatus(markAbsent(MANAGER, 'ath-ana', { reason: 'ok' }), 400, /motivo/);
  await expectStatus(markAbsent(JUDGE, 'ath-ana'), 403);
  await expectStatus(markAbsent(ATHLETE_USER, 'ath-ana'), 403);
  await expectStatus(markAbsent(OTHER_MANAGER, 'ath-ana'), 403);
  await expectStatus(markAbsent(MANAGER, 'ath-ana', { heatId: 'nao-existe' }), 400, /Bateria não encontrada/);
  await expectStatus(markAbsent(MANAGER, 'ath-caio', { heatId: 'heat-text' }), 400, /Bateria não encontrada/);
  await expectStatus(markAbsent(MANAGER, 'ath-fora'), 400, /não pertence ao evento/);
  await expectStatus(post(MANAGER, { action: 'mark_absent', eventId: EVENT, workoutId: 'wod-texto', athleteId: 'ath-caio', reason: 'Não veio' }), 404);
  await expectStatus(post(MANAGER, { action: 'mark_absent', eventId: EVENT, workoutId: 'wod-fem', athleteId: 'ath-caio', reason: 'Não veio' }), 400, /outra categoria/);
  await expectStatus(post(MANAGER, { action: 'mark_absent', eventId: 'ev-qualifier', workoutId: 'wod-fran', athleteId: 'ath-caio', reason: 'Não veio' }), 400);
  await expectStatus(post(MANAGER, { action: 'mark_absent', eventId: 'ev-race', workoutId: 'wod-fran', athleteId: 'ath-caio', reason: 'Não veio' }), 400);
  assert.deepEqual(database.snapshot(), before, 'nenhuma recusa grava');

  database.rows('users').find((user) => user.id === MANAGER.id).service_valid_until = '2020-01-01';
  await expectStatus(markAbsent(MANAGER, 'ath-ana'), 403, /expirou/);
});

test('AC13 mark_absent: súmula existente segue o caminho do AC6; só cancelada cria nova; corrida do índice único', async (t) => {
  quiet(t);
  seed();
  const openId = (await openFran()).body.sheet.id;
  const onExisting = await markAbsent(MANAGER, 'ath-caio');
  assert.equal(onExisting.status, 200, onExisting.body.error);
  assert.equal(onExisting.body.sheet.id, openId);
  assert.equal(sheetRow(openId).judge_user_id, JUDGE.id, 'o judge original fica');
  assert.equal(rows('scoresheets').filter((row) => row.athlete_id === 'ath-caio' && row.status !== 'cancelled').length, 1);

  const cancelledId = (await openFran(JUDGE, 'ath-ana')).body.sheet.id;
  await post(MANAGER, { action: 'review', sheetId: cancelledId, review: 'cancel', reason: 'Aberta por engano' });
  const fresh = await markAbsent(MANAGER, 'ath-ana');
  assert.equal(fresh.status, 200, fresh.body.error);
  assert.notEqual(fresh.body.sheet.id, cancelledId);
  assert.equal(fresh.body.sheet.judgeUserId, null);

  // Um judge abre a súmula de Bruno entre a leitura e a gravação do gestor.
  database.onceBeforeInsert('scoresheets', (db) => {
    db.rows('scoresheets').push({
      id: 'sheet-corrida', event_id: EVENT, workout_id: 'wod-fran', athlete_id: 'ath-bruno', division_id: 'div-rx', heat_id: null, heat_number: null, lane: null,
      judge_user_id: JUDGE_2.id, judge_name: JUDGE_2.name, structure: FRAN, status: 'in_progress',
      computed_result: null, computed_value: null, computed_tie_break: null, official_result: null, official_value: null, official_tie_break: null,
      corrected: false, return_reason: null, submitted_at: null, published_at: null, created_at: '2026-11-01T10:00:00.000Z', updated_at: '2026-11-01T10:00:00.000Z'
    });
  });
  const raced = await markAbsent(MANAGER, 'ath-bruno');
  assert.equal(raced.status, 200, raced.body.error);
  assert.equal(raced.body.sheet.id, 'sheet-corrida');
  assert.deepEqual([raced.body.sheet.absent, raced.body.sheet.judgeUserId], [true, JUDGE_2.id]);
  assert.equal(rows('scoresheets').filter((row) => row.athlete_id === 'ath-bruno').length, 1);
});

test('devolver e assumir: o judge do evento assume a súmula sem judge; gestor e owner só leem; judge apagado também', async (t) => {
  quiet(t);
  seed();
  const sheetId = (await markAbsent(MANAGER, 'ath-ana')).body.sheet.id;
  assert.equal((await post(MANAGER, { action: 'review', sheetId, review: 'return', reason: 'Ela chegou atrasada e competiu' })).status, 200);
  assert.equal(scoreOf('ath-ana').result_status, 'absent', 'o resultado ausente fica até o reenvio');

  const asManager = await openFran(MANAGER, 'ath-ana');
  assert.equal(asManager.status, 200, asManager.body.error);
  assert.equal(asManager.body.sheet.judgeUserId, null, 'o gestor não assume');
  assert.equal((await post(MANAGER, { action: 'append', sheetId, fromSeq: 0, events: [e({ t: 'rep', seg: 's1', at: 3 })] })).status, 403);
  assert.equal((await openFran(OWNER, 'ath-ana')).body.sheet.judgeUserId, null, 'o owner não assume');
  assert.equal((await post(OWNER, { action: 'submit', sheetId, expectedCount: 0 })).status, 403);
  assert.equal((await openFran(JUDGE_OTHER, 'ath-ana')).status, 403, 'judge de outro evento');
  assert.equal(sheetRow(sheetId).judge_user_id, null);

  const claimed = await openFran(JUDGE_2, 'ath-ana');
  assert.equal(claimed.status, 200, claimed.body.error);
  assert.deepEqual([claimed.body.sheet.id, claimed.body.sheet.judgeUserId, claimed.body.sheet.judgeName], [sheetId, JUDGE_2.id, 'Judge Paula']);
  assert.deepEqual([sheetRow(sheetId).judge_user_id, reviewsOf(sheetId).at(-1).action, reviewsOf(sheetId).at(-1).actor_name], [JUDGE_2.id, 'opened', 'Judge Paula']);
  const late = await openFran(JUDGE, 'ath-ana');
  assert.equal(late.status, 409);
  assert.match(late.body.error, /Esta súmula está com Judge Paula/);

  // A nova dona grava e reenvia do jeito normal: o selo sai.
  await post(JUDGE_2, { action: 'append', sheetId, fromSeq: 0, events: franRun() });
  const resubmitted = await post(JUDGE_2, { action: 'submit', sheetId, expectedCount: 6 });
  assert.equal(resubmitted.status, 200, resubmitted.body.error);
  assert.deepEqual([scoreOf('ath-ana').result, scoreOf('ath-ana').result_status, sheetRow(sheetId).absent, resubmitted.body.sheet.absent], ['09:41', null, false, false]);

  // Súmula cujo judge foi apagado (ON DELETE SET NULL): assumida do mesmo jeito.
  const orphanId = (await openFran()).body.sheet.id;
  database.rows('scoresheets').find((row) => row.id === orphanId).judge_user_id = null;
  const adopted = await openFran(JUDGE_2);
  assert.equal(adopted.status, 200, adopted.body.error);
  assert.deepEqual([adopted.body.sheet.id, adopted.body.sheet.judgeUserId], [orphanId, JUDGE_2.id]);
});

test('desfazer: corrigir tira o selo; lançamento manual que muda tira, com o mesmo valor mantém; cancelar libera outra', async (t) => {
  quiet(t);
  seed();
  const caioId = (await openFran()).body.sheet.id;
  await post(JUDGE, { action: 'absent', sheetId: caioId });
  const anaId = (await markAbsent(MANAGER, 'ath-ana')).body.sheet.id;

  // Lançamento manual com o mesmo valor (o painel manda a categoria inteira): nada muda e o selo fica.
  const same = await persist(MANAGER, 'upsertScores', { scores: [
    { athlete_id: 'ath-bruno', workout_id: 'wod-fran', result: '08:00', value: 480, rank: 1, points: 1, splits: { tieBreaker: '04:00' } },
    { athlete_id: 'ath-caio', workout_id: 'wod-fran', result: '11:30', value: 690, rank: 2, points: 2, splits: {} },
    { athlete_id: 'ath-ana', workout_id: 'wod-fran', result: '11:30', value: 690, rank: 2, points: 2, splits: {} }
  ] });
  assert.equal(same.status, 200, same.body.error);
  assert.deepEqual([scoreOf('ath-caio').result_status, scoreOf('ath-caio').scoresheet_id, sheetRow(caioId).absent], ['absent', caioId, true]);
  assert.equal(reviewsOf(caioId).some((review) => review.action === 'manual_override'), false);

  // Caio muda à mão: perde o selo e a origem; Ana (mesmo lote, sem mudança) continua ausente.
  const changed = await persist(MANAGER, 'upsertScores', { scores: [
    { athlete_id: 'ath-bruno', workout_id: 'wod-fran', result: '08:00', value: 480, rank: 1, points: 1, splits: { tieBreaker: '04:00' } },
    { athlete_id: 'ath-caio', workout_id: 'wod-fran', result: '10:00', value: 600, rank: 2, points: 2, splits: {} },
    { athlete_id: 'ath-ana', workout_id: 'wod-fran', result: '11:30', value: 690, rank: 3, points: 3, splits: {} }
  ] });
  assert.equal(changed.status, 200, changed.body.error);
  assert.deepEqual([scoreOf('ath-caio').result_status, scoreOf('ath-caio').scoresheet_id, sheetRow(caioId).absent], [null, null, false]);
  assert.deepEqual([scoreOf('ath-ana').result_status, scoreOf('ath-ana').scoresheet_id, sheetRow(anaId).absent], ['absent', anaId, true]);
  assert.deepEqual([reviewsOf(caioId).at(-1).action, reviewsOf(caioId).at(-1).previous_result, reviewsOf(caioId).at(-1).applied_result], ['manual_override', '11:30', '10:00']);
  assert.deepEqual([scoreOf('ath-bruno').rank, scoreOf('ath-caio').rank, scoreOf('ath-ana').rank], [1, 2, 3]);

  // Corrigir tira o selo.
  const corrected = await post(MANAGER, { action: 'review', sheetId: anaId, review: 'correct', reason: 'Ela competiu na bateria 2', result: '9:10' });
  assert.equal(corrected.status, 200, corrected.body.error);
  assert.deepEqual([scoreOf('ath-ana').result, scoreOf('ath-ana').result_status, sheetRow(anaId).absent, corrected.body.sheet.absent], ['09:10', null, false, false]);

  // Cancelar uma súmula ausente tira do ranking e libera abrir outra.
  const brunoId = (await markAbsent(MANAGER, 'ath-bruno')).body.sheet.id;
  assert.equal((await post(MANAGER, { action: 'review', sheetId: brunoId, review: 'cancel', reason: 'Marcado por engano' })).status, 200);
  assert.equal(scoreOf('ath-bruno'), undefined);
  const reopened = await post(JUDGE, { action: 'open', eventId: EVENT, workoutId: 'wod-fran', athleteId: 'ath-bruno' });
  assert.equal(reopened.status, 200);
  assert.notEqual(reopened.body.sheet.id, brunoId);
});

test('sem a migration da coluna absent: o resto segue igual e só as ações de ausência respondem 503, sem gravar', async (t) => {
  quiet(t);
  seed();
  missingAbsent = true;
  const opened = await openFran();
  assert.equal(opened.status, 200, opened.body.error);
  assert.equal(opened.body.sheet.absent, false);
  const sheetId = opened.body.sheet.id;
  assert.equal((await post(JUDGE, { action: 'append', sheetId, fromSeq: 0, events: franRun() })).status, 200);
  assert.equal((await post(JUDGE, { action: 'submit', sheetId, expectedCount: 6 })).status, 200);
  assert.equal((await get(JUDGE, { view: 'board', eventId: EVENT })).status, 200);
  assert.equal((await get(JUDGE, { view: 'sheet', sheetId })).status, 200);
  const manage = await get(MANAGER, { view: 'manage', eventId: EVENT });
  assert.equal(manage.status, 200, manage.body.error);
  assert.equal(manage.body.sheets[0].absent, false);
  assert.equal((await post(MANAGER, { action: 'review', sheetId, review: 'return', reason: 'Conferir' })).status, 200);
  assert.equal((await post(MANAGER, { action: 'review', sheetId, review: 'correct', reason: 'Cronômetro', result: '09:40' })).status, 200);
  assert.equal((await persist(MANAGER, 'upsertScores', { scores: [{ athlete_id: 'ath-caio', workout_id: 'wod-fran', result: '09:30', value: 570, rank: 1, points: 1, splits: {} }] })).status, 200);

  const anaId = (await openFran(JUDGE, 'ath-ana')).body.sheet.id;
  const before = database.snapshot();
  const expectPending = (response) => {
    assert.equal(response.status, 503, JSON.stringify(response.body));
    assert.match(response.body.error, /20261021120000_scoresheet_absent\.sql/);
    assert.doesNotMatch(response.body.error, /A súmula digital ainda não está disponível/);
  };
  expectPending(await post(JUDGE, { action: 'absent', sheetId: anaId }));
  expectPending(await post(MANAGER, { action: 'review', sheetId: anaId, review: 'absent', reason: 'Não veio' }));
  expectPending(await markAbsent(MANAGER, 'ath-bruno'));
  assert.deepEqual(database.snapshot(), before, 'nada é gravado');
  assert.equal((await post(MANAGER, { action: 'review', sheetId: anaId, review: 'cancel', reason: 'Liberar' })).status, 200, 'cancelar segue');
});

test('AC14: ausência só naquela prova (exemplo do README, L ausente na prova 1 e 5º na prova 2 → 17 pontos)', async (t) => {
  quiet(t);
  const { computeDivisionStandings } = await importServerModule('lib/leaderboardStandings.ts');
  const { rankWorkoutScores } = await importServerModule('lib/scoring.ts');
  const ids = [...'ABCDEFGHIJKLMN'];
  const PROVA1 = validateWorkoutStructure({
    version: 2, format: 'for_time', totalReps: 150, timeCapSeconds: 720,
    incomplete: { rule: 'penalty_per_rep', secondsPerRep: 1, base: 'time_cap' }, tieBreak: null, generator: null, customized: true,
    entry: { mode: 'both', marking: 'reps', publish: 'after_review' },
    segments: [segment('p1', 1, 'Wall ball', 50), segment('p2', 1, 'Pull-up', 50), segment('p3', 1, 'Burpee', 50)],
    maxLoad: null, scoreDisplay: null
  }).structure;
  const real1 = { A: 522, B: 555, C: 598, D: 620, E: 620, F: 647, G: 665, H: 699, I: 718, J: 728, K: 750 };
  // Prova 2: 4 atletas à frente de L (09:41 = 581 s), 9 atrás.
  const real2 = { A: 500, B: 520, C: 540, D: 560, E: 600, F: 610, G: 620, H: 630, I: 640, J: 650, K: 660, M: 670, N: 680 };
  const mmss = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  seed();
  database = createFakeSupabase({
    users: [MANAGER, JUDGE],
    events: [{ id: 'ev-14', name: 'Exemplo', date: '2026-11-01', location: 'Recife', organizer_id: MANAGER.id, event_type: 'functional_fitness', status: 'upcoming',
      event_schedule: [
        { id: 'h1', kind: 'heat', workoutId: 'w1', heatNumber: 1, athleteIds: ids },
        { id: 'h2', kind: 'heat', workoutId: 'w2', heatNumber: 2, athleteIds: ids }
      ] }],
    event_judges: [{ event_id: 'ev-14', judge_user_id: JUDGE.id }],
    divisions: [{ id: 'd14', event_id: 'ev-14', name: 'RX' }],
    athletes: ids.map((id) => ({ id, name: `Atleta ${id}`, box: 'Box', division_id: 'd14' })),
    workouts: [
      { id: 'w1', event_id: 'ev-14', name: 'Prova 1', code: 'W1', order_index: 1, type: 'fortime', time_cap: '12:00', tie_breaker: '', division_id: null, structure: PROVA1 },
      { id: 'w2', event_id: 'ev-14', name: 'Prova 2', code: 'W2', order_index: 2, type: 'fortime', time_cap: '10:00', tie_breaker: '', division_id: null, structure: FRAN }
    ],
    scores: [
      ...Object.entries(real1).map(([id, value]) => ({ athlete_id: id, workout_id: 'w1', result: mmss(value), value, rank: null, points: null, splits: {} })),
      ...['M', 'N'].map((id) => ({ athlete_id: id, workout_id: 'w1', result: '14:30', value: 870, rank: null, points: null, splits: {}, result_status: 'absent' })),
      ...Object.entries(real2).map(([id, value]) => ({ athlete_id: id, workout_id: 'w2', result: mmss(value), value, rank: null, points: null, splits: {} }))
    ],
    registrations: []
  });
  const prova2Before = rankWorkoutScores('fortime', '', [...Object.entries(real2).map(([id, value]) => ({ athleteId: id, result: mmss(value), value, splits: {} })), { athleteId: 'L', result: '09:41', value: 581, splits: {} }], 14);

  const sheet1 = (await post(JUDGE, { action: 'open', eventId: 'ev-14', workoutId: 'w1', athleteId: 'L', heatId: 'h1', lane: 12 })).body.sheet.id;
  const marked = await post(JUDGE, { action: 'absent', sheetId: sheet1 });
  assert.equal(marked.status, 200, marked.body.error);
  assert.equal(marked.body.sheet.officialResult, '14:30');

  // O quadro continua listando L na bateria da prova 2, e a súmula dela abre normalmente.
  const board = await get(JUDGE, { view: 'board', eventId: 'ev-14' });
  assert.ok(board.body.heats.find((heat) => heat.workoutId === 'w2').lanes.some((lane) => lane.athleteId === 'L'));
  assert.deepEqual(board.body.sheets.map((sheet) => [sheet.workoutId, sheet.absent]), [['w1', true]]);
  const sheet2 = await post(JUDGE, { action: 'open', eventId: 'ev-14', workoutId: 'w2', athleteId: 'L', heatId: 'h2', lane: 12 });
  assert.equal(sheet2.status, 200, sheet2.body.error);
  await post(JUDGE, { action: 'append', sheetId: sheet2.body.sheet.id, fromSeq: 0, events: franRun() });
  assert.equal((await post(JUDGE, { action: 'submit', sheetId: sheet2.body.sheet.id, expectedCount: 6 })).status, 200);

  const scores = rows('scores').map((row) => ({
    athleteId: row.athlete_id, workoutId: row.workout_id, result: row.result, value: Number(row.value), rank: row.rank ?? undefined, points: row.points ?? undefined,
    splits: row.splits || {}, resultStatus: row.result_status || undefined
  }));
  const L1 = scores.find((score) => score.athleteId === 'L' && score.workoutId === 'w1');
  const L2 = scores.find((score) => score.athleteId === 'L' && score.workoutId === 'w2');
  assert.deepEqual([L1.rank, L1.points, L1.resultStatus], [12, 12, 'absent']);
  assert.deepEqual([L2.rank, L2.points, L2.resultStatus], [5, 5, undefined], 'o selo fica só na prova 1');
  for (const id of ['M', 'N']) assert.equal(scores.find((score) => score.athleteId === id && score.workoutId === 'w1').points, 12);
  for (const expected of prova2Before.filter((score) => score.athleteId !== 'L')) {
    assert.equal(scores.find((score) => score.athleteId === expected.athleteId && score.workoutId === 'w2').points, expected.points, expected.athleteId);
  }
  const standings = computeDivisionStandings({
    event: { date: '2026-11-01', eventType: 'functional_fitness', workouts: [
      { id: 'w1', name: 'Prova 1', description: '', type: 'fortime', code: 'W1', orderIndex: 1 },
      { id: 'w2', name: 'Prova 2', description: '', type: 'fortime', code: 'W2', orderIndex: 2 }
    ] },
    divisionId: 'd14',
    divisionAthletes: ids.map((id) => ({ id, name: `Atleta ${id}`, box: 'Box', country: 'BR', divisionId: 'd14' })),
    scores
  });
  assert.equal(standings.find((item) => item.athlete.id === 'L').totalPoints, 17);
});

// ---------------------------------------------------------------------------
// Story 1.60: Intervalado pelo caminho real (caso aprovado do README: A 23, B e C 40, D ausente)
// ---------------------------------------------------------------------------

test('intervalado: abrir, gravar (com um registro fora da janela) e enviar publica as repetições; ausente 0; posições 1, 1, 3, 4', async (t) => {
  quiet(t);
  const fixedSegment = (id, name, reps) => ({ ...segment(id, 1, name, reps) });
  const INTERVAL = validateWorkoutStructure({
    version: 3, format: 'interval', totalReps: 21, timeCapSeconds: 1080, incomplete: null, tieBreak: null, generator: null, customized: true,
    entry: { mode: 'both', marking: 'reps', publish: 'after_review' },
    segments: [fixedSegment('f1', 'Ring Muscle Up', 6), fixedSegment('f2', 'Box Jump Over', 15)],
    maxLoad: null, scoreDisplay: null,
    interval: { rounds: 5, onSeconds: 120, offSeconds: 120, max: { id: 'mx', name: 'Squat Clean', load: { value: 80, unit: 'kg' }, note: '' } }
  }).structure;
  const athletes = ['A', 'B', 'C', 'D'];
  seed();
  database = createFakeSupabase({
    users: [MANAGER, JUDGE],
    events: [{ id: 'ev-int', name: 'Intervalado', date: '2026-11-01', location: 'Recife', organizer_id: MANAGER.id, event_type: 'functional_fitness', status: 'upcoming',
      event_schedule: [{ id: 'h-int', kind: 'heat', workoutId: 'wod-int', heatNumber: 1, athleteIds: athletes }] }],
    event_judges: [{ event_id: 'ev-int', judge_user_id: JUDGE.id }],
    divisions: [{ id: 'd-int', event_id: 'ev-int', name: 'RX' }],
    athletes: athletes.map((id) => ({ id, name: `Atleta ${id}`, box: 'Box', division_id: 'd-int' })),
    workouts: [{ id: 'wod-int', event_id: 'ev-int', name: 'Intervalado', code: 'W1', order_index: 1, type: 'reps', time_cap: '18:00', tie_breaker: '', division_id: null, structure: INTERVAL }],
    scores: [],
    registrations: []
  });

  const roundLog = (index, maxReps, f2 = 15) => {
    const start = index * 240;
    return [
      e({ t: 'fill', seg: 'f1', n: 6, at: start + 15 }),
      e({ t: 'fill', seg: 'f2', n: f2, at: start + 45 }),
      ...Array.from({ length: maxReps }, (_, k) => e({ t: 'rep', seg: 'mx', at: start + 50 + k * 5 }))
    ];
  };
  const logs = {
    // Round 5 de A com Box Jump Overs 11/15 (3 Squat Cleans que não contam) e um toque no descanso do round 1.
    A: [...[9, 8, 5, 1].flatMap((max, index) => roundLog(index, max)), ...roundLog(4, 3, 11), e({ t: 'rep', seg: 'mx', at: 130 })],
    B: [10, 9, 8, 7, 6].flatMap((max, index) => roundLog(index, max)),
    C: [8, 8, 8, 8, 8].flatMap((max, index) => roundLog(index, max))
  };
  const open = (athleteId, lane) => post(JUDGE, { action: 'open', eventId: 'ev-int', workoutId: 'wod-int', athleteId, heatId: 'h-int', lane });

  const openedA = await open('A', 1);
  assert.equal(openedA.status, 200, openedA.body.error);
  assert.deepEqual(openedA.body.sheet.structure, INTERVAL, 'a súmula guarda a cópia da estrutura v3');
  const sheetA = openedA.body.sheet.id;
  const appended = await post(JUDGE, { action: 'append', sheetId: sheetA, fromSeq: 0, events: logs.A });
  assert.deepEqual(appended.body, { count: logs.A.length });
  assert.equal(rows('scoresheet_events').filter((row) => row.sheet_id === sheetA).length, logs.A.length, 'o registro fora da janela fica no log');
  // Correção no intervalado exige o round.
  const noRound = await post(JUDGE, { action: 'append', sheetId: sheetA, fromSeq: logs.A.length, events: [e({ t: 'set', seg: 'mx', v: 1, at: 1100 })] });
  assert.equal(noRound.status, 400);
  assert.match(noRound.body.error, /informe o round da correção \(de 1 a 5\)/);
  const timeRefused = await post(JUDGE, { action: 'append', sheetId: sheetA, fromSeq: logs.A.length, events: [e({ t: 'time', target: 'final', v: 600, at: 1100 })] });
  assert.equal(timeRefused.status, 400);
  assert.match(timeRefused.body.error, /o ajuste do tempo não vale para esta prova/);

  const submittedA = await post(JUDGE, { action: 'submit', sheetId: sheetA, expectedCount: logs.A.length });
  assert.equal(submittedA.status, 200, submittedA.body.error);
  assert.deepEqual([submittedA.body.sheet.officialResult, submittedA.body.sheet.officialTieBreak, submittedA.body.summary], ['23', null, '23 repetições em 5 rounds (4 pontuaram)']);
  assert.deepEqual(scoreOf('A', 'wod-int'), { athlete_id: 'A', workout_id: 'wod-int', result: '23', value: 23, splits: {}, scoresheet_id: sheetA, result_status: null, rank: 1, points: 1 });

  for (const [athleteId, lane] of [['B', 2], ['C', 3]]) {
    const sheetId = (await open(athleteId, lane)).body.sheet.id;
    await post(JUDGE, { action: 'append', sheetId, fromSeq: 0, events: logs[athleteId] });
    const submitted = await post(JUDGE, { action: 'submit', sheetId, expectedCount: logs[athleteId].length });
    assert.equal(submitted.status, 200, submitted.body.error);
    assert.deepEqual([scoreOf(athleteId, 'wod-int').result, scoreOf(athleteId, 'wod-int').value, scoreOf(athleteId, 'wod-int').result_status], ['40', 40, null]);
  }

  const sheetD = (await open('D', 4)).body.sheet.id;
  const absent = await post(JUDGE, { action: 'absent', sheetId: sheetD });
  assert.equal(absent.status, 200, absent.body.error);
  assert.deepEqual([absent.body.sheet.officialResult, absent.body.sheet.absent], ['0', true]);
  assert.deepEqual([scoreOf('D', 'wod-int').result, scoreOf('D', 'wod-int').value, scoreOf('D', 'wod-int').result_status, scoreOf('D', 'wod-int').splits], ['0', 0, 'absent', {}]);

  // Ranking e pontos recalculados pelo caminho existente (tipo legado reps, "maior vence", sem desempate).
  assert.deepEqual(
    Object.fromEntries(athletes.map((id) => [id, [scoreOf(id, 'wod-int').rank, scoreOf(id, 'wod-int').points]])),
    { A: [3, 3], B: [1, 1], C: [1, 1], D: [4, 4] }
  );
});

// ---------------------------------------------------------------------------
// Story 1.66: Distância pelo caminho real (caso aprovado do README: A e B 6330, C 5915, D ausente)
// ---------------------------------------------------------------------------

test('distância: abrir, gravar o total (o último vale) e enviar publica os metros; sem lançamento é recusado; ausente 0 m; posições 1, 1, 3, 4', async (t) => {
  quiet(t);
  const DISTANCE = validateWorkoutStructure({
    version: 4, format: 'distance', totalReps: 0, timeCapSeconds: 1200, incomplete: null, tieBreak: null, generator: null, customized: true,
    entry: { mode: 'both', marking: 'reps', publish: 'after_review' },
    segments: [], maxLoad: null, scoreDisplay: null, interval: null,
    distance: { unit: 'm', note: '750 m corrida; máx. distância no remo.' }
  }).structure;
  const athletes = ['A', 'B', 'C', 'D', 'E'];
  seed();
  database = createFakeSupabase({
    users: [MANAGER, JUDGE],
    events: [{ id: 'ev-dist', name: 'Distância', date: '2026-11-01', location: 'Recife', organizer_id: MANAGER.id, event_type: 'functional_fitness', status: 'upcoming',
      event_schedule: [{ id: 'h-dist', kind: 'heat', workoutId: 'wod-dist', heatNumber: 1, athleteIds: athletes }] }],
    event_judges: [{ event_id: 'ev-dist', judge_user_id: JUDGE.id }],
    divisions: [{ id: 'd-dist', event_id: 'ev-dist', name: 'RX' }],
    athletes: athletes.map((id) => ({ id, name: `Dupla ${id}`, box: 'Box', division_id: 'd-dist' })),
    workouts: [{ id: 'wod-dist', event_id: 'ev-dist', name: 'Remo e corrida', code: 'W1', order_index: 1, type: 'distance', time_cap: '20:00', tie_breaker: '', division_id: null, structure: DISTANCE }],
    scores: [],
    registrations: []
  });
  const open = (athleteId, lane) => post(JUDGE, { action: 'open', eventId: 'ev-dist', workoutId: 'wod-dist', athleteId, heatId: 'h-dist', lane });
  const send = async (athleteId, lane, events) => {
    const sheetId = (await open(athleteId, lane)).body.sheet.id;
    const appended = await post(JUDGE, { action: 'append', sheetId, fromSeq: 0, events });
    assert.equal(appended.status, 200, appended.body.error);
    return { sheetId, submitted: await post(JUDGE, { action: 'submit', sheetId, expectedCount: events.length }) };
  };

  // Dupla A: lança 4.500 aos 10:00 e o total de 6.330 aos 20:00; o último vale.
  const openedA = await open('A', 1);
  assert.equal(openedA.status, 200, openedA.body.error);
  assert.deepEqual(openedA.body.sheet.structure, DISTANCE, 'a súmula guarda a cópia da estrutura v4');
  const sheetA = openedA.body.sheet.id;
  const logA = [e({ t: 'dist', v: 4500, at: 600 }), e({ t: 'dist', v: 6330, at: 1200 })];
  assert.deepEqual((await post(JUDGE, { action: 'append', sheetId: sheetA, fromSeq: 0, events: logA })).body, { count: 2 });

  // O servidor confere cada registro: total fora do teto ou não inteiro, rep, fill, set, adj, time e attempt não valem na distância.
  const refuse = async (event, message) => {
    const response = await post(JUDGE, { action: 'append', sheetId: sheetA, fromSeq: 2, events: [e(event)] });
    assert.equal(response.status, 400, JSON.stringify(event));
    assert.match(response.body.error, message, JSON.stringify(event));
  };
  await refuse({ t: 'dist', v: 100000, at: 1210 }, /o total deve ser um número inteiro de metros entre 0 e 99\.999/);
  await refuse({ t: 'dist', v: 3.5, at: 1210 }, /o total deve ser um número inteiro de metros/);
  await refuse({ t: 'rep', seg: 'mx', at: 1210 }, /etapa inexistente na prova/);
  await refuse({ t: 'time', target: 'final', v: 600, at: 1210 }, /o ajuste do tempo não vale para esta prova/);
  await refuse({ t: 'attempt', lift: 'l1', load: 100, ok: true, at: 1210 }, /movimento inexistente na prova/);
  assert.equal(rows('scoresheet_events').filter((row) => row.sheet_id === sheetA).length, 2, 'nada foi gravado nas recusas');

  const submittedA = await post(JUDGE, { action: 'submit', sheetId: sheetA, expectedCount: 2 });
  assert.equal(submittedA.status, 200, submittedA.body.error);
  assert.deepEqual([submittedA.body.sheet.officialResult, submittedA.body.sheet.officialTieBreak, submittedA.body.summary], ['6330', null, '6.330 m']);
  assert.deepEqual(scoreOf('A', 'wod-dist'), { athlete_id: 'A', workout_id: 'wod-dist', result: '6330', value: 6330, splits: {}, scoresheet_id: sheetA, result_status: null, rank: 1, points: 1 });

  const sent = { B: await send('B', 2, [e({ t: 'dist', v: 6330, at: 1205 })]), C: await send('C', 3, [e({ t: 'dist', v: 5915, at: 1198 })]) };
  for (const [athleteId, expected] of [['B', 6330], ['C', 5915]]) {
    assert.equal(sent[athleteId].submitted.status, 200, sent[athleteId].submitted.body.error);
    assert.deepEqual([scoreOf(athleteId, 'wod-dist').result, scoreOf(athleteId, 'wod-dist').value, scoreOf(athleteId, 'wod-dist').result_status], [String(expected), expected, null]);
  }

  // Enviar sem nenhum lançamento é recusado (e desfazer o único lançamento volta a recusar).
  const sheetE = (await open('E', 5)).body.sheet.id;
  const emptySubmit = await post(JUDGE, { action: 'submit', sheetId: sheetE, expectedCount: 0 });
  assert.equal(emptySubmit.status, 400);
  assert.equal(emptySubmit.body.error, 'Informe a distância total antes de enviar.');
  await post(JUDGE, { action: 'append', sheetId: sheetE, fromSeq: 0, events: [e({ t: 'dist', v: 5000, at: 900 }), e({ t: 'undo', of: 0, at: 910 })] });
  const undone = await post(JUDGE, { action: 'submit', sheetId: sheetE, expectedCount: 2 });
  assert.equal(undone.status, 400);
  assert.equal(undone.body.error, 'Informe a distância total antes de enviar.');
  assert.equal(scoreOf('E', 'wod-dist'), undefined, 'nada foi publicado');

  // Ausente: 0 m, depois de qualquer resultado real.
  const sheetD = (await open('D', 4)).body.sheet.id;
  const absent = await post(JUDGE, { action: 'absent', sheetId: sheetD });
  assert.equal(absent.status, 200, absent.body.error);
  assert.deepEqual([absent.body.sheet.officialResult, absent.body.sheet.absent], ['0', true]);
  assert.deepEqual([scoreOf('D', 'wod-dist').result, scoreOf('D', 'wod-dist').value, scoreOf('D', 'wod-dist').result_status, scoreOf('D', 'wod-dist').splits], ['0', 0, 'absent', {}]);

  // Ranking e pontos recalculados pelo caminho existente (tipo legado distance, "maior vence", sem desempate).
  assert.deepEqual(
    Object.fromEntries(['A', 'B', 'C', 'D'].map((id) => [id, [scoreOf(id, 'wod-dist').rank, scoreOf(id, 'wod-dist').points]])),
    { A: [1, 1], B: [1, 1], C: [3, 3], D: [4, 4] }
  );

  // Correção do gestor (revisão do @qa): metros inteiros, com o ponto de milhar. "6.350" é 6350, nunca 6,35.
  const correct = (result) => post(MANAGER, { action: 'review', sheetId: sheetA, review: 'correct', reason: 'Conferi o total com a súmula de papel', result });
  for (const [typed, message] of [
    ['6,5', /^Use só metros inteiros \(ex\.: 3250\)\.$/],
    ['6.35', /^Use só metros inteiros \(ex\.: 3250\)\.$/],
    ['100000', /^O total passa de 99\.999 m\. Confira o número\.$/],
    ['', /^Informe o total em metros\.$/]
  ]) {
    const refused = await correct(typed);
    assert.equal(refused.status, 400, JSON.stringify(typed));
    assert.match(refused.body.error, message, JSON.stringify(typed));
  }
  assert.equal(scoreOf('A', 'wod-dist').value, 6330, 'nada mudou nas recusas');
  const fixed = await correct('6.350');
  assert.equal(fixed.status, 200, fixed.body.error);
  assert.deepEqual([scoreOf('A', 'wod-dist').result, scoreOf('A', 'wod-dist').value, fixed.body.sheet.corrected], ['6350', 6350, true]);
  assert.equal((await correct('6.330')).status, 200);
  assert.deepEqual([scoreOf('A', 'wod-dist').result, scoreOf('A', 'wod-dist').value], ['6330', 6330], 'o ponto de milhar vale como milhar');
  assert.deepEqual(
    Object.fromEntries(['A', 'B', 'C', 'D'].map((id) => [id, [scoreOf(id, 'wod-dist').rank, scoreOf(id, 'wod-dist').points]])),
    { A: [1, 1], B: [1, 1], C: [3, 3], D: [4, 4] }
  );
});
