-- Check what tracks are in the catalog stream data for 2026-01-27
-- Run this in Supabase SQL editor

SELECT COUNT(*) as total_catalog_tracks
FROM track_daily_streams
WHERE date = '2026-01-27';

-- Check if specific ISRCs are in the catalog
SELECT isrc, streams
FROM track_daily_streams  
WHERE date = '2026-01-27'
  AND isrc IN (
    'GBJG25538439',  -- Golden Sky
    'GBJG25538448',  -- As It Was
    'GBJG25608218',  -- Back To Me
    'GBJG25608322',  -- Bittersweet
    'GBJG25608323',  -- Pontes
    'GBJG25608423',  -- Dancing In Circles
    'GBJG25608425',  -- I Think I Like It
    'GBJG25608586'   -- Outgrow You
  )
ORDER BY isrc;

-- Also check what's in gahara_records_releases playlist membership
SELECT COUNT(*) as gahara_playlist_size
FROM playlist_memberships
WHERE playlist_key = 'gahara_records_releases'
  AND lte('valid_from', '2026-01-27')
  AND (valid_to IS NULL OR gte('valid_to', '2026-01-27'));

-- Check if those ISRCs are members of gahara_records_releases on that date
SELECT isrc
FROM playlist_memberships
WHERE playlist_key = 'gahara_records_releases'
  AND lte('valid_from', '2026-01-27')
  AND (valid_to IS NULL OR gte('valid_to', '2026-01-27'))
  AND isrc IN (
    'GBJG25538439',
    'GBJG25538448',
    'GBJG25608218',
    'GBJG25608322',
    'GBJG25608323',
    'GBJG25608423',
    'GBJG25608425',
    'GBJG25608586'
  )
ORDER BY isrc;
