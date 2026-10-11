"""Shared retry policy for ISRCs Spotify search cannot find."""

from datetime import datetime, timedelta, timezone


TRACKING_FIELDS = "spotify_lookup_misses,spotify_not_found_since"


def lookup_candidate_filter(has_last_fetched: bool) -> str:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat().replace("+00:00", "Z")
    due = f"spotify_not_found_since.lt.{cutoff}"
    if has_last_fetched:
        due = (
            f"and({due},or(spotify_last_fetched_at.is.null,"
            f"spotify_last_fetched_at.lt.{cutoff}))"
        )
    return f"or=(spotify_not_found_since.is.null,{due})"


def record_lookup(pg, row: dict, found: bool, has_last_fetched: bool) -> None:
    """Tracking is best-effort; a failed write must never stop enrichment."""
    try:
        if found:
            # Most hits already have clear tracking; avoid a second PATCH on
            # the own-catalog hot path unless there is state to reset.
            if not row.get("spotify_lookup_misses") and not row.get("spotify_not_found_since"):
                return
            patch = {"spotify_lookup_misses": 0, "spotify_not_found_since": None}
        else:
            misses = int(row.get("spotify_lookup_misses") or 0) + 1
            patch = {"spotify_lookup_misses": misses}
            if misses >= 2:
                now = datetime.now(timezone.utc).isoformat()
                if not row.get("spotify_not_found_since") or not has_last_fetched:
                    patch["spotify_not_found_since"] = now
                if has_last_fetched:
                    patch["spotify_last_fetched_at"] = now
        pg.patch("tracks", patch, f"isrc=eq.{row['isrc']}")
    except Exception as exc:
        print(f"WARN Spotify lookup tracking {row.get('isrc')}: {exc}")


def spotify_search_items(payload) -> list:
    """Only a valid search response can establish a Spotify lookup miss."""
    tracks = payload.get("tracks") if isinstance(payload, dict) else None
    items = tracks.get("items") if isinstance(tracks, dict) else None
    if not isinstance(items, list) or any(not isinstance(item, dict) for item in items):
        raise ValueError("Malformed Spotify search response: expected tracks.items list")
    return items
