-- Add configurable payout rate for estimated revenue calculations.
-- Stored as USD per 1,000 streams. Example: 2.00 => 0.002 per stream.

alter table if exists user_settings
  add column if not exists stream_payout_rate_per_k_usd numeric(10, 2) not null default 2.00;

