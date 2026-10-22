import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { importServerModule } from './support/serverModuleHarness.mjs';

// Story 1.64: no Qualifier, a linha em scores só nasce na revisão do judge. Envio
// feito e ainda sem revisão é "Em análise", não ausência. Cenário do SELVA 2027
// (22/10/2026): janela encerrada, quase tudo pendente de revisão.

const { computeDivisionStandings, qualifierReviewKey } = await importServerModule('lib/leaderboardStandings.ts');
const { groupQualifierPendingReviews, readQualifierPendingReviews, QUALIFIER_EVENT_TYPE } =
  await importServerModule('lib/serverQualifierPendingReviews.ts');

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const CLOSED = '2026-10-21T21:00:00+00:00';
const OPEN = '2026-12-31T21:00:00+00:00';
const NOW = new Date('2026-10-22T12:00:00Z').getTime();

const workouts = (closesAt = CLOSED) => ['p1', 'p2', 'p3', 'p4'].map((id, index) => ({
  id, name: id.toUpperCase(), description: '', type: 'fortime', code: id.toUpperCase(), orderIndex: index + 1, submissionClosesAt: closesAt
}));
const athletes = (ids) => ids.map((id) => ({ id, name: `Atleta ${id}`, box: '', country: 'BR', divisionId: 'div' }));
const score = (athleteId, workoutId, rank) => ({ athleteId, workoutId, result: `0${rank}:00`, value: rank * 60, rank, points: rank, splits: {}, resultStatus: 'validated' });
const waiting = (...pairs) => new Set(pairs.map(([athleteId, workoutId]) => qualifierReviewKey(athleteId, workoutId)));

const standings = ({ ids, scores, awaitingReview, closesAt, eventType = 'functional_fitness_qualifier' }) => computeDivisionStandings({
  event: { date: '', eventType, workouts: workouts(closesAt) },
  divisionId: 'div',
  divisionAthletes: athletes(ids),
  scores,
  awaitingReview,
  nowMs: NOW
});
const byId = (list, id) => list.find((item) => item.athlete.id === id);

test('janela encerrada: envio em análise não recebe pontos de ausência nem o status absent', () => {
  const list = standings({
    ids: ['A', 'B', 'C', 'D'],
    scores: [score('A', 'p1', 1)],
    awaitingReview: waiting(['B', 'p1'], ['B', 'p2'], ['B', 'p3'], ['B', 'p4'], ['A', 'p2'])
  });
  const a = byId(list, 'A');
  assert.equal(a.scores.p2.awaitingReview, true);
  assert.equal(a.scores.p2.points, 0);
  assert.equal(a.scores.p2.resultStatus, undefined);
  assert.equal(a.scores.p3.resultStatus, 'absent', 'sem envio e sem análise segue sendo ausência');
  assert.equal(a.scores.p3.points, 4);
  assert.equal(a.scores.p3.awaitingReview, undefined);
  assert.equal(a.totalPoints, 1 + 0 + 4 + 4, 'total exibido soma só pontos reais e ausências reais');
  assert.equal(byId(list, 'B').totalPoints, 0, 'quem só tem envios em análise mostra 0 ponto');
  assert.equal(byId(list, 'D').totalPoints, 16, 'quem não enviou nada recebe N por prova');
});

test('SELVA: ordem parcial = pontos reais + pior colocação por prova em análise; ausente real fica por último', () => {
  const ids = ['A1', 'A2', 'A5', 'E1', 'E2', 'MIX', 'AUS1', 'AUS2'];
  const N = ids.length; // 8
  const list = standings({
    ids,
    scores: [score('A1', 'p1', 1), score('A1', 'p2', 1), score('A2', 'p1', 2), score('A2', 'p2', 2), score('A5', 'p1', 3)],
    awaitingReview: waiting(
      ['A1', 'p3'], ['A1', 'p4'], ['A2', 'p3'], ['A2', 'p4'], ['A5', 'p2'], ['A5', 'p3'], ['A5', 'p4'],
      ['E1', 'p1'], ['E1', 'p2'], ['E1', 'p3'], ['E1', 'p4'], ['E2', 'p1'], ['E2', 'p2'], ['E2', 'p3'], ['E2', 'p4'],
      ['MIX', 'p1'], ['MIX', 'p2']
    )
  });
  assert.deepEqual(list.map((item) => item.athlete.id), ['A1', 'A2', 'A5', 'E1', 'E2', 'MIX', 'AUS1', 'AUS2']);
  assert.deepEqual(list.map((item) => item.totalPoints), [2, 4, 3, 0, 0, 2 * N, 4 * N, 4 * N]);
  // Em análise nunca empata com ausência real: E1/E2 dividem a posição 4; MIX e os ausentes ficam depois.
  assert.deepEqual(list.map((item) => item.rank), [1, 2, 3, 4, 4, 6, 7, 7]);
});

