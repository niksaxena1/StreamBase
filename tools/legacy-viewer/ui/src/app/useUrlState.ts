import { useCallback, useSyncExternalStore } from "react";
export type Dataset = "stats2" | "stats" | "followers";
export type Grain = "daily" | "weekly" | "monthly";
export type UrlState = {
  page: string;
  dataset: Dataset;
  from: string;
  to: string;
  grain: Grain;
  params: Record<string, string>;
};
const subscribe = (callback: () => void) => {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
};
function validDate(raw: string | null): string {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
  const date = new Date(`${raw}T00:00:00Z`);
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === raw
    ? raw
    : "";
}
export function parseHash(hash: string): UrlState {
  const [route, query = ""] = hash.replace(/^#\/?/, "").split("?");
  const search = new URLSearchParams(query),
    rawDataset = search.get("dataset"),
    rawGrain = search.get("grain");
  const params = Object.fromEntries(search);
  ["dataset", "from", "to", "grain"].forEach((key) => delete params[key]);
  let from = validDate(search.get("from")),
    to = validDate(search.get("to"));
  if (["original", "original-dashboards", "tax"].includes(route)) {
    const time = (raw: string | null) =>
      raw &&
      (raw === "now" ||
        /^now-\d+[smhdwMy]$/.test(raw) ||
        Number.isFinite(Date.parse(raw)))
        ? raw
        : "";
    from = time(search.get("from"));
    to = time(search.get("to"));
  }
  if (
    from &&
    to &&
    /^\d{4}-\d{2}-\d{2}$/.test(from) &&
    /^\d{4}-\d{2}-\d{2}$/.test(to) &&
    from > to
  ) {
    from = "";
    to = "";
  }
  return {
    page: route || "lookup",
    dataset:
      rawDataset === "stats" || rawDataset === "followers"
        ? rawDataset
        : "stats2",
    from,
    to,
    grain: rawGrain === "weekly" || rawGrain === "monthly" ? rawGrain : "daily",
    params,
  };
}
export function serializeState(state: UrlState): string {
  const query = new URLSearchParams({
    ...state.params,
    dataset: state.dataset,
    grain: state.grain,
  });
  if (state.from) query.set("from", state.from);
  if (state.to) query.set("to", state.to);
  return `#/${state.page}?${query}`;
}
export function useUrlState() {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  const state = parseHash(hash);
  const setState = useCallback((patch: Partial<UrlState>) => {
    window.location.hash = serializeState({
      ...parseHash(window.location.hash),
      ...patch,
    });
    // Controlled inputs need their URL-backed value during the current event.
    // The browser's later hashchange also handles links and back/forward.
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }, []);
  return [state, setState] as const;
}
