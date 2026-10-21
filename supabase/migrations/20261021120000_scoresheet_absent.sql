-- Atleta ausente na súmula digital (Story 1.59).
--
-- O judge (ou o gestor) marca o atleta que não compareceu como ausente. O
-- servidor publica em scores o pior resultado possível da prova, calculado da
-- estrutura copiada na súmula, com result_status = 'absent' (o CHECK de
-- scores já aceita esse valor desde 20260816120000_functional_fitness_qualifier.sql).
-- Esta migration só guarda a marca na súmula e o registro no histórico:
--   1. scoresheets.absent: a súmula foi enviada como ausência (nasce false; as
--      súmulas existentes ficam com false). A marca é da súmula, ou seja, de
--      uma prova: o atleta, a inscrição e a categoria não ganham campo novo.
--   2. scoresheet_reviews.action: o CHECK passa a aceitar 'absent' ("Atleta
--      ausente"), além dos seis valores de 20261017120000_scoresheets.sql. O
--      CHECK foi criado em linha, com nome automático; aqui ele é localizado em
--      pg_constraint (o CHECK da coluna action que cita 'manual_override'),
--      removido e recriado com o nome fixo scoresheet_reviews_action_check.
--
-- RLS e grants: nenhuma tabela nova; nada muda nas policies nem nos grants.
-- scores não muda.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS; o CHECK é refeito a cada aplicação
-- (reaplicar acha o CHECK de nome fixo, que também cita 'manual_override', e o
-- recria igual). Reaplicar não falha nem altera dados. Nenhuma migration
-- anterior é alterada.
--
-- Ordem de deploy: depois de 20261017120000_scoresheets.sql (e de
-- 20261020120000_live_broadcast.sql, se já aplicada; as duas são independentes).
-- Sem esta migration, a súmula, o painel e o telão seguem como antes (as
-- leituras aceitam a coluna ausente) e só as ações novas de ausência respondem
-- que a migration está pendente.
--
-- Rollback (apaga a marca de ausência das súmulas):
--   As linhas com action = 'absent' em scoresheet_reviews precisam ser tratadas
--   antes de restaurar o CHECK antigo (apagadas ou trocadas de ação), senão o
--   ADD CONSTRAINT falha. Os scores publicados com result_status = 'absent'
--   continuam válidos e no ranking; para tirá-los, devolva ou corrija a súmula
--   antes do rollback.
--     DELETE FROM public.scoresheet_reviews WHERE action = 'absent';
--     ALTER TABLE public.scoresheet_reviews DROP CONSTRAINT IF EXISTS scoresheet_reviews_action_check;
--     ALTER TABLE public.scoresheet_reviews ADD CONSTRAINT scoresheet_reviews_action_check
--       CHECK (action IN ('opened', 'submitted', 'returned', 'corrected', 'cancelled', 'manual_override'));
--     ALTER TABLE public.scoresheets DROP COLUMN IF EXISTS absent;

-- 1. Marca de ausência na súmula
ALTER TABLE public.scoresheets ADD COLUMN IF NOT EXISTS absent BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.scoresheets.absent IS
  'Atleta ausente nesta prova (Story 1.59): a súmula foi enviada sem log, com o pior resultado possível calculado pelo servidor da estrutura copiada; o score publicado leva result_status = absent. Volta a false no reenvio normal, na correção do gestor ou no lançamento manual que muda o resultado.';

-- 2. Ação "Atleta ausente" no histórico da súmula
DO $$
DECLARE
  existing_check TEXT;
BEGIN
  FOR existing_check IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.scoresheet_reviews'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%action%'
      AND pg_get_constraintdef(oid) LIKE '%manual_override%'
  LOOP
    EXECUTE format('ALTER TABLE public.scoresheet_reviews DROP CONSTRAINT %I', existing_check);
  END LOOP;

  ALTER TABLE public.scoresheet_reviews ADD CONSTRAINT scoresheet_reviews_action_check
    CHECK (action IN ('opened', 'submitted', 'returned', 'corrected', 'cancelled', 'manual_override', 'absent'));
END $$;
