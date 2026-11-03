import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createFakeSupabase } from './support/fakeSupabase.mjs';
import { createRaceClient } from './support/fakeRaceSupabase.mjs';
import { withRaceStartHeat } from './support/fakeRaceStartHeat.mjs';
import { importServerModule, setActiveSupabaseClient } from './support/serverModuleHarness.mjs';

// Story 1.107: "Zerar largada" da onda no painel do organizador. Pela rota
// real com o banco em memória (largada pela função emulada da 1.96, Wall Ball
// da 1.97 e publicação da 1.99): acesso e motivo, corridas e tentativas
// canceladas, resultado fora do leaderboard, marca apagada, decisão gravada,
// largar de novo, largada antiga da fila do aparelho recusada e regulamento
// renovado só quando não sobra corrida ativa no evento; estáticos do painel.

process.env.SUPABASE_URL = 'http://supabase.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';
process.env.WODA_SESSION_SECRET = 'segredo-de-teste-zerar-largada';

let database = createFakeSupabase();
const state = { missingRaceTables: false, beforeUpdate: {}, beforeCount: {}, missingStartHeat: false };
const client = withRaceStartHeat(createRaceClient(() => database, state), () => database, state);
setActiveSupabaseClient(client);

const { GET, POST } = await importServerModule('app/api/race-sheets/route.ts');
const { createSessionToken } = await importServerModule('lib/serverSecurity.ts');
const decisionsModule = await importServerModule('lib/serverRaceDecisions.ts');
const publication = await importServerModule('lib/serverRacePublication.ts');
const view = await importServerModule('lib/racePenaltiesView.ts');

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const MANAGER = { id: 'mgr-zero', name: 'Gestora Zero', email: 'zero@example.com', role: 'manager', service_valid_until: '2099-12-31' };
const OTHER = { id: 'mgr-outro-zero', name: 'Gestor Outro', email: 'outro-zero@example.com', role: 'manager', service_valid_until: '2099-12-31' };
const OWNER = { id: 'owner-zero', name: 'Dona', email: 'dona-zero@example.com', role: 'owner' };
const JUDGE = { id: 'judge-zero', name: 'Judge Rita', email: 'rita@example.com', role: 'judge', parent_manager_id: MANAGER.id };

const EVENT = 'ev-zero';
const COURSE = [
  { id: 'run-1', name: 'Corrida 1', type: 'run', orderIndex: 0, distance: '1km' },
  { id: 'wall-balls', name: 'Wall Balls', type: 'station', orderIndex: 1, reps: 100, maleWeight: '9kg', femaleWeight: '6kg' }
];

const seed = () => {
  database = createFakeSupabase({
    users: [MANAGER, OTHER, OWNER, JUDGE],
    events: [{
      id: EVENT, name: 'Race Zerar', date: '2026-11-01', location: 'Natal', organizer_id: MANAGER.id, event_type: 'fitness_racing', status: 'upcoming', time_zone: 'America/Fortaleza',
      event_schedule: [
        { id: 'heat-1', kind: 'heat', date: '2026-11-01', time: '08:00', title: 'Onda 1', heatNumber: 1, athleteIds: ['ath-ana', 'ath-bia', 'ath-caio'] },
        { id: 'heat-2', kind: 'heat', date: '2026-11-01', time: '08:30', title: 'Onda 2', heatNumber: 2, athleteIds: ['ath-davi', 'ath-eva'] }
      ]
    }],
    event_judges: [{ event_id: EVENT, judge_user_id: JUDGE.id }],
    divisions: [
      { id: 'div-w', event_id: EVENT, name: 'Women Pro', type: 'individual', category: 'female', course_layout: COURSE },
      { id: 'div-m', event_id: EVENT, name: 'Men Pro', type: 'individual', category: 'male', course_layout: COURSE }
    ],
    athletes: [
      { id: 'ath-ana', name: 'Ana Souza', box: 'Box Norte', division_id: 'div-w' },
      { id: 'ath-bia', name: 'Bia Lima', box: 'Box Sul', division_id: 'div-w' },
      { id: 'ath-caio', name: 'Caio Reis', box: 'Box Leste', division_id: 'div-m' },
      { id: 'ath-davi', name: 'Davi Melo', box: 'Box Oeste', division_id: 'div-m' },
      { id: 'ath-eva', name: 'Éva Prado', box: 'Box Centro', division_id: 'div-w' }
    ],
    workouts: [], scores: [], registrations: []
  });
  decisionsModule.setRaceRunPublisher(publication.publishRaceRun);
};

