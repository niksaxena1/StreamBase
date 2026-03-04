-- Create RPC to fetch all historical negative daily streams (stream corrections/anomalies)
CREATE OR REPLACE FUNCTION public.home_negative_daily_streams()
RETURNS TABLE(
  isrc text,
  name text,
  artist_names text[],
  artist_ids text[],
  album_image_url text,
  date date,
  daily_streams_delta bigint,
  total_streams_cumulative bigint
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    t.isrc,
    COALESCE(t.name, t.isrc)::text AS name,
    t.spotify_artist_names::text[] AS artist_names,
    t.spotify_artist_ids::text[] AS artist_ids,
    t.spotify_album_image_url::text AS album_image_url,
    today.date,
    (today.streams_cumulative - prev.streams_cumulative)::bigint AS daily_streams_delta,
    today.streams_cumulative::bigint AS total_streams_cumulative
  FROM public.track_daily_streams_effective_public today
  JOIN public.track_daily_streams_effective_public prev
    ON prev.isrc = today.isrc
   AND prev.date = (today.date - INTERVAL '1 day')::date
  JOIN public.tracks t ON t.isrc = today.isrc
  WHERE today.streams_cumulative < prev.streams_cumulative
  ORDER BY today.date DESC, daily_streams_delta ASC;
$$;

GRANT EXECUTE ON FUNCTION public.home_negative_daily_streams() TO anon, authenticated;
