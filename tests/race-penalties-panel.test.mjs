import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createFakeSupabase } from './support/fakeSupabase.mjs';
import { createRaceClient } from './support/fakeRaceSupabase.mjs';
import { withRaceStartHeat } from './support/fakeRaceStartHeat.mjs';
import { importServerModule, setActiveSupabaseClient } from './support/serverModuleHarness.mjs';

// Story 1.98 (F1 da súmula Fitness Race): painel do organizador. Pela rota
// real com o banco em memória (largada pela função emulada da 1.96 e Wall Ball
// da 1.97): revogar, alterar (selo "Alterada", D19), ajustar tempo, DNF, "Sem
// tempo fechado" com a marca "Atleta saiu" (D24), ponto único de
// republicação (com substituto que falha) e a correção da largada da onda
// (Story 1.96, AC7, D14a); regras puras, renderização e estáticos.

process.env.SUPABASE_URL = 'http://supabase.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';
process.env.WODA_SESSION_SECRET = 'segredo-de-teste-painel-race';

let database = createFakeSupabase();
const state = { missingRaceTables: false, beforeUpdate: {}, beforeCount: {}, missingStartHeat: false };
const client = withRaceStartHeat(createRaceClient(() => database, state), () => database, state);
setActiveSupabaseClient(client);

const { GET, POST } = await importServerModule('app/api/race-sheets/route.ts');
const { createSessionToken } = await importServerModule('lib/serverSecurity.ts');
const decisionsModule = await importServerModule('lib/serverRaceDecisions.ts');
const engine = await importServerModule('lib/raceRules.ts');
const view = await importServerModule('lib/racePenaltiesView.ts');
const { RacePenaltiesPanel } = await importServerModule('components/admin/RacePenaltiesPanel.tsx');
const { RaceDecisionDialog } = await importServerModule('components/admin/RaceDecisionDialog.tsx');

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const MANAGER = { id: 'mgr-pen', name: 'Gestora Pen', email: 'pen@example.com', role: 'manager', service_valid_until: '2099-12-31' };
const OTHER = { id: 'mgr-outro', name: 'Gestor Outro', email: 'outro@example.com', role: 'manager', service_valid_until: '2099-12-31' };
const OWNER = { id: 'owner-pen', name: 'Dona', email: 'dona@example.com', role: 'owner' };
const JUDGE = { id: 'judge-pen', name: 'Judge Paula', email: 'paula@example.com', role: 'judge', parent_manager_id: MANAGER.id };

const EVENT = 'ev-pen';
const COURSE = [
  { id: 'run-1', name: 'Corrida 1', type: 'run', orderIndex: 0, distance: '1km' },
  { id: 'wall-balls', name: 'Wall Balls', type: 'station', orderIndex: 1, reps: 100, maleWeight: '9kg', femaleWeight: '6kg' }
];
const ATHLETES = ['ath-ana', 'ath-bia', 'ath-caio', 'ath-davi', 'ath-eva'];

