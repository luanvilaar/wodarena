-- Súmula Fitness Race, fase F2: escala de judges por estação, para o evento
-- todo e por onda (Story 1.104; D35, D3, D38 em
-- docs/design/fitness-race-sumula/DECISOES.md).
--
-- Até aqui o judge era atribuído só ao evento inteiro (event_judges, funções
-- race_assign_judge e race_remove_judge da Story 1.95, que não mudam). Esta
-- migration cria:
--   1. race_judge_assignments: a escala judge x estação. station_key é a chave
--      da estação entre categorias (raceStationKey, Story 1.102: o nome
--      normalizado). heat_id nulo = padrão do evento; preenchido = ajuste da
--      onda (id do item kind heat do event_schedule, como race_heat_marks).
--      Índice único em (event_id, judge_user_id, station_key,
--      COALESCE(heat_id, '')): o mesmo judge na mesma estação uma vez por
--      escopo (heat_id vazio é recusado pelo CHECK, então '' nunca colide com
--      uma onda). Vários judges por estação e várias estações por judge são
--      permitidos (AUTO-DECISION da story). A escala só orienta (D3): nada no
--      banco impede o judge fora dela de abrir uma estação.
--   2. race_save_judge_assignments: grava o conjunto de um escopo (padrão ou
--      uma onda) numa transação só: apaga do escopo o que saiu, insere o que
--      entrou (o que fica não é regravado, então reenviar o mesmo conjunto não
--      muda nada) e apaga do evento as linhas de judge que já não está em
--      event_judges (Story 1.104, AC2: removidas na próxima gravação). Só
--      entra judge atribuído ao evento (JOIN em event_judges). Gravações do
--      mesmo evento são serializadas por pg_advisory_xact_lock. A validação
--      de negócio (judge do mesmo gestor, estação do percurso, onda do
--      cronograma, até 500 linhas) fica no servidor
--      (src/lib/serverRaceAssignments.ts).
--
-- RLS e grants: a tabela fica com RLS ligada, sem policy e sem acesso para
-- anon/authenticated, como as demais race_*. A função é SECURITY DEFINER com
-- search_path fixo e só executa por service_role (REVOKE de PUBLIC, anon e
-- authenticated).
--
-- Idempotente: CREATE TABLE/INDEX IF NOT EXISTS, com as constraints dentro do
-- CREATE TABLE, e CREATE OR REPLACE FUNCTION; REVOKE e GRANT podem ser
-- repetidos. Reaplicar não falha nem altera dados. Nenhuma migration anterior
-- é alterada, nenhuma tabela existente é tocada e nenhuma função race_* já
-- existente é redefinida.
--
-- Ordem de deploy: aplicar depois de 20261031120000_race_publication.sql
-- (Story 1.99) e antes de publicar o código da Story 1.104. Sem esta
-- migration, a escala (leitura e gravação) responde 503 pedindo a migration;
-- a lista de estações do judge segue como na Story 1.102 e o restante do app
-- não depende dela.
--
-- Rollback (apaga a escala gravada):
--   DROP FUNCTION IF EXISTS public.race_save_judge_assignments(TEXT, TEXT, TEXT, JSONB);
--   DROP TABLE IF EXISTS public.race_judge_assignments;

-- 1. Escala judge x estação (padrão do evento e ajuste por onda)
CREATE TABLE IF NOT EXISTS public.race_judge_assignments (
  id TEXT PRIMARY KEY DEFAULT ('rja_' || gen_random_uuid()::TEXT),
  event_id TEXT NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  judge_user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  station_key TEXT NOT NULL CONSTRAINT race_judge_assignments_station_key_check CHECK (station_key ~ '^[a-z0-9-]{1,120}$'),
  heat_id TEXT CONSTRAINT race_judge_assignments_heat_id_check CHECK (heat_id IS NULL OR length(heat_id) BETWEEN 1 AND 120),
  created_by_user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS race_judge_assignments_scope_key
  ON public.race_judge_assignments (event_id, judge_user_id, station_key, COALESCE(heat_id, ''));
CREATE INDEX IF NOT EXISTS idx_race_judge_assignments_judge_user_id ON public.race_judge_assignments (judge_user_id);
CREATE INDEX IF NOT EXISTS idx_race_judge_assignments_created_by ON public.race_judge_assignments (created_by_user_id);

COMMENT ON TABLE public.race_judge_assignments IS
  'Escala de judges do Fitness Race (Story 1.104, D35): judge x estação (station_key = raceStationKey, nome normalizado). heat_id NULL = padrão do evento; preenchido = ajuste da onda, que substitui o padrão inteiro naquela onda. Só orienta (D3): não impede o judge fora da escala de abrir a estação.';

-- 2. Gravação atômica do conjunto de um escopo
CREATE OR REPLACE FUNCTION public.race_save_judge_assignments(
  p_event_id TEXT,
  p_heat_id TEXT,
  p_actor_id TEXT,
  p_rows JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_removed INTEGER := 0;
  v_stale INTEGER := 0;
  v_inserted INTEGER := 0;
  v_rows JSONB := CASE WHEN jsonb_typeof(p_rows) = 'array' THEN p_rows ELSE '[]'::JSONB END;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM events WHERE id = p_event_id AND event_type = 'fitness_racing') THEN
    RAISE EXCEPTION 'race_event_required';
  END IF;
  IF p_heat_id IS NOT NULL AND (length(p_heat_id) < 1 OR length(p_heat_id) > 120) THEN
    RAISE EXCEPTION 'race_heat_invalid';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('race_judge_assignments:' || p_event_id));

  -- O que saiu do escopo.
  DELETE FROM race_judge_assignments a
  WHERE a.event_id = p_event_id
    AND a.heat_id IS NOT DISTINCT FROM p_heat_id
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_rows) AS r(item)
      WHERE r.item->>'judge_user_id' = a.judge_user_id AND r.item->>'station_key' = a.station_key
    );
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  -- Judge que já não está no evento (Story 1.104, AC2), em qualquer escopo.
  DELETE FROM race_judge_assignments a
  WHERE a.event_id = p_event_id
    AND NOT EXISTS (
      SELECT 1 FROM event_judges ej WHERE ej.event_id = a.event_id AND ej.judge_user_id = a.judge_user_id
    );
  GET DIAGNOSTICS v_stale = ROW_COUNT;

  -- O que entrou (o que já estava fica como está).
  INSERT INTO race_judge_assignments (event_id, judge_user_id, station_key, heat_id, created_by_user_id, created_at)
  SELECT DISTINCT p_event_id, r.item->>'judge_user_id', r.item->>'station_key', p_heat_id, p_actor_id, NOW()
  FROM jsonb_array_elements(v_rows) AS r(item)
  JOIN event_judges ej ON ej.event_id = p_event_id AND ej.judge_user_id = r.item->>'judge_user_id'
  WHERE coalesce(r.item->>'station_key', '') <> ''
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN jsonb_build_object('removed', v_removed, 'stale_removed', v_stale, 'inserted', v_inserted);
END;
$$;

-- 3. RLS: só o servidor (service_role) lê e grava
ALTER TABLE public.race_judge_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.race_judge_assignments FROM PUBLIC, anon, authenticated;

-- 4. Grants: só o servidor (service_role) executa a gravação
REVOKE ALL ON FUNCTION public.race_save_judge_assignments(TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.race_save_judge_assignments(TEXT, TEXT, TEXT, JSONB) TO service_role;
