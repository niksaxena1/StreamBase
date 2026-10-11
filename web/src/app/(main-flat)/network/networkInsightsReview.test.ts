import { describe, expect, it } from "vitest";
import { buildClusterColors, collaborationAppearanceDay, collaborationVisible, timeConnectedNodeIds, visibleStreamNodeRadius } from "./networkInsights";
import type { GraphEdge, GraphNode } from "./networkTypes";

describe("reviewed network presentation", () => {
  it("paints known zero and unknown streams at the same visible minimum", () => {
    expect(visibleStreamNodeRadius(0, 100)).toBe(5);
    expect(visibleStreamNodeRadius(null, 100)).toBe(5);
    expect(visibleStreamNodeRadius(undefined, 100)).toBe(5);
    expect(visibleStreamNodeRadius(0, 0)).toBe(5);
    expect(visibleStreamNodeRadius(0.001, 100)).toBe(5);
    expect(visibleStreamNodeRadius(25, 100)).toBe(10);
    expect(visibleStreamNodeRadius(100, 100)).toBe(16);
  });

  it.each([false, true])("gives the top eight non-singletons distinct colours, with grey singletons (dark=%s)", (isDark) => {
    const nodes: GraphNode[] = [];
    const labels = new Map<string, string>();
    for (let rank = 0; rank < 10; rank++) {
      for (let member = 0; member < 2; member++) {
        const id = `${rank}-${member}`;
        nodes.push({ id, name: id, track_count: 1, image_url: null, daily_streams: 100 - rank });
        labels.set(id, `cluster-${rank}`);
      }
    }
    nodes.push({ id: "solo", name: "solo", track_count: 1, image_url: null, daily_streams: 99999 });
    labels.set("solo", "solo");
    const colors = buildClusterColors(nodes, labels, "#c7f33c", isDark);
    expect(new Set(Array.from({ length: 8 }, (_, rank) => colors.get(`cluster-${rank}`))).size).toBe(8);
    expect(colors.get("cluster-8")).toBe(colors.get("cluster-9"));
    expect(colors.get("solo")).toBe(isDark ? "#85888f" : "#8b8d93");
    expect(buildClusterColors(nodes, labels, "#123456", isDark).get("solo")).toBe(colors.get("solo"));
    expect(buildClusterColors([...nodes].reverse(), labels, "#c7f33c", isDark)).toEqual(colors);
    expect(buildClusterColors(nodes, null, "#c7f33c", isDark).size).toBe(0);
  });

  it("marks only endpoints of time-visible edges as connected without changing the layout graph", () => {
    const edges: GraphEdge[] = [
      { source: "a", target: "b", weight: 1, shared_tracks: [{ isrc: "old", name: null, release_date: "2026-01-01" }] },
      { source: "b", target: "c", weight: 1, shared_tracks: [{ isrc: "new", name: null, release_date: "2026-10-01" }] },
    ];
    const cutoff = Date.parse("2026-09-01T00:00:00Z") / 86400000;
    const visible = edges.filter((edge) => collaborationVisible(collaborationAppearanceDay(edge), cutoff));
    expect(timeConnectedNodeIds(visible)).toEqual(new Set(["a", "b"]));
    expect(timeConnectedNodeIds(edges)).toEqual(new Set(["a", "b", "c"]));
    expect(timeConnectedNodeIds([]).size).toBe(0);
    expect(edges).toHaveLength(2);
  });
});
