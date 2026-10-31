-- Súmula Fitness Race, fase F1: largada da onda (Story 1.96).
--
-- Até aqui a largada (race_heat_marks) e as corridas (race_runs) só existiam
-- nas tabelas da Story 1.94, sem quem as gravasse. Esta migration cria:
--   1. race_start_heat: a largada da onda numa transação só. Na ordem:
--      a) confere que o evento é Fitness Race (race_event_required) e que o
--         regulamento é do evento (race_ruleset_not_found);
--      b) grava a marca da onda (uma por evento e onda; ON CONFLICT DO
--         NOTHING): se a onda já largou, nada é criado e a função devolve
--         started = false com o horário que vale (a rota responde 409);
--      c) trava o regulamento antes de criar as corridas
--         (UPDATE ... SET locked_at = NOW() WHERE locked_at IS NULL), com o
--         snapshot do percurso do primeiro uso quando p_course vem preenchido
--         (D6; regulamento já travado mantém o dele);
--      d) cria uma corrida `racing` para cada atleta da onda, com started_at
--         igual ao horário da largada, só para atleta de categoria do evento
--         (a categoria vem de athletes, não do aparelho), sem duplicar quem já
--         tem corrida ativa no evento (INSERT ... ON CONFLICT (event_id,
--         athlete_id) WHERE status <> 'cancelled' DO NOTHING).
--      Qualquer falha no meio desfaz tudo: a onda nunca fica com a marca e
--      sem as corridas.
--   2. Gatilho race_rulesets_guard_locked (BEFORE UPDATE em race_rulesets):
--      com OLD.locked_at preenchido, recusa mudar rules, course, preset,
--      version, event_id ou destravar (locked_at de volta a NULL). Mudar o
--      regulamento depois do primeiro uso é criar versão nova (Story 1.94,
--      setRaceRuleset), e as corridas mantêm a delas (gate ARCH-001).
--
-- Grants: race_start_heat é SECURITY DEFINER com search_path fixo e só executa
-- por service_role (REVOKE de PUBLIC, anon e authenticated). A função do
-- gatilho não é chamável pelo cliente (REVOKE de PUBLIC, anon e authenticated).
--
-- Idempotente: CREATE OR REPLACE FUNCTION e DROP TRIGGER IF EXISTS + CREATE
-- TRIGGER; REVOKE e GRANT podem ser repetidos. Reaplicar não falha nem altera
-- dados. Nenhuma migration anterior é alterada e nenhuma tabela é criada.
--
-- Ordem de deploy: aplicar depois de 20261030120000_race_sheets.sql (Story
-- 1.94) e 20261030130000_race_judges.sql (Story 1.95), e antes de publicar o
-- código da Story 1.96. Sem esta migration, a largada responde 503 pedindo a
-- migration; o restante do app (inclusive Functional Fitness) não depende dela.
--
-- Rollback (as largadas e corridas já gravadas ficam):
--   DROP TRIGGER IF EXISTS race_rulesets_guard_locked ON public.race_rulesets;
--   DROP FUNCTION IF EXISTS public.race_rulesets_guard_locked();
--   DROP FUNCTION IF EXISTS public.race_start_heat(TEXT, TEXT, TEXT, JSONB, TIMESTAMPTZ, TIMESTAMPTZ, BIGINT, TEXT, TEXT, JSONB);

-- 1. Largada da onda
CREATE OR REPLACE FUNCTION public.race_start_heat(
  p_event_id TEXT,
  p_heat_id TEXT,
  p_ruleset_id TEXT,
  p_course JSONB,
  p_started_at TIMESTAMPTZ,
  p_device_at TIMESTAMPTZ,
  p_clock_offset_ms BIGINT,
  p_actor_id TEXT,
  p_actor_name TEXT,
  p_runs JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_started_at TIMESTAMPTZ;
  v_created INTEGER := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM events WHERE id = p_event_id AND event_type = 'fitness_racing') THEN
    RAISE EXCEPTION 'race_event_required';
  END IF;
  PERFORM 1 FROM race_rulesets WHERE id = p_ruleset_id AND event_id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'race_ruleset_not_found'; END IF;

  INSERT INTO race_heat_marks (event_id, heat_id, started_at, started_by_user_id, started_by_name, device_at, clock_offset_ms)
  VALUES (p_event_id, p_heat_id, p_started_at, p_actor_id, p_actor_name, p_device_at, p_clock_offset_ms)
  ON CONFLICT (event_id, heat_id) DO NOTHING;
  IF NOT FOUND THEN
    SELECT started_at INTO v_started_at FROM race_heat_marks WHERE event_id = p_event_id AND heat_id = p_heat_id;
    RETURN jsonb_build_object('started', FALSE, 'started_at', v_started_at, 'runs_created', 0);
  END IF;

  -- Trava antes de criar as corridas; o snapshot do percurso só muda enquanto não travou.
  UPDATE race_rulesets
  SET locked_at = NOW(),
      course = CASE WHEN jsonb_typeof(p_course) = 'object' THEN p_course ELSE course END
  WHERE id = p_ruleset_id AND locked_at IS NULL;

  IF jsonb_typeof(p_runs) = 'array' THEN
    INSERT INTO race_runs (id, event_id, division_id, athlete_id, heat_id, ruleset_id, status, started_at, created_at, updated_at)
    SELECT r.item->>'id', p_event_id, a.division_id, a.id, p_heat_id, p_ruleset_id, 'racing', p_started_at, NOW(), NOW()
    FROM jsonb_array_elements(p_runs) AS r(item)
    JOIN athletes a ON a.id = r.item->>'athlete_id'
    JOIN divisions d ON d.id = a.division_id AND d.event_id = p_event_id
    WHERE coalesce(r.item->>'id', '') <> ''
    ON CONFLICT (event_id, athlete_id) WHERE status <> 'cancelled' DO NOTHING;
    GET DIAGNOSTICS v_created = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('started', TRUE, 'started_at', p_started_at, 'runs_created', v_created);
END;
$$;

-- 2. Regulamento travado não muda (gate ARCH-001)
CREATE OR REPLACE FUNCTION public.race_rulesets_guard_locked()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL AND (
    NEW.locked_at IS NULL
    OR NEW.rules IS DISTINCT FROM OLD.rules
    OR NEW.course IS DISTINCT FROM OLD.course
    OR NEW.preset IS DISTINCT FROM OLD.preset
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.event_id IS DISTINCT FROM OLD.event_id
  ) THEN
    RAISE EXCEPTION 'race_ruleset_locked' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS race_rulesets_guard_locked ON public.race_rulesets;
CREATE TRIGGER race_rulesets_guard_locked
  BEFORE UPDATE ON public.race_rulesets
  FOR EACH ROW EXECUTE FUNCTION public.race_rulesets_guard_locked();

-- 3. Grants: só o servidor (service_role) executa a largada
REVOKE ALL ON FUNCTION public.race_start_heat(TEXT, TEXT, TEXT, JSONB, TIMESTAMPTZ, TIMESTAMPTZ, BIGINT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.race_rulesets_guard_locked() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.race_start_heat(TEXT, TEXT, TEXT, JSONB, TIMESTAMPTZ, TIMESTAMPTZ, BIGINT, TEXT, TEXT, JSONB) TO service_role;
