-- Story 1.122 (decisão E3, docs/design/painel-proprietario/): data de cadastro na
-- tabela users, para a lista de cadastros recentes do painel do proprietário.
--
-- Contas antigas recebem a data do horário que já está no id (org-<ms>,
-- ath-user-<ms>, judge-<ms>...). Ids sem horário (ex.: owner-1) ficam sem data.
-- Novas contas recebem o momento do cadastro pelo valor padrão.
--
-- Aplicar no banco só a pedido do Luan. Sem esta migration, o painel continua
-- funcionando: a rota lê a data do id (src/lib/serverOwnerOverview.ts).

ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;

UPDATE users
SET created_at = to_timestamp(substring(id from '([0-9]{13})$')::bigint / 1000.0)
WHERE created_at IS NULL
  AND id ~ '[0-9]{13}$';

ALTER TABLE users ALTER COLUMN created_at SET DEFAULT NOW();

CREATE INDEX IF NOT EXISTS users_role_created_at_idx ON users (role, created_at DESC);
