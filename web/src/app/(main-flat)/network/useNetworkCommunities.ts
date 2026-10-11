"use client";
import { useEffect, useMemo, useState } from "react";
import { communityGraphIdentity, communitySteps } from "./networkInsights";
import type { GraphEdge, GraphNode } from "./networkTypes";
// Bound memory while retaining completed graphs across toggle changes and equivalent reloads.
const graphCache = new Map<string, Map<string, string>>();
const MAX_CACHED_GRAPHS = 4;

export function useNetworkCommunities(nodes: GraphNode[], edges: GraphEdge[], enabled: boolean) {
  const identity = useMemo(() => enabled ? communityGraphIdentity(nodes, edges) : null, [nodes, edges, enabled]);
  const [result, setResult] = useState<{
    identity: string;
    labels: Map<string, string>;
  } | null>(null);
  useEffect(() => {
    if (!enabled || identity == null || graphCache.has(identity)) return;
    const steps = communitySteps(nodes, edges);
    let timer: ReturnType<typeof setTimeout>;
    const run = () => {
      const deadline = performance.now() + 4;
      let next = steps.next();
      while (!next.done && performance.now() < deadline)
        next = steps.next();
      if (next.done) {
        graphCache.set(identity, next.value);
        if (graphCache.size > MAX_CACHED_GRAPHS) graphCache.delete(graphCache.keys().next().value!);
        setResult({ identity, labels: next.value });
      }
      else
        timer = setTimeout(run, 0);
    };
    timer = setTimeout(run, 0);
    return () => clearTimeout(timer);
  }, [nodes, edges, enabled, identity]);
  return identity == null ? null : graphCache.get(identity) ?? (result?.identity === identity ? result.labels : null);
}
