-- Proteger campos de valor e titularidade de inscrições com pagamento (Story 1.40).
--
-- Depois que uma inscrição tem pagamento, o valor cobrado e a quem ela pertence
-- deixam de mudar por UPDATE, mesmo que um código futuro tente. O gatilho
-- BEFORE UPDATE abaixo confere o estado ANTERIOR da linha (OLD):
--
--   Inscrição com pagamento:
--     (payment_id IS NOT NULL OR payment_status IN ('payment_approved', 'payment_in_review'))
--     e payment_status diferente de 'payment_cancelled' (comparação NULL-safe).
--
--   Campos protegidos (o valor novo precisa ser IS NOT DISTINCT FROM o anterior):
--     event_id, user_id, athlete_id, ticket_price, quantity, total_paid,
--     shirt_addon_count, shirt_addon_amount.
--
--   Erro: SQLSTATE 23514 (check_violation), mensagem
--   'paid_registration_protected: <campo>', com COLUMN, TABLE e CONSTRAINT
--   (nome do gatilho) preenchidos. O app trata como falha genérica de gravação.
--
-- Continuam livres (gravações legítimas das rotas de pagamento, dos webhooks,
-- do cancelamento, do reembolso e da edição pelo gestor): payment_status,
-- payment_id, payment_method, payment_status_detail, payment_error_message,
-- amount_collected, service_fee_*, application_fee_charged, refund_*,
-- cancellation_reason, cancelled_*, division_id, ticket_type, athlete_name,
-- athlete_email, athlete_phone, box, gender, coupon_code, coupon_counted,
-- currency, payment_gateway, locale e updated_at. Inscrição sem pagamento e
-- inscrição cancelada não são protegidas. INSERT e DELETE não passam por aqui.
--
-- Única exceção, vinda da auditoria das gravações existentes: athlete_id pode
-- ser PREENCHIDO quando está vazio (NULL → valor). admin_update_registration_details
-- (20260718120000, edição pelo gestor) vincula um atleta à inscrição que ainda
-- não tem um. Trocar um atleta por outro, ou esvaziar o vínculo, continua barrado.
--
-- Correção manual por DBA (saída explícita): dentro de uma transação,
--     BEGIN;
--     SELECT set_config('app.allow_paid_registration_edit', 'on', true);
--     UPDATE public.registrations SET ... WHERE id = '...';
--     COMMIT;
--   O terceiro argumento true deixa a variável local à transação: ela volta
--   sozinha no COMMIT/ROLLBACK e não vale para a transação seguinte. Só o valor
--   exato 'on' libera. Registre o motivo da correção fora do banco.
--
-- Função sem SECURITY DEFINER: ela só compara OLD/NEW e lê uma variável de
-- configuração; não lê nem grava tabela, então não precisa de privilégio
-- próprio. search_path fixo em pg_catalog, pg_temp. EXECUTE revogado de
-- PUBLIC, anon e authenticated (gatilho não é chamado como RPC; o disparo do
-- gatilho não depende desse privilégio).
--
-- Nome do gatilho: trg_registrations_* vem depois de trg_qualifier_* na ordem
-- alfabética, então ele é o último BEFORE UPDATE de registrations a rodar.
--
-- Idempotente: CREATE OR REPLACE FUNCTION e DROP TRIGGER IF EXISTS antes do
-- CREATE TRIGGER. Não lê nem altera linhas existentes: vale só para os
-- próximos UPDATEs.
--
-- Ordem de deploy: aplicar as migrations em ordem de nome (20261013120000,
-- que cria shirt_addon_count/shirt_addon_amount, antes desta) e antes de
-- publicar o código das Stories 1.38 a 1.40. Se as colunas protegidas não
-- existirem, a migration para no primeiro bloco sem criar nada. Esta
-- migration funciona sem o código da Story 1.40 e vice-versa.
--
-- Rollback (em nova migration):
--   DROP TRIGGER IF EXISTS trg_registrations_protect_paid_fields ON public.registrations;
--   DROP FUNCTION IF EXISTS public.protect_paid_registration_fields();

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
      AND attname IN (
        'event_id', 'user_id', 'athlete_id', 'ticket_price', 'quantity', 'total_paid',
        'shirt_addon_count', 'shirt_addon_amount', 'payment_id', 'payment_status'
      )
  ) <> 10 THEN
    RAISE EXCEPTION 'protect_paid_registrations: aplique antes 20261013120000_event_optional_shirt.sql';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Função do gatilho
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_paid_registration_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_has_payment BOOLEAN;
  v_field TEXT;
