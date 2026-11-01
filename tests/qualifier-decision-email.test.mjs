import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createFakeSupabase } from './support/fakeSupabase.mjs';
import { importServerModule, setActiveSupabaseClient } from './support/serverModuleHarness.mjs';

// Stories 1.108 e 1.109: o atleta do Qualifier recebe e-mail em toda decisão
// sobre o resultado (antes só na edição do gestor) e vê a decisão na área dele.
// Módulo puro do e-mail, rota de revisão real com banco em memória e fetch do
// Resend interceptado, rota de envios do atleta e estáticos das telas.

process.env.SUPABASE_URL = 'http://supabase.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';
process.env.WODA_SESSION_SECRET = 'segredo-de-teste-email-decisao';
process.env.NEXT_PUBLIC_APP_URL = 'https://app.test';

const MANAGER = { id: 'mgr-q', name: 'Gestora Q', email: 'gestora@example.com', role: 'manager', service_valid_until: '2099-12-31' };
const JUDGE = { id: 'judge-q', name: 'Judge Rita', email: 'rita@example.com', role: 'judge', parent_manager_id: MANAGER.id };
const ATHLETE = { id: 'ath-user-q', name: 'Marina Duarte', email: 'marina@example.com', role: 'athlete' };
const EVENT = 'ev-q';

const seed = () => ({
  users: [MANAGER, JUDGE, ATHLETE],
  events: [{ id: EVENT, name: 'Qualifier Teste 2026', organizer_id: MANAGER.id, event_type: 'functional_fitness_qualifier' }],
  event_judges: [{ event_id: EVENT, judge_user_id: JUDGE.id }],
  divisions: [{ id: 'div-q', name: 'RX Feminino' }],
  workouts: [
    { id: 'wod-amrap', name: '26.1', type: 'amrap', submission_closes_at: '2026-11-10T02:59:00.000Z' },
    { id: 'wod-time', name: '26.2', type: 'fortime', submission_closes_at: '2026-11-10T02:59:00.000Z' }
  ],
  registrations: [
    { id: 'reg-q', athlete_email: 'marina@example.com', athlete_name: 'Marina Duarte', locale: 'pt-br' },
    { id: 'reg-en', athlete_email: 'amy@example.com', athlete_name: 'Amy Clarke', locale: 'en-gb' },
    { id: 'reg-sem-email', athlete_email: null, athlete_name: 'Sem Email', locale: 'pt-br' }
  ],
  score_submissions: [
    submission('sub-1', 'reg-q', 'wod-amrap', '214'),
    submission('sub-en', 'reg-en', 'wod-amrap', '150'),
    submission('sub-sem-email', 'reg-sem-email', 'wod-amrap', '99')
  ],
  score_submission_reviews: []
});

function submission(id, registrationId, workoutId, result) {
  return {
    id, event_id: EVENT, workout_id: workoutId, division_id: 'div-q', registration_id: registrationId,
    user_id: ATHLETE.id, submitted_result: result, submitted_value: Number(result), final_result: null,
    status: 'pending_review', entry_source: 'athlete', current_version: 1,
    submitted_at: '2026-11-01T10:00:00.000Z', created_at: '2026-11-01T10:00:00.000Z', updated_at: '2026-11-01T10:00:00.000Z'
  };
}

// RPC qualifier_apply_review emulado: aplica a decisão na submissão e grava a revisão.
let database;
let rpcError = null;
const applyReview = (args) => {
  const row = database.rows('score_submissions').find(item => item.id === args.p_submission_id);
  const actor = database.rows('users').find(item => item.id === args.p_actor_id);
  const previous = { result: row.final_result };
  const value = Number(row.submitted_value);
  const final = {
    validated: [row.submitted_result, 'validated'],
    penalized: [String(Math.floor(value * 0.85)), 'penalized'],
    rejected: ['0', 'rejected'],
    manual_adjustment: [args.p_manual_result, 'validated']
  }[args.p_decision];
  Object.assign(row, { final_result: final[0], status: final[1], reviewed_by: actor.id });
  database.rows('score_submission_reviews').push({
    id: `rev-${database.rows('score_submission_reviews').length + 1}`, submission_id: row.id, submission_version: row.current_version, event_id: EVENT,
    judge_user_id: actor.id, judge_name: actor.name, judge_role: actor.role, decision: args.p_decision,
    previous_result: previous.result, applied_result: final[0], justification: args.p_justification || null,
    reviewed_at: new Date(Date.now() + database.rows('score_submission_reviews').length).toISOString()
  });
  return { reviewId: 'rev', status: final[1] };
};