const cookie = (user) => `woda_session=${createSessionToken({ id: user.id, name: user.name, email: user.email, role: user.role })}`;
const post = async (user, body) => {
  const response = await POST(new Request('http://localhost/api/race-sheets', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie(user) }, body: JSON.stringify({ eventId: EVENT, ...body })
  }));
  return { status: response.status, body: await response.json() };
};
const waves = async () => {
  const response = await GET(new Request(`http://localhost/api/race-sheets?view=waves&eventId=${EVENT}`, { headers: { cookie: cookie(MANAGER) } }));
  return (await response.json()).waves;
};
const runsOf = (heatId) => database.rows('race_runs').filter((row) => row.heat_id === heatId);
const activeRunOf = (athleteId) => database.rows('race_runs').find((row) => row.athlete_id === athleteId && row.status !== 'cancelled');
const markOf = (heatId) => database.rows('race_heat_marks').find((row) => row.event_id === EVENT && row.heat_id === heatId);

let counter = 0;
const ev = (event) => ({ id: `z${(counter += 1)}`, event, deviceAt: Date.now() });

/** Larga a onda uma hora atrás (corridas com `started_at` no passado; a fixture do evento é no futuro). */
const start = async (heatId) => {
  const started = await post(MANAGER, { action: 'start_heat', heatId, clientNow: Date.now() });
  assert.equal(started.status, 200, started.body.error);
  for (const run of runsOf(heatId)) if (run.status === 'racing') run.started_at = new Date(Date.now() - 3_600_000).toISOString();
  return started.body;
};
const open = async (athleteId) => {
  const opened = await post(JUDGE, { action: 'open_attempt', athleteId, stationId: 'wall-balls' });
  assert.equal(opened.status, 200, opened.body.error);
  return opened.body.attempt.id;
};
/** Corrida fechada e publicada pela súmula (Wall Ball é a última estação). */
const finish = async (athleteId) => {
  const attemptId = await open(athleteId);
  const events = [ev({ t: 'start' }), ...Array.from({ length: 100 }, () => ev({ t: 'rep' })), ev({ t: 'release' })];
  const out = await post(JUDGE, { action: 'append', attemptId, fromSeq: 0, events, clientNow: Date.now() });
  assert.equal(out.status, 200, out.body.error);
  assert.equal(activeRunOf(athleteId).status, 'finished');
};
const reset = (user, heatId, reason = 'Teste do organizador antes da prova') => post(user, { action: 'reset_heat', heatId, reason });
/** Largar de novo vem depois do zerar no relógio do servidor (na pista, segundos depois; aqui, alguns milissegundos). */
const afterReset = () => new Promise((resolve) => setTimeout(resolve, 20));

test('reset_heat: só gestor dono e owner, motivo obrigatório, onda do cronograma e que já largou', async () => {
  seed();
  await start('heat-1');
  assert.equal((await reset(JUDGE, 'heat-1')).status, 403);
  assert.equal((await reset(OTHER, 'heat-1')).status, 403);
  assert.equal((await post(MANAGER, { action: 'reset_heat', heatId: 'heat-1' })).status, 400);
  assert.equal((await reset(MANAGER, 'heat-1', '  ')).status, 400);
  assert.equal((await reset(MANAGER, 'heat-x')).status, 404);
  const notStarted = await reset(MANAGER, 'heat-2');
  assert.equal(notStarted.status, 409);
  assert.match(notStarted.body.error, /ainda não largou/);
  assert.ok(markOf('heat-1'), 'nada mudou');
  assert.ok(runsOf('heat-1').every((row) => row.status === 'racing'));
  assert.equal(database.rows('race_decisions').length, 0);
  assert.equal((await reset(OWNER, 'heat-1')).status, 200, 'owner também zera');
});

