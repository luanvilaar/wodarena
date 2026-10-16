import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createFakeSupabase } from './support/fakeSupabase.mjs';
import { importServerModule, setActiveSupabaseClient } from './support/serverModuleHarness.mjs';

// Story 1.43 (AC8 a AC10, AC13, AC15): a estrutura da prova é validada e
// normalizada pela persistência administrativa real (banco em memória) antes de
// qualquer gravação, e os campos legados (type, time_cap, tie_breaker) não
// podem divergir dela.

process.env.SUPABASE_URL = 'http://supabase.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';
process.env.WODA_SESSION_SECRET = 'segredo-de-teste-story-1-43-persistencia';

let database = createFakeSupabase();
// O que o servidor lê de `workouts` com select('structure'), e um erro injetado nessa leitura.
const structureReads = [];
let structureReadError = null;

setActiveSupabaseClient({
  from: (table) => {
    const query = database.client.from(table);
    if (table !== 'workouts') return query;
    const originalSelect = query.select.bind(query);
    query.select = (columns, options) => {
      if (columns !== 'structure') return originalSelect(columns, options);
      structureReads.push(columns);
      if (!structureReadError) return originalSelect(columns, options);
      const failing = { eq: () => failing, maybeSingle: async () => ({ data: null, error: structureReadError }) };
      return failing;
    };
    return query;
  },
  rpc: (name, args) => database.client.rpc(name, args)
});

const { POST: postPersistence } = await importServerModule('app/api/admin/persistence/route.ts');
const { createSessionToken } = await importServerModule('lib/serverSecurity.ts');
const { validateWorkoutStructure, deriveLegacyWorkoutFields } = await importServerModule('lib/workoutStructure.ts');

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const persistenceRoute = read('../src/app/api/admin/persistence/route.ts');
const block = (source, pattern) => source.match(pattern)?.[0] || '';
const caseBlock = (name) => block(persistenceRoute, new RegExp(`case '${name}': \\{[\\s\\S]*?\\n {6}\\}`));

const MANAGER = { id: 'mgr-estrutura', name: 'Gestora Estrutura', email: 'estrutura@example.com', role: 'manager', service_valid_until: '2099-12-31' };
const OTHER_MANAGER = { id: 'mgr-outro-est', name: 'Outro Gestor', email: 'outro-est@example.com', role: 'manager', service_valid_until: '2099-12-31' };
const EXPIRED_MANAGER = { id: 'mgr-expirado-est', name: 'Gestor Expirado', email: 'exp-est@example.com', role: 'manager', service_valid_until: '2020-01-01' };
const OWNER = { id: 'owner-estrutura', name: 'Owner', email: 'owner-est@example.com', role: 'owner' };
const ATHLETE = { id: 'ath-estrutura', name: 'Atleta', email: 'atleta-est@example.com', role: 'athlete' };

const EVENT_FF = 'evt-ff';
const EVENT_RACE = 'evt-race';
const EVENT_QUALIFIER = 'evt-qual';
const EVENT_OTHER = 'evt-outro';

// A prova do protótipo aprovado: Thruster e Pull-up em 21, 15 e 9, cap de 10 min, 1 s por repetição.
const segment = (id, round, name, reps, load) => ({
  id, round, name, reps, load, note: `${name} no padrão`, required: true, mark: 'reps'
});
const structureFixture = (overrides = {}) => ({
  version: 1,
  format: 'for_time',
  totalReps: 90,
  timeCapSeconds: 600,
  incomplete: { rule: 'penalty_per_rep', secondsPerRep: 1, base: 'time_cap' },
  tieBreak: { kind: 'split_time', at: 's2', order: 'asc' },
  generator: { kind: 'descending', reps: [21, 15, 9] },
  customized: false,
  entry: { mode: 'both', marking: 'reps', publish: 'after_review' },
  segments: [
    segment('s1', 1, 'Thruster', 21, { value: 43, unit: 'kg' }),
    segment('s2', 1, 'Pull-up', 21, null),
    segment('s3', 2, 'Thruster', 15, { value: 43, unit: 'kg' }),
    segment('s4', 2, 'Pull-up', 15, null),
    segment('s5', 3, 'Thruster', 9, { value: 43, unit: 'kg' }),
    segment('s6', 3, 'Pull-up', 9, null)
  ],
  ...overrides
});
const noTieBreakStructure = () => structureFixture({ tieBreak: null });

const workoutRow = (overrides = {}) => ({
  id: 'wod-1',
  event_id: EVENT_FF,
  name: 'Fran',
  description: 'Thruster e Pull-up',
  type: 'fortime',
  time_cap: '10:00',
  code: 'W1',
  order_index: 1,
  division_id: null,
  tie_breaker: 'Tempo',
  ...overrides
});

const eventRow = (id, overrides = {}) => ({
  id,
  name: `Evento ${id}`,
  organizer_id: MANAGER.id,
  event_type: 'functional_fitness',
  event_schedule: [],
  ...overrides
});

const seed = (workouts = []) => {
  database = createFakeSupabase({
    users: [MANAGER, OTHER_MANAGER, EXPIRED_MANAGER, OWNER],
    events: [
      eventRow(EVENT_FF),
      eventRow(EVENT_RACE, { event_type: 'fitness_racing' }),
      eventRow(EVENT_QUALIFIER, { event_type: 'functional_fitness_qualifier' }),
      eventRow(EVENT_OTHER, { organizer_id: OTHER_MANAGER.id })
    ],
    workouts: workouts.map((workout) => structuredClone(workout))
  });
  structureReads.length = 0;
  structureReadError = null;
};

