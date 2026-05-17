import argparse
import csv
import json
import os
import random
import re
import shutil
import sys
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable, List, Optional, Sequence, Set, Tuple
from urllib.parse import urlparse

from playwright.sync_api import TimeoutError as PWTimeout
from playwright.sync_api import sync_playwright

SOT_BASE = "https://www.spotontrack.com"
SOT_PLAYLIST_URL = SOT_BASE + "/playlists/spotify/{sot_playlist_id}"

NAV_TIMEOUT_MS = 45_000
BTN_TIMEOUT_MS = 12_000

RETRIES = 5

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

NAV_PAUSE_MIN = 0.02
NAV_PAUSE_MAX = 0.06
CLICK_PAUSE_MIN = 0.01
CLICK_PAUSE_MAX = 0.04

TASK_RETRIES = 5

# Rotate the browser context every N tasks to avoid accumulated throttling
# from SpotOnTrack / Cloudflare. A fresh context resets cookies, local storage,
# and request fingerprints, which reduces the chance of cascading blocks.
CONTEXT_ROTATION_INTERVAL = 4


@dataclass(frozen=True)
class SyncTask:
    playlist_key: str
    display_name: str
    dashboard_url: str
    dashboard_name: str
    sot_playlist_id: str
    min_rows: int = 0


def fast_pause(a: float, b: float) -> None:
    time.sleep(random.uniform(a, b))


def utc_ts() -> str:
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")


def format_hhmmss(seconds: float) -> str:
    seconds = max(0, int(seconds))
    h = seconds // 3600
    m = (seconds % 3600) // 60
    s = seconds % 60
    return f"{h:02d}:{m:02d}:{s:02d}"


def is_logged_out(page) -> bool:
    # SpotOnTrack may either redirect to /login or render an in-page login form.
    url = (page.url or "")
    if "/login" in url:
        return True
    try:
        # Heuristic: presence of a password field + login button is a strong signal.
        if page.locator("input[type='password']").count() > 0:
            if page.get_by_role("button", name="Log in", exact=False).count() > 0:
                return True
            if page.get_by_role("button", name="Login", exact=False).count() > 0:
                return True
            if page.get_by_role("button", name="Sign in", exact=False).count() > 0:
                return True
    except Exception:
        pass
    return False


def page_looks_blocked(page) -> bool:
    """
    Detect common anti-bot / outage pages that yield zero tracks but are not real empties.
    This must be best-effort and non-throwing.
    """
    try:
        title = (page.title() or "").lower()
        if any(x in title for x in ["just a moment", "access denied", "forbidden", "temporarily unavailable"]):
            return True
    except Exception:
        pass

    needles = [
        "checking your browser",
        "just a moment",
        "access denied",
        "forbidden",
        "too many requests",
        "temporarily unavailable",
        "service unavailable",
        "something went wrong",
    ]
    for n in needles:
        try:
            if page.locator(f"text={n}").count() > 0:
                return True
        except Exception:
            pass
    return False


def goto_best_effort(page, url: str) -> None:
    """
    Prefer networkidle (more reliable for JS-rendered lists), but fall back to domcontentloaded.
    """
    try:
        page.goto(url, wait_until="networkidle", timeout=NAV_TIMEOUT_MS)
        return
    except PWTimeout:
        pass
    except Exception:
        pass
    page.goto(url, wait_until="domcontentloaded", timeout=NAV_TIMEOUT_MS)


def wait_for_tracks_or_empty_state(page, timeout_ms: int = 15_000) -> None:
    """
    Wait for either some track links to appear or an explicit empty state to render.
    Avoids scanning too early (which can incorrectly yield 0 tracks).
    """
    start = time.time()
    while (time.time() - start) * 1000.0 < timeout_ms:
        if page_looks_blocked(page):
            return
        try:
            if page.locator("a[href*='/tracks/']").count() > 0:
                return
        except Exception:
            pass
        # Empty-state heuristics (best-effort; wording may vary).
        try:
            if page.locator("text=/\\b0\\s+tracks\\b/i").count() > 0:
                return
            if page.locator("text=/\\bno\\s+tracks\\b/i").count() > 0:
                return
            if page.locator("text=/\\bno\\s+data\\b/i").count() > 0:
                return
        except Exception:
            pass
        time.sleep(0.25)


