import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createFakeSupabase } from './support/fakeSupabase.mjs';
import { importServerModule, setActiveSupabaseClient } from './support/serverModuleHarness.mjs';

// Story 1.119: o bootstrap do proprietário lia tabelas inteiras numa consulta só e o
// PostgREST corta em 1.000 linhas sem erro. Os gestores cadastrados por último sumiam
// do /owner (a tabela users também guarda uma conta por atleta inscrito) e os totais
// ficavam incompletos. Aqui o banco em memória corta cada leitura em 1.000 linhas.

process.env.SUPABASE_URL = 'http://supabase.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';
process.env.WODA_SESSION_SECRET = 'segredo-de-teste-story-1-119-bootstrap-paginado';

let database = createFakeSupabase();
setActiveSupabaseClient({
  from: (table) => database.client.from(table),
  rpc: (name, args) => database.client.rpc(name, args)
});

const { GET } = await importServerModule('app/api/app/bootstrap/route.ts');
const { readBootstrapPages, readBootstrapQuery, BOOTSTRAP_PAGE_SIZE } = await importServerModule('lib/bootstrapPayload.ts');
const { createSessionToken } = await importServerModule('lib/serverSecurity.ts');

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const route = read('../src/app/api/app/bootstrap/route.ts');
const payloadHelper = read('../src/lib/bootstrapPayload.ts');

const pad = (n) => String(n).padStart(5, '0');
const OWNER = { id: 'owner-1', name: 'Dono', email: 'dono@wodarena.test', role: 'owner', organization: 'WODArena' };
const OLD_MANAGER = { id: 'org-1700000000000', name: 'Gestor Antigo', email: 'antigo@wodarena.test', role: 'manager', organization: 'Box Antigo', service_valid_until: '2027-12-31' };
// Criados depois de 1.500 contas de atleta: ficam no fim da tabela, como no banco real.
const NEW_MANAGERS = [1, 2, 3].map((n) => ({
  id: `org-17624000000${n}0`,
  name: `Gestor Novo ${n}`,
  email: `novo${n}@wodarena.test`,
  role: 'manager',
  organization: `Box Novo ${n}`,
  service_valid_until: '2027-06-30'
}));
const JUDGE = { id: 'judge-mh1abc-xyz', name: 'Judge', email: 'judge@wodarena.test', role: 'judge', organization: 'Box Antigo', parent_manager_id: OLD_MANAGER.id };

const athleteUsers = Array.from({ length: 1500 }, (_, i) => ({
  id: `ath-user-17610000${pad(i)}-abcde`,
  name: `Atleta ${i}`,
  email: `atleta${i}@exemplo.test`,
  role: 'athlete',
  organization: 'Atleta WODArena'
}));

const EVENT = { id: 'evt-1', name: 'Evento Grande', organizer_id: NEW_MANAGERS[2].id, event_type: 'functional_fitness', currency: 'BRL', status: 'upcoming', date: '2026-12-01' };
const DIVISION = { id: 'div-1', event_id: EVENT.id, name: 'RX', order_index: 1 };
const WORKOUTS = [1, 2].map((n) => ({ id: `wod-${n}`, event_id: EVENT.id, name: `Prova ${n}`, order_index: n, type: 'time' }));

const athletes = Array.from({ length: 1250 }, (_, i) => ({ id: `ath-${pad(i)}`, name: `Atleta ${i}`, division_id: DIVISION.id }));
const registrations = athletes.map((athlete, i) => ({
  id: `reg-${pad(i)}`,
  event_id: EVENT.id,
  division_id: DIVISION.id,
  user_id: athleteUsers[i].id,
  athlete_id: athlete.id,
  athlete_name: athlete.name,
  athlete_email: athleteUsers[i].email,
  total_paid: 100,
  payment_status: 'payment_approved',
  created_at: new Date(Date.UTC(2026, 9, 1) + i * 60000).toISOString()
}));
const scores = athletes.flatMap((athlete) => WORKOUTS.map((workout) => ({ athlete_id: athlete.id, workout_id: workout.id, result: '10:00', value: 600 })));
const leaderboardEntries = athletes.map((athlete, i) => ({ id: `lb-${pad(i)}`, event_id: EVENT.id, division_id: DIVISION.id, athlete_id: athlete.id, athlete_name: athlete.name }));

