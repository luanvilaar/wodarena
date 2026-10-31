import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createFakeSupabase } from './support/fakeSupabase.mjs';
import { createRaceClient } from './support/fakeRaceSupabase.mjs';
import { importServerModule, setActiveSupabaseClient } from './support/serverModuleHarness.mjs';

// Story 1.106 (F2 da súmula Fitness Race): splits por estação no resultado
// público (D37). Toda estação conferida (ergômetro, trenó, seções, genérica e
// o Wall Ball no meio do percurso) vira split com a duração na estação, do
// `start` ao `release` ou `exit`; estação sem judge, sem início ou sem fim fica
// sem chave; o registro tardio (Story 1.101, AC5) regrava os splits; racing
// não publica, DNF publica, desfazer DNF retira e o ajuste de tempo não mexe;
// nada de árbitro no split; a tela pública só mostra estações com valor. Pela
// rota real com o banco em memória (como race-closing-station.test.mjs).

process.env.SUPABASE_URL = 'http://supabase.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';
process.env.WODA_SESSION_SECRET = 'segredo-de-teste-splits-race';

let database = createFakeSupabase();
const state = { missingRaceTables: false, beforeUpdate: {}, beforeCount: {} };
const client = createRaceClient(() => database, state);
setActiveSupabaseClient(client);

const { POST } = await importServerModule('app/api/race-sheets/route.ts');
const { createSessionToken } = await importServerModule('lib/serverSecurity.ts');
const race = await importServerModule('lib/serverRaceSheets.ts');
const decisionsModule = await importServerModule('lib/serverRaceDecisions.ts');
const publication = await importServerModule('lib/serverRacePublication.ts');
const { PUBLIC_SCORE_SELECT } = await importServerModule('lib/bootstrapPayload.ts');

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const MANAGER = { id: 'mgr-split', name: 'Gestora Split', email: 'split@example.com', role: 'manager', service_valid_until: '2099-12-31' };
const judge = (id, name) => ({ id, name, email: `${id}@example.com`, role: 'judge', parent_manager_id: MANAGER.id });
// Um judge por estação (capacidade da Story 1.103; Wall Ball e estação final com 1 atleta, D32 e D39).
const JUDGES = {
  'sled-push': judge('judge-sled', 'Judge Sigilo Trenó'),
  sandbag: judge('judge-sand', 'Judge Sigilo Seções'),
  ski: judge('judge-ski', 'Judge Sigilo Ski'),
  'wall-balls': judge('judge-wb', 'Judge Sigilo WB'),
  'box-jump': judge('judge-box', 'Judge Sigilo Box')
};

const EVENT = 'ev-split';
const DIVISION = 'div-split';
const run = (id, orderIndex) => ({ id, name: `Corrida ${orderIndex}`, type: 'run', orderIndex, distance: '1km' });
// Trenó, seções, ergômetro, Wall Ball no meio e genérica por último (fecha o tempo, D34); corrida final até a linha.
const COURSE = [
  run('run-1', 0),
  { id: 'sled-push', name: 'Sled Push', type: 'station', orderIndex: 1, distance: '50m', maleWeight: '152kg', femaleWeight: '102kg' },
  run('run-2', 2),
  { id: 'sandbag', name: 'Sandbag Lunges', type: 'station', orderIndex: 3, distance: '100m', conferenceKind: 'sections', units: 8 },
  run('run-3', 4),
  { id: 'ski', name: 'SkiErg', type: 'station', orderIndex: 5, distance: '1000m', conferenceKind: 'ergometer' },
  run('run-4', 6),
  { id: 'wall-balls', name: 'Wall Balls', type: 'station', orderIndex: 7, reps: 100, maleWeight: '9kg', femaleWeight: '6kg' },
  run('run-5', 8),
  { id: 'box-jump', name: 'Box Jump', type: 'station', orderIndex: 9, conferenceKind: 'generic' },
  run('run-final', 10)
];
const KIND = { 'sled-push': 'sled', sandbag: 'sections', ski: 'ergometer', 'wall-balls': 'wall_ball', 'box-jump': 'generic' };
const ATHLETES = [['ath-ana', 'Ana Souza'], ['ath-bia', 'Bia Lima'], ['ath-caio', 'Caio Reis'], ['ath-davi', 'Davi Melo']];
const TOTAL = `wod-${DIVISION}-total`;
const PENALTY_KEYS = [publication.RACE_SPLIT_PENALTIES_KEY, publication.RACE_SPLIT_PENALTY_SECONDS_KEY];

