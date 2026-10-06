import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import ts from 'typescript';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const load = async (path) => {
  const compiled = ts.transpileModule(read(path), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
};

const migration = read('../supabase/migrations/20261006130000_qualifier_manager_manual_results.sql');
const manualRoute = read('../src/app/api/judge/submissions/manual-result/route.ts');
const rosterRoute = read('../src/app/api/qualifier/results-roster/route.ts');
const reviewsRoute = read('../src/app/api/judge/reviews/route.ts');
const resubmissionRoute = read('../src/app/api/judge/submissions/request-resubmission/route.ts');
const judgeAccess = read('../src/lib/serverJudgeAccess.ts');
const notifications = read('../src/lib/qualifierNotifications.ts');
const resend = read('../src/lib/resend.ts');
const resultsManager = read('../src/components/QualifierResultsManager.tsx');
const athleteSubmissions = read('../src/components/QualifierAthleteSubmissions.tsx');
const cli = read('../bin/qualifier.mjs');

const results = await load('../src/lib/qualifierResults.ts');
const submissions = await load('../src/lib/qualifierSubmissions.ts');

const row = (overrides = {}) => ({
  registrationId: 'r1', athleteName: 'Luan Vilar', box: 'Selva CrossFit', divisionId: 'd1', divisionName: 'RX Masculino',
  submission: null, ...overrides
});
const withStatus = (status, extra = {}) => row({
  submission: { id: 's1', status, entrySource: 'athlete', submittedResult: '134', currentVersion: 1, videoUrl: 'https://youtu.be/x', ...extra }
});

// ---------------------------------------------------------------------------
// Regras de estado e ações da tela (espelham o banco)
// ---------------------------------------------------------------------------

test('result state derives from the submission and "no submission" is a first-class state', () => {
  assert.equal(results.getQualifierResultState(row()), 'no_submission');
  assert.equal(results.getQualifierResultState(withStatus('pending_review')), 'pending_review');
  assert.equal(results.QUALIFIER_RESULT_STATE_LABELS.no_submission, 'Sem envio');
  assert.equal(results.QUALIFIER_RESULT_STATE_LABELS.awaiting_resubmission, 'Aguardando reenvio do atleta');
  assert.equal(results.QUALIFIER_RESULT_STATES.length, 6);
});

test('manual launch is offered only without an active result; clearing only for reviewed results', () => {
  const actions = (state) => results.getQualifierResultActions(state);
  assert.deepEqual(actions('no_submission'), { canEnter: true, canEdit: false, canRequestResubmission: false });
  assert.deepEqual(actions('awaiting_resubmission'), { canEnter: true, canEdit: false, canRequestResubmission: false });
  assert.deepEqual(actions('pending_review'), { canEnter: false, canEdit: true, canRequestResubmission: false });
  for (const state of ['validated', 'penalized', 'rejected']) {
    assert.deepEqual(actions(state), { canEnter: false, canEdit: true, canRequestResubmission: true });
  }
});

test('filters and summary work on accent-insensitive names, box, division and state', () => {
  const rows = [
    row({ registrationId: 'a', athleteName: 'José Álvares', box: 'Box Norte', divisionId: 'd1' }),
    withStatus('validated', {}),
    row({ registrationId: 'c', athleteName: 'Maria', box: 'Selva', divisionId: 'd2', submission: { id: 's3', status: 'awaiting_resubmission', entrySource: 'athlete', submittedResult: '1', currentVersion: 1, videoUrl: '' } })
  ];
  assert.deepEqual(results.filterQualifierResultRows(rows, { search: 'jose alvares' }).map(item => item.registrationId), ['a']);
  assert.deepEqual(results.filterQualifierResultRows(rows, { search: 'selva' }).map(item => item.registrationId), ['r1', 'c']);
  assert.deepEqual(results.filterQualifierResultRows(rows, { divisionId: 'd2' }).map(item => item.registrationId), ['c']);
  assert.deepEqual(results.filterQualifierResultRows(rows, { state: 'no_submission' }).map(item => item.registrationId), ['a']);
  assert.equal(results.filterQualifierResultRows(rows, { state: 'all' }).length, 3);
  const summary = results.summarizeQualifierResultRows(rows);
  assert.equal(summary.total, 3);
  assert.equal(summary.no_submission, 1);
  assert.equal(summary.validated, 1);
  assert.equal(summary.awaiting_resubmission, 1);
});

test('a result entered by the organization has no video and must not become the string "null"', () => {
  const mapped = submissions.mapScoreSubmissionFromDb({
    id: 's1', event_id: 'e1', workout_id: 'w1', division_id: 'd1', registration_id: 'r1', user_id: 'u1', athlete_id: 'a1',
    submitted_result: '120', submitted_value: '120', video_url: null, video_id: null, athlete_note: null,
    entry_source: 'manager', status: 'validated', final_result: '120', final_value: '120', penalty_percent: null,
    submitted_at: '2026-10-06T10:00:00Z', reviewed_at: '2026-10-06T10:00:00Z', reviewed_by: 'm1', current_version: 1,
    created_at: '2026-10-06T10:00:00Z', updated_at: '2026-10-06T10:00:00Z'
  });
  assert.equal(mapped.videoUrl, '');
  assert.equal(mapped.videoId, '');
  assert.equal(mapped.entrySource, 'manager');
  const athleteRow = submissions.mapScoreSubmissionFromDb({ ...{ id: 's2', event_id: 'e', workout_id: 'w', division_id: 'd', registration_id: 'r', user_id: 'u', submitted_result: '1', submitted_value: 1, status: 'pending_review', submitted_at: 't', created_at: 't', updated_at: 't' }, video_url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA', video_id: 'AAAAAAAAAAA' });
  assert.equal(athleteRow.entrySource, 'athlete');
  assert.equal(athleteRow.videoId, 'AAAAAAAAAAA');
});

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

test('migration adds the entry source and makes the video optional only for organization entries', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS entry_source TEXT NOT NULL DEFAULT 'athlete'/);
  assert.match(migration, /CHECK \(entry_source IN \('athlete', 'manager'\)\)/);
  assert.match(migration, /ALTER COLUMN video_url DROP NOT NULL/);
  assert.match(migration, /CHECK \(entry_source = 'manager' OR \(video_url IS NOT NULL AND video_id IS NOT NULL\)\)/);
  assert.match(migration, /ALTER TABLE score_submission_versions ALTER COLUMN video_url DROP NOT NULL/);
});

test('qualifier_manager_enter_result is exclusive to the event organizer manager', () => {
  const body = migration.slice(
    migration.indexOf('CREATE OR REPLACE FUNCTION qualifier_manager_enter_result('),
    migration.indexOf('COMMENT ON FUNCTION qualifier_manager_enter_result')
  );
  assert.match(body, /coalesce\(v_actor\.role, ''\) <> 'manager'[\s\S]*qualifier_manual_result_not_allowed/);
  assert.match(body, /v_event\.organizer_id IS DISTINCT FROM v_actor\.id[\s\S]*qualifier_manual_result_not_allowed/);
  assert.doesNotMatch(body, /'owner'/);
  assert.doesNotMatch(body, /'judge'/);
  assert.match(body, /service_valid_until[\s\S]*qualifier_manager_access_expired/);
  assert.match(body, /event_type IS DISTINCT FROM 'functional_fitness_qualifier'[\s\S]*qualifier_event_required/);
  assert.match(body, /payment_status = 'payment_approved'/);
  assert.match(body, /qualifier_reviewer_conflict_of_interest/);
  assert.match(body, /qualifier_workout_division_mismatch/);
  assert.match(body, /qualifier_manual_result_justification_required/);
  // só lança sem resultado ativo; não depende da janela de envio
  assert.match(body, /qualifier_submission_already_pending/);
  assert.match(body, /v_submission\.status <> 'awaiting_resubmission'[\s\S]*qualifier_submission_already_reviewed/);
  assert.doesNotMatch(body, /submission_closes_at|submission_opens_at/);
  // trilha de auditoria + ranking
  assert.match(body, /INSERT INTO score_submission_versions/);
  assert.match(body, /INSERT INTO score_submission_reviews[\s\S]*'manual_adjustment'/);
  assert.match(body, /'manager', 'validated'|'validated', 'manager'/);
  assert.match(body, /result_status[\s\S]*'manual'/);
  assert.match(body, /pg_advisory_xact_lock[\s\S]*INSERT INTO scores/);
  assert.match(body, /PERFORM qualifier_refresh_workout_scores/);
});

test('editing and clearing reviewed results is restricted to the organizer manager; penalty stays fixed at 15%', () => {
  const applyReview = migration.slice(
    migration.indexOf('CREATE OR REPLACE FUNCTION qualifier_apply_review('),
    migration.indexOf('CREATE OR REPLACE FUNCTION qualifier_request_resubmission(')
  );
  assert.match(applyReview, /v_submission\.status <> 'pending_review'\s+AND NOT \(v_actor\.role = 'manager' AND v_event\.organizer_id = v_actor\.id\)[\s\S]*qualifier_review_edit_not_allowed/);
  assert.match(applyReview, /v_penalty := 15;/);
  assert.doesNotMatch(applyReview, /p_penalty_percent/);

  const resubmission = migration.slice(
    migration.indexOf('CREATE OR REPLACE FUNCTION qualifier_request_resubmission('),
    migration.indexOf('CREATE OR REPLACE FUNCTION qualifier_submit_submission(')
  );
  assert.match(resubmission, /coalesce\(v_actor\.role, ''\) <> 'manager'[\s\S]*qualifier_request_resubmission_not_allowed/);
  assert.doesNotMatch(resubmission, /NOT IN \('owner', 'manager'\)/);

  const submit = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION qualifier_submit_submission('), migration.indexOf('-- 6. Privilégios'));
  assert.match(submit, /SET status = 'pending_review', entry_source = 'athlete'/);
});

test('migration keeps every RPC callable by service_role only', () => {
  for (const signature of [
    'qualifier_manager_enter_result\\(TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT\\)',
    'qualifier_request_resubmission\\(TEXT, TEXT, TIMESTAMPTZ, TEXT\\)',
    'qualifier_apply_review\\(TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, NUMERIC\\)',
    'qualifier_submit_submission\\(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, INTEGER\\)'
  ]) {
    assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC, anon, authenticated;`));
    assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`));
  }
});

