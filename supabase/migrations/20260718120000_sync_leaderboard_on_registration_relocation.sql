-- Sincroniza relocacao de categoria em inscricoes aprovadas com o leaderboard.
-- A migration e idempotente e tambem reconcilia entradas historicas divergentes.

CREATE OR REPLACE FUNCTION upsert_leaderboard_entry_for_registration(p_registration_id TEXT)
RETURNS leaderboard_entries AS $$
DECLARE
  v_entry leaderboard_entries%ROWTYPE;
BEGIN
  INSERT INTO leaderboard_entries (
    event_id,
    division_id,
    athlete_id,
    athlete_name,
    box_name,
    instagram,
    country,
    gender,
    birth_date,
    is_team,
    team_members,
    payment_approved_at
  )
  SELECT
    r.event_id,
    r.division_id,
    a.id,
    a.name,
    a.box,
    a.instagram,
    COALESCE(a.country, 'BR'),
    a.gender,
    a.birth_date,
    COALESCE(a.is_team, FALSE),
    COALESCE(a.team_members, '[]'::JSONB),
    COALESCE(r.updated_at, r.created_at, NOW())
  FROM registrations r
  INNER JOIN athletes a ON a.id = r.athlete_id
  WHERE r.id = p_registration_id
    AND r.payment_status = 'payment_approved'
    AND r.athlete_id IS NOT NULL
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
    payment_approved_at = COALESCE(leaderboard_entries.payment_approved_at, EXCLUDED.payment_approved_at),
    updated_at = NOW()
  RETURNING *
  INTO v_entry;

  RETURN v_entry;
END;
$$ LANGUAGE plpgsql
SET search_path = public;

