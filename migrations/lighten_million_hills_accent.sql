-- Keep Million Hills visibly separate from Soave's deeper tan-gold accent.
UPDATE competitor.labels
SET accent_hex = 'f9d5a7',
    updated_at = NOW()
WHERE label_key = 'million_hills';