const resetDatabase = () => {
  database = createFakeSupabase(seed());
  rpcError = null;
  setActiveSupabaseClient({
    from: (table) => database.client.from(table),
    rpc: async (name, args) => {
      if (rpcError) return { data: null, error: { message: rpcError } };
      if (name === 'qualifier_apply_review') return { data: applyReview(args), error: null };
      return { data: null, error: null };
    }
  });
};
resetDatabase();

const email = await importServerModule('lib/qualifierDecisionEmail.ts');
const athleteDecision = await importServerModule('lib/qualifierAthleteDecision.ts');
const { POST: reviewPOST } = await importServerModule('app/api/judge/reviews/route.ts');
const { GET: submissionsGET } = await importServerModule('app/api/submissions/route.ts');
const { createSessionToken } = await importServerModule('lib/serverSecurity.ts');

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const cookie = (user) => `woda_session=${createSessionToken({ id: user.id, name: user.name, email: user.email, role: user.role })}`;

const review = (user, body) => reviewPOST(new Request('http://localhost/api/judge/reviews', {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie: cookie(user) },
  body: JSON.stringify({ expectedVersion: 1, ...body })
}));

const withResend = async (status, run) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.RESEND_API_KEY;
  const originalError = console.error;
  const calls = [];
  const logs = [];
  process.env.RESEND_API_KEY = 're_test';
  console.error = (...args) => { logs.push(args.map(String).join(' ')); };
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(status === 200 ? { id: 'msg-1' } : { message: 'falhou' }), { status });
  };
  try {
    return await run(calls, logs);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
  }
};

const baseInput = {
  locale: 'pt-br', kind: 'validated', actor: 'judge', athleteName: 'Marina Duarte', eventName: 'Qualifier Teste 2026',
  workoutName: '26.1', workoutType: 'amrap', divisionName: 'RX Feminino', submittedResult: '214', officialResult: '214',
  justification: '', athleteAreaUrl: 'https://app.test/admin', leaderboardUrl: 'https://app.test/pt-br/event/ev-q/leaderboard'
};

// ---------------------------------------------------------------------------
// Módulo puro do e-mail
// ---------------------------------------------------------------------------

