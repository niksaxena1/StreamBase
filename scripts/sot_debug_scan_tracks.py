import argparse
import csv
import os
import random
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple
from urllib.parse import urlparse

from playwright.sync_api import TimeoutError as PWTimeout
from playwright.sync_api import sync_playwright

SOT_BASE = "https://www.spotontrack.com"
SOT_PLAYLIST_URL = SOT_BASE + "/playlists/spotify/{sot_playlist_id}"

NAV_TIMEOUT_MS = 45_000


@dataclass(frozen=True)
class DebugTask:
    playlist_key: str
    display_name: str
    dashboard_url: str
    dashboard_name: str
    sot_playlist_id: str


def fast_pause(a: float, b: float) -> None:
    time.sleep(random.uniform(a, b))


def is_logged_out(page) -> bool:
    url = (page.url or "")
    if "/login" in url:
        return True
    try:
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


def try_login(page, email: str, password: str) -> bool:
    if not email or not password:
        return False

    page.goto(SOT_BASE + "/login", wait_until="domcontentloaded", timeout=NAV_TIMEOUT_MS)
    time.sleep(0.6)

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


def goto_best_effort(page, url: str) -> None:
    try:
        page.goto(url, wait_until="networkidle", timeout=NAV_TIMEOUT_MS)
        return
    except PWTimeout:
        pass
    except Exception:
        pass
    page.goto(url, wait_until="domcontentloaded", timeout=NAV_TIMEOUT_MS)


def page_looks_blocked(page) -> bool:
    try:
        title = (page.title() or "").lower()
        if any(x in title for x in ["just a moment", "access denied", "forbidden", "temporarily unavailable"]):
            return True
    except Exception:
        pass
    needles = ["checking your browser", "just a moment", "access denied", "forbidden", "too many requests"]
    for n in needles:
        try:
            if page.locator(f"text={n}").count() > 0:
                return True
        except Exception:
            pass
    return False


def wait_for_tracks_or_empty_state(page, timeout_ms: int = 15_000) -> None:
    start = time.time()
    while (time.time() - start) * 1000.0 < timeout_ms:
        if page_looks_blocked(page):
            return
        try:
            if page.locator("a[href*='/tracks/']").count() > 0:
                return
        except Exception:
            pass
        try:
            if page.locator("text=/\\b0\\s+tracks\\b/i").count() > 0:
                return
            if page.locator("text=/\\bno\\s+tracks\\b/i").count() > 0:
                return
        except Exception:
            pass
        time.sleep(0.25)


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


def normalize_track_url(url: str) -> str:
    """
    Ensure consistent canonicalization so a relative URL /tracks/123 and absolute URL
    https://www.spotontrack.com/tracks/123 compare equal.
    """
    if not url:
        return ""
    try:
        u = urlparse(url)
        if u.scheme and u.netloc:
            return f"{u.scheme}://{u.netloc}{u.path}".rstrip("/")
        # Assume relative
        if url.startswith("/"):
            return (SOT_BASE + url).rstrip("/")
    except Exception:
        pass
    return url.rstrip("/")


def collect_track_hrefs_on_page(page) -> List[str]:
    selectors = ["a[href*='/tracks/']", "a[href^='/tracks/']"]
    out: List[str] = []
    for sel in selectors:
        try:
            hrefs = page.eval_on_selector_all(sel, "els => els.map(e => e.href).filter(Boolean)")
            out.extend([normalize_track_url(h) for h in hrefs if h])
        except Exception:
            pass
    return out


def scan_tracks_accumulating(
    page,
    url: str,
    *,
    max_scrolls: int,
    stable_rounds: int,
    kind: str,
    debug_dir: Path,
) -> Tuple[Set[str], Dict[str, int]]:
    """
    Returns (unique_track_urls, raw_href_histogram).
    - unique_track_urls: set of canonical track URLs
    - raw_href_histogram: counts of href occurrences collected across scrolls
    """
    goto_best_effort(page, url)
    fast_pause(0.5, 1.0)
    wait_for_tracks_or_empty_state(page, timeout_ms=15_000)

    seen: Set[str] = set()
    hist: Dict[str, int] = {}

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

    last_size = 0
    stable = 0
    for i in range(max_scrolls):
        hrefs = collect_track_hrefs_on_page(page)
        for h in hrefs:
            if not h:
                continue
            seen.add(h)
            hist[h] = hist.get(h, 0) + 1

        if len(seen) > last_size:
            last_size = len(seen)
            stable = 0
        else:
            stable += 1

        if stable >= stable_rounds:
            break

        scrolled = False
        try:
            scrolled = bool(page.evaluate(scroll_script))
        except Exception:
            scrolled = False

        if not scrolled:
            try:
                page.mouse.wheel(0, 4200)
            except Exception:
                pass

        fast_pause(0.06, 0.14)

        if page_looks_blocked(page):
            break

    # Best-effort debug dump
    debug_dir.mkdir(parents=True, exist_ok=True)
    try:
        (debug_dir / f"{kind}_final_url.txt").write_text(url, encoding="utf-8")
    except Exception:
        pass
    try:
        (debug_dir / f"{kind}_count.txt").write_text(str(len(seen)), encoding="utf-8")
    except Exception:
        pass
    try:
        (debug_dir / f"{kind}_tracks.txt").write_text("\n".join(sorted(seen)), encoding="utf-8")
    except Exception:
        pass

    try:
        page.screenshot(path=str(debug_dir / f"{kind}_final.png"), full_page=True)
    except Exception:
        pass
    try:
        (debug_dir / f"{kind}_final.html").write_text(page.content(), encoding="utf-8")
    except Exception:
        pass

    return seen, hist


