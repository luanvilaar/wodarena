-- Coordenadas do local do evento para o mapa da página pública (Story 1.41).
--
-- Até aqui o local do evento era só texto livre (events.location, com city e
-- state opcionais). O gestor passa a poder informar o ponto exato no painel
-- (colando as coordenadas ou escolhendo um resultado da busca por endereço), e
-- a página pública mostra o mapa do Waze e os botões de "Como chegar".
--
-- Mudanças (aditivas; eventos existentes ficam sem ponto, sem backfill e sem
-- mudar de comportamento):
--   1. events.latitude e events.longitude (NUMERIC, nullable, sem default).
--   2. events_coordinates_range_check: latitude entre -90 e 90 e longitude
--      entre -180 e 180, aceitando NULL.
--   3. events_coordinates_both_or_none: as duas preenchidas ou as duas NULL.
--
-- A validação de entrada fica também no servidor (validateEventCoordinates em
-- src/lib/eventMap.ts, usado por /api/admin/persistence); os CHECKs são a
-- última barreira.
--
-- RLS e grants: events segue com RLS ligada e sem policy de leitura para
-- anon/authenticated (20260608120000 e 20260621153000); não há GRANT por
-- coluna nem view sobre a tabela. A aplicação lê e grava por service_role, e o
-- bootstrap público expõe as colunas pelo PUBLIC_EVENT_SELECT.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS e cada CHECK nomeado só é criado se
-- ainda não existir. Reaplicar não falha nem altera dados.
--
-- Ordem de deploy: aplicar antes de publicar o código da Story 1.41, depois de
-- 20261013120000_event_optional_shirt.sql e 20261014120000_protect_paid_registrations.sql
-- (ordem de nome). Se o PostgREST não recarregar o schema sozinho:
-- NOTIFY pgrst, 'reload schema';
--
-- Rollback (em nova migration, depois de voltar o código; perde os pontos
-- informados pelos gestores):
--   * ALTER TABLE events DROP CONSTRAINT IF EXISTS events_coordinates_both_or_none;
--   * ALTER TABLE events DROP CONSTRAINT IF EXISTS events_coordinates_range_check;
--   * ALTER TABLE events DROP COLUMN IF EXISTS longitude, DROP COLUMN IF EXISTS latitude;

-- ---------------------------------------------------------------------------
-- 1. Colunas
-- ---------------------------------------------------------------------------

-- Sem default: no Postgres 11+ o ADD COLUMN nullable não reescreve a tabela e
-- as linhas existentes passam a ler NULL ("sem ponto").
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS latitude NUMERIC,
  ADD COLUMN IF NOT EXISTS longitude NUMERIC;

-- ---------------------------------------------------------------------------
-- 2. CHECKs com nome fixo
-- ---------------------------------------------------------------------------

-- Fora do ADD COLUMN para não depender dele: se a coluna já existir, o CHECK
-- inline seria pulado junto. Cada um só é criado quando ainda não existe.
DO $$
BEGIN
  -- NUMERIC aceita 'NaN' e 'Infinity'; os dois ficam fora da faixa e são recusados.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.events'::regclass AND conname = 'events_coordinates_range_check'
  ) THEN
    ALTER TABLE public.events ADD CONSTRAINT events_coordinates_range_check
      CHECK (
        (latitude IS NULL OR latitude BETWEEN -90 AND 90)
        AND (longitude IS NULL OR longitude BETWEEN -180 AND 180)
      );
  END IF;

  -- Meio ponto não tem uso: o mapa e os links precisam das duas coordenadas.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.events'::regclass AND conname = 'events_coordinates_both_or_none'
  ) THEN
    ALTER TABLE public.events ADD CONSTRAINT events_coordinates_both_or_none
      CHECK (
        (latitude IS NULL AND longitude IS NULL)
        OR (latitude IS NOT NULL AND longitude IS NOT NULL)
      );
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Documentação das colunas
-- ---------------------------------------------------------------------------

COMMENT ON COLUMN public.events.latitude IS
  'Latitude do local do evento em graus decimais (WGS 84), de -90 a 90. NULL junto com longitude = evento sem ponto no mapa (só links por texto). Informada pelo gestor no painel e exibida publicamente no mapa do Waze da página do evento.';

COMMENT ON COLUMN public.events.longitude IS
  'Longitude do local do evento em graus decimais (WGS 84), de -180 a 180. Preenchida junto com latitude (events_coordinates_both_or_none); NULL nas duas remove o ponto.';
