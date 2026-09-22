import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import ts from 'typescript';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const migration = read('../supabase/migrations/20260922120000_qualifier_manager_result_actions.sql');
const types = read('../src/types/index.ts');
const qualifierSubmissionsSource = read('../src/lib/qualifierSubmissions.ts');
const resubmissionRoutePath = '../src/app/api/judge/submissions/request-resubmission/route.ts';
const resubmissionRoute = read(resubmissionRoutePath);
const judgeQueueRoute = read('../src/app/api/judge/queue/route.ts');
const contestationsRoute = read('../src/app/api/contestations/route.ts');
const resend = read('../src/lib/resend.ts');
const resultsManagerPath = '../src/components/QualifierResultsManager.tsx';
const resultsManager = read(resultsManagerPath);
const adminPage = read('../src/app/admin/page.tsx');
const athleteSubmissions = read('../src/components/QualifierAthleteSubmissions.tsx');
const athleteContestation = read('../src/components/QualifierAthleteContestation.tsx');
const judgePage = read('../src/app/judge/page.tsx');
const cli = read('../bin/qualifier.mjs');

const qualifierSubmissionsCompiled = ts.transpileModule(qualifierSubmissionsSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText;
const { qualifierErrorStatus } = await import(`data:text/javascript;base64,${Buffer.from(qualifierSubmissionsCompiled).toString('base64')}`);

const requestResubmissionBody = migration.slice(
  migration.indexOf('CREATE OR REPLACE FUNCTION qualifier_request_resubmission('),
  migration.indexOf('COMMENT ON FUNCTION qualifier_request_resubmission')
);

test('migration adds awaiting_resubmission status and resubmission_requested decision to the CHECKs', () => {
  assert.match(migration, /ADD CONSTRAINT score_submissions_status_check\s+CHECK \(status IN \('pending_review', 'validated', 'penalized', 'rejected', 'awaiting_resubmission'\)\)/);
  assert.match(migration, /ADD CONSTRAINT score_submission_reviews_decision_check\s+CHECK \(decision IN \('validated', 'penalized', 'rejected', 'manual_adjustment', 'reopened', 'resubmission_requested'\)\)/);
  assert.match(types, /ScoreSubmissionStatus = 'pending_review' \| 'validated' \| 'penalized' \| 'rejected' \| 'awaiting_resubmission'/);
  assert.match(types, /ScoreSubmissionDecision = [^;]*'reopened' \| 'resubmission_requested'/);
});

test('qualifier_request_resubmission is restricted to organizer/owner and guards window, contestation and concurrency', () => {
  assert.ok(requestResubmissionBody.length > 0, 'RPC qualifier_request_resubmission ausente na migration');
  assert.match(requestResubmissionBody, /p_expected_reviewed_at TIMESTAMPTZ/);
  assert.match(requestResubmissionBody, /NOT IN \('owner', 'manager'\) THEN\s+RAISE EXCEPTION 'qualifier_request_resubmission_not_allowed'/);
  assert.match(requestResubmissionBody, /v_event\.organizer_id IS DISTINCT FROM v_actor\.id/);
  assert.match(requestResubmissionBody, /qualifier_manager_access_expired/);
  assert.match(requestResubmissionBody, /v_submission\.status NOT IN \('validated', 'penalized', 'rejected'\)[\s\S]*qualifier_submission_not_reviewed/);
  assert.match(requestResubmissionBody, /v_submission\.reviewed_at <> p_expected_reviewed_at[\s\S]*qualifier_review_state_conflict/);
  assert.match(requestResubmissionBody, /NOW\(\) > v_workout\.submission_closes_at THEN RAISE EXCEPTION 'qualifier_submission_window_closed'/);
  assert.match(requestResubmissionBody, /status = 'under_review'[\s\S]*qualifier_open_contestation_exists/);
  assert.match(requestResubmissionBody, /qualifier_request_resubmission_justification_required/);
  assert.match(requestResubmissionBody, /SET status = 'awaiting_resubmission'/);
  assert.match(requestResubmissionBody, /DELETE FROM scores/);
  assert.match(requestResubmissionBody, /'resubmission_requested'/);
  assert.match(requestResubmissionBody, /PERFORM qualifier_refresh_workout_scores/);
});

test('migration keeps the RPCs private to service_role', () => {
  assert.match(migration, /REVOKE ALL ON FUNCTION qualifier_request_resubmission\(TEXT, TEXT, TIMESTAMPTZ, TEXT\) FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /REVOKE ALL ON FUNCTION qualifier_apply_review\([^)]*\) FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /REVOKE ALL ON FUNCTION qualifier_submit_submission\([^)]*\) FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION qualifier_request_resubmission\(TEXT, TEXT, TIMESTAMPTZ, TEXT\) TO service_role/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION qualifier_apply_review\([^)]*\) TO service_role/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION qualifier_submit_submission\([^)]*\) TO service_role/);
});