const persist = async (user, action, payload) => {
  const response = await postPersistence(new Request('http://localhost/api/admin/persistence', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `woda_session=${createSessionToken({ id: user.id, name: user.name, email: user.email, role: user.role })}`
    },
    body: JSON.stringify({ action, payload })
  }));
  return { status: response.status, body: await response.json() };
};

const rowOf = (id) => structuredClone(database.rows('workouts').find((row) => row.id === id));
const quietConsole = (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'info', () => {});
};

const createWorkoutPayload = (workout, eventId = EVENT_FF) => ({ workout: { event_id: eventId, ...workout } });
const updateWorkoutPayload = (data, workoutId = 'wod-1', eventId = EVENT_FF) => ({ workoutId, eventId, data });

// ---------------------------------------------------------------------------
// Estáticos
// ---------------------------------------------------------------------------

test('estático: structure na allowlist (sem event_id), módulo importado e validação antes de gravar', () => {
  const fields = block(persistenceRoute, /const WORKOUT_UPDATABLE_FIELDS = \[[\s\S]*?\] as const;/);
  assert.match(fields, /'structure'/);
  assert.doesNotMatch(fields, /'event_id'/);
  assert.match(persistenceRoute, /import \{ deriveLegacyWorkoutFields, validateWorkoutStructure, type LegacyWorkoutFields \} from '@\/lib\/workoutStructure';/);

  const create = caseBlock('createWorkout');
  assert.match(create, /resolveWorkoutStructureForWrite\(event\.event_type, payload\.workout\)/);
  assert.ok(create.indexOf('resolveWorkoutStructureForWrite') < create.indexOf(".insert(payload.workout)"), 'valida antes do insert');
  assert.ok(create.indexOf('ensureEventOwner') < create.indexOf('resolveWorkoutStructureForWrite'), 'ownership antes da validação');

  const update = caseBlock('updateWorkout');
  assert.match(update, /resolveWorkoutStructureForUpdate\(supabaseAdmin, event\.event_type, payload\.workoutId, allowedData\)/);
  assert.ok(update.indexOf('ensureWorkoutOwner') < update.indexOf('resolveWorkoutStructureForUpdate'));
  assert.ok(update.indexOf('ensureEventOwner') < update.indexOf('resolveWorkoutStructureForUpdate'));
  assert.ok(update.indexOf('resolveWorkoutStructureForUpdate') < update.indexOf('.update(allowedData)'), 'valida e compara antes do update');
  assert.match(update, /\.from\('workouts'\)\s*\.update\(allowedData\)/);
});

