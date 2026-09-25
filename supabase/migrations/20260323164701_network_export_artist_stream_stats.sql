-- Per-artist stream totals for network Excel export:
-- - In scope: same ISRC / primary-artist rules as artist_collaboration_graph
-- - All catalog: every track in public.tracks crediting the artist

CREATE OR REPLACE FUNCTION public.network_export_artist_stream_stats(
  p_artist_ids text[],
  p_playlist_key text DEFAULT NULL,
  p_hide_non_primary boolean DEFAULT false
)
RETURNS TABLE (
  artist_id text,
  tracks_in_scope bigint,
  total_streams_in_scope bigint,
  daily_streams_in_scope bigint,
  tracks_all_catalog bigint,
  total_streams_all_catalog bigint,
  daily_streams_all_catalog bigint
)
LANGUAGE sql
STABLE
AS $$
  WITH artists_input AS (
    SELECT DISTINCT btrim(x) AS artist_id
    FROM unnest(p_artist_ids) AS t(x)
    WHERE x IS NOT NULL AND btrim(x) <> ''
  ),
  scoped_isrcs AS (
    SELECT DISTINCT cm.isrc
    FROM (
      SELECT u.isrc, MAX(u.valid_from) AS valid_from
      FROM (
        SELECT
          m.isrc,
          m.valid_from::date AS valid_from,
          m.valid_to::date AS valid_to
        FROM public.playlist_memberships m
        WHERE p_playlist_key IS NOT NULL
          AND m.playlist_key = p_playlist_key
          AND m.valid_from <= CURRENT_DATE
          AND (m.valid_to IS NULL OR m.valid_to >= CURRENT_DATE)
      ) u
      GROUP BY u.isrc
    ) cm
    WHERE p_playlist_key IS NOT NULL

    UNION ALL

    SELECT t.isrc
    FROM public.tracks t
    WHERE p_playlist_key IS NULL
  ),

  primary_rows AS (
    SELECT
      t.isrc,
      t.spotify_artist_ids[1] AS artist_id
    FROM public.tracks t
    INNER JOIN scoped_isrcs s ON s.isrc = t.isrc
    WHERE t.spotify_artist_ids IS NOT NULL
      AND array_length(t.spotify_artist_ids, 1) > 0
  ),

  artist_tracks AS (
    SELECT
      t.isrc,
      a.artist_id
    FROM public.tracks t
    INNER JOIN scoped_isrcs s ON s.isrc = t.isrc
    CROSS JOIN LATERAL unnest(t.spotify_artist_ids) AS a(artist_id)
    WHERE t.spotify_artist_ids IS NOT NULL
      AND array_length(t.spotify_artist_ids, 1) > 0
  ),

  artist_scoped_isrcs AS (
    SELECT DISTINCT pr.artist_id, pr.isrc
    FROM primary_rows pr
    INNER JOIN artists_input ai ON ai.artist_id = pr.artist_id
    WHERE p_hide_non_primary
    UNION ALL
    SELECT DISTINCT at.artist_id, at.isrc
    FROM artist_tracks at
    INNER JOIN artists_input ai ON ai.artist_id = at.artist_id
    WHERE NOT p_hide_non_primary
  ),

  artist_all_isrcs AS (
    SELECT DISTINCT ui.artist_id, t.isrc
    FROM artists_input ui
    INNER JOIN public.tracks t ON t.spotify_artist_ids @> ARRAY[ui.artist_id]::text[]
    WHERE t.spotify_artist_ids IS NOT NULL
      AND array_length(t.spotify_artist_ids, 1) > 0
  ),

  relevant_isrcs AS (
    SELECT isrc FROM artist_scoped_isrcs
    UNION
    SELECT isrc FROM artist_all_isrcs
  ),

  latest AS (
    SELECT max(date)::date AS d FROM public.track_daily_streams_effective_public
  ),
  previous AS (
    SELECT max(t.date)::date AS d
    FROM public.track_daily_streams_effective_public t
    WHERE t.date < (SELECT d FROM latest)
  ),

  stream_by_isrc AS (
    SELECT
      s.isrc,
      max(s.streams_cumulative) FILTER (WHERE s.date = (SELECT d FROM latest)) AS cum_latest,
      max(s.streams_cumulative) FILTER (WHERE s.date = (SELECT d FROM previous)) AS cum_prev
    FROM public.track_daily_streams_effective_public s
    INNER JOIN relevant_isrcs r ON r.isrc = s.isrc
    WHERE s.date IN ((SELECT d FROM latest), (SELECT d FROM previous))
    GROUP BY s.isrc
  ),

  stream_metrics AS (
    SELECT
      s.isrc,
      coalesce(s.cum_latest, 0)::bigint AS total_streams,
      CASE
        WHEN s.cum_latest IS NOT NULL AND s.cum_prev IS NOT NULL
        THEN greatest(0, s.cum_latest - s.cum_prev)::bigint
        ELSE NULL::bigint
      END AS daily_streams
    FROM stream_by_isrc s
  ),

  scoped_agg AS (
    SELECT
      si.artist_id,
      count(DISTINCT si.isrc)::bigint AS tracks_in_scope,
      coalesce(sum(sm.total_streams), 0)::bigint AS total_streams_in_scope,
      coalesce(
        sum(CASE WHEN sm.daily_streams IS NOT NULL THEN sm.daily_streams ELSE 0 END),
        0
      )::bigint AS daily_streams_in_scope
    FROM artist_scoped_isrcs si
    LEFT JOIN stream_metrics sm ON sm.isrc = si.isrc
    GROUP BY si.artist_id
  ),

  all_agg AS (
    SELECT
      aai.artist_id,
      count(DISTINCT aai.isrc)::bigint AS tracks_all_catalog,
      coalesce(sum(sm.total_streams), 0)::bigint AS total_streams_all_catalog,
      coalesce(
        sum(CASE WHEN sm.daily_streams IS NOT NULL THEN sm.daily_streams ELSE 0 END),
        0
      )::bigint AS daily_streams_all_catalog
    FROM artist_all_isrcs aai
    LEFT JOIN stream_metrics sm ON sm.isrc = aai.isrc
    GROUP BY aai.artist_id
  )

  SELECT
    ai.artist_id,
    coalesce(sa.tracks_in_scope, 0)::bigint AS tracks_in_scope,
    coalesce(sa.total_streams_in_scope, 0)::bigint AS total_streams_in_scope,
    coalesce(sa.daily_streams_in_scope, 0)::bigint AS daily_streams_in_scope,
    coalesce(aa.tracks_all_catalog, 0)::bigint AS tracks_all_catalog,
    coalesce(aa.total_streams_all_catalog, 0)::bigint AS total_streams_all_catalog,
    coalesce(aa.daily_streams_all_catalog, 0)::bigint AS daily_streams_all_catalog
  FROM artists_input ai
  LEFT JOIN scoped_agg sa ON sa.artist_id = ai.artist_id
  LEFT JOIN all_agg aa ON aa.artist_id = ai.artist_id;
$$;

COMMENT ON FUNCTION public.network_export_artist_stream_stats(text[], text, boolean) IS
  'Stream aggregates per artist for network Excel: in-scope matches artist_collaboration_graph; all-catalog is any track crediting the artist.';

GRANT EXECUTE ON FUNCTION public.network_export_artist_stream_stats(text[], text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.network_export_artist_stream_stats(text[], text, boolean) TO service_role;
