-- Área do atleta e rastreio de pagamento por inscrição

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('owner', 'manager', 'athlete'));

ALTER TABLE registrations ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS athlete_id TEXT REFERENCES athletes(id) ON DELETE SET NULL;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'payment_approved'
  CHECK (payment_status IN (
    'payment_pending',
    'payment_approved',
    'payment_failed',
    'payment_in_review',
    'payment_cancelled'
  ));
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS payment_method TEXT;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS payment_id TEXT;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS payment_status_detail TEXT;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS payment_error_message TEXT;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

UPDATE registrations
SET payment_status = COALESCE(payment_status, 'payment_approved'),
    updated_at = COALESCE(updated_at, created_at, NOW());

CREATE INDEX IF NOT EXISTS idx_registrations_user_id ON registrations(user_id);
CREATE INDEX IF NOT EXISTS idx_registrations_athlete_email ON registrations(athlete_email);
CREATE INDEX IF NOT EXISTS idx_registrations_event_id ON registrations(event_id);
CREATE INDEX IF NOT EXISTS idx_registrations_payment_id ON registrations(payment_id);

