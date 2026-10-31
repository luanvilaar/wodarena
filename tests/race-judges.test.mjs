import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { createFakeSupabase } from './support/fakeSupabase.mjs';
import { importServerModule, setActiveSupabaseClient } from './support/serverModuleHarness.mjs';

// Story 1.95 (F1 da súmula Fitness Race): judges no evento Fitness Race. Os
// quatro `case` de judges de /api/admin/persistence escolhem a família de
// funções do banco por tipo de evento (qualifier_*, sheet_*, race_*) num único
// helper; as exceções novas viram mensagens claras; função ausente responde
// 503. A migration das funções race_* fica travada contra regressão (a
// execução real foi validada em PGlite, fora do projeto). A aba "Súmula
// Fitness Race" só existe em evento Fitness Race e a aba de FF não muda.

process.env.SUPABASE_URL = 'http://supabase.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';
process.env.WODA_SESSION_SECRET = 'segredo-de-teste-judges-race';

let database = createFakeSupabase();
// Erro devolvido pela próxima chamada de RPC (o banco em memória não executa as funções).
let nextRpcError = null;
setActiveSupabaseClient({
  from: (table) => database.client.from(table),
  rpc: async (name, args) => {
    const result = await database.client.rpc(name, args);
    if (!nextRpcError) return result;
    const error = nextRpcError;
    nextRpcError = null;
    return { data: null, error };
  }
});

const { POST: postPersistence } = await importServerModule('app/api/admin/persistence/route.ts');
const { GET: getRace } = await importServerModule('app/api/race-sheets/route.ts');
const { GET: getSheets } = await importServerModule('app/api/sheets/route.ts');
const { createSessionToken } = await importServerModule('lib/serverSecurity.ts');

const MANAGER = { id: 'mgr-race', name: 'Gestora Race', email: 'race@example.com', role: 'manager', service_valid_until: '2099-12-31' };
const OTHER_MANAGER = { id: 'mgr-outra', name: 'Outra Gestora', email: 'outra@example.com', role: 'manager', service_valid_until: '2099-12-31' };
const OWNER = { id: 'owner-race', name: 'Owner', email: 'owner-race@example.com', role: 'owner' };
const JUDGE_RACE = { id: 'judge-race', name: 'Judge Race', email: 'judge-race@example.com', role: 'judge', parent_manager_id: MANAGER.id };
const JUDGE_FF = { id: 'judge-ff', name: 'Judge FF', email: 'judge-ff@example.com', role: 'judge', parent_manager_id: MANAGER.id };

const seed = () => {
  database = createFakeSupabase({
    users: [MANAGER, OTHER_MANAGER, OWNER, JUDGE_RACE, JUDGE_FF],
    events: [
      { id: 'ev-race', name: 'Race Recife', date: '2026-11-01', location: 'Recife', organizer_id: MANAGER.id, event_type: 'fitness_racing', status: 'upcoming', event_schedule: [] },
      { id: 'ev-ff', name: 'Híbrido Games', date: '2026-11-02', location: 'Recife', organizer_id: MANAGER.id, event_type: 'functional_fitness', status: 'upcoming', event_schedule: [] },
      { id: 'ev-qualifier', name: 'Qualifier', organizer_id: MANAGER.id, event_type: 'functional_fitness_qualifier', status: 'upcoming', event_schedule: [] },
      { id: 'ev-desconhecido', name: 'Tipo novo', organizer_id: MANAGER.id, event_type: 'tipo_desconhecido', status: 'upcoming', event_schedule: [] },
      { id: 'ev-race-outra', name: 'Race da Outra', organizer_id: OTHER_MANAGER.id, event_type: 'fitness_racing', status: 'upcoming', event_schedule: [] }
    ],
    event_judges: [
      { event_id: 'ev-race', judge_user_id: JUDGE_RACE.id, created_at: '2026-10-30T10:00:00Z' },
      { event_id: 'ev-ff', judge_user_id: JUDGE_FF.id, created_at: '2026-10-30T10:00:00Z' }
    ],
    divisions: [],
    athletes: [],
    workouts: [],
    registrations: []
  });
  nextRpcError = null;
};