const seed = () => {
  database = createFakeSupabase({
    users: [MANAGER, OTHER, OWNER, JUDGE],
    events: [{
      id: EVENT, name: 'Race Painel', date: '2026-11-01', location: 'Natal', organizer_id: MANAGER.id, event_type: 'fitness_racing', status: 'upcoming', time_zone: 'America/Fortaleza',
      event_schedule: [{ id: 'heat-1', kind: 'heat', date: '2026-11-01', time: '08:00', title: 'Onda 1', heatNumber: 1, athleteIds: ATHLETES }]
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
  decisionsModule.setRaceRunPublisher(null);
};

const cookie = (user) => `woda_session=${createSessionToken({ id: user.id, name: user.name, email: user.email, role: user.role })}`;
const post = async (user, body) => {
  const response = await POST(new Request('http://localhost/api/race-sheets', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie(user) }, body: JSON.stringify({ eventId: EVENT, ...body })
  }));
  return { status: response.status, body: await response.json() };
};
const manage = async (user = MANAGER) => {
  const response = await GET(new Request(`http://localhost/api/race-sheets?view=manage&eventId=${EVENT}`, { headers: { cookie: cookie(user) } }));
  return { status: response.status, body: await response.json() };
};
const runOf = (athleteId) => database.rows('race_runs').find((row) => row.athlete_id === athleteId);
const decisionsOf = (action) => database.rows('race_decisions').filter((row) => row.action === action);
const infractionsOfRun = (runId) => database.rows('race_infractions').filter((row) => row.run_id === runId);

let counter = 0;
const ev = (event) => ({ id: `p${(counter += 1)}`, event, deviceAt: Date.now() });
const reps = (count) => Array.from({ length: count }, () => ev({ t: 'rep' }));
const append = (attemptId, fromSeq, events) => post(JUDGE, { action: 'append', attemptId, fromSeq, events, clientNow: Date.now() });

/** Larga a onda uma hora atrás (corridas com `started_at` no passado; a fixture do evento é no futuro). */
const start = async () => {
  const started = await post(MANAGER, { action: 'start_heat', heatId: 'heat-1', clientNow: Date.now() });
  assert.equal(started.status, 200, started.body.error);
  for (const run of database.rows('race_runs')) run.started_at = new Date(Date.now() - 3_600_000).toISOString();
};
const open = async (athleteId) => {
  const opened = await post(JUDGE, { action: 'open_attempt', athleteId, stationId: 'wall-balls' });
  assert.equal(opened.status, 200, opened.body.error);
  return opened.body.attempt.id;
};
/** Corrida fechada pela súmula com magnésio (2 min vigente). Devolve { attemptId, events }. */
const finish = async (athleteId, extra = []) => {
  const attemptId = await open(athleteId);
  const events = [ev({ t: 'start' }), ev({ t: 'chalk' }), ...extra, ...reps(100), ev({ t: 'release' })];
  const out = await append(attemptId, 0, events);
  assert.equal(out.status, 200, out.body.error);
  assert.equal(runOf(athleteId).status, 'finished');
  return { attemptId, events };
};
const chalkOf = (runId) => infractionsOfRun(runId).find((row) => row.code === 'chalk' || /magn/i.test(row.label));

// ---------------------------------------------------------------------------
// Acesso e motivo (AC11)
// ---------------------------------------------------------------------------

test('view=manage e ações: gestor dono e owner 200; judge e gestor de outro evento 403; sem motivo 400', async () => {
  seed();
  await start();
  await finish('ath-ana');
  assert.equal((await manage(MANAGER)).status, 200);
  assert.equal((await manage(OWNER)).status, 200);
  assert.equal((await manage(JUDGE)).status, 403);
  assert.equal((await manage(OTHER)).status, 403);
  const chalk = chalkOf(runOf('ath-ana').id);
  assert.equal((await post(JUDGE, { action: 'revoke_infraction', infractionId: chalk.id, reason: 'Teste do judge' })).status, 403);
  assert.equal((await post(OTHER, { action: 'revoke_infraction', infractionId: chalk.id, reason: 'Outro evento' })).status, 403);
  assert.equal((await post(MANAGER, { action: 'revoke_infraction', infractionId: chalk.id })).status, 400);
  assert.equal((await post(MANAGER, { action: 'revoke_infraction', infractionId: chalk.id, reason: '  ' })).status, 400);
  assert.equal(chalkOf(runOf('ath-ana').id).status, 'confirmed', 'nada mudou');
  assert.equal(database.rows('race_decisions').length, 0);
});

// ---------------------------------------------------------------------------
// Revogar, alterar e recálculo do motor (AC3, AC4; D2, D19)
// ---------------------------------------------------------------------------

test('revogar: sai da soma, grava decisão com antes e depois, e o recálculo do motor (reenvio) não reativa', async () => {
  seed();
  await start();
  const { attemptId, events } = await finish('ath-ana');
  const run = runOf('ath-ana');
  const gross = Number(run.gross_seconds);
  assert.equal(Number(run.official_seconds), gross + 120);
  const chalk = chalkOf(run.id);
  const out = await post(MANAGER, { action: 'revoke_infraction', infractionId: chalk.id, reason: 'Magnésio era da raia vizinha' });
  assert.equal(out.status, 200, out.body.error);
  assert.equal(out.body.republish.ok, true);
  assert.equal(chalkOf(run.id).status, 'revoked');
  assert.ok(chalkOf(run.id).decided_at);
  assert.equal(Number(runOf('ath-ana').official_seconds), gross);
  assert.equal(Number(runOf('ath-ana').penalty_seconds), 0);
  const [decision] = decisionsOf('revoke');
  assert.equal(decision.reason, 'Magnésio era da raia vizinha');
  assert.equal(decision.actor_role, 'manager');
  assert.equal(decision.before.status, 'confirmed');
  assert.equal(decision.after.status, 'revoked');
  assert.equal(decision.after.official_seconds, gross);

  const resend = await append(attemptId, 0, events);
  assert.equal(resend.status, 200, resend.body.error);
  assert.equal(chalkOf(run.id).status, 'revoked', 'o recálculo não reativa');
  assert.equal((await post(MANAGER, { action: 'revoke_infraction', infractionId: chalk.id, reason: 'De novo' })).status, 409);
});

test('alterar: grava antes e depois, segue confirmed com o selo "Alterada" derivado (sem status novo) e recalcula o oficial', async () => {
  seed();
  await start();
  const { attemptId, events } = await finish('ath-ana');
  const run = runOf('ath-ana');
  const gross = Number(run.gross_seconds);
  const chalk = chalkOf(run.id);
  assert.equal((await post(MANAGER, { action: 'adjust_infraction', infractionId: chalk.id, seconds: 120, reason: 'Nada mudou' })).status, 400);
  const out = await post(OWNER, { action: 'adjust_infraction', infractionId: chalk.id, seconds: 60, reason: 'Vídeo mostra metade' });
  assert.equal(out.status, 200, out.body.error);
  assert.equal(chalkOf(run.id).status, 'confirmed');
  assert.equal(Number(chalkOf(run.id).seconds), 60);
  assert.equal(Number(runOf('ath-ana').official_seconds), gross + 60);
  const [decision] = decisionsOf('adjust_infraction');
  assert.equal(decision.before.seconds, 120);
  assert.equal(decision.after.seconds, 60);
  assert.equal(decision.actor_role, 'owner');

  await append(attemptId, 0, events);
  assert.equal(Number(chalkOf(run.id).seconds), 60, 'o recálculo não desfaz a alteração');

  const board = (await manage()).body;
  const item = board.penalties.find((row) => row.id === chalk.id);
  assert.equal(item.altered, true);
  assert.equal(item.originalSeconds, 120);
  assert.equal(item.status, 'confirmed');
  assert.ok(!view.RACE_PENALTY_STATUSES.includes('altered'));
  assert.doesNotMatch(read('../supabase/migrations/20261030120000_race_sheets.sql').match(/race_infractions_status_check[^\n]*/)[0], /alter/);
});

test('[AUTO-DECISION] o desfazer do árbitro não cancela a infração que o organizador já decidiu; cancela a não decidida', async () => {
  seed();
  await start();
  const attemptId = await open('ath-ana');
  await append(attemptId, 0, [ev({ t: 'start' }), ev({ t: 'chalk' }), ...reps(5), ev({ t: 'chalk' })]);
  const run = runOf('ath-ana');
  const chalks = infractionsOfRun(run.id).filter((row) => row.kind === 'penalty').sort((a, b) => a.source_seq - b.source_seq);
  assert.equal(chalks.length, 2);
  assert.equal((await post(MANAGER, { action: 'revoke_infraction', infractionId: chalks[0].id, reason: 'Decisão do organizador' })).status, 200);
  const undo = await append(attemptId, 8, [ev({ t: 'undo', of: 1 }), ev({ t: 'undo', of: 7 })]);
  assert.equal(undo.status, 200, undo.body.error);
  const after = Object.fromEntries(infractionsOfRun(run.id).map((row) => [row.id, row.status]));
  assert.equal(after[chalks[0].id], 'revoked', 'decisão do organizador prevalece');
  assert.equal(after[chalks[1].id], 'cancelled', 'a não decidida é cancelada pelo desfazer');
});

// ---------------------------------------------------------------------------
// Tempo e DNF (AC7, AC8)
// ---------------------------------------------------------------------------

test('ajustar tempo: racing vira finished com bruto manual e oficial = bruto + vigentes; finished recalcula', async () => {
  seed();
  await start();
  const attemptId = await open('ath-davi');
  await append(attemptId, 0, [ev({ t: 'start' }), ev({ t: 'chalk' })]);
  const run = runOf('ath-davi');
  assert.equal((await post(MANAGER, { action: 'adjust_time', runId: run.id, grossSeconds: -1, reason: 'Inválido' })).status, 400);
  const out = await post(MANAGER, { action: 'adjust_time', runId: run.id, grossSeconds: 4360, reason: 'Cronômetro do staff' });
  assert.equal(out.status, 200, out.body.error);
  const after = runOf('ath-davi');
  assert.equal(after.status, 'finished');
  assert.equal(after.time_source, 'manual');
  assert.equal(Number(after.official_seconds), 4480);
  assert.equal(Date.parse(after.finish_at) - Date.parse(after.started_at), 4_360_000);
  const [decision] = decisionsOf('adjust_time');
  assert.equal(decision.before.status, 'racing');
  assert.equal(decision.after.gross_seconds, 4360);
});

test('marcar DNF tira o oficial; desfazer DNF volta à situação anterior com nova decisão', async () => {
  seed();
  await start();
  await finish('ath-caio');
  const run = runOf('ath-caio');
  const official = Number(run.official_seconds);
  assert.equal((await post(JUDGE, { action: 'mark_dnf', runId: run.id, reason: 'Judge' })).status, 403);
  assert.equal((await post(MANAGER, { action: 'mark_dnf', runId: run.id, reason: 'Abandonou no km 5' })).status, 200);
  assert.equal(runOf('ath-caio').status, 'dnf');
  assert.equal(runOf('ath-caio').official_seconds, null);
  assert.equal((await post(MANAGER, { action: 'mark_dnf', runId: run.id, reason: 'De novo' })).status, 409);
  assert.equal((await post(MANAGER, { action: 'unmark_dnf', runId: run.id, reason: 'Staff errou' })).status, 200);
  assert.equal(runOf('ath-caio').status, 'finished');
  assert.equal(Number(runOf('ath-caio').official_seconds), official);
  assert.deepEqual(database.rows('race_decisions').map((row) => row.action), ['mark_dnf', 'unmark_dnf']);
});

// ---------------------------------------------------------------------------
// Sem tempo fechado com a saída registrada (AC9, D22, D24)
// ---------------------------------------------------------------------------

test('"Sem tempo fechado": atleta que saiu do Wall Ball aparece com horário, reps e árbitro; depois do undo da saída a marca some', async () => {
  seed();
  await start();
  const attemptId = await open('ath-bia');
  await append(attemptId, 0, [ev({ t: 'start' }), ...reps(40), ev({ t: 'abandon' })]);
  // Wall Ball é 1 atleta por judge (Story 1.103, AC3): o Caio é aberto pela gestora.
  const caioOpened = await post(MANAGER, { action: 'open_attempt', athleteId: 'ath-caio', stationId: 'wall-balls' });
  assert.equal(caioOpened.status, 200, caioOpened.body.error);
  const board = (await manage()).body;
  const runs = view.listNoTimeRuns(board.runs);
  const bia = runs.find((row) => row.athleteName === 'Bia Lima');
  assert.ok(bia, 'a corrida com saída fica em "Sem tempo fechado"');
  assert.equal(bia.closingStation.abandoned, true);
  assert.ok(bia.closingStation.abandonAt);
  const line = view.describeRaceNoTimeReason(bia.closingStation, () => '09:41:12');
  assert.equal(line, 'Atleta saiu do Wall Ball às 09:41:12 com 40 de 100 reps (árbitro Judge Paula).');
  const caio = runs.find((row) => row.athleteName === 'Caio Reis');
  assert.match(view.describeRaceNoTimeReason(caio.closingStation, () => ''), /árbitro não liberou/);

  await append(attemptId, 42, [ev({ t: 'undo', of: 41 })]);
  const again = view.listNoTimeRuns((await manage()).body.runs).find((row) => row.athleteName === 'Bia Lima');
  assert.equal(again.closingStation.abandoned, false);
  assert.doesNotMatch(view.describeRaceNoTimeReason(again.closingStation, () => ''), /saiu/);
});

// ---------------------------------------------------------------------------
// Republicação (AC12)
// ---------------------------------------------------------------------------

test('falha no ponto de republicação não desfaz a decisão, volta como aviso e "Tentar de novo" (republish_run) refaz', async () => {
  seed();
  await start();
  await finish('ath-ana');
  const run = runOf('ath-ana');
  decisionsModule.setRaceRunPublisher(() => { throw new Error('placar fora do ar'); });
  const out = await post(MANAGER, { action: 'mark_dnf', runId: run.id, reason: 'Atalho' });
  assert.equal(out.status, 200, out.body.error);
  assert.equal(out.body.republish.ok, false);
  assert.deepEqual(out.body.republish.failedRunIds, [run.id]);
  assert.match(out.body.republish.warning, /Decisão gravada/);
  assert.equal(runOf('ath-ana').status, 'dnf', 'a decisão ficou');
  assert.equal(decisionsOf('mark_dnf').length, 1);

  const calls = [];
  decisionsModule.setRaceRunPublisher((_, row) => { calls.push(row.status); });
  const retry = await post(MANAGER, { action: 'republish_run', runIds: [run.id] });
  assert.equal(retry.status, 200, retry.body.error);
  assert.equal(retry.body.republish.ok, true);
  assert.deepEqual(calls, ['dnf']);
  assert.equal((await post(JUDGE, { action: 'republish_run', runIds: [run.id] })).status, 403);
});

// ---------------------------------------------------------------------------
// Correção da largada da onda (Story 1.96, AC7, D14a)
// ---------------------------------------------------------------------------

test('adjust_heat_start: só gestor dono e owner, motivo obrigatório; atualiza race_heat_marks e race_runs juntos, recalcula o bruto das corridas fechadas e republica cada uma', async () => {
  seed();
  const published = [];
  decisionsModule.setRaceRunPublisher((_, run) => { published.push(run.id); });
  await start();
  await finish('ath-ana');
  await open('ath-bia');
  const mark = database.rows('race_heat_marks')[0];
  // A largada "registrada" passa a ser a das corridas (uma hora atrás).
  mark.started_at = runOf('ath-ana').started_at;
  const registered = mark.started_at;
  const runA = runOf('ath-ana');
  const oldGross = Number(runA.gross_seconds);
  const startMs = Date.parse(mark.started_at);
  const fmt = (ms) => new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Fortaleza', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
  const newStartMs = Math.floor((startMs - 60_000) / 1000) * 1000;
  const clock = fmt(newStartMs);

  assert.equal((await post(JUDGE, { action: 'adjust_heat_start', heatId: 'heat-1', clock, reason: 'Judge' })).status, 403);
  assert.equal((await post(OTHER, { action: 'adjust_heat_start', heatId: 'heat-1', clock, reason: 'Outro' })).status, 403);
  assert.equal((await post(MANAGER, { action: 'adjust_heat_start', heatId: 'heat-1', clock })).status, 400);
  assert.equal((await post(MANAGER, { action: 'adjust_heat_start', heatId: 'heat-1', clock: '25:00:00', reason: 'Inválido' })).status, 400);
  // Uma hora à frente só é "futuro" no mesmo dia: depois das 23h o relógio vira o dia e cai no passado.
  const day = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza' }).format(new Date(ms));
  if (day(Date.now() + 3_600_000) === day(Date.now())) {
    assert.equal((await post(MANAGER, { action: 'adjust_heat_start', heatId: 'heat-1', clock: fmt(Date.now() + 3_600_000), reason: 'Futuro' })).status, 400);
  }

  const out = await post(MANAGER, { action: 'adjust_heat_start', heatId: 'heat-1', clock, reason: 'Buzina tocou um minuto antes' });
  assert.equal(out.status, 200, out.body.error);
  assert.equal(Date.parse(database.rows('race_heat_marks')[0].started_at), newStartMs);
  for (const row of database.rows('race_runs')) assert.equal(Date.parse(row.started_at), newStartMs, 'race_runs.started_at junto');
  const expected = Math.round(Date.parse(runOf('ath-ana').finish_at) - newStartMs) / 1000;
  assert.equal(Number(runOf('ath-ana').gross_seconds), expected);
  assert.ok(expected > oldGross);
  assert.equal(Number(runOf('ath-ana').official_seconds), expected + 120);
  assert.equal(runOf('ath-bia').gross_seconds, null, 'corrida em andamento só muda a largada');
  const [decision] = decisionsOf('adjust_heat_start');
  assert.equal(decision.heat_id, 'heat-1');
  assert.equal(decision.before.started_at, registered);
  assert.equal(Date.parse(decision.after.started_at), newStartMs);
  // Story 1.99 (AC1): o fechamento pela súmula também passa pelo ponto único; depois, a correção da largada.
  assert.deepEqual(published, [runA.id, runA.id]);
});

test('[REL-002] adjust_heat_start com um atleta liberado no meio do laço: converge numa chamada; e repetir o mesmo horário refaz só a corrida que ficou com a largada antiga', async () => {
  seed();
  const published = [];
  decisionsModule.setRaceRunPublisher((_, run) => { published.push(run.id); });
  await start();
  await finish('ath-ana');
  await open('ath-bia');
  const mark = database.rows('race_heat_marks')[0];
  mark.started_at = runOf('ath-ana').started_at;
  const oldStart = mark.started_at;
  const runB = runOf('ath-bia');
  const fmt = (ms) => new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Fortaleza', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
  const newStartMs = Math.floor((Date.parse(oldStart) - 60_000) / 1000) * 1000;
  const clock = fmt(newStartMs);
  const bFinish = Date.parse(oldStart) + 2_400_000;

  // A liberação da última estação (o Wall Ball, neste percurso) da Bia fecha a corrida dela (com a largada antiga) no meio do laço.
  state.beforeUpdate.race_runs = (db) => {
    Object.assign(db.rows('race_runs').find((row) => row.id === runB.id), {
      status: 'finished', finish_at: new Date(bFinish).toISOString(), gross_seconds: 2400, penalty_seconds: 0, official_seconds: 2400, time_source: 'sheet', updated_at: new Date().toISOString()
    });
  };
  const out = await post(MANAGER, { action: 'adjust_heat_start', heatId: 'heat-1', clock, reason: 'Buzina tocou um minuto antes' });
  assert.equal(out.status, 200, out.body.error);
  assert.equal(state.beforeUpdate.race_runs, undefined, 'o gatilho rodou');
  assert.equal(Date.parse(database.rows('race_heat_marks')[0].started_at), newStartMs);
  for (const row of database.rows('race_runs')) assert.equal(Date.parse(row.started_at), newStartMs, `${row.athlete_id} com a largada nova`);
  const expectedB = Math.round(bFinish - newStartMs) / 1000;
  assert.equal(Number(runOf('ath-bia').gross_seconds), expectedB);
  assert.equal(Number(runOf('ath-bia').official_seconds), expectedB);
  assert.ok(published.includes(runB.id), 'a corrida que fechou no meio é republicada');

  // Estado parcial (uma corrida ficou com a largada antiga): repetir o mesmo horário refaz só ela.
  runOf('ath-caio').started_at = oldStart;
  const again = await post(MANAGER, { action: 'adjust_heat_start', heatId: 'heat-1', clock, reason: 'Repetindo a correção' });
  assert.equal(again.status, 200, again.body.error);
  assert.equal(again.body.runsUpdated, 1);
  assert.equal(Date.parse(runOf('ath-caio').started_at), newStartMs);
  assert.equal(Number(runOf('ath-bia').gross_seconds), expectedB, 'a já certa não muda');
  const done = await post(MANAGER, { action: 'adjust_heat_start', heatId: 'heat-1', clock, reason: 'De novo' });
  assert.equal(done.status, 400, 'com a marca e todas as corridas certas, segue o 400');
  assert.match(done.body.error, /já é o horário/);
});

// ---------------------------------------------------------------------------
// Regras puras (racePenaltiesView.ts)
// ---------------------------------------------------------------------------

test('racePenaltiesView: filtro por situação (padrão em vigor), categoria e busca sem acento; contagem; selo "Alterada"', () => {
  const items = [
    { id: 'a', status: 'confirmed', athleteName: 'Éva Prado', divisionId: 'w', createdAt: '2026-10-30T10:00:00Z' },
    { id: 'b', status: 'confirmed', athleteName: 'Caio Reis', divisionId: 'm', createdAt: '2026-10-30T11:00:00Z' },
    { id: 'c', status: 'revoked', athleteName: 'Eva Lima', divisionId: 'w', createdAt: '2026-10-30T09:00:00Z' }
  ];
  assert.deepEqual(view.filterRacePenalties(items, { status: 'confirmed', query: '', divisionId: '' }).map((row) => row.id), ['b', 'a']);
  assert.deepEqual(view.filterRacePenalties(items, { status: 'confirmed', query: 'eva', divisionId: '' }).map((row) => row.id), ['a']);
  assert.deepEqual(view.filterRacePenalties(items, { status: 'confirmed', query: '', divisionId: 'm' }).map((row) => row.id), ['b']);
  assert.deepEqual(view.countRacePenaltiesByStatus(items, 'eva', ''), { confirmed: 1, pending: 0, revoked: 1, cancelled: 0 });
  const decisions = [{ action: 'adjust_infraction', infractionId: 'a', before: { seconds: 120 }, createdAt: '2026-10-30T10:05:00Z' }, { action: 'revoke', infractionId: 'b', before: {}, createdAt: '2026-10-30T10:06:00Z' }];
  assert.equal(view.isRaceInfractionAltered('a', decisions), true);
  assert.equal(view.isRaceInfractionAltered('b', decisions), false);
  assert.equal(view.originalRaceInfractionSeconds('a', decisions), 120);
  assert.deepEqual([...view.RACE_PENALTY_STATUSES], ['confirmed', 'pending', 'revoked', 'cancelled']);
});

test('racePenaltiesView: tempo, penalidade, ações por situação e motivo', () => {
  assert.equal(view.formatRaceDuration(4360), '1:12:40');
  assert.equal(view.formatRaceDuration(null), '—');
  assert.equal(view.parseRaceDuration('1:12:40'), 4360);
  assert.equal(view.parseRaceDuration('12:40'), 760);
  assert.equal(view.parseRaceDuration('1:72:40'), null);
  assert.equal(view.formatRacePenalty(120), '2 min');
  assert.equal(view.formatRacePenalty(90), '1 min 30 s');
  assert.equal(view.formatRacePenalty(0), '0 s');
  assert.deepEqual(view.raceRunActions('finished'), { adjustTime: true, markDnf: true, undoDnf: false });
  assert.equal(view.pendingDqProposals, undefined, 'não há proposta de DQ');
  assert.equal(view.raceRunActions('dnf').undoDnf, true);
  assert.equal(view.isRaceDecisionReasonValid('ok'), false);
  assert.equal(view.isRaceDecisionReasonValid('Motivo'), true);
  assert.match(view.describeRaceNoTimeReason(null, () => ''), /nenhuma súmula aberta/);
  assert.equal(view.describeRaceNoTimeReason(null, () => ''), 'Sem liberação da última estação (nenhuma súmula aberta na estação).');
});

// ---------------------------------------------------------------------------
// Renderização e estáticos (AC11, AC13, AC15)
// ---------------------------------------------------------------------------

const PAYLOAD = {
  event: { id: EVENT, name: 'Race Painel', timeZone: 'America/Fortaleza' },
  divisions: [{ id: 'div-w', name: 'Women Pro' }],
  runs: [
    { id: 'r1', status: 'finished', startedAt: '2026-10-30T11:00:00Z', finishAt: '2026-10-30T12:12:40Z', grossSeconds: 4360, penaltySeconds: 120, officialSeconds: 4480, timeSource: 'sheet', athleteId: 'a1', athleteName: 'Ana Souza', box: '', divisionId: 'div-w', divisionName: 'Women Pro', heatId: 'heat-1', heatTitle: 'Onda 1', closingStation: null },
    { id: 'r2', status: 'dnf', startedAt: '2026-10-30T11:00:00Z', finishAt: null, grossSeconds: null, penaltySeconds: 0, officialSeconds: null, timeSource: null, athleteId: 'a2', athleteName: 'Bia Lima', box: '', divisionId: 'div-w', divisionName: 'Women Pro', heatId: 'heat-1', heatTitle: 'Onda 1', closingStation: null },
    { id: 'r3', status: 'racing', startedAt: '2026-10-30T11:00:00Z', finishAt: null, grossSeconds: null, penaltySeconds: 0, officialSeconds: null, timeSource: null, athleteId: 'a3', athleteName: 'Éva Prado', box: '', divisionId: 'div-w', divisionName: 'Women Pro', heatId: 'heat-1', heatTitle: 'Onda 1', closingStation: { stationName: 'Wall Balls', kind: 'wall_ball', status: 'running', validReps: 40, targetReps: 100, units: 0, expectedUnits: null, abandoned: true, abandonAt: '2026-10-30T12:41:12Z', exitAt: null, judgeName: 'Judge Paula' } }
  ],
  penalties: [
    { id: 'i1', runId: 'r1', athleteName: 'Ana Souza', divisionId: 'div-w', divisionName: 'Women Pro', stationName: 'Wall Balls', label: 'Magnésio no Wall Ball', note: null, kind: 'penalty', seconds: 60, status: 'confirmed', origin: 'engine', createdByName: 'Judge Paula', createdAt: '2026-10-30T12:00:00Z', altered: true, originalSeconds: 120 },
    { id: 'i2', runId: 'r3', athleteName: 'Éva Prado', divisionId: 'div-w', divisionName: 'Women Pro', stationName: 'Wall Balls', label: 'Ajuda externa', note: null, kind: 'penalty', seconds: 120, status: 'confirmed', origin: 'engine', createdByName: 'Judge Paula', createdAt: '2026-10-30T12:10:00Z', altered: false, originalSeconds: null }
  ],
  decisions: [],
  ruleset: { id: 'rs', version: 1, preset: '2026_27', name: 'Fitness Race 2026/27', verified: false, lockedAt: '2026-10-30T11:00:00Z', used: true, general: [] }
};

test('renderização: cartões (sem tabela), penalidades com "Alterar" e "Revogar" e selo "Alterada", linha "Atleta saiu"; sem DQ, infração geral e regulamento', () => {
  const html = renderToStaticMarkup(createElement(RacePenaltiesPanel, { event: { id: EVENT }, initialPayload: PAYLOAD }));
  assert.doesNotMatch(html, /<table/);
  assert.match(html, /data-penalty-card/);
  assert.match(html, /Alterada/);
  assert.match(html, /line-through[^>]*>120 s/);
  assert.match(html, / Alterar<\/button>/);
  assert.match(html, / Revogar<\/button>/);
  assert.match(html, /Buscar atleta/);
  assert.match(html, /Todas as categorias/);
  assert.match(html, /Atleta saiu do Wall Ball às 09:41:12 com 40 de 100 reps \(árbitro Judge Paula\)/);
  assert.match(html, /Lançar à mão/);
  const cards = html.split('data-run-card=').slice(1);
  const card = (status) => cards.find((chunk) => chunk.startsWith(`"${status}"`));
  assert.match(card('finished'), /Marcar DNF/);
  assert.match(card('dnf'), /Desfazer DNF/);
  assert.doesNotMatch(html, /DQ|Desclassific|Propostas|Lançar infração geral|Regulamento do evento|Valores de penalidade/);
  assert.doesNotMatch(html, /Rejeitadas/);
  assert.doesNotMatch(html, /Alteradas</, 'Alterada não é filtro de situação');
});

test('renderização do modal: justificativa obrigatória, tempo oficial antes e depois e confirmação explícita na ação grave', () => {
  const html = renderToStaticMarkup(createElement(RaceDecisionDialog, {
    title: 'Revogar penalidade', reasonLabel: 'Motivo da revogação', officialBefore: 4480, officialAfter: null,
    confirmText: 'Revogar', danger: true, explicitConfirm: 'Confirmo a revogação.', onSubmit: async () => {}, onClose: () => {}
  }));
  assert.match(html, /role="dialog"/);
  assert.match(html, /Motivo da revogação/);
  assert.match(html, /<textarea[^>]*required/);
  assert.match(html, /1:14:40/);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /min-h-11/);
});

test('modal: o foco vai ao primeiro campo só ao abrir; o recarregamento do painel (onClose novo) e o "salvando" não puxam o cursor', () => {
  const dialog = read('../src/components/admin/RaceDecisionDialog.tsx');
  // O efeito do foco e do Esc roda uma vez (dependências vazias) e lê onClose/busy por referência.
  assert.match(dialog, /first\?\.focus\(\);[\s\S]*?if \(event\.key === 'Escape' && !busyRef\.current\) closeRef\.current\(\);[\s\S]*?return \(\) => window\.removeEventListener\('keydown', onKey\);\s*\}, \[\]\);/);
  assert.match(dialog, /closeRef\.current = onClose;\s*busyRef\.current = busy;\s*\}, \[onClose, busy\]\);/);
  assert.doesNotMatch(dialog, /\}, \[busy, onClose\]\);/);
  // O painel recarrega sozinho e passa um onClose novo a cada render: era isso que puxava o foco.
  assert.match(read('../src/components/admin/RacePenaltiesPanel.tsx'), /onClose=\{\(\) => setModal\(null\)\}/);
});