const seed = () => {
  database = createFakeSupabase({
    users: [MANAGER, ...Object.values(JUDGES)],
    events: [{
      id: EVENT, name: 'Race Splits', date: '2026-11-01', location: 'Fortaleza', organizer_id: MANAGER.id, event_type: 'fitness_racing', status: 'upcoming', time_zone: 'America/Fortaleza',
      event_schedule: [{ id: 'heat-1', kind: 'heat', date: '2026-11-01', time: '08:00', title: 'Onda 1', heatNumber: 1, athleteIds: ATHLETES.map(([id]) => id) }]
    }],
    event_judges: Object.values(JUDGES).map((row) => ({ event_id: EVENT, judge_user_id: row.id })),
    divisions: [{ id: DIVISION, event_id: EVENT, name: 'Women Pro', type: 'individual', category: 'female', course_layout: COURSE }],
    athletes: ATHLETES.map(([id, name]) => ({ id, name, box: 'Box', division_id: DIVISION })),
    workouts: [], scores: [], registrations: []
  });
  state.missingRaceTables = false;
  state.beforeUpdate = {};
  state.beforeCount = {};
  decisionsModule.setRaceRunPublisher(publication.publishRaceRun);
};

const cookie = (user) => `woda_session=${createSessionToken({ id: user.id, name: user.name, email: user.email, role: user.role })}`;
const post = async (user, body) => {
  const response = await POST(new Request('http://localhost/api/race-sheets', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie(user) }, body: JSON.stringify(body)
  }));
  return { status: response.status, body: await response.json() };
};
const runOf = (athleteId) => database.rows('race_runs').find((row) => row.athlete_id === athleteId);
const scoreOf = (athleteId) => database.rows('scores').find((row) => row.athlete_id === athleteId && row.workout_id === TOTAL);
const stageSplits = (splits) => Object.fromEntries(Object.entries(splits).filter(([key]) => !key.startsWith('race:')));

/** A onda largou uma hora atrás (fixture no futuro: a largada é gravada direto, como em race-closing-station). */
const startRun = async (athleteId) => {
  const ruleset = await race.ensureRaceRuleset(client, EVENT);
  const startedAt = new Date(Date.now() - 3_600_000).toISOString();
  if (!database.rows('race_heat_marks').length) {
    database.rows('race_heat_marks').push({ event_id: EVENT, heat_id: 'heat-1', started_at: startedAt, started_by_user_id: MANAGER.id, started_by_name: MANAGER.name });
  }
  const row = {
    id: `run-${athleteId}`, event_id: EVENT, division_id: DIVISION, athlete_id: athleteId, heat_id: 'heat-1', ruleset_id: ruleset.id,
    status: 'racing', started_at: startedAt, finish_at: null, gross_seconds: null, penalty_seconds: 0, official_seconds: null,
    time_source: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString()
  };
  database.rows('race_runs').push(row);
  return row;
};

/** Tentativa gravada direto, com o tipo do snapshot e o judge da estação. */
const seedAttempt = (runRow, stationId) => {
  const row = {
    id: `attempt-${runRow.athlete_id}-${stationId}`, run_id: runRow.id, event_id: EVENT, athlete_id: runRow.athlete_id, station_id: stationId, station_kind: KIND[stationId],
    lane: 1, judge_user_id: JUDGES[stationId].id, judge_name: JUDGES[stationId].name, status: 'waiting', progress: {}, started_at: null, ended_at: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString()
  };
  database.rows('race_attempts').push(row);
  return row.id;
};

