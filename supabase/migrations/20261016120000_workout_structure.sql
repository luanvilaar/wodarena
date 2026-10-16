-- Estrutura da prova para a súmula digital (Story 1.43, etapa E1a).
--
-- Até aqui a prova era texto livre (workouts.description) mais os campos
-- legados type, time_cap e tie_breaker. A prova passa a poder ter uma
-- estrutura explícita (segmentos com movimento, repetições e carga, time cap,
-- penalidade e desempate), que o motor de cálculo da súmula entende. A
-- estrutura é opcional: provas existentes ficam NULL e funcionam como hoje.
--
-- Mudanças (aditivas; sem backfill e sem mudar o comportamento das provas
-- existentes):
--   1. workouts.structure (JSONB, nullable, sem default).
--   2. workouts_structure_is_object: a coluna é NULL ou um objeto JSON. O
--      literal JSON null, listas, textos e números são recusados (o servidor
--      grava SQL NULL para "sem estrutura").
--
-- O contrato (versão 1) é validado no servidor antes de gravar
-- (validateWorkoutStructure em src/lib/workoutStructure.ts, usado por
-- /api/admin/persistence); o CHECK é a última barreira. Os campos legados
-- type, time_cap e tie_breaker continuam preenchidos a partir da estrutura.
--
-- RLS e grants: workouts segue com RLS ligada e sem policy de leitura para
-- anon/authenticated (20260621153000_api_surface_hardening.sql); não há GRANT
-- por coluna nem view sobre a tabela. A aplicação lê e grava por service_role,
-- e a coluna não entra no bootstrap público (PUBLIC_WORKOUT_SELECT).
--
-- Idempotente: ADD COLUMN IF NOT EXISTS e o CHECK nomeado só é criado se ainda
-- não existir. Reaplicar não falha nem altera dados.
--
-- Ordem de deploy: aplicar antes de publicar o código da Story 1.43, depois de
-- 20261015120000_event_map_coordinates.sql (ordem de nome). Se o PostgREST não
-- recarregar o schema sozinho: NOTIFY pgrst, 'reload schema';
--
-- Rollback (em nova migration, depois de voltar o código; perde as estruturas
-- gravadas, e as provas voltam ao modo legado com type, time_cap e tie_breaker):
--   * ALTER TABLE workouts DROP CONSTRAINT IF EXISTS workouts_structure_is_object;
--   * ALTER TABLE workouts DROP COLUMN IF EXISTS structure;

-- ---------------------------------------------------------------------------
-- 1. Coluna
-- ---------------------------------------------------------------------------

-- Sem default: no Postgres 11+ o ADD COLUMN nullable não reescreve a tabela e
-- as provas existentes passam a ler NULL ("sem estrutura").
ALTER TABLE public.workouts
  ADD COLUMN IF NOT EXISTS structure JSONB;

-- ---------------------------------------------------------------------------
-- 2. CHECK com nome fixo
-- ---------------------------------------------------------------------------

-- Fora do ADD COLUMN para não depender dele: se a coluna já existir, o CHECK
-- inline seria pulado junto. Só é criado quando ainda não existe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.workouts'::regclass AND conname = 'workouts_structure_is_object'
  ) THEN
    ALTER TABLE public.workouts ADD CONSTRAINT workouts_structure_is_object
      CHECK (structure IS NULL OR jsonb_typeof(structure) = 'object');
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Documentação da coluna
-- ---------------------------------------------------------------------------

COMMENT ON COLUMN public.workouts.structure IS
  'Estrutura da prova para a súmula digital, contrato versão 1 (Story 1.43): objeto com version, format (for_time ou amrap), totalReps, timeCapSeconds, incomplete, tieBreak, generator, customized, entry e a lista explícita de segments (id, round, name, reps, load, note, required, mark). NULL = prova sem estrutura (modo legado, só description, type, time_cap e tie_breaker). Gravada só pelo servidor, já validada e normalizada; type, time_cap e tie_breaker são derivados dela.';
