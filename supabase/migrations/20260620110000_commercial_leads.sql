-- Leads comerciais capturados na homepage para consulta do owner

CREATE TABLE IF NOT EXISTS commercial_leads (
  id TEXT PRIMARY KEY,
  manager_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  phone_normalized TEXT NOT NULL,
  event_name TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  lead_status TEXT NOT NULL DEFAULT 'new'
    CHECK (lead_status IN ('new', 'contacted', 'qualified', 'discarded')),
  accepted_terms BOOLEAN NOT NULL DEFAULT FALSE,
  accepted_at TIMESTAMPTZ NOT NULL,
  terms_version TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'homepage-commercial-interest',
  owner_email_notification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (owner_email_notification_status IN ('pending', 'sent', 'failed', 'skipped')),
  owner_email_notified_at TIMESTAMPTZ,
  owner_email_recipient TEXT,
  owner_email_message_id TEXT,
  owner_email_error TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commercial_leads_submitted_at ON commercial_leads(submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_commercial_leads_status ON commercial_leads(lead_status);
CREATE INDEX IF NOT EXISTS idx_commercial_leads_phone_normalized ON commercial_leads(phone_normalized);
CREATE INDEX IF NOT EXISTS idx_commercial_leads_source ON commercial_leads(source);

CREATE OR REPLACE FUNCTION set_commercial_leads_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_commercial_leads_updated_at ON commercial_leads;

CREATE TRIGGER trg_commercial_leads_updated_at
BEFORE UPDATE ON commercial_leads
FOR EACH ROW
EXECUTE FUNCTION set_commercial_leads_updated_at();
