-- 1. Criar tabela privada para segredos e senhas de usuários
CREATE TABLE IF NOT EXISTS users_secrets (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    password TEXT NOT NULL
);

-- 2. Migrar senhas existentes para a tabela privada
INSERT INTO users_secrets (user_id, password)
SELECT id, password FROM users
ON CONFLICT (user_id) DO NOTHING;

-- 3. Remover coluna de senha da tabela pública de usuários
ALTER TABLE users DROP COLUMN IF EXISTS password;

-- 4. Habilitar RLS rígido na tabela de segredos
ALTER TABLE users_secrets ENABLE ROW LEVEL SECURITY;
-- (Por padrão, nenhuma política SELECT/INSERT/UPDATE/DELETE é criada para users_secrets,
-- o que significa que apenas o cliente administrador do servidor (service_role) consegue acessá-la).
