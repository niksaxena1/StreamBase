import { describe, expect, it } from "vitest";
import {
  bucketLabel,
  chartPoints,
  gapBands,
  humanBytes,
  mergeSeries,
  queryParams,
  scopeOptions,
  readableNote,
  numberValue,
  readingsExplanation,
  textValue,
} from "./explorer";
import { parseHash } from "../app/useUrlState";
describe("Explorer API transforms", () => {
  it("adds unnamed scopes from existing metadata without inventing a name", () => {
    expect(scopeOptions()).toEqual([]);
    expect(
      scopeOptions({
        scopes: [{ key: "all", label: "All", playlist_ids: [] }],
        playlists: [{ playlist_id: "unknown", name: null }],
        datasets: [],
        followers: {
          first_day: "2024-01-01",
          last_day: "2024-01-02",
          groups: [],
        },
        build: {},
      }).at(-1),
    ).toEqual({
      key: "unknown",
      label: "unknown (name unknown)",
      playlist_ids: ["unknown"],
    });
  });
  it("keeps UI-only tab and comparison changes out of API URLs", () => {
    expect(
      queryParams(
        parseHash(
          "#/track?isrc=x&tab=records&mode=compare&metric=tracks&compare=a,b&offset=0",
        ),
      ),
    ).toEqual({
      dataset: "stats2",
      grain: "day",
      from: undefined,
      to: undefined,
      isrc: "x",
    });
  });
  it("uses readable missing terminology while preserving legitimate artist credits", () => {
    expect(readableNote("Net is NULL; use non-null readings")).toBe(
      "Net is missing; use known readings",
    );
    expect(textValue("Undefined")).toBe("Undefined");
    expect(numberValue(null)).toBeNull();
    expect(numberValue(NaN)).toBeNull();
    expect(numberValue(0)).toBe(0);
  });
  it("translates UI grain and isolates follower requests from stream dataset validation", () => {
    expect(
      queryParams(
        parseHash(
          "#/followers?dataset=followers&grain=weekly&from=2026-08-01&to=2026-09-01&group=K+Request",
        ),
      ),
    ).toEqual({
      dataset: "stats2",
      grain: "week",
      from: "2026-08-01",
      to: "2026-09-01",
      group: "K Request",
    });
  });
  it("labels UTC buckets without local timezone shifts", () => {
    expect(bucketLabel("2025-01-01", "monthly")).toBe("Jan 2025");
    expect(bucketLabel("2025-01-06", "weekly")).toBe("Week of 6 Jan 2025");
    expect(bucketLabel("2025-01-01", "daily")).toBe("1 Jan 2025");
  });
  it("derives contiguous counter gap bands and treats genuine zero as observed", () => {
    expect(
      gapBands(
        [
          { bucket: "2025-01-01", streams: 0 },
          { bucket: "2025-01-02", streams: null },
          { bucket: "2025-01-03", streams: null },
          { bucket: "2025-01-04", streams: 8 },
          { bucket: "2025-01-05", streams: null },
        ],
        "streams",
      ),
    ).toEqual([
      { from: "2025-01-02", to: "2025-01-03", label: "No counter observation" },
      { from: "2025-01-05", to: "2025-01-05", label: "No counter observation" },
    ]);
  });
  it("preserves NULL deltas and server MA7, including partial buckets", () => {
    expect(
      chartPoints([
        {
          bucket: "2025-01-01",
          streams: 20,
          net: null,
          ma7: 2.5,
          has_reset: true,
        },
      ]),
    ).toEqual([
      { date: "2025-01-01", streams: 20, net: null, ma7: 2.5, has_reset: 1 },
    ]);
    expect(
      gapBands(
        [{ bucket: "2025-01-01", streams: 20, days_missing: 5 }],
        "streams",
      ),
    ).toEqual([]);
  });
  it("explains the mode separately for each linked ID", () => {
    const rows = [
      {
        spotify_track_id: "a",
        play_count: 10,
        mode: 10,
        observation_count: 3,
        mode_frequency: 2,
      },
      { spotify_track_id: "a", play_count: 10, mode: 10 },
      { spotify_track_id: "a", play_count: 12, mode: 10 },
      {
        spotify_track_id: "b",
        play_count: 12,
        mode: 12,
        observation_count: 1,
        mode_frequency: 1,
      },
    ];
    expect(readingsExplanation(rows)).toEqual([
      "a: 3 readings, 2 distinct values, chosen value occurred 2 times",
      "b: 1 readings, 1 distinct values, chosen value occurred 1 times",
    ]);
    expect(readingsExplanation([])).toEqual([]);
    expect(
      readingsExplanation([
        {
          spotify_track_id: "c",
          play_count: null,
          mode: 5,
          observation_count: 2,
          mode_frequency: 1,
        },
        { spotify_track_id: "c", play_count: 5, mode: 5 },
      ]),
    ).toEqual([
      "c: 2 readings, 1 distinct values, chosen value occurred 1 times",
    ]);
  });
  it("overlays IDs by date without filling absent counters with zero", () => {
    expect(
      mergeSeries(
        [
          { key: "a", series: [{ bucket: "2025-01-01", streams: 2 }] },
          { key: "b", series: [{ bucket: "2025-01-02", streams: null }] },
        ],
        "streams",
      ),
    ).toEqual([
      { date: "2025-01-01", a: 2 },
      { date: "2025-01-02", b: null },
    ]);
  });
  it("formats missing values and inventory sizes truthfully", () => {
    expect(textValue(null)).toBe("—");
    expect(textValue({ x: null })).toBe("x: —");
    expect(humanBytes(1024)).toBe("1.0 KiB");
    expect(humanBytes(null)).toBe("—");
  });
});
