-- =============================================================================
-- Corrige race condition no limite de uso de cupom (security review 2026-08-14)
-- =============================================================================
-- apply_coupon_usage() já é idempotente POR INSCRIÇÃO (coupon_counted), mas o
-- incremento de coupons.usage_count nunca revalidava usage_limit no momento do
-- UPDATE. Duas inscrições distintas aprovadas em paralelo sob o mesmo cupom
-- (ex.: usage_limit = 1) podiam ambas incrementar o contador, estourando o
-- limite configurado pelo gestor.
--
-- Trava o incremento na própria cláusula WHERE: só soma 1 se o cupom ainda não
-- atingiu usage_limit (0 = ilimitado). Sob concorrência, apenas as N primeiras
-- transações a chegar (N = usage_limit) conseguem incrementar; as demais
-- inscrições continuam idempotentes (coupon_counted = true) mas não inflam o
-- contador além do limite.
-- =============================================================================

CREATE OR REPLACE FUNCTION apply_coupon_usage(p_registration_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_coupon_code TEXT;
  v_event_id TEXT;
BEGIN
  UPDATE registrations
     SET coupon_counted = true
   WHERE id = p_registration_id
     AND payment_status = 'payment_approved'
     AND COALESCE(coupon_counted, false) = false
     AND coupon_code IS NOT NULL
     AND btrim(coupon_code) <> ''
  RETURNING coupon_code, event_id INTO v_coupon_code, v_event_id;

  IF v_coupon_code IS NULL THEN
    RETURN false;
  END IF;

  UPDATE coupons
     SET usage_count = COALESCE(usage_count, 0) + 1
   WHERE event_id = v_event_id
     AND upper(code) = upper(v_coupon_code)
     AND (COALESCE(usage_limit, 0) = 0 OR COALESCE(usage_count, 0) < usage_limit);

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION apply_coupon_usage(TEXT) TO anon, authenticated, service_role;