test('re-review requires justification, judges stay locked out of reviewed submissions, athletes can resubmit', () => {
  assert.match(migration, /IF v_submission\.status <> 'pending_review' AND length\(trim\(coalesce\(p_justification, ''\)\)\) = 0 THEN\s+RAISE EXCEPTION 'qualifier_review_justification_required'/);
  assert.match(migration, /ELSIF v_actor\.role = 'judge' THEN[\s\S]*IF v_submission\.status <> 'pending_review' THEN RAISE EXCEPTION 'qualifier_submission_already_reviewed'/);
  assert.match(migration, /IF v_submission\.status NOT IN \('pending_review', 'awaiting_resubmission'\) THEN\s+RAISE EXCEPTION 'qualifier_submission_already_reviewed'/);
});

test('a submission awaiting resubmission cannot be re-reviewed or reopened behind the athlete\'s back', () => {
  const applyReviewBody = migration.slice(
    migration.indexOf('CREATE OR REPLACE FUNCTION qualifier_apply_review('),
    migration.indexOf('CREATE OR REPLACE FUNCTION qualifier_request_resubmission(')
  );
  assert.match(applyReviewBody, /IF v_submission\.status = 'awaiting_resubmission' THEN RAISE EXCEPTION 'qualifier_submission_awaiting_resubmission'; END IF;/);

  const reopenBody = migration.slice(
    migration.indexOf('CREATE OR REPLACE FUNCTION qualifier_reopen_submission('),
    migration.indexOf('-- 6. Privilégios')
  );
  assert.ok(reopenBody.length > 0, 'qualifier_reopen_submission ausente na migration');
  assert.match(reopenBody, /IF v_submission\.status = 'awaiting_resubmission' THEN RAISE EXCEPTION 'qualifier_submission_awaiting_resubmission'; END IF;/);
  assert.match(migration, /REVOKE ALL ON FUNCTION qualifier_reopen_submission\(TEXT, TEXT, TEXT\) FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION qualifier_reopen_submission\(TEXT, TEXT, TEXT\) TO service_role/);
});

test('advisory lock is taken before touching scores, in every function that can race on the same workout/division', () => {
  const applyReviewBody = migration.slice(
    migration.indexOf('CREATE OR REPLACE FUNCTION qualifier_apply_review('),
    migration.indexOf('CREATE OR REPLACE FUNCTION qualifier_request_resubmission(')
  );
  const lockIndexApply = applyReviewBody.indexOf('pg_advisory_xact_lock');
  const insertIndexApply = applyReviewBody.indexOf('INSERT INTO scores');
  assert.ok(lockIndexApply > 0 && lockIndexApply < insertIndexApply, 'qualifier_apply_review deve travar antes de gravar em scores');

  const lockIndexRequest = requestResubmissionBody.indexOf('pg_advisory_xact_lock');
  const deleteIndexRequest = requestResubmissionBody.indexOf('DELETE FROM scores');
  assert.ok(lockIndexRequest > 0 && lockIndexRequest < deleteIndexRequest, 'qualifier_request_resubmission deve travar antes de apagar de scores');

  const reopenBody = migration.slice(
    migration.indexOf('CREATE OR REPLACE FUNCTION qualifier_reopen_submission('),
    migration.indexOf('-- 6. Privilégios')
  );
  const lockIndexReopen = reopenBody.indexOf('pg_advisory_xact_lock');
  const deleteIndexReopen = reopenBody.indexOf('DELETE FROM scores');
  assert.ok(lockIndexReopen > 0 && lockIndexReopen < deleteIndexReopen, 'qualifier_reopen_submission deve travar antes de apagar de scores');
});

