-- Quem paga a taxa de serviço da plataforma (Stories 1.82 a 1.85).
--
-- O gestor escolhe, na aba Pagamentos, se a taxa é somada ao valor da inscrição
-- e paga pelo atleta ('athlete', o comportamento de sempre no Mercado Pago) ou se
-- já está dentro do valor da inscrição e sai do que ele recebe ('organizer').
--
--   manager_payment_settings   uma linha por gestor que já escolheu. Sem linha
--                              vale o padrão do gateway (Mercado Pago: atleta;
--                              Stripe: gestor, como a Stripe sempre cobrou).
--   registrations.service_fee_payer   a regra que valeu para a inscrição, gravada
--                              quando o pagamento é criado. NULL = inscrição
--                              anterior à escolha: vale o padrão do gateway.
--
-- Aditiva e idempotente: não lê nem altera linhas existentes. service_fee_payer
-- não está entre os campos protegidos de inscrição paga (20261014120000), e as
-- rotas de pagamento seguem podendo gravá-lo.
--
-- Ordem de deploy: aplicar esta migration ANTES de publicar o código das Stories
-- 1.82 a 1.85. O bootstrap privado e as rotas de pagamento passam a ler e gravar
-- a coluna nova.

CREATE TABLE IF NOT EXISTS public.manager_payment_settings (
  user_id TEXT PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  service_fee_payer TEXT NOT NULL CHECK (service_fee_payer IN ('athlete', 'organizer')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS ligada e sem acesso para anon/authenticated: toda leitura e escrita passa
-- pelas rotas server-side com service role (mesmo padrão de stripe_accounts).
ALTER TABLE public.manager_payment_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny anon manager_payment_settings" ON public.manager_payment_settings;
CREATE POLICY "Deny anon manager_payment_settings"
ON public.manager_payment_settings FOR SELECT
USING (false);

ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS service_fee_payer TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'registrations_service_fee_payer_check'
      AND conrelid = 'public.registrations'::regclass
  ) THEN
    ALTER TABLE public.registrations
      ADD CONSTRAINT registrations_service_fee_payer_check
      CHECK (service_fee_payer IS NULL OR service_fee_payer IN ('athlete', 'organizer'));
  END IF;
END $$;
