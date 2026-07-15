import argparse
import csv
import hashlib
import os
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Tuple

from playwright.sync_api import TimeoutError as PWTimeout
from playwright.sync_api import sync_playwright

NAV_TIMEOUT_MS = 45_000
BTN_TIMEOUT_MS = 60_000
DOWNLOAD_TIMEOUT_MS = 60_000

MAX_EXPORT_RETRIES = 5
RETRY_SLEEP_SECONDS = 2.0

# Windows consoles commonly default to a legacy encoding (e.g. cp1252) which
# can't encode emoji used in logs. Force UTF-8 when possible to prevent
# UnicodeEncodeError on local runs.
try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass


@dataclass(frozen=True)
class Playlist:
    key: str
    name: str
    url: str
    is_catalog: bool
    min_rows: int = 0
    allow_empty: bool = False


EMPTY_EXPORT_COLUMNS = ["isrc", "name", "release_date", "spotify_streams_total"]


def parse_bool(raw: object) -> bool:
    return str(raw or "").strip().lower() in {"1", "true", "yes", "y"}


def utc_date_parts() -> Tuple[str, str, str]:
    d = datetime.now(timezone.utc).date()
    return f"{d.year:04d}", f"{d.month:02d}", f"{d.day:02d}"


def is_logged_out(page) -> bool:
    return "/login" in (page.url or "")

def try_login(page, email: str, password: str) -> bool:
    """
    Best-effort login flow for SpotOnTrack.
    This intentionally uses multiple fallback selectors since the login page may change.
    """
    if not email or not password:
        return False

    page.goto("https://www.spotontrack.com/login", wait_until="domcontentloaded", timeout=NAV_TIMEOUT_MS)
    time.sleep(0.6)

    # Email field
    email_locators = [
        page.get_by_label("Email", exact=False),
        page.locator("input[type='email']"),
        page.locator("input[name='email']"),
        page.locator("input[placeholder*='mail' i]"),
    ]
    email_box = None
    for loc in email_locators:
        try:
            if loc.count() > 0:
                email_box = loc.first
                break
        except Exception:
            pass
    if email_box is None:
        return False

    # Password field
    pwd_locators = [
        page.get_by_label("Password", exact=False),
        page.locator("input[type='password']"),
        page.locator("input[name='password']"),
    ]
    pwd_box = None
    for loc in pwd_locators:
        try:
            if loc.count() > 0:
                pwd_box = loc.first
                break
        except Exception:
            pass
    if pwd_box is None:
        return False

    try:
        email_box.fill(email)
        pwd_box.fill(password)
    except Exception:
        return False

    # Submit
    submit_locators = [
        page.get_by_role("button", name="Log in", exact=False),
        page.get_by_role("button", name="Login", exact=False),
        page.get_by_role("button", name="Sign in", exact=False),
        page.locator("button[type='submit']"),
        page.locator("input[type='submit']"),
    ]
    submit_btn = None
    for loc in submit_locators:
        try:
            if loc.count() > 0:
                submit_btn = loc.first
                break
        except Exception:
            pass
    if submit_btn is None:
        return False

    try:
        submit_btn.click()
    except Exception:
        return False

    # Wait for navigation and/or dashboard load.
    try:
        page.wait_for_load_state("networkidle", timeout=NAV_TIMEOUT_MS)
    except Exception:
        pass

    # Some apps redirect to /dashboard or /dashboard/<id> when logged in.
    if "/login" in (page.url or ""):
        return False

    return True


def ensure_logged_in(page, email: str, password: str) -> bool:
    """
    If the current page is logged out, attempt to re-login (best effort).
    """
    if not is_logged_out(page):
        return True

    print("🔐 Detected logged-out session. Attempting login fallback...")
    ok = try_login(page, email=email, password=password)
    if not ok:
        print("❌ Login fallback failed.")
        return False

    # Re-check by visiting dashboard root.
    page.goto("https://www.spotontrack.com/dashboard", wait_until="networkidle", timeout=NAV_TIMEOUT_MS)
    return not is_logged_out(page)


