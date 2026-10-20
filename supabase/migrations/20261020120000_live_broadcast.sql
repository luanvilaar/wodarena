-- Telão ao vivo (Stories 1.53 a 1.58): leaderboard de transmissão no local do
-- evento, alimentado pela súmula digital.
--
--   1. event_broadcasts: uma linha por evento (uma bateria roda por vez). Guarda
--      o hash do link secreto do telão (o link só aparece ao gerar), o modo
--      (automático, bateria fixada, geral fixado ou tela de espera) e quem
--      mudou por último.
--   2. broadcast_heat_states: largada e encerramento marcados pelo gestor para
--      cada grupo de súmulas (heat_id = id do item de bateria do cronograma ou a
--      chave do grupo sem bateria). O telão detecta sozinho quem está sendo
--      julgado; a largada só acerta o relógio e o encerrar força o intervalo.
--   3. scoresheets.live_progress: resumo do progresso da súmula, calculado pelo
--      servidor a cada lote gravado (nunca vem do aparelho). O telão lê uma linha
--      por raia em vez de reprocessar o log inteiro a cada segundo.
--
-- RLS e grants: tabelas novas com RLS ligada, sem policy e sem acesso para
-- anon/authenticated, como scoresheets. A aplicação lê e grava por service_role.
--
-- Idempotente: CREATE TABLE/INDEX IF NOT EXISTS e ADD COLUMN IF NOT EXISTS.
-- Nenhuma migration anterior é alterada e nenhum dado existente muda
-- (live_progress nasce NULL; o telão calcula do log quando ainda está vazio).
--
-- Ordem de deploy: depois de 20261017120000_scoresheets.sql. Sem esta migration,
-- a súmula segue funcionando (o servidor ignora a coluna ausente) e o telão e a
-- aba "Telão" respondem que a migration está pendente.
--
-- Rollback (apaga links e marcações do telão):
--   ALTER TABLE public.scoresheets DROP COLUMN IF EXISTS live_progress;
--   DROP TABLE IF EXISTS public.broadcast_heat_states;
--   DROP TABLE IF EXISTS public.event_broadcasts;

-- 1. Configuração do telão por evento
CREATE TABLE IF NOT EXISTS public.event_broadcasts (
  event_id TEXT PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  token_hash TEXT,
  token_created_at TIMESTAMPTZ,
  token_revoked_at TIMESTAMPTZ,
  mode TEXT NOT NULL DEFAULT 'auto'
    CHECK (mode IN ('auto', 'pin_heat', 'pin_standings', 'standby')),
  pinned_heat_id TEXT CHECK (pinned_heat_id IS NULL OR length(pinned_heat_id) <= 200),
  pinned_division_id TEXT REFERENCES public.divisions(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS event_broadcasts_token_hash_key
  ON public.event_broadcasts (token_hash) WHERE token_hash IS NOT NULL;

COMMENT ON TABLE public.event_broadcasts IS
  'Telão ao vivo (Stories 1.53 a 1.58): link secreto (só o SHA-256 do token) e modo de exibição por evento.';

-- 2. Largada e encerramento marcados pelo gestor
CREATE TABLE IF NOT EXISTS public.broadcast_heat_states (
  event_id TEXT NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  heat_id TEXT NOT NULL CHECK (length(heat_id) BETWEEN 1 AND 200),
  started_at TIMESTAMPTZ,
  started_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  finished_at TIMESTAMPTZ,
  finished_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, heat_id)
);

COMMENT ON TABLE public.broadcast_heat_states IS
  'Telão ao vivo: largada (relógio do telão) e encerramento (força o intervalo) de cada grupo de súmulas, marcados pelo gestor.';

-- 3. Progresso ao vivo da súmula
ALTER TABLE public.scoresheets ADD COLUMN IF NOT EXISTS live_progress JSONB;

COMMENT ON COLUMN public.scoresheets.live_progress IS
  'Resumo do log calculado pelo servidor a cada lote (src/lib/liveProgress.ts): repetições, rounds, segmento atual, fim, último registro, carga e início estimado do relógio da súmula. Só o telão lê.';

-- 4. RLS: só o servidor (service_role) lê e grava
ALTER TABLE public.event_broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcast_heat_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.event_broadcasts, public.broadcast_heat_states FROM PUBLIC, anon, authenticated;
