-- Functional Fitness Qualifier: submissões online, judges e trilha de revisão.
-- A aplicação acessa estas tabelas apenas pelo service_role em rotas server-side.

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_event_type_check;
ALTER TABLE events ADD CONSTRAINT events_event_type_check
  CHECK (event_type IN ('functional_fitness', 'fitness_racing', 'functional_fitness_qualifier'));

ALTER TABLE workouts ADD COLUMN IF NOT EXISTS submission_opens_at TIMESTAMPTZ;
ALTER TABLE workouts ADD COLUMN IF NOT EXISTS submission_closes_at TIMESTAMPTZ;
ALTER TABLE workouts DROP CONSTRAINT IF EXISTS workouts_submission_window_order;
ALTER TABLE workouts ADD CONSTRAINT workouts_submission_window_order
  CHECK (
    submission_opens_at IS NULL
    OR submission_closes_at IS NULL
    OR submission_opens_at < submission_closes_at
  );

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('owner', 'manager', 'athlete', 'judge'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS parent_manager_id TEXT;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_parent_manager_id_fkey;
ALTER TABLE users ADD CONSTRAINT users_parent_manager_id_fkey
  FOREIGN KEY (parent_manager_id) REFERENCES users(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_users_parent_manager_id ON users(parent_manager_id);

ALTER TABLE scores ADD COLUMN IF NOT EXISTS result_status TEXT;
ALTER TABLE scores DROP CONSTRAINT IF EXISTS scores_result_status_check;
ALTER TABLE scores ADD CONSTRAINT scores_result_status_check
  CHECK (result_status IS NULL OR result_status IN ('validated', 'penalized', 'rejected', 'manual', 'absent'));
ALTER TABLE scores ADD COLUMN IF NOT EXISTS submission_id TEXT;

CREATE TABLE IF NOT EXISTS event_judges (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  judge_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, judge_user_id)
);
CREATE INDEX IF NOT EXISTS idx_event_judges_judge_user_id ON event_judges(judge_user_id);

CREATE TABLE IF NOT EXISTS score_submissions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  workout_id TEXT NOT NULL REFERENCES workouts(id) ON DELETE RESTRICT,
  division_id TEXT NOT NULL REFERENCES divisions(id) ON DELETE RESTRICT,
  registration_id TEXT NOT NULL REFERENCES registrations(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  athlete_id TEXT REFERENCES athletes(id) ON DELETE SET NULL,
  submitted_result TEXT NOT NULL,
  submitted_value NUMERIC NOT NULL CHECK (submitted_value >= 0),
  video_url TEXT NOT NULL,
  video_id TEXT NOT NULL,
  athlete_note TEXT,
  status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review', 'validated', 'penalized', 'rejected')),
  final_result TEXT,
  final_value NUMERIC CHECK (final_value IS NULL OR final_value >= 0),
  penalty_percent NUMERIC CHECK (penalty_percent IS NULL OR penalty_percent >= 0),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  current_version INTEGER NOT NULL DEFAULT 1 CHECK (current_version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (registration_id, workout_id)
);
CREATE INDEX IF NOT EXISTS idx_score_submissions_event_status ON score_submissions(event_id, status);
CREATE INDEX IF NOT EXISTS idx_score_submissions_workout_id ON score_submissions(workout_id);
CREATE INDEX IF NOT EXISTS idx_score_submissions_user_id ON score_submissions(user_id);

CREATE TABLE IF NOT EXISTS score_submission_versions (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES score_submissions(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  submitted_result TEXT NOT NULL,
  submitted_value NUMERIC NOT NULL CHECK (submitted_value >= 0),
  video_url TEXT NOT NULL,
  video_id TEXT NOT NULL,
  athlete_note TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  UNIQUE (submission_id, version)
);
CREATE INDEX IF NOT EXISTS idx_score_submission_versions_submission_id ON score_submission_versions(submission_id);

CREATE TABLE IF NOT EXISTS score_submission_reviews (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES score_submissions(id) ON DELETE RESTRICT,
  submission_version INTEGER NOT NULL,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  judge_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  judge_name TEXT NOT NULL,
  judge_role TEXT NOT NULL CHECK (judge_role IN ('judge', 'manager', 'owner')),
  decision TEXT NOT NULL CHECK (decision IN ('validated', 'penalized', 'rejected', 'manual_adjustment', 'reopened')),
  penalty_percent NUMERIC,
  previous_result TEXT,
  previous_value NUMERIC,
  applied_result TEXT,
  applied_value NUMERIC,
  justification TEXT,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (submission_id, submission_version)
    REFERENCES score_submission_versions(submission_id, version) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_score_submission_reviews_submission_id ON score_submission_reviews(submission_id);
CREATE INDEX IF NOT EXISTS idx_score_submission_reviews_event_id ON score_submission_reviews(event_id);

ALTER TABLE scores DROP CONSTRAINT IF EXISTS scores_submission_id_fkey;
ALTER TABLE scores ADD CONSTRAINT scores_submission_id_fkey
  FOREIGN KEY (submission_id) REFERENCES score_submissions(id) ON DELETE SET NULL;

ALTER TABLE contestations ALTER COLUMN lane DROP NOT NULL;
ALTER TABLE contestations ADD COLUMN IF NOT EXISTS submission_id TEXT;
ALTER TABLE contestations DROP CONSTRAINT IF EXISTS contestations_submission_id_fkey;
ALTER TABLE contestations ADD CONSTRAINT contestations_submission_id_fkey
  FOREIGN KEY (submission_id) REFERENCES score_submissions(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_contestations_submission_id ON contestations(submission_id);

CREATE OR REPLACE FUNCTION qualifier_set_submission_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_qualifier_submission_updated_at ON score_submissions;
CREATE TRIGGER trg_qualifier_submission_updated_at
BEFORE UPDATE ON score_submissions
FOR EACH ROW EXECUTE FUNCTION qualifier_set_submission_updated_at();

CREATE OR REPLACE FUNCTION qualifier_prevent_review_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'qualifier_review_history_is_immutable';
END;
$$;

DROP TRIGGER IF EXISTS trg_qualifier_reviews_immutable ON score_submission_reviews;
CREATE TRIGGER trg_qualifier_reviews_immutable
BEFORE UPDATE OR DELETE ON score_submission_reviews
FOR EACH ROW EXECUTE FUNCTION qualifier_prevent_review_mutation();

CREATE OR REPLACE FUNCTION qualifier_prevent_submission_version_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'qualifier_submission_version_history_is_immutable';
END;
$$;

DROP TRIGGER IF EXISTS trg_qualifier_submission_versions_immutable ON score_submission_versions;
CREATE TRIGGER trg_qualifier_submission_versions_immutable
BEFORE UPDATE OR DELETE ON score_submission_versions
FOR EACH ROW EXECUTE FUNCTION qualifier_prevent_submission_version_mutation();

CREATE OR REPLACE FUNCTION qualifier_protect_workout_after_submission()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM score_submissions WHERE workout_id = OLD.id) THEN
      RAISE EXCEPTION 'qualifier_workout_has_submissions';
    END IF;
    RETURN OLD;
  END IF;

  IF (NEW.event_id IS DISTINCT FROM OLD.event_id
      OR NEW.division_id IS DISTINCT FROM OLD.division_id
      OR NEW.type IS DISTINCT FROM OLD.type
      OR NEW.submission_opens_at IS DISTINCT FROM OLD.submission_opens_at
      OR NEW.submission_closes_at IS DISTINCT FROM OLD.submission_closes_at)
    AND EXISTS (SELECT 1 FROM score_submissions WHERE workout_id = OLD.id)
  THEN
    RAISE EXCEPTION 'qualifier_workout_identity_or_window_locked';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_qualifier_protect_workout ON workouts;
CREATE TRIGGER trg_qualifier_protect_workout
BEFORE UPDATE OR DELETE ON workouts
FOR EACH ROW EXECUTE FUNCTION qualifier_protect_workout_after_submission();

CREATE OR REPLACE FUNCTION qualifier_protect_division_after_submission()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM score_submissions WHERE division_id = OLD.id) THEN
      RAISE EXCEPTION 'qualifier_division_has_submissions';
    END IF;
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_qualifier_protect_division ON divisions;
CREATE TRIGGER trg_qualifier_protect_division
BEFORE DELETE ON divisions
FOR EACH ROW EXECUTE FUNCTION qualifier_protect_division_after_submission();

CREATE OR REPLACE FUNCTION qualifier_protect_event_after_submission()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.event_type IS DISTINCT FROM OLD.event_type
    AND EXISTS (SELECT 1 FROM score_submissions WHERE event_id = OLD.id)
  THEN
    RAISE EXCEPTION 'qualifier_event_type_locked_after_submissions';
  END IF;
  IF NEW.event_type = 'functional_fitness_qualifier'
    AND OLD.event_type IS DISTINCT FROM 'functional_fitness_qualifier'
    AND EXISTS (SELECT 1 FROM workouts WHERE event_id = NEW.id AND submission_closes_at IS NULL)
  THEN
    RAISE EXCEPTION 'qualifier_workout_submission_deadline_required';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_qualifier_protect_event ON events;
CREATE TRIGGER trg_qualifier_protect_event
BEFORE UPDATE OF event_type ON events
FOR EACH ROW EXECUTE FUNCTION qualifier_protect_event_after_submission();

CREATE OR REPLACE FUNCTION qualifier_require_workout_submission_deadline()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_event_type TEXT;
BEGIN
  SELECT event_type INTO v_event_type FROM events WHERE id = NEW.event_id;
  IF v_event_type = 'functional_fitness_qualifier' AND NEW.submission_closes_at IS NULL THEN
    RAISE EXCEPTION 'qualifier_workout_submission_deadline_required';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_qualifier_require_workout_deadline ON workouts;
CREATE TRIGGER trg_qualifier_require_workout_deadline
BEFORE INSERT OR UPDATE OF event_id, submission_closes_at ON workouts
FOR EACH ROW EXECUTE FUNCTION qualifier_require_workout_submission_deadline();

CREATE OR REPLACE FUNCTION qualifier_protect_registration_after_submission()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM score_submissions WHERE registration_id = OLD.id) THEN
      RAISE EXCEPTION 'qualifier_registration_has_submissions';
    END IF;
    RETURN OLD;
  END IF;
  IF (NEW.division_id IS DISTINCT FROM OLD.division_id
      OR NEW.payment_status IS DISTINCT FROM OLD.payment_status)
    AND EXISTS (SELECT 1 FROM score_submissions WHERE registration_id = OLD.id)
  THEN
    RAISE EXCEPTION 'qualifier_registration_locked_after_submission';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_qualifier_protect_registration ON registrations;
CREATE TRIGGER trg_qualifier_protect_registration
BEFORE UPDATE OF division_id, payment_status OR DELETE ON registrations
FOR EACH ROW EXECUTE FUNCTION qualifier_protect_registration_after_submission();

CREATE OR REPLACE FUNCTION qualifier_format_seconds(p_seconds NUMERIC)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_seconds INTEGER := GREATEST(0, CEIL(p_seconds)::INTEGER);
  v_hours INTEGER;
  v_minutes INTEGER;
  v_remaining INTEGER;
BEGIN
  v_hours := v_seconds / 3600;
  v_minutes := (v_seconds % 3600) / 60;
  v_remaining := v_seconds % 60;
  IF v_hours > 0 THEN
    RETURN v_hours::TEXT || ':' || LPAD(v_minutes::TEXT, 2, '0') || ':' || LPAD(v_remaining::TEXT, 2, '0');
  END IF;
  RETURN LPAD(v_minutes::TEXT, 2, '0') || ':' || LPAD(v_remaining::TEXT, 2, '0');
END;
$$;

CREATE OR REPLACE FUNCTION qualifier_refresh_workout_scores(p_workout_id TEXT, p_division_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workout_type TEXT;
  v_participant_count INTEGER;
BEGIN
  SELECT w.type INTO v_workout_type FROM workouts w WHERE w.id = p_workout_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'qualifier_workout_not_found'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_workout_id || ':' || p_division_id));

  SELECT COUNT(DISTINCT r.athlete_id)
  INTO v_participant_count
  FROM registrations r
  WHERE r.division_id = p_division_id
    AND r.athlete_id IS NOT NULL
    AND r.payment_status = 'payment_approved';

  WITH participants AS (
    SELECT DISTINCT r.athlete_id
    FROM registrations r
    WHERE r.division_id = p_division_id
      AND r.athlete_id IS NOT NULL
      AND r.payment_status = 'payment_approved'
  ), ranked AS (
    SELECT s.athlete_id,
      RANK() OVER (
        ORDER BY
          CASE WHEN v_workout_type = 'fortime' THEN s.value END ASC NULLS LAST,
          CASE WHEN v_workout_type <> 'fortime' THEN s.value END DESC NULLS LAST
      ) AS computed_rank
    FROM scores s
    INNER JOIN participants p ON p.athlete_id = s.athlete_id
    WHERE s.workout_id = p_workout_id
      AND s.result_status IN ('validated', 'penalized', 'manual')
  )
  UPDATE scores s
  SET rank = CASE
        WHEN s.result_status = 'rejected' THEN 0
        ELSE COALESCE(r.computed_rank, 0)
      END,
      points = CASE
        WHEN s.result_status = 'rejected' THEN v_participant_count + 1
        ELSE COALESCE(r.computed_rank, v_participant_count + 1)
      END
  FROM participants p
  LEFT JOIN ranked r ON r.athlete_id = p.athlete_id
  WHERE s.workout_id = p_workout_id
    AND s.athlete_id = p.athlete_id
    AND s.result_status IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION qualifier_submit_submission(
  p_event_id TEXT,
  p_workout_id TEXT,
  p_registration_id TEXT,
  p_user_id TEXT,
  p_athlete_id TEXT,
  p_submitted_result TEXT,
  p_submitted_value NUMERIC,
  p_video_url TEXT,
  p_video_id TEXT,
  p_athlete_note TEXT DEFAULT NULL,
  p_expected_version INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workout workouts%ROWTYPE;
  v_registration registrations%ROWTYPE;
  v_submission score_submissions%ROWTYPE;
  v_submission_id TEXT;
  v_next_version INTEGER;
BEGIN
  IF length(trim(coalesce(p_submitted_result, ''))) = 0 OR length(p_submitted_result) > 80
    OR p_submitted_value IS NULL OR p_submitted_value < 0
    OR length(trim(coalesce(p_video_url, ''))) = 0 OR length(p_video_url) > 500
    OR trim(coalesce(p_video_id, '')) !~ '^[A-Za-z0-9_-]{11}$'
    OR trim(p_video_url) <> ('https://www.youtube.com/watch?v=' || trim(p_video_id))
    OR length(coalesce(p_athlete_note, '')) > 2000
  THEN RAISE EXCEPTION 'qualifier_invalid_submission_payload'; END IF;

  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id AND role = 'athlete') THEN
    RAISE EXCEPTION 'qualifier_athlete_user_required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM events WHERE id = p_event_id AND event_type = 'functional_fitness_qualifier') THEN
    RAISE EXCEPTION 'qualifier_event_required';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM events e
    INNER JOIN users manager ON manager.id = e.organizer_id
    WHERE e.id = p_event_id
      AND manager.role = 'manager'
      AND manager.service_valid_until IS NOT NULL
      AND manager.service_valid_until < timezone('America/Fortaleza', NOW())::DATE
  ) THEN
    RAISE EXCEPTION 'qualifier_manager_access_expired';
  END IF;

  SELECT * INTO v_workout
  FROM workouts
  WHERE id = p_workout_id AND event_id = p_event_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'qualifier_workout_not_found'; END IF;
  IF v_workout.submission_closes_at IS NULL THEN RAISE EXCEPTION 'qualifier_submission_deadline_required'; END IF;
  IF v_workout.submission_opens_at IS NOT NULL AND NOW() < v_workout.submission_opens_at THEN
    RAISE EXCEPTION 'qualifier_submission_window_not_open';
  END IF;
  IF NOW() > v_workout.submission_closes_at THEN RAISE EXCEPTION 'qualifier_submission_window_closed'; END IF;

  SELECT * INTO v_registration
  FROM registrations
  WHERE id = p_registration_id
    AND event_id = p_event_id
    AND user_id = p_user_id
    AND athlete_id = p_athlete_id
    AND payment_status = 'payment_approved'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'qualifier_registration_not_eligible'; END IF;
  IF v_registration.division_id IS DISTINCT FROM v_workout.division_id AND v_workout.division_id IS NOT NULL THEN
    RAISE EXCEPTION 'qualifier_workout_division_mismatch';
  END IF;

  SELECT * INTO v_submission
  FROM score_submissions
  WHERE registration_id = p_registration_id AND workout_id = p_workout_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_submission.status <> 'pending_review' THEN RAISE EXCEPTION 'qualifier_submission_already_reviewed'; END IF;
    IF p_expected_version IS NULL OR p_expected_version <> v_submission.current_version THEN
      RAISE EXCEPTION 'qualifier_submission_version_conflict';
    END IF;
    v_submission_id := v_submission.id;
    v_next_version := v_submission.current_version + 1;
    UPDATE score_submissions
    SET submitted_result = trim(p_submitted_result), submitted_value = p_submitted_value,
        video_url = trim(p_video_url), video_id = trim(p_video_id), athlete_note = nullif(trim(coalesce(p_athlete_note, '')), ''),
        submitted_at = NOW(), current_version = v_next_version,
        final_result = NULL, final_value = NULL, penalty_percent = NULL, reviewed_at = NULL, reviewed_by = NULL
    WHERE id = v_submission_id;
    DELETE FROM scores WHERE athlete_id = p_athlete_id AND workout_id = p_workout_id AND submission_id = v_submission_id;
  ELSE
    IF p_expected_version IS NOT NULL AND p_expected_version <> 0 THEN RAISE EXCEPTION 'qualifier_submission_version_conflict'; END IF;
    v_submission_id := 'sub-' || md5(clock_timestamp()::TEXT || random()::TEXT || p_registration_id || p_workout_id);
    v_next_version := 1;
    INSERT INTO score_submissions (
      id, event_id, workout_id, division_id, registration_id, user_id, athlete_id,
      submitted_result, submitted_value, video_url, video_id, athlete_note, current_version
    ) VALUES (
      v_submission_id, p_event_id, p_workout_id, COALESCE(v_workout.division_id, v_registration.division_id),
      p_registration_id, p_user_id, p_athlete_id, trim(p_submitted_result), p_submitted_value,
      trim(p_video_url), trim(p_video_id), nullif(trim(coalesce(p_athlete_note, '')), ''), v_next_version
    );
  END IF;

  INSERT INTO score_submission_versions (
    id, submission_id, version, submitted_result, submitted_value, video_url, video_id, athlete_note, submitted_by
  ) VALUES (
    'subv-' || md5(clock_timestamp()::TEXT || random()::TEXT || v_submission_id || v_next_version::TEXT),
    v_submission_id, v_next_version, trim(p_submitted_result), p_submitted_value, trim(p_video_url), trim(p_video_id),
    nullif(trim(coalesce(p_athlete_note, '')), ''), p_user_id
  );

  RETURN (SELECT jsonb_build_object('id', id, 'status', status, 'currentVersion', current_version, 'submittedAt', submitted_at)
    FROM score_submissions WHERE id = v_submission_id);
