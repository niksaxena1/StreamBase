/**
 * Pure helpers for the Charts page (third data universe, schema `charts`).
 * No Supabase / React imports so everything here is unit-testable.
 */

export const BEATPORT_TECH_HOUSE_KEY = "beatport_tech_house_top100";

export type ChartMovementRow = {
  snapshot_date: string;
  compare_date: string | null;
  position: number;
  source: string;
  source_track_id: number;
  name: string;
  mix_name: string | null;
  artists: string[] | null;
  remixers: string[] | null;
  label_name: string | null;
  release_date: string | null;
  bpm: number | null;
  musical_key: string | null;
  camelot: string | null;
  image_url: string | null;
  track_url: string | null;
  isrc: string | null;
  prev_position: number | null;
  position_change: number | null;
  is_new: boolean;
  is_reentry: boolean;
  days_on_chart: number;
  peak_position: number;
  first_charted: string;
};

export type ChartDropoutRow = {
  compare_date: string;
  prev_position: number;
  source: string;
  source_track_id: number;
  name: string;
  mix_name: string | null;
  artists: string[] | null;
  label_name: string | null;
  image_url: string | null;
  track_url: string | null;
};

export type CompareMode = 7 | 1;

export function parseCompareDays(raw: string | string[] | undefined): CompareMode {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "1" ? 1 : 7;
}

/** "YYYY-MM-DD" -> same string when it is a valid calendar date, else null. */
export function parseIsoDate(raw: string | string[] | undefined): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return null;
  return v;
}

export type MovementKind = "up" | "down" | "new" | "re" | "same" | "none";

export type MovementDisplay = {
  kind: MovementKind;
  /** Short text for the cell: "▲3", "▼2", "NEW", "RE", "–" or "". */
  text: string;
  /** Screen-reader text. */
  label: string;
};

/** What the movement cell shows. `hasCompare` is false until a comparison snapshot exists. */
export function movementDisplay(
  row: Pick<ChartMovementRow, "is_new" | "is_reentry" | "position_change">,
  hasCompare: boolean,
): MovementDisplay {
  if (!hasCompare) return { kind: "none", text: "", label: "" };
  if (row.is_new) return { kind: "new", text: "NEW", label: "New entry" };
  if (row.is_reentry) return { kind: "re", text: "RE", label: "Re-entry" };
  const change = row.position_change;
  if (change == null || change === 0) return { kind: "same", text: "–", label: "Unchanged" };
  if (change > 0) return { kind: "up", text: `▲${change}`, label: `Up ${change}` };
  return { kind: "down", text: `▼${Math.abs(change)}`, label: `Down ${Math.abs(change)}` };
}

export function artistsText(artists: string[] | null | undefined): string {
  return (artists ?? []).join(", ");
}

export function remixText(remixers: string[] | null | undefined): string | null {
  const list = remixers ?? [];
  return list.length ? `remix: ${list.join(", ")}` : null;
}

export type LabelStanding = {
  label: string;
  spots: number;
  prevSpots: number | null;
  change: number | null;
};

const UNKNOWN_LABEL = "Unknown label";

/**
 * Labels ranked by number of chart spots on the shown snapshot, with the change versus the
 * comparison snapshot. The comparison snapshot is reconstructed from the two RPC results: tracks
 * still on the chart that already had a previous position (labels taken from the current rows)
 * plus the dropouts.
 */
export function buildLabelLeaderboard(
  rows: Pick<ChartMovementRow, "label_name" | "prev_position">[],
  dropouts: Pick<ChartDropoutRow, "label_name">[],
  hasCompare: boolean,
): LabelStanding[] {
  const now = new Map<string, number>();
  const prev = new Map<string, number>();
  for (const r of rows) {
    const label = r.label_name?.trim() || UNKNOWN_LABEL;
    now.set(label, (now.get(label) ?? 0) + 1);
    if (hasCompare && r.prev_position != null) prev.set(label, (prev.get(label) ?? 0) + 1);
  }
  if (hasCompare) {
    for (const d of dropouts) {
      const label = d.label_name?.trim() || UNKNOWN_LABEL;
      prev.set(label, (prev.get(label) ?? 0) + 1);
    }
  }
  return [...now.entries()]
    .map(([label, spots]) => {
      const prevSpots = hasCompare ? (prev.get(label) ?? 0) : null;
      return { label, spots, prevSpots, change: prevSpots == null ? null : spots - prevSpots };
    })
    .sort((a, b) => b.spots - a.spots || a.label.localeCompare(b.label));
}

export type ChartSummary = {
  newCount: number | null;
  reentryCount: number | null;
  droppedCount: number | null;
  climber: { name: string; change: number } | null;
  faller: { name: string; change: number } | null;
  topLabel: { label: string; spots: number } | null;
};

export function buildChartSummary(
  rows: ChartMovementRow[],
  dropouts: ChartDropoutRow[],
  hasCompare: boolean,
): ChartSummary {
  const leaderboard = buildLabelLeaderboard(rows, dropouts, hasCompare);
  const topLabel = leaderboard.length ? { label: leaderboard[0].label, spots: leaderboard[0].spots } : null;
  if (!hasCompare) {
    return { newCount: null, reentryCount: null, droppedCount: null, climber: null, faller: null, topLabel };
  }
  let climber: ChartSummary["climber"] = null;
  let faller: ChartSummary["faller"] = null;
  for (const r of rows) {
    const c = r.position_change;
    if (c == null || c === 0) continue;
    if (c > 0 && (!climber || c > climber.change)) climber = { name: r.name, change: c };
    if (c < 0 && (!faller || c < faller.change)) faller = { name: r.name, change: c };
  }
  return {
    newCount: rows.filter((r) => r.is_new).length,
    reentryCount: rows.filter((r) => r.is_reentry).length,
    droppedCount: dropouts.length,
    climber,
    faller,
    topLabel,
  };
}

export function movementBannerText(compareDays: number): string {
  return `Movement appears once there is a snapshot ${compareDays} ${compareDays === 1 ? "day" : "days"} older.`;
}

export type HistoryPoint = { snapshot_date: string; position: number };
export type HistoryChartPoint = { date: string; position: number | null };

/** Daily series covering [today-days+1, today] with null (gap) for days the track was off the chart. */
export function buildHistorySeries(
  points: HistoryPoint[],
  endDate: string,
  days = 90,
): HistoryChartPoint[] {
  const byDate = new Map(points.map((p) => [p.snapshot_date.slice(0, 10), p.position]));
  const end = new Date(`${endDate}T00:00:00Z`);
  const out: HistoryChartPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    out.push({ date: d, position: byDate.get(d) ?? null });
  }
  // Trim leading empty days so the chart starts at the first appearance.
  const firstIdx = out.findIndex((p) => p.position != null);
  return firstIdx > 0 ? out.slice(firstIdx) : out;
}