BEGIN
  -- Saída documentada para correção manual por DBA, local à transação.
  IF current_setting('app.allow_paid_registration_edit', true) = 'on' THEN
    RETURN NEW;
  END IF;

  v_has_payment := OLD.payment_id IS NOT NULL
    OR COALESCE(OLD.payment_status IN ('payment_approved', 'payment_in_review'), false);

  -- Sem pagamento, ou cancelada: nada a proteger.
  IF NOT v_has_payment OR OLD.payment_status IS NOT DISTINCT FROM 'payment_cancelled' THEN
    RETURN NEW;
  END IF;

  IF NEW.event_id IS DISTINCT FROM OLD.event_id THEN
    v_field := 'event_id';
  ELSIF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    v_field := 'user_id';
  ELSIF NEW.athlete_id IS DISTINCT FROM OLD.athlete_id AND OLD.athlete_id IS NOT NULL THEN
    -- Com OLD.athlete_id NULL o vínculo ausente está sendo preenchido
    -- (admin_update_registration_details); fora isso, o atleta não muda.
    v_field := 'athlete_id';
  ELSIF NEW.ticket_price IS DISTINCT FROM OLD.ticket_price THEN
    v_field := 'ticket_price';
  ELSIF NEW.quantity IS DISTINCT FROM OLD.quantity THEN
    v_field := 'quantity';
  ELSIF NEW.total_paid IS DISTINCT FROM OLD.total_paid THEN
    v_field := 'total_paid';
  ELSIF NEW.shirt_addon_count IS DISTINCT FROM OLD.shirt_addon_count THEN
    v_field := 'shirt_addon_count';
  ELSIF NEW.shirt_addon_amount IS DISTINCT FROM OLD.shirt_addon_amount THEN
    v_field := 'shirt_addon_amount';
  END IF;

  IF v_field IS NOT NULL THEN
    RAISE EXCEPTION 'paid_registration_protected: %', v_field
      USING ERRCODE = 'check_violation',
            DETAIL = 'Campos de valor e titularidade de inscrições com pagamento não mudam por UPDATE.',
            SCHEMA = TG_TABLE_SCHEMA,
            TABLE = TG_TABLE_NAME,
            COLUMN = v_field,
            CONSTRAINT = TG_NAME;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_paid_registration_fields() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Gatilho
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_registrations_protect_paid_fields ON public.registrations;
CREATE TRIGGER trg_registrations_protect_paid_fields
BEFORE UPDATE ON public.registrations
FOR EACH ROW
EXECUTE FUNCTION public.protect_paid_registration_fields();

-- ---------------------------------------------------------------------------
-- 4. Documentação
-- ---------------------------------------------------------------------------

COMMENT ON FUNCTION public.protect_paid_registration_fields() IS
  'Story 1.40. Protege campos de valor e titularidade de inscrições com pagamento (payment_id preenchido ou status payment_approved/payment_in_review, e não cancelada): event_id, user_id, athlete_id, ticket_price, quantity, total_paid, shirt_addon_count e shirt_addon_amount não mudam por UPDATE (erro 23514 paid_registration_protected: <campo>). athlete_id vazio pode ser preenchido. Correção manual por DBA: SELECT set_config(''app.allow_paid_registration_edit'', ''on'', true) dentro da transação da correção.';

COMMENT ON TRIGGER trg_registrations_protect_paid_fields ON public.registrations IS
  'Story 1.40. BEFORE UPDATE: mantém valor cobrado e titular de inscrições com pagamento iguais ao gravado. Ver COMMENT ON FUNCTION public.protect_paid_registration_fields().';
