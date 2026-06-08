-- Baseline de seguranca para reabilitar RLS em tabelas operacionais.
-- Aplicar junto com a migracao das mutacoes administrativas para APIs server-side autenticadas.

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE divisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE athletes ENABLE ROW LEVEL SECURITY;
ALTER TABLE scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE mercadopago_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read published events" ON events;
CREATE POLICY "Public read published events"
ON events FOR SELECT
USING (status IN ('upcoming', 'live', 'finished'));

DROP POLICY IF EXISTS "Public read event divisions" ON divisions;
CREATE POLICY "Public read event divisions"
ON divisions FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM events
    WHERE events.id = divisions.event_id
      AND events.status IN ('upcoming', 'live', 'finished')
  )
);

DROP POLICY IF EXISTS "Public read event workouts" ON workouts;
CREATE POLICY "Public read event workouts"
ON workouts FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM events
    WHERE events.id = workouts.event_id
      AND events.status IN ('upcoming', 'live', 'finished')
  )
);

DROP POLICY IF EXISTS "Public read scores" ON scores;
CREATE POLICY "Public read scores"
ON scores FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Public read connected Mercado Pago public keys" ON mercadopago_accounts;
CREATE POLICY "Public read connected Mercado Pago public keys"
ON mercadopago_accounts FOR SELECT
USING (status = 'connected');

DROP POLICY IF EXISTS "Deny anon users" ON users;
CREATE POLICY "Deny anon users"
ON users FOR SELECT
USING (false);

DROP POLICY IF EXISTS "Deny anon athletes" ON athletes;
CREATE POLICY "Deny anon athletes"
ON athletes FOR SELECT
USING (false);

DROP POLICY IF EXISTS "Deny anon registrations" ON registrations;
CREATE POLICY "Deny anon registrations"
ON registrations FOR SELECT
USING (false);

DROP POLICY IF EXISTS "Deny anon coupons" ON coupons;
CREATE POLICY "Deny anon coupons"
ON coupons FOR SELECT
USING (false);
