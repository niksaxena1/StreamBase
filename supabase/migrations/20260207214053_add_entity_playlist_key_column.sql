-- Migration: Add entity_playlist_key column to playlists table
-- Maps Distro playlists to their parent Entity playlist for drift detection

ALTER TABLE playlists
ADD COLUMN IF NOT EXISTS entity_playlist_key TEXT;

-- Self-referential FK: must point to an existing playlist_key
ALTER TABLE playlists
DROP CONSTRAINT IF EXISTS playlists_entity_playlist_key_fkey;

ALTER TABLE playlists
ADD CONSTRAINT playlists_entity_playlist_key_fkey
FOREIGN KEY (entity_playlist_key) REFERENCES playlists(playlist_key);

COMMENT ON COLUMN playlists.entity_playlist_key IS 'Parent Entity playlist_key for Distro playlists. Used for entity-vs-distro track drift detection.';
