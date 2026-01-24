import argparse
from pathlib import Path

from playwright.sync_api import sync_playwright


def main(profile_dir: str, out_path: str, headless: bool):
    profile_path = Path(profile_dir)
    if not profile_path.exists():
        raise SystemExit(f"Profile dir does not exist: {profile_path}")

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            user_data_dir=str(profile_path),
            channel="chrome",
            headless=headless,
            viewport={"width": 1400, "height": 900},
        )
        page = ctx.new_page()
        page.goto("https://www.spotontrack.com/dashboard", wait_until="networkidle", timeout=45_000)
        if "/login" in (page.url or ""):
            ctx.close()
            raise SystemExit("Logged out in this profile (redirected to /login).")

        ctx.storage_state(path=out_path)
        ctx.close()

    print(f"Wrote storage state -> {out_path}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--profile",
        default="local_files_for_reference/sot_profile",
        help="Path to an existing Chrome user_data_dir that is already logged in to SpotOnTrack",
    )
    ap.add_argument("--out", default="sot_state.json", help="Output storage_state JSON path")
    ap.add_argument("--headless", action="store_true", help="Run headless")
    args = ap.parse_args()
    main(args.profile, args.out, headless=args.headless)
