-- Criação de Tabela Desnormalizada para Leaderboard Público
-- Propósito: Cache de dados públicos com sincronização automática
-- Segurança: RLS policy permite leitura pública
-- Performance: Otimizada para leitura com índices apropriados

-- 1. Criar tabela leaderboard_entries
CREATE TABLE IF NOT EXISTS leaderboard_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id TEXT NOT NULL,
  division_id TEXT NOT NULL,
  athlete_id TEXT NOT NULL,
  athlete_name TEXT NOT NULL,
  box_name TEXT NOT NULL,
  instagram TEXT,
  country TEXT DEFAULT 'BR',
  gender TEXT,
  birth_date TEXT,
  is_team BOOLEAN DEFAULT FALSE,
  team_members JSONB DEFAULT '[]'::JSONB,
  payment_approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints
  UNIQUE(event_id, division_id, athlete_id),

  -- Foreign Keys (referência apenas, sem enforcement para flexibilidade)
  CONSTRAINT fk_event_id FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_division_id FOREIGN KEY (division_id) REFERENCES divisions(id) ON DELETE CASCADE
);

-- 2. Criar índices para performance
CREATE INDEX IF NOT EXISTS idx_leaderboard_event_division
ON leaderboard_entries(event_id, division_id);

CREATE INDEX IF NOT EXISTS idx_leaderboard_payment_approved
ON leaderboard_entries(payment_approved_at DESC)
WHERE payment_approved_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leaderboard_athlete_id
ON leaderboard_entries(athlete_id);

-- 3. Habilitar RLS (Row Level Security)
ALTER TABLE leaderboard_entries ENABLE ROW LEVEL SECURITY;

-- 4. Criar policy: Permitir leitura pública
CREATE POLICY "Public read leaderboard entries"
ON leaderboard_entries FOR SELECT
USING (true);

-- 5. Criar função de sincronização
CREATE OR REPLACE FUNCTION sync_leaderboard_entry()
RETURNS TRIGGER AS $$
BEGIN
  -- Sincronizar apenas quando status muda para 'payment_approved'
  -- E o status anterior não era 'payment_approved'
  IF NEW.payment_status = 'payment_approved'
     AND (OLD.payment_status IS NULL OR OLD.payment_status != 'payment_approved')
  THEN
    INSERT INTO leaderboard_entries (
      event_id, division_id, athlete_id, athlete_name, box_name,
      instagram, country, gender, birth_date, is_team, team_members,
      payment_approved_at
    )
    SELECT
      r.event_id,
      r.division_id,
      a.id,
      a.name,
      a.box,
      a.instagram,
      a.country,
      a.gender,
      a.birth_date,
      a.is_team,
      a.team_members,
      NEW.updated_at
    FROM athletes a
    WHERE a.id = NEW.athlete_id

    ON CONFLICT (event_id, division_id, athlete_id)
    DO UPDATE SET
      athlete_name = EXCLUDED.athlete_name,
      box_name = EXCLUDED.box_name,
      instagram = EXCLUDED.instagram,
      country = EXCLUDED.country,
      gender = EXCLUDED.gender,
      birth_date = EXCLUDED.birth_date,
      is_team = EXCLUDED.is_team,
      team_members = EXCLUDED.team_members,
      payment_approved_at = NOW(),
      updated_at = NOW();
  END IF;

  -- Deletar entrada se pagamento for cancelado/falhou
  IF NEW.payment_status IN ('payment_cancelled', 'payment_failed')
     AND OLD.payment_status = 'payment_approved'
  THEN
    DELETE FROM leaderboard_entries
    WHERE athlete_id = NEW.athlete_id
      AND event_id = NEW.event_id
      AND division_id = NEW.division_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 6. Criar trigger na tabela registrations
DROP TRIGGER IF EXISTS trg_sync_leaderboard_on_payment_change ON registrations;
CREATE TRIGGER trg_sync_leaderboard_on_payment_change
AFTER UPDATE ON registrations
FOR EACH ROW
EXECUTE FUNCTION sync_leaderboard_entry();

-- 7. Fazer backfill: Popular com registrations já aprovadas
INSERT INTO leaderboard_entries (
  event_id, division_id, athlete_id, athlete_name, box_name,
  instagram, country, gender, birth_date, is_team, team_members,
  payment_approved_at
)
SELECT
  r.event_id,
  r.division_id,
  a.id,
  a.name,
  a.box,
  a.instagram,
  a.country,
  a.gender,
  a.birth_date,
  a.is_team,
  a.team_members,
  r.updated_at
FROM registrations r
INNER JOIN athletes a ON r.athlete_id = a.id
WHERE r.payment_status = 'payment_approved'
  AND NOT EXISTS (
    SELECT 1 FROM leaderboard_entries le
    WHERE le.athlete_id = a.id
      AND le.event_id = r.event_id
      AND le.division_id = r.division_id
  )
ON CONFLICT DO NOTHING;

-- 8. Adicionar coluna is_active para soft-delete (opcional, para Fase 3)
-- ALTER TABLE leaderboard_entries ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- 9. Criar view para facilitar queries (opcional)
-- CREATE OR REPLACE VIEW v_active_leaderboard AS
-- SELECT * FROM leaderboard_entries
-- WHERE is_active = TRUE
-- ORDER BY payment_approved_at DESC;

-- Comentários de documentação
COMMENT ON TABLE leaderboard_entries IS
'Cache desnormalizado de dados públicos do leaderboard.
Sincronizado automaticamente via trigger quando payment_status = payment_approved.
RLS policy permite leitura pública sem autenticação.';

COMMENT ON COLUMN leaderboard_entries.payment_approved_at IS
'Timestamp quando o pagamento foi aprovado. Usado para ordenação e auditoria.';

COMMENT ON FUNCTION sync_leaderboard_entry() IS
'Trigger function que sincroniza leaderboard_entries quando status de pagamento muda.
Insere/atualiza quando aprovado, deleta quando cancelado/falhou.';
