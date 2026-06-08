-- Adiciona coluna is_active à tabela de cupons para permitir desativação sem exclusão
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