test('estático: painel sem <table>, admin/page.tsx sem lógica de Race nova, FF intacto e ações com limite próprio', () => {
  const panel = read('../src/components/admin/RacePenaltiesPanel.tsx');
  assert.doesNotMatch(panel, /<table/);
  assert.doesNotMatch(panel, /overflow-x-auto/);
  const admin = read('../src/app/admin/page.tsx');
  assert.doesNotMatch(admin, /RacePenaltiesPanel|serverRaceDecisions|racePenaltiesView/);
  assert.match(read('../src/components/admin/RaceSheetPanel.tsx'), /<RacePenaltiesPanel event=\{event\} \/>/);
  assert.match(read('../src/components/admin/RaceWavesPanel.tsx'), /Corrigir largada/);
  const route = read('../src/app/api/race-sheets/route.ts');
  for (const action of ['revoke_infraction', 'adjust_infraction', 'adjust_time', 'mark_dnf', 'unmark_dnf', 'adjust_heat_start', 'republish_run']) {
    assert.match(route, new RegExp(`\\b${action}: \\d+`), `limite de ${action}`);
  }
  for (const gone of ['decide_dq', 'disqualify_run', 'undo_dq', 'add_infraction', 'set_ruleset']) {
    assert.doesNotMatch(route, new RegExp(`\\b${gone}\\b`), `${gone} saiu da rota`);
  }
  assert.match(route, /view === 'manage'[\s\S]*?assertRaceManagerAccess/);
  assert.doesNotMatch(read('../src/components/admin/ScoresheetsPanel.tsx'), /race/i);
  assert.doesNotMatch(read('../src/app/api/sheets/route.ts'), /serverRaceDecisions/);
  assert.doesNotMatch(read('../src/lib/bootstrapPayload.ts'), /race_decisions|race_infractions/);
});
