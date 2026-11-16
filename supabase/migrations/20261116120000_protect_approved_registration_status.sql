-- Trava de status de inscrição aprovada (Story 1.139).
--
-- Uma inscrição aprovada só deixa de ser aprovada por UPDATE em dois casos:
--
--   1. Cancelamento pelo gestor (painel ou CLI): o novo status é
--      'payment_cancelled' e cancelled_by está preenchido.
--   2. Mudança vinda do próprio pagamento que a aprovou (payment_id igual ao
--      anterior, não nulo):
--        - estorno ou contestação: 'payment_cancelled' com payment_status_detail
--          'refunded' ou 'charged_back';
--        - conferência de valores segurando a aprovação: 'payment_in_review'.
--
-- Qualquer outra saída de 'payment_approved' (o aviso de um PIX antigo que
-- expirou, uma tentativa recusada de outro pagamento, uma rota que grava
-- 'payment_pending' por cima) para com erro e a linha fica como estava.
--
-- É a última barreira. A regra que decide fica no código, em
-- src/lib/paymentStatusTransition.ts (Story 1.137), e as rotas não chegam a
-- tentar essas gravações; o gatilho segura qualquer caminho que escape dela,
-- inclusive código escrito no futuro.
--
--   Erro: SQLSTATE 23514 (check_violation), mensagem
--   'approved_registration_status_protected: <status novo>', com TABLE e
--   CONSTRAINT (nome do gatilho) preenchidos. As rotas tratam como falha de
--   gravação: o webhook responde 500 e o Mercado Pago reenvia o aviso depois.
--
-- Não protege: inscrição que não está aprovada, gravação que mantém
-- 'payment_approved', INSERT e DELETE. Outras colunas da linha seguem com as
-- regras de hoje (ver 20261014120000_protect_paid_registrations.sql).
--
-- Correção manual por DBA (saída explícita): dentro de uma transação,
--     BEGIN;
--     SELECT set_config('app.allow_registration_status_change', 'on', true);
--     UPDATE public.registrations SET payment_status = ... WHERE id = '...';
--     COMMIT;
--   O terceiro argumento true deixa a variável local à transação. Só o valor
--   exato 'on' libera. Registre o motivo da correção fora do banco.
--
-- Função sem SECURITY DEFINER: só compara OLD/NEW e lê uma variável de
-- configuração. search_path fixo em pg_catalog, pg_temp. EXECUTE revogado de
-- PUBLIC, anon e authenticated.
--
-- Ordem de deploy: aplicar DEPOIS de publicar o código da Story 1.137. Antes
-- dele, as rotas antigas tentam rebaixar a inscrição aprovada quando chega o
-- aviso de um PIX antigo; com o gatilho, a gravação falha (a inscrição fica
-- aprovada, que é o certo) e o webhook responde 500, então o Mercado Pago
-- repete o aviso por alguns dias. Funciona, mas gera erro no log.
--
-- Idempotente: CREATE OR REPLACE FUNCTION e DROP TRIGGER IF EXISTS antes do
-- CREATE TRIGGER. Não lê nem altera linhas existentes.
--
-- Rollback (em nova migration):
--   DROP TRIGGER IF EXISTS trg_registrations_protect_approved_status ON public.registrations;
--   DROP FUNCTION IF EXISTS public.protect_approved_registration_status();

-- ---------------------------------------------------------------------------
-- 1. Pré-condição: colunas que o gatilho lê
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF (
    SELECT count(*)
    FROM pg_attribute
    WHERE attrelid = 'public.registrations'::regclass
      AND attnum > 0
      AND NOT attisdropped
      AND attname IN ('payment_status', 'payment_id', 'payment_status_detail', 'cancelled_by')
  ) <> 4 THEN
    RAISE EXCEPTION 'protect_approved_registration_status: colunas de pagamento ou de cancelamento ausentes em registrations';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Função do gatilho
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_approved_registration_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  -- Saída documentada para correção manual por DBA, local à transação.
  IF current_setting('app.allow_registration_status_change', true) = 'on' THEN
    RETURN NEW;
  END IF;

  -- Só interessa a saída de 'payment_approved'.
  IF OLD.payment_status IS DISTINCT FROM 'payment_approved'
     OR NEW.payment_status IS NOT DISTINCT FROM 'payment_approved' THEN
    RETURN NEW;
  END IF;

  -- 1. Cancelamento pelo gestor (painel ou CLI).
  IF NEW.payment_status = 'payment_cancelled'
     AND NULLIF(btrim(NEW.cancelled_by), '') IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- 2. O próprio pagamento que aprovou a inscrição.
  IF OLD.payment_id IS NOT NULL
     AND NEW.payment_id IS NOT DISTINCT FROM OLD.payment_id
     AND (
       (NEW.payment_status = 'payment_cancelled' AND NEW.payment_status_detail IN ('refunded', 'charged_back'))
       OR NEW.payment_status = 'payment_in_review'
     ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'approved_registration_status_protected: %', COALESCE(NEW.payment_status, 'null')
    USING ERRCODE = 'check_violation',
          DETAIL = 'Inscrição aprovada só sai de aprovada por cancelamento do gestor ou por estorno, contestação ou análise do próprio pagamento que a aprovou.',
          SCHEMA = TG_TABLE_SCHEMA,
          TABLE = TG_TABLE_NAME,
          CONSTRAINT = TG_NAME;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_approved_registration_status() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Gatilho
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_registrations_protect_approved_status ON public.registrations;
CREATE TRIGGER trg_registrations_protect_approved_status
BEFORE UPDATE OF payment_status ON public.registrations
FOR EACH ROW
EXECUTE FUNCTION public.protect_approved_registration_status();

-- ---------------------------------------------------------------------------
-- 4. Documentação
-- ---------------------------------------------------------------------------

COMMENT ON FUNCTION public.protect_approved_registration_status() IS
  'Story 1.139. Inscrição aprovada só sai de payment_approved por cancelamento do gestor (payment_cancelled com cancelled_by) ou pelo próprio pagamento que a aprovou (mesmo payment_id: payment_cancelled com detalhe refunded/charged_back, ou payment_in_review). Fora isso: erro 23514 approved_registration_status_protected. Correção manual por DBA: SELECT set_config(''app.allow_registration_status_change'', ''on'', true) dentro da transação da correção.';

COMMENT ON TRIGGER trg_registrations_protect_approved_status ON public.registrations IS
  'Story 1.139. BEFORE UPDATE OF payment_status: impede que o aviso de outro pagamento desfaça uma inscrição aprovada. Ver COMMENT ON FUNCTION public.protect_approved_registration_status().';