test('request-resubmission route is manager/owner only, scoped to the event and rate limited', () => {
  assert.ok(existsSync(new URL(resubmissionRoutePath, import.meta.url)));
  assert.match(resubmissionRoute, /export async function POST\(request: Request\)/);
  assert.doesNotMatch(resubmissionRoute, /export async function (GET|PUT|PATCH|DELETE)/);
  assert.match(resubmissionRoute, /requireSession\(request, \['manager', 'owner'\]\)/);
  assert.doesNotMatch(resubmissionRoute, /requireSession\(request, \[[^\]]*'judge'/);
  assert.match(resubmissionRoute, /assertQualifierEventManagerAccess\(supabaseAdmin, auth\.user, String\(submission\.event_id\)\)/);
  assert.match(resubmissionRoute, /checkRateLimit\(\{ key: `qualifier-resubmission:\$\{auth\.user\.id\}`, limit: 10, windowMs: 60_000 \}\)/);
  assert.match(resubmissionRoute, /rpc\('qualifier_request_resubmission'/);
  assert.match(resubmissionRoute, /p_actor_id: auth\.user\.id/);
  assert.match(resubmissionRoute, /status: qualifierErrorStatus\(message\)/);
  assert.match(resubmissionRoute, /NextResponse\.json\(\{ success: true, result: data \}\)/);
});

test('reviewed_at concurrency token travels as the raw database string, never through new Date()', () => {
  assert.match(resubmissionRoute, /p_expected_reviewed_at: expectedReviewedAt/);
  assert.match(resubmissionRoute, /const expectedReviewedAt = typeof body\.expectedReviewedAt === 'string' \? body\.expectedReviewedAt : null/);
  const resubmissionRouteCode = resubmissionRoute.replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(resubmissionRouteCode, /new Date\(/);
  assert.match(resultsManager, /expectedReviewedAt: item\.reviewedAt,/);
  assert.doesNotMatch(resultsManager, /expectedReviewedAt: new Date/);
  assert.match(cli, /p_expected_reviewed_at: expectedReviewedAt/);
});

test('athlete is notified by e-mail only after the RPC succeeds, in best-effort mode', () => {
  assert.match(resend, /export async function sendQualifierResubmissionRequestedEmail\(params: \{\s*to: string;\s*athleteName: string;\s*eventName: string;\s*workoutName: string;\s*justification: string;/);
  assert.match(resend, /escapeHtml\(params\.justification/);
  const rpcIndex = resubmissionRoute.indexOf("rpc('qualifier_request_resubmission'");
  const notifyIndex = resubmissionRoute.indexOf('await notifyAthlete(');
  assert.ok(rpcIndex > 0 && notifyIndex > rpcIndex, 'o e-mail deve ser disparado depois do RPC');
  assert.match(resubmissionRoute, /sendQualifierResubmissionRequestedEmail\(\{/);
  assert.match(resubmissionRoute, /catch \(error\) \{\s*console\.error\('\[Qualifier Resubmission API\] Erro ao notificar atleta por e-mail:', error\);/);
});

test('qualifierErrorStatus maps the new RPC error codes', () => {
  assert.equal(qualifierErrorStatus('qualifier_request_resubmission_not_allowed'), 403);
  assert.equal(qualifierErrorStatus('qualifier_manager_access_expired'), 403);
  assert.equal(qualifierErrorStatus('qualifier_event_required'), 400);
  assert.equal(qualifierErrorStatus('qualifier_submission_not_reviewed'), 409);
  assert.equal(qualifierErrorStatus('qualifier_review_state_conflict'), 409);
  assert.equal(qualifierErrorStatus('qualifier_submission_window_closed'), 409);
  assert.equal(qualifierErrorStatus('qualifier_open_contestation_exists'), 409);
  assert.equal(qualifierErrorStatus('qualifier_request_resubmission_justification_required'), 400);
  assert.equal(qualifierErrorStatus('qualifier_submission_deadline_required'), 400);
  assert.equal(qualifierErrorStatus('qualifier_submission_not_found'), 404);
  assert.equal(qualifierErrorStatus('qualifier_submission_awaiting_resubmission'), 409);
});

test('queue accepts awaiting_resubmission and contestations are blocked while awaiting resubmission', () => {
  assert.match(judgeQueueRoute, /\['pending_review', 'validated', 'penalized', 'rejected', 'awaiting_resubmission'\]\.includes\(status\)/);
  assert.match(contestationsRoute, /\['pending_review', 'awaiting_resubmission'\]\.includes\(submission\.status\)/);
  assert.match(athleteContestation, /awaiting_resubmission: 'Aguardando reenvio do atleta'/);
  assert.match(athleteContestation, /CONTESTABLE_STATUSES: ScoreSubmission\['status'\]\[\] = \['validated', 'penalized', 'rejected'\]/);
  assert.match(athleteContestation, /CONTESTABLE_STATUSES\.includes\(submission\.status\)/);
});

test('athlete can resubmit when the organizer removed the previous result', () => {
  assert.match(athleteSubmissions, /existing\?\.status === 'awaiting_resubmission'/);
  assert.match(athleteSubmissions, /const canSubmit = !existing \|\| existing\.status === 'pending_review' \|\| awaitingResubmission/);
  assert.match(athleteSubmissions, /O organizador removeu seu resultado anterior e solicitou um novo envio\./);
  assert.match(judgePage, /item\.status === 'awaiting_resubmission'\) return 'Aguardando reenvio'/);
});

test('results manager lives in the qualifier scores tab and drives edit/delete through the server routes', () => {
  assert.ok(existsSync(new URL(resultsManagerPath, import.meta.url)));
  assert.match(resultsManager, /export function QualifierResultsManager\(\{ event \}: \{ event: Event \}\)/);
  assert.match(resultsManager, /fetch\(`\/api\/judge\/queue\?event_id=\$\{encodeURIComponent\(event\.id\)\}`\)/);
  assert.match(resultsManager, /MANAGED_STATUSES: ScoreSubmission\['status'\]\[\] = \['validated', 'penalized', 'rejected', 'awaiting_resubmission'\]/);
  assert.match(resultsManager, /postJson\('\/api\/judge\/reviews'/);
  assert.match(resultsManager, /expectedVersion: item\.currentVersion/);
  assert.match(resultsManager, /postJson\('\/api\/judge\/submissions\/request-resubmission'/);
  assert.match(resultsManager, /getSubmissionWindowState\(null, closesAt\) === 'closed'/);
  assert.match(resultsManager, /O atleta poderá reenviar um novo vídeo e resultado do zero\. Esta ação fica registrada\./);
  assert.doesNotMatch(resultsManager, /from '@\/lib\/supabase'/);
  assert.match(adminPage, /import \{ QualifierResultsManager \} from '@\/components\/QualifierResultsManager';/);
  assert.match(adminPage, /activeEventTab === 'scores' && \([\s\S]*?selectedEventToManage\.eventType === 'functional_fitness_qualifier'\s*\?\s*<QualifierResultsManager event=\{selectedEventToManage\} \/>[\s\S]*?: renderAbaScores\(\)/);
  assert.match(adminPage, /selectedEventToManage\.eventType === 'fitness_racing'\s*\?\s*renderAbaFitnessRaceScores\(\)/);
});

test('CLI exposes review request-resubmission through the same RPC', () => {
  assert.match(cli, /command === 'request-resubmission'/);
  assert.match(cli, /requireArgs\(args, \['actor', 'submission', 'justification'\]\)/);
  assert.match(cli, /rpc\('qualifier_request_resubmission'/);
  const help = spawnSync(process.execPath, ['bin/qualifier.mjs', 'help'], { encoding: 'utf8', cwd: new URL('..', import.meta.url) });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /review request-resubmission --actor ACTOR_ID --submission SUBMISSION_ID \[--expected-reviewed-at ISO\] --justification/);
  assert.match(help.stdout, /awaiting_resubmission/);
});
