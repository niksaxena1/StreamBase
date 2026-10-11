import { describe, expect, it, vi } from "vitest";
import type { supabaseService } from "@/lib/supabase/service";
import { loadHomeDiagnostics } from "./loadHomeDiagnostics";
import { ALL_COMPETITORS_KEY } from "@/lib/competitorContext";

vi.mock("@/lib/supabase/cache", () => ({
  cachedQuery: async (query: () => Promise<unknown>) => query(),
}));

const payloads: Record<string, Record<string, unknown>[]> = {
  artist_weekend_dips: [{ artist_id: "artist", artist_name: "Artist", weekday_avg: 100, avg_dip_pct: 12 }],
  track_weekend_dips: [{ isrc: "TRACK", name: "Track", weekday_avg: 100, avg_dip_pct: 10 }],
  negative_daily_streams: [{ isrc: "TRACK", date: "2026-10-10", daily_streams_delta: -10 }],
  artificial_stream_spikes: [{ isrc: " TRACK ", name: "Track", artist_names: ["Artist"],
    artist_ids: ["artist"], album_image_url: null, date: "2026-10-09", daily_streams: 1234,
    avg_same_dow: 500.25, spike_ratio: 2.46677, streams_cumulative: 123456 }],
};

function client(useSnapshots: boolean) {
  const calls: Array<{ schema: string; name: string; args: unknown }> = [];
  const build = (schema: string) => ({
    schema: (next: string) => build(next),
    rpc: async (name: string, args: unknown) => {
      calls.push({ schema, name, args });
      return { data: payloads[name.replace(/^home_/, "")], error: null };
    },
    from: (table: string) => {
      let kind = "";
      const query = {
        select: () => query,
        eq: (key: string, value: string) => { if (key === "kind") kind = value; return query; },
        order: () => query,
        limit: () => query,
        maybeSingle: async () => ({ error: null, data: table === "ingestion_runs"
          ? { finished_at: "2026-10-11T01:00:00Z" }
          : useSnapshots ? { payload: payloads[kind], computed_at: "2026-10-11T02:00:00Z",
            override_version: schema === "competitor" ? "2-1-100" : "1-1-comp2-1" } : null }),
      };
      return query;
    },
  });
  return { svc: build("public") as unknown as ReturnType<typeof supabaseService>, calls };
}

describe("Home snapshot output parity", () => {
  const args = {
    competitorLabelKey: "label-a", playlistKey: "all_catalog", latestRunDate: "2026-10-11",
    latestDataDate: "2026-10-09", artificialSpikeRatio: 1.25, artificialMinBaseline: 50,
    artificialGraceDays: 14, artificialThresholdCrossing: 1500, artificialIncludeWeekends: false,
    spikeFilterRunStart: "2026-09-12", spikeFilterRunEnd: "2026-10-11",
    overrideBuster: "own1-1-comp2-1-comp2-1-100",
  };

  it.each(["own", "competitor"] as const)("renders identical %s diagnostics from snapshots and live RPCs", async (datasetMode) => {
    const live = client(false);
    const snapshot = client(true);
    const expected = await loadHomeDiagnostics({ ...args, datasetMode, svc: live.svc });
    expect(await loadHomeDiagnostics({ ...args, datasetMode, svc: snapshot.svc })).toEqual(expected);
    expect(snapshot.calls).toEqual([]);
    expect(live.calls).toHaveLength(4);
    expect(live.calls.every((call) => call.schema === (datasetMode === "own" ? "public" : "competitor"))).toBe(true);
    const weekend = live.calls.find((call) => call.name === "home_artist_weekend_dips");
    expect(weekend?.args).toEqual(datasetMode === "own"
      ? { p_min_weekday_avg: 0, p_anchor_data_date: "2026-10-09" }
      : { p_min_weekday_avg: 0, p_anchor_snapshot_date: "2026-10-11", p_label_key: "label-a" });
  });

  it("keeps customized spikes live while other default kinds use snapshots", async () => {
    const snapshot = client(true);
    await loadHomeDiagnostics({ ...args, datasetMode: "competitor", svc: snapshot.svc, artificialSpikeRatio: 2 });
    expect(snapshot.calls).toEqual([{
      schema: "competitor", name: "home_artificial_stream_spikes", args: {
        p_spike_ratio: 2, p_min_baseline: 50, p_grace_days: 14, p_threshold_crossing_max: 1500,
        p_include_weekends: false, p_start_date: "2026-09-12", p_end_date: "2026-10-11", p_label_key: "label-a",
      },
    }]);
  });

  it("passes the NULL label unchanged to all-competitor live diagnostics", async () => {
    const live = client(false);
    await loadHomeDiagnostics({ ...args, datasetMode: "competitor", competitorLabelKey: ALL_COMPETITORS_KEY, svc: live.svc });
    expect(live.calls.every((call) => (call.args as { p_label_key: unknown }).p_label_key === null)).toBe(true);
  });
});
