-- Súmula Fitness Race, fase F1: banco da corrida (Story 1.94; base das
-- Stories 1.95 a 1.99).
--
-- Até aqui o Fitness Race só tinha o lançamento manual de tempo no painel. Esta
-- migration cria o armazenamento da súmula de corrida, em tabelas próprias
-- (a súmula de Functional Fitness, scoresheets e scoresheet_events, não muda):
--   1. race_rulesets: o regulamento do evento, versionado (UNIQUE event_id +
--      version), com o snapshot do percurso de cada categoria (course). O
--      snapshot é o que vale para a corrida (D6); mudar o regulamento depois
--      do primeiro uso cria versão nova e as corridas mantêm a delas.
--   2. race_runs: a corrida do atleta no evento (uma ativa por atleta e
--      evento, índice único parcial que ignora as canceladas), com a onda, o
--      regulamento usado, largada, fim, tempo bruto, penalidades, tempo
--      oficial e a origem do tempo (sheet ou manual; sem chip, D8).
--   3. race_attempts: a tentativa do atleta numa estação (uma ativa por
--      corrida e estação), com um árbitro escrevendo por vez, o estado e o
--      progresso calculados pelo servidor.
--   4. race_attempt_events: o log da tentativa, só de inclusão, com sequência
--      contígua (chave primária attempt_id + seq) e id único do aparelho
--      (reenvio não duplica), o horário do aparelho e o desvio para o relógio
--      do servidor de cada evento.
--   5. race_infractions: advertências, penalidades, REFAZER e propostas de DQ,
--      calculadas pelo motor (src/lib/raceRules.ts) ou lançadas pelo
--      organizador. UNIQUE run_id + source_key: o recálculo casa pela chave e
--      nunca recria nem desfaz a decisão do organizador.
--   6. race_decisions: trilha de auditoria das decisões do organizador (gestor
--      dono ou owner), com antes e depois.
--   7. race_heat_marks: a largada oficial de cada onda (uma por evento e onda).
--
-- O cálculo (motor de regras), o recálculo das infrações e a gravação ficam no
-- servidor (src/lib/serverRaceSheets.ts, rota /api/race-sheets).
--
-- RLS e grants: as sete tabelas ficam com RLS ligada, sem policy e sem acesso
-- para anon/authenticated, como scoresheets e event_judges. A aplicação lê e
-- grava só por service_role.
--
-- Idempotente: CREATE TABLE/INDEX IF NOT EXISTS, com as constraints dentro do
-- CREATE TABLE (não há ALTER TABLE ... ADD CONSTRAINT solto). Reaplicar não
-- falha nem altera dados. Nenhuma migration anterior é alterada e nenhuma
-- tabela existente é tocada.
-- Os CHECKs que devem crescer nas próximas fases (estados, tipos, origem,
-- papel e ação) têm nome fixo (race_<tabela>_<coluna>_check), para a migration
-- que os ampliar fazer DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT pelo nome.
--
-- Ordem de deploy: aplicar depois de 20261028120000_service_fee_payer.sql e
-- antes de publicar o código da Story 1.94. Sem esta migration, a rota
-- /api/race-sheets responde 503 pedindo a migration; o restante do app
-- (inclusive a súmula de Functional Fitness) não depende dela.
--
-- Rollback (só se nada foi gravado, porque apaga as corridas e o log):
--   DROP TABLE IF EXISTS public.race_decisions;
--   DROP TABLE IF EXISTS public.race_infractions;
--   DROP TABLE IF EXISTS public.race_attempt_events;
--   DROP TABLE IF EXISTS public.race_attempts;
--   DROP TABLE IF EXISTS public.race_runs;
--   DROP TABLE IF EXISTS public.race_rulesets;
--   DROP TABLE IF EXISTS public.race_heat_marks;

-- 1. Regulamento do evento (versionado) e snapshot do percurso
CREATE TABLE IF NOT EXISTS public.race_rulesets (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  preset TEXT NOT NULL CONSTRAINT race_rulesets_preset_check CHECK (preset IN ('2025_26', '2026_27', 'custom')),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  rules JSONB NOT NULL CHECK (jsonb_typeof(rules) = 'object'),
  course JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(course) = 'object'),
  locked_at TIMESTAMPTZ,
  created_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, version)
);

COMMENT ON TABLE public.race_rulesets IS
  'Regulamento Fitness Race do evento (Story 1.94): a versão vigente é a maior. rules é o RaceRuleset (src/lib/raceRules.ts); course é o snapshot do percurso por categoria ({ divisionId: estações }), que vale para a corrida (D6). locked_at marca o primeiro uso; depois dele, mudar cria versão nova.';

