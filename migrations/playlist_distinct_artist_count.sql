-- Distinct Spotify artist IDs credited on tracks that are active in the playlist
-- at run_date. Membership logic matches public.playlist_top_tracks (latest row per
-- playlist_key+isrc, active at run_date; all_catalog = releases ∪ ext).

CREATE OR REPLACE FUNCTION public.playlist_distinct_artist_count(
  playlist_key TEXT,
  run_date DATE
)
RETURNS BIGINT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (
      WITH base AS (
        SELECT m.playlist_key, m.isrc, m.valid_from::date AS valid_from, m.valid_to::date AS valid_to
        FROM public.playlist_memberships m
        WHERE (
          ($1 <> 'all_catalog' AND m.playlist_key = $1)
          OR ($1 = 'all_catalog' AND m.playlist_key IN ('releases', 'ext'))
        )
          AND m.valid_from <= $2
      ),
      latest_per_playlist AS (
        SELECT DISTINCT ON (b.playlist_key, b.isrc)
          b.playlist_key,
          b.isrc,
          b.valid_from,
          b.valid_to
        FROM base b
        ORDER BY b.playlist_key, b.isrc, b.valid_from DESC
      ),
      active_per_playlist AS (
        SELECT l.playlist_key, l.isrc, l.valid_from
        FROM latest_per_playlist l
        WHERE l.valid_to IS NULL OR l.valid_to >= $2
      ),
      current_members AS (
        SELECT a.isrc, MAX(a.valid_from) AS valid_from
        FROM active_per_playlist a
        GROUP BY a.isrc
      )
      SELECT COUNT(DISTINCT btrim(u.aid))::bigint
      FROM current_members cm
      INNER JOIN public.tracks t ON t.isrc = cm.isrc
      CROSS JOIN LATERAL unnest(COALESCE(t.spotify_artist_ids, ARRAY[]::text[])) AS u(aid)
      WHERE u.aid IS NOT NULL AND btrim(u.aid) <> ''
    ),
    0
  );
$$;

COMMENT ON FUNCTION public.playlist_distinct_artist_count(TEXT, DATE) IS
  'Count distinct spotify_artist_ids on tracks with an active playlist membership at run_date (same scope as playlist_top_tracks).';

GRANT EXECUTE ON FUNCTION public.playlist_distinct_artist_count(TEXT, DATE) TO anon, authenticated;
