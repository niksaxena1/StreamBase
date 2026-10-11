import type { GraphEdge, GraphNode, SharedTrack } from "./networkTypes";
export const DAY_MS = 86400000;
/** A zero stream count is known data; unavailable metrics keep the existing size. */
export function streamSize(value: number | null | undefined, maximum: number, min: number, max: number, fallback: number) {
  if (value == null || !Number.isFinite(value) || value < 0)
    return fallback;
  if (!(maximum > 0))
    return min;
  return min + Math.sqrt(Math.min(value, maximum) / maximum) * (max - min);
}
export function streamNodeRadius(value: number | null | undefined, maximum: number) {
  return streamSize(value, maximum, 4, 16, 5);
}
/** Clamp the painted and hit-test radius so known zero and unknown data both use 5. */
export function visibleStreamNodeRadius(value: number | null | undefined, maximum: number) {
  return Math.max(5, streamNodeRadius(value, maximum));
}
export function streamEdgeWidth(value: number | null | undefined, maximum: number, weight = 1) {
  return streamSize(value, maximum, 0.8, 6, Math.min(weight * 0.8, 6));
}
export function trackAppearanceDay(track: SharedTrack): number | null {
  for (const value of [track.release_date, track.first_seen]) {
    if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value))
      continue;
    const date = value.slice(0, 10);
    const time = Date.parse(`${date}T00:00:00Z`);
    if (Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date)
      return time / DAY_MS;
  }
  return null;
}
export function collaborationAppearanceDay(edge: GraphEdge): number | null {
  let earliest = Infinity;
  for (const track of edge.shared_tracks ?? []) {
    const day = trackAppearanceDay(track);
    if (day != null)
      earliest = Math.min(earliest, day);
  }
  return Number.isFinite(earliest) ? earliest : null;
}
/** All time includes unknown dates; a dated cutoff cannot place unknown collaborations. */
export function collaborationVisible(day: number | null, throughDay: number | null): boolean {
  return throughDay == null || (day != null && day <= throughDay);
}
export function collaborationIsRecent(day: number | null, todayDay: number): boolean {
  return day != null && day >= todayDay - 29 && day <= todayDay;
}
/** Weighted label propagation in canonical order, yielding throughout setup and iteration. */
export function* communitySteps(nodes: Pick<GraphNode, "id">[], edges: Pick<GraphEdge, "source" | "target" | "weight">[]) {
  const ids = [...new Set(nodes.map((node) => node.id))].sort();
  const labels = new Map(ids.map((id) => [id, id]));
  const adjacency = new Map(ids.map((id) => [id, new Map<string, number>()]));
  let work = 0;
  for (const edge of edges) {
    if (edge.source === edge.target || !labels.has(edge.source) || !labels.has(edge.target))
      continue;
    const weight = Number.isFinite(edge.weight) ? Math.max(1, edge.weight) : 1;
    for (const [a, b] of [[edge.source, edge.target], [edge.target, edge.source]]) {
      const neighbors = adjacency.get(a)!;
      neighbors.set(b, (neighbors.get(b) ?? 0) + weight);
    }
    if (++work % 64 === 0)
      yield;
  }
  // Canonical neighbor order also makes floating-point summation independent of input order.
  for (const id of ids) {
    adjacency.set(id, new Map([...adjacency.get(id)!].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)));
    if (++work % 64 === 0)
      yield;
  }
  for (let pass = 0; pass < 40; pass++) {
    let changed = false;
    for (const id of ids) {
      const scores = new Map<string, number>();
      for (const [neighbor, weight] of adjacency.get(id)!) {
        const label = labels.get(neighbor)!;
        scores.set(label, (scores.get(label) ?? 0) + weight);
        if (++work % 128 === 0)
          yield;
      }
      const current = labels.get(id)!;
      let best = current;
      let bestScore = scores.get(current) ?? 0;
      for (const [label, score] of scores) {
        if (score > bestScore || (score === bestScore && best !== current && label < best)) {
          best = label;
          bestScore = score;
        }
      }
      if (best !== current) {
        labels.set(id, best);
        changed = true;
      }
      if (++work % 64 === 0)
        yield;
    }
    if (!changed)
      break;
    yield;
  }
  // Cluster identity is its smallest artist id, independent of the propagated representative.
  const canonical = new Map<string, string>();
  for (const id of ids) {
    const label = labels.get(id)!;
    if (!canonical.has(label))
      canonical.set(label, id);
  }
  return new Map(ids.map((id) => [id, canonical.get(labels.get(id)!)!]));
}
export function detectCommunities(nodes: Pick<GraphNode, "id">[], edges: Pick<GraphEdge, "source" | "target" | "weight">[]) {
  const steps = communitySteps(nodes, edges);
  let next = steps.next();
  while (!next.done)
    next = steps.next();
  return next.value;
}
/** Muted hues blended with the active accent; lighter in dark mode. */
export function clusterColor(id: string, accent: string, isDark: boolean, rank?: number): string {
  if (rank === -1) return isDark ? "#85888f" : "#8b8d93";
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++)
    hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  const palette = isDark
    ? ["#94b8af", "#a2abc7", "#baa3c4", "#c5ab96", "#a9ba94", "#92b8c5", "#c598a3", "#bdb68f"]
    : ["#4e7f73", "#5d6e9a", "#87638f", "#936e50", "#657e4e", "#4f7b8f", "#945e70", "#817742"];
  const base = rank != null
    ? rank < palette.length ? palette[rank] : isDark ? "#7e8d91" : "#66767b"
    : palette[(hash >>> 0) % palette.length];
  const rawAccent = /^#[0-9a-f]{6}$/i.test(accent) ? accent : base;
  const channel = (hex: string, offset: number) => parseInt(hex.slice(offset, offset + 2), 16);
  return `#${[1, 3, 5].map((offset) => Math.round(channel(base, offset) * 0.85 + channel(rawAccent, offset) * 0.15).toString(16).padStart(2, "0")).join("")}`;
}

/** Rank complete communities once, so toolbar/time filtering cannot reshuffle their colours. */
export function buildClusterColors(nodes: GraphNode[], labels: Map<string, string> | null, accent: string, isDark: boolean) {
  const groups = new Map<string, { count: number; streams: number }>();
  if (!labels) return new Map<string, string>();
  for (const node of nodes) {
    const id = labels.get(node.id);
    if (id == null) continue;
    const group = groups.get(id) ?? { count: 0, streams: 0 };
    group.count++;
    group.streams += node.daily_streams ?? 0;
    groups.set(id, group);
  }
  const ranked = [...groups].filter(([, group]) => group.count >= 2)
    .sort(([a, left], [b, right]) => right.streams - left.streams || (a < b ? -1 : a > b ? 1 : 0));
  const colors = new Map([...groups].filter(([, group]) => group.count === 1)
    .map(([id]) => [id, clusterColor(id, accent, isDark, -1)]));
  ranked.forEach(([id], rank) => colors.set(id, clusterColor(id, accent, isDark, rank)));
  return colors;
}

/** Structural identity excludes metrics, images and dates, which do not affect detection. */
export function communityGraphIdentity(nodes: GraphNode[], edges: GraphEdge[]) {
  return JSON.stringify([
    [...new Set(nodes.map((node) => node.id))].sort(),
    edges.map((edge) => JSON.stringify([
      ...[edge.source, edge.target].sort(), edge.weight,
    ])).sort(),
  ]);
}

export function timeConnectedNodeIds(edges: GraphEdge[]): Set<string> {
  const ids = new Set<string>();
  for (const edge of edges) { ids.add(edge.source); ids.add(edge.target); }
  return ids;
}
