# Supabase migrations

Database changes live in `supabase/migrations/<UTC timestamp>_<descriptive_name>.sql`.
Use a 14-digit UTC timestamp (`YYYYMMDDHHMMSS`); versions must be unique and
prerequisites must sort before their follow-ups. Keep names descriptive and
update the relevant operations and product docs when adding SQL.

## Applying new changes

Create a file with `supabase migration new <descriptive_name>`, or create it
directly using the same UTC naming convention. Review the timestamp and order
before applying it. Apply SQL through the Supabase MCP migration tool or the
Supabase CLI; record the local version and the remote migration identity so
future history reconciliation can match them.

For a CLI-linked project with reconciled history:

```bash
supabase login
supabase link --project-ref <project-ref>
supabase migration list
supabase db push --dry-run
supabase db push
```

`db push` uses remote history to decide which local versions are pending.
Do not push the historical files merely because their new local versions
appear pending. Renaming a file does not establish whether its SQL is applied.

## One-time CLI history baseline: manual owner decision

Migrations applied earlier through the Supabase MCP are already recorded under
their own names in `supabase_migrations.schema_migrations`. Remote history is
**not assumed empty**, and these records must be reconciled before establishing
a baseline for the timestamped local files. Some local files combine several
MCP migrations or are references for changes applied in parts.

An owner would first inspect `supabase migration list`, the existing history
rows (versions, names, and recorded statements), and the live schema. Build a
reviewed mapping from each local file to the existing remote records, noting
partial, superseded, missing, and genuinely pending changes. Verify effects and
save the history/schema evidence before making any history repair decision.

Only after that review would the owner choose whether to retain/map existing
records or mark specific verified local versions applied. A CLI repair would
use `supabase migration repair --status applied <verified-version>` for the
individually approved versions; it changes history, not the schema. Do not
blanket-mark every file or use a date cutoff. Re-list history and review a
`db push --dry-run` before applying any genuinely pending SQL.

This repository provides **no automatic baseline script**. No remote history
repair or database application is part of this directory migration.

## Grants and schema boundaries

Follow [AGENTS.md](../AGENTS.md): new `public` tables need explicit Data API
grants as well as RLS policies. RLS alone does not grant table access. Use the
narrowest privileges: `authenticated` for application users, `service_role`
for backend operations, and `anon` only for intentional unauthenticated access.
Review Supabase Security Advisor and Data API exposure/grants before broad
schema changes. Keep competitor analytics in `competitor`, with separate jobs;
own-catalog analytics stay in `public`.

## Historical rollout order and fresh databases

The 180 SQL files were moved from the former loose directory without SQL
changes in the rename commit. Their timestamps come from the UTC commit time
of their first addition, following actual renames rather than copies. Files
added together use dependency order and one-second offsets for unique versions.
See the [complete order-adjustment table](MIGRATION-ORDER.md), including the
security hardening/follow-up and the October 2026 additions. Subsequent SQL
edits update migration references in comments only.

The app's `/docs` inventory reads this directory. `web/next.config.ts` explicitly
includes its SQL files in the `/docs` deployment trace so production packages
retain the same inventory as local development.

This directory is incremental history, not a complete fresh-database bootstrap.
Core tables predate it, some production changes were applied through MCP in
parts, and `public.is_admin()` is environment-specific. Before rebuilding an
environment, have the owner prepare a reviewed schema baseline and reconcile
which later files remain applicable. See [NOTES_is_admin.md](NOTES_is_admin.md).
