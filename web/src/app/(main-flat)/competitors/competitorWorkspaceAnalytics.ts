import type {
  ArtistMomentumRow,
  LabelDailyPoint,
  ReleaseCohortRow,
  RosterFlowRow,
  RosterMovementRow,
} from "./competitorsTypes";

export { OUTSIDE_TRACKED_SET } from "@/lib/rosterFlow";
import { OUTSIDE_TRACKED_SET } from "@/lib/rosterFlow";

export function median(values: number[]): number {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function percentChange(value: number, baseline: number): number {
  return baseline > 0 ? ((value - baseline) / baseline) * 100 : 0;
}

export type BenchmarkMode = "absolute" | "indexed" | "per_track" | "median_growth";

export function buildBenchmarkRows(
  series: LabelDailyPoint[],
  labelKeys: string[],
  mode: BenchmarkMode,
  medianLabelKeys: string[] = labelKeys,
): Array<Record<string, number | string | null>> {
  const byDate = new Map<string, Map<string, LabelDailyPoint>>();
  for (const point of series) {
    if (!labelKeys.includes(point.label_key)) continue;
    const row = byDate.get(point.date) ?? new Map<string, LabelDailyPoint>();
    row.set(point.label_key, point);
    byDate.set(point.date, row);
  }

  const dates = [...byDate.keys()].sort();
  const baselines = new Map<string, number>();
  for (const key of labelKeys) {
    const first = dates
      .map((date) => byDate.get(date)?.get(key)?.daily_streams_net ?? 0)
      .filter((value) => value > 0)
      .slice(0, 7);
    baselines.set(key, first.length ? first.reduce((sum, value) => sum + value, 0) / first.length : 0);
  }

  return dates.map((date) => {
    const output: Record<string, number | string | null> = { date };
    const growthByKey = new Map<string, number>();
    for (const key of labelKeys) {
      const point = byDate.get(date)?.get(key);
      if (!point) {
        output[key] = null;
        continue;
      }
      const daily = Number(point?.daily_streams_net ?? 0);
      const baseline = baselines.get(key) ?? 0;
      const growth = percentChange(daily, baseline);
      if (mode === "absolute") output[key] = daily;
      if (mode === "indexed") output[key] = baseline > 0 ? (daily / baseline) * 100 : 0;
      if (mode === "per_track") {
        output[key] = point && point.track_count > 0 ? daily / point.track_count : 0;
      }
      growthByKey.set(key, growth);
    }
    if (mode === "median_growth") {
      const competitorMedian = median(
        medianLabelKeys
          .filter((key) => growthByKey.has(key) && (baselines.get(key) ?? 0) > 0)
          .map((key) => growthByKey.get(key) ?? 0),
      );
      for (const key of labelKeys) {
        output[key] = growthByKey.has(key) ? (growthByKey.get(key) ?? 0) - competitorMedian : null;
      }
      output.__median = 0;
    }
    return output;
  });
}

export function buildRankRows(
  series: LabelDailyPoint[],
  labelKeys: string[],
  maxDays = 30,
): Array<Record<string, number | string>> {
  const byDate = new Map<string, Map<string, number>>();
  for (const point of series) {
    if (!labelKeys.includes(point.label_key)) continue;
    const row = byDate.get(point.date) ?? new Map<string, number>();
    row.set(point.label_key, Number(point.daily_streams_net ?? 0));
    byDate.set(point.date, row);
  }

  return [...byDate.keys()]
    .sort()
    .slice(-maxDays)
    .map((date) => {
      const values = byDate.get(date) ?? new Map<string, number>();
      const ranked = labelKeys
        .filter((key) => values.has(key))
        .map((key) => ({ key, value: values.get(key) ?? 0 }))
        .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
      const row: Record<string, number | string> = { date };
      ranked.forEach((item, index) => {
        row[item.key] = index + 1;
      });
      return row;
    });
}

export function buildShareRows(
  series: LabelDailyPoint[],
  labelKeys: string[],
  maxDays = 60,
): Array<Record<string, number | string>> {
  const byDate = new Map<string, Map<string, number>>();
  for (const point of series) {
    if (!labelKeys.includes(point.label_key)) continue;
    const row = byDate.get(point.date) ?? new Map<string, number>();
    row.set(point.label_key, Math.max(0, Number(point.daily_streams_net ?? 0)));
    byDate.set(point.date, row);
  }

  return [...byDate.keys()]
    .sort()
    .slice(-maxDays)
    .map((date) => {
      const values = labelKeys.map((key) => byDate.get(date)?.get(key) ?? 0);
      const total = values.reduce((sum, value) => sum + value, 0);
      const row: Record<string, number | string> = { date };
      labelKeys.forEach((key, index) => {
        row[key] = total > 0 ? (values[index] / total) * 100 : 0;
      });
      return row;
    });
}

export type MembershipEvent = {
  isrc: string;
  label_key: string;
  display_name: string;
  event_date: string;
};

export type MovementTrackMeta = {
  isrc: string;
  name: string;
  artist_names: string[] | null;
  album_image_url: string | null;
};

function dayDistance(a: string, b: string): number {
  const left = new Date(`${a}T00:00:00Z`).getTime();
  const right = new Date(`${b}T00:00:00Z`).getTime();
  if (!Number.isFinite(left) || !Number.isFinite(right)) return Number.POSITIVE_INFINITY;
  return Math.abs(Math.round((left - right) / 86_400_000));
}

export function buildRosterMovement(
  additions: MembershipEvent[],
  removals: MembershipEvent[],
  trackMeta: Map<string, MovementTrackMeta>,
  /** Max days between a removal and an addition to count as one move. Competitor
   * snapshots move within days; own-catalog re-distributions can take longer
   * (takedown, then re-upload through another distributor). */
  pairWindowDays = 3,
): { flows: RosterFlowRow[]; movements: RosterMovementRow[] } {
  const additionsByIsrc = new Map<string, MembershipEvent[]>();
  const removalsByIsrc = new Map<string, MembershipEvent[]>();
  for (const event of additions) {
    const rows = additionsByIsrc.get(event.isrc) ?? [];
    rows.push(event);
    additionsByIsrc.set(event.isrc, rows);
  }
  for (const event of removals) {
    const rows = removalsByIsrc.get(event.isrc) ?? [];
    rows.push(event);
    removalsByIsrc.set(event.isrc, rows);
  }

  const movements: RosterMovementRow[] = [];
  const allIsrcs = new Set([...additionsByIsrc.keys(), ...removalsByIsrc.keys()]);
  for (const isrc of allIsrcs) {
    const added = [...(additionsByIsrc.get(isrc) ?? [])];
    const removed = [...(removalsByIsrc.get(isrc) ?? [])];
    const usedAdds = new Set<number>();
    const meta = trackMeta.get(isrc);

    for (const removal of removed) {
      const addIndex = added.findIndex(
        (candidate, index) =>
          !usedAdds.has(index) &&
          candidate.label_key !== removal.label_key &&
          dayDistance(candidate.event_date, removal.event_date) <= pairWindowDays,
      );
      if (addIndex >= 0) {
        const addition = added[addIndex];
        usedAdds.add(addIndex);
        movements.push({
          isrc,
          name: meta?.name ?? isrc,
          artist_names: meta?.artist_names ?? null,
          album_image_url: meta?.album_image_url ?? null,
          source: removal.display_name,
          target: addition.display_name,
          event_date: addition.event_date > removal.event_date ? addition.event_date : removal.event_date,
        });
      } else {
        movements.push({
          isrc,
          name: meta?.name ?? isrc,
          artist_names: meta?.artist_names ?? null,
          album_image_url: meta?.album_image_url ?? null,
          source: removal.display_name,
          target: OUTSIDE_TRACKED_SET,
          event_date: removal.event_date,
        });
      }
    }

    added.forEach((addition, index) => {
      if (usedAdds.has(index)) return;
      movements.push({
        isrc,
        name: meta?.name ?? isrc,
        artist_names: meta?.artist_names ?? null,
        album_image_url: meta?.album_image_url ?? null,
        source: OUTSIDE_TRACKED_SET,
        target: addition.display_name,
        event_date: addition.event_date,
      });
    });
  }

  const flowMap = new Map<string, RosterFlowRow>();
  for (const movement of movements) {
    const key = `${movement.source}\u0000${movement.target}`;
    const current = flowMap.get(key) ?? {
      source: movement.source,
      target: movement.target,
      track_count: 0,
    };
    current.track_count += 1;
    flowMap.set(key, current);
  }

  return {
    flows: [...flowMap.values()].sort((a, b) => b.track_count - a.track_count),
    movements: movements.sort((a, b) => b.event_date.localeCompare(a.event_date)),
  };
}

export type CatalogTrackPoint = {
  isrc: string;
  release_date: string | null;
  artist_ids: string[] | null;
  artist_names: string[] | null;
  album_image_url: string | null;
  total_streams_cumulative: number;
  daily_streams_delta: number;
  label_key: string;
};

function releaseAgeBand(releaseDate: string, dataDate: string) {
  const releaseMs = new Date(`${releaseDate}T00:00:00Z`).getTime();
  const dataMs = new Date(`${dataDate}T00:00:00Z`).getTime();
  const weeks = Math.max(0, Math.floor((dataMs - releaseMs) / (7 * 86_400_000)));
  if (weeks <= 2) return { label: "0-2w", order: 0 };
  if (weeks <= 4) return { label: "3-4w", order: 1 };
  if (weeks <= 8) return { label: "5-8w", order: 2 };
  if (weeks <= 12) return { label: "9-12w", order: 3 };
  return { label: "13w+", order: 4 };
}

export function buildCatalogInsights(
  points: CatalogTrackPoint[],
  dataDate: string,
): { artists: ArtistMomentumRow[]; cohorts: ReleaseCohortRow[] } {
  const uniqueTracks = new Map<string, CatalogTrackPoint & { label_keys: Set<string> }>();
  for (const point of points) {
    const existing = uniqueTracks.get(point.isrc);
    if (existing) {
      existing.label_keys.add(point.label_key);
      continue;
    }
    uniqueTracks.set(point.isrc, { ...point, label_keys: new Set([point.label_key]) });
  }

  const artists = new Map<string, ArtistMomentumRow & { labels: Set<string>; tracks: Set<string> }>();
  for (const point of uniqueTracks.values()) {
    const ids = point.artist_ids ?? [];
    const names = point.artist_names ?? [];
    ids.forEach((artistId, index) => {
      if (!artistId) return;
      const row = artists.get(artistId) ?? {
        artist_id: artistId,
        artist_name: names[index] ?? artistId,
        image_url: point.album_image_url,
        label_keys: [],
        track_count: 0,
        daily_streams: 0,
        total_streams: 0,
        daily_per_track: 0,
        total_per_track: 0,
        labels: new Set<string>(),
        tracks: new Set<string>(),
      };
      if (!row.tracks.has(point.isrc)) {
        row.tracks.add(point.isrc);
        row.daily_streams += Number(point.daily_streams_delta ?? 0);
        row.total_streams += Number(point.total_streams_cumulative ?? 0);
      }
      point.label_keys.forEach((labelKey) => row.labels.add(labelKey));
      artists.set(artistId, row);
    });
  }

  const artistRows = [...artists.values()]
    .map((row): ArtistMomentumRow => {
      const trackCount = row.tracks.size;
      return {
        artist_id: row.artist_id,
        artist_name: row.artist_name,
        image_url: row.image_url,
        label_keys: [...row.labels].sort(),
        track_count: trackCount,
        daily_streams: row.daily_streams,
        total_streams: row.total_streams,
        daily_per_track: trackCount ? row.daily_streams / trackCount : 0,
        total_per_track: trackCount ? row.total_streams / trackCount : 0,
      };
    })
    .sort((a, b) => Math.abs(b.daily_streams) - Math.abs(a.daily_streams))
    .slice(0, 400);

  const cohortMap = new Map<
    string,
    { release_month: string; age_band: string; age_band_order: number; daily: number[]; total: number[] }
  >();
  for (const point of uniqueTracks.values()) {
    const releaseDate = String(point.release_date ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) continue;
    const releaseMonth = releaseDate.slice(0, 7);
    const age = releaseAgeBand(releaseDate, dataDate);
    const key = `${releaseMonth}|${age.order}`;
    const row = cohortMap.get(key) ?? {
      release_month: releaseMonth,
      age_band: age.label,
      age_band_order: age.order,
      daily: [],
      total: [],
    };
    row.daily.push(Number(point.daily_streams_delta ?? 0));
    row.total.push(Number(point.total_streams_cumulative ?? 0));
    cohortMap.set(key, row);
  }

  const cohorts = [...cohortMap.values()]
    .map((row): ReleaseCohortRow => ({
      release_month: row.release_month,
      age_band: row.age_band,
      age_band_order: row.age_band_order,
      track_count: row.daily.length,
      median_daily_streams: median(row.daily),
      median_total_streams: median(row.total),
    }))
    .sort((a, b) => a.release_month.localeCompare(b.release_month) || a.age_band_order - b.age_band_order)
    .slice(-40);

  return { artists: artistRows, cohorts };
}
