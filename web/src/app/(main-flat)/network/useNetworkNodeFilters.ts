"use client";

import { useMemo } from "react";

import { trackScopedCoartistCount } from "./networkGraphPure";
import type { CollabCountBasis } from "./networkGraphTypes";
import { coartistCountInRange, collabRangeIsActive } from "./networkGraphUrl";
import type { GraphEdge, GraphNode } from "./networkTypes";

/**
 * Toolbar-filter derivations for the network graph: node size range, graph degree,
 * track-scoped co-artist counts, and the node ids passing the co-artist / track-count bounds.
 */
export function useNetworkNodeFilters({
  nodes,
  edges,
  collabCountBasis,
  collabFilterMin,
  collabFilterMax,
  trackCountMin,
  trackCountMax,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  collabCountBasis: CollabCountBasis;
  collabFilterMin: number | null;
  collabFilterMax: number | null;
  trackCountMin: number | null;
  trackCountMax: number | null;
}) {
  // Compute node size range
  const { minTrackCount, maxTrackCount } = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const n of nodes) {
      if (n.track_count < min) min = n.track_count;
      if (n.track_count > max) max = n.track_count;
    }
    return { minTrackCount: min, maxTrackCount: max };
  }, [nodes]);

  /** Graph edge degree (co-primary links only when hide-non-primary — can undercount). */
  const graphDegreeMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of edges) {
      map.set(e.source, (map.get(e.source) ?? 0) + 1);
      map.set(e.target, (map.get(e.target) ?? 0) + 1);
    }
    return map;
  }, [edges]);

  /** Distinct co-credited artists — basis picks playlist-wide vs primary-row-only. */
  const trackCollabFilterMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const node of nodes) {
      map.set(node.id, trackScopedCoartistCount(node, collabCountBasis));
    }
    return map;
  }, [nodes, collabCountBasis]);

  const collabVisibleNodeIds = useMemo(() => {
    if (!collabRangeIsActive(collabFilterMin, collabFilterMax)) return null;
    const s = new Set<string>();
    for (const node of nodes) {
      const cnt = trackCollabFilterMap.get(node.id) ?? 0;
      if (coartistCountInRange(cnt, collabFilterMin, collabFilterMax)) s.add(node.id);
    }
    return s;
  }, [nodes, trackCollabFilterMap, collabFilterMin, collabFilterMax]);

  const { trackCountMinEffective, trackCountMaxEffective } = useMemo(() => {
    const a = trackCountMin;
    const b = trackCountMax;
    if (a != null && b != null && a > b) {
      return { trackCountMinEffective: b, trackCountMaxEffective: a };
    }
    return { trackCountMinEffective: a, trackCountMaxEffective: b };
  }, [trackCountMin, trackCountMax]);

  /** Co-artist filter ∩ in-scope track-count bounds (graph node `track_count`). */
  const filteredVisibleNodeIds = useMemo(() => {
    const hasCollab = collabVisibleNodeIds !== null;
    const hasTc = trackCountMinEffective != null || trackCountMaxEffective != null;
    if (!hasCollab && !hasTc) return null;

    const out = new Set<string>();
    for (const node of nodes) {
      if (hasCollab && !collabVisibleNodeIds!.has(node.id)) continue;
      const tc = node.track_count ?? 0;
      if (trackCountMinEffective != null && tc < trackCountMinEffective) continue;
      if (trackCountMaxEffective != null && tc > trackCountMaxEffective) continue;
      out.add(node.id);
    }
    return out;
  }, [nodes, collabVisibleNodeIds, trackCountMinEffective, trackCountMaxEffective]);

  return {
    minTrackCount,
    maxTrackCount,
    graphDegreeMap,
    trackCollabFilterMap,
    trackCountMinEffective,
    trackCountMaxEffective,
    filteredVisibleNodeIds,
  };
}