def should_skip_empty_dashboard(dashboard_count: int, playlist_count: int) -> bool:
    """
    An empty dashboard is suspicious only when the source playlist is empty too.

    Empty dashboards are valid during first-time bootstraps, when we intentionally
    need to add every playlist track into a newly created dashboard.
    """
    return dashboard_count == 0 and playlist_count == 0

def debug_dump(page, slug: str) -> Tuple[str, str]:
    """
    Save HTML + screenshot for post-mortem debugging.
    Returns (html_path, png_path). Best-effort; failures return ("","").
    """
    out_dir = Path(".artifacts") / "debug"
    out_dir.mkdir(parents=True, exist_ok=True)
    safe = "".join([c if (c.isalnum() or c in ("-", "_")) else "_" for c in slug])[:80]
    html_path = out_dir / f"{safe}.html"
    png_path = out_dir / f"{safe}.png"
    try:
        html_path.write_text(page.content(), encoding="utf-8")
    except Exception:
        html_path = Path("")
    try:
        page.screenshot(path=str(png_path), full_page=True)
    except Exception:
        png_path = Path("")
    return (str(html_path) if str(html_path) else "", str(png_path) if str(png_path) else "")


def try_login(page, email: str, password: str) -> bool:
    if not email or not password:
        return False

    page.goto(SOT_BASE + "/login", wait_until="domcontentloaded", timeout=NAV_TIMEOUT_MS)
    time.sleep(0.6)

    # Email
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

    # Password
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

    try:
        page.wait_for_load_state("networkidle", timeout=NAV_TIMEOUT_MS)
    except Exception:
        pass

    return not is_logged_out(page)


def ensure_logged_in(page, email: str, password: str) -> bool:
    if not is_logged_out(page):
        return True
    print("🔐 Detected logged-out session. Attempting login fallback...")
    if not try_login(page, email=email, password=password):
        print("❌ Login fallback failed.")
        return False
    page.goto(SOT_BASE + "/dashboard", wait_until="networkidle", timeout=NAV_TIMEOUT_MS)
    return not is_logged_out(page)


def _normalize_track_url(url: str) -> str:
    """Canonicalize track URLs so that relative/absolute variants and trailing
    slashes / query params all compare equal."""
    if not url:
        return ""
    try:
        u = urlparse(url)
        if u.scheme and u.netloc:
            return f"{u.scheme}://{u.netloc}{u.path}".rstrip("/")
        if url.startswith("/"):
            return (SOT_BASE + url).rstrip("/")
    except Exception:
        pass
    return url.rstrip("/")


_TRACK_PATH_RE = re.compile(r"^/tracks/[^/]+$")


def _is_individual_track_url(href: str) -> bool:
    """Return True only for URLs pointing to an individual track page
    (/tracks/{id}), filtering out non-track URLs that merely *contain*
    the substring '/tracks/' (e.g. /playlists/…/tracks)."""
    try:
        path = urlparse(href).path.rstrip("/")
        return bool(_TRACK_PATH_RE.match(path))
    except Exception:
        return False


def extract_unique_hrefs(page, selectors: Sequence[str]) -> List[str]:
    seen: Set[str] = set()
    unique: List[str] = []
    for sel in selectors:
        try:
            hrefs = page.eval_on_selector_all(sel, "els => els.map(e => e.href).filter(Boolean)")
            for h in hrefs:
                if not _is_individual_track_url(h):
                    continue
                norm = _normalize_track_url(h)
                if norm not in seen:
                    seen.add(norm)
                    unique.append(norm)
        except Exception:
            pass
    return unique


def try_click_refresh_now(page) -> bool:
    try:
        btn = page.get_by_role("button", name="Refresh now")
        if btn.count() > 0:
            btn.first.click(timeout=1200)
            fast_pause(0.4, 0.8)
            return True
    except Exception:
        pass
    return False


def scan_dashboard_tracks(page, dashboard_url: str) -> Set[str]:
    goto_best_effort(page, dashboard_url)
    fast_pause(0.35, 0.75)
    wait_for_tracks_or_empty_state(page, timeout_ms=12_000)

    selectors = ["a[href*='/tracks/']", "a[href^='/tracks/']"]

    last_count = 0
    stable_rounds = 0
    for _ in range(320):
        count = page.locator("a[href*='/tracks/']").count()
        if count > last_count:
            last_count = count
            stable_rounds = 0
        else:
            stable_rounds += 1
            if stable_rounds >= 6:
                break
        page.mouse.wheel(0, 4200)
        fast_pause(0.05, 0.12)

    return set(extract_unique_hrefs(page, selectors))


