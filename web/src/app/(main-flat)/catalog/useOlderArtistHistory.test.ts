import { describe, expect, it } from "vitest";

import { mergeOlderArtistSeries } from "./useOlderArtistHistory";

describe("mergeOlderArtistSeries", () => {
  const recentCumAsc = [
    { date: "2026-01-05", value: 150 },
    { date: "2026-01-06", value: 170 },
  ];
  const recentDailyDesc = [
    { date: "2026-01-06", daily: 20, ma7: 20 },
    { date: "2026-01-05", daily: 50, ma7: 50 },
  ];

  it("keeps the recent series untouched until older rows arrive", () => {
    const out = mergeOlderArtistSeries({ recentCumAsc, recentDailyDesc, olderRows: null, startRunDate: "2026-01-01" });
    expect(out.cumAsc).toBe(recentCumAsc);
    expect(out.dailyDesc).toBe(recentDailyDesc);
  });

  it("joins older rows and recomputes daily values and MA7 across the seam", () => {
    const out = mergeOlderArtistSeries({
      recentCumAsc,
      recentDailyDesc,
      olderRows: [
        { date: "2026-01-04", streams_cumulative: 100 },
        { date: "2026-01-03", streams_cumulative: 90 },
        { date: "2025-12-01", streams_cumulative: 1 },
      ],
      startRunDate: "2026-01-03",
    });
    expect(out.cumAsc.map((p) => p.date)).toEqual(["2026-01-03", "2026-01-04", "2026-01-05", "2026-01-06"]);
    expect(out.dailyDesc.map((p) => [p.date, p.daily])).toEqual([
      ["2026-01-06", 20],
      ["2026-01-05", 50],
      ["2026-01-04", 10],
      ["2026-01-03", null],
    ]);
  });

  it("ignores older rows that overlap the recent range", () => {
    const out = mergeOlderArtistSeries({
      recentCumAsc,
      recentDailyDesc,
      olderRows: [{ date: "2026-01-05", streams_cumulative: 999 }],
      startRunDate: "2026-01-01",
    });
    expect(out.cumAsc.map((p) => p.value)).toEqual([150, 170]);
  });
});