// Horário do aparelho N segundos atrás (o desvio do lote é ~0: clientNow = agora).
let counter = 0;
const ev = (event, secondsAgo) => ({ id: `s${(counter += 1)}`, event, deviceAt: Date.now() - secondsAgo * 1000 });
const many = (type, count, fromAgo, toAgo) => Array.from({ length: count }, (_, index) => ev({ t: type }, fromAgo - ((fromAgo - toAgo) * (index + 1)) / (count + 1)));
const append = async (attemptId, fromSeq, events, stationId) => {
  const out = await post(JUDGES[stationId], { action: 'append', attemptId, fromSeq, events, clientNow: Date.now() });
  assert.equal(out.status, 200, out.body.error);
  return out.body;
};
/** Estação conferida inteira: start há `fromAgo` s, release há `toAgo` s. */
const station = async (runRow, stationId, fromAgo, toAgo, middle = []) => {
  const attemptId = seedAttempt(runRow, stationId);
  const fill = { 'sled-push': () => many('section', 4, fromAgo, toAgo), sandbag: () => many('section', 8, fromAgo, toAgo), 'wall-balls': () => many('rep', 100, fromAgo, toAgo) }[stationId];
  const events = [ev({ t: 'start' }, fromAgo), ...(fill ? fill() : []), ...middle, ev({ t: 'release' }, toAgo)];
  return { attemptId, body: await append(attemptId, 0, events, stationId), length: events.length };
};
const manager = async (body) => {
  const out = await post(MANAGER, { eventId: EVENT, ...body });
  assert.equal(out.status, 200, out.body.error);
  return out.body;
};

// ---------------------------------------------------------------------------
// buildRaceSplits puro (AC1, AC2, AC5)
// ---------------------------------------------------------------------------

test('buildRaceSplits: duração na estação pela chave da etapa (MM:SS e H:MM:SS); sem início, sem fim, cancelada ou < 1 s fica sem chave; só chaves de etapa e race:', () => {
  const base = Date.parse('2026-11-01T09:00:00.000Z');
  const at = (seconds) => new Date(base + seconds * 1000).toISOString();
  const attempt = (station_id, started, ended, extra = {}) => ({ id: `att-${station_id}`, station_id, status: 'released', judge_name: 'Judge Sigilo', judge_user_id: 'judge-x', started_at: started === null ? null : at(started), ended_at: ended === null ? null : at(ended), ...extra });
  const splits = publication.buildRaceSplits([
    attempt('sled-push', 0, 125.4),
    attempt('sandbag', 200, 200 + 3725),
    attempt('ski', 10, null, { status: 'running' }),
    attempt('wall-balls', null, 50, { status: 'waiting' }),
    attempt('box-jump', 30, 30.6),
    attempt('row', 0, 1),
    attempt('burpee', 0, 90, { status: 'cancelled' }),
    attempt('farmers', 0, 61, { status: 'exited_incomplete' })
  ], [
    { kind: 'penalty', status: 'confirmed', seconds: 120, label: 'Lixo na estação', note: 'Observação sigilosa', created_by_name: 'Judge Sigilo' },
    { kind: 'penalty', status: 'cancelled', seconds: 30, label: 'Revogada' },
    { kind: 'warning', status: 'confirmed', seconds: 0, label: 'Advertência' }
  ]);
  assert.deepEqual(stageSplits(splits), { 'sled-push': '02:05', sandbag: '1:02:05', row: '00:01', farmers: '01:01' });
  assert.equal(splits[publication.RACE_SPLIT_PENALTY_SECONDS_KEY], '120');
  assert.deepEqual(JSON.parse(splits[publication.RACE_SPLIT_PENALTIES_KEY]), [{ label: 'Lixo na estação', seconds: 120 }]);
  assert.deepEqual(Object.keys(splits).sort(), ['farmers', ...PENALTY_KEYS, 'row', 'sandbag', 'sled-push'].sort());
  const text = JSON.stringify(splits);
  for (const secret of ['att-', 'Judge Sigilo', 'judge-x', 'Observação sigilosa']) assert.ok(!text.includes(secret), `split sem ${secret}`);
  assert.ok(!Object.values(stageSplits(splits)).includes('00:00'), 'nunca 00:00');
  assert.equal(publication.RACE_MIN_SPLIT_SECONDS, 1);
});