const cookie = (user) => `woda_session=${createSessionToken({ id: user.id, name: user.name, email: user.email, role: user.role })}`;
const persist = async (user, action, payload) => {
  const response = await postPersistence(new Request('http://localhost/api/admin/persistence', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie(user) }, body: JSON.stringify({ action, payload })
  }));
  return { status: response.status, body: await response.json() };
};
const getFrom = async (handler, path, user, query) => {
  const response = await handler(new Request(`http://localhost${path}?${new URLSearchParams(query)}`, { headers: { cookie: cookie(user) } }));
  return { status: response.status, body: await response.json() };
};
const quiet = (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});
};
const NEW_JUDGE = { name: 'Judge Nova', email: 'nova@example.com', password: 'senha-forte-1' };
const lastRpc = () => database.rpcCalls.at(-1);

// ---------------------------------------------------------------------------
// Rota: escolha da família de funções por tipo de evento (AC3, AC5)
// ---------------------------------------------------------------------------

test('evento Fitness Race: criar, atribuir e remover chamam race_*; listar devolve os judges do evento', async (t) => {
  quiet(t);
  seed();
  const created = await persist(MANAGER, 'createJudge', { eventId: 'ev-race', ...NEW_JUDGE });
  assert.equal(created.status, 200, created.body.error);
  assert.equal(lastRpc().name, 'race_create_and_assign_judge');
  assert.deepEqual(
    [lastRpc().args.p_actor_id, lastRpc().args.p_parent_manager_id, lastRpc().args.p_event_id, lastRpc().args.p_email],
    [MANAGER.id, MANAGER.id, 'ev-race', 'nova@example.com']
  );
  assert.match(lastRpc().args.p_password_hash, /^scrypt\$/);

  const assigned = await persist(MANAGER, 'assignJudgeToEvent', { eventId: 'ev-race', judgeId: JUDGE_FF.id });
  assert.equal(assigned.status, 200, assigned.body.error);
  assert.deepEqual([lastRpc().name, lastRpc().args.p_judge_id], ['race_assign_judge', JUDGE_FF.id]);

  const removed = await persist(MANAGER, 'removeJudgeFromEvent', { eventId: 'ev-race', judgeId: JUDGE_RACE.id });
  assert.equal(removed.status, 200, removed.body.error);
  assert.deepEqual([lastRpc().name, lastRpc().args.p_judge_id], ['race_remove_judge', JUDGE_RACE.id]);

  const listed = await persist(MANAGER, 'listJudges', { eventId: 'ev-race' });
  assert.equal(listed.status, 200, listed.body.error);
  assert.deepEqual(listed.body.judges.map((judge) => judge.id), [JUDGE_RACE.id], 'só os judges do evento Race');

  const byOwner = await persist(OWNER, 'createJudge', { eventId: 'ev-race', ...NEW_JUDGE, email: 'owner-cria@example.com' });
  assert.equal(byOwner.status, 200, byOwner.body.error);
  assert.deepEqual([lastRpc().name, lastRpc().args.p_parent_manager_id], ['race_create_and_assign_judge', MANAGER.id], 'a conta é do gestor do evento');
});

