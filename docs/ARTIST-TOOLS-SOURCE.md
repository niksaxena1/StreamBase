# artist.tools daily source and fallback

The owner's FREE artist.tools account supplies a second daily cumulative Spotify
count for the own catalog. Counts read on UTC date D are recorded for D in
`public.artist_tools_track_streams`, even when RapidAPI already repaired the track.
Competitor tables, ingestion jobs, and app query paths are unchanged. The job only
uses `add_entity_to_folder` and `list_dashboard_entities` in `My Tracks`; it never
deletes or removes folder entries.

## Rollout and authorization

1. Apply `supabase/migrations/20261010175831_add_artist_tools_source.sql` after the existing track override
   migration. It creates four service-role-only tables with RLS enabled and no
   policies. Reapply it to existing installations to allow a NULL ISRC on ambiguous
   Spotify-ID observations. Review the grants when applying it; no live migration is part of this
   implementation. `artist_tools_oauth` is a secret credential store: do not expose
   its rows in application pages, SQL exports, logs, or analytics.
2. Install Python 3.12 and `requests`. Provide `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` to the local process, then run from the repo root:
   `python scripts/artist_tools_mcp.py authorize`. On the owner's PC, the exact
   command that loads these from `web/.env.local` is:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\StreamBase\scripts\windows\artist_tools_fallback.ps1" -Authorize
   ```

3. Sign into artist.tools and approve in the browser within five minutes. Discovery,
   dynamic registration, PKCE S256, state validation, and a loopback callback on a
   free port store client credentials and tokens in the `default` OAuth row. Tokens
   are never printed. No MCP token GitHub secret is needed.
4. Merge the workflow onto the default branch. Existing GitHub secrets
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are the only required secrets.
   Configure the optional [Windows fallback](../scripts/windows/README-artist-tools.md)
   yourself; the agent does not register it.

Access tokens expire in one hour. Refresh tokens expire in 90 days and rotate on
every refresh. The job refreshes within five minutes of access-token expiry and
persists the replacement refresh token before another MCP call. All runners and
authorization share an atomic ten-minute account lease, renewed during long runs
and retry waits. A second runner aborts; a crashed runner's lease expires after ten
minutes. A 401 gets one refresh and retry. `invalid_grant` is a hard failure with
the message **re-run authorize**: run the same one-time command again. UI revocation
invalidates both tokens. Persistence retries the identical token values, including
a 500 returned after a successful database write. If retries fail, the job retains
the lease and saves a private recovery JSON outside the repository:
`$RUNNER_TEMP/StreamBase/artist-tools-recovery` on GitHub, or
`%LOCALAPPDATA%\StreamBase\artist-tools-recovery` on the PC (POSIX files use 0600;
Windows files use a protected owner-only DACL). Nothing in this directory is an
artifact. The next run on the same machine can conditionally reclaim that lease
and restore the pending token before attempting refresh or reporting `invalid_grant`.
The file is removed after persistence succeeds; stale recovery never replaces a
newer authorization. A different machine waits for lease expiry and cannot read
this local recovery. GitHub's runner temp is ephemeral: if the runner disappears,
or the process crashes before creating recovery, reauthorization can still be
required. OAuth and Postgres cannot make the remote rotation atomic.

## Limits and daily behavior

- Global: 30 requests/minute, 2,500/day; concurrency one.
- Adds: 7/minute, 250/day. Default `--max-adds 240` leaves ten daily additions for
  interactive use. At 240/day, a roughly 3,000-track catalog takes **about 13 days**
  to register; interactive use or quota exhaustion can extend this.
- Lists: 5/minute, 250/day; pages of 100, maximum 100 pages. Requests are paced
  sequentially and retryable limits respect `retryAfterSeconds` with backoff and
  jitter. Daily add exhaustion stops adding cleanly, then observation proceeds.
  Bootstrap reconciliation quota exhaustion also records incomplete coverage and
  exits successfully before any additions. An observation daily limit records partial coverage and available pages; quota
  exhaustion alone is not a hard failure. `observation_incomplete` flags this in
  the summary. Counts beyond the 100-page bound are a hard error.

Run `python scripts/artist_tools_daily.py run --runner manual --max-adds 240`.
`--skip-if-done` skips a successful UTC-date run, checked again inside the lease.
`--date YYYY-MM-DD` must be UTC today: current counts cannot be dated backwards.
Retry without `--skip-if-done` if an intentionally limited/partial successful run
needs another observation pass; interactive calls share the same daily quotas.

Adds prioritize today's latest `individual_tracks_stale` warning, then frequency
in the last 90 days of stale warnings, then latest raw cumulative streams descending.
With an empty saved-track ledger, all existing folder pages are reconciled before
the first add, including unrelated owner's entries (these are never deleted).
Only own-catalog Spotify IDs map to observations. An ID shared by multiple own
ISRCs is recorded once by Spotify ID with NULL `isrc`, listed with all candidate
ISRCs under `ambiguous_spotify_ids` in the summary, and never used for an override
(including older observations of that ID). Pages are persisted as they
are read; tracks without a count are not given fabricated observations.

Repairs use the latest warning for D, only when the full warning has **fewer than
500 tracks**, and require no existing override of any kind, a D observation strictly
above the stale count AND today's current effective count, and a count at least
the previous day's effective value. Today's value is read for each candidate
immediately before its conflict-ignore write, so a completed SOT re-ingestion
that raised the current count is respected.
Missing previous-day values and ambiguous Spotify versions are skipped. Writes
use `ON CONFLICT DO NOTHING`, protecting even concurrent RapidAPI/manual fixes.
The row shape matches the existing overrides with note `stale-fix: artist.tools auto`.
The cascade recompute runs once after writes; retries also recover a cascade
interrupted after previously written artist.tools overrides.
The existing `rapidapi_auto_fix_enabled = false` setting disables fallback
override writes too, while second-source observations continue. A run crossing
UTC midnight aborts before dating a newly read observation to the previous day.

`artist_tools_runs` records running/success/failed, runner, timestamps, counts and
details. `.artifacts/artist_tools_summary.json` contains added, observed, fixed,
remaining_unsaved, rate-limit flags and a sanitized error. Hard errors exit nonzero
so GitHub notifies. The workflow uploads the summary and sends no email.

## Compare sources

Run as the service role or a database administrator. Raw SOT remains unchanged;
the override note identifies whether the effective correction came from RapidAPI
or artist.tools. Compare matching dates and ISRCs, not shifted UI dates:

```sql
select a.date, a.isrc, t.name, a.spotify_track_id,
       a.streams as artist_tools, s.streams_cumulative as sot,
       o.streams_cumulative_override as override_count, o.note as override_source,
       e.streams_cumulative as effective,
       a.streams - s.streams_cumulative as artist_tools_minus_sot
from public.artist_tools_track_streams a
left join public.tracks t on t.isrc = a.isrc
left join public.track_daily_streams s on s.date = a.date and s.isrc = a.isrc
left join public.track_daily_stream_overrides o on o.date = a.date and o.isrc = a.isrc
left join public.track_daily_streams_effective_public e
  on e.date = a.date and e.isrc = a.isrc
where a.date = current_date
order by abs(a.streams - s.streams_cumulative) desc nulls last;
```

This compares recorded counts; RapidAPI values are available only for tracks it
successfully overrode. No live account/database calls are used in the unit tests.
