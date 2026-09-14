-- Suporte a multi-pais / multi-moeda para internacionalizacao (pt-BR, pt-PT, en-GB).
-- Todas as colunas sao aditivas com default brasileiro: nenhum evento existente muda de comportamento.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS country_code TEXT NOT NULL DEFAULT 'BR' CHECK (country_code IN ('BR', 'PT', 'GB')),
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'BRL' CHECK (currency IN ('BRL', 'EUR', 'GBP')),
  ADD COLUMN IF NOT EXISTS time_zone TEXT NOT NULL DEFAULT 'America/Fortaleza',
  ADD COLUMN IF NOT EXISTS payment_gateway TEXT NOT NULL DEFAULT 'mercadopago' CHECK (payment_gateway IN ('mercadopago', 'stripe')),
  ADD COLUMN IF NOT EXISTS default_locale TEXT NOT NULL DEFAULT 'pt-br' CHECK (default_locale IN ('pt-br', 'pt-pt', 'en-gb'));

-- Snapshot da moeda/gateway/locale no momento da cobranca: o evento pode ser
-- reconfigurado depois, mas o comprovante e o e-mail precisam refletir o que
-- foi realmente cobrado na inscricao.
ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'BRL' CHECK (currency IN ('BRL', 'EUR', 'GBP')),
  ADD COLUMN IF NOT EXISTS payment_gateway TEXT DEFAULT 'mercadopago' CHECK (payment_gateway IN ('mercadopago', 'stripe')),
  ADD COLUMN IF NOT EXISTS locale TEXT DEFAULT 'pt-br' CHECK (locale IN ('pt-br', 'pt-pt', 'en-gb'));

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS locale TEXT DEFAULT 'pt-br' CHECK (locale IN ('pt-br', 'pt-pt', 'en-gb'));

-- Tabela para armazenar as contas Stripe Connect dos Gestores.
-- Diferente do Mercado Pago, o Stripe Connect nao exige refresh_token/oauth
-- ciclico: a plataforma usa sua propria secret key + o stripe_account_id do gestor.
CREATE TABLE IF NOT EXISTS stripe_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    stripe_account_id TEXT NOT NULL UNIQUE,
    country TEXT NOT NULL CHECK (country IN ('PT', 'GB')),
    default_currency TEXT NOT NULL CHECK (default_currency IN ('EUR', 'GBP')),
    charges_enabled BOOLEAN NOT NULL DEFAULT false,
    payouts_enabled BOOLEAN NOT NULL DEFAULT false,
    details_submitted BOOLEAN NOT NULL DEFAULT false,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'connected', 'disconnected')),
    onboarded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS habilitada, sem policies publicas: toda leitura/escrita passa pelas rotas
-- server-side com service role (mesmo padrao endurecido de mercadopago_accounts
-- apos a api_surface_hardening).
ALTER TABLE stripe_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny anon stripe_accounts" ON stripe_accounts;
CREATE POLICY "Deny anon stripe_accounts"
ON stripe_accounts FOR SELECT
USING (false);
