-- Atualizar a função da trigger de sincronização para suportar INSERT, UPDATE e DELETE
CREATE OR REPLACE FUNCTION sync_leaderboard_entry()
RETURNS TRIGGER AS $$
BEGIN
  -- 1. DELETE
  IF (TG_OP = 'DELETE') THEN
    DELETE FROM leaderboard_entries
    WHERE athlete_id = OLD.athlete_id
      AND event_id = OLD.event_id
      AND division_id = OLD.division_id;
    RETURN OLD;
  END IF;

  -- 2. INSERT ou UPDATE (Pagamento Aprovado)
  IF (TG_OP = 'INSERT' AND NEW.payment_status = 'payment_approved')
     OR (TG_OP = 'UPDATE' AND NEW.payment_status = 'payment_approved' AND (OLD.payment_status IS NULL OR OLD.payment_status != 'payment_approved'))
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
    INNER JOIN registrations r ON r.athlete_id = a.id
    WHERE a.id = NEW.athlete_id
      AND r.id = NEW.id

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

  -- 3. UPDATE (Cancelado/Falhou)
  IF TG_OP = 'UPDATE'
     AND NEW.payment_status IN ('payment_cancelled', 'payment_failed')
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

-- Recriar trigger ouvindo INSERT, UPDATE e DELETE
DROP TRIGGER IF EXISTS trg_sync_leaderboard_on_payment_change ON registrations;
CREATE TRIGGER trg_sync_leaderboard_on_payment_change
AFTER INSERT OR UPDATE OR DELETE ON registrations
FOR EACH ROW
EXECUTE FUNCTION sync_leaderboard_entry();
