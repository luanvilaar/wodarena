-- Arbitragem presencial: súmulas do judge (Stories 1.49 a 1.52, etapa E3).
--
-- Até aqui a súmula digital só existia na tela (Stories 1.43 a 1.48): nada era
-- gravado. Esta migration cria o armazenamento da súmula e libera judges em
-- eventos Functional Fitness presenciais (antes, só no Qualifier):
--   1. scoresheets: uma súmula por atleta e prova (índice único parcial, que
--      ignora as canceladas), com a cópia da estrutura da prova no momento em
--      que foi aberta, o resultado calculado pelo servidor e o publicado.
--   2. scoresheet_events: o log de cada toque, correção, tentativa ou ajuste
--      de tempo, com sequência contígua (chave primária) e id único do
--      aparelho (reenvio não duplica). Nunca é apagado pela aplicação.
--   3. scoresheet_reviews: o histórico (abertura, envio, devolução, correção do
--      gestor, cancelamento e lançamento manual por cima da súmula).
--   4. scores.scoresheet_id: de qual súmula veio o resultado publicado.
--   5. Funções para o gestor criar, atribuir e remover judges em evento
--      presencial, com as mesmas regras das do Qualifier (gestor dono do
--      evento e com acesso válido, judge do mesmo gestor, sem conflito de
--      interesse com inscrição no evento).
--
-- O cálculo do resultado, a publicação em scores e o ranking ficam no servidor
-- (src/lib/serverScoresheets.ts), com o mesmo motor da súmula e a mesma regra
-- de ranking do painel (rankWorkoutScores).
--
-- RLS e grants: as três tabelas novas ficam com RLS ligada, sem policy e sem
-- acesso para anon/authenticated, como event_judges e score_submissions. A
-- aplicação lê e grava por service_role. As funções só executam por
-- service_role.
--
-- Idempotente: CREATE TABLE/INDEX IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, FK
-- guardada por pg_constraint e CREATE OR REPLACE FUNCTION. Reaplicar não falha
-- nem altera dados. Nenhuma migration anterior é alterada e nenhum dado
-- existente muda (scores.scoresheet_id nasce NULL).
--
-- Ordem de deploy: aplicar depois de 20261016120000_workout_structure.sql
-- (Story 1.43) e antes de publicar o código das Stories 1.49 a 1.52. Sem esta
-- migration, a área do judge presencial e a aba "Súmulas" respondem com erro de
-- tabela ausente; o restante do app não depende dela.
--
-- Rollback (só se nada foi gravado, porque apaga as súmulas):
--   DROP FUNCTION IF EXISTS public.sheet_create_and_assign_judge(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
--   DROP FUNCTION IF EXISTS public.sheet_remove_judge(TEXT, TEXT, TEXT);
--   DROP FUNCTION IF EXISTS public.sheet_assign_judge(TEXT, TEXT, TEXT);
--   ALTER TABLE public.scores DROP CONSTRAINT IF EXISTS scores_scoresheet_id_fkey;
--   ALTER TABLE public.scores DROP COLUMN IF EXISTS scoresheet_id;
--   DROP TABLE IF EXISTS public.scoresheet_reviews;
--   DROP TABLE IF EXISTS public.scoresheet_events;
--   DROP TABLE IF EXISTS public.scoresheets;

-- 1. Súmulas
CREATE TABLE IF NOT EXISTS public.scoresheets (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  workout_id TEXT NOT NULL REFERENCES public.workouts(id) ON DELETE CASCADE,
  athlete_id TEXT NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  division_id TEXT REFERENCES public.divisions(id) ON DELETE SET NULL,
  heat_id TEXT,
  heat_number INTEGER CHECK (heat_number IS NULL OR heat_number > 0),
  lane INTEGER CHECK (lane IS NULL OR lane > 0),
  judge_user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  judge_name TEXT NOT NULL,
  structure JSONB NOT NULL CHECK (jsonb_typeof(structure) = 'object'),
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'submitted', 'returned', 'cancelled')),
  computed_result TEXT,
  computed_value NUMERIC,
  computed_tie_break TEXT,
  official_result TEXT,
  official_value NUMERIC CHECK (official_value IS NULL OR official_value >= 0),
  official_tie_break TEXT,
  corrected BOOLEAN NOT NULL DEFAULT FALSE,
  return_reason TEXT,
  submitted_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS scoresheets_one_active_per_athlete
  ON public.scoresheets (workout_id, athlete_id) WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS idx_scoresheets_event_id ON public.scoresheets (event_id);
CREATE INDEX IF NOT EXISTS idx_scoresheets_judge_user_id ON public.scoresheets (judge_user_id);

