-- Functional Fitness Qualifier: ações do gestor sobre resultados já revisados.
--
-- 1. Editar: qualifier_apply_review continua sendo a RPC de edição (manager e
--    owner não passam pela trava already_reviewed do judge). A partir daqui,
--    sobrescrever uma revisão anterior (status <> 'pending_review') exige
--    justificativa, qualquer que seja a decisão.
-- 2. Excluir para reenvio: nova RPC qualifier_request_resubmission. Ao
--    contrário de qualifier_reopen_submission (que devolve a submissão para a
--    fila do judge e é usada pela contestação), ela leva a submissão para
--    'awaiting_resubmission'. O vídeo antigo não volta para a fila de revisão
--    e só o atleta pode reenviar, dentro do prazo do workout.
--
-- Migration incremental: não altera migrations já aplicadas.
--
-- Rollback (em nova migration):
--   * DROP FUNCTION qualifier_request_resubmission(TEXT, TEXT, TIMESTAMPTZ, TEXT);
--   * resolver antes as submissões em 'awaiting_resubmission' (o
--     qualifier_submit_submission anterior não aceita reenvio a partir delas);
--   * recriar qualifier_apply_review e qualifier_reopen_submission conforme
--     20260816130000 / 20260816120000, e qualifier_submit_submission conforme
--     20260816120000;
--   * o CHECK de score_submissions.status só pode ser restringido sem linhas em
--     'awaiting_resubmission'. As revisões são imutáveis, então depois do
--     primeiro 'resubmission_requested' o CHECK de decision fica ampliado.

-- ---------------------------------------------------------------------------
-- 1. Novos valores de status e decisão
-- ---------------------------------------------------------------------------

-- Os CHECKs originais foram declarados inline, sem nome explícito. Removemos
-- qualquer CHECK de coluna única sobre essas colunas antes de recriar com nome
-- fixo, para não depender do nome gerado pelo Postgres.
DO $$
DECLARE
  v_target RECORD;
  v_constraint RECORD;
BEGIN
  FOR v_target IN
    SELECT *
    FROM (VALUES
      ('score_submissions'::TEXT, 'status'::TEXT),
      ('score_submission_reviews'::TEXT, 'decision'::TEXT)
    ) AS t(table_name, column_name)
  LOOP
    FOR v_constraint IN
      SELECT c.conname
      FROM pg_constraint c
      INNER JOIN pg_attribute a
        ON a.attrelid = c.conrelid
       AND a.attnum = ANY (c.conkey)
      WHERE c.conrelid = format('public.%I', v_target.table_name)::regclass
        AND c.contype = 'c'
        AND array_length(c.conkey, 1) = 1
        AND a.attname = v_target.column_name
    LOOP
      EXECUTE format(
        'ALTER TABLE public.%I DROP CONSTRAINT %I',
        v_target.table_name,
        v_constraint.conname
      );
    END LOOP;
  END LOOP;
END;
$$;

ALTER TABLE score_submissions ADD CONSTRAINT score_submissions_status_check
  CHECK (status IN ('pending_review', 'validated', 'penalized', 'rejected', 'awaiting_resubmission'));

ALTER TABLE score_submission_reviews ADD CONSTRAINT score_submission_reviews_decision_check
  CHECK (decision IN ('validated', 'penalized', 'rejected', 'manual_adjustment', 'reopened', 'resubmission_requested'));

-- ---------------------------------------------------------------------------
-- 2. qualifier_submit_submission: aceita reenvio a partir de
--    'awaiting_resubmission' e devolve a submissão para 'pending_review'.
--    Demais regras idênticas a 20260816120000.
-- ---------------------------------------------------------------------------

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
SET search_path = pg_catalog, public, pg_temp
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
    IF v_submission.status NOT IN ('pending_review', 'awaiting_resubmission') THEN
      RAISE EXCEPTION 'qualifier_submission_already_reviewed';
    END IF;
    IF p_expected_version IS NULL OR p_expected_version <> v_submission.current_version THEN
      RAISE EXCEPTION 'qualifier_submission_version_conflict';
    END IF;
    v_submission_id := v_submission.id;
    v_next_version := v_submission.current_version + 1;
    UPDATE score_submissions
    SET status = 'pending_review',
        submitted_result = trim(p_submitted_result), submitted_value = p_submitted_value,
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

