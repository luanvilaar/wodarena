-- Súmula Fitness Race, fase F1: judges no evento Fitness Race (Story 1.95).
--
-- Até aqui o gestor só criava e atribuía judges em evento Functional Fitness
-- (presencial, funções sheet_*; Qualifier, funções qualifier_*). Sem judge
-- atribuído, a súmula de corrida (Story 1.94) não tem quem a opere (D3). Esta
-- migration cria três funções novas, só para evento `fitness_racing`, com as
-- mesmas regras de sheet_assign_judge (20261017120000_scoresheets.sql, seção 6):
--   1. race_assign_judge: atribui um judge existente ao evento.
--   2. race_remove_judge: tira o judge do evento (as tentativas que ele já
--      abriu ficam com o nome dele; ele só perde o acesso).
--   3. race_create_and_assign_judge: cria a conta com qualifier_create_judge
--      (que não depende do tipo de evento) e atribui ao evento.
-- Regras: evento Fitness Race (race_event_required); ator owner, ou manager dono
-- do evento e com acesso válido (America/Fortaleza); judge do mesmo gestor do
-- evento; sem conflito de interesse (judge inscrito no evento, por user_id ou
-- por e-mail, é recusado). As exceções são as mesmas das funções de Functional
-- Fitness, já tratadas pela rota /api/admin/persistence.
--
-- As funções sheet_* e qualifier_* não são redefinidas aqui e continuam como
-- estão: a trava de Functional Fitness (só evento functional_fitness nas
-- sheet_*, só Qualifier nas qualifier_*) não muda.
--
-- Grants: as três funções são SECURITY DEFINER com search_path fixo e só
-- executam por service_role (REVOKE de PUBLIC, anon e authenticated).
--
-- Idempotente: CREATE OR REPLACE FUNCTION só nas três funções novas; REVOKE e
-- GRANT podem ser repetidos. Reaplicar não falha nem altera dados. Nenhuma
-- migration anterior é alterada e nenhuma tabela é criada ou alterada.
--
-- Ordem de deploy: aplicar depois de 20261030120000_race_sheets.sql (Story
-- 1.94) e antes de publicar o código da Story 1.95. As funções não dependem das
-- tabelas race_*; dependem de qualifier_create_judge e de event_judges
-- (20260816120000_functional_fitness_qualifier.sql e
-- 20260816130000_qualifier_owner_judge_access.sql). Sem esta migration, criar,
-- atribuir ou remover judge em evento Fitness Race responde 503 pedindo a
-- migration; Functional Fitness e Qualifier não dependem dela.
--
-- Rollback (as atribuições já gravadas em event_judges ficam; para tirá-las,
-- remova os judges pela aba antes):
--   DROP FUNCTION IF EXISTS public.race_create_and_assign_judge(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
--   DROP FUNCTION IF EXISTS public.race_remove_judge(TEXT, TEXT, TEXT);
--   DROP FUNCTION IF EXISTS public.race_assign_judge(TEXT, TEXT, TEXT);

-- 1. Atribuir judge existente ao evento Fitness Race
CREATE OR REPLACE FUNCTION public.race_assign_judge(p_actor_id TEXT, p_event_id TEXT, p_judge_id TEXT)
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
  SELECT * INTO v_event FROM events
  WHERE id = p_event_id AND event_type = 'fitness_racing';
  IF NOT FOUND THEN RAISE EXCEPTION 'race_event_required'; END IF;
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

-- 2. Remover judge do evento Fitness Race
CREATE OR REPLACE FUNCTION public.race_remove_judge(p_actor_id TEXT, p_event_id TEXT, p_judge_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event events%ROWTYPE;
  v_actor users%ROWTYPE;
BEGIN
  SELECT * INTO v_event FROM events
  WHERE id = p_event_id AND event_type = 'fitness_racing';
  IF NOT FOUND THEN RAISE EXCEPTION 'race_event_required'; END IF;
  SELECT * INTO v_actor FROM users WHERE id = p_actor_id;
  IF NOT FOUND OR (v_actor.role = 'manager' AND v_event.organizer_id <> v_actor.id) OR v_actor.role NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'qualifier_judge_assignment_not_allowed';
  END IF;
  IF v_actor.role = 'manager' AND v_actor.service_valid_until IS NOT NULL
    AND v_actor.service_valid_until < timezone('America/Fortaleza', NOW())::DATE
  THEN
    RAISE EXCEPTION 'qualifier_manager_access_expired';
  END IF;
  -- As tentativas já abertas pelo judge ficam (com o nome dele); ele só perde o acesso.
  DELETE FROM event_judges WHERE event_id = p_event_id AND judge_user_id = p_judge_id;
END;
$$;

-- 3. Criar a conta de judge e atribuir ao evento Fitness Race
CREATE OR REPLACE FUNCTION public.race_create_and_assign_judge(
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
  PERFORM race_assign_judge(p_actor_id, p_event_id, p_judge_id);
  RETURN v_judge;
END;
$$;

-- 4. Só o servidor (service_role) executa
REVOKE ALL ON FUNCTION public.race_assign_judge(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.race_remove_judge(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.race_create_and_assign_judge(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.race_assign_judge(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.race_remove_judge(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.race_create_and_assign_judge(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