COMMENT ON TABLE public.scoresheets IS
  'Súmula digital do judge (Stories 1.49 a 1.52): uma por atleta e prova (as canceladas não contam). structure é a cópia da estrutura da prova quando a súmula foi aberta; computed_* é o resultado que o servidor calculou do log; official_* é o publicado em scores (o calculado ou a correção do gestor).';

-- 2. Log da súmula (append-only)
CREATE TABLE IF NOT EXISTS public.scoresheet_events (
  sheet_id TEXT NOT NULL REFERENCES public.scoresheets(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL CHECK (seq >= 0),
  client_event_id TEXT NOT NULL CHECK (length(client_event_id) BETWEEN 1 AND 64),
  event JSONB NOT NULL CHECK (jsonb_typeof(event) = 'object'),
  author_user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (sheet_id, seq),
  UNIQUE (sheet_id, client_event_id)
);

COMMENT ON TABLE public.scoresheet_events IS
  'Log da súmula (Stories 1.49 a 1.52): rep, fill, set, adj, undo, time e attempt, na ordem (seq contígua a partir de 0). client_event_id vem do aparelho e torna o reenvio idempotente. Nada é apagado: correções entram como eventos novos.';

-- 3. Histórico de decisões
CREATE TABLE IF NOT EXISTS public.scoresheet_reviews (
  id TEXT PRIMARY KEY,
  sheet_id TEXT NOT NULL REFERENCES public.scoresheets(id) ON DELETE CASCADE,
  action TEXT NOT NULL
    CHECK (action IN ('opened', 'submitted', 'returned', 'corrected', 'cancelled', 'manual_override')),
  actor_user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL,
  actor_role TEXT NOT NULL CHECK (actor_role IN ('judge', 'manager', 'owner')),
  reason TEXT,
  previous_result TEXT,
  previous_value NUMERIC,
  previous_tie_break TEXT,
  applied_result TEXT,
  applied_value NUMERIC,
  applied_tie_break TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scoresheet_reviews_sheet_id ON public.scoresheet_reviews (sheet_id);

-- 4. Origem do resultado publicado
ALTER TABLE public.scores ADD COLUMN IF NOT EXISTS scoresheet_id TEXT;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.scores'::regclass AND conname = 'scores_scoresheet_id_fkey'
  ) THEN
    ALTER TABLE public.scores ADD CONSTRAINT scores_scoresheet_id_fkey
      FOREIGN KEY (scoresheet_id) REFERENCES public.scoresheets(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.scores.scoresheet_id IS
  'Súmula que publicou este resultado (Stories 1.49 a 1.52). NULL = lançamento manual, Qualifier ou resultado anterior à súmula.';

-- 5. RLS: só o servidor (service_role) lê e grava
ALTER TABLE public.scoresheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scoresheet_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scoresheet_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.scoresheets, public.scoresheet_events, public.scoresheet_reviews FROM PUBLIC, anon, authenticated;

-- 6. Judges em evento presencial (as funções do Qualifier exigem evento Qualifier)
CREATE OR REPLACE FUNCTION public.sheet_assign_judge(p_actor_id TEXT, p_event_id TEXT, p_judge_id TEXT)
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
  WHERE id = p_event_id AND coalesce(event_type, 'functional_fitness') = 'functional_fitness';
  IF NOT FOUND THEN RAISE EXCEPTION 'sheet_event_required'; END IF;
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

CREATE OR REPLACE FUNCTION public.sheet_remove_judge(p_actor_id TEXT, p_event_id TEXT, p_judge_id TEXT)
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
  WHERE id = p_event_id AND coalesce(event_type, 'functional_fitness') = 'functional_fitness';
  IF NOT FOUND THEN RAISE EXCEPTION 'sheet_event_required'; END IF;
  SELECT * INTO v_actor FROM users WHERE id = p_actor_id;
  IF NOT FOUND OR (v_actor.role = 'manager' AND v_event.organizer_id <> v_actor.id) OR v_actor.role NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'qualifier_judge_assignment_not_allowed';
  END IF;
  IF v_actor.role = 'manager' AND v_actor.service_valid_until IS NOT NULL
    AND v_actor.service_valid_until < timezone('America/Fortaleza', NOW())::DATE
  THEN
    RAISE EXCEPTION 'qualifier_manager_access_expired';
  END IF;
  -- As súmulas já abertas pelo judge ficam (com o nome dele); ele só perde o acesso.
  DELETE FROM event_judges WHERE event_id = p_event_id AND judge_user_id = p_judge_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sheet_create_and_assign_judge(
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
  PERFORM sheet_assign_judge(p_actor_id, p_event_id, p_judge_id);
  RETURN v_judge;
END;
$$;

REVOKE ALL ON FUNCTION public.sheet_assign_judge(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sheet_remove_judge(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sheet_create_and_assign_judge(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sheet_assign_judge(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.sheet_remove_judge(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.sheet_create_and_assign_judge(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
