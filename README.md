# SBase

SBase is a web app + automated pipeline that ingests daily SpotOnTrack CSV exports to build a long-term, queryable database of Spotify stream counts for your catalog and operational playlists.

For the current milestone, this repo contains the **daily exporter** (GitHub Actions + Playwright) that downloads CSV exports from SpotOnTrack dashboards.

## Getting Started

### Prereqs

- Python 3.12+
- A SpotOnTrack account already logged in via browser
- GitHub repo secret to store the Playwright session cookie jar (storage state)

### 1) Create the SpotOnTrack storage state (one-time, local)

This opens a browser window so you can log in once, then it saves a `storage_state` JSON we can reuse in CI.

```bash
python -m pip install -r requirements.txt
python -m playwright install chromium
python scripts/sot_save_storage_state.py --out sot_state.json
```

### 2) Create the GitHub Actions secret

Create a repo secret named `SOT_STORAGE_STATE_B64` containing base64 of `sot_state.json`.
This is the preferred method. If the session expires too frequently, you can additionally set `SOT_EMAIL` and `SOT_PASSWORD` secrets to enable an auto-login fallback.

**PowerShell (Windows):**

```powershell
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes("sot_state.json"))
gh secret set SOT_STORAGE_STATE_B64 --body $b64
```

**bash (macOS/Linux):**

```bash
gh secret set SOT_STORAGE_STATE_B64 --body "$(base64 -w 0 sot_state.json)"
```

### 3) Run the exporter locally (optional)

Exports land in `exports/YYYY/MM/DD/<playlist_key>.csv`.

```bash
python scripts/sot_export_dashboards.py --config config/playlists.csv --storage-state sot_state.json
```

### 4) Run the GitHub Action

- Go to GitHub → Actions → `SOT Daily Export` → **Run workflow**
- Or wait for the daily schedule (12:00 UTC)

The workflow uploads the `exports/` folder as an artifact.

## Tech Stack

- Exporter: Python + Playwright
- App: Next.js (App Router) + Supabase

## Web app (UI)

The Next.js app lives in `web/`.

### Local run

1) Create `web/.env.local` from `web/env.example` and fill:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

2) Run:

```powershell
cd web
npm install
npm run dev
```

## Competitor Mode pilot

SpotiBase now has a separated competitor-tracking pilot for Paraíso. Competitor data lives in its own `competitor` schema, uses `config/competitor_playlists.csv`, and is refreshed through the dedicated `SOT Competitor ...` GitHub Actions workflows. See `docs/COMPETITOR-MODE-OPERATIONS.md` for the first-run sequence.
