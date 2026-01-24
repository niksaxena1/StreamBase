import argparse

from playwright.sync_api import sync_playwright


def main(out_path: str):
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()
        page.goto("https://www.spotontrack.com/dashboard", wait_until="networkidle")
        print("Log in to SpotOnTrack in the opened browser window.")
        input("Press ENTER after login is complete...")
        context.storage_state(path=out_path)
        print(f"Saved storage state -> {out_path}")
        browser.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="sot_state.json", help="Path to write Playwright storage_state JSON")
    args = ap.parse_args()
    main(args.out)
