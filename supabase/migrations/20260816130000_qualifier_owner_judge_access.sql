-- Functional Fitness Qualifier: owner pode ser o organizador responsável por judges.
-- Migration incremental: não altera a migration original já distribuída para outros ambientes.

REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION qualifier_apply_review(
  p_submission_id TEXT,
  p_expected_version INTEGER,
  p_actor_id TEXT,
  p_decision TEXT,
  p_justification TEXT DEFAULT NULL,
  p_manual_result TEXT DEFAULT NULL,
  p_manual_value NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_submission score_submissions%ROWTYPE;
  v_workout workouts%ROWTYPE;
  v_event events%ROWTYPE;
  v_actor users%ROWTYPE;
  v_parent_organizer users%ROWTYPE;
  v_final_result TEXT;
  v_final_value NUMERIC;
  v_status TEXT;
  v_score_status TEXT;
  v_penalty NUMERIC := NULL;
  v_review_id TEXT;
BEGIN
  IF p_decision NOT IN ('validated', 'penalized', 'rejected', 'manual_adjustment') THEN
    RAISE EXCEPTION 'qualifier_invalid_review_decision';
  END IF;
  IF p_decision IN ('penalized', 'rejected', 'manual_adjustment') AND length(trim(coalesce(p_justification, ''))) = 0 THEN
    RAISE EXCEPTION 'qualifier_review_justification_required';
  END IF;
  IF length(coalesce(p_justification, '')) > 2000 THEN RAISE EXCEPTION 'qualifier_review_justification_too_long'; END IF;

  SELECT * INTO v_submission FROM score_submissions WHERE id = p_submission_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'qualifier_submission_not_found'; END IF;
  IF p_expected_version <> v_submission.current_version THEN RAISE EXCEPTION 'qualifier_submission_version_conflict'; END IF;
  IF v_submission.user_id = p_actor_id THEN RAISE EXCEPTION 'qualifier_reviewer_conflict_of_interest'; END IF;

  SELECT * INTO v_workout FROM workouts WHERE id = v_submission.workout_id;
  SELECT * INTO v_event FROM events WHERE id = v_submission.event_id;
  SELECT * INTO v_actor FROM users WHERE id = p_actor_id;
  IF NOT FOUND OR v_actor.role NOT IN ('owner', 'manager', 'judge') THEN RAISE EXCEPTION 'qualifier_reviewer_not_allowed'; END IF;
  IF v_event.event_type <> 'functional_fitness_qualifier' THEN RAISE EXCEPTION 'qualifier_event_required'; END IF;

  IF v_actor.role = 'manager' THEN
    IF v_event.organizer_id <> v_actor.id THEN RAISE EXCEPTION 'qualifier_reviewer_not_assigned'; END IF;
    IF v_actor.service_valid_until IS NOT NULL AND v_actor.service_valid_until < timezone('America/Fortaleza', NOW())::DATE THEN
      RAISE EXCEPTION 'qualifier_manager_access_expired';
    END IF;
  ELSIF v_actor.role = 'judge' THEN
    IF v_actor.parent_manager_id IS NULL OR v_actor.parent_manager_id <> v_event.organizer_id THEN
      RAISE EXCEPTION 'qualifier_reviewer_not_assigned';
    END IF;
    SELECT * INTO v_parent_organizer
    FROM users
    WHERE id = v_actor.parent_manager_id AND role IN ('manager', 'owner');
    IF NOT FOUND THEN RAISE EXCEPTION 'qualifier_reviewer_not_assigned'; END IF;
    IF v_parent_organizer.role = 'manager'
      AND v_parent_organizer.service_valid_until IS NOT NULL
      AND v_parent_organizer.service_valid_until < timezone('America/Fortaleza', NOW())::DATE
    THEN
      RAISE EXCEPTION 'qualifier_manager_access_expired';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM event_judges WHERE event_id = v_event.id AND judge_user_id = v_actor.id) THEN
      RAISE EXCEPTION 'qualifier_reviewer_not_assigned';
    END IF;
    IF v_submission.status <> 'pending_review' THEN RAISE EXCEPTION 'qualifier_submission_already_reviewed'; END IF;
  END IF;

  IF p_decision = 'validated' THEN
    v_final_result := v_submission.submitted_result;
    v_final_value := v_submission.submitted_value;
    v_status := 'validated';
    v_score_status := 'validated';
  ELSIF p_decision = 'penalized' THEN
    v_penalty := 15;
    v_status := 'penalized';
    v_score_status := 'penalized';
    IF v_workout.type = 'fortime' THEN
      v_final_value := CEIL(v_submission.submitted_value * 1.15);
      v_final_result := qualifier_format_seconds(v_final_value);
    ELSIF v_workout.type IN ('amrap', 'reps', 'points') THEN
      v_final_value := FLOOR(v_submission.submitted_value * 0.85);
      v_final_result := v_final_value::TEXT;
    ELSE
      v_final_value := ROUND(v_submission.submitted_value * 0.85, 2);
      v_final_result := v_final_value::TEXT;
    END IF;
  ELSIF p_decision = 'rejected' THEN
    v_final_result := '0';
    v_final_value := 0;
    v_status := 'rejected';
    v_score_status := 'rejected';
  ELSE
    IF length(trim(coalesce(p_manual_result, ''))) = 0 OR p_manual_value IS NULL OR p_manual_value < 0 THEN
      RAISE EXCEPTION 'qualifier_manual_result_required';
    END IF;
    v_final_result := trim(p_manual_result);
    v_final_value := p_manual_value;
    v_status := 'validated';
    v_score_status := 'manual';
  END IF;

  UPDATE score_submissions
  SET status = v_status, final_result = v_final_result, final_value = v_final_value,
      penalty_percent = v_penalty, reviewed_at = NOW(), reviewed_by = v_actor.id
  WHERE id = v_submission.id;

  INSERT INTO scores (athlete_id, workout_id, result, value, rank, points, result_status, submission_id)
  VALUES (v_submission.athlete_id, v_submission.workout_id, v_final_result, v_final_value, 0, 0, v_score_status, v_submission.id)
  ON CONFLICT (athlete_id, workout_id) DO UPDATE SET
    result = EXCLUDED.result, value = EXCLUDED.value, rank = EXCLUDED.rank, points = EXCLUDED.points,
    result_status = EXCLUDED.result_status, submission_id = EXCLUDED.submission_id;

  v_review_id := 'subr-' || md5(clock_timestamp()::TEXT || random()::TEXT || v_submission.id || p_decision);
  INSERT INTO score_submission_reviews (
    id, submission_id, submission_version, event_id, judge_user_id, judge_name, judge_role,
    decision, penalty_percent, previous_result, previous_value, applied_result, applied_value, justification
  ) VALUES (
    v_review_id, v_submission.id, v_submission.current_version, v_submission.event_id, v_actor.id, v_actor.name, v_actor.role,
    p_decision, v_penalty, v_submission.final_result, v_submission.final_value, v_final_result, v_final_value,
    nullif(trim(coalesce(p_justification, '')), '')
  );

  PERFORM qualifier_refresh_workout_scores(v_submission.workout_id, v_submission.division_id);
  RETURN jsonb_build_object('reviewId', v_review_id, 'submissionId', v_submission.id, 'status', v_status, 'finalResult', v_final_result, 'finalValue', v_final_value);