CREATE OR REPLACE FUNCTION sync_leaderboard_entry()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.payment_status = 'payment_approved' AND OLD.athlete_id IS NOT NULL THEN
      DELETE FROM leaderboard_entries
      WHERE athlete_id = OLD.athlete_id
        AND event_id = OLD.event_id
        AND division_id = OLD.division_id;
    END IF;

    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.payment_status = 'payment_approved'
     AND OLD.athlete_id IS NOT NULL
     AND (
       NEW.payment_status IS DISTINCT FROM 'payment_approved'
       OR NEW.event_id IS DISTINCT FROM OLD.event_id
       OR NEW.division_id IS DISTINCT FROM OLD.division_id
       OR NEW.athlete_id IS DISTINCT FROM OLD.athlete_id
     )
  THEN
    DELETE FROM leaderboard_entries
    WHERE athlete_id = OLD.athlete_id
      AND event_id = OLD.event_id
      AND division_id = OLD.division_id;
  END IF;

  IF NEW.payment_status = 'payment_approved' AND NEW.athlete_id IS NOT NULL THEN
    PERFORM upsert_leaderboard_entry_for_registration(NEW.id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public;

CREATE OR REPLACE FUNCTION sync_leaderboard_entries_for_athlete()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE leaderboard_entries
  SET athlete_name = NEW.name,
      box_name = NEW.box,
      instagram = NEW.instagram,
      country = COALESCE(NEW.country, 'BR'),
      gender = NEW.gender,
      birth_date = NEW.birth_date,
      is_team = COALESCE(NEW.is_team, FALSE),
      team_members = COALESCE(NEW.team_members, '[]'::JSONB),
      updated_at = NOW()
  WHERE athlete_id = NEW.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public;

DROP TRIGGER IF EXISTS trg_sync_leaderboard_on_payment_change ON registrations;
CREATE TRIGGER trg_sync_leaderboard_on_payment_change
AFTER INSERT OR UPDATE OR DELETE ON registrations
FOR EACH ROW
EXECUTE FUNCTION sync_leaderboard_entry();

DROP TRIGGER IF EXISTS trg_sync_leaderboard_on_athlete_profile_change ON athletes;
CREATE TRIGGER trg_sync_leaderboard_on_athlete_profile_change
AFTER UPDATE OF name, box, instagram, country, gender, birth_date, is_team, team_members ON athletes
FOR EACH ROW
EXECUTE FUNCTION sync_leaderboard_entries_for_athlete();

CREATE OR REPLACE FUNCTION admin_update_registration_details(
  p_registration_id TEXT,
  p_event_id TEXT,
  p_division_id TEXT,
  p_athlete_name TEXT,
  p_box TEXT,
  p_athlete_email TEXT,
  p_athlete_phone TEXT,
  p_gender TEXT,
  p_instagram TEXT,
  p_shirt_size TEXT,
  p_is_team BOOLEAN DEFAULT NULL,
  p_team_members JSONB DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_registration registrations%ROWTYPE;
  v_updated_registration registrations%ROWTYPE;
  v_target_division divisions%ROWTYPE;
  v_athlete athletes%ROWTYPE;
  v_updated_athlete athletes%ROWTYPE;
  v_leaderboard_entry leaderboard_entries%ROWTYPE;
  v_new_athlete_id TEXT;
  v_next_athlete_name TEXT;
  v_next_box TEXT;
  v_next_email TEXT;
  v_next_phone TEXT;
  v_next_gender TEXT;
  v_next_instagram TEXT;
  v_next_shirt_size TEXT;
BEGIN
  SELECT *
  INTO v_registration
  FROM registrations
  WHERE id = p_registration_id
    AND event_id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'registration_not_found';
  END IF;

  SELECT *
  INTO v_target_division
  FROM divisions
  WHERE id = COALESCE(NULLIF(TRIM(p_division_id), ''), v_registration.division_id)
    AND event_id = p_event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'target_division_not_found';
  END IF;

  v_next_athlete_name := COALESCE(NULLIF(TRIM(p_athlete_name), ''), v_registration.athlete_name);
  v_next_box := COALESCE(NULLIF(TRIM(p_box), ''), COALESCE(v_registration.box, 'Independente'));
  v_next_email := COALESCE(NULLIF(TRIM(p_athlete_email), ''), v_registration.athlete_email);
  v_next_phone := COALESCE(NULLIF(TRIM(p_athlete_phone), ''), v_registration.athlete_phone);
  v_next_gender := CASE WHEN p_gender IN ('male', 'female') THEN p_gender ELSE v_registration.gender END;
  v_next_instagram := NULLIF(REGEXP_REPLACE(COALESCE(TRIM(p_instagram), ''), '^@+', ''), '');
  v_next_shirt_size := NULLIF(TRIM(COALESCE(p_shirt_size, '')), '');

  UPDATE registrations
  SET athlete_name = v_next_athlete_name,
      box = v_next_box,
      athlete_email = v_next_email,
      athlete_phone = v_next_phone,
      gender = v_next_gender,
      division_id = v_target_division.id,
      ticket_type = v_target_division.name,
      updated_at = NOW()
  WHERE id = p_registration_id
    AND event_id = p_event_id
  RETURNING *
  INTO v_updated_registration;

  IF v_registration.athlete_id IS NOT NULL THEN
    SELECT *
    INTO v_athlete
    FROM athletes
    WHERE id = v_registration.athlete_id
    FOR UPDATE;
  END IF;

  IF v_athlete.id IS NULL THEN
    SELECT *
    INTO v_athlete
    FROM athletes
    WHERE division_id = v_registration.division_id
      AND name ILIKE v_registration.athlete_name
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF v_athlete.id IS NOT NULL THEN
    UPDATE athletes
    SET name = v_next_athlete_name,
        box = v_next_box,
        division_id = v_target_division.id,
        instagram = v_next_instagram,
        shirt_size = v_next_shirt_size,
        email = NULLIF(v_next_email, ''),
        phone = NULLIF(v_next_phone, ''),
        gender = v_next_gender,
        is_team = COALESCE(p_is_team, is_team),
        team_members = COALESCE(p_team_members, team_members)
    WHERE id = v_athlete.id
    RETURNING *
    INTO v_updated_athlete;

    IF v_updated_registration.athlete_id IS NULL THEN
      UPDATE registrations
      SET athlete_id = v_updated_athlete.id,
          updated_at = NOW()
      WHERE id = p_registration_id
        AND athlete_id IS NULL
      RETURNING *
      INTO v_updated_registration;
    END IF;
  ELSE
    v_new_athlete_id := COALESCE(
      v_registration.athlete_id,
      'ath-' || FLOOR(EXTRACT(EPOCH FROM CLOCK_TIMESTAMP()) * 1000)::BIGINT::TEXT || '-' || SUBSTRING(MD5(RANDOM()::TEXT), 1, 5)
    );

    INSERT INTO athletes (
      id,
      name,
      box,
      country,
      division_id,
      instagram,
      shirt_size,
      email,
      phone,
      gender,
      is_team,
      team_members
    )
    VALUES (
      v_new_athlete_id,
      v_next_athlete_name,
      v_next_box,
      'BR',
      v_target_division.id,
      v_next_instagram,
      v_next_shirt_size,
      NULLIF(v_next_email, ''),
      NULLIF(v_next_phone, ''),
      v_next_gender,
      COALESCE(p_is_team, FALSE),
      COALESCE(p_team_members, '[]'::JSONB)
    )
    RETURNING *
    INTO v_updated_athlete;

    UPDATE registrations
    SET athlete_id = v_new_athlete_id,
        updated_at = NOW()
    WHERE id = p_registration_id
      AND athlete_id IS NULL
    RETURNING *
    INTO v_updated_registration;
  END IF;

  IF v_updated_registration.payment_status = 'payment_approved' AND v_updated_registration.athlete_id IS NOT NULL THEN
    SELECT *
    INTO v_leaderboard_entry
    FROM upsert_leaderboard_entry_for_registration(v_updated_registration.id);
  END IF;

  RETURN JSONB_BUILD_OBJECT(
    'registration', TO_JSONB(v_updated_registration),
    'athlete', TO_JSONB(v_updated_athlete),
    'leaderboardEntry', CASE
      WHEN v_leaderboard_entry.id IS NULL THEN NULL
      ELSE TO_JSONB(v_leaderboard_entry)
    END
  );
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public;

REVOKE ALL ON FUNCTION admin_update_registration_details(
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  BOOLEAN,
  JSONB
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION admin_update_registration_details(
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  BOOLEAN,
  JSONB
) TO service_role;

-- Remove entradas que nao tenham mais uma inscricao aprovada correspondente.
DELETE FROM leaderboard_entries le
WHERE NOT EXISTS (
  SELECT 1
  FROM registrations r
  WHERE r.event_id = le.event_id
    AND r.division_id = le.division_id
    AND r.athlete_id = le.athlete_id
    AND r.payment_status = 'payment_approved'
);

-- Recria/atualiza entradas aprovadas ausentes ou divergentes apos a limpeza.
INSERT INTO leaderboard_entries (
  event_id,
  division_id,
  athlete_id,
  athlete_name,
  box_name,
  instagram,
  country,
  gender,
  birth_date,
  is_team,
  team_members,
  payment_approved_at
)
SELECT
  reconciled.event_id,
  reconciled.division_id,
  reconciled.athlete_id,
  reconciled.athlete_name,
  reconciled.box_name,
  reconciled.instagram,
  reconciled.country,
  reconciled.gender,
  reconciled.birth_date,
  reconciled.is_team,
  reconciled.team_members,
  reconciled.payment_approved_at
FROM (
  SELECT DISTINCT ON (r.event_id, r.division_id, a.id)
    r.event_id,
    r.division_id,
    a.id AS athlete_id,
    a.name AS athlete_name,
    a.box AS box_name,
    a.instagram,
    COALESCE(a.country, 'BR') AS country,
    a.gender,
    a.birth_date,
    COALESCE(a.is_team, FALSE) AS is_team,
    COALESCE(a.team_members, '[]'::JSONB) AS team_members,
    COALESCE(r.updated_at, r.created_at, NOW()) AS payment_approved_at
  FROM registrations r
  INNER JOIN athletes a ON a.id = r.athlete_id
  WHERE r.payment_status = 'payment_approved'
    AND r.athlete_id IS NOT NULL
  ORDER BY r.event_id, r.division_id, a.id, COALESCE(r.updated_at, r.created_at, NOW()) DESC
) reconciled
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
  updated_at = NOW();

COMMENT ON FUNCTION upsert_leaderboard_entry_for_registration(TEXT) IS
'Insere ou atualiza a entrada do leaderboard a partir da inscricao aprovada atual.';

COMMENT ON FUNCTION admin_update_registration_details(
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  BOOLEAN,
  JSONB
) IS
'Atualiza inscricao administrativa, atleta vinculado e leaderboard em uma unica transacao.';