test('every decision kind renders subject, HTML and text in the three locales', () => {
  assert.equal(email.QUALIFIER_DECISION_KINDS.length, 7);
  for (const locale of ['pt-br', 'pt-pt', 'en-gb']) {
    for (const kind of email.QUALIFIER_DECISION_KINDS) {
      const built = email.buildQualifierDecisionEmail({ ...baseInput, locale, kind, previousStatus: 'validated', previousResult: '214', editDecision: 'penalized' });
      assert.match(built.subject, /26\.1 · Qualifier Teste 2026$/);
      assert.match(built.html, new RegExp(`<html lang="${{ 'pt-br': 'pt-BR', 'pt-pt': 'pt-PT', 'en-gb': 'en-GB' }[locale]}">`));
      assert.ok(built.preheader.length > 0);
      assert.match(built.text, /https:\/\/app\.test\//);
      assert.doesNotMatch(built.html, /undefined|null/);
    }
  }
});

test('text from the database and the judge is escaped', () => {
  const built = email.buildQualifierDecisionEmail({
    ...baseInput, kind: 'rejected', officialResult: '0', athleteName: '<b>Marina</b>', workoutName: '26.1 <img src=x>',
    justification: '<script>alert(1)</script>'
  });
  assert.doesNotMatch(built.html, /<script>|<img src=x>|<b>Marina<\/b>/);
  assert.match(built.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(built.html, /&lt;b&gt;Marina&lt;\/b&gt;/);
});

test('who decided appears as the judges or the organisers, never by name', () => {
  const byJudge = email.buildQualifierDecisionEmail(baseInput);
  const byOrganization = email.buildQualifierDecisionEmail({ ...baseInput, actor: 'organization', justification: 'Ok' });
  assert.match(byJudge.html, /A arbitragem conferiu o vídeo/);
  assert.match(byOrganization.html, /A organização do evento conferiu o vídeo/);
  assert.match(byOrganization.html, /Observação da organização/);
  const adjusted = email.buildQualifierDecisionEmail({ ...baseInput, kind: 'manual_adjustment', actor: 'organization', officialResult: '200' });
  assert.match(adjusted.subject, /^Resultado ajustado · /);
  assert.doesNotMatch(adjusted.subject + adjusted.html, /pela arbitragem/);
  assert.equal(email.getQualifierDecisionActor('judge'), 'judge');
  assert.equal(email.getQualifierDecisionActor('manager'), 'organization');
  assert.equal(email.getQualifierDecisionActor('owner'), 'organization');
});

test('button goes to the leaderboard when validated and to the athlete area otherwise', () => {
  assert.match(email.buildQualifierDecisionEmail(baseInput).html, /href="https:\/\/app\.test\/pt-br\/event\/ev-q\/leaderboard"/);
  const rejected = email.buildQualifierDecisionEmail({ ...baseInput, kind: 'rejected', officialResult: '0' });
  assert.match(rejected.html, /href="https:\/\/app\.test\/admin"/);
  assert.match(rejected.html, /Conta como a última colocação da categoria/);
});

test('decision rows follow the approved model', () => {
  const amrap = email.buildQualifierDecisionEmail({ ...baseInput, kind: 'penalized', officialResult: '181' });
  assert.match(amrap.html, /−15% sobre o resultado enviado/);
  assert.match(amrap.html, /line-through/);
  const time = email.buildQualifierDecisionEmail({ ...baseInput, kind: 'penalized', workoutType: 'fortime', submittedResult: '08:42', officialResult: '10:01' });
  assert.match(time.html, /\+15% no tempo enviado/);
  const edit = email.buildQualifierDecisionEmail({ ...baseInput, kind: 'organization_edit', actor: 'organization', previousStatus: 'validated', previousResult: '214', officialResult: '181', editDecision: 'penalized' });
  assert.match(edit.html, /Antes · Validado/);
  assert.match(edit.html, /Penalizado \(−15%\)/);
  const resubmit = email.buildQualifierDecisionEmail({ ...baseInput, kind: 'resubmission_requested', actor: 'organization', previousResult: '214', officialResult: null, submissionClosesAt: '2026-11-10T02:59:00.000Z' });
  assert.match(resubmit.html, /Prazo de envio/);
  assert.match(resubmit.text, /Situação: Aguardando/);
  assert.doesNotMatch(resubmit.text, /Resultado oficial: Aguardando/);
  assert.match(resubmit.html, /09\/11\/2026,? 23:59/);
  const entry = email.buildQualifierDecisionEmail({ ...baseInput, kind: 'manager_entry', actor: 'organization', officialResult: '198' });
  assert.match(entry.html, /Sem vídeo/);
});

test('the note block only appears when there is a note', () => {
  assert.doesNotMatch(email.buildQualifierDecisionEmail(baseInput).html, /Observação da arbitragem/);
  const withNote = email.buildQualifierDecisionEmail({ ...baseInput, justification: 'Boa prova!' });
  assert.match(withNote.html, /Observação da arbitragem/);
  assert.match(withNote.text, /Observação da arbitragem:\nBoa prova!/);
});

// ---------------------------------------------------------------------------
// Rota de revisão (Story 1.108)
// ---------------------------------------------------------------------------

test('first review by a judge e-mails the athlete after the decision is saved', async () => {
  resetDatabase();
  await withResend(200, async (calls) => {
    const response = await review(JUDGE, { submissionId: 'sub-1', decision: 'validated', justification: '' });
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    const sent = calls[0].body;
    assert.equal(calls[0].url, 'https://api.resend.com/emails');
    assert.equal(sent.to, 'marina@example.com');
    assert.match(sent.subject, /^Resultado validado · 26\.1 · Qualifier Teste 2026$/);
    assert.match(sent.html, /A arbitragem conferiu/);
    assert.doesNotMatch(sent.html + sent.text, /Judge Rita|judge-q/);
    assert.match(sent.text, /https:\/\/app\.test\/pt-br\/event\/ev-q\/leaderboard/);
    assert.match(sent.html, /RX Feminino/);
  });
});

test('the e-mail uses the registration locale', async () => {
  resetDatabase();
  await withResend(200, async (calls) => {
    const response = await review(JUDGE, { submissionId: 'sub-en', decision: 'penalized', justification: 'No-reps on wall balls' });
    assert.equal(response.status, 200);
    assert.match(calls[0].body.subject, /^Score penalised by 15% · 26\.1/);
    assert.match(calls[0].body.html, /<html lang="en-GB">/);
    assert.match(calls[0].body.html, /127/);
  });
});

test('manager edit of a reviewed result e-mails the previous and the new situation', async () => {
  resetDatabase();
  await withResend(200, async () => {
    await review(JUDGE, { submissionId: 'sub-1', decision: 'validated' });
  });
  await withResend(200, async (calls) => {
    const response = await review(MANAGER, { submissionId: 'sub-1', decision: 'penalized', justification: 'Revisão do vídeo' });
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.match(calls[0].body.subject, /^A organização alterou seu resultado/);
    assert.match(calls[0].body.html, /Antes · Validado/);
    assert.match(calls[0].body.html, /Motivo|Observação da organização/);
  });
});

test('Resend failure or missing e-mail never changes the API response', async () => {
  resetDatabase();
  await withResend(500, async (calls, logs) => {
    const response = await review(JUDGE, { submissionId: 'sub-1', decision: 'rejected', justification: 'Vídeo cortado' });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).success, true);
    assert.equal(calls.length, 1);
    assert.equal(database.rows('score_submissions').find(row => row.id === 'sub-1').status, 'rejected');
    assert.ok(logs.some(line => line.includes('[Resend Qualifier Decision]')));
  });
  await withResend(200, async (calls, logs) => {
    const response = await review(JUDGE, { submissionId: 'sub-sem-email', decision: 'validated' });
    assert.equal(response.status, 200);
    assert.equal(calls.length, 0);
    assert.ok(logs.some(line => line.includes('Inscrição sem e-mail do atleta')));
  });
});