test('reset_heat: cancela corridas e tentativas, tira o resultado do leaderboard, apaga a marca, grava a decisão e a onda larga de novo', async () => {
  seed();
  const first = await start('heat-1');
  await start('heat-2');
  await finish('ath-ana');
  const biaAttempt = await open('ath-bia');
  const anaRun = activeRunOf('ath-ana');
  assert.equal(database.rows('scores').filter((row) => row.race_run_id === anaRun.id).length, 1, 'resultado publicado');
  const before = (await waves()).find((wave) => wave.id === 'heat-1');
  assert.equal(before.runsCount, 3);
  assert.equal(before.resultsCount, 1);

  const out = await reset(MANAGER, 'heat-1', 'Ensaio com os judges');
  assert.equal(out.status, 200, out.body.error);
  assert.equal(out.body.runsCancelled, 3);
  assert.equal(out.body.attemptsCancelled, 2);
  assert.equal(out.body.resultsRemoved, 1);
  assert.equal(out.body.rulesetRenewed, false, 'a Onda 2 segue correndo');

  assert.ok(runsOf('heat-1').every((row) => row.status === 'cancelled'));
  assert.ok(runsOf('heat-2').every((row) => row.status === 'racing'), 'a outra onda não muda');
  const heat1RunIds = new Set(runsOf('heat-1').map((row) => row.id));
  assert.ok(database.rows('race_attempts').filter((row) => heat1RunIds.has(row.run_id)).every((row) => row.status === 'cancelled'));
  assert.equal(database.rows('scores').filter((row) => row.athlete_id === 'ath-ana').length, 0, 'score limpo');
  assert.ok(database.rows('race_attempt_events').length > 0, 'o log fica guardado');
  assert.equal(markOf('heat-1'), undefined);
  assert.ok(markOf('heat-2'));

  const [decision] = database.rows('race_decisions').filter((row) => row.action === 'reset_heat');
  assert.equal(decision.heat_id, 'heat-1');
  assert.equal(decision.actor_user_id, MANAGER.id);
  assert.equal(decision.reason, 'Ensaio com os judges');
  assert.deepEqual(decision.before, { started_at: first.startedAt, runs: 3, results: 1 });
  assert.deepEqual(decision.after, { runs_cancelled: 3, attempts_cancelled: 2, ruleset_renewed: false });
  assert.equal(view.RACE_DECISION_LABELS.reset_heat, 'Zerou a largada');

  // Judge com o cartão aberto: a recusa que já existe.
  const late = await post(JUDGE, { action: 'append', attemptId: biaAttempt, fromSeq: 0, events: [ev({ t: 'start' })], clientNow: Date.now() });
  assert.equal(late.status, 409);

  const after = (await waves()).find((wave) => wave.id === 'heat-1');
  assert.equal(after.startedAt, null);
  assert.equal(after.runsCount, 0);
  assert.equal(after.resultsCount, 0);

  await afterReset();
  const again = await start('heat-1');
  assert.equal(again.runsCreated, 3, 'corridas novas para toda a onda');
  assert.equal(runsOf('heat-1').filter((row) => row.status === 'racing').length, 3);
  assert.equal(runsOf('heat-1').filter((row) => row.status === 'cancelled').length, 3, 'as canceladas ficam como histórico');
  assert.equal((await reset(MANAGER, 'heat-1')).status, 200, 'pode zerar de novo');
});

test('reset_heat: resultado que não sai do leaderboard interrompe antes de apagar a marca; zerar de novo termina', async () => {
  seed();
  await start('heat-1');
  await finish('ath-ana');
  decisionsModule.setRaceRunPublisher(() => { throw new Error('placar fora do ar'); });
  const failed = await reset(MANAGER, 'heat-1');
  assert.equal(failed.status, 500);
  assert.match(failed.body.error, /Zere a largada de novo/);
  assert.ok(markOf('heat-1'), 'a onda segue largada');
  assert.ok(runsOf('heat-1').every((row) => row.status === 'cancelled'));
  assert.equal(database.rows('race_decisions').length, 0);

  decisionsModule.setRaceRunPublisher(publication.publishRaceRun);
  const done = await reset(MANAGER, 'heat-1');
  assert.equal(done.status, 200, done.body.error);
  assert.equal(done.body.runsCancelled, 0, 'já estavam canceladas');
  assert.equal(database.rows('scores').filter((row) => row.athlete_id === 'ath-ana').length, 0);
  assert.equal(markOf('heat-1'), undefined);
});

