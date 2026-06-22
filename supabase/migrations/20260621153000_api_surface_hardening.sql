-- Hardening da superficie publica do banco apos a auditoria de APIs expostas.
-- O frontend atual consome dados publicos via rotas server-side do Next, entao
-- fechamos a exposicao direta via REST/RPC do Supabase e mantemos o service_role
-- como unico caminho administrativo.

-- 1. Garantir RLS nas tabelas sensiveis mapeadas pela auditoria.
ALTER TABLE contestations ENABLE ROW LEVEL SECURITY;
ALTER TABLE commercial_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaderboard_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE mercadopago_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE divisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE scores ENABLE ROW LEVEL SECURITY;

-- 2. Fechar exposicao REST publica desnecessaria. A aplicacao publica usa
-- `/api/app/bootstrap` e `/api/checkout/config`, nao o REST anonimo do Supabase.
DROP POLICY IF EXISTS "Allow public select on mercadopago_accounts" ON mercadopago_accounts;
DROP POLICY IF EXISTS "Public read connected Mercado Pago public keys" ON mercadopago_accounts;
DROP POLICY IF EXISTS "Public read published events" ON events;
DROP POLICY IF EXISTS "Public read event divisions" ON divisions;
DROP POLICY IF EXISTS "Public read event workouts" ON workouts;
DROP POLICY IF EXISTS "Public read scores" ON scores;
DROP POLICY IF EXISTS "Public read leaderboard entries" ON leaderboard_entries;

-- 3. Restringir a RPC sensivel de contabilizacao de cupom apenas ao service role.
REVOKE ALL ON FUNCTION apply_coupon_usage(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION apply_coupon_usage(TEXT) FROM anon;
REVOKE ALL ON FUNCTION apply_coupon_usage(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION apply_coupon_usage(TEXT) TO service_role;

-- 4. Remover a credencial legada sensivel do escopo publico de eventos.
ALTER TABLE events DROP COLUMN IF EXISTS mp_access_token;
