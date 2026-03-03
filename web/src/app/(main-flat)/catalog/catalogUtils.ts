import type { TopTrack } from "./catalogTypes";

export type TopSortKey = "name" | "release" | "total" | "daily";
export type SortState = { key: TopSortKey; asc: boolean } | null;

export function toggleSort(setter: (next: SortState) => void, current: SortState, key: TopSortKey) {
  const defaultAsc = key === "name" ? true : key === "release" ? false : false;
  if (!current || current.key !== key) {
    setter({ key, asc: defaultAsc });
    return;
  }
  setter({ key, asc: !current.asc });
}

function cmpNullableName(a: string | null | undefined, b: string | null | undefined, aIsrc: string, bIsrc: string) {
  const aa = ((a ?? "").trim() || aIsrc).toLowerCase();
  const bb = ((b ?? "").trim() || bIsrc).toLowerCase();
  return aa.localeCompare(bb);
}

export function sortTopTracks(rows: TopTrack[], state: SortState, mode: "total" | "daily") {
  if (!state) return rows;
  // Extra guard: keep behavior predictable if a mismatched key ever sneaks in.
  if (mode === "total" && state.key === "daily") return rows;
  if (mode === "daily" && state.key === "total") return rows;

  const out = [...rows];
  out.sort((a, b) => {
    let c = 0;
    if (state.key === "name") {
      c = cmpNullableName(a.name, b.name, a.isrc, b.isrc);
    } else if (state.key === "release") {
      const aa = (a.releaseDate ?? "").trim();
      const bb = (b.releaseDate ?? "").trim();
      const aNull = !aa;
      const bNull = !bb;
      if (aNull || bNull) return aNull === bNull ? 0 : aNull ? 1 : -1; // nulls last always
      c = aa.localeCompare(bb);
    } else if (state.key === "total") {
      const av = a.total;
      const bv = b.total;
      const aNull = av == null || !Number.isFinite(av);
      const bNull = bv == null || !Number.isFinite(bv);
      if (aNull || bNull) return aNull === bNull ? 0 : aNull ? 1 : -1; // nulls last always
      c = av - bv;
    } else if (state.key === "daily") {
      const av = a.daily;
      const bv = b.daily;
      const aNull = av == null || !Number.isFinite(av);
      const bNull = bv == null || !Number.isFinite(bv);
      if (aNull || bNull) return aNull === bNull ? 0 : aNull ? 1 : -1; // nulls last always
      c = av - bv;
    }

    // Stable-ish tie-break: keep deterministic order by ISRC.
    if (c === 0) c = a.isrc.localeCompare(b.isrc);

    return state.asc ? c : -c;
  });

  return out;
}
