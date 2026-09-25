-- Migration: Public views for Ledgenta cross-project playlist integration
--
-- Ledgenta queries SpotiBase using the anon key. RLS on the underlying tables
-- blocks anon from reading rows (no anon-friendly policy exists).
-- Follow the same pattern as track_daily_streams_effective_public: expose a
-- read-only VIEW (which runs as the view owner and bypasses table RLS), then
-- GRANT SELECT to anon.
--
-- Views created:
--   playlist_memberships_public  — ISRC ↔ playlist edges with validity dates
--   playlists_public             — playlist metadata (name, type, image, etc.)

CREATE OR REPLACE VIEW public.playlist_memberships_public AS
SELECT playlist_key, isrc, valid_from, valid_to
FROM public.playlist_memberships;

GRANT SELECT ON public.playlist_memberships_public TO anon, authenticated;

CREATE OR REPLACE VIEW public.playlists_public AS
SELECT playlist_key, display_name, is_catalog, playlist_type,
       spotify_playlist_id, spotify_playlist_image_url
FROM public.playlists;

GRANT SELECT ON public.playlists_public TO anon, authenticated;
