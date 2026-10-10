-- Fast server-side summaries for /catalog/config.
--
-- The config page needs a broad editable inventory, but it should not pull
-- large stream snapshots into Next.js and aggregate them in JavaScript.

CREATE OR REPLACE FUNCTION public.catalog_config_track_rows(limit_rows integer DEFAULT 5000)
RETURNS TABLE (
  isrc text,
  name text,
  release_date date,
  last_seen date,
  spotify_album_image_url text,
  spotify_artist_names text[],
  spotify_artist_ids text[],
  spotify_track_id text,
  total_streams bigint,
  daily_streams bigint,
  distro_playlists jsonb
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH latest_dates AS (
    SELECT
      MAX(date)::date AS latest_date,
      (
        SELECT MAX(s2.date)::date
        FROM public.track_daily_streams_effective_public s2
        WHERE s2.date < MAX(s.date)
      ) AS previous_date
    FROM public.track_daily_streams_effective_public s
  ),
  selected_tracks AS (
    SELECT t.*
    FROM public.tracks t
    ORDER BY t.last_seen DESC NULLS LAST, t.isrc ASC
    LIMIT GREATEST(COALESCE(limit_rows, 5000), 0)
  ),
  distro_playlists AS (
    SELECT
      p.playlist_key,
      p.display_name,
      p.spotify_playlist_image_url
    FROM public.playlists p
    WHERE p.playlist_type = 'Distro'
  ),
  active_distro_memberships AS (
    SELECT
      m.isrc,
      jsonb_agg(
        DISTINCT jsonb_build_object(
          'key', p.playlist_key,
          'name', COALESCE(p.display_name, p.playlist_key),
          'imageUrl', p.spotify_playlist_image_url
        )
      ) FILTER (WHERE p.playlist_key IS NOT NULL) AS distro_playlists
    FROM public.playlist_memberships m
    JOIN distro_playlists p ON p.playlist_key = m.playlist_key
    WHERE m.valid_from <= CURRENT_DATE
      AND (m.valid_to IS NULL OR m.valid_to >= CURRENT_DATE)
    GROUP BY m.isrc
  )
  SELECT
    t.isrc,
    t.name,
    t.release_date,
    t.last_seen,
    t.spotify_album_image_url,
    t.spotify_artist_names,
    t.spotify_artist_ids,
    t.spotify_track_id,
    latest.streams_cumulative::bigint AS total_streams,
    CASE
      WHEN latest.streams_cumulative IS NULL OR prev.streams_cumulative IS NULL THEN NULL
      ELSE GREATEST(0, latest.streams_cumulative - prev.streams_cumulative)::bigint
    END AS daily_streams,
    COALESCE(adm.distro_playlists, '[]'::jsonb) AS distro_playlists
  FROM selected_tracks t
  CROSS JOIN latest_dates d
  LEFT JOIN public.track_daily_streams_effective_public latest
    ON latest.date = d.latest_date
   AND latest.isrc = t.isrc
  LEFT JOIN public.track_daily_streams_effective_public prev
    ON prev.date = d.previous_date
   AND prev.isrc = t.isrc
  LEFT JOIN active_distro_memberships adm
    ON adm.isrc = t.isrc
  ORDER BY t.last_seen DESC NULLS LAST, t.isrc ASC;
$$;

CREATE OR REPLACE FUNCTION public.catalog_config_artist_rows(limit_rows integer DEFAULT 5000)
RETURNS TABLE (
  id text,
  name text,
  image_url text,
  external_url text,
  total_streams bigint,
  daily_streams bigint,
  track_count integer,
  daily_track_count integer,
  distro_playlists jsonb,
  in_house boolean
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH latest_dates AS (
    SELECT
      MAX(date)::date AS latest_date,
      (
        SELECT MAX(s2.date)::date
        FROM public.track_daily_streams_effective_public s2
        WHERE s2.date < MAX(s.date)
      ) AS previous_date
    FROM public.track_daily_streams_effective_public s
  ),
  selected_tracks AS (
    SELECT t.*
    FROM public.tracks t
    ORDER BY t.last_seen DESC NULLS LAST, t.isrc ASC
    LIMIT GREATEST(COALESCE(limit_rows, 5000), 0)
  ),
  track_stats AS (
    SELECT
      t.isrc,
      latest.streams_cumulative::bigint AS total_streams,
      CASE
        WHEN latest.streams_cumulative IS NULL OR prev.streams_cumulative IS NULL THEN NULL
        ELSE GREATEST(0, latest.streams_cumulative - prev.streams_cumulative)::bigint
      END AS daily_streams,
      latest.isrc IS NOT NULL AS has_latest,
      prev.isrc IS NOT NULL AS has_previous
    FROM selected_tracks t
    CROSS JOIN latest_dates d
    LEFT JOIN public.track_daily_streams_effective_public latest
      ON latest.date = d.latest_date
     AND latest.isrc = t.isrc
    LEFT JOIN public.track_daily_streams_effective_public prev
      ON prev.date = d.previous_date
     AND prev.isrc = t.isrc
  ),
  track_artists AS (
    SELECT
      t.isrc,
      a.artist_id,
      a.artist_name
    FROM selected_tracks t
    CROSS JOIN LATERAL unnest(
      COALESCE(t.spotify_artist_ids, ARRAY[]::text[]),
      COALESCE(t.spotify_artist_names, ARRAY[]::text[])
    ) AS a(artist_id, artist_name)
    WHERE a.artist_id IS NOT NULL
      AND btrim(a.artist_id) <> ''
  ),
  distro_playlists AS (
    SELECT
      p.playlist_key,
      p.display_name,
      p.spotify_playlist_image_url
    FROM public.playlists p
    WHERE p.playlist_type = 'Distro'
  ),
  track_distro AS (
    SELECT DISTINCT
      m.isrc,
      p.playlist_key,
      COALESCE(p.display_name, p.playlist_key) AS display_name,
      p.spotify_playlist_image_url
    FROM public.playlist_memberships m
    JOIN distro_playlists p ON p.playlist_key = m.playlist_key
    WHERE m.valid_from <= CURRENT_DATE
      AND (m.valid_to IS NULL OR m.valid_to >= CURRENT_DATE)
  ),
  artist_distro AS (
    SELECT
      ta.artist_id,
      jsonb_agg(
        DISTINCT jsonb_build_object(
          'key', td.playlist_key,
          'name', td.display_name,
          'imageUrl', td.spotify_playlist_image_url
        )
      ) FILTER (WHERE td.playlist_key IS NOT NULL) AS distro_playlists
    FROM track_artists ta
    JOIN track_distro td ON td.isrc = ta.isrc
    GROUP BY ta.artist_id
  )
  SELECT
    ta.artist_id AS id,
    COALESCE(MAX(NULLIF(ta.artist_name, '')), sai.name, ta.artist_id) AS name,
    sai.image_url,
    COALESCE(sai.external_url, 'https://open.spotify.com/artist/' || ta.artist_id) AS external_url,
    NULLIF(SUM(COALESCE(ts.total_streams, 0)), 0)::bigint AS total_streams,
    NULLIF(SUM(COALESCE(ts.daily_streams, 0)), 0)::bigint AS daily_streams,
    COUNT(DISTINCT ta.isrc)::integer AS track_count,
    COUNT(DISTINCT ta.isrc) FILTER (WHERE ts.has_latest AND NOT ts.has_previous)::integer AS daily_track_count,
    COALESCE(ad.distro_playlists, '[]'::jsonb) AS distro_playlists,
    (iht.artist_id IS NOT NULL) AS in_house
  FROM track_artists ta
  LEFT JOIN track_stats ts ON ts.isrc = ta.isrc
  LEFT JOIN public.spotify_artist_images sai ON sai.artist_id = ta.artist_id
  LEFT JOIN public.artist_in_house_tags iht ON iht.artist_id = ta.artist_id
  LEFT JOIN artist_distro ad ON ad.artist_id = ta.artist_id
  GROUP BY ta.artist_id, sai.name, sai.image_url, sai.external_url, ad.distro_playlists, iht.artist_id
  ORDER BY name ASC;
$$;

GRANT EXECUTE ON FUNCTION public.catalog_config_track_rows(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.catalog_config_artist_rows(integer) TO authenticated;
