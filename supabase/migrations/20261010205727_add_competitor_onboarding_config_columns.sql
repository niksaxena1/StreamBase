-- Competitor DB config for UI onboarding. Apply after add_competitor_label_accent_hex.sql.
-- Additive, idempotent, competitor-only; no public tables or grants are changed.
BEGIN;

ALTER TABLE competitor.playlists
  ADD COLUMN IF NOT EXISTS sot_dashboard_name TEXT,
  ADD COLUMN IF NOT EXISTS min_rows INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN competitor.playlists.sot_dashboard_name IS
  'SpotOnTrack dashboard name for sync. NULL falls back to display_name.';
COMMENT ON COLUMN competitor.playlists.min_rows IS
  'Export safety: minimum expected CSV rows.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'competitor_playlists_min_rows_nonnegative'
      AND conrelid = 'competitor.playlists'::regclass
  ) THEN
    ALTER TABLE competitor.playlists ADD CONSTRAINT competitor_playlists_min_rows_nonnegative
      CHECK (min_rows >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'competitor_labels_accent_hex_format'
      AND conrelid = 'competitor.labels'::regclass
  ) THEN
    ALTER TABLE competitor.labels ADD CONSTRAINT competitor_labels_accent_hex_format
      CHECK (accent_hex IS NULL OR accent_hex ~ '^[0-9A-Fa-f]{6}$') NOT VALID;
  END IF;
END $$;

-- Enforce the API's duplicate checks under concurrent submissions too. Inactive
-- rows retain their identities, just as the onboarding lookup checks do.
CREATE UNIQUE INDEX IF NOT EXISTS competitor_playlists_spotify_playlist_id_onboarding_uq
  ON competitor.playlists (spotify_playlist_id) WHERE spotify_playlist_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS competitor_playlists_sot_playlist_id_onboarding_uq
  ON competitor.playlists (sot_playlist_id) WHERE sot_playlist_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS competitor_playlists_sot_dashboard_url_onboarding_uq
  ON competitor.playlists (sot_dashboard_url);

-- Private competitor configuration: access only through admin-gated service-role code.
GRANT USAGE ON SCHEMA competitor TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON competitor.labels, competitor.playlists TO service_role;

-- Generated from current config/competitor_playlists.csv (17 rows).
-- Only unconfigured rows are backfilled: reapplying does not overwrite DB edits.
UPDATE competitor.playlists SET sot_dashboard_name = 'Paraíso Releases', min_rows = 1
WHERE playlist_key = 'paraiso_releases' AND sot_dashboard_name IS NULL;
UPDATE competitor.playlists SET sot_dashboard_name = 'Soave Records Releases', min_rows = 1
WHERE playlist_key = 'soave_releases' AND sot_dashboard_name IS NULL;
UPDATE competitor.playlists SET sot_dashboard_name = 'Dusk Records Releases', min_rows = 1
WHERE playlist_key = 'soave_dusk_records_releases' AND sot_dashboard_name IS NULL;
UPDATE competitor.playlists SET sot_dashboard_name = 'Soave Radio Releases', min_rows = 1
WHERE playlist_key = 'soave_radio_releases' AND sot_dashboard_name IS NULL;
UPDATE competitor.playlists SET sot_dashboard_name = 'soave lofi releases', min_rows = 1
WHERE playlist_key = 'soave_lofi_releases' AND sot_dashboard_name IS NULL;
UPDATE competitor.playlists SET sot_dashboard_name = 'Day & Night Records Releases', min_rows = 1
WHERE playlist_key = 'soave_day_night_records_releases' AND sot_dashboard_name IS NULL;
UPDATE competitor.playlists SET sot_dashboard_name = 'Blaaktrax Releases', min_rows = 1
WHERE playlist_key = 'soave_blaaktrax_releases' AND sot_dashboard_name IS NULL;
UPDATE competitor.playlists SET sot_dashboard_name = 'ƎVAOS Releases', min_rows = 1
WHERE playlist_key = 'soave_evaos_releases' AND sot_dashboard_name IS NULL;
UPDATE competitor.playlists SET sot_dashboard_name = 'ChillYourMind New Official Releases', min_rows = 1
WHERE playlist_key = 'chillyourmind_releases' AND sot_dashboard_name IS NULL;
UPDATE competitor.playlists SET sot_dashboard_name = 'selected. Releases', min_rows = 1
WHERE playlist_key = 'selected_releases' AND sot_dashboard_name IS NULL;
UPDATE competitor.playlists SET sot_dashboard_name = 'ATLAST // All Releases', min_rows = 1
WHERE playlist_key = 'atlast_all_releases' AND sot_dashboard_name IS NULL;
UPDATE competitor.playlists SET sot_dashboard_name = 'Miami Beats // All Releases', min_rows = 1
WHERE playlist_key = 'atlast_miami_beats_all_releases' AND sot_dashboard_name IS NULL;
UPDATE competitor.playlists SET sot_dashboard_name = 'MusicUp Releases', min_rows = 1
WHERE playlist_key = 'musicup_releases' AND sot_dashboard_name IS NULL;
UPDATE competitor.playlists SET sot_dashboard_name = 'Perfect Havoc Records', min_rows = 1
WHERE playlist_key = 'perfect_havoc_records' AND sot_dashboard_name IS NULL;
UPDATE competitor.playlists SET sot_dashboard_name = 'Million Hills Releases', min_rows = 1
WHERE playlist_key = 'million_hills_releases' AND sot_dashboard_name IS NULL;
UPDATE competitor.playlists SET sot_dashboard_name = 'Lilly Era Releases', min_rows = 1
WHERE playlist_key = 'lilly_era_releases' AND sot_dashboard_name IS NULL;
UPDATE competitor.playlists SET sot_dashboard_name = 'Diepgraven Records 🌴 | All Releases', min_rows = 1
WHERE playlist_key = 'diepgraven_records_all_releases' AND sot_dashboard_name IS NULL;