// ---------------------------------------------------------------------------
// Todas as estações pela rota (AC1, AC2, AC5)
// ---------------------------------------------------------------------------

test('percurso completo: trenó, seções, Wall Ball no meio e genérica viram split do id da etapa com o tempo esperado; ergômetro sem judge fica sem chave; sem dado de árbitro', async () => {
  seed();
  const ana = await startRun('ath-ana');
  await station(ana, 'sled-push', 900, 780, [ev({ t: 'infraction', code: 'litter' }, 800)]);
  await station(ana, 'sandbag', 700, 610);
  await station(ana, 'wall-balls', 400, 290);
  assert.equal(scoreOf('ath-ana'), undefined, 'corrida racing não publica nem splits (Story 1.99, AC11)');
  const closed = await station(ana, 'box-jump', 120, 75);
  assert.equal(closed.body.republish.ok, true);
  assert.equal(runOf('ath-ana').status, 'finished');

  const score = scoreOf('ath-ana');
  assert.deepEqual(stageSplits(score.splits), { 'sled-push': '02:00', sandbag: '01:30', 'wall-balls': '01:50', 'box-jump': '00:45' });
  assert.equal(score.splits.ski, undefined, 'estação sem judge fica sem split (D37)');
  for (const runStage of COURSE.filter((stage) => stage.type === 'run')) assert.equal(score.splits[runStage.id], undefined, 'súmula não registra corrida');
  assert.equal(score.splits[publication.RACE_SPLIT_PENALTY_SECONDS_KEY], '120');
  assert.deepEqual(JSON.parse(score.splits[publication.RACE_SPLIT_PENALTIES_KEY]).map((item) => Object.keys(item).sort()), [['label', 'seconds']]);
  const text = JSON.stringify(score.splits);
  for (const row of database.rows('race_attempts')) assert.ok(!text.includes(row.id), 'sem id de tentativa');
  for (const row of Object.values(JUDGES)) {
    assert.ok(!text.includes(row.name), 'sem nome de judge');
    assert.ok(!text.includes(row.id), 'sem id de judge');
  }
});

test('sem split: estação com exit tem split até o exit; reps com abandon, estação sem fim e duração < 1 s ficam sem chave', async () => {
  seed();
  const bia = await startRun('ath-bia');
  // Trenó no meio sai incompleto: o `exit` é o fim da estação.
  const sled = seedAttempt(bia, 'sled-push');
  await append(sled, 0, [ev({ t: 'start' }, 900), ...many('section', 2, 900, 800), ev({ t: 'exit' }, 800)], 'sled-push');
  // Seções começaram e não terminaram.
  await append(seedAttempt(bia, 'sandbag'), 0, [ev({ t: 'start' }, 700), ...many('section', 3, 700, 650)], 'sandbag');
  // Ergômetro com início e fim no mesmo instante.
  await append(seedAttempt(bia, 'ski'), 0, [ev({ t: 'start' }, 500.4), ev({ t: 'release' }, 500)], 'ski');
  // Wall Ball no meio com saída registrada (D24): sem fim.
  await append(seedAttempt(bia, 'wall-balls'), 0, [ev({ t: 'start' }, 400), ...many('rep', 40, 400, 330), ev({ t: 'abandon' }, 330)], 'wall-balls');
  await station(bia, 'box-jump', 100, 40);

  const attempts = database.rows('race_attempts');
  assert.equal(attempts.find((row) => row.station_id === 'wall-balls').ended_at, null, 'abandon não fecha a tentativa');
  const splits = scoreOf('ath-bia').splits;
  assert.deepEqual(stageSplits(splits), { 'sled-push': '01:40', 'box-jump': '01:00' });
  assert.ok(!Object.values(splits).includes('00:00'));
  // A saída incompleta cobra os trechos faltantes (D28) e entra nas penalidades do split.
  assert.equal(Number(splits[publication.RACE_SPLIT_PENALTY_SECONDS_KEY]), Number(runOf('ath-bia').penalty_seconds));
});

