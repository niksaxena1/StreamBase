-- Run once if you already applied add_concentration_share_snapshots_expires_at.sql with a 30-day default.
-- The app always sets expires_at on insert; this only aligns the column default for any direct SQL inserts.
alter table public.concentration_share_snapshots
  alter column expires_at set default (now() + interval '7 days');