-- One PostgREST request / transaction: any error rolls back both records,
-- including label reactivation. A lost HTTP response can be retried safely.
CREATE OR REPLACE FUNCTION competitor.onboard_competitor(
  p_label_mode TEXT,
  p_label_key TEXT,
  p_label_display_name TEXT,
  p_accent_hex TEXT,
  p_playlist_key TEXT,
  p_playlist_display_name TEXT,
  p_spotify_playlist_id TEXT,
  p_sot_playlist_id BIGINT,
  p_sot_dashboard_url TEXT,
  p_sot_dashboard_name TEXT,
  p_min_rows INTEGER
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, competitor
AS $$
DECLARE
  v_label competitor.labels%ROWTYPE;
  v_playlist competitor.playlists%ROWTYPE;
  v_created_label BOOLEAN := FALSE;
  v_order INTEGER;
BEGIN
  -- The route validates all fields first. Keep the private RPC defensive too.
  IF p_label_mode IS NULL OR p_label_mode NOT IN ('new', 'existing')
    OR p_label_key IS NULL OR length(p_label_key) > 64
    OR p_label_key !~ '^[a-z0-9]+(_[a-z0-9]+)*$'
    OR p_playlist_key IS NULL OR length(p_playlist_key) > 64
    OR p_playlist_key !~ '^[a-z0-9]+(_[a-z0-9]+)*$'
    OR p_playlist_display_name IS NULL OR length(btrim(p_playlist_display_name)) NOT BETWEEN 1 AND 200
    OR p_spotify_playlist_id IS NULL OR p_spotify_playlist_id !~ '^[A-Za-z0-9]{22}$'
    OR p_sot_playlist_id IS NULL OR p_sot_playlist_id NOT BETWEEN 1 AND 9007199254740991
    OR p_sot_dashboard_url IS NULL
    OR p_sot_dashboard_url !~ '^https://www[.]spotontrack[.]com/dashboard/[1-9][0-9]*$'
    OR p_sot_dashboard_name IS NULL OR length(btrim(p_sot_dashboard_name)) NOT BETWEEN 1 AND 200
    OR p_min_rows IS NULL OR p_min_rows NOT BETWEEN 0 AND 100000
    OR (p_label_mode = 'new' AND (
      p_label_display_name IS NULL OR length(btrim(p_label_display_name)) NOT BETWEEN 1 AND 120
      OR (p_accent_hex IS NOT NULL AND p_accent_hex !~ '^[0-9A-Fa-f]{6}$')
    ))
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid competitor onboarding fields', DETAIL = 'body';
  END IF;

  -- Serialize these low-volume admin mutations so concurrent identical
  -- requests observe the first committed result. No own-catalog locks involved.
  PERFORM pg_advisory_xact_lock(hashtextextended('competitor.onboard_competitor', 0));

  SELECT * INTO v_label FROM competitor.labels WHERE label_key = p_label_key FOR UPDATE;
  SELECT * INTO v_playlist FROM competitor.playlists WHERE playlist_key = p_playlist_key FOR UPDATE;

  -- Idempotency compares every requested playlist field, not just its key.
  -- Metadata populated by enrichment (images, timestamps, order) is ignored.
  IF v_label.label_key IS NOT NULL AND v_playlist.playlist_key IS NOT NULL
    AND v_playlist.label_key = p_label_key
    AND v_playlist.display_name = p_playlist_display_name
    AND v_playlist.spotify_playlist_id = p_spotify_playlist_id
    AND v_playlist.sot_playlist_id = p_sot_playlist_id
    AND v_playlist.sot_dashboard_url = p_sot_dashboard_url
    AND v_playlist.sot_dashboard_name = p_sot_dashboard_name
    AND v_playlist.min_rows = p_min_rows
    AND (p_label_mode = 'existing' OR (
      v_label.display_name = p_label_display_name
      AND lower(v_label.accent_hex) IS NOT DISTINCT FROM lower(p_accent_hex)
    ))
  THEN
    RETURN jsonb_build_object(
      'label_key', v_label.label_key, 'playlist_key', v_playlist.playlist_key,
      'created_label', FALSE, 'already_exists', TRUE,
      'label', to_jsonb(v_label), 'playlist', to_jsonb(v_playlist)
    );
  END IF;

  IF p_label_mode = 'existing' AND v_label.label_key IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Unknown label', DETAIL = 'label.label_key';
  END IF;
  IF p_label_mode = 'new' AND v_label.label_key IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'Label key already exists; choose an existing label', DETAIL = 'label.label_key';
  END IF;
  IF v_playlist.playlist_key IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'Playlist key already exists with different configuration', DETAIL = 'playlist.playlist_key';
  END IF;
  IF EXISTS (SELECT 1 FROM competitor.playlists WHERE spotify_playlist_id = p_spotify_playlist_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'Spotify playlist already tracked', DETAIL = 'playlist.spotify_playlist';
  END IF;
  IF EXISTS (SELECT 1 FROM competitor.playlists WHERE sot_playlist_id = p_sot_playlist_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'SpotOnTrack playlist already tracked', DETAIL = 'playlist.sot_playlist';
  END IF;
  IF EXISTS (SELECT 1 FROM competitor.playlists WHERE sot_dashboard_url = p_sot_dashboard_url) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'Dashboard already used', DETAIL = 'playlist.sot_dashboard_url';
  END IF;

  IF p_label_mode = 'new' THEN
    INSERT INTO competitor.labels (label_key, display_name, accent_hex, is_active)
      VALUES (p_label_key, p_label_display_name, p_accent_hex, TRUE) RETURNING * INTO v_label;
    v_created_label := TRUE;
  ELSIF v_label.is_active = FALSE THEN
    UPDATE competitor.labels SET is_active = TRUE, updated_at = now()
      WHERE label_key = p_label_key RETURNING * INTO v_label;
  END IF;

  SELECT coalesce(max(display_order) + 1, 1) INTO v_order
    FROM competitor.playlists WHERE label_key = p_label_key;
  INSERT INTO competitor.playlists (
    playlist_key, label_key, display_name, spotify_playlist_id, sot_playlist_id,
    sot_dashboard_url, sot_dashboard_name, min_rows, display_order, is_active
  ) VALUES (
    p_playlist_key, p_label_key, p_playlist_display_name, p_spotify_playlist_id, p_sot_playlist_id,
    p_sot_dashboard_url, p_sot_dashboard_name, p_min_rows, v_order, TRUE
  ) RETURNING * INTO v_playlist;

  RETURN jsonb_build_object(
    'label_key', v_label.label_key, 'playlist_key', v_playlist.playlist_key,
    'created_label', v_created_label, 'already_exists', FALSE,
    'label', to_jsonb(v_label), 'playlist', to_jsonb(v_playlist)
  );
END;
$$;

REVOKE ALL ON FUNCTION competitor.onboard_competitor(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION competitor.onboard_competitor(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, INTEGER)
  TO service_role;

COMMIT;
