-- Keep Perfect Havoc's red distinct from selected.'s scarlet in all competitor UI.
UPDATE competitor.labels
SET accent_hex = 'a9156f',
    updated_at = NOW()
WHERE label_key = 'perfect_havoc';
