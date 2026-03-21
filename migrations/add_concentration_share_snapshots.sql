-- Read-only public shares: snapshot JSON for stream concentration table (loaded via service role only).
create table if not exists public.concentration_share_snapshots (
  id uuid primary key default gen_random_uuid(),
  token text not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_by uuid references auth.users (id) on delete set null
);

create unique index if not exists concentration_share_snapshots_token_uidx
  on public.concentration_share_snapshots (token);

create index if not exists concentration_share_snapshots_expires_at_idx
  on public.concentration_share_snapshots (expires_at);

alter table public.concentration_share_snapshots enable row level security;
