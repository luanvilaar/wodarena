-- 1. Criar tabela privada para segredos do Mercado Pago
CREATE TABLE IF NOT EXISTS mercadopago_secrets (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Migrar tokens existentes e remover colunas da tabela pública condicionalmente
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'mercadopago_accounts' AND column_name = 'access_token'
    ) THEN
        -- Migrar tokens existentes para a tabela privada de segredos
        INSERT INTO mercadopago_secrets (user_id, access_token, refresh_token)
        SELECT user_id, access_token, refresh_token FROM mercadopago_accounts
        ON CONFLICT (user_id) DO NOTHING;

        -- Remover colunas sensíveis da tabela pública
        ALTER TABLE mercadopago_accounts DROP COLUMN IF EXISTS access_token;
        ALTER TABLE mercadopago_accounts DROP COLUMN IF EXISTS refresh_token;
    END IF;
END $$;

-- 4. Habilitar RLS em ambas as tabelas
ALTER TABLE mercadopago_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE mercadopago_accounts ENABLE ROW LEVEL SECURITY;

-- 5. Criar política de leitura pública apenas na tabela pública mercadopago_accounts
-- (A tabela privada mercadopago_secrets permanece sem políticas, logo inacessível do frontend)
DROP POLICY IF EXISTS "Allow public select on mercadopago_accounts" ON mercadopago_accounts;
CREATE POLICY "Allow public select on mercadopago_accounts" 
ON mercadopago_accounts FOR SELECT 
USING (true);