def load_task_from_config(config_path: str, playlist_key: str) -> DebugTask:
    with open(config_path, "r", encoding="utf-8-sig", newline="") as f:
        r = csv.DictReader(f)
        for row in r:
            key = (row.get("playlist_key") or "").strip()
            if key != playlist_key:
                continue
            display_name = (row.get("display_name") or "").strip() or key
            dashboard_url = (row.get("dashboard_url") or "").strip()
            sot_playlist_id = (row.get("sot_playlist_id") or "").strip()
            dashboard_name = (row.get("sot_dashboard_name") or "").strip() or display_name
            if not dashboard_url or not sot_playlist_id:
                raise SystemExit(f"Config row for {playlist_key} is missing dashboard_url and/or sot_playlist_id.")
            return DebugTask(
                playlist_key=key,
                display_name=display_name,
                dashboard_url=dashboard_url,
                dashboard_name=dashboard_name,
                sot_playlist_id=sot_playlist_id,
            )
    raise SystemExit(f"playlist_key not found in {config_path}: {playlist_key}")


def write_set(path: Path, s: Set[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(sorted(s)), encoding="utf-8")


def write_histogram_csv(path: Path, hist: Dict[str, int]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["track_url", "seen_count"])
        for url, n in sorted(hist.items(), key=lambda kv: (-kv[1], kv[0])):
            w.writerow([url, n])


def print_sample(label: str, items: Set[str], limit: int = 20) -> None:
    if not items:
        return
    print(f"— {label} (showing up to {limit}) —")
    for i, u in enumerate(sorted(items), start=1):
        if i > limit:
            break
        print(f"  {i:02d}. {u}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="config/playlists.csv", help="CSV config path")
    ap.add_argument("--playlist-key", required=True, help="playlist_key in config/playlists.csv (e.g. p_total)")
    ap.add_argument("--storage-state", default="sot_state.json", help="Playwright storage state JSON path")
    ap.add_argument("--headless", action="store_true", help="Run headless")
    ap.add_argument("--max-scrolls", type=int, default=520, help="Max scroll iterations per page")
    ap.add_argument("--stable-rounds", type=int, default=12, help="Stop after this many rounds with no growth")
    ap.add_argument("--out-dir", default=".artifacts/debug_scan", help="Where to write debug artifacts")
    args = ap.parse_args()

    email = (os.environ.get("SOT_EMAIL") or "").strip()
    password = (os.environ.get("SOT_PASSWORD") or "").strip()

    task = load_task_from_config(args.config, args.playlist_key)
    playlist_url = SOT_PLAYLIST_URL.format(sot_playlist_id=task.sot_playlist_id)

    out_dir = Path(args.out_dir) / task.playlist_key
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"▶ Debug scan: {task.playlist_key} | {task.display_name}")
    print(f"Playlist:  {playlist_url}")
    print(f"Dashboard: {task.dashboard_url}")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=args.headless)
        context_options = {"viewport": {"width": 1400, "height": 900}}
        ss = Path(args.storage_state)
        if args.storage_state and ss.exists():
            context_options["storage_state"] = str(ss)
        context = browser.new_context(**context_options)
        enable_turbo_blocking(context)
        page = context.new_page()

        page.goto(SOT_BASE + "/dashboard", wait_until="networkidle", timeout=NAV_TIMEOUT_MS)
        if is_logged_out(page):
            if not ensure_logged_in(page, email=email, password=password):
                raise SystemExit("❌ Not logged in and login fallback failed. Provide storage_state or SOT_EMAIL/SOT_PASSWORD.")

        playlist_set, playlist_hist = scan_tracks_accumulating(
            page,
            playlist_url,
            max_scrolls=args.max_scrolls,
            stable_rounds=args.stable_rounds,
            kind="playlist",
            debug_dir=out_dir,
        )

        dashboard_set, dashboard_hist = scan_tracks_accumulating(
            page,
            task.dashboard_url,
            max_scrolls=args.max_scrolls,
            stable_rounds=max(8, args.stable_rounds // 2),
            kind="dashboard",
            debug_dir=out_dir,
        )

        context.close()
        browser.close()

    missing_from_dashboard = playlist_set - dashboard_set
    extra_in_dashboard = dashboard_set - playlist_set

    write_set(out_dir / "playlist_tracks.txt", playlist_set)
    write_set(out_dir / "dashboard_tracks.txt", dashboard_set)
    write_set(out_dir / "missing_from_dashboard.txt", missing_from_dashboard)
    write_set(out_dir / "extra_in_dashboard.txt", extra_in_dashboard)
    write_histogram_csv(out_dir / "playlist_histogram.csv", playlist_hist)
    write_histogram_csv(out_dir / "dashboard_histogram.csv", dashboard_hist)

    (out_dir / "summary.txt").write_text(
        "\n".join(
            [
                f"playlist_key={task.playlist_key}",
                f"display_name={task.display_name}",
                f"playlist_url={playlist_url}",
                f"dashboard_url={task.dashboard_url}",
                f"playlist_unique_tracks={len(playlist_set)}",
                f"dashboard_unique_tracks={len(dashboard_set)}",
                f"missing_from_dashboard={len(missing_from_dashboard)}",
                f"extra_in_dashboard={len(extra_in_dashboard)}",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    print("✅ Debug scan complete")
    print(f"Playlist unique tracks:  {len(playlist_set)}")
    print(f"Dashboard unique tracks: {len(dashboard_set)}")
    print(f"Missing from dashboard:  {len(missing_from_dashboard)}")
    print(f"Extra in dashboard:      {len(extra_in_dashboard)}")
    print_sample("Missing from dashboard", missing_from_dashboard, limit=20)
    print_sample("Extra in dashboard", extra_in_dashboard, limit=20)
    print(f"Artifacts: {out_dir}")


if __name__ == "__main__":
    main()

