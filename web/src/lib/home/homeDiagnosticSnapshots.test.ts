import { describe, expect, it, vi } from "vitest";
import type { supabaseService } from "@/lib/supabase/service";
import {
  diagnosticSnapshotVersion, readHomeDiagnosticSnapshot, snapshotOrLive, usesDefaultSpikeParameters,
} from "./homeDiagnosticSnapshots";

const row = { override_version: "7-2", payload: [{ isrc: "TRACK", daily_streams: 123 }], computed_at: "2026-10-11T02:00:00Z" };

describe("snapshot-or-live selection", () => {
  it("uses the unchanged rows for default parameters and matching version", async () => {
    const live = vi.fn();
    expect(await snapshotOrLive({ eligible: true, overrideVersion: "7-2", read: async () => row, live }))
      .toEqual({ data: row.payload, error: null });
    expect(live).not.toHaveBeenCalled();
  });

  it.each([
    { name: "version mismatch", eligible: true, version: "8-3", snapshot: row },
    { name: "missing row", eligible: true, version: "7-2", snapshot: null },
    { name: "non-default parameters", eligible: false, version: "7-2", snapshot: row },
    { name: "unknown version", eligible: true, version: null, snapshot: row },
    { name: "invalid payload", eligible: true, version: "7-2", snapshot: { ...row, payload: {} } },
    { name: "invalid row payload", eligible: true, version: "7-2", snapshot: { ...row, payload: [null] } },
  ])("falls back on $name", async ({ eligible, version, snapshot }) => {
    const response = { data: [{ source: "live" }], error: null };
    const live = vi.fn(async () => response);
    const read = vi.fn(async () => snapshot);
    expect(await snapshotOrLive({ eligible, overrideVersion: version, read, live })).toBe(response);
    expect(live).toHaveBeenCalledOnce();
    if (!eligible || version == null) expect(read).not.toHaveBeenCalled();
  });

  it("falls back on read failures without masking live errors", async () => {
    const response = { data: null, error: { message: "live failed" } };
    expect(await snapshotOrLive({ eligible: true, overrideVersion: "7-2",
      read: async () => { throw new Error("migration absent"); }, live: async () => response })).toBe(response);
  });

  it("accepts an empty snapshot and leaves oversized unpaged payloads live", async () => {
    const live = vi.fn(async () => ({ data: [], error: null }));
    await snapshotOrLive({ eligible: true, overrideVersion: "7-2", read: async () => ({ ...row, payload: [] }), live });
    expect(live).not.toHaveBeenCalled();
    await snapshotOrLive({ eligible: true, overrideVersion: "7-2", maxSnapshotRows: 1000,
      read: async () => ({ ...row, payload: Array.from({ length: 1001 }, () => ({ isrc: "TRACK" })) }), live });
    expect(live).toHaveBeenCalledOnce();
  });
});

describe("exact Home arguments", () => {
  const defaults = { runDate: "2026-10-11", ratio: 1.25, baseline: 50, graceDays: 14,
    crossingMax: 1500, includeWeekends: false, start: "2026-09-12", end: "2026-10-11" };
  it("matches the inclusive 30-day run window", () => {
    expect(usesDefaultSpikeParameters(defaults)).toBe(true);
  });
  it.each([
    { ratio: 1.5 }, { baseline: 100 }, { graceDays: 15 }, { crossingMax: 1501 },
    { includeWeekends: true }, { start: "2026-09-11" }, { end: "2026-10-10" },
    { start: null, end: null }, { runDate: null },
  ])("rejects changed arguments %j", (changes) => {
    expect(usesDefaultSpikeParameters({ ...defaults, ...changes })).toBe(false);
  });
  it("extracts both raw versions without changing the combined cache key", () => {
    const buster = "own12-3-comp9-2-comp9-2-1500";
    expect(diagnosticSnapshotVersion(buster, "own")).toBe("12-3-comp9-2");
    expect(diagnosticSnapshotVersion(buster, "competitor")).toBe("9-2-1500");
    expect(diagnosticSnapshotVersion("0", "own")).toBeNull();
  });
});

describe("snapshot row scope and ingestion freshness", () => {
  function client(computedAt: string, finishedAt = "2026-10-11T01:00:00Z", failed = false) {
    const calls: unknown[][] = [];
    const build = (schema: string, table: string) => {
      const query = {
        select: (value: string) => { calls.push([schema, table, "select", value]); return query; },
        eq: (key: string, value: unknown) => { calls.push([schema, table, key, value]); return query; },
        order: () => query,
        limit: () => query,
        maybeSingle: async () => ({ error: failed ? { message: "unavailable" } : null,
          data: table === "home_diag_snapshots" ? { ...row, computed_at: computedAt } : { finished_at: finishedAt } }),
      };
      return query;
    };
    const svc = { from: (table: string) => build("public", table),
      schema: (schema: string) => ({ from: (table: string) => build(schema, table) }) };
    return { svc: svc as unknown as ReturnType<typeof supabaseService>, calls };
  }

  it.each(["own", "competitor"] as const)("reads only the %s schema with exact keys", async (dataset) => {
    const { svc, calls } = client(row.computed_at);
    expect(await readHomeDiagnosticSnapshot({ svc, dataset, runDate: "2026-10-11", kind: "negative_daily_streams" })).toEqual(row);
    const schema = dataset === "own" ? "public" : "competitor";
    expect(calls.every((call) => call[0] === schema)).toBe(true);
    expect(calls).toContainEqual([schema, "home_diag_snapshots", "run_date", "2026-10-11"]);
    expect(calls).toContainEqual([schema, "home_diag_snapshots", "params_key", "default"]);
    if (dataset === "competitor") expect(calls).toContainEqual([schema, "home_diag_snapshots", "label_key", "__all"]);
  });

  it("uses the selected competitor label", async () => {
    const { svc, calls } = client(row.computed_at);
    await readHomeDiagnosticSnapshot({ svc, dataset: "competitor", labelKey: "label-a", runDate: "2026-10-11", kind: "track_scatter_points_for_label" });
    expect(calls).toContainEqual(["competitor", "home_diag_snapshots", "label_key", "label-a"]);
  });

  it.each([
    ["2026-10-11T00:00:00Z", "2026-10-11T01:00:00Z", false],
    ["invalid", "2026-10-11T01:00:00Z", false],
    [row.computed_at, "invalid", false],
    [row.computed_at, "2026-10-11T01:00:00Z", true],
  ])("rejects stale or unverifiable rows", async (computed, finished, failed) => {
    const { svc } = client(computed, finished, failed);
    expect(await readHomeDiagnosticSnapshot({ svc, dataset: "own", runDate: "2026-10-11", kind: "negative_daily_streams" })).toBeNull();
  });
});