END;
$$;

CREATE OR REPLACE FUNCTION qualifier_create_judge(
  p_actor_id TEXT,
  p_parent_manager_id TEXT,
  p_judge_id TEXT,
  p_name TEXT,
  p_email TEXT,
  p_password_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor users%ROWTYPE;
  v_organizer users%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM users WHERE id = p_actor_id;
  IF NOT FOUND OR v_actor.role NOT IN ('owner', 'manager') THEN RAISE EXCEPTION 'qualifier_judge_creation_not_allowed'; END IF;
  IF v_actor.role = 'manager' AND p_parent_manager_id <> v_actor.id THEN RAISE EXCEPTION 'qualifier_judge_parent_not_allowed'; END IF;
  SELECT * INTO v_organizer FROM users WHERE id = p_parent_manager_id AND role IN ('manager', 'owner');
  IF NOT FOUND THEN RAISE EXCEPTION 'qualifier_judge_manager_not_found'; END IF;
  IF v_organizer.role = 'manager'
    AND v_organizer.service_valid_until IS NOT NULL
    AND v_organizer.service_valid_until < timezone('America/Fortaleza', NOW())::DATE
  THEN
    RAISE EXCEPTION 'qualifier_manager_access_expired';
  END IF;
  IF length(trim(p_name)) < 3 OR length(trim(p_email)) < 5 OR length(trim(p_password_hash)) < 20 THEN
    RAISE EXCEPTION 'qualifier_invalid_judge_payload';
  END IF;
  IF EXISTS (SELECT 1 FROM users WHERE lower(email) = lower(trim(p_email))) THEN RAISE EXCEPTION 'qualifier_judge_email_exists'; END IF;

  INSERT INTO users (id, name, email, role, organization, parent_manager_id)
  VALUES (p_judge_id, trim(p_name), lower(trim(p_email)), 'judge', v_organizer.organization, p_parent_manager_id);
  INSERT INTO users_secrets (user_id, password) VALUES (p_judge_id, p_password_hash);
  RETURN jsonb_build_object('id', p_judge_id, 'name', trim(p_name), 'email', lower(trim(p_email)), 'role', 'judge', 'parentManagerId', p_parent_manager_id);
END;
$$;

CREATE OR REPLACE FUNCTION qualifier_remove_judge(p_actor_id TEXT, p_event_id TEXT, p_judge_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event events%ROWTYPE;
  v_actor users%ROWTYPE;
BEGIN
  SELECT * INTO v_event FROM events WHERE id = p_event_id AND event_type = 'functional_fitness_qualifier';
  IF NOT FOUND THEN RAISE EXCEPTION 'qualifier_event_required'; END IF;
  SELECT * INTO v_actor FROM users WHERE id = p_actor_id;
  IF NOT FOUND OR (v_actor.role = 'manager' AND v_event.organizer_id <> v_actor.id) OR v_actor.role NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'qualifier_judge_assignment_not_allowed';
  END IF;
  IF v_actor.role = 'manager' AND v_actor.service_valid_until IS NOT NULL
    AND v_actor.service_valid_until < timezone('America/Fortaleza', NOW())::DATE
  THEN
    RAISE EXCEPTION 'qualifier_manager_access_expired';
  END IF;
  DELETE FROM event_judges WHERE event_id = p_event_id AND judge_user_id = p_judge_id;
END;
$$;

REVOKE ALL ON FUNCTION qualifier_apply_review(TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION qualifier_create_judge(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION qualifier_remove_judge(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION qualifier_apply_review(TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION qualifier_create_judge(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION qualifier_remove_judge(TEXT, TEXT, TEXT) TO service_role;