def scan_playlist_tracks(page, playlist_url: str) -> List[str]:
    goto_best_effort(page, playlist_url)
    fast_pause(0.5, 1.1)
    wait_for_tracks_or_empty_state(page, timeout_ms=15_000)

    selectors = ["a[href*='/tracks/']", "a[href^='/tracks/']"]

    # IMPORTANT:
    # Do NOT return early if we see some tracks initially.
    # SpotOnTrack playlist pages often lazy-load additional rows on scroll.
    # Returning early can yield only the first ~20 visible tracks, which is
    # extremely dangerous for mirror operations (it can trigger massive removals).
    urls = extract_unique_hrefs(page, selectors)

    scroll_script = """
    () => {
      const els = Array.from(document.querySelectorAll('*'));
      const scrollables = els.filter(el => {
        const s = getComputedStyle(el);
        const canScroll = (s.overflowY === 'auto' || s.overflowY === 'scroll');
        return canScroll && el.scrollHeight > el.clientHeight + 50;
      });
      if (!scrollables.length) return false;
      scrollables.sort((a,b) => (b.clientHeight*b.clientWidth) - (a.clientHeight*a.clientWidth));
      const el = scrollables[0];
      el.scrollTop = el.scrollTop + Math.floor(el.clientHeight * 0.95);
      return true;
    }
    """

    last_len = len(urls)
    stable = 0
    for _ in range(420):
        scrolled = False
        try:
            scrolled = bool(page.evaluate(scroll_script))
        except Exception:
            scrolled = False

        # Fallback: some pages scroll the window, not a nested container.
        if not scrolled:
            try:
                page.mouse.wheel(0, 4200)
                scrolled = True
            except Exception:
                pass

        fast_pause(0.06, 0.14)
        urls = extract_unique_hrefs(page, selectors)
        if len(urls) > last_len:
            last_len = len(urls)
            stable = 0
        else:
            stable += 1
            if stable >= 10:
                break
    return urls


def scan_with_retry(scan_fn, page, url: str, max_attempts: int = RETRIES, refresh: bool = False):
    last_note = "empty"
    for attempt in range(1, max_attempts + 1):
        try:
            out = scan_fn(page, url)
            last_note = "ok" if out else "empty"
        except PWTimeout:
            out = []
            last_note = "timeout"
        except Exception:
            out = []
            last_note = "error"
        if out and len(out) > 0:
            return out

        # If we hit an anti-bot / outage page, waiting longer is more effective than tight retries.
        if page_looks_blocked(page):
            last_note = "blocked"
            time.sleep(8.0 + attempt * 3.0)

        if refresh:
            try_click_refresh_now(page)

        try:
            page.reload(wait_until="domcontentloaded", timeout=NAV_TIMEOUT_MS)
        except Exception:
            pass

        fast_pause(0.6 + attempt * 0.2, 1.0 + attempt * 0.3)

    return out


def enable_turbo_blocking(context) -> None:
    def route_handler(route, request):
        rtype = request.resource_type
        url = request.url.lower()

        if rtype in ["image", "font", "media"]:
            return route.abort()

        if any(
            x in url
            for x in [
                "google-analytics",
                "gtag",
                "doubleclick",
                "facebook.com/tr",
                "hotjar",
                "clarity.ms",
                "segment.io",
            ]
        ):
            return route.abort()

        return route.continue_()

    context.route("**/*", route_handler)


def click_dashboard_toggle(page, dashboard_name: str) -> str:
    add_dropdown = page.get_by_role("button", name="Add to Dashboard")
    if add_dropdown.count() == 0:
        return "no_add_button"

    add_dropdown.click(timeout=BTN_TIMEOUT_MS)
    fast_pause(CLICK_PAUSE_MIN, CLICK_PAUSE_MAX)

    option = page.get_by_role("button", name=dashboard_name, exact=True)
    if option.count() == 0:
        return "dashboard_option_missing"

    option.click(timeout=BTN_TIMEOUT_MS)
    fast_pause(CLICK_PAUSE_MIN, CLICK_PAUSE_MAX)

    return "toggled"


