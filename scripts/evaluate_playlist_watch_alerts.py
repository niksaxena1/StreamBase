import argparse
import os
import smtplib
from dataclasses import dataclass
from datetime import datetime, timezone
from email.message import EmailMessage
from statistics import mean
from typing import Any, Dict, List, Optional
from urllib.parse import quote

import requests


DEFAULT_SMTP_FROM = "StreamBase Playlist Watch <nikhil.auh@gmail.com>"
DEFAULT_SMTP_USERNAME = "nikhil.auh@gmail.com"


def require_env(name: str) -> str:
    value = (os.environ.get(name) or "").strip()
    if not value:
        raise SystemExit(f"Missing env var: {name}")
    return value


@dataclass(frozen=True)
class Snapshot:
    date: str
    follower_count: int


@dataclass(frozen=True)
class AlertRule:
    id: int
    user_id: str
    recipient_email: str
    rule_name: str
    min_absolute_jump: Optional[int]
    min_percent_jump: Optional[float]
    comparison_window_days: int


def _to_rule(row: dict) -> AlertRule:
    return AlertRule(
        id=int(row["id"]),
        user_id=str(row["user_id"]),
        recipient_email=str(row["recipient_email"]),
        rule_name=str(row.get("rule_name") or "Playlist Watch alert"),
        min_absolute_jump=int(row["min_absolute_jump"]) if row.get("min_absolute_jump") is not None else None,
        min_percent_jump=float(row["min_percent_jump"]) if row.get("min_percent_jump") is not None else None,
        comparison_window_days=max(1, int(row.get("comparison_window_days") or 7)),
    )


def evaluate_rule_for_playlist(
    rule: AlertRule,
    playlist: dict,
    snapshots: List[Snapshot],
    run_date: str,
) -> Optional[Dict[str, Any]]:
    ordered = sorted(snapshots, key=lambda row: row.date)
    today = next((row for row in ordered if row.date == run_date), None)
    if today is None:
        return None

    baseline_rows = [row for row in ordered if row.date < run_date][-rule.comparison_window_days :]
    if len(baseline_rows) < rule.comparison_window_days:
        return None

    baseline = int(round(mean(row.follower_count for row in baseline_rows)))
    absolute_jump = today.follower_count - baseline
    percent_jump = None if baseline <= 0 else (absolute_jump / baseline) * 100

    if rule.min_absolute_jump is not None and absolute_jump < rule.min_absolute_jump:
        return None
    if rule.min_percent_jump is not None and (percent_jump is None or percent_jump < rule.min_percent_jump):
        return None

    return {
        "rule_id": rule.id,
        "user_id": rule.user_id,
        "recipient_email": rule.recipient_email,
        "spotify_playlist_id": playlist["spotify_playlist_id"],
        "playlist_name": playlist.get("display_name") or playlist["spotify_playlist_id"],
        "run_date": run_date,
        "current_count": today.follower_count,
        "baseline_count": baseline,
        "absolute_jump": absolute_jump,
        "percent_jump": round(percent_jump, 2) if percent_jump is not None else None,
        "comparison_window_days": rule.comparison_window_days,
    }


class Postgrest:
    def __init__(self, supabase_url: str, service_role_key: str):
        self.base = supabase_url.rstrip("/") + "/rest/v1"
        self.h = {
            "Authorization": f"Bearer {service_role_key}",
            "apikey": service_role_key,
            "Content-Type": "application/json",
            "Accept-Profile": "playlist_watch",
            "Content-Profile": "playlist_watch",
        }

    def _request(self, method: str, path: str, **kwargs) -> requests.Response:
        response = requests.request(method, f"{self.base}/{path}", headers=self.h, timeout=180, **kwargs)
        if response.status_code >= 400:
            raise RuntimeError(f"PostgREST {method} {path} failed: {response.status_code} {response.text[:500]}")
        return response

    def select_active_rules(self) -> List[AlertRule]:
        path = (
            "alert_rules?"
            "select=id,user_id,recipient_email,rule_name,min_absolute_jump,min_percent_jump,comparison_window_days"
            "&is_active=eq.true"
            "&order=id.asc"
        )
        return [_to_rule(row) for row in self._request("GET", path).json()]

    def select_rule_playlist_ids(self, rule_id: int) -> List[str]:
        path = f"alert_rule_playlists?select=spotify_playlist_id&rule_id=eq.{int(rule_id)}"
        return [str(row["spotify_playlist_id"]) for row in self._request("GET", path).json()]

    def select_active_playlists(self, playlist_ids: Optional[List[str]] = None) -> List[dict]:
        filters = [
            "select=spotify_playlist_id,display_name,spotify_url,latest_follower_count,latest_snapshot_date",
            "watch_status=eq.active",
            "order=display_name.asc",
        ]
        if playlist_ids:
            quoted = ",".join(quote(value, safe="") for value in playlist_ids)
            filters.append(f"spotify_playlist_id=in.({quoted})")
        return self._request("GET", "playlists?" + "&".join(filters)).json()

    def select_snapshots(self, playlist_id: str, limit: int) -> List[Snapshot]:
        path = (
            "follower_snapshots?"
            "select=date,follower_count"
            f"&spotify_playlist_id=eq.{quote(playlist_id, safe='')}"
            "&order=date.desc"
            f"&limit={int(limit)}"
        )
        rows = self._request("GET", path).json()
        return [Snapshot(str(row["date"]), int(row["follower_count"])) for row in rows]

    def event_exists(self, rule_id: int, playlist_id: str, run_date: str) -> bool:
        path = (
            "alert_events?"
            "select=id"
            f"&rule_id=eq.{int(rule_id)}"
            f"&spotify_playlist_id=eq.{quote(playlist_id, safe='')}"
            f"&run_date=eq.{quote(run_date, safe='')}"
            "&status=eq.sent"
            "&limit=1"
        )
        return bool(self._request("GET", path).json())

    def insert_event(self, event: Dict[str, Any], status: str, error_message: Optional[str] = None) -> None:
        headers = dict(self.h)
        headers["Prefer"] = "return=minimal"
        payload = {
            "rule_id": event["rule_id"],
            "user_id": event["user_id"],
            "recipient_email": event["recipient_email"],
            "spotify_playlist_id": event["spotify_playlist_id"],
            "run_date": event["run_date"],
            "baseline_count": event["baseline_count"],
            "current_count": event["current_count"],
            "absolute_jump": event["absolute_jump"],
            "percent_jump": event["percent_jump"],
            "comparison_window_days": event["comparison_window_days"],
            "status": status,
            "error_message": error_message,
        }
        headers["Prefer"] = "resolution=merge-duplicates,return=minimal"
        response = requests.post(
            f"{self.base}/alert_events?on_conflict=rule_id,spotify_playlist_id,run_date",
            headers=headers,
            json=payload,
            timeout=180,
        )
        if response.status_code not in (200, 201, 204):
            raise RuntimeError(f"Insert alert event failed: {response.status_code} {response.text[:500]}")


