-- Súmula Fitness Race, fase F1: publicação no leaderboard (Story 1.99).
--
-- O tempo oficial da corrida (bruto + penalidades vigentes, D1 e D2) é gravado
-- em scores, na prova TOTAL da categoria, pelo servidor
-- (src/lib/serverRacePublication.ts). Esta migration:
--   1. scores.race_run_id: de qual corrida veio o resultado publicado (nula,
--      FK para race_runs com ON DELETE SET NULL, como scoresheet_id). Índice
--      único parcial: uma linha publicada por corrida. NULL = lançamento
--      manual, súmula de Functional Fitness, Qualifier ou resultado anterior.
--   2. scores_result_status_check ampliado com 'disqualified' (DQ confirmado
--      pelo organizador, D2 e D15) e 'dnf' (D14b), mantendo os valores atuais
--      ('validated', 'penalized', 'rejected', 'manual', 'absent'). 'rejected'
--      continua só com o sentido do Qualifier.
--
-- Grants: nenhuma tabela nova; scores segue com as policies e grants atuais.
-- A coluna nova não entra no bootstrap público (PUBLIC_SCORE_SELECT).
--
-- Idempotente: ADD COLUMN IF NOT EXISTS, FK guardada por pg_constraint,
-- CREATE UNIQUE INDEX IF NOT EXISTS e o CHECK recriado pelo nome fixo
-- (DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT, como em
-- 20260816120000_functional_fitness_qualifier.sql). Reaplicar não falha nem
-- altera dados. Nenhuma migration anterior é alterada e nenhum dado existente
-- muda (scores.race_run_id nasce NULL).
--
-- Ordem de deploy: aplicar depois de 20261030140000_race_start_heat.sql
-- (Story 1.96) e antes de publicar o código da Story 1.99. Sem esta
-- migration, a publicação falha (a corrida fecha e o painel mostra o aviso
-- "Tentar de novo"); o restante do app não depende dela.
--
-- Rollback (só depois de apagar ou trocar os resultados 'disqualified'/'dnf'):
--   ALTER TABLE public.scores DROP CONSTRAINT IF EXISTS scores_result_status_check;
--   ALTER TABLE public.scores ADD CONSTRAINT scores_result_status_check
--     CHECK (result_status IS NULL OR result_status IN ('validated', 'penalized', 'rejected', 'manual', 'absent'));
--   DROP INDEX IF EXISTS public.scores_race_run_id_key;
--   ALTER TABLE public.scores DROP CONSTRAINT IF EXISTS scores_race_run_id_fkey;
--   ALTER TABLE public.scores DROP COLUMN IF EXISTS race_run_id;

-- 1. Origem do resultado publicado pela súmula Fitness Race
ALTER TABLE public.scores ADD COLUMN IF NOT EXISTS race_run_id TEXT;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.scores'::regclass AND conname = 'scores_race_run_id_fkey'
  ) THEN
    ALTER TABLE public.scores ADD CONSTRAINT scores_race_run_id_fkey
      FOREIGN KEY (race_run_id) REFERENCES public.race_runs(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS scores_race_run_id_key
  ON public.scores (race_run_id) WHERE race_run_id IS NOT NULL;

COMMENT ON COLUMN public.scores.race_run_id IS
  'Corrida Fitness Race que publicou este resultado na prova TOTAL (Story 1.99). NULL = lançamento manual, súmula de Functional Fitness, Qualifier ou resultado anterior. Com valor, o lançamento manual responde 409.';

-- 2. Situações do resultado: DQ e DNF da súmula Fitness Race
ALTER TABLE public.scores DROP CONSTRAINT IF EXISTS scores_result_status_check;
ALTER TABLE public.scores ADD CONSTRAINT scores_result_status_check
  CHECK (result_status IS NULL OR result_status IN ('validated', 'penalized', 'rejected', 'manual', 'absent', 'disqualified', 'dnf'));
