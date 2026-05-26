-- Per-competitor accent color extracted from label thumbnail (image_url).
-- Populated by: cd web && npm run extract-competitor-accents

ALTER TABLE competitor.labels
  ADD COLUMN IF NOT EXISTS accent_hex text;

COMMENT ON COLUMN competitor.labels.accent_hex IS
  'Vibrant accent extracted from image_url. 6-char hex no #. Populated by web/scripts/extract-competitor-accents.ts.';
