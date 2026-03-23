-- Union of in-scope ISRCs across many artists (same rules as artist_collaboration_graph /
-- network_export_artist_stream_stats), for multi-select stats when there are no internal collab edges.

CREATE OR REPLACE FUNCTION public.network_selection_scoped_track_totals(
  p_artist_ids text[],
  p_playlist_key text DEFAULT NULL,
  p_hide_non_primary boolean DEFAULT false
)
RETURNS TABLE (
  track_count bigint,
  total_streams bigint,
  daily_streams bigint
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

  selection_isrcs AS (
    SELECT DISTINCT isrc
    FROM artist_scoped_isrcs
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
    INNER JOIN selection_isrcs r ON r.isrc = s.isrc
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

  aggregated AS (
    SELECT
      count(DISTINCT u.isrc)::bigint AS track_count,
      coalesce(sum(sm.total_streams), 0)::bigint AS total_streams,
      coalesce(
        sum(CASE WHEN sm.daily_streams IS NOT NULL THEN sm.daily_streams ELSE 0 END),
        0
      )::bigint AS daily_streams
    FROM selection_isrcs u
    LEFT JOIN stream_metrics sm ON sm.isrc = u.isrc
  )

  SELECT track_count, total_streams, daily_streams FROM aggregated;
$$;

COMMENT ON FUNCTION public.network_selection_scoped_track_totals(text[], text, boolean) IS
  'Deduped in-scope track count and stream totals for a set of artists (union of scoped ISRCs).';

GRANT EXECUTE ON FUNCTION public.network_selection_scoped_track_totals(text[], text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.network_selection_scoped_track_totals(text[], text, boolean) TO service_role;


CREATE OR REPLACE FUNCTION public.network_selection_scoped_isrcs(
  p_artist_ids text[],
  p_playlist_key text DEFAULT NULL,
  p_hide_non_primary boolean DEFAULT false,
  p_limit integer DEFAULT 8000,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (isrc text)
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

  selection_isrcs AS (
    SELECT DISTINCT x.isrc
    FROM artist_scoped_isrcs x
  ),

  ordered AS (
    SELECT si.isrc
    FROM selection_isrcs si
    ORDER BY si.isrc
    LIMIT greatest(0, least(coalesce(p_limit, 8000), 50000))
    OFFSET greatest(0, coalesce(p_offset, 0))
  )

  SELECT isrc FROM ordered;
$$;

COMMENT ON FUNCTION public.network_selection_scoped_isrcs(text[], text, boolean, integer, integer) IS
  'Paged list of deduped in-scope ISRCs for a set of artists (for selection track lists).';

GRANT EXECUTE ON FUNCTION public.network_selection_scoped_isrcs(text[], text, boolean, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.network_selection_scoped_isrcs(text[], text, boolean, integer, integer) TO service_role;
