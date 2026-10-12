import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { TrackStreamsXYPoint } from "@/components/charts/TrackStreamsXYChart";
import { HomeConcentrationSection } from "./HomeConcentrationSection";
import { HomeNegativeStreamsSection } from "./HomeNegativeStreamsSection";
import { HomeArtificialStreamsSection } from "./HomeArtificialStreamsSection";
import { HomeHistorySection } from "./HomeHistorySection";
import { HomeMilestonesSection } from "./HomeMilestonesSection";
import { HomeDailyDistributionSection } from "./HomeDailyDistributionSection";
import { HomeScatterSection } from "./HomeScatterSection";

vi.mock("@/components/metrics/MetricContext", () => ({ useMetric: () => ({ metric: "streams" }) }));
vi.mock("@/components/payout/PayoutRateContext", () => ({ usePayoutRate: () => ({ streamPayoutPerStreamUsd: 0.003 }) }));
vi.mock("@/components/ui/ImagePreviewProvider", () => ({ useImagePreview: () => ({ openPreview: vi.fn() }) }));

const points: TrackStreamsXYPoint[] = Array.from({ length: 3190 }, (_, i) => ({
  isrc: `ISRC${i}`, name: `Track ${i}`, artist_names: ["Artist"], artist_ids: ["artist"],
  album_image_url: "https://i.scdn.co/image/artwork", distroPlaylistName: "Distro",
  distroPlaylistImageUrl: "https://i.scdn.co/image/distro", total_streams_cumulative: 3190 - i,
  daily_streams_delta: 1, has_prev_day: true,
}));

describe("collapsed Home sections", () => {
  it("keeps concentration data out of the DOM until opened", () => {
    const html = renderToStaticMarkup(createElement(HomeConcentrationSection, {
      trackScatterPoints: points, latestRunDate: "2026-10-12",
    }));
    expect(html).toContain("STREAM CONCENTRATION");
    expect(html).not.toContain("<tbody");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("ISRC3189");
  });

  it("does not render negative-stream rows or artwork while closed", () => {
    const html = renderToStaticMarkup(createElement(HomeNegativeStreamsSection, {
      negativeDailyStreams: points.map((p) => ({ ...p, name: p.name!, date: "2026-10-12", daily_streams_delta: -1 })),
    }));
    expect(html).toContain("TRACKS: NEGATIVE STREAMS");
    expect(html).not.toContain("<tbody");
    expect(html).not.toContain("<img");
  });

  it("does not render artificial-stream rows or artwork while closed", () => {
    const html = renderToStaticMarkup(createElement(HomeArtificialStreamsSection, {
      artificialStreamSpikes: points.map((p) => ({ ...p, name: p.name!, date: "2026-10-12",
        daily_streams: 100, avg_same_dow: 10, spike_ratio: 10, streams_cumulative: 1000 })),
      artificialStreamSpikeRatio: 3, artificialMinBaseline: 1, artificialIncludeWeekends: true,
      artificialSpikeDateStart: null, artificialSpikeDateEnd: null,
    }));
    expect(html).toContain("<summary");
    expect(html).not.toContain("<tbody");
    expect(html).not.toContain("<img");
  });

  it("does not render long history tables while closed", () => {
    const html = renderToStaticMarkup(createElement(HomeHistorySection, {
      history: Array.from({ length: 365 }, (_, i) => ({ date: `2026-01-${i + 1}`,
        track_count: 100, total_streams_cumulative: 1000, daily_streams_net: 1 })),
    }));
    expect(html).toContain("Recent History");
    expect(html).not.toContain("<tbody");
  });

  it.each([
    ["Milestones", HomeMilestonesSection],
    ["Daily Distribution", HomeDailyDistributionSection],
    ["Scatter", HomeScatterSection],
  ] as const)("does not mount the collapsed %s chart when shared track data arrives", (_name, Component) => {
    const html = renderToStaticMarkup(createElement(Component, { trackScatterPoints: points }));
    expect(html).toContain("<summary");
    expect(html.includes("recharts-wrapper")).toBe(false);
    expect(html.includes("<input")).toBe(false);
  });
});
