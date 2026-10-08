-- Functional Fitness Qualifier: prova travada só com resultado ativo e exclusão
-- de prova com submissões pelo gestor organizador (Story 1.37).
--
-- Até aqui qualquer linha em score_submissions travava a prova para sempre.
-- "Excluir resultado" (qualifier_request_resubmission) não apaga a submissão:
-- move para 'awaiting_resubmission' e apaga o score. Como o histórico é imutável
-- e as FKs são RESTRICT, uma prova com um lançamento de teste nunca mais podia
-- ter tipo, categoria ou janela corrigidos, nem ser excluída.
--
-- Mudanças:
--   1. qualifier_protect_workout_after_submission: as travas de categoria,
--      abertura, prazo e tipo só valem enquanto houver submissão com resultado
--      em jogo (status diferente de 'awaiting_resubmission'). event_id continua
--      travado com qualquer submissão e o DELETE direto continua proibido.
--   2. qualifier_prevent_review_mutation / qualifier_prevent_submission_version_mutation:
--      também aceitam DELETE durante a exclusão de prova (flag
--      app.qualifier_workout_purge, LOCAL à transação). A flag do purge de
--      evento continua valendo.
--   3. qualifier_workout_deletions: auditoria de cada exclusão de prova com
--      submissões (gestor, justificativa e resumo do que foi removido).
--   4. qualifier_delete_workout (nova): exclusiva do gestor organizador do
--      evento; exige o código da prova (ou o nome, se o código estiver vazio)
--      como confirmação e uma justificativa. Apaga contestações, revisões,
--      versões, scores e submissões da prova, grava a auditoria e remove a
--      prova na mesma transação. Devolve as inscrições afetadas para a API
--      avisar os atletas por e-mail.
--
-- Migration incremental: não altera migrations já aplicadas.
--
-- Rollback (em nova migration):
--   * recriar qualifier_protect_workout_after_submission conforme 20261006120000;
--   * recriar qualifier_prevent_review_mutation e
--     qualifier_prevent_submission_version_mutation conforme 20260816140000;
--   * DROP FUNCTION qualifier_delete_workout(TEXT, TEXT, TEXT, TEXT, TEXT);
--   * DROP TABLE qualifier_workout_deletions (a auditoria é perdida).
--   Provas já excluídas não voltam; o resumo delas fica em qualifier_workout_deletions.

-- ---------------------------------------------------------------------------
-- 1. Trava da prova só com resultado ativo
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION qualifier_protect_workout_after_submission()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_retypable_types CONSTANT TEXT[] := ARRAY['amrap', 'reps', 'maxweight', 'distance', 'points'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- A exclusão de prova com submissões passa por qualifier_delete_workout,
    -- que remove as submissões antes de remover a prova.
    IF EXISTS (SELECT 1 FROM score_submissions WHERE workout_id = OLD.id) THEN
      RAISE EXCEPTION 'qualifier_workout_has_submissions';
    END IF;
    RETURN OLD;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM score_submissions WHERE workout_id = OLD.id) THEN
    RETURN NEW;
  END IF;

  -- A prova nunca muda de evento enquanto tiver submissões, mesmo aguardando reenvio.
  IF NEW.event_id IS DISTINCT FROM OLD.event_id THEN
    RAISE EXCEPTION 'qualifier_workout_identity_or_window_locked';
  END IF;

  -- Submissões aguardando reenvio não têm resultado em jogo: o atleta envia de
  -- novo já com a configuração corrigida.
  IF NOT EXISTS (
    SELECT 1
    FROM score_submissions
    WHERE workout_id = OLD.id
      AND status <> 'awaiting_resubmission'
  ) THEN
    RETURN NEW;
  END IF;

  IF NEW.division_id IS DISTINCT FROM OLD.division_id
    OR NEW.submission_opens_at IS DISTINCT FROM OLD.submission_opens_at
  THEN
    RAISE EXCEPTION 'qualifier_workout_identity_or_window_locked';
  END IF;

  IF NEW.submission_closes_at IS DISTINCT FROM OLD.submission_closes_at THEN
    IF NEW.submission_closes_at IS NULL
      OR (OLD.submission_closes_at IS NOT NULL AND NEW.submission_closes_at < OLD.submission_closes_at)
    THEN
      RAISE EXCEPTION 'qualifier_workout_deadline_extend_only';
    END IF;
  END IF;

  IF NEW.type IS DISTINCT FROM OLD.type THEN
    IF NOT (OLD.type = ANY (v_retypable_types) AND NEW.type = ANY (v_retypable_types)) THEN
      RAISE EXCEPTION 'qualifier_workout_type_change_not_allowed';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM score_submissions
      WHERE workout_id = OLD.id
        AND status IN ('validated', 'penalized', 'rejected')
    ) THEN
      RAISE EXCEPTION 'qualifier_workout_type_locked_reviewed';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- O trigger trg_qualifier_protect_workout (BEFORE UPDATE OR DELETE) já aponta