def print_progress_line(
    label: str,
    done: int,
    total: int,
    ok: int,
    errors: int,
    start_time: float,
    force_newline: bool = False,
) -> None:
    cols = shutil.get_terminal_size((120, 20)).columns
    percent = (done / total * 100.0) if total > 0 else 0.0
    elapsed = time.time() - start_time

    rate = done / elapsed if elapsed > 0 else 0
    remaining = total - done
    eta = remaining / rate if rate > 0 else 0

    bar_len = 14
    filled = int(bar_len * (percent / 100.0))
    bar = "#" * filled + "-" * (bar_len - filled)

    line = (
        f"{label} [{bar}] {done}/{total} ({percent:4.1f}%) "
        f"OK:{ok} Err:{errors} Elap:{format_hhmmss(elapsed)} ETA:{format_hhmmss(eta)}"
    )
    if len(line) > cols - 1:
        line = line[: cols - 1]

    sys.stdout.write("\r" + line.ljust(cols - 1))
    sys.stdout.flush()
    if force_newline:
        sys.stdout.write("\n")
        sys.stdout.flush()


def log_row(log_path: Path, task: SyncTask, i: int, track_url: str, status: str, note: str = "") -> None:
    exists = log_path.exists()
    log_path.parent.mkdir(parents=True, exist_ok=True)

    with open(log_path, "a", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        if not exists:
            w.writerow(
                [
                    "timestamp_utc",
                    "playlist_key",
                    "dashboard_name",
                    "index",
                    "track_url",
                    "status",
                    "note",
                ]
            )
        w.writerow([utc_ts(), task.playlist_key, task.dashboard_name, i, track_url, status, note])


def load_sync_tasks(path: str) -> List[SyncTask]:
    out: List[SyncTask] = []
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        r = csv.DictReader(f)
        required = {"playlist_key", "display_name", "dashboard_url", "is_catalog"}
        if not required.issubset(set(r.fieldnames or [])):
            raise ValueError(f"{path} must contain columns: {', '.join(sorted(required))}")

        for row in r:
            playlist_key = (row.get("playlist_key") or "").strip()
            display_name = (row.get("display_name") or "").strip()
            dashboard_url = (row.get("dashboard_url") or "").strip()
            sot_playlist_id = (row.get("sot_playlist_id") or "").strip()
            dashboard_name = (row.get("sot_dashboard_name") or "").strip() or display_name
            min_rows_raw = (row.get("min_rows") or "").strip()
            try:
                min_rows = int(min_rows_raw) if min_rows_raw else 0
            except Exception:
                min_rows = 0

            if not playlist_key or not display_name or not dashboard_url:
                continue

            if not sot_playlist_id:
                # We'll skip these later with a warning, but keep visibility in logs.
                continue

            out.append(
                SyncTask(
                    playlist_key=playlist_key,
                    display_name=display_name,
                    dashboard_url=dashboard_url,
                    dashboard_name=dashboard_name,
                    sot_playlist_id=sot_playlist_id,
                    min_rows=max(0, min_rows),
                )
            )

    return out


def run_sync(
    *,
    config_path: str,
    storage_state_path: str,
    headless: bool,
    no_sync: bool,
    dry_run: bool,
    limit: Optional[int],
    fail_on_errors: bool,
) -> int:
    email = (os.environ.get("SOT_EMAIL") or "").strip()
    password = (os.environ.get("SOT_PASSWORD") or "").strip()

    tasks = load_sync_tasks(config_path)
    if limit is not None:
        tasks = tasks[: max(0, int(limit))]

    if not tasks:
        print("❌ No sync tasks loaded (missing `sot_playlist_id` in config or empty config).")
        return 2

    print(f"✅ Loaded {len(tasks)} sync task(s) from {config_path}")
    print(f"🪞 Mirror mode: {'OFF (add-only)' if no_sync else 'ON'}")
    print(f"🟡 Dry-run:     {'ON (no clicking)' if dry_run else 'OFF'}")

    log_path = Path(".artifacts") / "dashboard_sync_log.csv"

    total_added = 0
    total_removed = 0
    total_errors = 0
    total_skipped = 0

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)

        context_options = {"viewport": {"width": 1400, "height": 900}}
        if storage_state_path and Path(storage_state_path).exists():
            context_options["storage_state"] = storage_state_path

        context = browser.new_context(**context_options)
        enable_turbo_blocking(context)
        page = context.new_page()

        # Warm-up / login check.
        page.goto(SOT_BASE + "/dashboard", wait_until="networkidle", timeout=NAV_TIMEOUT_MS)
        if is_logged_out(page):
            if not ensure_logged_in(page, email=email, password=password):
                print("❌ Not logged in and no valid fallback credentials.")
                context.close()
                browser.close()
                return 3

        for n, task in enumerate(tasks, start=1):
            # Rotate browser context periodically to avoid accumulated throttling.
            if n > 1 and (n - 1) % CONTEXT_ROTATION_INTERVAL == 0:
                print(f"\n🔄 Rotating browser context (every {CONTEXT_ROTATION_INTERVAL} tasks)...")
                try:
                    context.close()
                except Exception:
                    pass
                context = browser.new_context(**context_options)
                enable_turbo_blocking(context)
                page = context.new_page()
                page.goto(SOT_BASE + "/dashboard", wait_until="networkidle", timeout=NAV_TIMEOUT_MS)
                if is_logged_out(page):
                    if not ensure_logged_in(page, email=email, password=password):
                        print("❌ Re-login after context rotation failed. Continuing with new context.")

            playlist_url = SOT_PLAYLIST_URL.format(sot_playlist_id=task.sot_playlist_id)
            task_label = f"{n}/{len(tasks)}|{task.display_name}"

            print("\n" + "=" * 72)
            print(f"▶ TASK: {task_label}")
            print(f"Playlist URL:  {playlist_url}")
            print(f"Dashboard URL: {task.dashboard_url}")

            # Scan sets with retries.
            #
            # SpotOnTrack sometimes returns a transient "empty" view (0 tracks) for a valid
            # playlist. A simple within-page retry isn't always enough, so we do a task-level
            # retry that re-navigates and re-scans up to TASK_RETRIES times before skipping.
            dashboard_set: Set[str] = set()
            playlist_set: Set[str] = set()
            for attempt in range(1, TASK_RETRIES + 1):
                if is_logged_out(page):
                    ensure_logged_in(page, email=email, password=password)

                dashboard_set = set(scan_with_retry(scan_dashboard_tracks, page, task.dashboard_url, refresh=False) or [])
                playlist_tracks = scan_with_retry(scan_playlist_tracks, page, playlist_url, refresh=True)
                playlist_set = set(playlist_tracks or [])

                # If both are non-empty (and meet any configured minimum), proceed.
                min_ok = (task.min_rows <= 0) or (len(playlist_set) >= task.min_rows)
                if dashboard_set and playlist_set and min_ok:
                    break

                if attempt < TASK_RETRIES:
                    # If we look blocked, dump evidence and cool down more aggressively.
                    if page_looks_blocked(page):
                        html_p, png_p = debug_dump(page, f"blocked_{task.playlist_key}_{attempt}")
                        print(
                            f"🧱 Possible block/outage detected (dashboard={len(dashboard_set)} playlist={len(playlist_set)}). "
                            f"Debug: html={html_p or 'n/a'} png={png_p or 'n/a'}"
                        )
                        time.sleep(12.0 + attempt * 6.0)

                    if task.min_rows > 0 and playlist_set and len(playlist_set) < task.min_rows:
                        print(
                            f"⚠️ Sanity check: playlist scan below min_rows "
                            f"({len(playlist_set)} < {task.min_rows}). Treating as incomplete and retrying."
                        )

                    wait_s = 1.5 * attempt
                    print(
                        f"🔁 Empty scan detected (dashboard={len(dashboard_set)} playlist={len(playlist_set)}). "
                        f"Retrying task {attempt}/{TASK_RETRIES} after {wait_s:.1f}s..."
                    )
                    try:
                        page.goto(SOT_BASE + "/dashboard", wait_until="networkidle", timeout=NAV_TIMEOUT_MS)
                    except Exception:
                        pass
                    time.sleep(wait_s)

            print(f"✅ Dashboard tracks found: {len(dashboard_set)}")
            print(f"✅ Playlist tracks found:  {len(playlist_set)}")

            # SAFETY: never mirror to/from empty
            if len(playlist_set) == 0:
                print("🛑 Safety: playlist scan returned 0 after retries. Skipping.")
                html_p, png_p = debug_dump(page, f"playlist_empty_{task.playlist_key}")
                log_row(
                    log_path,
                    task,
                    -1,
                    playlist_url,
                    "skip",
                    f"playlist scan returned 0 after retries (task_retries={TASK_RETRIES}) debug_html={html_p or 'n/a'} debug_png={png_p or 'n/a'}",
                )
                total_skipped += 1
                continue

            if task.min_rows > 0 and len(playlist_set) < task.min_rows:
                print(f"🛑 Safety: playlist scan below min_rows ({len(playlist_set)} < {task.min_rows}). Skipping.")
                html_p, png_p = debug_dump(page, f"playlist_below_min_{task.playlist_key}")
                log_row(
                    log_path,
                    task,
                    -1,
                    playlist_url,
                    "skip",
                    f"playlist scan below min_rows ({len(playlist_set)} < {task.min_rows}) debug_html={html_p or 'n/a'} debug_png={png_p or 'n/a'}",
                )
                total_skipped += 1
                continue

            if should_skip_empty_dashboard(len(dashboard_set), len(playlist_set)):
                print("🛑 Safety: dashboard scan returned 0 after retries. Skipping.")
                html_p, png_p = debug_dump(page, f"dashboard_empty_{task.playlist_key}")
                log_row(
                    log_path,
                    task,
                    -1,
                    task.dashboard_url,
                    "skip",
                    f"dashboard scan returned 0 after retries (task_retries={TASK_RETRIES}) debug_html={html_p or 'n/a'} debug_png={png_p or 'n/a'}",
                )
                total_skipped += 1
                continue

            if len(dashboard_set) == 0 and len(playlist_set) > 0:
                print("🌱 Bootstrap: dashboard is empty; seeding it from the playlist.")

            to_add = list(playlist_set - dashboard_set)
            to_remove = list(dashboard_set - playlist_set) if not no_sync else []

            print("—" * 72)
            print(f"🧹 Extra in dashboard (remove): {len(to_remove)}")
            if to_remove:
                for u in sorted(to_remove):
                    print(f"   - {u}")
            print(f"➕ Missing from dashboard (add): {len(to_add)}")
            if to_add:
                for u in sorted(to_add):
                    print(f"   + {u}")

            # SAFETY: prevent catastrophic dashboard wipes when playlist scan is incomplete.
            # If the playlist appears much smaller than the dashboard, it's often due to a scan
            # issue (lazy load / scroll changes / transient rendering). Skipping is safer than
            # destroying the dashboard contents.
            if not no_sync and len(dashboard_set) >= 200:
                if len(playlist_set) < max(50, int(0.25 * len(dashboard_set))) and len(to_remove) >= int(
                    0.70 * len(dashboard_set)
                ):
                    print(
                        "🛑 Safety: playlist scan suspiciously small vs dashboard; skipping to avoid mass removals."
                    )
                    log_row(
                        log_path,
                        task,
                        -1,
                        playlist_url,
                        "skip",
                        f"suspicious_scan: playlist={len(playlist_set)} dashboard={len(dashboard_set)} remove={len(to_remove)}",
                    )
                    total_skipped += 1
                    continue

            if dry_run:
                print("🟡 DRY RUN: skipping clicking for this task.")
                continue

            if len(to_add) == 0 and len(to_remove) == 0:
                print("✅ Already mirrored. Nothing to do.")
                continue

            # Add first (safer): if the job fails mid-run, we prefer leaving extra tracks
            # rather than accidentally removing a lot and not completing additions.
            added_ok = 0
            added_err = 0
            if to_add:
                print("⚡ Adding missing…")
                start = time.time()
                last_update = 0.0
                total = len(to_add)

                for i, track_url in enumerate(to_add, start=1):
                    try:
                        page.goto(track_url, wait_until="domcontentloaded", timeout=NAV_TIMEOUT_MS)
                        if is_logged_out(page) and not ensure_logged_in(page, email=email, password=password):
                            raise RuntimeError("logged_out")
                        page.get_by_role("button", name="Add to Dashboard").wait_for(timeout=BTN_TIMEOUT_MS)
                        fast_pause(NAV_PAUSE_MIN, NAV_PAUSE_MAX)
                        result = click_dashboard_toggle(page, task.dashboard_name)
                        if result == "toggled":
                            added_ok += 1
                            log_row(log_path, task, i, track_url, "added", f"Added -> {task.dashboard_name}")
                        else:
                            added_err += 1
                            log_row(log_path, task, i, track_url, "add_error", result)
                    except PWTimeout as e:
                        added_err += 1
                        log_row(log_path, task, i, track_url, "add_timeout", str(e))
                    except Exception as e:
                        added_err += 1
                        log_row(log_path, task, i, track_url, "add_error", repr(e))

                    if time.time() - last_update >= 1.0 or i == total:
                        print_progress_line(
                            label=f"ADD {task_label}",
                            done=i,
                            total=total,
                            ok=added_ok,
                            errors=added_err,
                            start_time=start,
                            force_newline=(i == total),
                        )
                        last_update = time.time()

            # Remove after add (mirror mode only).
            removed_ok = 0
            removed_err = 0
            if not no_sync and to_remove:
                print("🧹 Removing extras…")
                start = time.time()
                last_update = 0.0
                total = len(to_remove)

                for i, track_url in enumerate(to_remove, start=1):
                    try:
                        page.goto(track_url, wait_until="domcontentloaded", timeout=NAV_TIMEOUT_MS)
                        if is_logged_out(page) and not ensure_logged_in(page, email=email, password=password):
                            raise RuntimeError("logged_out")
                        page.get_by_role("button", name="Add to Dashboard").wait_for(timeout=BTN_TIMEOUT_MS)
                        fast_pause(NAV_PAUSE_MIN, NAV_PAUSE_MAX)
                        result = click_dashboard_toggle(page, task.dashboard_name)
                        if result == "toggled":
                            removed_ok += 1
                            log_row(log_path, task, i, track_url, "removed", f"Removed from -> {task.dashboard_name}")
                        else:
                            removed_err += 1
                            log_row(log_path, task, i, track_url, "remove_error", result)
                    except PWTimeout as e:
                        removed_err += 1
                        log_row(log_path, task, i, track_url, "remove_timeout", str(e))
                    except Exception as e:
                        removed_err += 1
                        log_row(log_path, task, i, track_url, "remove_error", repr(e))

                    if time.time() - last_update >= 1.0 or i == total:
                        print_progress_line(
                            label=f"REMOVE {task_label}",
                            done=i,
                            total=total,
                            ok=removed_ok,
                            errors=removed_err,
                            start_time=start,
                            force_newline=(i == total),
                        )
                        last_update = time.time()

            total_removed += removed_ok
            total_added += added_ok
            total_errors += (removed_err + added_err)

            print(f"✅ Task done: removed {removed_ok} (err {removed_err}) | added {added_ok} (err {added_err})")

        context.close()
        browser.close()

    # Write machine-readable summary for CI notification workflow.
    summary = {
        "total_added": total_added,
        "total_removed": total_removed,
        "total_errors": total_errors,
        "total_skipped": total_skipped,
        "tasks_total": len(tasks),
    }
    summary_path = Path(".artifacts") / "sync_summary.json"
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(json.dumps(summary, indent=2))

    print("\n" + "=" * 72)
    print("✅ DASHBOARD SYNC COMPLETE")
    print(f"🧹 Total removed: {total_removed}")
    print(f"➕ Total added:   {total_added}")
    print(f"⚠️ Total errors:  {total_errors}")
    print(f"⏭️ Total skipped: {total_skipped}")
    print(f"📄 Log file:      {log_path}")

    if fail_on_errors and total_errors > 0:
        return 10
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="config/playlists.csv", help="CSV config path")
    ap.add_argument("--storage-state", default="sot_state.json", help="Playwright storage state JSON path")
    ap.add_argument("--headless", action="store_true", help="Run headless")
    ap.add_argument("--no-sync", action="store_true", help="Disable mirroring (add-only mode)")
    ap.add_argument("--dry-run", action="store_true", help="Preview changes only (no clicking)")
    ap.add_argument("--limit", type=int, default=None, help="Run only first N tasks (for testing)")
    ap.add_argument("--fail-on-errors", action="store_true", help="Exit non-zero if any add/remove errors occur")
    args = ap.parse_args()

    raise SystemExit(
        run_sync(
            config_path=args.config,
            storage_state_path=args.storage_state,
            headless=args.headless,
            no_sync=args.no_sync,
            dry_run=args.dry_run,
            limit=args.limit,
            fail_on_errors=args.fail_on_errors,
        )
    )
