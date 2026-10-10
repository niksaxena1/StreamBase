#!/usr/bin/env python
"""Download SMALL cover / artist thumbnails for the archive's tracks and artists.

Owner-approved scope: tiny JPEGs only (covers 64x64, artist photos 160x160, ~15 MB in total),
fetched once at build time from i.scdn.co and cached in <build dir>/art. The shipped viewer is
fully offline and only serves these local files.

Data sources (read-only GET requests, StreamBase PostgREST):
  tracks(isrc, spotify_album_image_url, spotify_artist_ids, spotify_artist_names)
  spotify_artist_images(artist_id, name, image_url)
Credentials are read from LEGACY_ENV_FILE when this script runs. The service-role key is used only
as an HTTP header: it is never printed, logged, written to the database or packaged.

Usage: python fetch_artwork.py [--db PATH] [--art DIR] [--skip-download]
Writes DuckDB tables art_tracks(isrc, file) and art_artists(artist_name, spotify_artist_id, file).
The database must not be open in any other process (run before the viewer server starts).
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import common as C  # noqa: E402

ENV_FILE = Path(C.required_env("LEGACY_ENV_FILE"))
ART_DIR = C.BUILD_DIR / "art"
REPORT = C.BUILD_DIR / "artwork_report.json"

COVER_SIZE = "ab67616d00004851"  # 64x64
COVER_SOURCES = ("ab67616d0000b273", "ab67616d00001e02", COVER_SIZE)
ARTIST_SIZE = "ab6761610000f178"  # 160x160
ARTIST_SOURCES = ("ab6761610000e5eb", "ab67616100005174", ARTIST_SIZE)
IMAGE_PREFIX = "https://i.scdn.co/image/"
CONCURRENCY = 4
PAGE = 1000


def normalized(value: str) -> str:
    """Same rule as app/api_lookup.normalized: case- and accent-insensitive, folds o-slash / l-stroke."""
    text = unicodedata.normalize("NFKD", (value or "").casefold())
    return "".join(c for c in text if not unicodedata.combining(c)).replace("ø", "o").replace("ł", "l")


def read_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip().strip('"').strip("'")
    return env


class Rest:
    """Read-only PostgREST client. The key lives only in request headers; errors never echo them."""

    def __init__(self, env: dict[str, str]):
        base = env.get("SUPABASE_URL") or env.get("NEXT_PUBLIC_SUPABASE_URL")
        key = env.get("SUPABASE_SERVICE_ROLE_KEY")
        if not base or not key:
            raise SystemExit("SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY are required in web/.env.local")
        self._base = base.rstrip("/") + "/rest/v1/"
        self._headers = {"apikey": key, "Authorization": "Bearer " + key, "Accept": "application/json"}

    def pages(self, table: str, columns: str, order: str):
        start = 0
        while True:
            request = urllib.request.Request(
                f"{self._base}{table}?select={columns}&order={order}", method="GET",
                headers={**self._headers, "Range-Unit": "items", "Range": f"{start}-{start + PAGE - 1}"})
            for attempt in range(5):
                try:
                    with urllib.request.urlopen(request, timeout=60) as response:
                        rows = json.loads(response.read())
                    break
                except (urllib.error.URLError, TimeoutError) as error:
                    if attempt == 4:
                        status = getattr(error, "code", None)
                        raise SystemExit(f"PostgREST read of {table} failed (HTTP {status or 'network'})") from None
                    time.sleep(2 ** attempt)
            yield from rows
            if len(rows) < PAGE:
                return
            start += PAGE


def swap_size(url: str | None, sources: tuple[str, ...], target: str) -> str | None:
    if not url or not url.startswith(IMAGE_PREFIX):
        return None
    image = url[len(IMAGE_PREFIX):]
    if len(image) < 24 or image[:16] not in sources:
        return None
    return IMAGE_PREFIX + target + image[16:]


def download(url: str, destination: Path) -> str:
    """Returns 'ok', 'missing' (HTTP 404/403) or 'failed'. Atomic write; JPEG magic verified."""
    for attempt in range(4):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "StreamBase-LegacyViewer-build/1.0", "Accept": "image/jpeg"})
            with urllib.request.urlopen(request, timeout=20) as response:
                data = response.read(2_000_000)
            if data[:3] != b"\xff\xd8\xff":
                return "failed"
            temp = destination.with_suffix(".part")
            temp.write_bytes(data)
            os.replace(temp, destination)
            return "ok"
        except urllib.error.HTTPError as error:
            if error.code in (403, 404, 410):
                return "missing"
            if error.code not in (429, 500, 502, 503, 504):
                return "failed"
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            pass
        time.sleep(1.5 * 2 ** attempt)
    return "failed"


def fetch_group(jobs: dict[str, list[Path]], label: str) -> tuple[dict[str, str], int]:
    """jobs: url -> destination files (several ISRCs can share one cover). Returns url -> status."""
    status: dict[str, str] = {}
    pending = []
    for url, files in jobs.items():
        if all(f.exists() for f in files):
            status[url] = "cached"
        else:
            pending.append(url)
    print(f"  {label}: {len(jobs)} unique images, {len(jobs) - len(pending)} cached, {len(pending)} to download", flush=True)
    downloaded = 0
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        futures = {}
        for url in pending:
            first = next((f for f in jobs[url] if f.exists()), jobs[url][0])
            futures[pool.submit(download, url, first)] = (url, first)
        for done, future in enumerate(as_completed(futures), 1):
            url, first = futures[future]
            status[url] = future.result()
            if status[url] == "ok":
                downloaded += 1
                for other in jobs[url]:
                    if other != first:
                        shutil.copyfile(first, other)
            if done % 250 == 0:
                print(f"    {done}/{len(pending)}", flush=True)
    return status, downloaded


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--db", type=Path, default=C.OUT_DB)
    parser.add_argument("--art", type=Path, default=ART_DIR)
    parser.add_argument("--skip-download", action="store_true", help="only rebuild the tables from files already cached")
    args = parser.parse_args()

    import duckdb
    try:
        con = duckdb.connect(str(args.db))
    except duckdb.IOException as error:
        print(f"Cannot open {args.db} read-write: {str(error).splitlines()[0]}\nStop any viewer server using it, then rerun.", file=sys.stderr)
        return 2
    isrcs = [r[0] for r in con.execute("select isrc from isrc_identity order by isrc").fetchall()]
    credits = [(r[0], r[1]) for r in con.execute("select isrc,artist from isrc_identity").fetchall()]
    archive_artists = {a.strip() for _, credit in credits for a in credit.split(",") if a.strip()}
    archive_artists |= {r[0] for r in con.execute("select artist_name from src_artists").fetchall() if r[0] and r[0].strip()}
    print(f"archive: {len(isrcs)} ISRCs, {len(archive_artists)} artist names", flush=True)

    tracks_dir, artists_dir = args.art / "tracks", args.art / "artists"
    tracks_dir.mkdir(parents=True, exist_ok=True)
    artists_dir.mkdir(parents=True, exist_ok=True)
    report: dict = {"fetched_at": C.now_iso(), "cover_404": [], "artist_404": [], "failed": []}

    rest = Rest(read_env(ENV_FILE))
    print("reading StreamBase tracks + spotify_artist_images (read-only)...", flush=True)
    wanted = set(isrcs)
    track_rows = {}
    for row in rest.pages("tracks", "isrc,spotify_album_image_url,spotify_artist_ids,spotify_artist_names", "isrc.asc"):
        if row["isrc"] in wanted:
            track_rows[row["isrc"]] = row
    image_rows = list(rest.pages("spotify_artist_images", "artist_id,name,image_url", "artist_id.asc"))
    images_by_id = {r["artist_id"]: r for r in image_rows if r.get("artist_id")}
    print(f"  StreamBase tracks matching the archive: {len(track_rows)}; artist image rows: {len(image_rows)}", flush=True)

    # ---- covers -----------------------------------------------------------------------------
    cover_jobs: dict[str, list[Path]] = defaultdict(list)
    for isrc in isrcs:
        url = swap_size((track_rows.get(isrc) or {}).get("spotify_album_image_url"), COVER_SOURCES, COVER_SIZE)
        if url:
            cover_jobs[url].append(tracks_dir / f"{isrc}.jpg")
    # ---- artists: name -> spotify id via same-ISRC credit pairing, then unique exact-name fallback
    votes: dict[str, Counter] = defaultdict(Counter)
    credit_by_isrc = dict(credits)
    for isrc, row in track_rows.items():
        names, ids = row.get("spotify_artist_names") or [], row.get("spotify_artist_ids") or []
        spotify_pairs = {normalized(n): i for n, i in zip(names, ids)}
        for name in (a.strip() for a in credit_by_isrc[isrc].split(",") if a.strip()):
            artist_id = spotify_pairs.get(normalized(name))
            if artist_id:
                votes[name][artist_id] += 1
    by_name = defaultdict(set)
    for r in image_rows:
        by_name[normalized(r.get("name") or "")].add(r["artist_id"])
    artist_ids: dict[str, str] = {}
    via_credit = via_fallback = 0
    for name in sorted(archive_artists):
        if votes.get(name):
            artist_ids[name] = votes[name].most_common(1)[0][0]
            via_credit += 1
        elif len(by_name.get(normalized(name), ())) == 1:
            artist_ids[name] = next(iter(by_name[normalized(name)]))
            via_fallback += 1
    artist_jobs: dict[str, list[Path]] = defaultdict(list)
    seen_files: set[Path] = set()
    for name, artist_id in artist_ids.items():
        url = swap_size((images_by_id.get(artist_id) or {}).get("image_url"), ARTIST_SOURCES, ARTIST_SIZE)
        target = artists_dir / f"{artist_id}.jpg"
        if url and target not in seen_files:
            artist_jobs[url].append(target)
            seen_files.add(target)
    print(f"  artist ids: {via_credit} via same-ISRC credit pairing, {via_fallback} via unique name fallback, "
          f"{len(archive_artists) - len(artist_ids)} unmatched", flush=True)

    # ---- download ---------------------------------------------------------------------------
    started = time.time()
    if not args.skip_download:
        status, n_covers = fetch_group(cover_jobs, "covers 64px")
        report["cover_404"] = sorted(u for u, s in status.items() if s == "missing")
        report["failed"] += sorted(u for u, s in status.items() if s == "failed")
        status, n_artists = fetch_group(artist_jobs, "artist photos 160px")
        report["artist_404"] = sorted(u for u, s in status.items() if s == "missing")
        report["failed"] += sorted(u for u, s in status.items() if s == "failed")
        print(f"  downloaded {n_covers} covers + {n_artists} artist photos in {time.time() - started:.0f}s", flush=True)

    # ---- tables from the files that exist ---------------------------------------------------
    art_tracks = [(i, f"tracks/{i}.jpg") for i in isrcs if (tracks_dir / f"{i}.jpg").is_file()]
    art_artists = [(n, i, f"artists/{i}.jpg") for n, i in sorted(artist_ids.items()) if (artists_dir / f"{i}.jpg").is_file()]
    con.execute("create or replace table art_tracks(isrc varchar, file varchar)")
    con.execute("create or replace table art_artists(artist_name varchar, spotify_artist_id varchar, file varchar)")
    con.executemany("insert into art_tracks values (?,?)", art_tracks)
    con.executemany("insert into art_artists values (?,?,?)", art_artists)
    con.execute("checkpoint")
    con.close()

    megabytes = sum(f.stat().st_size for f in args.art.rglob("*.jpg")) / 1e6
    named_artists = len({n for n, _, _ in art_artists})
    report.update({"covers": len(art_tracks), "archive_isrcs": len(isrcs), "artist_photos": named_artists,
                   "archive_artists": len(archive_artists), "megabytes": round(megabytes, 2)})
    C.BUILD_DIR.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, indent=1), encoding="utf-8")
    print("\n================ ARTWORK COVERAGE ================")
    print(f"  covers:        {len(art_tracks)} / {len(isrcs)} archive ISRCs ({100 * len(art_tracks) / max(1, len(isrcs)):.1f}%)")
    print(f"  artist photos: {named_artists} / {len(archive_artists)} archive artists ({100 * named_artists / max(1, len(archive_artists)):.1f}%)")
    print(f"  unreachable (404): {len(report['cover_404'])} covers, {len(report['artist_404'])} artist photos; failed: {len(report['failed'])}")
    print(f"  total size:    {megabytes:.2f} MB in {args.art}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
