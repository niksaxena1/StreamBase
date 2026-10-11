import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphNode, GraphEdge } from "./networkTypes";

const fixture = vi.hoisted(() => ({ effects: [] as Array<() => void | (() => void)>, steps: vi.fn(), publish: vi.fn() }));
vi.mock("react", () => ({
  useEffect: (effect: () => void | (() => void)) => fixture.effects.push(effect),
  useMemo: (compute: () => unknown) => compute(),
  useState: () => [null, fixture.publish],
}));
vi.mock("./networkInsights", async (original) => {
  const actual = await original<typeof import("./networkInsights")>();
  fixture.steps.mockImplementation(actual.communitySteps);
  return { ...actual, communitySteps: fixture.steps };
});
import { useNetworkCommunities } from "./useNetworkCommunities";

beforeEach(() => {
  fixture.effects.length = 0;
  fixture.steps.mockClear();
  fixture.publish.mockClear();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => vi.useRealTimers());
function graph(prefix: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
  return {
    nodes: ["a", "b"].map((id) => ({ id: `${prefix}-${id}`, name: id, image_url: null, track_count: 1 })),
    edges: [{ source: `${prefix}-a`, target: `${prefix}-b`, weight: 1, shared_tracks: [] }],
  };
}
function useTestRender(input: ReturnType<typeof graph>, enabled: boolean) {
  const labels = useNetworkCommunities(input.nodes, input.edges, enabled);
  const cleanup = fixture.effects.pop()?.();
  return { labels, cleanup };
}

describe("lazy community detection", () => {
  it("does no work while disabled and caches the first completed enable by topology", async () => {
    const input = graph("lazy");
    expect(useTestRender(input, false).labels).toBeNull();
    await vi.runAllTimersAsync();
    expect(fixture.steps).not.toHaveBeenCalled();
    expect(useTestRender(input, true).labels).toBeNull();
    await vi.runAllTimersAsync();
    expect(fixture.steps).toHaveBeenCalledTimes(1);
    const first = useTestRender(input, true).labels;
    expect(first?.size).toBe(2);
    expect(useTestRender(input, false).labels).toBeNull();
    const equivalent = {
      nodes: [...input.nodes].reverse().map((node) => ({ ...node, daily_streams: 123 })),
      edges: input.edges.map((edge) => ({ ...edge, source: edge.target, target: edge.source })),
    };
    expect(useTestRender(equivalent, true).labels).toBe(first);
    await vi.runAllTimersAsync();
    expect(fixture.steps).toHaveBeenCalledTimes(1);
  });
  it("recomputes when topology changes and cancels pending work on disable", async () => {
    const input = graph("changed");
    const pending = useTestRender(input, true);
    if (typeof pending.cleanup === "function") pending.cleanup();
    useTestRender(input, false);
    await vi.runAllTimersAsync();
    expect(fixture.publish).not.toHaveBeenCalled();
    useTestRender(input, true);
    await vi.runAllTimersAsync();
    useTestRender({ ...input, edges: input.edges.map((edge) => ({ ...edge, weight: 2 })) }, true);
    await vi.runAllTimersAsync();
    expect(fixture.publish).toHaveBeenCalledTimes(2);
    expect(fixture.steps).toHaveBeenCalledTimes(3);
  });
});
