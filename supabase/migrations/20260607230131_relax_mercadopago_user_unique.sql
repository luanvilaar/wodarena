-- Permite reutilizar a mesma conta Mercado Pago em mais de um usuário WODArena.
-- A relação que precisa continuar única é user_id -> conta configurada.
ALTER TABLE mercadopago_accounts
DROP CONSTRAINT IF EXISTS mercadopago_accounts_mercadopago_user_id_key;

DROP INDEX IF EXISTS mercadopago_accounts_mercadopago_user_id_key;

CREATE INDEX IF NOT EXISTS idx_mercadopago_accounts_mercadopago_user_id
ON mercadopago_accounts (mercadopago_user_id);
