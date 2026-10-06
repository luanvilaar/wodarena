-- Functional Fitness Qualifier: correção de provas que já receberam submissões.
--
-- Até aqui qualifier_protect_workout_after_submission proibia qualquer mudança
-- de tipo, categoria e janela de envio assim que existisse uma submissão. Isso
-- impedia o gestor de corrigir uma prova cadastrada errada (ex.: AMRAP em vez
-- de Peso) e de prorrogar o prazo para quem ainda precisava reenviar.
--
-- Novas regras (somente para provas com submissões; sem submissões nada muda):
--   * event_id, division_id e submission_opens_at continuam travados.
--   * submission_closes_at só pode ser estendido (nunca antecipado ou removido).
--   * type só pode mudar entre tipos numéricos em que o maior valor vence
--     (amrap, reps, maxweight, distance, points), e apenas enquanto nenhuma
--     submissão tiver resultado ativo (validated/penalized/rejected). Trocar de
--     ou para 'fortime' continua proibido: muda a leitura do resultado.
--   * excluir a prova com submissões continua proibido (inalterado).
--
-- Migration incremental: não altera migrations já aplicadas.
--
-- Rollback (em nova migration): recriar a função conforme
-- 20260816120000_functional_fitness_qualifier.sql.

CREATE OR REPLACE FUNCTION qualifier_protect_workout_after_submission()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_retypable_types CONSTANT TEXT[] := ARRAY['amrap', 'reps', 'maxweight', 'distance', 'points'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM score_submissions WHERE workout_id = OLD.id) THEN
      RAISE EXCEPTION 'qualifier_workout_has_submissions';
    END IF;
    RETURN OLD;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM score_submissions WHERE workout_id = OLD.id) THEN
    RETURN NEW;
  END IF;

  IF NEW.event_id IS DISTINCT FROM OLD.event_id
    OR NEW.division_id IS DISTINCT FROM OLD.division_id
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
