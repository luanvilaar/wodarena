-- Adiciona suporte a PKCE (Proof Key for Code Exchange) na tabela de OAuth states.
-- code_verifier é armazenado temporariamente e deletado junto com o state após o uso.
ALTER TABLE public.mercadopago_oauth_states
  ADD COLUMN IF NOT EXISTS code_verifier TEXT;