test('a rejected RPC sends no e-mail', async () => {
  resetDatabase();
  rpcError = 'qualifier_submission_version_conflict';
  await withResend(200, async (calls) => {
    const response = await review(JUDGE, { submissionId: 'sub-1', decision: 'validated' });
    assert.notEqual(response.status, 200);
    assert.equal(calls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Área do atleta (Story 1.109)
// ---------------------------------------------------------------------------

test('athlete submissions carry the latest decision without who reviewed it', async () => {
  resetDatabase();
  await withResend(200, async () => {
    await review(JUDGE, { submissionId: 'sub-1', decision: 'penalized', justification: '9 wall balls abaixo do alvo' });
  });
  const response = await submissionsGET(new Request('http://localhost/api/submissions', { headers: { cookie: cookie(ATHLETE) } }));
  assert.equal(response.status, 200);
  const body = await response.json();
  const raw = JSON.stringify(body);
  assert.equal(database.rows('score_submissions').find(row => row.id === 'sub-1').reviewed_by, JUDGE.id);
  assert.doesNotMatch(raw, /Judge Rita|judge-q|judge_name|judgeName|reviewedBy/);
  const sub = body.submissions.find(item => item.id === 'sub-1');
  assert.equal(sub.latestDecision.decision, 'penalized');
  assert.equal(sub.latestDecision.decidedBy, 'judge');
  assert.equal(sub.latestDecision.note, '9 wall balls abaixo do alvo');
  assert.equal(body.submissions.find(item => item.id === 'sub-en').latestDecision, undefined);
});

test('a new submission version does not carry the previous decision note', async () => {
  resetDatabase();
  await withResend(200, async () => {
    await review(JUDGE, { submissionId: 'sub-1', decision: 'rejected', justification: 'Vídeo cortado' });
  });
  Object.assign(database.rows('score_submissions').find(row => row.id === 'sub-1'), { status: 'pending_review', current_version: 2, final_result: null });
  const response = await submissionsGET(new Request('http://localhost/api/submissions', { headers: { cookie: cookie(ATHLETE) } }));
  const sub = (await response.json()).submissions.find(item => item.id === 'sub-1');
  assert.equal(sub.status, 'pending_review');
  assert.equal(sub.latestDecision, undefined);
});

test('athlete situation labels match the e-mail', () => {
  const base = { entrySource: 'athlete', submittedResult: '214', finalResult: '214' };
  const situation = (extra) => athleteDecision.getQualifierAthleteSituation({ ...base, ...extra });
  assert.equal(situation({ status: 'validated', latestDecision: { decision: 'manual_adjustment', decidedBy: 'judge', decidedAt: 'x' } }), 'adjusted');
  assert.equal(situation({ status: 'validated', entrySource: 'manager', latestDecision: { decision: 'manual_adjustment', decidedBy: 'organization', decidedAt: 'x' } }), 'validated');
  assert.equal(situation({ status: 'penalized' }), 'penalized');
  assert.equal(athleteDecision.QUALIFIER_ATHLETE_SITUATION_LABELS.awaiting_resubmission, 'Novo envio solicitado');
  assert.equal(athleteDecision.getQualifierAthleteOfficialResult({ ...base, status: 'pending_review' }), undefined);
  assert.equal(athleteDecision.getQualifierAthleteNoteLabel({ ...base, status: 'rejected', latestDecision: { decidedBy: 'judge' } }), 'Observação da arbitragem');
});

test('athlete area and panels show the decision in Portuguese', () => {
  const athleteArea = read('../src/components/QualifierAthleteSubmissions.tsx');
  assert.match(athleteArea, /<SubmissionDecision submission=\{existing\} canSubmit=\{canSubmit\} \/>/);
  assert.match(athleteArea, /<SituationBadge submission=\{item\} \/>/);
  assert.doesNotMatch(athleteArea, /Status atual: <strong className="text-white">\{existing\.status\}/);
  assert.match(read('../src/app/judge/page.tsx'), /Decisão registrada\. O atleta será avisado por e-mail\./);
  assert.match(read('../src/components/QualifierResultsManager.tsx'), /revisado\. O atleta será avisado por e-mail\./);
});