test('com todas as submissões revisadas (sem awaitingReview) o ranking é o mesmo de antes da Story 1.64', () => {
  const ids = ['A', 'B', 'C'];
  const scores = [score('A', 'p1', 1), score('B', 'p1', 2), score('A', 'p2', 2), score('B', 'p2', 1)];
  const withEmptySet = standings({ ids, scores, awaitingReview: new Set() });
  const withoutParam = standings({ ids, scores });
  assert.deepEqual(withEmptySet.map((item) => [item.athlete.id, item.rank, item.totalPoints]), withoutParam.map((item) => [item.athlete.id, item.rank, item.totalPoints]));
  // N = 3: A e B somam 1+2 nas provas revisadas e N nas duas ausências; C é ausente nas quatro.
  assert.deepEqual(withoutParam.map((item) => [item.athlete.id, item.totalPoints, item.rank]), [['A', 9, 1], ['B', 9, 2], ['C', 12, 3]]);
  assert.equal(byId(withoutParam, 'C').scores.p1.resultStatus, 'absent');
});

test('janela aberta: o envio em análise segue pendente (0 ponto, atrás de quem tem mais provas) e ganha o selo', () => {
  const list = standings({
    ids: ['A', 'B'],
    scores: [score('A', 'p1', 1)],
    awaitingReview: waiting(['B', 'p1'], ['B', 'p2']),
    closesAt: OPEN
  });
  assert.deepEqual(list.map((item) => item.athlete.id), ['A', 'B']);
  assert.equal(byId(list, 'B').scores.p1.awaitingReview, true);
  assert.equal(byId(list, 'B').scores.p1.points, 0);
  assert.equal(byId(list, 'B').scores.p3.awaitingReview, undefined);
  assert.equal(byId(list, 'B').scores.p3.resultStatus, undefined, 'janela aberta nunca é ausência');
});

test('awaitingReview não tem efeito fora do Qualifier', () => {
  const ids = ['A', 'B'];
  const scores = [score('A', 'p1', 1)];
  const marked = standings({ ids, scores, awaitingReview: waiting(['B', 'p1'], ['B', 'p2']), eventType: 'functional_fitness' });
  const plain = standings({ ids, scores, eventType: 'functional_fitness' });
  assert.deepEqual(marked, plain);
  assert.equal(byId(marked, 'B').scores.p1.awaitingReview, undefined);
});

test('a revisão troca "em análise" pelo score: o mesmo par some do conjunto e o resultado entra no total', () => {
  const before = standings({ ids: ['A', 'B'], scores: [], awaitingReview: waiting(['A', 'p1'], ['B', 'p1']) });
  assert.equal(byId(before, 'A').scores.p1.awaitingReview, true);
  const after = standings({ ids: ['A', 'B'], scores: [score('A', 'p1', 1)], awaitingReview: waiting(['B', 'p1']) });
  assert.equal(byId(after, 'A').scores.p1.awaitingReview, undefined);
  assert.equal(byId(after, 'A').scores.p1.points, 1);
});

test('groupQualifierPendingReviews agrupa por prova, ignora linhas incompletas e não repete atleta', () => {
  assert.deepEqual(groupQualifierPendingReviews([
    { workout_id: 'p1', athlete_id: 'A' },
    { workout_id: 'p1', athlete_id: 'B' },
    { workout_id: 'p1', athlete_id: 'A' },
    { workout_id: 'p2', athlete_id: 'A' },
    { workout_id: 'p2', athlete_id: null },
    { workout_id: null, athlete_id: 'C' }
  ]), [
    { workout_id: 'p1', athlete_ids: ['A', 'B'] },
    { workout_id: 'p2', athlete_ids: ['A'] }
  ]);
});

const fakeSubmissions = (rows, { failAt } = {}) => {
  const calls = [];
  const db = {
    calls,
    from(table) {
      assert.equal(table, 'score_submissions');
      const filters = {};
      let range = [0, 999];
      const query = {
        select(columns) { filters.columns = columns; return query; },
        in(key, values) { filters[key] = values; return query; },
        eq(key, value) { filters[key] = value; return query; },
        order() { return query; },
        range(from, to) { range = [from, to]; return query; },
        then(resolve, reject) {
          calls.push({ ...filters, range });
          if (failAt === calls.length) return Promise.resolve({ data: null, error: { code: 'XX000', message: 'boom' } }).then(resolve, reject);
          return Promise.resolve({ data: rows.slice(range[0], range[1] + 1), error: null }).then(resolve, reject);
        }
      };
      return query;
    }
  };
  return db;
};

