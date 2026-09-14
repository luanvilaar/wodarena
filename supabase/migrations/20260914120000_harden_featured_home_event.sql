-- Fecha a superficie publica da RPC editorial: somente a API do servidor,
-- autenticada com service_role, pode alterar o destaque da home.
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
      AND status IN ('live', 'upcoming')
  ) THEN
    RAISE EXCEPTION 'Evento ativo nao encontrado para destaque da home.';
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

REVOKE ALL ON FUNCTION public.admin_set_featured_home_event(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_featured_home_event(TEXT) TO service_role;
