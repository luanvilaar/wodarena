-- Script SQL para criação da tabela de cupons de desconto e alteração da tabela de inscrições
-- Execute este script no SQL Editor do seu projeto no painel do Supabase.

CREATE TABLE IF NOT EXISTS coupons (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    discount_type TEXT NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
    discount_value NUMERIC NOT NULL,
    usage_limit INTEGER DEFAULT 100,
    usage_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(event_id, code)
);

-- Desabilita o Row Level Security para escrita e leitura direta via API cliente
ALTER TABLE coupons DISABLE ROW LEVEL SECURITY;

-- Adiciona a coluna coupon_code na tabela de inscrições se não existir
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS coupon_code TEXT;