test('largada guardada no aparelho antes do zerar é recusada (409 sem startedAt); a tocada depois larga', async () => {
  seed();
  await start('heat-1');
  const queuedAt = Date.now() - 1000;
  assert.equal((await reset(MANAGER, 'heat-1')).status, 200);
  const stale = await post(MANAGER, { action: 'start_heat', heatId: 'heat-1', deviceAt: queuedAt, clientNow: Date.now() });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.startedAt, undefined, 'sai da fila como recusa (classifyHeatStartResponse)');
  assert.match(stale.body.error, /antes de o organizador zerar/);
  assert.equal(markOf('heat-1'), undefined);
  await afterReset();
  const fresh = await post(MANAGER, { action: 'start_heat', heatId: 'heat-1', clientNow: Date.now() });
  assert.equal(fresh.status, 200, fresh.body.error);
});

test('regulamento: renova só quando não sobra corrida ativa; a largada seguinte lê o percurso editado', async () => {
  seed();
  await start('heat-1');
  await start('heat-2');
  const [v1] = database.rows('race_rulesets');
  assert.ok(v1.locked_at);
  // Owner aqui: o limite de 10 zerar por minuto é por pessoa, e a gestora já usou nos testes acima.
  assert.equal((await reset(OWNER, 'heat-1')).body.rulesetRenewed, false);
  assert.equal(database.rows('race_rulesets').length, 1);

  const out = await reset(OWNER, 'heat-2');
  assert.equal(out.status, 200, out.body.error);
  assert.equal(out.body.rulesetRenewed, true);
  const v2 = database.rows('race_rulesets').find((row) => row.version === 2);
  assert.ok(v2);
  assert.equal(v2.locked_at, null);
  assert.deepEqual(v2.rules, v1.rules);
  assert.equal(v2.preset, v1.preset);
  assert.equal(v1.locked_at !== null, true, 'a versão usada segue travada');
  assert.equal(database.rows('race_decisions').find((row) => row.heat_id === 'heat-2').after.ruleset_renewed, true);

  // O organizador muda o percurso depois do teste: a próxima largada usa o novo.
  database.rows('divisions').find((row) => row.id === 'div-w').course_layout = COURSE.map((stage) => (stage.id === 'wall-balls' ? { ...stage, reps: 80 } : stage));
  await afterReset();
  await start('heat-1');
  assert.ok(v2.locked_at, 'a versão nova trava na largada');
  assert.equal(v2.course['div-w'].find((stage) => stage.id === 'wall-balls').reps, 80);
  assert.ok(runsOf('heat-1').filter((row) => row.status === 'racing').every((row) => row.ruleset_id === v2.id));
  assert.ok(runsOf('heat-1').filter((row) => row.status === 'cancelled').every((row) => row.ruleset_id === v1.id));
});

test('estáticos: limite próprio na rota, botão e modal no painel Ondas, recusa da fila em startRaceHeat', () => {
  const route = read('../src/app/api/race-sheets/route.ts');
  assert.match(route, /reset_heat: 10,/);
  assert.match(route, /reset_heat: \(db, actor, eventId, body\) => resetRaceHeat\(/);
  const panel = read('../src/components/admin/RaceWavesPanel.tsx');
  assert.match(panel, /Zerar largada/);
  assert.match(panel, /action: 'reset_heat'/);
  assert.match(panel, /explicitConfirm=/);
  const sheets = read('../src/lib/serverRaceSheets.ts');
  assert.match(sheets, /readLastHeatReset\(supabaseAdmin, eventId, heatId\)/);
  assert.match(sheets, /export const renewRaceRulesetIfIdle/);
});