test('readQualifierPendingReviews lê só workout_id/athlete_id de pending_review e pagina além de 1.000 linhas', async () => {
  const rows = Array.from({ length: 2500 }, (_, index) => ({ workout_id: `p${index % 4}`, athlete_id: `a${index}` }));
  const db = fakeSubmissions(rows);
  const groups = await readQualifierPendingReviews(db, ['evt']);
  assert.equal(db.calls.length, 3);
  assert.deepEqual(db.calls.map((call) => call.range), [[0, 999], [1000, 1999], [2000, 2999]]);
  assert.equal(db.calls[0].columns, 'workout_id, athlete_id');
  assert.equal(db.calls[0].status, 'pending_review');
  assert.deepEqual(db.calls[0].event_id, ['evt']);
  assert.equal(groups.reduce((total, group) => total + group.athlete_ids.length, 0), 2500);
});

test('readQualifierPendingReviews não consulta sem evento', async () => {
  const idle = fakeSubmissions([]);
  assert.deepEqual(await readQualifierPendingReviews(idle, []), []);
  assert.equal(idle.calls.length, 0);
});

test('readQualifierPendingReviews propaga a falha: lista vazia nunca esconde erro de leitura', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    await assert.rejects(
      readQualifierPendingReviews(fakeSubmissions([{ workout_id: 'p1', athlete_id: 'A' }], { failAt: 1 }), ['evt']),
      /Falha ao carregar envios do qualifier em análise/
    );
    // Falha numa página do meio também derruba a leitura, em vez de devolver só as páginas anteriores.
    const rows = Array.from({ length: 2500 }, (_, index) => ({ workout_id: 'p1', athlete_id: `a${index}` }));
    await assert.rejects(readQualifierPendingReviews(fakeSubmissions(rows, { failAt: 2 }), ['evt']), /Falha ao carregar/);
  } finally {
    console.error = originalError;
  }
});

test('readQualifierPendingReviews não devolve resultado parcial quando passa do limite de páginas', async () => {
  const originalError = console.error;
  const originalInfo = console.info;
  console.error = () => {};
  console.info = () => {};
  try {
    const rows = Array.from({ length: 100_005 }, (_, index) => ({ workout_id: 'p1', athlete_id: `a${index}` }));
    await assert.rejects(readQualifierPendingReviews(fakeSubmissions(rows), ['evt']), /Falha ao carregar/);
  } finally {
    console.error = originalError;
    console.info = originalInfo;
  }
});

test('bootstrap: o envio em análise só sai com ids de atleta e de prova, só de Qualifier, e fora do payload público base', () => {
  const lib = read('../src/lib/serverQualifierPendingReviews.ts');
  const privateRoute = read('../src/app/api/app/bootstrap/route.ts');
  const publicEventRoute = read('../src/app/api/app/bootstrap/public/event/[id]/route.ts');
  const publicPayload = read('../src/lib/bootstrapPayload.ts');
  assert.equal(QUALIFIER_EVENT_TYPE, 'functional_fitness_qualifier');
  assert.match(lib, /\.select\('workout_id, athlete_id'\)/);
  assert.doesNotMatch(lib, /video_url|video_id|submitted_result|athlete_note/);
  assert.match(publicEventRoute, /isQualifier \? await readQualifierPendingReviews\(supabaseAdmin, \[eventId\]\) : \[\]/);
  assert.match(privateRoute, /session\.role === 'athlete'\s*\?\s*Promise\.resolve\(\[\]\)/);
  assert.match(privateRoute, /const qualifierPendingReviews = await qualifierPendingReviewsPromise;/);
  assert.match(privateRoute, /\.filter\(event => event\.event_type === QUALIFIER_EVENT_TYPE\)/);
  assert.doesNotMatch(publicPayload, /score_submissions|qualifierPendingReviews/);
});

test('AppContext mantém os envios em análise por evento e a tela mostra "Em análise" e o aviso de ranking parcial', () => {
  const context = read('../src/context/AppContext.tsx');
  const leaderboard = read('../src/components/Leaderboard.tsx');
  const admin = read('../src/app/admin/page.tsx');
  assert.match(context, /payload\.qualifierPendingReviews/);
  assert.match(context, /group => !eventWorkoutIds\.has\(group\.workoutId\)/);
  assert.match(context, /setQualifierPendingReviews\(\[\]\)/);
  assert.match(leaderboard, /score\?\.awaitingReview/);
  assert.match(leaderboard, /t\('qualifierPartialBody', qualifierReviewSummary\)/);
  assert.match(admin, /item\.scores\[wod\.id\]\?\.awaitingReview/);
  for (const locale of ['pt-br', 'pt-pt', 'en-gb']) {
    const messages = JSON.parse(read(`../src/messages/${locale}.json`)).Leaderboard;
    for (const key of ['awaitingReview', 'awaitingReviewScore', 'qualifierPartialTitle', 'qualifierPartialBody']) {
      assert.ok(messages[key], `${locale}.Leaderboard.${key}`);
    }
  }
});