// ---------------------------------------------------------------------------
// Registro tardio (AC3)
// ---------------------------------------------------------------------------

test('registro tardio: estação anterior liberada depois do fechamento passa a ter split e as penalidades são regravadas; republicar duas vezes dá o mesmo resultado', async () => {
  seed();
  const caio = await startRun('ath-caio');
  const sled = seedAttempt(caio, 'sled-push');
  const first = [ev({ t: 'start' }, 900), ...many('section', 2, 900, 800)];
  await append(sled, 0, first, 'sled-push');
  await station(caio, 'box-jump', 120, 60);
  assert.equal(runOf('ath-caio').status, 'finished');
  assert.deepEqual(stageSplits(scoreOf('ath-caio').splits), { 'box-jump': '01:00' }, 'o trenó ainda sem fim fica sem split');
  assert.equal(scoreOf('ath-caio').splits[publication.RACE_SPLIT_PENALTY_SECONDS_KEY], '0');

  // A internet do judge do trenó voltou: o resto da estação chega depois do fechamento.
  const late = await append(sled, first.length, [...many('section', 2, 800, 750), ev({ t: 'infraction', code: 'litter' }, 760), ev({ t: 'release' }, 750)], 'sled-push');
  assert.equal(late.republish.ok, true);
  const republished = structuredClone(scoreOf('ath-caio'));
  assert.deepEqual(stageSplits(republished.splits), { 'sled-push': '02:30', 'box-jump': '01:00' });
  assert.equal(republished.splits[publication.RACE_SPLIT_PENALTY_SECONDS_KEY], '120');
  assert.equal(JSON.parse(republished.splits[publication.RACE_SPLIT_PENALTIES_KEY]).length, 1);
  assert.equal(republished.value, Math.round(Number(runOf('ath-caio').official_seconds)));

  for (let index = 0; index < 2; index += 1) {
    assert.equal((await decisionsModule.republishAfterRaceClose(client, caio.id)).ok, true);
    assert.deepEqual(scoreOf('ath-caio'), republished, 'idempotente');
  }
});

// ---------------------------------------------------------------------------
// Quando aparecem (AC4)
// ---------------------------------------------------------------------------

test('racing não publica; DNF publica os splits das estações com judge; desfazer DNF retira resultado e splits; adjust_time não muda nenhum split', async () => {
  seed();
  const davi = await startRun('ath-davi');
  await station(davi, 'sled-push', 900, 810);
  assert.equal(scoreOf('ath-davi'), undefined, 'racing não publica');

  await manager({ action: 'mark_dnf', runId: davi.id, reason: 'Teste de DNF' });
  const dnf = scoreOf('ath-davi');
  assert.equal(dnf.result, 'DNF');
  assert.deepEqual(stageSplits(dnf.splits), { 'sled-push': '01:30' });

  await manager({ action: 'unmark_dnf', runId: davi.id, reason: 'Desfazendo' });
  assert.equal(runOf('ath-davi').status, 'racing');
  assert.equal(scoreOf('ath-davi'), undefined, 'a retirada leva os splits junto');

  await station(davi, 'box-jump', 100, 52);
  const finished = structuredClone(scoreOf('ath-davi'));
  assert.deepEqual(stageSplits(finished.splits), { 'sled-push': '01:30', 'box-jump': '00:48' });

  await manager({ action: 'adjust_time', runId: davi.id, grossSeconds: 3500, reason: 'Penalidade do papel' });
  const adjusted = scoreOf('ath-davi');
  assert.equal(adjusted.value, 3500);
  assert.deepEqual(adjusted.splits, finished.splits, 'o ajuste do organizador não altera split');
});

