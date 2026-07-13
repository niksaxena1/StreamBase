"""Best-effort cache revalidation ping to the StreamBase web app.

Called at the end of a successful ingestion run so the app's cached analytics
(`cachedQuery` entries tagged "supabase") refresh immediately instead of
waiting for their TTL to expire.
"""

import os

import requests


def notify_web_revalidate(timeout_s: float = 15.0) -> None:
    """POST to the app's /api/revalidate endpoint.

    Controlled by env vars (both required to attempt the call):
      STREAMBASE_REVALIDATE_URL  e.g. https://<app-domain>/api/revalidate
      REVALIDATE_SECRET          bearer secret shared with the web app

    Missing config or request failures are logged and never fail ingestion.
    """
    url = os.environ.get("STREAMBASE_REVALIDATE_URL", "").strip()
    secret = os.environ.get("REVALIDATE_SECRET", "").strip()
    if not url or not secret:
        print("[revalidate] skipped (STREAMBASE_REVALIDATE_URL / REVALIDATE_SECRET not set)")
        return
    try:
        r = requests.post(
            url,
            headers={"Authorization": f"Bearer {secret}"},
            json={},
            timeout=timeout_s,
        )
        if r.status_code == 200:
            print("[revalidate] web app caches revalidated")
        else:
            print(f"[revalidate] non-200 response: {r.status_code} {r.text[:200]}")
    except Exception as e:  # never fail ingestion because of a cache ping
        print(f"[revalidate] failed: {e}")
