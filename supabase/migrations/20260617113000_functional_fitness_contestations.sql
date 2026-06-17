-- Contestacoes de provas para eventos de Functional Fitness

CREATE TABLE IF NOT EXISTS contestations (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  registration_id TEXT NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  athlete_id TEXT REFERENCES athletes(id) ON DELETE SET NULL,
  workout_id TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  heat_id TEXT,
  heat_number INTEGER,
  lane TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'under_review'
    CHECK (status IN ('under_review', 'approved', 'rejected')),
  credit_consumed BOOLEAN NOT NULL DEFAULT TRUE,
  credit_refunded BOOLEAN NOT NULL DEFAULT FALSE,
  manager_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_contestations_event_id ON contestations(event_id);
CREATE INDEX IF NOT EXISTS idx_contestations_registration_id ON contestations(registration_id);
CREATE INDEX IF NOT EXISTS idx_contestations_user_id ON contestations(user_id);
CREATE INDEX IF NOT EXISTS idx_contestations_athlete_id ON contestations(athlete_id);
CREATE INDEX IF NOT EXISTS idx_contestations_status ON contestations(status);

CREATE OR REPLACE FUNCTION set_contestations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_contestations_updated_at ON contestations;

CREATE TRIGGER trg_contestations_updated_at
BEFORE UPDATE ON contestations
FOR EACH ROW
EXECUTE FUNCTION set_contestations_updated_at();
