import { addDays, format, getISOWeek, getISOWeekYear, parseISO, setISOWeek, setISOWeekYear, startOfISOWeek } from "date-fns";

/**
 * PostgREST / drivers may return `date` as `YYYY-MM-DD` string, full ISO string, or a Date.
 */
export function normalizeReleaseDateFromRpc(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "string") {
    const m = v.trim().match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1]! : undefined;
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }
  return undefined;
}

/**
 * ISO week key `YYYY-Www` (week-numbering year + ISO week). Matches the calendar week
 * that contains the release date (Friday drops align with the same week as other territories).
 */
export function releaseWeekKey(releaseDate: string | null | undefined): string | null {
  const raw = String(releaseDate ?? "").trim();
  if (!raw) return null;
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  const day = m ? m[1]! : null;
  if (!day) return null;
  const d = parseISO(day);
  if (Number.isNaN(d.getTime())) return null;
  const y = getISOWeekYear(d);
  const w = getISOWeek(d);
  return `${y}-W${String(w).padStart(2, "0")}`;
}

export type XYValued = {
  x_value: number;
  y_value: number;
  release_date?: string | null;
};

const MAX_GROUPS = 28;
/** Log-space span per axis (~18×) — keep blobs for real same-week albums without spanning the whole chart. */
const LOG_SPREAD_MAX = 1.28;
/** Linear: max/min ratio per axis */
const LINEAR_RATIO_MAX = 12;

function isCompactGroup(xs: number[], ys: number[], logScale: boolean): boolean {
  if (xs.length < 2 || ys.length < 2) return false;
  if (logScale) {
    const lx = xs.map((v) => Math.log10(Math.max(v, 1e-12)));
    const ly = ys.map((v) => Math.log10(Math.max(v, 1e-12)));
    const sx = Math.max(...lx) - Math.min(...lx);
    const sy = Math.max(...ly) - Math.min(...ly);
    return sx <= LOG_SPREAD_MAX && sy <= LOG_SPREAD_MAX;
  }
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  if (minX <= 0 || minY <= 0) return false;
  return maxX / minX <= LINEAR_RATIO_MAX && maxY / minY <= LINEAR_RATIO_MAX;
}

/** UTC Monday 00:00 of the ISO week (for recency coloring). */
export function isoWeekKeyToUtcStartMs(weekKey: string): number | null {
  const m = weekKey.match(/^(\d{4})-W(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const w = Number(m[2]);
  if (!Number.isFinite(y) || !Number.isFinite(w) || w < 1 || w > 53) return null;
  const anchor = new Date(Date.UTC(y, 5, 15));
  const withYear = setISOWeekYear(anchor, y);
  const withWeek = setISOWeek(withYear, w);
  const monday = startOfISOWeek(withWeek);
  const t = monday.getTime();
  return Number.isFinite(t) ? t : null;
}

const GOLDEN_ANGLE = 137.50776405003784;

/**
 * Distinct hues per cohort (golden-angle on sort index) so adjacent ISO weeks read as different colors;
 * recency still nudges saturation so newer weeks pop slightly.
 */
export function cohortStyleRanked(
  rank: number,
  weekStartMs: number,
  minMs: number,
  maxMs: number,
  isDark: boolean,
): { fill: string; stroke: string } {
  const span = maxMs - minMs;
  const u = span <= 0 ? 0.5 : (weekStartMs - minMs) / span;
  const hue = (28 + rank * GOLDEN_ANGLE) % 360;
  const sat = isDark ? 40 + u * 22 : 36 + u * 24;
  const lit = isDark ? 54 : 48;
  const fillA = isDark ? 0.055 : 0.048;
  const strokeA = isDark ? 0.24 : 0.19;
  return {
    fill: `hsla(${Math.round(hue)}, ${Math.round(sat)}%, ${lit}%, ${fillA})`,
    stroke: `hsla(${Math.round(hue)}, ${Math.min(58, Math.round(sat) + 8)}%, ${lit}%, ${strokeA})`,
  };
}

/** Human-readable week range + ISO week number for tooltips. */
export function formatCohortWeekTitle(weekKey: string, weekStartMs: number): string {
  const m = weekKey.match(/^(\d{4})-W(\d{2})$/);
  const isoNum = m ? Number(m[2]) : null;
  const start = new Date(weekStartMs);
  const end = addDays(start, 6);
  const range = `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`;
  return isoNum != null && Number.isFinite(isoNum) ? `${range} · ISO week ${isoNum}` : range;
}

export type CohortHitRegion = {
  weekKey: string;
  weekStartMs: number;
  weekTitle: string;
  count: number;
  polygon: Array<{ x: number; y: number }>;
};

export type ReleaseCohortGroup<T> = { weekKey: string; weekStartMs: number; points: T[] };

/**
 * Groups by ISO release week using the full `allPoints` catalog slice, but only draws clusters
 * from tracks that are **visible** on the scatter (`visiblePoints`, e.g. top-N union). Compactness
 * is evaluated on those visible points only so a same-week album can get a hull when the
 * on-chart highlights sit together even if the full week list is spread out.
 */
export function buildTrackReleaseCohortGroups<T extends XYValued & { isrc: string }>(
  allPoints: T[],
  visiblePoints: T[],
  logScale: boolean,
): ReleaseCohortGroup<T>[] {
  const visibleIsrc = new Set(visiblePoints.map((p) => p.isrc));
  const byWeek = new Map<string, T[]>();
  for (const p of allPoints ?? []) {
    const k = releaseWeekKey(p.release_date);
    if (!k) continue;
    const arr = byWeek.get(k) ?? [];
    arr.push(p);
    byWeek.set(k, arr);
  }

  const out: ReleaseCohortGroup<T>[] = [];
  for (const [weekKey, groupAll] of byWeek) {
    if (groupAll.length < 2) continue;
    const visibleInWeek = groupAll.filter(
      (g) => visibleIsrc.has(g.isrc) && g.x_value > 0 && g.y_value > 0,
    );
    if (visibleInWeek.length < 2) continue;
    const xs = visibleInWeek.map((g) => g.x_value);
    const ys = visibleInWeek.map((g) => g.y_value);
    const compactOk = isCompactGroup(xs, ys, logScale);
    // Small same-week drops (typical album) still get a hull even if totals/dailies span wide.
    const smallRelease = visibleInWeek.length >= 2 && visibleInWeek.length <= 10;
    if (!compactOk && !smallRelease) continue;
    const weekStartMs = isoWeekKeyToUtcStartMs(weekKey);
    if (weekStartMs == null) continue;
    out.push({ weekKey, weekStartMs, points: visibleInWeek });
  }

  out.sort(
    (a, b) =>
      b.points.length - a.points.length ||
      (b.points[0]?.release_date ?? "").localeCompare(a.points[0]?.release_date ?? ""),
  );
  return out.slice(0, MAX_GROUPS);
}