def build_email(event: Dict[str, Any]) -> tuple[str, str]:
    subject = f"[StreamBase] Playlist follower spike: {event['playlist_name']}"
    percent = "n/a" if event["percent_jump"] is None else f"{event['percent_jump']:.2f}%"
    body = "\n".join(
        [
            f"Playlist Watch alert for {event['playlist_name']}",
            "",
            f"Date: {event['run_date']}",
            f"Current followers: {event['current_count']:,}",
            f"{event['comparison_window_days']}-day average: {event['baseline_count']:,}",
            f"Jump: {event['absolute_jump']:,} followers ({percent})",
            "",
            f"Playlist ID: {event['spotify_playlist_id']}",
        ]
    )
    return subject, body


def send_email(recipient: str, subject: str, body: str) -> None:
    username = (os.environ.get("NOTIFY_SMTP_USERNAME") or DEFAULT_SMTP_USERNAME).strip()
    password = require_env("NOTIFY_SMTP_PASSWORD")
    sender = (os.environ.get("PLAYLIST_WATCH_ALERT_FROM") or DEFAULT_SMTP_FROM).strip()

    message = EmailMessage()
    message["From"] = sender
    message["To"] = recipient
    message["Subject"] = subject
    message.set_content(body)

    with smtplib.SMTP("smtp.gmail.com", 587, timeout=60) as smtp:
        smtp.starttls()
        smtp.login(username, password)
        smtp.send_message(message)


def evaluate_alerts(pg: Postgrest, run_date: str, dry_run: bool = False) -> dict:
    sent = skipped_duplicates = matched = failed = 0
    for rule in pg.select_active_rules():
        scoped_ids = pg.select_rule_playlist_ids(rule.id)
        playlists = pg.select_active_playlists(scoped_ids or None)
        for playlist in playlists:
            playlist_id = playlist["spotify_playlist_id"]
            if pg.event_exists(rule.id, playlist_id, run_date):
                skipped_duplicates += 1
                continue
            snapshots = pg.select_snapshots(playlist_id, rule.comparison_window_days + 1)
            event = evaluate_rule_for_playlist(rule, playlist, snapshots, run_date)
            if event is None:
                continue
            matched += 1
            try:
                subject, body = build_email(event)
                if not dry_run:
                    send_email(rule.recipient_email, subject, body)
                    pg.insert_event(event, "sent")
                sent += 1
                print(f"ALERT {playlist_id} -> {rule.recipient_email}: +{event['absolute_jump']}")
            except Exception as exc:
                failed += 1
                if not dry_run:
                    pg.insert_event(event, "failed", str(exc)[:500])
                print(f"WARN alert failed {playlist_id} -> {rule.recipient_email}: {exc}")

    return {
        "matched": matched,
        "sent": sent,
        "failed": failed,
        "skipped_duplicates": skipped_duplicates,
        "dry_run": dry_run,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-date", default=datetime.now(timezone.utc).date().isoformat())
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    pg = Postgrest(require_env("SUPABASE_URL"), require_env("SUPABASE_SERVICE_ROLE_KEY"))
    result = evaluate_alerts(pg, args.run_date, args.dry_run)
    print(
        "Done. "
        f"matched={result['matched']} sent={result['sent']} "
        f"failed={result['failed']} skipped_duplicates={result['skipped_duplicates']}"
    )


if __name__ == "__main__":
    main()
