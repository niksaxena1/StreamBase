"""Shared PostgREST client for StreamBase pipeline scripts.

Extracted from the previously copy-pasted `Postgrest` classes in
`ingest_exports_to_supabase.py` and `ingest_competitor_exports_to_supabase.py`.
Adds bounded retries with exponential backoff so a transient network blip or
gateway 5xx no longer fails an entire nightly ingestion run.

Retry semantics:
- Idempotent operations (GET selects, merge-duplicate upserts, filtered
  PATCH/DELETE) also retry timeouts and any 5xx.
- Non-idempotent operations (plain INSERT) retry only when the request almost
  certainly never reached Postgres: connection errors and gateway statuses
  (429/502/503/504). A timeout after the request was sent is NOT retried,
  because the row may already have been written.
"""

import json
import random
import re
import time
from datetime import date
from typing import List, Optional
from urllib.parse import urlencode

import requests

# Statuses returned by the gateway/pooler before Postgres processes the
# request, so retrying is safe even for non-idempotent inserts.
_GATEWAY_STATUSES = (429, 502, 503, 504)


class Postgrest:
    def __init__(
        self,
        supabase_url: str,
        service_role_key: str,
        schema: Optional[str] = None,
        timeout_s: int = 180,
        max_retries: int = 3,
        backoff_base_s: float = 2.0,
    ):
        self.base = supabase_url.rstrip("/") + "/rest/v1"
        self.timeout_s = timeout_s
        self.max_retries = max(0, max_retries)
        self.backoff_base_s = backoff_base_s
        self.h = {
            "Authorization": f"Bearer {service_role_key}",
            "apikey": service_role_key,
            "Content-Type": "application/json",
        }
        if schema:
            # Non-public schemas (e.g. "competitor") are addressed via
            # PostgREST profile headers rather than table-name prefixes.
            self.h["Accept-Profile"] = schema
            self.h["Content-Profile"] = schema

    def _request(
        self,
        method: str,
        url: str,
        headers: dict,
        data: Optional[str] = None,
        idempotent: bool = True,
    ) -> requests.Response:
        last_exc: Optional[BaseException] = None
        for attempt in range(self.max_retries + 1):
            try:
                r = requests.request(method, url, headers=headers, data=data, timeout=self.timeout_s)
            except requests.exceptions.ConnectionError as exc:
                last_exc = exc
            except requests.exceptions.Timeout as exc:
                if not idempotent:
                    raise
                last_exc = exc
            else:
                retryable = r.status_code in _GATEWAY_STATUSES or (idempotent and r.status_code >= 500)
                if not retryable:
                    return r
                last_exc = RuntimeError(f"{method} {url.split('?')[0]} -> {r.status_code} {r.text[:200]}")
            if attempt < self.max_retries:
                delay = self.backoff_base_s * (2 ** attempt) + random.uniform(0, 1)
                print(
                    f"[postgrest] {method} {url.split('?')[0]} failed ({type(last_exc).__name__}); "
                    f"retry {attempt + 1}/{self.max_retries} in {delay:.1f}s"
                )
                time.sleep(delay)
        assert last_exc is not None
        raise last_exc

    def upsert(self, table: str, rows: List[dict], on_conflict: str):
        if not rows:
            return
        url = f"{self.base}/{table}?on_conflict={on_conflict}"
        headers = dict(self.h)
        headers["Prefer"] = "resolution=merge-duplicates,return=minimal"
        r = self._request("POST", url, headers, data=json.dumps(rows), idempotent=True)
        if r.status_code not in (200, 201, 204):
            raise RuntimeError(f"Upsert {table} failed: {r.status_code} {r.text[:500]}")

    def insert(self, table: str, rows: List[dict]):
        if not rows:
            return []
        url = f"{self.base}/{table}"
        headers = dict(self.h)
        headers["Prefer"] = "return=representation"
        r = self._request("POST", url, headers, data=json.dumps(rows), idempotent=False)
        if r.status_code not in (200, 201):
            raise RuntimeError(f"Insert {table} failed: {r.status_code} {r.text[:500]}")
        return r.json()

    def patch(self, table: str, patch_obj: dict, filters: str):
        url = f"{self.base}/{table}?{filters}"
        headers = dict(self.h)
        headers["Prefer"] = "return=minimal"
        r = self._request("PATCH", url, headers, data=json.dumps(patch_obj), idempotent=True)
        if r.status_code not in (200, 204):
            raise RuntimeError(f"Patch {table} failed: {r.status_code} {r.text[:500]}")

    def delete(self, table: str, filters: str):
        url = f"{self.base}/{table}?{filters}"
        headers = dict(self.h)
        headers["Prefer"] = "return=minimal"
        r = self._request("DELETE", url, headers, idempotent=True)
        if r.status_code not in (200, 204):
            raise RuntimeError(f"Delete {table} failed: {r.status_code} {r.text[:500]}")

    def select(self, table: str, select: str, filters: str) -> List[dict]:
        url = f"{self.base}/{table}?select={select}&{filters}"
        r = self._request("GET", url, self.h, idempotent=True)
        if r.status_code != 200:
            raise RuntimeError(f"Select {table} failed: {r.status_code} {r.text[:500]}")
        return r.json()

    def select_all(
        self,
        table: str,
        select: str,
        filters: str,
        page_size: int = 1000,
        order: Optional[str] = None,
        require_exact_count: bool = False,
    ) -> List[dict]:
        """
        Supabase PostgREST commonly enforces a max row limit (often 1000);
        paginate with limit/offset. Pass `order` (e.g. "id.asc") for a stable
        pagination key when the table has one.
        """
        if require_exact_count:
            return self.select_all_exact(table, select, filters, page_size, order)
        out: List[dict] = []
        offset = 0
        while True:
            order_part = f"&order={order}" if order else ""
            url = f"{self.base}/{table}?select={select}&{filters}{order_part}&limit={page_size}&offset={offset}"
            r = self._request("GET", url, self.h, idempotent=True)
            if r.status_code != 200:
                raise RuntimeError(f"Select {table} failed: {r.status_code} {r.text[:500]}")
            batch = r.json()
            if not batch:
                break
            out.extend(batch)
            if len(batch) < page_size:
                break
            offset += page_size
        return out

    def select_all_exact(
        self,
        table: str,
        select: str,
        filters: str,
        page_size: int = 1000,
        order: Optional[str] = None,
    ) -> List[dict]:
        """Verify a complete read using exact counts, including server-capped pages.

        Short pages are not an end marker. Advance by the received row count
        until Content-Range's total is reached; reject missing/inconsistent
        counts, ranges, changed totals and premature empty pages.
        """
        if page_size < 1 or not order:
            raise ValueError("Exact-count selects require positive page size and stable order")
        headers = {**self.h, "Prefer": "count=exact"}
        out: List[dict] = []
        total = None
        while True:
            offset = len(out)
            url = f"{self.base}/{table}?select={select}&{filters}&order={order}&limit={page_size}&offset={offset}"
            response = self._request("GET", url, headers, idempotent=True)
            if response.status_code not in (200, 206):
                raise RuntimeError(f"Exact-count select {table} failed: {response.status_code}")
            batch = response.json()
            if not isinstance(batch, list) or any(not isinstance(row, dict) for row in batch):
                raise RuntimeError(f"Exact-count select {table} returned invalid rows")
            content_range = response.headers.get("Content-Range", "")
            match = re.fullmatch(r"(?:(\d+)-(\d+)|\*)/(\d+)", content_range)
            if not match:
                raise RuntimeError(f"Exact-count select {table} has no verifiable Content-Range")
            received_total = int(match[3])
            if total is not None and total != received_total:
                raise RuntimeError(f"Exact-count select {table} changed during pagination")
            total = received_total
            if not batch:
                if total == offset and match[1] is None:
                    return out
                raise RuntimeError(f"Exact-count select {table} stopped before all rows arrived")
            if (match[1] is None or int(match[1]) != offset
                    or int(match[2]) != offset + len(batch) - 1
                    or offset + len(batch) > total):
                raise RuntimeError(f"Exact-count select {table} returned an inconsistent range")
            out.extend(batch)
            if len(out) == total:
                return out

    def rpc(self, function_name: str, params: Optional[dict] = None, idempotent: bool = True) -> Optional[dict]:
        """Call a PostgREST RPC function.

        Pipeline RPCs are refresh-style and safe to repeat; pass
        idempotent=False when invoking a function that must not run twice.
        """
        url = f"{self.base}/rpc/{function_name}"
        r = self._request("POST", url, self.h, data=json.dumps(params or {}), idempotent=idempotent)
        if r.status_code not in (200, 204):
            raise RuntimeError(f"RPC {function_name} failed: {r.status_code} {r.text[:500]}")
        return r.json() if r.content else None

    def rpc_all(
        self,
        function_name: str,
        params: Optional[dict] = None,
        *,
        order: str,
        page_size: int = 1000,
    ) -> List[dict]:
        """Page a read-only table-valued RPC using a stable, unique order.

        Use only for functions safe to call repeatedly. Keep fetching until
        an empty page, advancing by the actual number returned: a server-side
        max-rows cap may be smaller than the requested page size.
        """
        if page_size < 1 or not order.strip():
            raise ValueError("Paged RPCs require a positive page size and stable order")
        out: List[dict] = []
        offset = 0
        payload = json.dumps(params or {})
        while True:
            query = urlencode({"order": order, "limit": page_size, "offset": offset})
            url = f"{self.base}/rpc/{function_name}?{query}"
            r = self._request("POST", url, self.h, data=payload, idempotent=True)
            if r.status_code not in (200, 206):
                raise RuntimeError(f"Paged RPC {function_name} failed at offset {offset}: {r.status_code} {r.text[:500]}")
            batch = r.json()
            if not isinstance(batch, list) or any(not isinstance(row, dict) for row in batch):
                raise RuntimeError(f"Paged RPC {function_name} returned invalid rows at offset {offset}")
            if not batch:
                return out
            out.extend(batch)
            offset += len(batch)


