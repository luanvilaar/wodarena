-- Taxa global da plataforma. Acesso ocorre exclusivamente pelas rotas server-side.
CREATE TABLE IF NOT EXISTS public.platform_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE,
  service_fee_percent NUMERIC NOT NULL DEFAULT 10 CHECK (service_fee_percent >= 0 AND service_fee_percent < 100),
  service_fee_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT platform_settings_singleton CHECK (id = TRUE)
);

INSERT INTO public.platform_settings (id, service_fee_percent, service_fee_enabled)
VALUES (TRUE, 10, TRUE)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS service_fee_percent NUMERIC,
  ADD COLUMN IF NOT EXISTS service_fee_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS amount_collected NUMERIC,
  ADD COLUMN IF NOT EXISTS application_fee_charged NUMERIC;

-- Inscricoes anteriores nao tinham taxa: o total historico permanece igual ao valor cobrado.
UPDATE public.registrations
SET
  service_fee_percent = COALESCE(service_fee_percent, 0),
  service_fee_amount = COALESCE(service_fee_amount, 0),
  amount_collected = COALESCE(amount_collected, total_paid),
  application_fee_charged = COALESCE(application_fee_charged, 0);

ALTER TABLE public.registrations
  ALTER COLUMN service_fee_percent SET DEFAULT 0,
  ALTER COLUMN service_fee_amount SET DEFAULT 0,
  ALTER COLUMN amount_collected SET DEFAULT 0,
  ALTER COLUMN application_fee_charged SET DEFAULT 0;