test('estático: os quatro caminhos que gravam prova passam pelo guard de estrutura', () => {
  const inserts = persistenceRoute.match(/from\('workouts'\)\s*\.?insert\(/g) || [];
  assert.equal(inserts.length, 4, 'um quinto caminho de gravação de prova precisa de decisão sobre a estrutura');

  const createEvent = caseBlock('createEvent');
  assert.ok(createEvent.indexOf('rejectStructureOnRawWorkoutInsert(workouts)') > 0);
  assert.ok(createEvent.indexOf('rejectStructureOnRawWorkoutInsert(workouts)') < createEvent.indexOf("from('events').insert(event)"), 'recusa antes de criar o evento');

  const createDivision = caseBlock('createDivision');
  assert.ok(createDivision.indexOf('rejectStructureOnRawWorkoutInsert(payload.autoWorkout)') > 0);
  assert.ok(createDivision.indexOf('rejectStructureOnRawWorkoutInsert(payload.autoWorkout)') < createDivision.indexOf("from('divisions').insert(payload.division)"), 'recusa antes de gravar a divisão');

  const repair = caseBlock('repairWorkouts');
  assert.ok(repair.indexOf('ensureEventOwner') < repair.indexOf('rejectStructureOnRawWorkoutInsert(payload.workouts)'));
  assert.ok(repair.indexOf('rejectStructureOnRawWorkoutInsert(payload.workouts)') < repair.indexOf(".insert(payload.workouts)"));
});

test('estático: as linhas fixadas pela revisão de segurança de 2026-08 seguem iguais', () => {
  assert.match(persistenceRoute, /scopedWorkouts = \(workouts as Record<string, unknown>\[\]\)\.map\(\(workout\) => \(\{\s*\.\.\.workout,\s*event_id: event\.id/);
  assert.match(persistenceRoute, /from\('workouts'\)\.insert\(scopedWorkouts\)/);
  assert.match(persistenceRoute, /scopedAutoWorkout = \{ \.\.\.payload\.autoWorkout, event_id: payload\.division\.event_id \}/);
  assert.match(persistenceRoute, /from\('workouts'\)\.insert\(scopedAutoWorkout\)/);
});

test('estático: a leitura da guarda só existe depois do ownership, só em Functional Fitness e as mensagens não ecoam o JSON', () => {
  const helper = block(persistenceRoute, /const resolveWorkoutStructureForUpdate = async \([\s\S]*?\n\};/);
  assert.ok(helper, 'helper de update');
  assert.match(helper, /if \('structure' in allowedData\) return resolveWorkoutStructureForWrite\(eventType, allowedData\);/);
  assert.match(helper, /if \(!touchesLegacyFields \|\| !isFunctionalFitnessEvent\(eventType\)\) return \{ ok: true \};/);
  assert.ok(helper.indexOf('touchesLegacyFields') < helper.indexOf('readStoredWorkoutStructure'), 'a leitura só acontece depois do filtro');
  assert.match(persistenceRoute, /\(error\.code === '42703' \|\| error\.code === 'PGRST204'\) && String\(error\.message \|\| ''\)\.includes\('structure'\)/);
  assert.doesNotMatch(block(persistenceRoute, /const findLegacyWorkoutMismatch = [\s\S]*?\n\};/), /JSON\.stringify/);
  assert.doesNotMatch(block(persistenceRoute, /const resolveWorkoutStructureForWrite = [\s\S]*?\n\};/), /JSON\.stringify/);
});

// ---------------------------------------------------------------------------
// createWorkout
// ---------------------------------------------------------------------------

test('createWorkout com estrutura válida grava a versão normalizada e preenche os campos legados ausentes', async (t) => {
  quietConsole(t);
  seed();
  const sent = structureFixture();
  sent.segments[0].name = '  Thruster  ';
  const result = await persist(MANAGER, 'createWorkout', createWorkoutPayload({ id: 'wod-novo', name: 'Fran', description: 'x', code: 'W1', order_index: 1, structure: sent }));
  assert.deepEqual(result, { status: 200, body: { success: true } });

  const saved = rowOf('wod-novo');
  assert.equal(saved.structure.segments[0].name, 'Thruster', 'espaços das pontas removidos');
  assert.deepEqual(saved.structure, validateWorkoutStructure(structureFixture()).structure);
  assert.notEqual(saved.structure, sent, 'não grava a referência recebida');
  assert.equal(saved.type, 'fortime');
  assert.equal(saved.time_cap, '10:00');
  assert.equal(saved.tie_breaker, 'Tempo');
  assert.equal(saved.event_id, EVENT_FF);
});

test('createWorkout com estrutura inválida responde 400 em português e não grava nada', async (t) => {
  quietConsole(t);
  seed();
  const before = database.snapshot();
  const invalid = [
    structureFixture({ totalReps: 91 }),
    structureFixture({ timeCapSeconds: 6000 }),
    structureFixture({ tieBreak: { kind: 'split_time', at: 'inexistente', order: 'asc' } }),
    { ...structureFixture(), extra: true },
    structureFixture({ format: 'emom' }),
    'texto',
    [],
    42
  ];
  for (const structure of invalid) {
    const result = await persist(MANAGER, 'createWorkout', createWorkoutPayload({ id: 'wod-x', name: 'Fran', structure }));
    assert.equal(result.status, 400, JSON.stringify(structure).slice(0, 60));
    assert.equal(typeof result.body.error, 'string');
    assert.doesNotMatch(result.body.error, /\{|"version"|emom/, 'a mensagem não devolve o JSON enviado');
  }
  assert.deepEqual(database.snapshot(), before);
});

test('estrutura não nula só entra em evento de Functional Fitness; null passa nos outros tipos', async (t) => {
  quietConsole(t);
  seed();
  for (const eventId of [EVENT_RACE, EVENT_QUALIFIER]) {
    const refused = await persist(MANAGER, 'createWorkout', createWorkoutPayload({
      id: `wod-${eventId}`, name: 'Prova', structure: structureFixture(),
      ...(eventId === EVENT_QUALIFIER ? { type: 'amrap', submission_opens_at: '2099-01-01T00:00:00Z', submission_closes_at: '2099-01-02T00:00:00Z' } : {})
    }, eventId));
    assert.equal(refused.status, 400, eventId);
    assert.match(refused.body.error, /só vale em eventos de Functional Fitness presencial/);
    assert.equal(database.rows('workouts').length, 0);
  }
  const withNull = await persist(MANAGER, 'createWorkout', createWorkoutPayload({ id: 'wod-race', name: 'Prova', type: 'fortime', time_cap: '12:00', structure: null }, EVENT_RACE));
  assert.equal(withNull.status, 200);
  assert.equal(rowOf('wod-race').structure, null);
  assert.equal(rowOf('wod-race').time_cap, '12:00', 'legados como vierem');
});

test('createWorkout sem structure funciona como antes e não leva a coluna ao banco', async (t) => {
  quietConsole(t);
  seed();
  const result = await persist(MANAGER, 'createWorkout', createWorkoutPayload({ id: 'wod-legado', name: 'Legado', type: 'amrap', time_cap: '15:00', tie_breaker: '' }));
  assert.equal(result.status, 200);
  const saved = rowOf('wod-legado');
  assert.equal('structure' in saved, false);
  assert.equal(saved.time_cap, '15:00');
});

// ---------------------------------------------------------------------------
// updateWorkout
// ---------------------------------------------------------------------------

test('updateWorkout grava a estrutura válida; inválida responde 400 sem alterar a linha; null limpa e libera os legados', async (t) => {
  quietConsole(t);
  seed([workoutRow({ structure: null })]);

  const valid = await persist(MANAGER, 'updateWorkout', updateWorkoutPayload({ structure: noTieBreakStructure() }));
  assert.equal(valid.status, 200);
  assert.deepEqual(rowOf('wod-1').structure, validateWorkoutStructure(noTieBreakStructure()).structure);
  assert.equal(rowOf('wod-1').tie_breaker, '', 'sem tie-break na estrutura, o legado vira vazio');
  assert.equal(rowOf('wod-1').time_cap, '10:00');

  const before = database.snapshot();
  const invalid = await persist(MANAGER, 'updateWorkout', updateWorkoutPayload({ structure: structureFixture({ totalReps: 1 }), name: 'Não pode gravar' }));
  assert.equal(invalid.status, 400);
  assert.deepEqual(database.snapshot(), before, 'nada mudou, nem o outro campo do mesmo payload');

  const cleared = await persist(MANAGER, 'updateWorkout', updateWorkoutPayload({ structure: null, time_cap: '15:00', type: 'amrap' }));
  assert.equal(cleared.status, 200);
  const row = rowOf('wod-1');
  assert.equal(row.structure, null);
  assert.equal(row.time_cap, '15:00', 'legados gravados como vierem');
  assert.equal(row.type, 'amrap');

  // Depois de limpar, a edição dos legados é livre.
  assert.equal((await persist(MANAGER, 'updateWorkout', updateWorkoutPayload({ time_cap: '20:00' }))).status, 200);
  assert.equal(rowOf('wod-1').time_cap, '20:00');
});

test('updateWorkout sem structure no payload mantém a estrutura da linha', async (t) => {
  quietConsole(t);
  seed([workoutRow({ structure: structureFixture() })]);
  const result = await persist(MANAGER, 'updateWorkout', updateWorkoutPayload({ name: 'Novo nome', description: 'Outra descrição' }));
  assert.equal(result.status, 200);
  assert.equal(rowOf('wod-1').name, 'Novo nome');
  assert.deepEqual(rowOf('wod-1').structure, structureFixture());
});

test('updateWorkout com estrutura em evento Fitness Racing ou Qualifier responde 400', async (t) => {
  quietConsole(t);
  seed([workoutRow({ id: 'wod-race', event_id: EVENT_RACE }), workoutRow({ id: 'wod-qual', event_id: EVENT_QUALIFIER, type: 'amrap' })]);
  const before = database.snapshot();
  assert.equal((await persist(MANAGER, 'updateWorkout', updateWorkoutPayload({ structure: structureFixture() }, 'wod-race', EVENT_RACE))).status, 400);
  assert.equal((await persist(MANAGER, 'updateWorkout', updateWorkoutPayload({ structure: structureFixture() }, 'wod-qual', EVENT_QUALIFIER))).status, 400);
  assert.deepEqual(database.snapshot(), before);
});

// ---------------------------------------------------------------------------
// Outros caminhos que gravam prova crua
// ---------------------------------------------------------------------------

test('createEvent, createDivision e repairWorkouts recusam estrutura não nula antes de gravar qualquer coisa', async (t) => {
  quietConsole(t);
  seed();
  // O banco em memória cria a tabela ao consultá-la; cria antes do retrato para a comparação não enxergar isso.
  database.rows('divisions');
  database.rows('workouts');
  const before = database.snapshot();

  const newEvent = {
    id: 'evt-lote', name: 'Evento Lote', logo_url: '', banner_url: '', status: 'upcoming', location: 'Arena', date: '2099-06-01',
    description: '', organizer_id: MANAGER.id, sponsors: [], format: 'individual', ticket_price: 150, ticket_slots: 100,
    is_ticketing_active: true, time: '', city: '', state: '', rules: '', instagram: '', website: '',
    event_type: 'functional_fitness', event_schedule: [], mp_public_key: null, shirt_mode: 'included', shirt_addon_price: 0
  };
  const event = await persist(MANAGER, 'createEvent', {
    event: newEvent,
    workouts: [{ id: 'wod-lote', name: 'Prova', type: 'fortime', structure: structureFixture() }]
  });
  assert.equal(event.status, 400);
  assert.match(event.body.error, /só entra ao criar ou editar uma prova/);
  assert.equal(database.rows('events').some((row) => row.id === 'evt-lote'), false, 'nenhum evento órfão');

  const division = await persist(MANAGER, 'createDivision', {
    division: { id: 'div-x', event_id: EVENT_FF, name: 'RX', category: 'male' },
    autoWorkout: { id: 'wod-auto', name: 'Auto', structure: structureFixture() }
  });
  assert.equal(division.status, 400);
  assert.equal(database.rows('divisions').length, 0, 'nenhuma divisão sem prova');

  const repair = await persist(MANAGER, 'repairWorkouts', { workouts: [{ id: 'wod-rep', event_id: EVENT_FF, name: 'Reparo', structure: structureFixture() }] });
  assert.equal(repair.status, 400);

  assert.deepEqual(database.snapshot(), before);
});

test('os mesmos caminhos seguem aceitando provas sem estrutura ou com structure null', async (t) => {
  quietConsole(t);
  seed();
  const division = await persist(MANAGER, 'createDivision', {
    division: { id: 'div-ok', event_id: EVENT_FF, name: 'RX', category: 'male' },
    autoWorkout: { id: 'wod-auto-ok', name: 'Auto', description: '', type: 'fortime', time_cap: '10:00', code: 'W1', order_index: 1, division_id: 'div-ok', tie_breaker: '', structure: null }
  });
  assert.equal(division.status, 200);
  assert.equal(database.rows('workouts').length, 1);

  const repair = await persist(MANAGER, 'repairWorkouts', { workouts: [{ id: 'wod-rep-ok', event_id: EVENT_FF, name: 'Reparo', type: 'fortime', time_cap: '10:00' }] });
  assert.equal(repair.status, 200);
});

// ---------------------------------------------------------------------------
// Barreiras que rodam antes da validação e da leitura
// ---------------------------------------------------------------------------

test('quem não passa em sessão, validade do gestor e ownership não provoca validação, leitura nem gravação', async (t) => {
  quietConsole(t);
  seed([workoutRow({ structure: structureFixture() }), workoutRow({ id: 'wod-alheia', event_id: EVENT_OTHER, structure: structureFixture() })]);
  const before = database.snapshot();

  const otherEvent = await persist(MANAGER, 'updateWorkout', updateWorkoutPayload({ time_cap: '15:00' }, 'wod-alheia', EVENT_OTHER));
  assert.notEqual(otherEvent.status, 200);
  assert.match(otherEvent.body.error, /Acesso negado para este evento/);

  const createInOther = await persist(MANAGER, 'createWorkout', createWorkoutPayload({ id: 'wod-novo', name: 'Prova', structure: structureFixture() }, EVENT_OTHER));
  assert.notEqual(createInOther.status, 200);

  const expired = await persist(EXPIRED_MANAGER, 'updateWorkout', updateWorkoutPayload({ time_cap: '15:00' }));
  assert.equal(expired.status, 403);
  assert.equal(expired.body.code, 'manager_access_expired');

  assert.equal((await persist(ATHLETE, 'updateWorkout', updateWorkoutPayload({ time_cap: '15:00' }))).status, 403);
  assert.equal((await persist(ATHLETE, 'createWorkout', createWorkoutPayload({ id: 'wod-a', name: 'x', structure: structureFixture() }))).status, 403);

  assert.deepEqual(database.snapshot(), before);
  assert.equal(structureReads.length, 0, 'nenhuma leitura de structure para quem foi barrado');

  // owner pode tudo.
  assert.equal((await persist(OWNER, 'updateWorkout', updateWorkoutPayload({ time_cap: '10:00' }, 'wod-alheia', EVENT_OTHER))).status, 200);
});

test('a 121ª chamada do mesmo gestor no minuto responde 429 sem leitura de structure', async (t) => {
  quietConsole(t);
  seed([workoutRow({ structure: structureFixture() })]);
  const limited = { ...MANAGER, id: 'mgr-limite-estrutura', email: 'limite-est@example.com' };
  database.rows('users').push(limited);
  database.rows('events').push(eventRow('evt-limite', { organizer_id: limited.id }));
  database.rows('workouts').push(workoutRow({ id: 'wod-limite', event_id: 'evt-limite', structure: structureFixture() }));

  for (let call = 1; call <= 120; call += 1) {
    const ok = await persist(limited, 'updateWorkout', updateWorkoutPayload({ name: `Nome ${call}` }, 'wod-limite', 'evt-limite'));
    assert.equal(ok.status, 200, `chamada ${call}`);
  }
  const blocked = await persist(limited, 'updateWorkout', updateWorkoutPayload({ time_cap: '15:00' }, 'wod-limite', 'evt-limite'));
  assert.equal(blocked.status, 429);
  assert.equal(structureReads.length, 0);
  assert.equal(rowOf('wod-limite').time_cap, '10:00');
});

// ---------------------------------------------------------------------------
// AC15: campos legados não divergem da estrutura
// ---------------------------------------------------------------------------

test('AC15 (a): estrutura e legado divergente no mesmo payload responde 400 com campo e valor esperado, sem gravar', async (t) => {
  quietConsole(t);
  seed([workoutRow({ structure: structureFixture() })]);
  const before = database.snapshot();

  const cases = [
    [{ time_cap: '15:00' }, /O time cap da prova vem da estrutura \(10:00\) e não pode ser alterado separadamente\./],
    [{ type: 'amrap' }, /O tipo da prova vem da estrutura \(For Time\)/],
    [{ tie_breaker: 'Repetições' }, /O desempate da prova vem da estrutura \(Tempo\)/],
    [{ time_cap: null }, /time cap/],
    [{ type: 5 }, /tipo/]
  ];
  for (const [legacy, message] of cases) {
    const update = await persist(MANAGER, 'updateWorkout', updateWorkoutPayload({ structure: structureFixture(), ...legacy }));
    assert.equal(update.status, 400, JSON.stringify(legacy));
    assert.match(update.body.error, message);
    assert.doesNotMatch(update.body.error, /"version"|\{/);

    const create = await persist(MANAGER, 'createWorkout', createWorkoutPayload({ id: 'wod-novo', name: 'Prova', structure: structureFixture(), ...legacy }));
    assert.equal(create.status, 400, JSON.stringify(legacy));
  }
  assert.deepEqual(database.snapshot(), before);

  const noTieBreakRefused = await persist(MANAGER, 'createWorkout', createWorkoutPayload({ id: 'wod-novo', name: 'Prova', structure: noTieBreakStructure(), tie_breaker: 'Tempo' }));
  assert.equal(noTieBreakRefused.status, 400);
  assert.match(noTieBreakRefused.body.error, /sem desempate/);
});

test('AC15 (a): legado igual ao derivado (inclusive com outra caixa) é aceito e normalizado; ausente é preenchido', async (t) => {
  quietConsole(t);
  seed([workoutRow({ structure: null })]);

  const same = await persist(MANAGER, 'updateWorkout', updateWorkoutPayload({ structure: structureFixture(), type: ' fortime ', time_cap: ' 10:00 ', tie_breaker: 'tempo' }));
  assert.equal(same.status, 200);
  const row = rowOf('wod-1');
  assert.equal(row.type, 'fortime');
  assert.equal(row.time_cap, '10:00');
  assert.equal(row.tie_breaker, 'Tempo', 'grava o valor derivado, não o texto enviado');

  for (const empty of [null, '', '   ']) {
    const created = await persist(MANAGER, 'createWorkout', createWorkoutPayload({ id: `wod-${String(empty).length}`, name: 'Sem desempate', structure: noTieBreakStructure(), tie_breaker: empty }));
    assert.equal(created.status, 200, JSON.stringify(empty));
  }
});

test('AC15 (b): update sem structure numa prova estruturada recusa divergência e aceita o valor igual', async (t) => {
  quietConsole(t);
  seed([workoutRow({ structure: structureFixture() })]);
  const before = database.snapshot();

  assert.equal((await persist(MANAGER, 'updateWorkout', updateWorkoutPayload({ time_cap: '15:00' }))).status, 400);
  assert.equal((await persist(MANAGER, 'updateWorkout', updateWorkoutPayload({ type: 'amrap' }))).status, 400);
  const tieBreakNull = await persist(MANAGER, 'updateWorkout', updateWorkoutPayload({ tie_breaker: null }));
  assert.equal(tieBreakNull.status, 400);
  assert.match(tieBreakNull.body.error, /desempate/);
  assert.deepEqual(database.snapshot(), before, 'a linha não mudou');
  assert.ok(structureReads.length >= 3, 'a leitura aconteceu nos casos com legado');

  assert.equal((await persist(MANAGER, 'updateWorkout', updateWorkoutPayload({ time_cap: '10:00' }))).status, 200);
  assert.equal((await persist(MANAGER, 'updateWorkout', updateWorkoutPayload({ tie_breaker: 'TEMPO', type: 'fortime' }))).status, 200);
});

test('AC15 (b): na prova estruturada sem tie-break, tie_breaker vazio passa e "Tempo" é recusado', async (t) => {
  quietConsole(t);
  seed([workoutRow({ tie_breaker: '', structure: noTieBreakStructure() })]);
  assert.equal((await persist(MANAGER, 'updateWorkout', updateWorkoutPayload({ tie_breaker: null }))).status, 200);
  assert.equal((await persist(MANAGER, 'updateWorkout', updateWorkoutPayload({ tie_breaker: '  ' }))).status, 200);
  assert.equal((await persist(MANAGER, 'updateWorkout', updateWorkoutPayload({ tie_breaker: 'Tempo' }))).status, 400);
});

test('AC15 (b): edição que não toca os legados não lê a estrutura; prova sem estrutura edita como hoje', async (t) => {
  quietConsole(t);
  seed([workoutRow({ structure: structureFixture() }), workoutRow({ id: 'wod-legada', structure: null })]);

  assert.equal((await persist(MANAGER, 'updateWorkout', updateWorkoutPayload({ name: 'Novo nome', order_index: 3 }))).status, 200);
  assert.equal(structureReads.length, 0, 'nenhuma leitura de structure em edição comum');

  assert.equal((await persist(MANAGER, 'updateWorkout', updateWorkoutPayload({ time_cap: '15:00', type: 'amrap' }, 'wod-legada'))).status, 200);
  assert.equal(structureReads.length, 1, 'uma leitura, porque o payload traz legados');
  assert.equal(rowOf('wod-legada').time_cap, '15:00');
});

test('AC15 (b): coluna ausente (42703 ou PGRST204) conta como prova sem estrutura; outro erro vira 500', async (t) => {
  quietConsole(t);
  for (const code of ['42703', 'PGRST204']) {
    seed([workoutRow({ structure: structureFixture() })]);
    structureReadError = { code, message: 'column workouts.structure does not exist' };
    const result = await persist(MANAGER, 'updateWorkout', updateWorkoutPayload({ time_cap: '15:00' }));
    assert.equal(result.status, 200, code);
    assert.equal(rowOf('wod-1').time_cap, '15:00');
    assert.equal(structureReads.length, 1);
  }

  seed([workoutRow({ structure: structureFixture() })]);
  structureReadError = { code: '42703', message: 'column workouts.outra does not exist' };
  assert.equal((await persist(MANAGER, 'updateWorkout', updateWorkoutPayload({ time_cap: '15:00' }))).status, 500, 'coluna ausente de outra coluna não é tolerada');

  seed([workoutRow({ structure: structureFixture() })]);
  structureReadError = { code: '57014', message: 'canceling statement due to statement timeout' };
  const failed = await persist(MANAGER, 'updateWorkout', updateWorkoutPayload({ time_cap: '15:00' }));
  assert.equal(failed.status, 500);
  assert.equal(rowOf('wod-1').time_cap, '10:00', 'nada gravado quando a leitura falha');
});

test('AC15: em Fitness Racing e Qualifier a estrutura é inerte, a guarda não age e não há leitura', async (t) => {
  quietConsole(t);
  seed([
    workoutRow({ id: 'wod-race', event_id: EVENT_RACE, structure: structureFixture() }),
    workoutRow({ id: 'wod-qual', event_id: EVENT_QUALIFIER, type: 'amrap', structure: structureFixture() })
  ]);
  const race = await persist(MANAGER, 'updateWorkout', updateWorkoutPayload({ time_cap: '15:00', type: 'amrap' }, 'wod-race', EVENT_RACE));
  assert.equal(race.status, 200);
  assert.equal(rowOf('wod-race').time_cap, '15:00');

  // No Qualifier o fluxo segue para as travas próprias do Qualifier, que o banco em memória não
  // implementa por inteiro (a resposta pode ser 500 aqui). O que importa: a guarda não leu a estrutura.
  await persist(MANAGER, 'updateWorkout', updateWorkoutPayload({ time_cap: '15:00' }, 'wod-qual', EVENT_QUALIFIER));
  assert.equal(structureReads.length, 0, 'nenhuma leitura de structure em Fitness Racing nem em Qualifier');
});

test('a estrutura gravada ilegível não bloqueia a edição dos legados (nada a comparar)', async (t) => {
  quietConsole(t);
  seed([workoutRow({ structure: { lixo: true } })]);
  const result = await persist(MANAGER, 'updateWorkout', updateWorkoutPayload({ time_cap: '15:00' }));
  assert.equal(result.status, 200);
  assert.equal(rowOf('wod-1').time_cap, '15:00');
});

test('o derivado que a rota usa é o mesmo do módulo puro', () => {
  const derived = deriveLegacyWorkoutFields(validateWorkoutStructure(structureFixture()).structure);
  assert.deepEqual(derived, { type: 'fortime', timeCap: '10:00', tieBreaker: 'Tempo' });
});

// Stories 1.45 e 1.46: o que o painel monta (construtor + AppContext) é aceito pelo servidor, e a
// ida e volta (estruturar, editar o time cap, remover) funciona de ponta a ponta.
test('o payload que o painel monta com o construtor passa na rota: criar, editar o time cap e remover a súmula', async (t) => {
  quietConsole(t);
  seed();
  const editor = await importServerModule('lib/workoutStructureEditor.ts');
  const { deriveLegacyWorkoutFields: derive } = await importServerModule('lib/workoutStructure.ts');

  let draft = editor.createDraft('for_time');
  draft = editor.updateLine(draft, 'forTime', draft.forTime.lines[0].key, { reps: '21-15-9', name: 'Thruster', load: '42,5' });
  draft = editor.addLine(draft, 'forTime');
  draft = editor.updateLine(draft, 'forTime', draft.forTime.lines[1].key, { name: 'Pull-up' });
  draft = editor.toggleStepMark(draft, { line: draft.forTime.lines[1].key, round: 1 });
  const structure = editor.analyzeDraft(draft).structure;
  const checked = validateWorkoutStructure(structure);
  assert.equal(checked.ok, true);
  assert.deepEqual(checked.structure, structure, 'o construtor já entrega a versão normalizada');
  const legacy = derive(checked.structure);

  // addWorkout (AppContext): legados derivados e a estrutura no payload.
  const created = await persist(MANAGER, 'createWorkout', createWorkoutPayload({
    id: 'wod-painel', name: 'Fran', description: 'Thruster e Pull-up', type: legacy.type, time_cap: legacy.timeCap, code: 'W1', order_index: 1,
    division_id: null, tie_breaker: legacy.tieBreaker, structure: checked.structure, submission_opens_at: null, submission_closes_at: null
  }));
  assert.equal(created.status, 200, created.body.error);
  assert.deepEqual(rowOf('wod-painel').structure, checked.structure);
  assert.deepEqual([rowOf('wod-painel').type, rowOf('wod-painel').time_cap, rowOf('wod-painel').tie_breaker], ['fortime', '10:00', 'Tempo']);

  // Editar o time cap no construtor muda a estrutura e o legado derivado juntos.
  const reopened = editor.draftFromStructure(checked.structure);
  assert.equal(reopened.ok, true);
  const edited = editor.analyzeDraft({ ...reopened.draft, forTime: { ...reopened.draft.forTime, cap: '15:00' } }).structure;
  const editedLegacy = derive(edited);
  const updated = await persist(MANAGER, 'updateWorkout', updateWorkoutPayload({ structure: edited, time_cap: editedLegacy.timeCap }, 'wod-painel'));
  assert.equal(updated.status, 200, updated.body.error);
  assert.equal(rowOf('wod-painel').time_cap, '15:00');
  assert.equal(rowOf('wod-painel').structure.timeCapSeconds, 900);

  // Editar só a estrutura (sem os legados): o servidor preenche os derivados.
  const onlyStructure = editor.analyzeDraft({ ...reopened.draft, forTime: { ...reopened.draft.forTime, cap: '15:00', penalty: '2' } }).structure;
  assert.equal((await persist(MANAGER, 'updateWorkout', updateWorkoutPayload({ structure: onlyStructure }, 'wod-painel'))).status, 200);
  assert.equal(rowOf('wod-painel').structure.incomplete.secondsPerRep, 2);
  assert.equal(rowOf('wod-painel').time_cap, '15:00');

  // Um legado fora de sincronia com a estrutura (campo editado por fora) é recusado.
  assert.equal((await persist(MANAGER, 'updateWorkout', updateWorkoutPayload({ structure: onlyStructure, time_cap: '20:00' }, 'wod-painel'))).status, 400);

  // Remover a súmula: structure null e os campos legados passam a ser livres.
  assert.equal((await persist(MANAGER, 'updateWorkout', updateWorkoutPayload({ structure: null }, 'wod-painel'))).status, 200);
  assert.equal(rowOf('wod-painel').structure, null);
  assert.equal((await persist(MANAGER, 'updateWorkout', updateWorkoutPayload({ time_cap: '20:00' }, 'wod-painel'))).status, 200);
  assert.equal(rowOf('wod-painel').time_cap, '20:00');
});

// Story 1.47: a prova de carga máxima entra pela mesma rota e vira "maxweight" nos campos legados.
test('carga máxima: grava a estrutura, deriva maxweight, janela e desempate, e recusa legado divergente', async (t) => {
  quietConsole(t);
  seed();
  const editor = await importServerModule('lib/workoutStructureEditor.ts');
  let draft = editor.setDraftFormat(editor.createDraft('for_time'), 'max_load');
  draft = editor.updateLift(draft, draft.maxLoad.lifts[0].key, { name: 'Back Squat', load: '100' });
  draft = editor.addLift(draft);
  draft = editor.updateLift(draft, draft.maxLoad.lifts[1].key, { name: 'Deadlift', load: '120' });
  const withoutWindow = editor.analyzeDraft(draft).structure;

  const created = await persist(MANAGER, 'createWorkout', createWorkoutPayload({
    id: 'wod-total', name: 'Total', description: 'Back squat e deadlift', code: 'W2', order_index: 2, division_id: null,
    structure: withoutWindow, submission_opens_at: null, submission_closes_at: null
  }));
  assert.equal(created.status, 200, created.body.error);
  assert.deepEqual(rowOf('wod-total').structure, withoutWindow);
  assert.deepEqual([rowOf('wod-total').type, rowOf('wod-total').time_cap, rowOf('wod-total').tie_breaker], ['maxweight', null, 'Tempo']);

  const withWindow = editor.analyzeDraft({ ...draft, maxLoad: { ...draft.maxLoad, window: '20:00', tieBreak: 'fewest_attempts' } }).structure;
  assert.equal((await persist(MANAGER, 'updateWorkout', updateWorkoutPayload({ structure: withWindow }, 'wod-total'))).status, 200);
  assert.deepEqual([rowOf('wod-total').type, rowOf('wod-total').time_cap, rowOf('wod-total').tie_breaker], ['maxweight', '20:00', '']);

  const mismatch = await persist(MANAGER, 'updateWorkout', updateWorkoutPayload({ type: 'fortime' }, 'wod-total'));
  assert.equal(mismatch.status, 400);
  assert.match(mismatch.body.error, /^O tipo da prova vem da estrutura \(Carga máxima\) e não pode ser alterado separadamente\.$/);
});

// Revisão QA (Stories 1.46 e 1.47, QA-146-1): o painel manda o que o AppContext monta, e o
// AppContext envia time_cap null quando a prova não tem time cap (`timeCap || null`). A carga
// máxima sem janela tem time cap derivado vazio: null e vazio precisam valer como "sem time cap".
test('carga máxima sem janela com o payload real do painel (time_cap null): cria e edita sem 400', async (t) => {
  quietConsole(t);
  seed();
  const editor = await importServerModule('lib/workoutStructureEditor.ts');
  const { deriveLegacyWorkoutFields: derive } = await importServerModule('lib/workoutStructure.ts');
  let draft = editor.setDraftFormat(editor.createDraft('for_time'), 'max_load');
  draft = editor.updateLift(draft, draft.maxLoad.lifts[0].key, { name: 'Snatch', load: '40' });
  const structure = editor.analyzeDraft(draft).structure;
  const legacy = derive(structure);
  assert.equal(legacy.timeCap, '');

  // addWorkout (AppContext): time_cap: newWorkout.timeCap || null, tie_breaker: newWorkout.tieBreaker || ''.
  const created = await persist(MANAGER, 'createWorkout', createWorkoutPayload({
    id: 'wod-snatch', name: 'Snatch', description: '1RM', type: legacy.type, time_cap: legacy.timeCap || null, code: 'W3',
    order_index: 3, division_id: null, tie_breaker: legacy.tieBreaker || '', structure, submission_opens_at: null, submission_closes_at: null
  }));
  assert.equal(created.status, 200, created.body.error);
  assert.deepEqual([rowOf('wod-snatch').type, rowOf('wod-snatch').time_cap], ['maxweight', null]);

  // updateWorkout (AppContext): dbData.time_cap = updatedData.timeCap || null.
  const edited = editor.analyzeDraft(editor.updateLift(draft, draft.maxLoad.lifts[0].key, { name: 'Power Snatch' })).structure;
  const updated = await persist(MANAGER, 'updateWorkout', updateWorkoutPayload({ structure: edited, time_cap: null, tie_breaker: legacy.tieBreaker || null }, 'wod-snatch'));
  assert.equal(updated.status, 200, updated.body.error);
  assert.equal(rowOf('wod-snatch').structure.maxLoad.lifts[0].name, 'Power Snatch');

  // Sem a estrutura no payload, um time cap de verdade continua sendo divergência.
  const mismatch = await persist(MANAGER, 'updateWorkout', updateWorkoutPayload({ time_cap: '12:00' }, 'wod-snatch'));
  assert.equal(mismatch.status, 400);
  assert.match(mismatch.body.error, /^O time cap da prova vem da estrutura \(sem time cap\) e não pode ser alterado separadamente\.$/);
  // E numa prova com time cap, null continua divergindo.
  const forTime = derive(editor.analyzeDraft(editor.updateLine(editor.createDraft('for_time'), 'forTime', 'k1', { reps: '21-15-9', name: 'Thruster' })).structure);
  assert.equal(forTime.timeCap, '10:00');
});
