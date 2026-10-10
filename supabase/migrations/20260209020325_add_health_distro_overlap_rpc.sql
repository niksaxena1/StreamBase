-- RPC: health_distro_overlap_tracks
-- Finds tracks (ISRCs) that are active in 2 or more Distro playlists on the
-- same day.  Returns track metadata and the list of overlapping distro playlists
-- so the Health page can render an expandable warning.

CREATE OR REPLACE FUNCTION health_distro_overlap_tracks(
  run_date date
)
RETURNS TABLE(
  isrc text,
  name text,
  artist_names text[],
  artist_ids text[],
  album_image_url text,
  distro_playlist_keys text[]
)
LANGUAGE sql STABLE
AS $$
  WITH distro_active AS (
    -- All active memberships in Distro playlists on the given date
    SELECT pm.isrc,
           pm.playlist_key
    FROM playlist_memberships pm
    JOIN playlists p ON p.playlist_key = pm.playlist_key
    WHERE p.playlist_type = 'Distro'
      AND pm.valid_from <= run_date
      AND (pm.valid_to IS NULL OR pm.valid_to > run_date)
  ),
  overlapping AS (
    -- ISRCs present in 2+ distinct Distro playlists
    SELECT da.isrc,
           array_agg(DISTINCT da.playlist_key ORDER BY da.playlist_key) AS distro_playlist_keys
    FROM distro_active da
    GROUP BY da.isrc
    HAVING count(DISTINCT da.playlist_key) >= 2
  )
  SELECT o.isrc,
         t.name,
         t.spotify_artist_names  AS artist_names,
         t.spotify_artist_ids    AS artist_ids,
         t.spotify_album_image_url AS album_image_url,
         o.distro_playlist_keys
  FROM overlapping o
  LEFT JOIN tracks t ON t.isrc = o.isrc
  ORDER BY t.name NULLS LAST, o.isrc;
$$;
