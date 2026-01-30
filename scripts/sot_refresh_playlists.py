import argparse
import csv
import os
import random
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from playwright.sync_api import TimeoutError as PWTimeout
from playwright.sync_api import sync_playwright

SOT_BASE = "https://www.spotontrack.com"
SOT_PLAYLIST_URL = SOT_BASE + "/playlists/spotify/{sot_playlist_id}"

NAV_TIMEOUT_MS = 45_000
BTN_TIMEOUT_MS = 12_000


@dataclass(frozen=True)
class RefreshTask:
    playlist_key: str
    display_name: str
    sot_playlist_id: str


def fast_pause(a: float, b: float) -> None:
    time.sleep(random.uniform(a, b))


def utc_ts() -> str:
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")


def log_row(log_path: Path, task: RefreshTask, status: str, note: str = "") -> None:
    exists = log_path.exists()
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with open(log_path, "a", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        if not exists:
            w.writerow(["timestamp_utc", "playlist_key", "display_name", "sot_playlist_id", "status", "note"])
        w.writerow([utc_ts(), task.playlist_key, task.display_name, task.sot_playlist_id, status, note])


def is_logged_out(page) -> bool:
    # SpotOnTrack may either redirect to /login or render an in-page login form.
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


def load_refresh_tasks(path: str) -> List[RefreshTask]:
    out: List[RefreshTask] = []
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        r = csv.DictReader(f)
        required = {"playlist_key", "display_name", "sot_playlist_id"}
        if not required.issubset(set(r.fieldnames or [])):
            raise ValueError(f"{path} must contain columns: {', '.join(sorted(required))}")

        for row in r:
            playlist_key = (row.get("playlist_key") or "").strip()
            display_name = (row.get("display_name") or "").strip()
            sot_playlist_id = (row.get("sot_playlist_id") or "").strip()
            if not playlist_key or not display_name or not sot_playlist_id:
                continue
            out.append(RefreshTask(playlist_key=playlist_key, display_name=display_name, sot_playlist_id=sot_playlist_id))
    return out


def try_click_refresh_now(page) -> str:
    """
    Returns one of: clicked | missing | disabled | error
    """
    try:
        btn = page.get_by_role("button", name="Refresh now")
        if btn.count() == 0:
            # Fallback selectors, just in case the button isn't a <button>.
            btn = page.locator("button:has-text('Refresh now'), a:has-text('Refresh now')")
            if btn.count() == 0:
                return "missing"

        first = btn.first
        try:
            first.wait_for(state="visible", timeout=2_000)
        except Exception:
            # If it exists but isn't visible, treat as missing (don't fail the run).
            return "missing"

        try:
            if hasattr(first, "is_enabled") and not first.is_enabled():
                return "disabled"
        except Exception:
            # If we can't determine enabled state, still attempt click.
            pass

        first.click(timeout=2_500)
        fast_pause(0.4, 0.9)
        return "clicked"
    except Exception:
        return "error"


def run_refresh(
    *,
    config_path: str,
    storage_state_path: str,
    headless: bool,
    dry_run: bool,
    limit: Optional[int],
) -> int:
    email = (os.environ.get("SOT_EMAIL") or "").strip()
    password = (os.environ.get("SOT_PASSWORD") or "").strip()

    tasks = load_refresh_tasks(config_path)
    if limit is not None:
        tasks = tasks[: max(0, int(limit))]

    if not tasks:
        print("❌ No refresh tasks loaded (missing `sot_playlist_id` in config or empty config).")
        return 2

    print(f"✅ Loaded {len(tasks)} playlist(s) from {config_path}")
    print(f"🟡 Dry-run: {'ON (no clicking)' if dry_run else 'OFF'}")

    log_path = Path(".artifacts") / "playlist_refresh_log.csv"
    clicked = 0
    missing = 0
    disabled = 0
    errors = 0

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

        for i, task in enumerate(tasks, start=1):
            playlist_url = SOT_PLAYLIST_URL.format(sot_playlist_id=task.sot_playlist_id)
            print("=" * 72)
            print(f"▶ {i}/{len(tasks)} | {task.playlist_key} | {task.display_name}")
            print(f"🔗 {playlist_url}")

            try:
                goto_best_effort(page, playlist_url)
                fast_pause(0.35, 0.85)

                if is_logged_out(page):
                    if not ensure_logged_in(page, email=email, password=password):
                        errors += 1
                        log_row(log_path, task, "error", "logged_out_and_login_failed")
                        continue
                    goto_best_effort(page, playlist_url)
                    fast_pause(0.35, 0.85)

                if dry_run:
                    # Best-effort check without clicking.
                    status = try_click_refresh_now(page)
                    if status == "clicked":
                        status = "would_click"
                    log_row(log_path, task, status, "dry_run")
                    if status == "would_click":
                        clicked += 1
                    elif status == "missing":
                        missing += 1
                    elif status == "disabled":
                        disabled += 1
                    else:
                        errors += 1
                    continue

                status = try_click_refresh_now(page)
                log_row(log_path, task, status)
                if status == "clicked":
                    clicked += 1
                elif status == "missing":
                    missing += 1
                elif status == "disabled":
                    disabled += 1
                else:
                    errors += 1
            except Exception as e:
                errors += 1
                log_row(log_path, task, "error", repr(e))

            # Small spacing to reduce burstiness.
            fast_pause(0.15, 0.35)

        context.close()
        browser.close()

    print("=" * 72)
    print("✅ PLAYLIST REFRESH COMPLETE")
    print(f"🔄 Clicked:   {clicked}")
    print(f"🚫 Missing:   {missing}")
    print(f"⏸️ Disabled:  {disabled}")
    print(f"⚠️ Errors:    {errors}")
    print(f"📄 Log file:  {log_path}")

    # This job is best-effort; treat errors as non-fatal unless it's systemic.
    if errors >= max(3, int(0.4 * len(tasks))):
        return 10
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="config/playlists.csv", help="CSV config path")
    ap.add_argument("--storage-state", default="sot_state.json", help="Playwright storage state JSON path")
    ap.add_argument("--headless", action="store_true", help="Run headless")
    ap.add_argument("--dry-run", action="store_true", help="Preview only (no clicking)")
    ap.add_argument("--limit", type=int, default=None, help="Run only first N playlists (for testing)")
    args = ap.parse_args()

    raise SystemExit(
        run_refresh(
            config_path=args.config,
            storage_state_path=args.storage_state,
            headless=args.headless,
            dry_run=args.dry_run,
            limit=args.limit,
        )
    )

