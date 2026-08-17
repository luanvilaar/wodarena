import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const types = read('../src/types/index.ts');
const context = read('../src/context/AppContext.tsx');
const migration = read('../supabase/migrations/20260816120000_functional_fitness_qualifier.sql');
const submissionsRoute = read('../src/app/api/submissions/route.ts');
const judgeQueueRoute = read('../src/app/api/judge/queue/route.ts');
const judgeReviewRoute = read('../src/app/api/judge/reviews/route.ts');
const persistenceRoute = read('../src/app/api/admin/persistence/route.ts');
const contestationsRoute = read('../src/app/api/contestations/route.ts');
const contestationDetailRoute = read('../src/app/api/contestations/[id]/route.ts');
const scoring = read('../src/lib/scoring.ts');
const videoProof = read('../src/lib/videoProof.ts');
const windowHelper = read('../src/lib/submissionWindow.ts');
const publicBootstrap = read('../src/lib/bootstrapPayload.ts');
const athleteSubmissions = read('../src/components/QualifierAthleteSubmissions.tsx');
const athleteContestation = read('../src/components/QualifierAthleteContestation.tsx');
const judgePage = read('../src/app/judge/page.tsx');
const managerPanel = read('../src/components/QualifierManagerPanel.tsx');
const adminPage = read('../src/app/admin/page.tsx');
const cli = read('../bin/qualifier.mjs');
const packageJson = read('../package.json');

test('Qualifier is a first-class event type with online submission and review models', () => {
  assert.match(types, /EventType = 'functional_fitness' \| 'fitness_racing' \| 'functional_fitness_qualifier'/);
  assert.match(types, /role: 'owner' \| 'manager' \| 'athlete' \| 'judge'/);
  assert.match(types, /submissionOpensAt\?: string/);
  assert.match(types, /submissionClosesAt\?: string/);
  assert.match(types, /export interface ScoreSubmission/);
  assert.match(types, /export interface ScoreSubmissionReview/);
  assert.match(context, /submission_opens_at: newWorkout\.submissionOpensAt \|\| null/);
  assert.match(context, /submission_closes_at: newWorkout\.submissionClosesAt \|\| null/);
});

test('migration persists qualifier submissions, judges and immutable audit trails', () => {
  assert.match(migration, /functional_fitness_qualifier/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS event_judges/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS score_submissions/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS score_submission_versions/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS score_submission_reviews/);
  assert.match(migration, /REFERENCES score_submissions\(id\) ON DELETE RESTRICT/);
  assert.match(migration, /trg_qualifier_reviews_immutable/);
  assert.match(migration, /trg_qualifier_submission_versions_immutable/);
  assert.match(migration, /trg_qualifier_protect_workout/);
  assert.match(migration, /trg_qualifier_protect_registration/);
  assert.match(migration, /trg_qualifier_require_workout_deadline/);
  assert.doesNotMatch(migration, /AS \$\$\s*\nAS \$\$/);
});

test('submission window and scoring rules are centralized and match the documented 15% policy', () => {
  assert.match(windowHelper, /export const getSubmissionWindowState/);
  assert.match(windowHelper, /fortalezaDateTimeLocalToUtc/);
  assert.match(scoring, /Math\.ceil\(submitted\.value \* 1\.15\)/);
  assert.match(scoring, /Math\.floor\(submitted\.value \* 0\.85\)/);
  assert.match(scoring, /Math\.round\(\(value \+ Number\.EPSILON\) \* 100\) \/ 100/);
  assert.match(migration, /CEIL\(v_submission\.submitted_value \* 1\.15\)/);
  assert.match(migration, /FLOOR\(v_submission\.submitted_value \* 0\.85\)/);
  assert.match(migration, /ROUND\(v_submission\.submitted_value \* 0\.85, 2\)/);
});

test('athlete and judge APIs authenticate, scope private proof video and use transactional RPCs', () => {
  assert.match(submissionsRoute, /requireSession\(request, \['athlete'\]\)/);
  assert.match(submissionsRoute, /\.eq\('user_id', auth\.user\.id\)/);
  assert.match(submissionsRoute, /normalizeYouTubeVideoUrl/);
  assert.match(submissionsRoute, /qualifier_submit_submission/);
  assert.match(judgeQueueRoute, /getQualifierEventIdsForActor/);
  assert.match(judgeReviewRoute, /assertQualifierJudgeAccess/);
  assert.match(judgeReviewRoute, /qualifier_apply_review/);
  assert.match(videoProof, /youtube\.com/);
  assert.match(videoProof, /youtu\.be/);
  assert.doesNotMatch(publicBootstrap, /video_url|video_id|score_submissions/);
});

test('qualification-specific protections prevent unsafe manual score and schedule flows', () => {
  assert.match(persistenceRoute, /Eventos Functional Fitness Qualifier não aceitam baterias no cronograma/);
  assert.match(persistenceRoute, /validateQualifierWorkoutWindow/);
  assert.match(persistenceRoute, /Defina o prazo de submissão em todas as provas antes de converter o evento em Qualifier/);
  assert.match(persistenceRoute, /Scores de Qualifier devem ser definidos exclusivamente pela revisão de submissões/);
  assert.match(migration, /qualifier_workout_submission_deadline_required/);
  assert.match(migration, /qualifier_event_type_locked_after_submissions/);
});

test('contestations use the existing credit flow and reopen submissions atomically', () => {
  assert.match(contestationsRoute, /submissionId/);
  assert.match(contestationsRoute, /Já existe uma contestação em análise para esta submissão/);
  assert.match(contestationDetailRoute, /qualifier_resolve_contestation_and_reopen/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION qualifier_resolve_contestation_and_reopen/);
  assert.match(migration, /PERFORM qualifier_reopen_submission/);
  assert.match(athleteContestation, /Contestar uma decisão de submissão/);
});

test('required operational dashboards and CLI are available without leaking into public UI', () => {
  assert.match(athleteSubmissions, /Enviar resultados/);
  assert.match(judgePage, /Dashboard do judge/);
  assert.match(adminPage, /currentUser\.role === 'judge'/);
  assert.match(adminPage, /Redirecionando para o dashboard de arbitragem/);
  assert.match(managerPanel, /Judges/);
  assert.match(packageJson, /"qualifier:cli": "node bin\/qualifier\.mjs"/);
  assert.match(cli, /qualifier_create_judge/);
  assert.match(cli, /qualifier_submit_submission/);
  assert.match(cli, /qualifier_apply_review/);
  const help = spawnSync(process.execPath, ['bin/qualifier.mjs', 'help'], { encoding: 'utf8', cwd: new URL('..', import.meta.url) });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /judge create/);
  assert.match(help.stdout, /review apply/);
});
