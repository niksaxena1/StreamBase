# StreamBase Legacy Archive Viewer

Offline Windows viewer for archived streaming and playlist-follower analytics: a StreamBase-style Explorer, Track lookup and a faithful Original dashboards mode. This public folder backs up the software only. **Archive data, generated registries, validation samples and packaged applications must never be committed.**

User instructions: [packaging/README.txt](packaging/README.txt). Architecture and semantics: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Lookup contracts: [docs/TRACK-LOOKUP.md](docs/TRACK-LOOKUP.md).

| Folder | Contents |
|---|---|
| `build/` | Restore, export, derive, registry extraction and validation source |
| `app/` | Python/DuckDB HTTP server, Grafana compatibility SQL and tests |
| `ui/` | Vite/React UI; compiled output goes in ignored `ui/dist/` |
| `packaging/` | PyInstaller spec, launcher/stop scripts and application icon |
| `docs/` | Software semantics and historical verification reports with private samples omitted |

## Configure private inputs

Use a local Python environment with `duckdb`, `psycopg[binary]` and `pyinstaller`, portable PostgreSQL tools, and Node/npm. Set the following variables before importing/running build scripts; each has **no default**. Paths may be absolute or relative to the command's working directory. Keep the original archive tree read-only so its checksum-relative paths remain valid.

| Variable | Value supplied locally |
|---|---|
| `LEGACY_ARCHIVE` | Archive root containing `checksums/SHA256SUMS.local.txt` |
| `LEGACY_BUILD_DIR` | Private generated-output directory, preferably outside the repository |
| `LEGACY_PG_BIN` | Portable PostgreSQL binary directory |
| `LEGACY_PG_DATA` | Local restore cluster directory |
| `LEGACY_PG_USER` | Local restore cluster role; not a production credential |
| `LEGACY_STATS2_DUMP` | Current streams PostgreSQL dump path |
| `LEGACY_STATS_DUMP` | Older streams PostgreSQL dump path |
| `LEGACY_FOLLOWERS_DUMP` | Followers PostgreSQL dump path |
| `LEGACY_STATS2_GRAFANA` | Current streams Grafana SQLite database path |
| `LEGACY_STATS_GRAFANA` | Older streams Grafana SQLite database path |
| `LEGACY_FOLLOWERS_GRAFANA` | Followers Grafana SQLite database path |
| `LEGACY_EXTRACT_DIR` | Reconciled extract directory containing `reconciliation-final/` |
| `LEGACY_FOLLOWER_GROUP` | Original private follower group label used in Ads Running/Stopped row titles |
| `LEGACY_ENV_FILE` | Optional artwork step: local environment file containing Supabase URL and service-role key |
| `LEGACY_SAMPLE_ARTIST` | Validation/review artist filter supplied privately |

`LEGACY_PG_HOST` defaults to loopback (`127.0.0.1`); `LEGACY_PG_PORT` defaults to `55432`. Database names `stats2`, `stats_old`, `playlistfollowers` are **local restore aliases**, not archived server connection details. PostgreSQL authentication can use its standard local environment/passfile configuration; no passwords are stored here.

Optional runtime `LEGACY_REGISTRY` selects a private generated Grafana registry (no environment default). Alternatively put `grafana_registry.json` beside the DuckDB file. Otherwise the scrubbed public definitions are used: query options resolve from the local database, while saved query selections and cached readings are omitted. A private generated registry preserves the original saved defaults and panel metadata. Treat it as private data.

## Rebuild from the archive

Run from this folder after configuring the variables above:

```powershell
python build/build_all.py --skip-artwork # restore -> export -> derive -> inventory
python build/fetch_artwork.py           # optional network step; requires LEGACY_ENV_FILE
python build/extract_panels.py --duckdb "$env:LEGACY_BUILD_DIR/legacy_archive.duckdb"
python build/validate_panels.py --duckdb "$env:LEGACY_BUILD_DIR/legacy_archive.duckdb"
python build/summarize_validation.py --validation "$env:LEGACY_BUILD_DIR/panel_validation.json"
cd ui
npm ci
npm test
npm run build
cd ..
python app/server.py --db "$env:LEGACY_BUILD_DIR/legacy_archive.duckdb" --art "$env:LEGACY_BUILD_DIR/art" --port 8770
```

Extraction and validation write private registry/report files under `LEGACY_BUILD_DIR`, rather than replacing public source. The extractor reads dashboard definitions, which can include private operational text; never commit its raw output. Panel SQL and layout are backed up in the scrubbed `app/grafana_registry.json`. The packaged proof summary contains outcome counts and generic notes only.

Source startup requires `--db` (no default); `--art` is optional, with initials tiles when omitted. `--no-browser` skips opening a window; `--instance-dir DIR` separates a test instance's lock. Frozen packages use their own relative `data/` and `art/` folders.

For a private Windows package, supply `-Destination`, `-Python` (Python executable) and `-Database` to `packaging/package.ps1`. Optional `-ArtSource` and `-Registry` copy locally generated assets into it. None of these inputs has a default. Keep the destination outside tracked source or in an ignored package folder.

## Verify

```powershell
python -m unittest discover -s app/tests
cd ui
npm test
npm run build
node scripts/verify-dist.mjs
```

Data-free Python icon/window/configuration tests run without an archive. API, artwork, lookup and original-mode integration tests skip unless `LEGACY_TEST_DB` points to a private DuckDB archive. `LEGACY_TEST_ART` optionally supplies artwork; original-mode tests also use `LEGACY_SAMPLE_ARTIST`. Live endpoint sweeps, latency measurements, process smoke checks and PostgreSQL parity validation need archive data. Latency checks require `--db` and `--output`; source smoke checks require `--db` and `--output` (optional `--art`), or use `--exe` for a package. Use `LEGACY_REGISTRY` when testing historical defaults.

Icon rebuild: `python packaging/make_icon.py`. The Edge app window opens at 1600x1000, clamped to the screen's work area. Existing repository CI remains scoped to `web/` and pipeline paths; this standalone viewer adds no workflow changes.
