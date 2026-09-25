-- Remove duplicate playlist_memberships row for ISRC SE6XY2154328 on ext.
-- The track was correctly in ext from 2026-01-28 (row c3115341...). A mistaken
-- second row was added with valid_from 2026-02-01 (e00d60ae...), causing the
-- track to appear twice from 2026-02-01 onward. Delete the erroneous row only.
DELETE FROM public.playlist_memberships
WHERE id = 'e00d60ae-e795-499d-83dc-d132e8e15bec'
  AND playlist_key = 'ext'
  AND UPPER(TRIM(isrc)) = 'SE6XY2154328';