// ---------------------------------------------------------------------------
// PII e contrato do bootstrap (AC5)
// ---------------------------------------------------------------------------

test('bootstrap: PUBLIC_SCORE_SELECT sem coluna nova e sem race_run_id; bootstrap público e privado não leem race_*', () => {
  assert.equal(PUBLIC_SCORE_SELECT, 'athlete_id, workout_id, result, value, rank, points, splits, result_status');
  assert.doesNotMatch(read('../src/lib/bootstrapPayload.ts'), /race_/);
  assert.doesNotMatch(read('../src/app/api/app/bootstrap/route.ts'), /race_/);
  assert.doesNotMatch(read('../src/app/api/app/bootstrap/public/route.ts'), /race_/);
});

// ---------------------------------------------------------------------------
// Tela pública (AC6) e regressões (AC7)
// ---------------------------------------------------------------------------

const analysisBlocks = () => {
  const source = read('../src/components/Leaderboard.tsx');
  const blocks = source.split("{t('performanceAnalysis')}").slice(1).map((chunk) => chunk.slice(0, chunk.indexOf('</div>\n                    )}')));
  assert.equal(blocks.length, 2, 'atleta e dupla');
  return { source, blocks };
};

test('Leaderboard: nos dois blocos, só etapas do percurso com split (race: fora), timeline sem "-", cartões de corrida e de estações só com split', () => {
  const { source, blocks } = analysisBlocks();
  for (const block of blocks) {
    assert.match(block, /const splitsArray = stages\.map\(stg => \{\s*const timeStr = score\.splits\?\.\[stg\.id\] \|\| '';/, 'lê só as chaves de etapa: race: fica de fora');
    assert.match(block, /\}\)\.filter\(s => s\.secs > 0\);/, 'estação sem split fica de fora');
    assert.match(block, /\{splitsArray\.map\(\(\{ stage: stg, timeStr \}\) => \{/, 'timeline só com as etapas com split, na ordem do percurso');
    assert.doesNotMatch(block, /score\.splits\?\.\[stg\.id\] \|\| '-'/, 'sem linha "-" de estação sem judge');
    assert.match(block, /\{runs\.length > 0 && \(\s*<div[^>]*>\s*<p[^>]*>\{t\('totalRun'\)\}/, 'total de corridas só com split de corrida');
    assert.match(block, /\{runs\.length > 0 && \(\s*<div[^>]*>\s*<p[^>]*>\{t\('avgRunPace'\)\}/, 'média de corrida só com split de corrida');
    assert.match(block, /\{stations\.length > 0 && \(\s*<div[^>]*>\s*<p[^>]*>\{t\('totalStations'\)\}/);
    assert.match(block, /const bestStation = stations\.length > 0 \? \[\.\.\.stations\]\.sort\(\(a, b\) => a\.secs - b\.secs\)\[0\] : null;/, 'melhor estação só com split');
  }
  // Classificação intocada: a tela só consome computeDivisionStandings.
  assert.doesNotMatch(source, /const computeDivisionStandings|function computeDivisionStandings/);
});

test('regressão: Functional Fitness e lançamento manual de splits fora da publicação Race; trava do lançamento manual segue no lugar', () => {
  const source = read('../src/lib/serverRacePublication.ts');
  // Só o código: os comentários citam o ranking de Functional Fitness para dizer que não o usam.
  const code = source.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*\*)/.test(line)).join('\n');
  assert.doesNotMatch(code, /recalculateWorkoutRanking|rankWorkoutScores/);
  assert.match(source, /export const filterRaceLockedManualScores/);
  assert.match(source, /RACE_MANUAL_LOCK_MESSAGE/);
  assert.doesNotMatch(source, /'disqualified'/, 'a súmula não publica DQ (D27)');
  const persistence = read('../src/app/api/admin/persistence/route.ts');
  assert.match(persistence, /filterRaceLockedManualScores/);
  assert.doesNotMatch(persistence, /buildRaceSplits/, 'o lançamento manual de splits não passa pela súmula');
});
