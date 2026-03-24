import type { LinkObject, NodeObject } from "react-force-graph-2d";
import type { GraphEdge, GraphNode } from "./page";
import type { CollabCountBasis } from "./networkGraphTypes";

export type FGNodeObj = NodeObject<GraphNode>;
export type FGLinkObj = LinkObject<GraphNode, GraphEdge>;

/** Co-artists from track credits (not graph edges). */
export function trackScopedCoartistCount(n: GraphNode, basis: CollabCountBasis): number {
  const any = typeof n.co_artists_any_track === "number" ? n.co_artists_any_track : 0;
  const primary =
    typeof n.co_artists_primary_tracks === "number" ? n.co_artists_primary_tracks : 0;
  return basis === "primary_rows" ? primary : any;
}

/** Pre-compute adjacency sets for fast highlight lookups. */
export function buildAdjacency(edges: GraphEdge[]) {
  const neighbors = new Map<string, Set<string>>();
  const linksByKey = new Map<string, GraphEdge>();

  for (const e of edges) {
    if (!neighbors.has(e.source)) neighbors.set(e.source, new Set());
    if (!neighbors.has(e.target)) neighbors.set(e.target, new Set());
    neighbors.get(e.source)!.add(e.target);
    neighbors.get(e.target)!.add(e.source);
    linksByKey.set(`${e.source}__${e.target}`, e);
    linksByKey.set(`${e.target}__${e.source}`, e);
  }

  return { neighbors, linksByKey };
}

/** Scale a value within a range. */
export function scaleLinear(val: number, min: number, max: number, outMin: number, outMax: number) {
  if (max === min) return (outMin + outMax) / 2;
  return outMin + ((val - min) / (max - min)) * (outMax - outMin);
}

/** Graph-space step with “nice” 1–2–5 spacing; `rawStep` ≈ desired spacing in graph units. */
export function pickNiceGridStep(rawStep: number): number {
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 40;
  const exp = Math.floor(Math.log10(rawStep));
  const base = 10 ** exp;
  const m = rawStep / base;
  const nice = m <= 1.5 ? 1 : m <= 3.5 ? 2 : m <= 7.5 ? 5 : 10;
  return nice * base;
}

export function nearGridMultiple(value: number, step: number): boolean {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return false;
  const q = value / step;
  return Math.abs(q - Math.round(q)) < 1e-5;
}

export function isTypingTarget(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return el.isContentEditable;
}

export function linkEndpointId(end: unknown): string {
  if (end && typeof end === "object" && "id" in end) {
    return String((end as { id: string }).id);
  }
  return String(end);
}

export function collaborationLinkKey(link: FGLinkObj): string {
  const a = linkEndpointId(link.source);
  const b = linkEndpointId(link.target);
  return a < b ? `${a}\0${b}` : `${b}\0${a}`;
}

export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "").trim();
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  if (full.length !== 6) return `rgba(0,0,0,${alpha})`;
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}