-- 2. Corrida do atleta
CREATE TABLE IF NOT EXISTS public.race_runs (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  division_id TEXT REFERENCES public.divisions(id) ON DELETE SET NULL,
  athlete_id TEXT NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  heat_id TEXT CHECK (heat_id IS NULL OR length(heat_id) BETWEEN 1 AND 120),
  ruleset_id TEXT NOT NULL REFERENCES public.race_rulesets(id),
  status TEXT NOT NULL DEFAULT 'racing'
    CONSTRAINT race_runs_status_check CHECK (status IN ('racing', 'finished', 'dnf', 'disqualified', 'cancelled')),
  started_at TIMESTAMPTZ,
  finish_at TIMESTAMPTZ,
  gross_seconds NUMERIC CHECK (gross_seconds IS NULL OR gross_seconds >= 0),
  penalty_seconds NUMERIC NOT NULL DEFAULT 0 CHECK (penalty_seconds >= 0),
  official_seconds NUMERIC CHECK (official_seconds IS NULL OR official_seconds >= 0),
  time_source TEXT CONSTRAINT race_runs_time_source_check CHECK (time_source IS NULL OR time_source IN ('sheet', 'manual')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS race_runs_one_active_per_athlete
  ON public.race_runs (event_id, athlete_id) WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS idx_race_runs_event_heat ON public.race_runs (event_id, heat_id);
CREATE INDEX IF NOT EXISTS idx_race_runs_ruleset_id ON public.race_runs (ruleset_id);
CREATE INDEX IF NOT EXISTS idx_race_runs_athlete_id ON public.race_runs (athlete_id);

COMMENT ON TABLE public.race_runs IS
  'Corrida Fitness Race do atleta (Story 1.94): uma ativa por atleta e evento (as canceladas não contam). ruleset_id é o regulamento e o snapshot do percurso usados. time_source: sheet (largada da onda até a liberação do último Wall Ball, D1) ou manual; não há chip (D8).';

-- 3. Tentativa do atleta numa estação
CREATE TABLE IF NOT EXISTS public.race_attempts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES public.race_runs(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  athlete_id TEXT NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  station_id TEXT NOT NULL CHECK (length(station_id) BETWEEN 1 AND 120),
  station_kind TEXT NOT NULL
    CONSTRAINT race_attempts_station_kind_check CHECK (station_kind IN ('ergometer', 'sled', 'sections', 'wall_ball', 'generic')),
  lane INTEGER CHECK (lane IS NULL OR lane > 0),
  judge_user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  judge_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'waiting'
    CONSTRAINT race_attempts_status_check CHECK (status IN ('waiting', 'running', 'done_pending_release', 'released', 'exited_incomplete', 'redo', 'cancelled')),
  progress JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(progress) = 'object'),
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS race_attempts_one_active_per_station
  ON public.race_attempts (run_id, station_id) WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS idx_race_attempts_run_id ON public.race_attempts (run_id);
CREATE INDEX IF NOT EXISTS idx_race_attempts_event_id ON public.race_attempts (event_id);
CREATE INDEX IF NOT EXISTS idx_race_attempts_athlete_id ON public.race_attempts (athlete_id);
CREATE INDEX IF NOT EXISTS idx_race_attempts_judge_user_id ON public.race_attempts (judge_user_id);

COMMENT ON TABLE public.race_attempts IS
  'Tentativa do atleta numa estação (Story 1.94): uma ativa por corrida e estação, com um árbitro escrevendo por vez (judge_user_id nulo = sem árbitro, pode ser assumida). status e progress são recalculados pelo servidor a cada lote.';

-- 4. Log da tentativa (append-only)
CREATE TABLE IF NOT EXISTS public.race_attempt_events (
  attempt_id TEXT NOT NULL REFERENCES public.race_attempts(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL CHECK (seq >= 0),
  client_event_id TEXT NOT NULL CHECK (length(client_event_id) BETWEEN 1 AND 64),
  event JSONB NOT NULL CHECK (jsonb_typeof(event) = 'object'),
  author_user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  device_at TIMESTAMPTZ,
  clock_offset_ms BIGINT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (attempt_id, seq),
  UNIQUE (attempt_id, client_event_id)
);

COMMENT ON TABLE public.race_attempt_events IS
  'Log da tentativa (Story 1.94): eventos do motor (start, rep, norep, infraction, undo, release, ...), na ordem (seq contígua a partir de 0). client_event_id vem do aparelho e torna o reenvio idempotente. device_at é o horário do aparelho e clock_offset_ms o desvio para o servidor no lote. Nada é apagado: desfazer é um evento novo.';

-- 5. Infrações
CREATE TABLE IF NOT EXISTS public.race_infractions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES public.race_runs(id) ON DELETE CASCADE,
  attempt_id TEXT REFERENCES public.race_attempts(id) ON DELETE SET NULL,
  station_id TEXT,
  source_key TEXT NOT NULL CHECK (length(source_key) BETWEEN 1 AND 300),
  source_seq INTEGER CHECK (source_seq IS NULL OR source_seq >= 0),
  code TEXT NOT NULL CHECK (length(code) BETWEEN 1 AND 80),
  label TEXT NOT NULL DEFAULT '' CONSTRAINT race_infractions_label_length CHECK (char_length(label) <= 200),
  kind TEXT NOT NULL CONSTRAINT race_infractions_kind_check CHECK (kind IN ('warning', 'penalty', 'redo', 'dq_proposal')),
  seconds NUMERIC NOT NULL DEFAULT 0 CHECK (seconds >= 0),
  status TEXT NOT NULL
    CONSTRAINT race_infractions_status_check CHECK (status IN ('pending', 'confirmed', 'revoked', 'cancelled', 'rejected')),
  origin TEXT NOT NULL DEFAULT 'engine' CONSTRAINT race_infractions_origin_check CHECK (origin IN ('engine', 'judge', 'manager')),
  general BOOLEAN NOT NULL DEFAULT FALSE,
  units INTEGER CHECK (units IS NULL OR units >= 0),
  resolution TEXT CHECK (resolution IS NULL OR resolution IN ('redone', 'declined')),
  note TEXT CONSTRAINT race_infractions_note_length CHECK (note IS NULL OR char_length(note) <= 1000),
  created_by_user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_by_name TEXT,
  decided_by_user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  decided_by_name TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, source_key)
);
CREATE INDEX IF NOT EXISTS idx_race_infractions_attempt_id ON public.race_infractions (attempt_id);

COMMENT ON TABLE public.race_infractions IS
  'Infrações da corrida (Story 1.94): a calculada pelo motor nasce confirmed (D2); REFAZER e proposta de DQ nascem pending. source_key casa o recálculo com a linha existente. decided_at preenchido = decisão do organizador (revogar, alterar, rejeitar): o recálculo não mexe mais na linha.';

-- 6. Decisões do organizador (auditoria)
CREATE TABLE IF NOT EXISTS public.race_decisions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES public.race_runs(id) ON DELETE SET NULL,
  heat_id TEXT,
  infraction_id TEXT REFERENCES public.race_infractions(id) ON DELETE SET NULL,
  action TEXT NOT NULL CONSTRAINT race_decisions_action_check CHECK (action ~ '^[a-z][a-z_]{0,59}$'),
  actor_user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL,
  -- judge e system ficam previstos para ações que não são do organizador (ex.: proposta do árbitro, ajuste automático).
  actor_role TEXT NOT NULL CONSTRAINT race_decisions_actor_role_check CHECK (actor_role IN ('judge', 'manager', 'owner', 'system')),
  reason TEXT CONSTRAINT race_decisions_reason_length CHECK (reason IS NULL OR char_length(reason) <= 1000),
  before JSONB CONSTRAINT race_decisions_before_check CHECK (before IS NULL OR jsonb_typeof(before) = 'object'),
  after JSONB CONSTRAINT race_decisions_after_check CHECK (after IS NULL OR jsonb_typeof(after) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_race_decisions_event_id ON public.race_decisions (event_id);
CREATE INDEX IF NOT EXISTS idx_race_decisions_run_id ON public.race_decisions (run_id);

COMMENT ON TABLE public.race_decisions IS
  'Trilha das decisões do Fitness Race (Story 1.94; ações da 1.98 em diante): decidir é do gestor dono ou do owner, conferido no servidor; actor_role também aceita judge e system para registros que não são decisão do organizador. before e after guardam os valores de antes e depois (objeto JSON).';

-- 7. Largada oficial da onda
CREATE TABLE IF NOT EXISTS public.race_heat_marks (
  event_id TEXT NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  heat_id TEXT NOT NULL CHECK (length(heat_id) BETWEEN 1 AND 120),
  started_at TIMESTAMPTZ NOT NULL,
  started_by_user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  started_by_name TEXT,
  device_at TIMESTAMPTZ,
  clock_offset_ms BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, heat_id)
);

COMMENT ON TABLE public.race_heat_marks IS
  'Largada oficial de cada onda do Fitness Race (Story 1.94; gravada pela 1.96): uma por evento e onda (item kind heat do event_schedule). É o início do tempo bruto (D1).';

-- 8. RLS: só o servidor (service_role) lê e grava
ALTER TABLE public.race_rulesets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.race_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.race_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.race_attempt_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.race_infractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.race_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.race_heat_marks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE
  public.race_rulesets,
  public.race_runs,
  public.race_attempts,
  public.race_attempt_events,
  public.race_infractions,
  public.race_decisions,
  public.race_heat_marks
FROM PUBLIC, anon, authenticated;
