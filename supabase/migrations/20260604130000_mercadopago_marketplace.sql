-- Tabela para armazenar as credenciais OAuth das contas Mercado Pago dos Gestores
CREATE TABLE IF NOT EXISTS mercadopago_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    mercadopago_user_id TEXT NOT NULL UNIQUE,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    public_key TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'disconnected')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Adiciona suporte para taxa de comissão customizada por evento
ALTER TABLE events ADD COLUMN IF NOT EXISTS marketplace_fee NUMERIC DEFAULT NULL;
