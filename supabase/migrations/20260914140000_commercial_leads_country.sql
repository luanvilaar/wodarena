-- Leads comerciais passam a registrar o pais de origem: o formulario da
-- homepage ate aqui so suportava Brasil (dropdown de UF fixo, validacao de
-- telefone com DDD). Sem essa coluna, a equipe comercial nao sabia se um
-- lead de Portugal/Reino Unido precisaria de onboarding via Stripe em vez de
-- Mercado Pago.

ALTER TABLE commercial_leads
  ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'BR' CHECK (country IN ('BR', 'PT', 'GB', 'OTHER')),
  ADD COLUMN IF NOT EXISTS country_other TEXT;

CREATE INDEX IF NOT EXISTS idx_commercial_leads_country ON commercial_leads(country);
