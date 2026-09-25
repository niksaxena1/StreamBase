# Supabase migrations

All database changes live in `supabase/migrations/` as
`<YYYYMMDDHHMMSS>_<descriptive_name>.sql`. The timestamp prefix is the rollout
order; the Supabase CLI records each applied version in
`supabase_migrations.schema_migrations`, so you can always see what has and
hasn't been applied.

## Everyday workflow

```bash
# once per machine
supabase login
supabase link --project-ref <streambase-project-ref>

# new change
supabase migration new add_something_descriptive   # creates supabase/migrations/<now>_add_something_descriptive.sql
# ...write SQL (keep it idempotent: IF NOT EXISTS / CREATE OR REPLACE)...

supabase migration list   # local vs remote: what is pending
supabase db push          # applies only the pending files, in order
```

Pasting a file into the SQL editor still works in a pinch, but then run
`supabase migration repair --status applied <version>` so the history stays
accurate.

## One-time switch-over (history baseline)

Everything up to `20260921235436_add_tg_symphonic_playlist.sql` was applied by
hand before this folder existed, so the remote history table is empty. Mark
those as applied once:

```bash
scripts/supabase_baseline_migration_history.sh   # marks versions <= 20260921235436
supabase migration list                          # remaining rows = still to push
supabase db push
```

## How the historical versions were assigned

The 175 pre-existing files were renamed from `migrations/<name>.sql`. Each got
the UTC timestamp of the commit that first added it; files added in the same
commit were ordered so that a file comes after any sibling whose tables,
views or functions it references, with +1s steps to keep versions unique. Names
are unchanged after the prefix, so `git log --follow` and grepping for the
old name still work.

## Rebuilding a fresh database

The core tables (`tracks`, `track_daily_streams`, `playlists`, ...) predate the
migrations folder, and some migrations depend on an environment-specific
`public.is_admin()` (see `NOTES_is_admin.md`). To stand up a fresh copy,
generate a baseline from production first:

```bash
supabase db dump --schema public,competitor,playlist_watch -f supabase/baseline_schema.sql
```

Apply that, create `is_admin()`, then `supabase db push` for anything newer.
