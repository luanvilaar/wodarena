-- Liberar a súmula para outro judge (Story 1.148, D8, docs/design/quadra-por-raia/).
--
-- O gestor tira o judge de uma súmula em andamento ou devolvida sem apagar os
-- registros: scoresheets.judge_user_id vai a NULL e o próximo judge que abrir a
-- súmula assume (regra que já existe em claimSheet). Esta migration só deixa o
-- histórico guardar a ação:
--   scoresheet_reviews.action: o CHECK passa a aceitar 'released' ("Liberada
--   para outro judge"), além dos sete valores de 20261021120000_scoresheet_absent.sql.
--   O CHECK de nome fixo scoresheet_reviews_action_check (ou o automático, se a
--   migration de ausência não tiver rodado) é localizado em pg_constraint,
--   removido e recriado com o nome fixo.
--
-- A liberação da súmula vazia pelo próprio judge (D4) não precisa de migration:
-- a súmula sem registro é apagada, e o histórico dela vai junto em cascata.
--
-- RLS e grants: nenhuma tabela nova; nada muda nas policies nem nos grants.
--
-- Idempotente: reaplicar acha o CHECK de nome fixo (que cita 'manual_override')
-- e o recria igual. Nenhuma migration anterior é alterada.
--
-- Ordem de deploy: depois de 20261021120000_scoresheet_absent.sql. Sem esta
-- migration, só "Liberar para outro judge" responde que a migration está
-- pendente (503); o resto da súmula segue igual.
--
-- Rollback:
--   As linhas com action = 'released' precisam ser apagadas (ou trocadas de
--   ação) antes de restaurar o CHECK antigo, senão o ADD CONSTRAINT falha.
--     DELETE FROM public.scoresheet_reviews WHERE action = 'released';
--     ALTER TABLE public.scoresheet_reviews DROP CONSTRAINT IF EXISTS scoresheet_reviews_action_check;
--     ALTER TABLE public.scoresheet_reviews ADD CONSTRAINT scoresheet_reviews_action_check
--       CHECK (action IN ('opened', 'submitted', 'returned', 'corrected', 'cancelled', 'manual_override', 'absent'));

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
    CHECK (action IN ('opened', 'submitted', 'returned', 'corrected', 'cancelled', 'manual_override', 'absent', 'released'));
END $$;