END;
$$;

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
  v_parent_manager users%ROWTYPE;
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
    SELECT * INTO v_parent_manager FROM users WHERE id = v_actor.parent_manager_id AND role = 'manager';
    IF NOT FOUND THEN RAISE EXCEPTION 'qualifier_reviewer_not_assigned'; END IF;
    IF v_parent_manager.service_valid_until IS NOT NULL AND v_parent_manager.service_valid_until < timezone('America/Fortaleza', NOW())::DATE THEN
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

CREATE OR REPLACE FUNCTION qualifier_reopen_submission(
  p_submission_id TEXT,
  p_actor_id TEXT,
  p_justification TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_submission score_submissions%ROWTYPE;
  v_event events%ROWTYPE;
  v_actor users%ROWTYPE;
  v_review_id TEXT;
BEGIN
  SELECT * INTO v_submission FROM score_submissions WHERE id = p_submission_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'qualifier_submission_not_found'; END IF;
  SELECT * INTO v_event FROM events WHERE id = v_submission.event_id;
  SELECT * INTO v_actor FROM users WHERE id = p_actor_id;
  IF NOT FOUND OR v_actor.role NOT IN ('owner', 'manager') THEN RAISE EXCEPTION 'qualifier_reopen_not_allowed'; END IF;
  IF v_actor.role = 'manager' AND v_event.organizer_id <> v_actor.id THEN RAISE EXCEPTION 'qualifier_reopen_not_allowed'; END IF;
  IF v_actor.role = 'manager' AND v_actor.service_valid_until IS NOT NULL
    AND v_actor.service_valid_until < timezone('America/Fortaleza', NOW())::DATE THEN
    RAISE EXCEPTION 'qualifier_manager_access_expired';
  END IF;
  IF v_submission.status = 'pending_review' THEN RAISE EXCEPTION 'qualifier_submission_already_pending'; END IF;
  IF length(trim(coalesce(p_justification, ''))) = 0 OR length(coalesce(p_justification, '')) > 2000 THEN
    RAISE EXCEPTION 'qualifier_reopen_justification_required';
  END IF;

  UPDATE score_submissions
  SET status = 'pending_review', final_result = NULL, final_value = NULL, penalty_percent = NULL, reviewed_at = NULL, reviewed_by = NULL
  WHERE id = v_submission.id;
  DELETE FROM scores WHERE athlete_id = v_submission.athlete_id AND workout_id = v_submission.workout_id AND submission_id = v_submission.id;
  v_review_id := 'subr-' || md5(clock_timestamp()::TEXT || random()::TEXT || v_submission.id || 'reopened');
  INSERT INTO score_submission_reviews (
    id, submission_id, submission_version, event_id, judge_user_id, judge_name, judge_role,
    decision, previous_result, previous_value, justification
  ) VALUES (
    v_review_id, v_submission.id, v_submission.current_version, v_submission.event_id, v_actor.id, v_actor.name, v_actor.role,
    'reopened', v_submission.final_result, v_submission.final_value, nullif(trim(coalesce(p_justification, '')), '')
  );
  PERFORM qualifier_refresh_workout_scores(v_submission.workout_id, v_submission.division_id);
  RETURN jsonb_build_object('reviewId', v_review_id, 'submissionId', v_submission.id, 'status', 'pending_review');
END;
$$;

CREATE OR REPLACE FUNCTION qualifier_resolve_contestation_and_reopen(
  p_contestation_id TEXT,
  p_actor_id TEXT,
  p_manager_note TEXT,
  p_credit_refunded BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contestation contestations%ROWTYPE;
  v_event events%ROWTYPE;
  v_actor users%ROWTYPE;
BEGIN
  IF length(trim(coalesce(p_manager_note, ''))) = 0 OR length(coalesce(p_manager_note, '')) > 2000 THEN
    RAISE EXCEPTION 'qualifier_contestation_manager_note_required';
  END IF;

  SELECT * INTO v_contestation FROM contestations WHERE id = p_contestation_id FOR UPDATE;
  IF NOT FOUND OR v_contestation.submission_id IS NULL THEN
    RAISE EXCEPTION 'qualifier_contestation_not_found';
  END IF;
  SELECT * INTO v_event FROM events WHERE id = v_contestation.event_id;
  IF NOT FOUND OR v_event.event_type <> 'functional_fitness_qualifier' THEN
    RAISE EXCEPTION 'qualifier_event_required';
  END IF;
  SELECT * INTO v_actor FROM users WHERE id = p_actor_id;
  IF NOT FOUND OR v_actor.role NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'qualifier_reopen_not_allowed';
  END IF;
  IF v_actor.role = 'manager' AND v_event.organizer_id <> v_actor.id THEN
    RAISE EXCEPTION 'qualifier_reopen_not_allowed';
  END IF;
  IF v_actor.role = 'manager' AND v_actor.service_valid_until IS NOT NULL
    AND v_actor.service_valid_until < timezone('America/Fortaleza', NOW())::DATE THEN
    RAISE EXCEPTION 'qualifier_manager_access_expired';
  END IF;

  UPDATE contestations
  SET status = 'approved', credit_refunded = coalesce(p_credit_refunded, FALSE),
      manager_note = trim(p_manager_note), resolved_at = NOW()
  WHERE id = v_contestation.id
  RETURNING * INTO v_contestation;

  PERFORM qualifier_reopen_submission(
    v_contestation.submission_id,
    p_actor_id,
    trim(p_manager_note)
  );
  RETURN to_jsonb(v_contestation);
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
  v_manager users%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM users WHERE id = p_actor_id;
  IF NOT FOUND OR v_actor.role NOT IN ('owner', 'manager') THEN RAISE EXCEPTION 'qualifier_judge_creation_not_allowed'; END IF;
  IF v_actor.role = 'manager' AND p_parent_manager_id <> v_actor.id THEN RAISE EXCEPTION 'qualifier_judge_parent_not_allowed'; END IF;
  SELECT * INTO v_manager FROM users WHERE id = p_parent_manager_id AND role = 'manager';
  IF NOT FOUND THEN RAISE EXCEPTION 'qualifier_judge_manager_not_found'; END IF;
  IF v_manager.service_valid_until IS NOT NULL AND v_manager.service_valid_until < timezone('America/Fortaleza', NOW())::DATE THEN
    RAISE EXCEPTION 'qualifier_manager_access_expired';
  END IF;
  IF length(trim(p_name)) < 3 OR length(trim(p_email)) < 5 OR length(trim(p_password_hash)) < 20 THEN
    RAISE EXCEPTION 'qualifier_invalid_judge_payload';
  END IF;
  IF EXISTS (SELECT 1 FROM users WHERE lower(email) = lower(trim(p_email))) THEN RAISE EXCEPTION 'qualifier_judge_email_exists'; END IF;

  INSERT INTO users (id, name, email, role, organization, parent_manager_id)
  VALUES (p_judge_id, trim(p_name), lower(trim(p_email)), 'judge', v_manager.organization, p_parent_manager_id);
  INSERT INTO users_secrets (user_id, password) VALUES (p_judge_id, p_password_hash);
  RETURN jsonb_build_object('id', p_judge_id, 'name', trim(p_name), 'email', lower(trim(p_email)), 'role', 'judge', 'parentManagerId', p_parent_manager_id);
END;
$$;

CREATE OR REPLACE FUNCTION qualifier_assign_judge(p_actor_id TEXT, p_event_id TEXT, p_judge_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event events%ROWTYPE;
  v_actor users%ROWTYPE;
  v_judge users%ROWTYPE;
BEGIN
  SELECT * INTO v_event FROM events WHERE id = p_event_id AND event_type = 'functional_fitness_qualifier';
  IF NOT FOUND THEN RAISE EXCEPTION 'qualifier_event_required'; END IF;
  SELECT * INTO v_actor FROM users WHERE id = p_actor_id;
  IF NOT FOUND OR (v_actor.role = 'manager' AND v_event.organizer_id <> v_actor.id) OR v_actor.role NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'qualifier_judge_assignment_not_allowed';
  END IF;
  IF v_actor.role = 'manager' AND v_actor.service_valid_until IS NOT NULL
    AND v_actor.service_valid_until < timezone('America/Fortaleza', NOW())::DATE THEN
    RAISE EXCEPTION 'qualifier_manager_access_expired';
  END IF;
  SELECT * INTO v_judge FROM users WHERE id = p_judge_id AND role = 'judge';
  IF NOT FOUND OR v_judge.parent_manager_id <> v_event.organizer_id THEN RAISE EXCEPTION 'qualifier_judge_manager_mismatch'; END IF;
  IF EXISTS (
    SELECT 1
    FROM registrations r
    WHERE r.event_id = p_event_id
      AND coalesce(r.payment_status, 'payment_approved') <> 'payment_cancelled'
      AND (
        r.user_id = p_judge_id
        OR lower(coalesce(r.athlete_email, '')) = lower(v_judge.email)
      )
  ) THEN
    RAISE EXCEPTION 'qualifier_judge_conflict_of_interest';
  END IF;
  INSERT INTO event_judges (event_id, judge_user_id, created_by)
  VALUES (p_event_id, p_judge_id, p_actor_id)
  ON CONFLICT (event_id, judge_user_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION qualifier_create_and_assign_judge(
  p_actor_id TEXT,
  p_parent_manager_id TEXT,
  p_event_id TEXT,
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
  v_judge JSONB;
BEGIN
  v_judge := qualifier_create_judge(
    p_actor_id, p_parent_manager_id, p_judge_id, p_name, p_email, p_password_hash
  );
  PERFORM qualifier_assign_judge(p_actor_id, p_event_id, p_judge_id);
  RETURN v_judge;
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
  DELETE FROM event_judges WHERE event_id = p_event_id AND judge_user_id = p_judge_id;
END;
$$;

ALTER TABLE event_judges ENABLE ROW LEVEL SECURITY;
ALTER TABLE score_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE score_submission_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE score_submission_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE event_judges, score_submissions, score_submission_versions, score_submission_reviews FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION qualifier_refresh_workout_scores(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION qualifier_submit_submission(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION qualifier_apply_review(TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION qualifier_reopen_submission(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION qualifier_resolve_contestation_and_reopen(TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION qualifier_create_judge(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION qualifier_assign_judge(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION qualifier_create_and_assign_judge(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION qualifier_remove_judge(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION qualifier_refresh_workout_scores(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION qualifier_submit_submission(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION qualifier_apply_review(TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION qualifier_reopen_submission(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION qualifier_resolve_contestation_and_reopen(TEXT, TEXT, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION qualifier_create_judge(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION qualifier_assign_judge(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION qualifier_create_and_assign_judge(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION qualifier_remove_judge(TEXT, TEXT, TEXT) TO service_role;
