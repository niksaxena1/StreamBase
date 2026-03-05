-- Check enrichment status for Alenn - Touch Me
-- Run this in Supabase SQL Editor
--
-- ISRCs from the screenshot: SE62M2287950 (tables), SE62M2287960 (detail)

-- 1. Track enrichment (album artwork, Spotify metadata)
SELECT
  isrc,
  name,
  spotify_album_image_url IS NOT NULL AS has_album_image,
  spotify_album_image_url,
  spotify_track_id,
  spotify_artist_ids,
  spotify_artist_names,
  spotify_last_fetched_at
FROM tracks
WHERE isrc IN ('SE62M2287950', 'SE62M2287960');

-- 2. Artist image cache (for each artist ID from the tracks above)
-- Run after the first query if you see artist IDs
SELECT
  ai.artist_id,
  ai.name,
  ai.image_url IS NOT NULL AS has_image,
  ai.image_url,
  ai.refreshed_at
FROM spotify_artist_images ai
WHERE ai.artist_id IN (
  SELECT unnest(spotify_artist_ids)
  FROM tracks
  WHERE isrc IN ('SE62M2287950', 'SE62M2287960')
    AND spotify_artist_ids IS NOT NULL
);