const seed = () => {
  database = createFakeSupabase({
    users: [OWNER, OLD_MANAGER, JUDGE, ...athleteUsers, ...NEW_MANAGERS],
    events: [EVENT],
    divisions: [DIVISION],
    workouts: WORKOUTS,
    athletes,
    registrations,
    scores,
    leaderboard_entries: leaderboardEntries,
    contestations: [],
    coupons: [],
    mercadopago_accounts: []
  }, { maxRows: 1000 });
};

const quietConsole = (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'info', () => {});
};

const bootstrapAs = async (user) => {
  const response = await GET(new Request('http://localhost/api/app/bootstrap', {
    headers: { cookie: `woda_session=${createSessionToken({ id: user.id, name: user.name, email: user.email, role: user.role })}` }
  }));
  return { status: response.status, body: await response.json() };
};

test('o banco em memória corta em 1.000 linhas, como o PostgREST (sanidade do cenário)', async () => {
  seed();
  const { data } = await database.client.from('users').select('id, role');
  assert.equal(data.length, 1000);
  assert.equal(data.filter((user) => user.role === 'manager').length, 1, 'sem paginação, os gestores novos ficariam de fora');
});

test('AC1: o dono recebe todos os gestores, inclusive os criados por último, e nenhuma conta de atleta ou judge', async (t) => {
  quietConsole(t);
  seed();
  const { status, body } = await bootstrapAs(OWNER);
  assert.equal(status, 200);
  const ids = body.users.map((user) => user.id).sort();
  assert.deepEqual(ids, [OWNER.id, OLD_MANAGER.id, ...NEW_MANAGERS.map((m) => m.id)].sort());
  assert.ok(body.users.every((user) => user.role === 'owner' || user.role === 'manager'));
  assert.equal(body.currentUser.id, OWNER.id);
  const newest = body.users.find((user) => user.id === NEW_MANAGERS[2].id);
  assert.equal(newest.managerAccessStatus, 'active');
});

test('AC2: inscrições, atletas, scores e leaderboard acima de 1.000 linhas chegam inteiros, sem repetição', async (t) => {
  quietConsole(t);
  seed();
  const { body } = await bootstrapAs(OWNER);
  assert.equal(body.registrations.length, 1250);
  assert.equal(new Set(body.registrations.map((r) => r.id)).size, 1250);
  assert.equal(body.athletes.length, 1250);
  assert.equal(body.scores.length, 2500);
  assert.equal(new Set(body.scores.map((s) => `${s.athlete_id}|${s.workout_id}`)).size, 2500);
  assert.equal(body.leaderboardEntries.length, 1250);
  assert.equal(body.divisions.length, 1);
  assert.deepEqual(body.workouts.map((w) => w.id), ['wod-1', 'wod-2']);
});

test('AC5: o gestor continua lendo só o próprio usuário e os dados dos eventos dele', async (t) => {
  quietConsole(t);
  seed();
  const { status, body } = await bootstrapAs(NEW_MANAGERS[2]);
  assert.equal(status, 200);
  assert.deepEqual(body.users.map((user) => user.id), [NEW_MANAGERS[2].id]);
  assert.deepEqual(body.events.map((event) => event.id), [EVENT.id]);
});

test('AC5: o atleta continua recebendo só as próprias inscrições', async (t) => {
  quietConsole(t);
  seed();
  const athlete = athleteUsers[7];
  const { status, body } = await bootstrapAs(athlete);
  assert.equal(status, 200);
  assert.deepEqual(body.users.map((user) => user.id), [athlete.id]);
  assert.deepEqual(body.registrations.map((r) => r.id), ['reg-00007']);
});

