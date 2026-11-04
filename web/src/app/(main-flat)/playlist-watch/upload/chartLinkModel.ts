/** Pure logic linking the upload tracks page to the Beatport chart tracker. */
import {
  growthFor,
  growthPercentFor,
  normalizeHistory,
  type GrowthMetric,
  type GrowthWindow,
  type SortDir,
  type UploadTrackRow,
} from "./uploadTracksModel";

export type ChartPositionRow = {
  spotifyTrackId: string;
  chartKey: string;
  chartName: string;
  latestChartDate: string | null;
  /** Rank on the chart's latest snapshot; null = not on it today. */
  position: number | null;
  /** Rank on the latest snapshot on/before the reference Friday. */
  positionRefFriday: number | null;
  refFriday: string | null;
  bestPosition: number | null;
  daysOnChart: number | null;
  firstChartDate: string | null;
};

export type ChartCandidate = {
  chartKey: string;
  chartName: string;
  chartDate: string | null;
  position: number | null;
  positionRefFriday: number | null;
  refFriday: string | null;
  bestPosition: number | null;
  daysOnChart: number | null;
  isrc: string;
  name: string;
  mixName: string | null;
  artists: string;
  labelName: string | null;
  releaseDate: string | null;
  bpm: number | null;
  camelot: string | null;
  imageUrl: string | null;
  beatportUrl: string | null;
  spotifyTrackId: string | null;
  removedFromUploadDate: string | null;
  latestDate: string | null;
  latestPlaycount: number | null;
  playcount1d: number | null;
  playcount7d: number | null;
  history: [string, number][];
};

export type CandidateSortKey = "rank" | "plays" | "growth" | "release";

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function dateOnly(value: unknown): string | null {
  return typeof value === "string" && value.length >= 10 ? value.slice(0, 10) : null;
}

export function normalizeChartPositions(raw: unknown): ChartPositionRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r): ChartPositionRow => {
      const o = r as Record<string, unknown>;
      return {
        spotifyTrackId: String(o.spotify_track_id ?? ""),
        chartKey: String(o.chart_key ?? ""),
        chartName: String(o.chart_name ?? o.chart_key ?? ""),
        latestChartDate: dateOnly(o.latest_chart_date),
        position: num(o.position),
        positionRefFriday: num(o.position_ref_friday),
        refFriday: dateOnly(o.ref_friday),
        bestPosition: num(o.best_position),
        daysOnChart: num(o.days_on_chart),
        firstChartDate: dateOnly(o.first_chart_date),
      };
    })
    .filter((r) => r.spotifyTrackId !== "");
}

export function normalizeCandidates(raw: unknown): ChartCandidate[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r): ChartCandidate => {
    const o = r as Record<string, unknown>;
    return {
      chartKey: String(o.chart_key ?? ""),
      chartName: String(o.chart_name ?? o.chart_key ?? ""),
      chartDate: dateOnly(o.chart_date),
      position: num(o.position),
      positionRefFriday: num(o.position_ref_friday),
      refFriday: dateOnly(o.ref_friday),
      bestPosition: num(o.best_position),
      daysOnChart: num(o.days_on_chart),
      isrc: String(o.isrc ?? ""),
      name: String(o.name ?? ""),
      mixName: str(o.mix_name),
      artists: String(o.artists ?? ""),
      labelName: str(o.label_name),
      releaseDate: dateOnly(o.release_date),
      bpm: num(o.bpm),
      camelot: str(o.camelot),
      imageUrl: str(o.image_url),
      beatportUrl: str(o.beatport_url),
      spotifyTrackId: str(o.spotify_track_id),
      removedFromUploadDate: dateOnly(o.removed_from_upload_date),
      latestDate: dateOnly(o.latest_date),
      latestPlaycount: num(o.latest_playcount),
      playcount1d: num(o.playcount_1d),
      playcount7d: num(o.playcount_7d),
      history: normalizeHistory(o.history),
    };
  });
}

/** What a Beatport cell shows. */
export type BeatportMovement =
  | { kind: "up"; delta: number }
  | { kind: "down"; delta: number }
  | { kind: "same" }
  | { kind: "new" }
  | { kind: "off" };

export type BeatportCell = {
  position: number | null;
  movement: BeatportMovement;
  bestPosition: number | null;
  chartName: string;
};

/** Movement vs the reference Friday. Lower rank number is better, so a smaller rank is "up". */
export function movementOf(position: number | null, positionRefFriday: number | null): BeatportMovement {
  if (position === null) return { kind: "off" };
  if (positionRefFriday === null) return { kind: "new" };
  if (position < positionRefFriday) return { kind: "up", delta: positionRefFriday - position };
  if (position > positionRefFriday) return { kind: "down", delta: position - positionRefFriday };
  return { kind: "same" };
}

