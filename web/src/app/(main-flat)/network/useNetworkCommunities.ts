"use client";
import { useEffect, useState } from "react";
import { communitySteps } from "./networkInsights";
import type { GraphEdge, GraphNode } from "./networkTypes";
export function useNetworkCommunities(nodes: GraphNode[], edges: GraphEdge[]) {
  const [result, setResult] = useState<{
    nodes: GraphNode[];
    edges: GraphEdge[];
    labels: Map<string, string>;
  } | null>(null);
  useEffect(() => {
    const steps = communitySteps(nodes, edges);
    let timer: ReturnType<typeof setTimeout>;
    const run = () => {
      const deadline = performance.now() + 4;
      let next = steps.next();
      while (!next.done && performance.now() < deadline)
        next = steps.next();
      if (next.done)
        setResult({ nodes, edges, labels: next.value });
      else
        timer = setTimeout(run, 0);
    };
    timer = setTimeout(run, 0);
    return () => clearTimeout(timer);
  }, [nodes, edges]);
  return result?.nodes === nodes && result.edges === edges ? result.labels : null;
}