test('readBootstrapPages avança pelo que voltou, para na página vazia e não repete linha empurrada', async (t) => {
  quietConsole(t);
  const table = Array.from({ length: 7 }, (_, i) => ({ id: `r${i}` }));
  const calls = [];
  let inserted = false;
  const rows = await readBootstrapPages('teste', async (from, to) => {
    calls.push([from, to]);
    // Uma linha nova com id menor entra depois da 1ª página: a borda é lida duas vezes.
    if (from > 0 && !inserted) {
      inserted = true;
      table.unshift({ id: 'r-novo' });
    }
    // Servidor que devolve menos do que o pedido (limite menor que a página).
    return { data: table.slice(from, Math.min(to + 1, from + 2)), error: null };
  }, undefined, 3);
  assert.deepEqual(rows.map((row) => row.id), ['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6']);
  assert.deepEqual(calls.at(-1), [8, 10], 'a última leitura é a página vazia');
});

test('AC3: erro numa página sobe como erro, nunca como lista pela metade', async (t) => {
  quietConsole(t);
  let page = 0;
  await assert.rejects(
    readBootstrapPages('inscrições do proprietário', async () => {
      page += 1;
      return page === 1 ? { data: [{ id: 'a' }], error: null } : { data: null, error: { code: '57014', message: 'timeout' } };
    }),
    /Falha ao carregar inscrições do proprietário\./
  );
});

test('AC3: leitura que nunca termina para no limite de páginas com erro', async (t) => {
  quietConsole(t);
  let n = 0;
  await assert.rejects(
    readBootstrapPages('scores', async () => ({ data: [{ id: `x${n++}` }], error: null }), undefined, 1),
    /Falha ao carregar scores\./
  );
});

test('AC4: leitura não paginada com exatamente 1.000 linhas avisa possível corte', async (t) => {
  const warnings = [];
  t.mock.method(console, 'info', () => {});
  t.mock.method(console, 'warn', (...args) => warnings.push(args.join(' ')));
  assert.equal(BOOTSTRAP_PAGE_SIZE, 1000);
  await readBootstrapQuery('eventos autenticados', Promise.resolve({ data: Array.from({ length: 1000 }, (_, i) => ({ id: i })), error: null }));
  await readBootstrapQuery('divisões do gestor', Promise.resolve({ data: [{ id: 1 }], error: null }));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Possível corte de linhas/);
  assert.match(warnings[0], /eventos autenticados/);
});

test('fonte: leituras do proprietário paginadas com ordem estável', () => {
  assert.match(route, /const OWNER_PANEL_USER_ROLES = \['owner', 'manager'\];/);
  assert.match(route, /readBootstrapPages\('usuários', \(from, to\) => supabaseAdmin\s*\.from\('users'\)[\s\S]{0,160}\.in\('role', OWNER_PANEL_USER_ROLES\)\s*\.order\('id', \{ ascending: true \}\)\s*\.range\(from, to\)\)/);
  for (const [label, table] of [
    ['atletas do proprietário', 'athletes'],
    ['scores do proprietário', 'scores'],
    ['inscrições do proprietário', 'registrations'],
    ['contestações do proprietário', 'contestations'],
    ['cupons do proprietário', 'coupons'],
    ['leaderboard do proprietário', 'leaderboard_entries'],
    ['divisões autenticadas', 'divisions'],
    ['workouts autenticados', 'workouts']
  ]) {
    const pattern = new RegExp(`readBootstrapPages\\('${label}', \\(from, to\\) => supabaseAdmin\\s*\\.from\\('${table}'\\)\\s*\\.select\\(\\w+\\)(?:\\s*\\.order\\('\\w+', \\{ ascending: true \\}\\))+\\s*\\.range\\(from, to\\)`);
    assert.match(route, pattern, label);
    assert.doesNotMatch(route, new RegExp(`readBootstrapQuery\\('${label}'`), `${label} não pode voltar a ler sem paginar`);
  }
  assert.match(route, /\.order\('athlete_id', \{ ascending: true \}\)\s*\.order\('workout_id', \{ ascending: true \}\)\s*\.range\(from, to\), scoreRowKey\)/);
  assert.match(payloadHelper, /export const readBootstrapPages = async/);
  assert.match(payloadHelper, /if \(rows\.length === 0\)/);
  assert.match(payloadHelper, /\[Bootstrap Query\] Possível corte de linhas/);
});
