-- Deepen Perfect Havoc's wine red so it remains distinct from selected. and ATLAST.
UPDATE competitor.labels
SET accent_hex = '7c2947',
    updated_at = NOW()
WHERE label_key = 'perfect_havoc';
