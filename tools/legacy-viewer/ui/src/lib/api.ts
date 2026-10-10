import { useCallback, useEffect, useSyncExternalStore } from "react";

export type Params = Record<
  string,
  string | number | boolean | null | undefined
>;
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public url: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export function apiUrl(path: string, params: Params = {}): string {
  if (
    !path.startsWith("/api/") ||
    path.includes("://") ||
    path.includes("#") ||
    path.includes("..")
  )
    throw new Error("Use a local /api/ path");
  const url = new URL(path, window.location.origin);
  Object.keys(params)
    .sort()
    .forEach((key) => {
      if (params[key] != null) url.searchParams.set(key, String(params[key]));
    });
  return url.pathname + url.search;
}
export async function requestJSON<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...options, credentials: "same-origin" });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    // The local server is gone (stopped/closed): tell the shell so it can show one clear screen.
    window.dispatchEvent(new Event("viewer-offline"));
    throw new ApiError("The viewer is not running", 0, url);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    if (response.ok)
      throw new ApiError(
        "The viewer returned invalid JSON",
        response.status,
        url,
      );
  }
  if (!response.ok) {
    const message =
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof body.error === "string"
        ? body.error
        : `Request failed (${response.status})`;
    throw new ApiError(message, response.status, url);
  }
  return body as T;
}
export function getJSON<T>(
  path: string,
  params: Params = {},
  signal?: AbortSignal,
): Promise<T> {
  return requestJSON<T>(apiUrl(path, params), { signal });
}
type QueryState<T> = { data?: T; error?: ApiError; loading: boolean };
type Entry = {
  state: QueryState<unknown>;
  listeners: Set<() => void>;
  controller?: AbortController;
  promise?: Promise<void>;
  updated: number;
};
const cache = new Map<string, Entry>();
function entryFor(url: string): Entry {
  let entry = cache.get(url);
  if (!entry) {
    entry = { state: { loading: true }, listeners: new Set(), updated: 0 };
    cache.set(url, entry);
  }
  return entry;
}
function publish(entry: Entry, state: QueryState<unknown>) {
  entry.state = state;
  entry.listeners.forEach((listener) => listener());
}
async function load(url: string, entry: Entry, force = false) {
  if (entry.promise) return entry.promise;
  if (!force && Date.now() - entry.updated < 60_000) return;
  const controller = new AbortController();
  entry.controller = controller;
  publish(entry, { data: entry.state.data, loading: true });
  entry.promise = requestJSON<unknown>(url, { signal: controller.signal })
    .then((data) => {
      entry.updated = Date.now();
      publish(entry, { data, loading: false });
    })
    .catch((error) => {
      if (error instanceof Error && error.name === "AbortError") return;
      publish(entry, {
        error:
          error instanceof ApiError
            ? error
            : new ApiError(String(error), 0, url),
        loading: false,
      });
    })
    .finally(() => {
      entry.promise = undefined;
    });
  return entry.promise;
}
/** Deduplicated URL cache; URL changes unsubscribe, so stale requests cannot replace the current result. */
export function useQuery<T>(path: string, params: Params = {}, enabled = true) {
  const url = apiUrl(path, params),
    entry = entryFor(url);
  const subscribe = useCallback(
    (listener: () => void) => {
      entry.listeners.add(listener);
      return () => {
        entry.listeners.delete(listener);
      };
    },
    [entry],
  );
  const snapshot = useCallback(() => entry.state as QueryState<T>, [entry]);
  const state = useSyncExternalStore(subscribe, snapshot);
  useEffect(() => {
    if (enabled) void load(url, entry);
  }, [url, entry, enabled]);
  return { ...state, refetch: () => load(url, entry, true) };
}
export function exportCSV(params: Params, filename = "legacy-archive.csv") {
  const link = document.createElement("a");
  link.href = apiUrl("/api/export", params);
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
}