-- ---------------------------------------------------------------------------
-- 3. qualifier_apply_review: autorização idêntica a 20260816130000.
--    Mudanças:
--    a) justificativa obrigatória ao sobrescrever revisão anterior
--       (status <> 'pending_review'), para qualquer decisão;
--    b) o advisory lock do workout/divisão é tomado antes de gravar em
--       scores, na mesma ordem de qualifier_request_resubmission
--       (linha da submissão -> advisory lock -> scores). Sem isso, uma edição
--       concorrente com um pedido de reenvio no mesmo workout/divisão pode
--       travar em deadlock dentro de qualifier_refresh_workout_scores. O lock é
--       por transação e reentrante, então a chamada de refresh no fim continua
--       igual.
-- ---------------------------------------------------------------------------

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
SET search_path = pg_catalog, public, pg_temp
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
  IF v_submission.status = 'awaiting_resubmission' THEN RAISE EXCEPTION 'qualifier_submission_awaiting_resubmission'; END IF;
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

  -- Sobrescrever uma revisão anterior (edição do gestor) sempre exige
  -- justificativa, inclusive para 'validated'.
  IF v_submission.status <> 'pending_review' AND length(trim(coalesce(p_justification, ''))) = 0 THEN
    RAISE EXCEPTION 'qualifier_review_justification_required';
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

  PERFORM pg_advisory_xact_lock(hashtext(v_submission.workout_id || ':' || v_submission.division_id));

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

