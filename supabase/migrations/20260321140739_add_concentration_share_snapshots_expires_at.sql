-- TTL for concentration share links (7 days). Safe to run if the column already exists (greenfield installs).
alter table public.concentration_share_snapshots
  add column if not exists expires_at timestamptz;

update public.concentration_share_snapshots
  set expires_at = created_at + interval '7 days'
  where expires_at is null;

alter table public.concentration_share_snapshots
  alter column expires_at set default (now() + interval '7 days');

alter table public.concentration_share_snapshots
  alter column expires_at set not null;

create index if not exists concentration_share_snapshots_expires_at_idx
  on public.concentration_share_snapshots (expires_at);
