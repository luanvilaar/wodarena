-- Ordenacao manual das categorias (divisions) definida pelo gestor no painel admin.
ALTER TABLE divisions
  ADD COLUMN IF NOT EXISTS order_index INTEGER;

COMMENT ON COLUMN divisions.order_index IS
  'Ordem de exibicao da categoria dentro do evento (1..N), controlada por arrastar e soltar no painel do gestor.';

-- Backfill preservando a ordem fisica atual das linhas, que e exatamente a ordem
-- que os gestores enxergam hoje (selects sem ORDER BY).
WITH ordered_divisions AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY ctid) AS position
  FROM divisions
)
UPDATE divisions
SET order_index = ordered_divisions.position
FROM ordered_divisions
WHERE divisions.id = ordered_divisions.id
  AND divisions.order_index IS NULL;

ALTER TABLE divisions
  ALTER COLUMN order_index SET DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_divisions_event_order
  ON divisions (event_id, order_index);