// ---------------------------------------------------------------------------
// Rotas e acesso
// ---------------------------------------------------------------------------

test('strict organizer access never lets the platform owner through', () => {
  const strict = judgeAccess.slice(judgeAccess.indexOf('export const assertQualifierEventOrganizerAccess'), judgeAccess.indexOf('export const assertQualifierJudgeAccess'));
  assert.match(strict, /actor\.role !== 'manager' \|\| event\.organizer_id !== actor\.id/);
  assert.doesNotMatch(strict, /owner/);
  assert.match(strict, /assertOrganizerIsOperational\(supabaseAdmin, actor\.id\)/);
});

test('manual-result route: manager-only session, event ownership, parsed score, RPC, then e-mail', () => {
  assert.match(manualRoute, /export async function POST\(request: Request\)/);
  assert.doesNotMatch(manualRoute, /export async function (GET|PUT|PATCH|DELETE)/);
  assert.match(manualRoute, /requireSession\(request, \['manager'\]\)/);
  assert.doesNotMatch(manualRoute, /requireSession\(request, \[[^\]]*'(owner|judge)'/);
  assert.match(manualRoute, /assertQualifierEventOrganizerAccess\(supabaseAdmin, auth\.user, eventId\)/);
  assert.match(manualRoute, /checkRateLimit\(\{ key: `qualifier-manual-result:\$\{auth\.user\.id\}`/);
  assert.match(manualRoute, /\.eq\('event_id', eventId\)/);
  assert.match(manualRoute, /parseScoreForWorkout\(workout\.type, body\.result\)/);
  assert.match(manualRoute, /rpc\('qualifier_manager_enter_result'/);
  assert.match(manualRoute, /p_actor_id: auth\.user\.id/);
  assert.match(manualRoute, /status: qualifierErrorStatus\(message\)/);
  assert.match(manualRoute, /Informe a justificativa do lançamento manual\./);
  const rpcIndex = manualRoute.indexOf("rpc('qualifier_manager_enter_result'");
  const notifyIndex = manualRoute.indexOf('await notifyAthleteOfQualifierResult(');
  assert.ok(rpcIndex > 0 && notifyIndex > rpcIndex, 'o aviso por e-mail só ocorre depois do RPC concluir');
  assert.match(manualRoute, /change: 'manager_entry'/);
  assert.doesNotMatch(manualRoute, /from '@\/lib\/supabase'/);
});

test('results roster is manager-only, bounded and does not expose athlete contact data', () => {
  assert.match(rosterRoute, /export async function GET\(request: Request\)/);
  assert.doesNotMatch(rosterRoute, /export async function (POST|PUT|PATCH|DELETE)/);
  assert.match(rosterRoute, /requireSession\(request, \['manager'\]\)/);
  assert.match(rosterRoute, /assertQualifierEventOrganizerAccess\(supabaseAdmin, auth\.user, eventId\)/);
  assert.match(rosterRoute, /\.eq\('payment_status', 'payment_approved'\)/);
  assert.match(rosterRoute, /\.range\(0, MAX_ROWS - 1\)/);
  assert.match(rosterRoute, /if \(workout\.division_id\) registrationsQuery = registrationsQuery\.eq\('division_id', workout\.division_id\)/);
  assert.doesNotMatch(rosterRoute, /athlete_email|athlete_phone|phone|cpf/i);
});

test('only the organizer manager edits reviewed results, and the athlete is told about it', () => {
  assert.match(reviewsRoute, /const isEdit = submission\.status !== 'pending_review';/);
  assert.match(reviewsRoute, /if \(isEdit && auth\.user\.role !== 'manager'\)[\s\S]*status: 403/);
  assert.match(reviewsRoute, /qualifier_review_edit_not_allowed/);
  const rpcIndex = reviewsRoute.indexOf("rpc('qualifier_apply_review'");
  const notifyIndex = reviewsRoute.indexOf('await notifyAthleteOfQualifierResult(');
  assert.ok(rpcIndex > 0 && notifyIndex > rpcIndex);
  assert.match(reviewsRoute, /if \(isEdit\) \{\s*await notifyAthleteOfQualifierResult/);
  assert.match(resubmissionRoute, /requireSession\(request, \['manager'\]\)/);
});

test('e-mail to the athlete is escaped, labelled and best-effort', () => {
  assert.match(resend, /export async function sendQualifierResultUpdatedEmail\(params: \{/);
  const emailBody = resend.slice(resend.indexOf('export async function sendQualifierResultUpdatedEmail'), resend.indexOf('export async function sendCommercialLeadOwnerEmail'));
  for (const field of ['athleteName', 'eventName', 'workoutName', 'situationLabel', 'finalResult', 'justification']) {
    assert.match(emailBody, new RegExp(`escapeHtml\\(params\\.${field}`));
  }
  assert.match(emailBody, /Resultado lançado pela organização/);
  assert.match(notifications, /manager_entry: 'Lançado pela organização'/);
  assert.match(notifications, /penalized: 'Penalizado \(-15%\)'/);
  assert.match(notifications, /try \{[\s\S]*\} catch \(error\) \{\s*console\.error/);
  assert.match(notifications, /launchedByOrganization: params\.change === 'manager_entry'/);
});

// ---------------------------------------------------------------------------
// Tela, atleta e CLI
// ---------------------------------------------------------------------------

test('results screen lists every eligible athlete and exposes launch, edit and clear', () => {
  assert.match(resultsManager, /Lançado pela organização/);
  assert.match(resultsManager, /postJson\('\/api\/judge\/submissions\/manual-result'/);
  assert.match(resultsManager, /registrationId: row\.registrationId/);
  assert.match(resultsManager, />Lançar resultado</);
  assert.match(resultsManager, /id=\{`qualifier-enter-justification-\$\{formId\}`\}[\s\S]*?required/);
  assert.match(resultsManager, /<option value="penalized">Penalizado \(-15%\)<\/option>/);
  assert.match(resultsManager, /<option value="manual_adjustment">Ajuste manual<\/option>/);
  assert.match(resultsManager, /id="qualifier-results-workout"/);
  assert.match(resultsManager, /id="qualifier-results-search"/);
  // lançar continua permitido com o prazo encerrado; excluir não
  assert.match(resultsManager, /disabled=\{busy \|\| windowClosed\} onClick=\{\(\) => openForm\(row, 'clear'\)\}/);
  assert.match(resultsManager, /disabled=\{busy\} onClick=\{\(\) => openForm\(row, 'enter'\)\}/);
  assert.doesNotMatch(resultsManager, /disabled=\{busy \|\| windowClosed\} onClick=\{\(\) => openForm\(row, 'enter'\)\}/);
  assert.doesNotMatch(resultsManager, /from '@\/lib\/supabase'/);
});

test('athlete sees when the result was entered by the organization', () => {
  assert.match(athleteSubmissions, /existing\.entrySource === 'manager' \? ' \(lançado pela organização\)'/);
  assert.match(athleteSubmissions, /item\.entrySource === 'manager' \? 'lançado pela organização em' : 'enviado em'/);
});

test('CLI mirrors manual launch through the same RPC', () => {
  assert.match(cli, /command === 'manual-result'/);
  assert.match(cli, /requireArgs\(args, \['actor', 'event', 'registration', 'workout', 'result', 'justification'\]\)/);
  assert.match(cli, /rpc\('qualifier_manager_enter_result'/);
  const help = spawnSync(process.execPath, ['bin/qualifier.mjs', 'help'], { encoding: 'utf8', cwd: new URL('..', import.meta.url) });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /review manual-result --actor MANAGER_ID --event EVENT_ID --registration REG_ID --workout WORKOUT_ID/);
  assert.match(help.stdout, /Lancado pela organizacao/);
});