export function cellFor(r: {
  position: number | null;
  positionRefFriday: number | null;
  bestPosition: number | null;
  chartName: string;
}): BeatportCell {
  return {
    position: r.position,
    movement: movementOf(r.position, r.positionRefFriday),
    bestPosition: r.bestPosition,
    chartName: r.chartName,
  };
}

function bestOf(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

/**
 * One chart row per track: the best (lowest) current position across charts; when the track is on
 * no chart today, the row with the best historical rank. Best rank is merged across all charts.
 */
export function bestPositionByTrack(rows: ChartPositionRow[]): Map<string, ChartPositionRow> {
  const out = new Map<string, ChartPositionRow>();
  for (const r of rows) {
    const cur = out.get(r.spotifyTrackId);
    if (!cur) {
      out.set(r.spotifyTrackId, r);
      continue;
    }
    const better =
      r.position !== null
        ? cur.position === null || r.position < cur.position
        : cur.position === null && (r.bestPosition ?? Infinity) < (cur.bestPosition ?? Infinity);
    out.set(r.spotifyTrackId, { ...(better ? r : cur), bestPosition: bestOf(r.bestPosition, cur.bestPosition) });
  }
  return out;
}

/** Cells for each upload track (only tracks that charted in the lookback window). */
export function cellsByTrack(rows: ChartPositionRow[]): Map<string, BeatportCell> {
  const out = new Map<string, BeatportCell>();
  for (const [id, r] of bestPositionByTrack(rows)) out.set(id, cellFor(r));
  return out;
}

export function cellRank(cell: BeatportCell | undefined): number | null {
  return cell?.position ?? null;
}

export function candidateKey(c: ChartCandidate): string {
  return c.isrc || `${c.chartKey}:${c.name}:${c.artists}`;
}

/** Candidates on several charts collapse to the one with the best current position, per ISRC. */
export function dedupeCandidates(list: ChartCandidate[]): ChartCandidate[] {
  const byKey = new Map<string, ChartCandidate>();
  for (const c of list) {
    const key = candidateKey(c);
    const cur = byKey.get(key);
    if (!cur || (c.position ?? Infinity) < (cur.position ?? Infinity)) byKey.set(key, c);
  }
  return [...byKey.values()];
}

/** Adapter so the upload growth model (`growthFor` etc.) works on a candidate. */
export function candidateToRow(c: ChartCandidate): UploadTrackRow {
  return {
    spotifyTrackId: c.spotifyTrackId ?? "",
    name: c.name,
    artists: c.artists,
    imageUrl: c.imageUrl,
    addedDate: null,
    removedDate: null,
    releaseDate: c.releaseDate,
    latestDate: c.latestDate,
    latestPlaycount: c.latestPlaycount,
    playcount1d: c.playcount1d,
    playcount7d: c.playcount7d,
    playcount28d: null,
    playcountAtAdd: null,
    history: c.history,
  };
}

export function filterCandidates(list: ChartCandidate[], query: string): ChartCandidate[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((c) => [c.name, c.mixName ?? "", c.artists, c.labelName ?? ""].some((s) => s.toLowerCase().includes(q)));
}

function compareNullable(a: number | null, b: number | null, dir: SortDir): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // nulls always last
  if (b === null) return -1;
  return dir === "asc" ? a - b : b - a;
}

export function sortCandidates(
  list: ChartCandidate[],
  key: CandidateSortKey,
  dir: SortDir,
  window: GrowthWindow,
  metric: GrowthMetric,
  refFriday: string | null,
): ChartCandidate[] {
  const growthOf = (c: ChartCandidate) => {
    const row = candidateToRow(c);
    return metric === "pct" ? growthPercentFor(row, window, refFriday) : growthFor(row, window, refFriday);
  };
  return [...list].sort((a, b) => {
    let c = 0;
    if (key === "rank") c = compareNullable(a.position, b.position, dir);
    else if (key === "plays") c = compareNullable(a.latestPlaycount, b.latestPlaycount, dir);
    else if (key === "growth") c = compareNullable(growthOf(a), growthOf(b), dir);
    else {
      const ad = a.releaseDate;
      const bd = b.releaseDate;
      if (ad === null || bd === null) c = ad === bd ? 0 : ad === null ? 1 : -1;
      else c = dir === "asc" ? ad.localeCompare(bd) : bd.localeCompare(ad);
    }
    if (c === 0) c = compareNullable(a.position, b.position, "asc");
    return c !== 0 ? c : a.name.localeCompare(b.name);
  });
}