def upsert_daily_streams(pg, rows: List[dict], run_date: date, *, table: str = "track_daily_streams", log=print) -> bool:
    """Upsert one day of ``track_daily_streams`` rows with packed-history awareness.

    Months older than ``stream_history_hot_from()`` live in the compact monthly table (and, once the owner
    removes the old partitions, no daily partition exists for them). A write to such a date:
      * is warned about loudly;
      * if the daily upsert succeeds (partition still present), the month is re-packed so readers see the row;
      * if the daily upsert fails (partition gone), it is skipped with a warning instead of failing ingestion.
    Returns True when the daily upsert happened.
    """
    hot_from = None
    try:
        raw = pg.rpc("stream_history_hot_from", {})
        if raw:
            hot_from = date.fromisoformat(str(raw)[:10])
    except Exception as e:  # best effort: never block ingestion on the cutoff lookup
        log(f"  warning: could not read stream_history_hot_from ({e}); assuming recent date")
    packed = hot_from is not None and run_date < hot_from
    try:
        pg.upsert(table, rows, on_conflict="date,isrc")
    except Exception as e:
        if not packed:
            raise
        log(f"  WARNING: {table} write for {run_date} is inside packed history (before {hot_from}) and failed ({e}); skipped")
        return False
    if packed:
        month = run_date.replace(day=1).isoformat()
        log(f"  WARNING: {table} write for {run_date} is inside packed history (before {hot_from}); re-packing {month}")
        try:
            pg.rpc("pack_stream_month", {"p_month": month})
        except Exception as e:
            log(f"  WARNING: re-pack of {month} failed ({e}); compact history may be stale until pack_stream_month is re-run")
    return True
