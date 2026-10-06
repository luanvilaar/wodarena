-- Functional Fitness Qualifier: pontuação de resultado rejeitado = última colocação.
--
-- Regra única de "maior pontuação em jogo" no qualifier: a última colocação
-- possível da divisão, ou seja, o número de participantes (inscrições com
-- pagamento aprovado). Exemplo: divisão com 10 atletas -> 10 pontos.
--
-- O leaderboard (AppContext.getLeaderboard) já aplica essa regra a quem não
-- enviou resultado depois do encerramento da janela. Até aqui o banco punia o
-- resultado rejeitado com participantes + 1 (11 numa divisão de 10), mais do
-- que a ausência. Esta migration alinha as duas regras.
--
-- Mudanças:
--   1. qualifier_refresh_workout_scores: rejeitado (e fallback sem rank) passa
--      de participantes + 1 para o número de participantes. Demais regras
--      idênticas a 20260816120000.
--   2. Backfill: recalcula todas as provas/divisões que já têm submissões, para
--      que scores rejeitados já gravados com participantes + 1 sejam
--      corrigidos agora e não só na próxima revisão.
--
-- Migration incremental: não altera migrations já aplicadas.
--
-- Rollback (em nova migration): recriar a função conforme
-- 20260816120000_functional_fitness_qualifier.sql (participantes + 1) e repetir
-- o backfill.

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
        WHEN s.result_status = 'rejected' THEN v_participant_count
        ELSE COALESCE(r.computed_rank, v_participant_count)
      END
  FROM participants p
  LEFT JOIN ranked r ON r.athlete_id = p.athlete_id
  WHERE s.workout_id = p_workout_id
    AND s.athlete_id = p.athlete_id
    AND s.result_status IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION qualifier_refresh_workout_scores(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION qualifier_refresh_workout_scores(TEXT, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- Backfill: recalcula as provas/divisões que já têm submissões.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_pair RECORD;
BEGIN
  FOR v_pair IN
    SELECT DISTINCT ss.workout_id, ss.division_id
    FROM score_submissions ss
    WHERE ss.division_id IS NOT NULL
    ORDER BY ss.workout_id, ss.division_id
  LOOP
    PERFORM qualifier_refresh_workout_scores(v_pair.workout_id, v_pair.division_id);
  END LOOP;
END;
$$;
