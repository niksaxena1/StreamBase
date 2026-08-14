-- Use a deep wine red between selected.'s scarlet and ATLAST's pink.
UPDATE competitor.labels
SET accent_hex = '8b1e3f',
    updated_at = NOW()
WHERE label_key = 'perfect_havoc';
