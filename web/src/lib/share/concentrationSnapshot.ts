export type ConcentrationShareRowV1 = {
  isrc: string;
  name: string | null;
  artist_names: string[] | null;
  album_image_url: string | null;
  /** ISO date string (YYYY-MM-DD) or null */
  release_date: string | null;
  distroPlaylistName: string | null;
  distroPlaylistImageUrl: string | null;
  /** Underlying stream count (daily delta or total cumulative) for the value column */
  valueStreams: number;
  sharePct: number;
  cumPct: number;
};

export type ConcentrationShareSnapshotV1 = {
  v: 1;
  title: string;
  subtitle: string;
  latestRunDate: string | null;
  viewMode: "total" | "daily";
  metric: "streams" | "revenue";
  streamPayoutPerStreamUsd: number;
  threshold: number;
  /** When true, show ISRC in the distro column; when false, show distro playlist */
  showIsrcColumn: boolean;
  tracksAboveThreshold: number;
  thresholdIdx: number;
  rowCount: number;
  rows: ConcentrationShareRowV1[];
};

function isNum(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function isStr(n: unknown): n is string {
  return typeof n === "string";
}

function isStrOrNull(n: unknown): n is string | null {
  return n === null || typeof n === "string";
}

function isStrArrayOrNull(n: unknown): n is string[] | null {
  if (n === null) return true;
  return Array.isArray(n) && n.every((x) => typeof x === "string");
}

export function parseConcentrationShareSnapshotV1(raw: unknown): ConcentrationShareSnapshotV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) return null;
  if (!isStr(o.title) || !isStr(o.subtitle)) return null;
  if (o.viewMode !== "total" && o.viewMode !== "daily") return null;
  if (o.metric !== "streams" && o.metric !== "revenue") return null;
  if (!isNum(o.streamPayoutPerStreamUsd)) return null;
  if (!isNum(o.threshold)) return null;
  if (typeof o.showIsrcColumn !== "boolean") return null;
  if (!isNum(o.tracksAboveThreshold) || !isNum(o.thresholdIdx)) return null;
  if (!isNum(o.rowCount)) return null;
  if (!Array.isArray(o.rows)) return null;

  const latestRunDate =
    o.latestRunDate == null ? null : typeof o.latestRunDate === "string" ? o.latestRunDate : null;

  const rows: ConcentrationShareRowV1[] = [];
  for (const item of o.rows) {
    if (!item || typeof item !== "object") return null;
    const r = item as Record<string, unknown>;
    if (!isStr(r.isrc)) return null;
    if (!isStrOrNull(r.name)) return null;
    if (!isStrArrayOrNull(r.artist_names)) return null;
    if (!isStrOrNull(r.album_image_url)) return null;
    if (!isStrOrNull(r.distroPlaylistName)) return null;
    if (!isStrOrNull(r.distroPlaylistImageUrl)) return null;
    if (!isNum(r.valueStreams) || !isNum(r.sharePct) || !isNum(r.cumPct)) return null;
    const releaseRaw = r.release_date;
    if (releaseRaw != null && typeof releaseRaw !== "string") return null;
    const release_date = typeof releaseRaw === "string" ? releaseRaw : null;
    rows.push({
      isrc: r.isrc,
      name: r.name,
      artist_names: r.artist_names,
      album_image_url: r.album_image_url,
      release_date,
      distroPlaylistName: r.distroPlaylistName,
      distroPlaylistImageUrl: r.distroPlaylistImageUrl,
      valueStreams: r.valueStreams,
      sharePct: r.sharePct,
      cumPct: r.cumPct,
    });
  }

  if (rows.length !== o.rowCount) return null;

  return {
    v: 1,
    title: o.title,
    subtitle: o.subtitle,
    latestRunDate,
    viewMode: o.viewMode,
    metric: o.metric,
    streamPayoutPerStreamUsd: o.streamPayoutPerStreamUsd,
    threshold: o.threshold,
    showIsrcColumn: o.showIsrcColumn,
    tracksAboveThreshold: o.tracksAboveThreshold,
    thresholdIdx: o.thresholdIdx,
    rowCount: o.rowCount,
    rows,
  };
}
