import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const migration = read('../supabase/migrations/20260816120000_functional_fitness_qualifier.sql');
const submissionsRoute = read('../src/app/api/submissions/route.ts');
const judgeQueueRoute = read('../src/app/api/judge/queue/route.ts');
const judgeReviewRoute = read('../src/app/api/judge/reviews/route.ts');
const judgeAccess = read('../src/lib/serverJudgeAccess.ts');
const contestationDetailRoute = read('../src/app/api/contestations/[id]/route.ts');

test('private qualifier tables and RPCs are inaccessible to anon and authenticated database roles', () => {
  for (const table of ['event_judges', 'score_submissions', 'score_submission_versions', 'score_submission_reviews']) {
    assert.match(migration, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
  }
  assert.match(migration, /REVOKE ALL ON TABLE event_judges, score_submissions, score_submission_versions, score_submission_reviews FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /REVOKE ALL ON FUNCTION qualifier_submit_submission[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /REVOKE ALL ON FUNCTION qualifier_apply_review[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION qualifier_apply_review[\s\S]*TO service_role/);
});

test('database authorization repeats critical ownership and time-window checks', () => {
  assert.match(migration, /role = 'athlete'/);
  assert.match(migration, /payment_status = 'payment_approved'/);
  assert.match(migration, /qualifier_submission_window_not_open/);
  assert.match(migration, /qualifier_submission_window_closed/);
  assert.match(migration, /qualifier_manager_access_expired/);
  assert.doesNotMatch(migration, /service_valid_until < timezone\('America\/Fortaleza', NOW\(\)\)::DATE::TEXT/);
  assert.match(migration, /pg_advisory_xact_lock\(hashtext\(p_workout_id \|\| ':' \|\| p_division_id\)\)/);
  assert.match(migration, /qualifier_submission_version_conflict/);
  assert.match(migration, /qualifier_reviewer_conflict_of_interest/);
  assert.match(migration, /qualifier_judge_conflict_of_interest/);
  assert.match(migration, /lower\(coalesce\(r\.athlete_email, ''\)\) = lower\(v_judge\.email\)/);
  assert.match(migration, /v_actor\.parent_manager_id <> v_event\.organizer_id/);
  assert.match(migration, /FROM event_judges WHERE event_id = v_event\.id AND judge_user_id = v_actor\.id/);
  assert.match(migration, /qualifier_manager_access_expired/);
});

test('proof URLs are canonicalized at the edge and verified again by the transaction', () => {
  assert.match(submissionsRoute, /normalizeYouTubeVideoUrl/);
  assert.match(migration, /!~ '\^\[A-Za-z0-9_-\]\{11\}\$'/);
  assert.match(migration, /https:\/\/www\.youtube\.com\/watch\?v=/);
});

test('judge endpoints scope every operation to assigned qualifier events', () => {
  assert.match(judgeQueueRoute, /requireSession\(request, \['judge', 'manager', 'owner'\]\)/);
  assert.match(judgeReviewRoute, /requireSession\(request, \['judge', 'manager', 'owner'\]\)/);
  assert.match(judgeQueueRoute, /getQualifierEventIdsForActor/);
  assert.match(judgeReviewRoute, /assertQualifierJudgeAccess/);
  assert.match(judgeAccess, /event_judges/);
  assert.match(judgeAccess, /parent_manager_id/);
});

test('contestation approval plus reopening is a single database transaction boundary', () => {
  assert.match(contestationDetailRoute, /qualifier_resolve_contestation_and_reopen/);
  assert.match(migration, /UPDATE contestations[\s\S]*RETURNING \* INTO v_contestation/);
  assert.match(migration, /PERFORM qualifier_reopen_submission\([\s\S]*v_contestation\.submission_id/);
});