test('Functional Fitness e Qualifier continuam chamando as funções deles, nunca race_*', async (t) => {
  quiet(t);
  seed();
  const expected = {
    'ev-ff': ['sheet_create_and_assign_judge', 'sheet_assign_judge', 'sheet_remove_judge'],
    'ev-qualifier': ['qualifier_create_and_assign_judge', 'qualifier_assign_judge', 'qualifier_remove_judge']
  };
  for (const [eventId, names] of Object.entries(expected)) {
    const start = database.rpcCalls.length;
    assert.equal((await persist(MANAGER, 'createJudge', { eventId, ...NEW_JUDGE })).status, 200);
    assert.equal((await persist(MANAGER, 'assignJudgeToEvent', { eventId, judgeId: JUDGE_FF.id })).status, 200);
    assert.equal((await persist(MANAGER, 'removeJudgeFromEvent', { eventId, judgeId: JUDGE_FF.id })).status, 200);
    assert.equal((await persist(MANAGER, 'listJudges', { eventId })).status, 200);
    assert.deepEqual(database.rpcCalls.slice(start).map((call) => call.name), names, eventId);
  }
  assert.equal(database.rpcCalls.some((call) => call.name.startsWith('race_')), false);
});

test('tipo de evento desconhecido: mensagem genérica 400, sem chamar função; a mensagem antiga de FF não existe mais', async (t) => {
  quiet(t);
  seed();
  for (const [action, payload] of [
    ['listJudges', {}], ['createJudge', NEW_JUDGE], ['assignJudgeToEvent', { judgeId: JUDGE_FF.id }], ['removeJudgeFromEvent', { judgeId: JUDGE_FF.id }]
  ]) {
    const response = await persist(MANAGER, action, { eventId: 'ev-desconhecido', ...payload });
    assert.equal(response.status, 400, action);
    assert.equal(response.body.error, 'Este tipo de evento não aceita judges.', action);
  }
  assert.equal(database.rpcCalls.length, 0);
  const route = readFileSync(new URL('../src/app/api/admin/persistence/route.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(route, /Judges são exclusivos de eventos Functional Fitness/);
});

test('gestor de outro evento não lista, não cria, não atribui e não remove judge do evento Race', async (t) => {
  quiet(t);
  seed();
  for (const [action, payload] of [
    ['listJudges', {}], ['createJudge', NEW_JUDGE], ['assignJudgeToEvent', { judgeId: JUDGE_RACE.id }], ['removeJudgeFromEvent', { judgeId: JUDGE_RACE.id }]
  ]) {
    const response = await persist(OTHER_MANAGER, action, { eventId: 'ev-race', ...payload });
    assert.notEqual(response.status, 200, action);
    assert.match(response.body.error, /Acesso negado para este evento/, action);
  }
  assert.equal(database.rpcCalls.length, 0, 'nenhuma função chamada');
  assert.equal(database.rows('event_judges').length, 2, 'atribuições intactas');
});

// ---------------------------------------------------------------------------
// Mensagens de erro e função ausente (AC4)
// ---------------------------------------------------------------------------

test('erros das funções race_* viram mensagens claras; função ausente responde 503', async (t) => {
  quiet(t);
  seed();
  const cases = [
    ['race_event_required', 400, /exclusiva de eventos Fitness Race/],
    ['qualifier_judge_manager_mismatch', 409, /pertence a outro gestor/],
    ['qualifier_judge_conflict_of_interest', 409, /inscrito como atleta no evento/],
    ['qualifier_manager_access_expired', 403, /acesso deste gestor está expirado/],
    ['qualifier_judge_assignment_not_allowed', 403, /não tem permissão para gerenciar judges/]
  ];
  for (const action of ['createJudge', 'assignJudgeToEvent', 'removeJudgeFromEvent']) {
    for (const [message, status, text] of cases) {
      nextRpcError = { code: 'P0001', message };
      const response = await persist(MANAGER, action, { eventId: 'ev-race', judgeId: JUDGE_FF.id, ...NEW_JUDGE });
      assert.equal(response.status, status, `${action} ${message}`);
      assert.match(response.body.error, text, `${action} ${message}`);
      assert.doesNotMatch(response.body.error, new RegExp(message), 'sem o código do banco na resposta');
    }
    nextRpcError = { code: 'PGRST202', message: `Could not find the function public.${action}` };
    const missing = await persist(MANAGER, action, { eventId: 'ev-race', judgeId: JUDGE_FF.id, ...NEW_JUDGE });
    assert.equal(missing.status, 503, action);
    assert.match(missing.body.error, /migrations pendentes/);
  }
});

test('o tratamento novo vale só para Fitness Race: FF e Qualifier seguem com o 500 de antes ao criar, atribuir e remover', async (t) => {
  quiet(t);
  seed();
  const newErrors = ['race_event_required', 'qualifier_judge_assignment_not_allowed', 'qualifier_judge_manager_mismatch', 'qualifier_judge_conflict_of_interest'];
  for (const eventId of ['ev-ff', 'ev-qualifier']) {
    for (const action of ['createJudge', 'assignJudgeToEvent', 'removeJudgeFromEvent']) {
      for (const message of newErrors) {
        nextRpcError = { code: 'P0001', message };
        const response = await persist(MANAGER, action, { eventId, judgeId: JUDGE_FF.id, ...NEW_JUDGE });
        assert.equal(response.status, 500, `${eventId} ${action} ${message}`);
        assert.equal(response.body.error, 'Erro ao persistir dados.', `${eventId} ${action} ${message}`);
      }
      // Atribuir e remover nunca tiveram tratamento: função ausente segue 500; criar segue 503.
      nextRpcError = { code: 'PGRST202', message: 'Could not find the function' };
      const missing = await persist(MANAGER, action, { eventId, judgeId: JUDGE_FF.id, ...NEW_JUDGE });
      assert.equal(missing.status, action === 'createJudge' ? 503 : 500, `${eventId} ${action} PGRST202`);
    }
  }
  // O mesmo erro no Race continua 4xx com mensagem.
  nextRpcError = { code: 'P0001', message: 'qualifier_judge_conflict_of_interest' };
  assert.equal((await persist(MANAGER, 'assignJudgeToEvent', { eventId: 'ev-race', judgeId: JUDGE_FF.id })).status, 409);
});

// ---------------------------------------------------------------------------
// Acesso do judge (AC7)
// ---------------------------------------------------------------------------

test('judge atribuído ao Race só vê o Race em /api/race-sheets e nada em /api/sheets; o de FF, o contrário', async (t) => {
  quiet(t);
  seed();
  const raceEvents = (user) => getFrom(getRace, '/api/race-sheets', user, { view: 'events' });
  const courtEvents = (user) => getFrom(getSheets, '/api/sheets', user, { view: 'events' });

  assert.deepEqual((await raceEvents(JUDGE_RACE)).body.events.map((event) => event.id), ['ev-race']);
  assert.deepEqual((await courtEvents(JUDGE_RACE)).body.events, [], 'judge do Race não abre súmula de FF');
  assert.deepEqual((await courtEvents(JUDGE_FF)).body.events.map((event) => event.id), ['ev-ff']);
  assert.deepEqual((await raceEvents(JUDGE_FF)).body.events, [], 'judge de FF não abre súmula de Race');

  // Atribuído ao Race (pela função race_assign_judge, simulada aqui), passa a ver o Race.
  database.rows('event_judges').push({ event_id: 'ev-race', judge_user_id: JUDGE_FF.id });
  assert.deepEqual((await raceEvents(JUDGE_FF)).body.events.map((event) => event.id), ['ev-race']);
  assert.deepEqual((await courtEvents(JUDGE_FF)).body.events.map((event) => event.id), ['ev-ff']);
});

// ---------------------------------------------------------------------------
// Migration (AC1, AC2)
// ---------------------------------------------------------------------------

const MIGRATION = '20261030130000_race_judges.sql';
const RACE_SHEETS = '20261030120000_race_sheets.sql';
const migrationsDir = new URL('../supabase/migrations/', import.meta.url);
const readMigration = (name) => readFileSync(new URL(name, migrationsDir), 'utf8');
const allMigrations = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();
const migration = readMigration(MIGRATION);
const sql = migration.replace(/--[^\n]*/g, '');
const FUNCTIONS = {
  race_assign_judge: '(TEXT, TEXT, TEXT)',
  race_remove_judge: '(TEXT, TEXT, TEXT)',
  race_create_and_assign_judge: '(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)'
};
/** Corpo da função, do CREATE até o `$$;` que fecha. */
const functionBody = (name) => {
  const match = sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(([\\s\\S]*?)\\$\\$;`));
  assert.ok(match, `${name} ausente`);
  return match[1];
};

test('a migration vem depois da 1.94 e só cria as três funções race_*', () => {
  assert.ok(allMigrations.indexOf(MIGRATION) > allMigrations.indexOf(RACE_SHEETS));
  assert.ok(allMigrations.indexOf(RACE_SHEETS) >= 0);
  const created = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map((match) => match[1]).sort();
  assert.deepEqual(created, Object.keys(FUNCTIONS).sort());
  assert.equal((sql.match(/CREATE (OR REPLACE )?FUNCTION/g) || []).length, 3);
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION (public\.)?(sheet_|qualifier_)/);
  assert.doesNotMatch(sql, /\bCREATE TABLE\b|\bALTER TABLE\b|\bDROP\b|\bTRIGGER\b|\bPOLICY\b|\bTRUNCATE\b/i);
});

test('SECURITY DEFINER, search_path fixo, REVOKE de PUBLIC/anon/authenticated e GRANT só para service_role', () => {
  for (const [name, signature] of Object.entries(FUNCTIONS)) {
    const body = functionBody(name);
    assert.match(body, /SECURITY DEFINER\s+SET search_path = public/, name);
    const escaped = signature.replace(/[()]/g, '\\$&');
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}${escaped} FROM PUBLIC, anon, authenticated;`), name);
    assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}${escaped} TO service_role;`), name);
  }
  assert.equal((sql.match(/\bGRANT\b/g) || []).length, 3);
  assert.doesNotMatch(sql, /TO (anon|authenticated|PUBLIC)/);
});

test('mesmas regras de sheet_assign_judge: só Fitness Race, gestor dono com acesso válido, judge do gestor, sem conflito de interesse', () => {
  for (const name of ['race_assign_judge', 'race_remove_judge']) {
    const body = functionBody(name);
    assert.match(body, /WHERE id = p_event_id AND event_type = 'fitness_racing';\s+IF NOT FOUND THEN RAISE EXCEPTION 'race_event_required'; END IF;/, name);
    assert.match(body, /v_actor\.role = 'manager' AND v_event\.organizer_id <> v_actor\.id\) OR v_actor\.role NOT IN \('owner', 'manager'\)/, name);
    assert.match(body, /timezone\('America\/Fortaleza', NOW\(\)\)::DATE[\s\S]*RAISE EXCEPTION 'qualifier_manager_access_expired'/, name);
  }
  const assign = functionBody('race_assign_judge');
  assert.match(assign, /v_judge\.parent_manager_id <> v_event\.organizer_id THEN RAISE EXCEPTION 'qualifier_judge_manager_mismatch'/);
  assert.match(assign, /r\.user_id = p_judge_id\s+OR lower\(coalesce\(r\.athlete_email, ''\)\) = lower\(v_judge\.email\)/);
  assert.match(assign, /<> 'payment_cancelled'[\s\S]*RAISE EXCEPTION 'qualifier_judge_conflict_of_interest'/);
  assert.match(assign, /ON CONFLICT \(event_id, judge_user_id\) DO NOTHING/);
  assert.match(functionBody('race_remove_judge'), /DELETE FROM event_judges WHERE event_id = p_event_id AND judge_user_id = p_judge_id;/);
  const create = functionBody('race_create_and_assign_judge');
  assert.match(create, /v_judge := qualifier_create_judge\(\s*p_actor_id, p_parent_manager_id, p_judge_id, p_name, p_email, p_password_hash\s*\);\s*PERFORM race_assign_judge\(p_actor_id, p_event_id, p_judge_id\);/);
});

test('cabeçalho com story, ordem de deploy e rollback comentado; migrations anteriores intactas', () => {
  assert.match(migration, /^-- .*Story 1\.95/);
  assert.match(migration, /-- Ordem de deploy: aplicar depois de 20261030120000_race_sheets\.sql/);
  for (const [name, signature] of Object.entries(FUNCTIONS)) {
    assert.match(migration, new RegExp(`--\\s+DROP FUNCTION IF EXISTS public\\.${name}${signature.replace(/[()]/g, '\\$&')};`), name);
  }
  // Impressão digital das 61 migrations até a 20261028120000 (a mesma travada pela
  // Story 1.94). A da 1.94 (race_sheets) ainda não foi aplicada e fica fora da conta.
  const previous = allMigrations.filter((name) => name < RACE_SHEETS);
  assert.equal(previous.length, 61);
  const hash = createHash('sha256');
  for (const name of previous) hash.update(`${name}\n${readMigration(name).replace(/\r\n/g, '\n')}\n`);
  assert.equal(hash.digest('hex'), 'c5ebbcac2be46f51c22b9ed08b2ec4593267c3b7ef31e64c420d8b4a47e9bcf3', 'migration já aplicada foi alterada');
  for (const name of allMigrations.filter((item) => item < MIGRATION)) {
    assert.doesNotMatch(readMigration(name), /\brace_(assign|remove|create_and_assign)_judge\b/, name);
  }
});

// ---------------------------------------------------------------------------
// Aba do admin (AC6)
// ---------------------------------------------------------------------------

test('aba "Súmula Fitness Race" só em evento Fitness Race, com o painel próprio; a aba de FF não muda', () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const admin = read('../src/app/admin/page.tsx');
  assert.match(admin, /import \{ RaceSheetPanel \} from '@\/components\/admin\/RaceSheetPanel';/);
  assert.equal((admin.match(/\| 'sheets' \| 'broadcast' \| 'race'/g) || []).length, 3, 'tipo e os dois casts');
  assert.equal((admin.match(/\.\.\.\(selectedEventToManage\.eventType === 'fitness_racing' \? \[\{ id: 'race', label: 'Súmula Fitness Race' \}\] : \[\]\),/g) || []).length, 2, 'celular e desktop');
  assert.match(admin, /\{activeEventTab === 'race' && selectedEventToManage\.eventType === 'fitness_racing' && <RaceSheetPanel event=\{selectedEventToManage\} \/>\}/);
  assert.match(admin, /\{activeEventTab === 'sheets' && \(selectedEventToManage\.eventType \|\| 'functional_fitness'\) === 'functional_fitness' && <ScoresheetsPanel event=\{selectedEventToManage\} \/>\}/);

  const container = read('../src/components/admin/RaceSheetPanel.tsx');
  assert.match(container, /<RaceJudgesPanel event=\{event\} \/>/);
  const panel = read('../src/components/admin/RaceJudgesPanel.tsx');
  assert.match(panel, /adminAction\('listJudges', \{ eventId: event\.id \}\)/);
  assert.match(panel, /adminAction\('createJudge', \{ eventId: event\.id, \.\.\.judgeForm \}\)/);
  assert.match(panel, /adminAction\('removeJudgeFromEvent', \{ eventId: event\.id, judgeId: judge\.id \}\)/);
  assert.match(panel, /window\.confirm\(/);
  assert.match(panel, /minLength=\{8\}/);
  assert.doesNotMatch(panel + container, /from '@\/components\/admin\/ScoresheetsPanel'|'\/api\/sheets/, 'não importa a súmula de FF');
});
