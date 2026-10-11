import { describe, expect, it } from "vitest";
import { collaborationAppearanceDay, collaborationIsRecent, collaborationVisible, communitySteps, detectCommunities, streamEdgeWidth, streamNodeRadius, trackAppearanceDay, clusterColor, } from "./networkInsights";
import { buildNetworkQueryString, parseNetworkThroughDay, readNetworkToggles } from "./networkGraphUrl";
import { DEFAULT_NETWORK_SCOPE } from "./networkScope";
import type { GraphEdge } from "./networkTypes";
describe("stream sizing", () => {
  it("scales radii by square root with visible minima and a clamped maximum", () => {
    expect(streamNodeRadius(0, 100)).toBe(4);
    expect(streamNodeRadius(25, 100)).toBe(10);
    expect(streamNodeRadius(100, 100)).toBe(16);
    expect(streamNodeRadius(1e9, 100)).toBe(16);
    expect(streamNodeRadius(1, 1e9)).toBeGreaterThanOrEqual(4);
  });
  it("retains default sizes for unavailable, invalid or negative metrics", () => {
    for (const value of [null, undefined, NaN, Infinity, -1]) {
      expect(streamNodeRadius(value, 100)).toBe(5);
      expect(streamEdgeWidth(value, 100, 3)).toBeCloseTo(2.4);
    }
    expect(streamEdgeWidth(null, 100, 20)).toBe(6);
  });
  it("handles all-zero metrics and scales shared-track stream thickness", () => {
    expect(streamNodeRadius(0, 0)).toBe(4);
    expect(streamEdgeWidth(0, 0)).toBe(0.8);
    expect(streamEdgeWidth(25, 100)).toBeCloseTo(3.4);
    expect(streamEdgeWidth(1000, 100)).toBe(6);
  });
});
describe("weighted communities", () => {
  const nodes = ["a", "b", "c", "d", "e", "f", "solo"].map((id) => ({ id }));
  const edges = [
    { source: "a", target: "b", weight: 10 }, { source: "a", target: "c", weight: 10 }, { source: "b", target: "c", weight: 10 },
    { source: "d", target: "e", weight: 10 }, { source: "d", target: "f", weight: 10 }, { source: "e", target: "f", weight: 10 },
    { source: "c", target: "d", weight: 1 },
  ];
  it("keeps strongly weighted communities separate across a weak bridge", () => {
    const labels = detectCommunities(nodes, edges);
    expect(labels.get("a")).toBe(labels.get("b"));
    expect(labels.get("a")).toBe(labels.get("c"));
    expect(labels.get("d")).toBe(labels.get("e"));
    expect(labels.get("d")).toBe(labels.get("f"));
    expect(labels.get("a")).not.toBe(labels.get("d"));
    expect(labels.get("solo")).toBe("solo");
  });
  it("is deterministic across repeated loads and input / endpoint permutations", () => {
    const expected = detectCommunities(nodes, edges);
    expect(detectCommunities(nodes, edges)).toEqual(expected);
    expect(detectCommunities([...nodes].reverse(), [...edges].reverse().map((edge) => ({ ...edge, source: edge.target, target: edge.source })))).toEqual(expected);
    expect(clusterColor(expected.get("a")!, "#c7f33c", false)).toBe(clusterColor(expected.get("b")!, "#c7f33c", false));
    expect(clusterColor("a", "#c7f33c", true)).not.toBe(clusterColor("a", "#c7f33c", false));
  });
  it("yields during large-graph work and produces the same result when resumed", () => {
    const bigNodes = Array.from({ length: 1586 }, (_, i) => ({ id: `artist-${i}` }));
    const bigEdges = bigNodes.slice(1).map((node, i) => ({ source: bigNodes[i].id, target: node.id, weight: 1 }));
    const steps = communitySteps(bigNodes, bigEdges);
    let yields = 0;
    let next = steps.next();
    while (!next.done) {
      yields++;
      next = steps.next();
    }
    expect(yields).toBeGreaterThan(20);
    expect(next.value).toEqual(detectCommunities(bigNodes, bigEdges));
    expect(next.value.size).toBe(bigNodes.length);
    expect(detectCommunities([], [])).toEqual(new Map());
  });
});
describe("collaboration time", () => {
  const day = (date: string) => parseNetworkThroughDay(date)!;
  it("uses the earliest shared release, with first-seen fallback", () => {
    const edge: GraphEdge = { source: "a", target: "b", weight: 3, shared_tracks: [
        { isrc: "one", name: null, release_date: "2026-08-15", first_seen: "2026-10-01" },
        { isrc: "two", name: null, first_seen: "2026-09-10" },
        { isrc: "three", name: null, release_date: "invalid" },
      ] };
    expect(collaborationAppearanceDay(edge)).toBe(day("2026-08-15"));
    expect(trackAppearanceDay({ isrc: "x", name: null, release_date: "2026-02-30", first_seen: "2026-03-01" })).toBe(day("2026-03-01"));
    expect(trackAppearanceDay({ isrc: "x", name: null, release_date: "2026" })).toBeNull();
  });
  it("filters inclusively and retains unknown dates only in All time", () => {
    const cutoff = day("2026-09-10");
    expect(collaborationVisible(cutoff, cutoff)).toBe(true);
    expect(collaborationVisible(cutoff - 1, cutoff)).toBe(true);
    expect(collaborationVisible(cutoff + 1, cutoff)).toBe(false);
    expect(collaborationVisible(null, cutoff)).toBe(false);
    expect(collaborationVisible(null, null)).toBe(true);
    expect(collaborationVisible(cutoff + 1, null)).toBe(true);
  });
  it("highlights exactly thirty UTC dates ending today, excluding future and unknown dates", () => {
    const today = day("2026-10-11");
    expect(collaborationIsRecent(today, today)).toBe(true);
    expect(collaborationIsRecent(today - 29, today)).toBe(true);
    expect(collaborationIsRecent(today - 30, today)).toBe(false);
    expect(collaborationIsRecent(today + 1, today)).toBe(false);
    expect(collaborationIsRecent(null, today)).toBe(false);
  });
  it("round-trips insight controls alongside existing URL state", () => {
    const url = buildNetworkQueryString({ scope: DEFAULT_NETWORK_SCOPE, hideNonPrimary: true, scaleByTracks: false,
      sizeByStreams: false, colourByCluster: true, highlightRecent: true, throughDay: day("2026-09-10"),
      showImages: false, tableView: true, collabMin: 2, collabMax: 5, collabCountBasis: "primary_rows",
      trackCountMin: 3, trackCountMax: 12, selectedIds: ["a", "b"], tableSortKey: "streams_daily", tableSortDir: "desc" });
    const sp = new URLSearchParams(url);
    expect(readNetworkToggles(sp)).toMatchObject({ sizeByStreams: false, colourByCluster: true, highlightRecent: true, throughDay: day("2026-09-10"), tableView: true, showImages: false });
    expect(sp.get("sel")).toBe("a,b");
    expect(sp.get("co_basis")).toBe("primary");
    expect(sp.get("hide_non_primary")).toBe("1");
    expect(readNetworkToggles(new URLSearchParams())).toMatchObject({ sizeByStreams: true, colourByCluster: false, highlightRecent: false, throughDay: null });
    expect(readNetworkToggles(new URLSearchParams("scale_tracks=1")).sizeByStreams).toBe(false);
    expect(parseNetworkThroughDay("2026-02-30")).toBeNull();
    expect(parseNetworkThroughDay("NaN")).toBeNull();
  });
});
