-- =============================================================================
-- Contabilização atômica e idempotente do uso de cupons
-- =============================================================================
-- Execute este script no SQL Editor do seu projeto no painel do Supabase.
--
-- Contexto do bug corrigido:
--   O contador "Uso Atual / Limite" dos cupons ficava sempre em 0 porque o
--   incremento dependia de uma chamada client-side a /api/admin/persistence,
--   que exige sessão de gestor/owner. Como quem finaliza a inscrição é o ATLETA
--   (sem essa sessão), a chamada falhava silenciosamente (403). Os fluxos de
--   pagamento server-side (cartão, pix, conciliação e inscrição gratuita) também
--   não incrementavam o contador — apenas o webhook do Mercado Pago fazia, e de
--   forma não idempotente.
--
-- Esta migration centraliza a contabilização no servidor, de forma atômica e
-- idempotente (cada inscrição conta no máximo 1 vez, mesmo que múltiplos fluxos
-- — webhook + polling + cartão — disparem em paralelo).
-- =============================================================================

-- 1. Flag de idempotência por inscrição.
--    Garante que uma mesma inscrição nunca incremente o cupom mais de uma vez.
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS coupon_counted BOOLEAN DEFAULT false;

-- 2. Função atômica de contabilização.
--    A cláusula WHERE coupon_counted = false na atualização da inscrição garante
--    que apenas UMA execução concorrente "reivindique" a contagem (o UPDATE ...
--    RETURNING é atômico). Só quem reivindicou incrementa o cupom.
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
  -- Reivindica a contabilização desta inscrição de forma atômica e idempotente.
  UPDATE registrations
     SET coupon_counted = true
   WHERE id = p_registration_id
     AND payment_status = 'payment_approved'
     AND COALESCE(coupon_counted, false) = false
     AND coupon_code IS NOT NULL
     AND btrim(coupon_code) <> ''
  RETURNING coupon_code, event_id INTO v_coupon_code, v_event_id;

  -- Nada a fazer: inscrição não aprovada, sem cupom, ou já contabilizada.
  IF v_coupon_code IS NULL THEN
    RETURN false;
  END IF;

  -- Incremento atômico do contador de uso do cupom.
  UPDATE coupons
     SET usage_count = COALESCE(usage_count, 0) + 1
   WHERE event_id = v_event_id
     AND upper(code) = upper(v_coupon_code);

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION apply_coupon_usage(TEXT) TO anon, authenticated, service_role;

-- 3. Backfill: corrige os contadores que ficaram zerados por causa do bug.
--    Soma ao usage_count atual as inscrições JÁ aprovadas que ainda não haviam
--    sido contabilizadas. Usa COALESCE(coupon_counted, false) = false para não
--    descartar contagens manuais pré-existentes (ex.: bilheteria) e para ser
--    seguro contra reexecução desta migration.
UPDATE coupons c
   SET usage_count = COALESCE(c.usage_count, 0) + sub.cnt
  FROM (
    SELECT event_id, upper(coupon_code) AS code_upper, COUNT(*) AS cnt
      FROM registrations
     WHERE payment_status = 'payment_approved'
       AND coupon_code IS NOT NULL
       AND btrim(coupon_code) <> ''
       AND COALESCE(coupon_counted, false) = false
     GROUP BY event_id, upper(coupon_code)
  ) sub
 WHERE c.event_id = sub.event_id
   AND upper(c.code) = sub.code_upper;

-- 4. Marca todas as inscrições aprovadas com cupom como contabilizadas, para que
--    não sejam contadas novamente pelos fluxos server-side daqui em diante.
UPDATE registrations
   SET coupon_counted = true
 WHERE payment_status = 'payment_approved'
   AND coupon_code IS NOT NULL
   AND btrim(coupon_code) <> ''
   AND COALESCE(coupon_counted, false) = false;
