-- Permite o purge confirmado de um evento Functional Fitness Qualifier pelo
-- organizador autorizado. Esta migration e incremental: o historico continua
-- imutavel em toda operacao ordinaria.

CREATE OR REPLACE FUNCTION qualifier_prevent_review_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE'
    AND current_setting('app.qualifier_event_purge', true) = 'on'
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
    AND current_setting('app.qualifier_event_purge', true) = 'on'
  THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'qualifier_submission_version_history_is_immutable';
END;
$$;

CREATE OR REPLACE FUNCTION qualifier_purge_event(
  p_actor_id TEXT,
  p_event_id TEXT,
  p_event_name_confirmation TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_event events%ROWTYPE;
  v_actor users%ROWTYPE;
BEGIN
  SELECT * INTO v_event
  FROM events
  WHERE id = p_event_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'qualifier_event_not_found'; END IF;
  IF v_event.event_type <> 'functional_fitness_qualifier' THEN
    RAISE EXCEPTION 'qualifier_event_required';
  END IF;
  IF trim(coalesce(p_event_name_confirmation, '')) <> v_event.name THEN
    RAISE EXCEPTION 'qualifier_event_delete_confirmation_invalid';
  END IF;

  SELECT * INTO v_actor FROM users WHERE id = p_actor_id;
  IF NOT FOUND OR v_actor.role NOT IN ('manager', 'owner') THEN
    RAISE EXCEPTION 'qualifier_event_delete_not_allowed';
  END IF;
  IF v_actor.role = 'manager' AND v_event.organizer_id <> v_actor.id THEN
    RAISE EXCEPTION 'qualifier_event_delete_not_allowed';
  END IF;
  IF v_actor.role = 'manager'
    AND v_actor.service_valid_until IS NOT NULL
    AND v_actor.service_valid_until < timezone('America/Fortaleza', NOW())::DATE
  THEN
    RAISE EXCEPTION 'qualifier_manager_access_expired';
  END IF;

  -- O escopo e LOCAL a esta transacao. Apenas os dois gatilhos de historico
  -- usam a flag, e somente para DELETE durante este purge integral.
  PERFORM set_config('app.qualifier_event_purge', 'on', true);

  -- As referencias RESTRICT devem sair antes da submissao. Cada DELETE e
  -- limitado ao evento alvo (ou a uma submissao inequivocamente dele).
  DELETE FROM contestations
  WHERE event_id = v_event.id
    OR submission_id IN (
      SELECT id FROM score_submissions WHERE event_id = v_event.id
    );

  DELETE FROM score_submission_reviews
  WHERE event_id = v_event.id
    OR submission_id IN (
      SELECT id FROM score_submissions WHERE event_id = v_event.id
    );

  DELETE FROM score_submission_versions
  WHERE submission_id IN (
    SELECT id FROM score_submissions WHERE event_id = v_event.id
  );

  DELETE FROM score_submissions WHERE event_id = v_event.id;

  -- As FKs legadas removem na mesma transacao scores, atletas, inscricoes,
  -- categorias, provas, cupons, leaderboard e vinculos de Judge.
  DELETE FROM events WHERE id = v_event.id;
END;
$$;

REVOKE ALL ON FUNCTION qualifier_purge_event(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION qualifier_purge_event(TEXT, TEXT, TEXT) TO service_role;
