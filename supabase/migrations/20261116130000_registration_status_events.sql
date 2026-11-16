-- Histórico de status de pagamento das inscrições (Story 1.140).
--
-- A tabela registrations guarda só o último estado da inscrição. Quando uma
-- inscrição muda de status sem que ninguém da equipe tenha mexido, não há como
-- saber depois de onde veio a mudança. Esta migration cria o histórico:
--
--   public.registration_status_events, uma linha por mudança, com o status, o
--   pagamento (payment_id), o detalhe do gateway e o autor do cancelamento
--   antes e depois, e a hora da mudança.
--
-- Quem grava é o gatilho AFTER INSERT OR UPDATE em registrations:
--   - INSERT: uma linha com o estado inicial (old_* nulos);
--   - UPDATE: uma linha quando muda payment_status, payment_id,
--     payment_status_detail ou cancelled_by. Gravações que não mexem nessas
--     colunas (edição de nome, camisa, reembolso manual) não geram linha.
--
-- Quem lê: o service role (CLI `npm run registrations:cli -- history`, consultas
-- de suporte). RLS ligada e sem policy: anon e authenticated não leem nem
-- gravam. Sem chave estrangeira para registrations, de propósito: o histórico
-- sobrevive à exclusão da inscrição (e do evento).
--
-- A função do gatilho é SECURITY DEFINER para gravar no histórico seja qual for
-- o papel que alterou a inscrição (as funções do banco que mexem em
-- registrations também passam por aqui). search_path fixo em public,
-- pg_catalog, pg_temp; EXECUTE revogado de PUBLIC, anon e authenticated.
--
-- Volume: cerca de duas a três linhas por inscrição (criação, aprovação,
-- eventual cancelamento). Índices por inscrição e por evento, na ordem do tempo.
--
-- Independe da Story 1.139 (trava de status) e do código: pode ser aplicada em
-- qualquer ordem. Não lê nem altera linhas existentes; o histórico começa a
-- partir da aplicação.
--
-- Idempotente: CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION e
-- DROP TRIGGER IF EXISTS antes do CREATE TRIGGER.
--
-- Rollback (em nova migration):
--   DROP TRIGGER IF EXISTS trg_registrations_log_status_change ON public.registrations;
--   DROP FUNCTION IF EXISTS public.log_registration_status_change();
--   DROP TABLE IF EXISTS public.registration_status_events;

-- ---------------------------------------------------------------------------
-- 1. Tabela
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.registration_status_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  registration_id TEXT NOT NULL,
  event_id TEXT,
  old_status TEXT,
  new_status TEXT,
  old_payment_id TEXT,
  new_payment_id TEXT,
  old_status_detail TEXT,
  new_status_detail TEXT,
  old_cancelled_by TEXT,
  new_cancelled_by TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_registration_status_events_registration
  ON public.registration_status_events (registration_id, changed_at);

CREATE INDEX IF NOT EXISTS idx_registration_status_events_event
  ON public.registration_status_events (event_id, changed_at);

ALTER TABLE public.registration_status_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.registration_status_events FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Função do gatilho
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.log_registration_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.registration_status_events (
      registration_id, event_id,
      old_status, new_status,
      old_payment_id, new_payment_id,
      old_status_detail, new_status_detail,
      old_cancelled_by, new_cancelled_by
    ) VALUES (
      NEW.id, NEW.event_id,
      NULL, NEW.payment_status,
      NULL, NEW.payment_id,
      NULL, NEW.payment_status_detail,
      NULL, NEW.cancelled_by
    );
  ELSIF NEW.payment_status IS DISTINCT FROM OLD.payment_status
     OR NEW.payment_id IS DISTINCT FROM OLD.payment_id
     OR NEW.payment_status_detail IS DISTINCT FROM OLD.payment_status_detail
     OR NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by THEN
    INSERT INTO public.registration_status_events (
      registration_id, event_id,
      old_status, new_status,
      old_payment_id, new_payment_id,
      old_status_detail, new_status_detail,
      old_cancelled_by, new_cancelled_by
    ) VALUES (
      NEW.id, NEW.event_id,
      OLD.payment_status, NEW.payment_status,
      OLD.payment_id, NEW.payment_id,
      OLD.payment_status_detail, NEW.payment_status_detail,
      OLD.cancelled_by, NEW.cancelled_by
    );
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.log_registration_status_change() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Gatilho
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_registrations_log_status_change ON public.registrations;
CREATE TRIGGER trg_registrations_log_status_change
AFTER INSERT OR UPDATE ON public.registrations
FOR EACH ROW
EXECUTE FUNCTION public.log_registration_status_change();

-- ---------------------------------------------------------------------------
-- 4. Documentação
-- ---------------------------------------------------------------------------

COMMENT ON TABLE public.registration_status_events IS
  'Story 1.140. Histórico de status de pagamento das inscrições: uma linha por criação e por mudança de payment_status, payment_id, payment_status_detail ou cancelled_by. Gravada só pelo gatilho trg_registrations_log_status_change; lida pelo service role.';

COMMENT ON FUNCTION public.log_registration_status_change() IS
  'Story 1.140. AFTER INSERT OR UPDATE em registrations: registra o estado de pagamento antes e depois em registration_status_events.';
