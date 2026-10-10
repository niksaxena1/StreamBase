-- RPC: health_entity_distro_drift
-- Compares each Entity playlist's membership against the union of its linked
-- Distro playlists for a given run_date.  Returns extra and missing ISRCs with
-- track metadata so the Health page can render expandable warnings.

CREATE OR REPLACE FUNCTION health_entity_distro_drift(
  run_date date
)
RETURNS TABLE(
  entity_playlist_key text,
  drift_type text,            -- 'extra_in_distro' or 'missing_from_distro'
  isrc text,
  source_playlist_key text,   -- which distro playlist the ISRC is in (NULL for missing)
  name text,
  artist_names text[],
  artist_ids text[],
  album_image_url text
)
LANGUAGE sql STABLE
AS $$
  WITH entity_playlists AS (
    -- All Entity playlists that have at least one linked Distro playlist
    SELECT DISTINCT p_entity.playlist_key AS entity_key
    FROM playlists p_entity
    JOIN playlists p_distro
      ON p_distro.entity_playlist_key = p_entity.playlist_key
    WHERE p_entity.playlist_type = 'Entity'
  ),
  entity_isrcs AS (
    -- ISRCs currently in each Entity playlist
    SELECT ep.entity_key,
           pm.isrc
    FROM entity_playlists ep
    JOIN playlist_memberships pm
      ON pm.playlist_key = ep.entity_key
     AND pm.valid_from <= run_date
     AND (pm.valid_to IS NULL OR pm.valid_to > run_date)
  ),
  distro_isrcs AS (
    -- ISRCs in each linked Distro playlist (with source playlist info)
    SELECT p_distro.entity_playlist_key AS entity_key,
           pm.isrc,
           pm.playlist_key AS source_playlist_key
    FROM playlists p_distro
    JOIN playlist_memberships pm
      ON pm.playlist_key = p_distro.playlist_key
     AND pm.valid_from <= run_date
     AND (pm.valid_to IS NULL OR pm.valid_to > run_date)
    WHERE p_distro.entity_playlist_key IS NOT NULL
  ),
  distro_union AS (
    -- Distinct ISRCs across all distro playlists per entity
    SELECT DISTINCT entity_key, isrc
    FROM distro_isrcs
  ),
  -- Extra: in distro union but NOT in entity
  extra AS (
    SELECT d.entity_key,
           'extra_in_distro'::text AS drift_type,
           d.isrc,
           -- Pick one source playlist for display (the first alphabetically)
           (SELECT di.source_playlist_key
            FROM distro_isrcs di
            WHERE di.entity_key = d.entity_key AND di.isrc = d.isrc
            ORDER BY di.source_playlist_key
            LIMIT 1) AS source_playlist_key
    FROM distro_union d
    LEFT JOIN entity_isrcs e
      ON e.entity_key = d.entity_key AND e.isrc = d.isrc
    WHERE e.isrc IS NULL
  ),
  -- Missing: in entity but NOT in distro union
  missing AS (
    SELECT e.entity_key,
           'missing_from_distro'::text AS drift_type,
           e.isrc,
           NULL::text AS source_playlist_key
    FROM entity_isrcs e
    LEFT JOIN distro_union d
      ON d.entity_key = e.entity_key AND d.isrc = e.isrc
    WHERE d.isrc IS NULL
  ),
  combined AS (
    SELECT * FROM extra
    UNION ALL
    SELECT * FROM missing
  )
  SELECT c.entity_key AS entity_playlist_key,
         c.drift_type,
         c.isrc,
         c.source_playlist_key,
         t.name,
         t.spotify_artist_names AS artist_names,
         t.spotify_artist_ids   AS artist_ids,
         t.spotify_album_image_url AS album_image_url
  FROM combined c
  LEFT JOIN tracks t ON t.isrc = c.isrc
  ORDER BY c.entity_key, c.drift_type, t.name NULLS LAST, c.isrc;
$$;
