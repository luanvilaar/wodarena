-- Adicionar colunas para credenciais customizadas do Mercado Pago por evento
ALTER TABLE events ADD COLUMN IF NOT EXISTS mp_public_key TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS mp_access_token TEXT;
