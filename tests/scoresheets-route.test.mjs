import assert from 'node:assert/strict';
import test from 'node:test';

import { createFakeSupabase } from './support/fakeSupabase.mjs';
import { importServerModule, setActiveSupabaseClient } from './support/serverModuleHarness.mjs';

// Stories 1.49 a 1.52 (etapa E3): arbitragem presencial pela rota real, com o
// banco em memória. Acesso por evento (judge atribuído, gestor dono, owner),
// abrir e retomar a súmula, gravar em lote com reenvio sem duplicar, enviar e
// publicar na hora com o ranking recalculado no servidor, revisão do gestor
// (devolver, corrigir, cancelar), trava da estrutura, lançamento manual por
// cima da súmula e judges em evento presencial.

process.env.SUPABASE_URL = 'http://supabase.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';
process.env.WODA_SESSION_SECRET = 'segredo-de-teste-sumula-presencial';

let database = createFakeSupabase();
let missingTables = false;
setActiveSupabaseClient({
  from: (table) => {
    if (missingTables && table.startsWith('scoresheet')) {
      const failing = {
        select: () => failing, eq: () => failing, in: () => failing, order: () => failing, maybeSingle: () => failing, insert: () => failing,
        then: (resolve) => resolve({ data: null, error: { code: '42P01', message: `relation "public.${table}" does not exist` } })
      };
      return failing;
    }
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
  assert.deepEqual(scoreOf('ath-caio'), { athlete_id: 'ath-caio', workout_id: 'wod-fran', result: '09:41', value: 581, splits: { tieBreaker: '04:31' }, scoresheet_id: sheetId, rank: 2, points: 2 });
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
