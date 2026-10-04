# Intentionally empty distributor playlists

`config/playlists.csv` explicitly allows empty exports for FH OFFstep and TPS
EmuBands. Other playlists remain protected; do not enable this for catalog
sources or playlists with a positive `min_rows` requirement.

The exporter accepts an empty dashboard only when SOT visibly says
`No items in this dashboard` and the track table contains no track links. It
writes a header-only CSV through the normal export pipeline. A missing export
button without this positive evidence still fails, including on loading/error
pages. A populated dashboard still follows the normal CSV download path.

The existing own-catalog importer accepts these explicitly allowed zero-row
files, closes that playlist's active memberships, and records its empty
membership totals. It does not delete tracks, rewrite historical snapshots, or
reset individual stream counters. Playlist membership-total changes are not
the same thing as negative track listening.

Dashboard synchronization reads track links from tables, not SOT's shared
QUICK LINKS sidebar. Its existing zero-source safety remains in force: an
empty scan never authorizes wiping a populated dashboard. Explicitly allowlisted
non-catalog playlists with no positive minimum are recorded as
`already synced: empty` when the dashboard shows its empty-state heading and
the source playlist has a loaded Tracks section, update controls and no table
or loading indicator. These tasks count in `total_expected_empty`, not
`total_skipped`, so they do not trigger skip emails or repeated empty retries.
Blocked, incomplete, unapproved or populated pages retain the existing safety
handling. When intentionally
emptying another distributor, confirm both its source playlist and SOT
dashboard are genuinely empty before enabling `allow_empty`.

This change does not backfill missed imports or create stream overrides. Once
deployed, a successful export/ingestion is needed before reviewing missing-day
intervals for any justified overrides.

Focused verification:

```powershell
python -m unittest scripts.tests.test_sot_export_dashboards scripts.tests.test_sot_sync_dashboards
```
