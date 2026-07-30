-- Registra a procedência das conexões OAuth concluídas pelo callback da WODArena.
-- Registros anteriores permanecem sem verificação e exigem uma nova autorização
-- antes de poderem criar pagamentos com application_fee.
ALTER TABLE public.mercadopago_accounts
  ADD COLUMN IF NOT EXISTS oauth_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS oauth_client_id TEXT;

COMMENT ON COLUMN public.mercadopago_accounts.oauth_verified_at IS
  'Data em que a conta foi conectada pelo callback OAuth da aplicação WODArena.';

COMMENT ON COLUMN public.mercadopago_accounts.oauth_client_id IS
  'Client ID da aplicação Mercado Pago que concluiu o callback OAuth da conta.';