-- para esta função desde 20260816120000; CREATE OR REPLACE a atualiza no lugar.

-- ---------------------------------------------------------------------------
-- 2. Histórico imutável: DELETE liberado só nos purges transacionais
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION qualifier_prevent_review_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE'
    AND (
      current_setting('app.qualifier_event_purge', true) = 'on'
      OR current_setting('app.qualifier_workout_purge', true) = 'on'
    )
  THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'qualifier_review_history_is_immutable';
END;
$$;

CREATE OR REPLACE FUNCTION qualifier_prevent_submission_version_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE'
    AND (
      current_setting('app.qualifier_event_purge', true) = 'on'
      OR current_setting('app.qualifier_workout_purge', true) = 'on'
    )
  THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'qualifier_submission_version_history_is_immutable';
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Auditoria das exclusões de prova
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS qualifier_workout_deletions (
  id TEXT PRIMARY KEY,
  -- CASCADE: o purge integral do evento também remove a auditoria das provas dele.
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  workout_id TEXT NOT NULL,
  workout_code TEXT NOT NULL,
  workout_name TEXT NOT NULL,
  workout_type TEXT NOT NULL,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL,
  justification TEXT NOT NULL,
  submissions_removed INTEGER NOT NULL CHECK (submissions_removed >= 0),
  removed_submissions JSONB NOT NULL DEFAULT '[]'::JSONB,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qualifier_workout_deletions_event_id ON qualifier_workout_deletions(event_id);

ALTER TABLE qualifier_workout_deletions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE qualifier_workout_deletions FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. qualifier_delete_workout
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION qualifier_delete_workout(
  p_actor_id TEXT,
  p_event_id TEXT,
  p_workout_id TEXT,
  p_confirmation TEXT,
  p_justification TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_actor users%ROWTYPE;
  v_event events%ROWTYPE;
  v_workout workouts%ROWTYPE;
  v_expected_confirmation TEXT;
  v_submission_ids TEXT[];
  v_registration_ids TEXT[];
  v_removed_submissions JSONB;
  v_deletion_id TEXT;
BEGIN
  -- Exclusiva do gestor organizador: owner, judges e gestores de outros
  -- eventos são recusados.
  SELECT * INTO v_actor FROM users WHERE id = p_actor_id;
  IF NOT FOUND OR v_actor.role IS DISTINCT FROM 'manager' THEN
    RAISE EXCEPTION 'qualifier_workout_delete_not_allowed';
  END IF;

  SELECT * INTO v_event FROM events WHERE id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'qualifier_event_not_found'; END IF;
  IF v_event.event_type IS DISTINCT FROM 'functional_fitness_qualifier' THEN
    RAISE EXCEPTION 'qualifier_event_required';
  END IF;
  IF v_event.organizer_id IS DISTINCT FROM v_actor.id THEN
    RAISE EXCEPTION 'qualifier_workout_delete_not_allowed';
  END IF;
  IF v_actor.service_valid_until IS NOT NULL
    AND v_actor.service_valid_until < timezone('America/Fortaleza', NOW())::DATE
  THEN
    RAISE EXCEPTION 'qualifier_manager_access_expired';
  END IF;

  -- O lock da prova segura envios e lançamentos novos (a FK de score_submissions
  -- precisa de KEY SHARE nesta linha) até o fim da transação.
  SELECT * INTO v_workout
  FROM workouts
  WHERE id = p_workout_id AND event_id = v_event.id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'qualifier_workout_not_found'; END IF;

  v_expected_confirmation := COALESCE(NULLIF(trim(v_workout.code), ''), trim(v_workout.name));
  IF trim(coalesce(p_confirmation, '')) <> v_expected_confirmation THEN
    RAISE EXCEPTION 'qualifier_workout_delete_confirmation_invalid';
  END IF;
  IF length(trim(coalesce(p_justification, ''))) = 0 OR length(p_justification) > 2000 THEN
    RAISE EXCEPTION 'qualifier_workout_delete_justification_required';
  END IF;

  -- Revisões em andamento travam a linha da submissão; esperamos por elas.
  PERFORM 1 FROM score_submissions WHERE workout_id = v_workout.id FOR UPDATE;

  SELECT
    COALESCE(array_agg(s.id ORDER BY s.id), ARRAY[]::TEXT[]),
    COALESCE(array_agg(s.registration_id ORDER BY s.id), ARRAY[]::TEXT[]),
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', s.id,
      'registrationId', s.registration_id,
      'athleteId', s.athlete_id,
      'divisionId', s.division_id,
      'status', s.status,
      'entrySource', s.entry_source,
      'submittedResult', s.submitted_result,
      'finalResult', s.final_result,
      'currentVersion', s.current_version,
      'submittedAt', s.submitted_at
    ) ORDER BY s.id), '[]'::JSONB)
  INTO v_submission_ids, v_registration_ids, v_removed_submissions
  FROM score_submissions s
  WHERE s.workout_id = v_workout.id;

  -- O escopo é LOCAL a esta transação. Só os dois gatilhos de histórico leem a
  -- flag, e somente para DELETE.
  PERFORM set_config('app.qualifier_workout_purge', 'on', true);

  -- As referências RESTRICT saem antes da submissão; cada DELETE é limitado à
  -- prova alvo.
  DELETE FROM contestations
  WHERE workout_id = v_workout.id
    OR submission_id = ANY (v_submission_ids);

  DELETE FROM score_submission_reviews WHERE submission_id = ANY (v_submission_ids);
  DELETE FROM score_submission_versions WHERE submission_id = ANY (v_submission_ids);
  DELETE FROM scores WHERE workout_id = v_workout.id;
  DELETE FROM score_submissions WHERE id = ANY (v_submission_ids);

  PERFORM set_config('app.qualifier_workout_purge', 'off', true);

  v_deletion_id := 'qwd-' || md5(clock_timestamp()::TEXT || random()::TEXT || v_workout.id);
  INSERT INTO qualifier_workout_deletions (
    id, event_id, workout_id, workout_code, workout_name, workout_type,
    actor_id, actor_name, justification, submissions_removed, removed_submissions
  ) VALUES (
    v_deletion_id, v_event.id, v_workout.id, coalesce(v_workout.code, ''), v_workout.name, v_workout.type,
    v_actor.id, v_actor.name, trim(p_justification), coalesce(array_length(v_submission_ids, 1), 0), v_removed_submissions
  );

  DELETE FROM workouts WHERE id = v_workout.id;

  RETURN jsonb_build_object(
    'deletionId', v_deletion_id,
    'workoutId', v_workout.id,
    'workoutName', v_workout.name,
    'submissionsRemoved', coalesce(array_length(v_submission_ids, 1), 0),
    'registrationIds', to_jsonb(v_registration_ids)
  );
END;
$$;

COMMENT ON FUNCTION qualifier_delete_workout(TEXT, TEXT, TEXT, TEXT, TEXT) IS
  'Exclui uma prova de Qualifier com submissões: exclusiva do gestor organizador, exige o código da prova e justificativa, apaga resultados e histórico da prova e registra a auditoria em qualifier_workout_deletions.';

-- Somente service_role (rotas server-side e CLI). Sem isso, anon poderia
-- chamar a RPC pelo PostgREST com p_actor_id forjado.
REVOKE ALL ON FUNCTION qualifier_delete_workout(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION qualifier_delete_workout(TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