-- ---------------------------------------------------------------------------
-- 4. qualifier_request_resubmission: gestor exclui um resultado revisado e
--    libera o atleta para reenviar do zero.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION qualifier_request_resubmission(
  p_submission_id TEXT,
  p_actor_id TEXT,
  p_expected_reviewed_at TIMESTAMPTZ,
  p_justification TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_submission score_submissions%ROWTYPE;
  v_event events%ROWTYPE;
  v_actor users%ROWTYPE;
  v_workout workouts%ROWTYPE;
  v_review_id TEXT;
BEGIN
  SELECT * INTO v_submission FROM score_submissions WHERE id = p_submission_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'qualifier_submission_not_found'; END IF;

  -- Apenas o gestor dono do evento (dentro da validade) ou o owner. Judge nunca.
  SELECT * INTO v_event FROM events WHERE id = v_submission.event_id;
  SELECT * INTO v_actor FROM users WHERE id = p_actor_id;
  IF NOT FOUND OR coalesce(v_actor.role, '') NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'qualifier_request_resubmission_not_allowed';
  END IF;
  IF v_actor.role = 'manager' AND v_event.organizer_id IS DISTINCT FROM v_actor.id THEN
    RAISE EXCEPTION 'qualifier_request_resubmission_not_allowed';
  END IF;
  IF v_actor.role = 'manager'
    AND v_actor.service_valid_until IS NOT NULL
    AND v_actor.service_valid_until < timezone('America/Fortaleza', NOW())::DATE
  THEN
    RAISE EXCEPTION 'qualifier_manager_access_expired';
  END IF;
  IF v_event.event_type IS DISTINCT FROM 'functional_fitness_qualifier' THEN
    RAISE EXCEPTION 'qualifier_event_required';
  END IF;

  IF v_submission.status NOT IN ('validated', 'penalized', 'rejected') THEN
    RAISE EXCEPTION 'qualifier_submission_not_reviewed';
  END IF;

  -- Token de concorrência: o gestor só age sobre a decisão que ele viu.
  -- Comparação estrita em microssegundos; o cliente deve devolver o valor de
  -- reviewed_at exatamente como veio do banco.
  IF p_expected_reviewed_at IS NULL
    OR v_submission.reviewed_at IS NULL
    OR v_submission.reviewed_at <> p_expected_reviewed_at
  THEN
    RAISE EXCEPTION 'qualifier_review_state_conflict';
  END IF;

  -- Bloqueio duro pelo relógio do banco: sem prazo aberto o atleta não
  -- conseguiria reenviar e ficaria sem resultado.
  SELECT * INTO v_workout FROM workouts WHERE id = v_submission.workout_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'qualifier_workout_not_found'; END IF;
  IF v_workout.submission_closes_at IS NULL THEN RAISE EXCEPTION 'qualifier_submission_deadline_required'; END IF;
  IF NOW() > v_workout.submission_closes_at THEN RAISE EXCEPTION 'qualifier_submission_window_closed'; END IF;

  IF EXISTS (
    SELECT 1
    FROM contestations
    WHERE submission_id = v_submission.id
      AND status = 'under_review'
  ) THEN
    RAISE EXCEPTION 'qualifier_open_contestation_exists';
  END IF;

  IF length(trim(coalesce(p_justification, ''))) = 0 OR length(coalesce(p_justification, '')) > 2000 THEN
    RAISE EXCEPTION 'qualifier_request_resubmission_justification_required';
  END IF;

  -- Mesmo lock de qualifier_refresh_workout_scores, tomado antes de tocar em
  -- scores para manter a ordem linha da submissão -> advisory lock -> scores.
  PERFORM pg_advisory_xact_lock(hashtext(v_submission.workout_id || ':' || v_submission.division_id));

  UPDATE score_submissions
  SET status = 'awaiting_resubmission', final_result = NULL, final_value = NULL, penalty_percent = NULL,
      reviewed_at = NULL, reviewed_by = NULL
  WHERE id = v_submission.id;

  DELETE FROM scores
  WHERE athlete_id = v_submission.athlete_id
    AND workout_id = v_submission.workout_id
    AND submission_id = v_submission.id;

  v_review_id := 'subr-' || md5(clock_timestamp()::TEXT || random()::TEXT || v_submission.id || 'resubmission_requested');
  INSERT INTO score_submission_reviews (
    id, submission_id, submission_version, event_id, judge_user_id, judge_name, judge_role,
    decision, previous_result, previous_value, justification
  ) VALUES (
    v_review_id, v_submission.id, v_submission.current_version, v_submission.event_id, v_actor.id, v_actor.name, v_actor.role,
    'resubmission_requested', v_submission.final_result, v_submission.final_value, nullif(trim(coalesce(p_justification, '')), '')
  );

  PERFORM qualifier_refresh_workout_scores(v_submission.workout_id, v_submission.division_id);
  RETURN jsonb_build_object('reviewId', v_review_id, 'submissionId', v_submission.id, 'status', 'awaiting_resubmission');
END;
$$;

COMMENT ON FUNCTION qualifier_request_resubmission(TEXT, TEXT, TIMESTAMPTZ, TEXT) IS
  'Functional Fitness Qualifier: manager/owner exclui um resultado revisado e libera o atleta para reenviar (status awaiting_resubmission). Uso exclusivo via service_role.';

-- ---------------------------------------------------------------------------
-- 5. qualifier_reopen_submission: idêntica a 20260816120000, com duas
--    correções pedidas no QA gate desta migration (achado REQ-001):
--    a) recusa reabrir uma submissão em 'awaiting_resubmission' — sem essa
--       trava, o fluxo de contestação (qualifier_resolve_contestation_and_reopen)
--       devolveria o vídeo antigo para a fila do judge por cima de um pedido
--       de reenvio já feito ao atleta, contrariando o item 2 do cabeçalho;
--    b) toma o advisory lock do workout/divisão antes de tocar em scores, na
--       mesma ordem das demais funções desta migration, para não colidir com
--       qualifier_apply_review/qualifier_request_resubmission no mesmo
--       workout/divisão.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION qualifier_reopen_submission(
  p_submission_id TEXT,
  p_actor_id TEXT,
  p_justification TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
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
  IF v_submission.status = 'awaiting_resubmission' THEN RAISE EXCEPTION 'qualifier_submission_awaiting_resubmission'; END IF;
  IF v_submission.status = 'pending_review' THEN RAISE EXCEPTION 'qualifier_submission_already_pending'; END IF;
  IF length(trim(coalesce(p_justification, ''))) = 0 OR length(coalesce(p_justification, '')) > 2000 THEN
    RAISE EXCEPTION 'qualifier_reopen_justification_required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_submission.workout_id || ':' || v_submission.division_id));

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

-- ---------------------------------------------------------------------------
-- 6. Privilégios: somente service_role (rotas server-side). Sem isso, anon
--    poderia chamar a RPC pelo PostgREST com p_actor_id forjado.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION qualifier_request_resubmission(TEXT, TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION qualifier_apply_review(TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION qualifier_submit_submission(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION qualifier_reopen_submission(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION qualifier_request_resubmission(TEXT, TEXT, TIMESTAMPTZ, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION qualifier_apply_review(TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION qualifier_submit_submission(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION qualifier_reopen_submission(TEXT, TEXT, TEXT) TO service_role;