def wait_for_export_button(page) -> bool:
    btn = page.get_by_role("button", name="Export CSV")
    try:
        btn.first.wait_for(state="visible", timeout=BTN_TIMEOUT_MS)
        return True
    except Exception:
        fb = page.locator("button:has-text('Export CSV'), a:has-text('Export CSV')")
        try:
            fb.first.wait_for(state="visible", timeout=BTN_TIMEOUT_MS)
            return True
        except Exception:
            return False


def click_export_csv(page) -> bool:
    btn = page.get_by_role("button", name="Export CSV")
    if btn.count() > 0:
        btn.first.click()
        return True

    fb = page.locator("button:has-text('Export CSV'), a:has-text('Export CSV')")
    if fb.count() > 0:
        fb.first.click()
        return True

    return False


def write_empty_export(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(".tmp.csv")
    with open(tmp_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(EMPTY_EXPORT_COLUMNS)
    tmp_path.replace(path)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def count_csv_rows(path: Path) -> int:
    """Counts data rows (excluding the header)."""
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        r = csv.reader(f)
        try:
            next(r)
        except StopIteration:
            return 0
        return sum(1 for _ in r)


def load_playlists_csv(path: str) -> List[Playlist]:
    out: List[Playlist] = []
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        required = {"playlist_key", "display_name", "dashboard_url", "is_catalog"}
        if not required.issubset(set(reader.fieldnames or [])):
            raise ValueError(f"{path} must contain columns: {', '.join(sorted(required))}")

        for row in reader:
            key = (row.get("playlist_key") or "").strip()
            name = (row.get("display_name") or "").strip()
            url = (row.get("dashboard_url") or "").strip()
            is_catalog = parse_bool(row.get("is_catalog"))
            allow_empty = parse_bool(row.get("allow_empty"))
            min_rows_raw = (row.get("min_rows") or "").strip()
            try:
                min_rows = int(min_rows_raw) if min_rows_raw else 0
            except Exception:
                min_rows = 0
            if key and name and url:
                out.append(
                    Playlist(
                        key=key,
                        name=name,
                        url=url,
                        is_catalog=is_catalog,
                        min_rows=max(0, min_rows),
                        allow_empty=allow_empty,
                    )
                )

    return out


def download_one(page, pl: Playlist, out_path: Path) -> Tuple[bool, str]:
    page.goto(pl.url, wait_until="networkidle", timeout=NAV_TIMEOUT_MS)
    time.sleep(1.2)

    if is_logged_out(page):
        return False, "logged_out"

    if not wait_for_export_button(page):
        if pl.allow_empty:
            write_empty_export(out_path)
            return True, "empty_dashboard_export_button_not_visible"
        return False, "export_button_not_visible"

    try:
        with page.expect_download(timeout=DOWNLOAD_TIMEOUT_MS) as dl_info:
            if not click_export_csv(page):
                return False, "export_button_click_failed"

        download = dl_info.value
        tmp_path = out_path.with_suffix(".tmp.csv")
        download.save_as(str(tmp_path))
        tmp_path.replace(out_path)
        return True, "downloaded"
    except PWTimeout:
        return False, "download_timeout"
    except Exception as e:
        return False, f"error:{repr(e)}"


def download_with_retries(page, pl: Playlist, out_path: Path) -> Tuple[bool, str]:
    last = "unknown"
    for attempt in range(1, MAX_EXPORT_RETRIES + 1):
        ok, note = download_one(page, pl, out_path)
        if ok:
            return True, note

        last = note
        sleep_time = RETRY_SLEEP_SECONDS + (attempt * 1.2)
        print(f"   ↪ retry {attempt}/{MAX_EXPORT_RETRIES} failed: {note} | sleeping {sleep_time:.1f}s...")
        time.sleep(sleep_time)
        try:
            page.reload(wait_until="networkidle", timeout=NAV_TIMEOUT_MS)
            time.sleep(1.0)
        except Exception:
            pass

    return False, f"failed_after_retries:{last}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="config/playlists.csv")
    ap.add_argument(
        "--storage-state",
        default=os.environ.get("SOT_STORAGE_STATE", "sot_state.json"),
        help="Path to Playwright storage_state JSON (cookie/session)",
    )
    ap.add_argument("--email", default=os.environ.get("SOT_EMAIL", ""), help="SpotOnTrack login email (optional)")
    ap.add_argument("--password", default=os.environ.get("SOT_PASSWORD", ""), help="SpotOnTrack login password (optional)")
    ap.add_argument("--out-dir", default="exports")
    ap.add_argument("--headless", action="store_true")
    ap.add_argument("--fail-on-empty", action="store_true", help="Treat 0-row exports as failures")
    ap.add_argument(
        "--auth-debug",
        action="store_true",
        help="Print non-sensitive auth diagnostics (storage_state vs login fallback usage)",
    )
    args = ap.parse_args()

    playlists = load_playlists_csv(args.config)
    if not playlists:
        raise SystemExit("No playlists loaded.")

    y, m, d = utc_date_parts()
    base_dir = Path(args.out_dir) / y / m / d
    base_dir.mkdir(parents=True, exist_ok=True)

    print(f"✅ Playlists: {len(playlists)}")
    print(f"📦 Output: {base_dir.resolve()}")
    print(f"🕶️ Headless: {'ON' if args.headless else 'OFF'}")

    failures = 0

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=args.headless)
        # Only load storage_state if the file exists; otherwise rely on login fallback.
        storage_state_path = Path(args.storage_state) if args.storage_state else None
        if storage_state_path and storage_state_path.exists():
            if args.auth_debug:
                print(f"🔐 Auth mode: storage_state ({storage_state_path})")
            context = browser.new_context(
                storage_state=str(storage_state_path),
                accept_downloads=True,
                viewport={"width": 1400, "height": 900},
            )
        else:
            if args.auth_debug:
                print("🔐 Auth mode: no storage_state present (login fallback may be used if logged out)")
            context = browser.new_context(
                accept_downloads=True,
                viewport={"width": 1400, "height": 900},
            )
        page = context.new_page()

        page.goto("https://www.spotontrack.com/dashboard", wait_until="networkidle", timeout=NAV_TIMEOUT_MS)
        if is_logged_out(page):
            if not ensure_logged_in(page, email=args.email, password=args.password):
                raise SystemExit(
                    "❌ Logged out in CI and login fallback failed. Provide a valid storage_state or set SOT_EMAIL/SOT_PASSWORD."
                )
            if args.auth_debug:
                print("🔐 Auth mode: login fallback (initial)")

        for i, pl in enumerate(playlists, start=1):
            out_path = base_dir / f"{pl.key}.csv"
            print("=" * 60)
            print(f"📌 {i}/{len(playlists)} | {pl.key} | {pl.name}")
            print(f"🔗 {pl.url}")

            ok, note = download_with_retries(page, pl, out_path)
            if not ok:
                if note == "logged_out":
                    if ensure_logged_in(page, email=args.email, password=args.password):
                        if args.auth_debug:
                            print("🔐 Auth mode: login fallback (mid-run)")
                        ok, note = download_with_retries(page, pl, out_path)
                if not ok:
                    failures += 1
                    print(f"❌ Failed: {note}")
                    continue

            rows = count_csv_rows(out_path)
            h = sha256_file(out_path)
            print(f"✅ Saved: {out_path} | rows={rows} | sha256={h[:12]}...")

            if rows == 0 and pl.allow_empty:
                print("ℹ️ Empty export accepted by allow_empty=true.")
            elif args.fail_on_empty and rows == 0:
                failures += 1
                print("❌ Zero-row export (treating as failure).")
            if pl.min_rows and rows < pl.min_rows:
                failures += 1
                print(f"❌ Row-count sanity check failed: rows={rows} < min_rows={pl.min_rows}")

            time.sleep(0.4)

        context.close()
        browser.close()

    if failures:
        raise SystemExit(f"❌ Export completed with {failures} failure(s).")


if __name__ == "__main__":
    main()
