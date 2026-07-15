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
import time
from typing import List, Optional

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
    ) -> List[dict]:
        """
        Supabase PostgREST commonly enforces a max row limit (often 1000);
        paginate with limit/offset. Pass `order` (e.g. "id.asc") for a stable
        pagination key when the table has one.
        """
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
