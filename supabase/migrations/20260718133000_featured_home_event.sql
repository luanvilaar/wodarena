-- Adiciona destaque configuravel para o banner principal da home.
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN events.is_featured IS
  'Indica que o evento deve ser priorizado no banner principal da home quando estiver ativo.';

UPDATE events
SET is_featured = FALSE
WHERE is_featured IS NULL;

UPDATE events
SET is_featured = TRUE
WHERE name ILIKE '%Training Camp Fitblock%'
  AND name ILIKE '%HYPULSE CHALLENGE%'
  AND name ILIKE '%JULHO 2026%';

CREATE OR REPLACE FUNCTION public.admin_set_featured_home_event(p_event_id TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_event_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM events
    WHERE id = p_event_id
  ) THEN
    RAISE EXCEPTION 'Evento nao encontrado para destaque da home.';
  END IF;

  UPDATE events
  SET is_featured = FALSE
  WHERE is_featured IS DISTINCT FROM FALSE;

  IF p_event_id IS NOT NULL THEN
    UPDATE events
    SET is_featured = TRUE
    WHERE id = p_event_id;
  END IF;
END;
$$;
