import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const migration = read('../supabase/migrations/20261006140000_qualifier_rejected_points_last_place.sql');
const appContext = read('../src/context/AppContext.tsx');

test('rejected qualifier results score the last place (participants), not participants + 1', () => {
  assert.match(migration, /WHEN s\.result_status = 'rejected' THEN v_participant_count\s/);
  assert.match(migration, /ELSE COALESCE\(r\.computed_rank, v_participant_count\)/);
  assert.doesNotMatch(migration, /v_participant_count \+ 1/);
});

test('keeps the same ranking, locking and participant rules as the original function', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION qualifier_refresh_workout_scores\(p_workout_id TEXT, p_division_id TEXT\)/);
  assert.match(migration, /pg_advisory_xact_lock\(hashtext\(p_workout_id \|\| ':' \|\| p_division_id\)\)/);
  assert.match(migration, /r\.payment_status = 'payment_approved'/);
  assert.match(migration, /s\.result_status IN \('validated', 'penalized', 'manual'\)/);
});

test('backfills existing workouts and keeps the function server-side only', () => {
  assert.match(migration, /SELECT DISTINCT ss\.workout_id, ss\.division_id\s+FROM score_submissions ss/);
  assert.match(migration, /PERFORM qualifier_refresh_workout_scores\(v_pair\.workout_id, v_pair\.division_id\)/);
  assert.match(migration, /REVOKE ALL ON FUNCTION qualifier_refresh_workout_scores\(TEXT, TEXT\) FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION qualifier_refresh_workout_scores\(TEXT, TEXT\) TO service_role/);
});

test('database and leaderboard share the same highest-points rule for the qualifier', () => {
  assert.match(appContext, /const qualifierAbsencePoints = divisionAthletes\.length;/);
});
