-- Migration: Add ISRC alias mapping table
--
-- Some tracks are distributed with wrong ISRCs that cannot be corrected at the
-- source (e.g. a playlist on SpotOnTrack). This table lets the ingestion pipeline
-- silently remap old/wrong ISRCs to their correct canonical form before writing
-- any data, so downstream tables only ever contain canonical ISRCs.

CREATE TABLE IF NOT EXISTS public.isrc_aliases (
  old_isrc TEXT PRIMARY KEY,
  canonical_isrc TEXT NOT NULL REFERENCES public.tracks(isrc),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT isrc_aliases_no_self_map CHECK (old_isrc <> canonical_isrc)
);

COMMENT ON TABLE public.isrc_aliases IS
  'Maps wrong/old ISRCs to their correct canonical ISRCs. Used by the ingestion pipeline to silently remap before writing data.';

COMMENT ON COLUMN public.isrc_aliases.old_isrc IS
  'The wrong ISRC as it appears in source exports';

COMMENT ON COLUMN public.isrc_aliases.canonical_isrc IS
  'The correct ISRC that data should be attributed to (must exist in tracks)';

-- Seed with the two known distributor mix-ups.
INSERT INTO public.isrc_aliases (old_isrc, canonical_isrc, note) VALUES
  ('GXBDS2414922', 'GX8KD2590238', 'Geordie - distributor ISRC mix-up'),
  ('GX8LD2390015', 'GX8KD2513256', 'Celestial - distributor ISRC mix-up')
ON CONFLICT (old_isrc) DO NOTHING;
