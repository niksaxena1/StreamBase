import { describe, expect, it } from "vitest";

import {
  buildPipelineTimeline,
  buildSourceQuality,
  inRangeStatus,
  worstStatus,
  type PipelineTodayData,
} from "./pipelineToday";

const RUN = "2026-10-14";

function base(overrides: Partial<PipelineTodayData> = {}): PipelineTodayData {
  return {
    run_date: RUN,
    generated_at: `${RUN}T20:30:00Z`,
    stages: [
      { universe: "own", stage: "refresh", status: "started", detail: null, github_run_url: "u1", at: `${RUN}T05:10:22Z` },
      { universe: "own", stage: "refresh", status: "success", detail: null, github_run_url: "u1", at: `${RUN}T05:13:08Z` },
      { universe: "own", stage: "sync_export", status: "started", detail: null, github_run_url: "u2", at: `${RUN}T05:25:15Z` },
      { universe: "own", stage: "sync_export", status: "success", detail: null, github_run_url: "u2", at: `${RUN}T05:59:49Z` },
      { universe: "competitor", stage: "refresh", status: "started", detail: null, github_run_url: "c1", at: `${RUN}T05:25:17Z` },
      { universe: "competitor", stage: "refresh", status: "success", detail: null, github_run_url: "c1", at: `${RUN}T05:31:17Z` },
      { universe: "competitor", stage: "sync_export", status: "started", detail: null, github_run_url: "c2", at: `${RUN}T05:45:16Z` },
      { universe: "competitor", stage: "sync_export", status: "success", detail: null, github_run_url: "c2", at: `${RUN}T05:55:44Z` },
    ],
    dispatches: [
      { universe: "own", stage: "refresh", http_status: 204, error: null, at: `${RUN}T05:10:00Z` },
      { universe: "competitor", stage: "refresh", http_status: 204, error: null, at: `${RUN}T05:25:00Z` },
    ],
    workflows: [
      { workflow: "artist_tools_daily.yml", http_status: 204, error: null, at: `${RUN}T13:17:00Z`, checked_at: null },
      { workflow: "spotify_playlist_watch_daily.yml", http_status: 204, error: null, at: `${RUN}T15:11:00Z`, checked_at: null },
      { workflow: "spotify_takedown_watch.yml", http_status: 204, error: null, at: `${RUN}T20:00:00Z`, checked_at: null },
    ],
    alerts: [],
    stale: { affected: 113, unfixed: 0, fixed: 113, rejected: 0, by_source: { "Beat Analytics": { fixed: 113, second_look: 0 } } },
    artist_tools: {
      status: "success", runner: "github", started_at: `${RUN}T14:39:45Z`, finished_at: `${RUN}T14:42:20Z`,
      added: 0, observed: 1089, fixed: 0, inner_status: "success", error: null, flags: { rate_limited: false },
    },
    ...overrides,
  };
}

const find = (t: ReturnType<typeof buildPipelineTimeline>, id: string) => t.steps.find((s) => s.id === id)!;

describe("buildPipelineTimeline", () => {
  it("is green when everything succeeded", () => {
    const t = buildPipelineTimeline(base(), new Date(`${RUN}T21:00:00Z`));
    expect(find(t, "own-refresh")).toMatchObject({ status: "green", label: "Success" });
    expect(find(t, "own-refresh").time).toBe("05:10 to 05:13 UTC (3m)");
    expect(find(t, "stale-fix").status).toBe("green");
    expect(find(t, "alerts").status).toBe("green");
    expect(t.overall).toBe("green");
  });

  it("second look is not needed when everything was fixed in the first pass", () => {
    const t = buildPipelineTimeline(base(), new Date(`${RUN}T21:00:00Z`));
    expect(find(t, "second-look")).toMatchObject({ status: "neutral", label: "Not needed" });
  });

  it("flags a missing second-look dispatch after 11:40 UTC when tracks stay unfixed", () => {
    const data = base({ stale: { affected: 100, unfixed: 12, fixed: 88, rejected: 0, by_source: {} } });
    expect(find(buildPipelineTimeline(data, new Date(`${RUN}T11:00:00Z`)), "second-look").label).toBe("Scheduled");
    const late = find(buildPipelineTimeline(data, new Date(`${RUN}T12:30:00Z`)), "second-look");
    expect(late.status).toBe("amber");
  });

  it("shows the second look dispatch with its HTTP status and fixes", () => {
    const data = base({
      stale: { affected: 100, unfixed: 4, fixed: 96, rejected: 1, by_source: { "Beat Analytics": { fixed: 96, second_look: 8 } } },
      workflows: [
        ...base().workflows,
        { workflow: "rapidapi_stale_fix.yml", http_status: 204, error: null, at: `${RUN}T11:30:00Z`, checked_at: null },
      ],
    });
    const step = find(buildPipelineTimeline(data, new Date(`${RUN}T13:00:00Z`)), "second-look");
    expect(step.status).toBe("green");
    expect(step.detail).toContain("HTTP 204");
    expect(step.detail).toContain("8 fixed");
    const failed = { ...data, workflows: data.workflows.map((w) => (w.workflow === "rapidapi_stale_fix.yml" ? { ...w, http_status: 422, error: "Unexpected inputs" } : w)) };
    expect(find(buildPipelineTimeline(failed, new Date(`${RUN}T13:00:00Z`)), "second-look").status).toBe("red");
  });

  it("marks a stage that has not started by 08:30 UTC red and before that neutral", () => {
    const data = base({ stages: [], dispatches: [] });
    expect(find(buildPipelineTimeline(data, new Date(`${RUN}T05:00:00Z`)), "own-refresh").status).toBe("neutral");
    expect(find(buildPipelineTimeline(data, new Date(`${RUN}T09:00:00Z`)), "own-refresh").status).toBe("red");
  });

  it("treats started as amber, stuck started (over 150 min) as red, failure as red, skipped as green", () => {
    const started = base({ stages: [{ universe: "own", stage: "refresh", status: "started", detail: null, github_run_url: null, at: `${RUN}T05:10:00Z` }] });
    expect(find(buildPipelineTimeline(started, new Date(`${RUN}T05:40:00Z`)), "own-refresh")).toMatchObject({ status: "amber", label: "Running" });
    expect(find(buildPipelineTimeline(started, new Date(`${RUN}T08:00:00Z`)), "own-refresh")).toMatchObject({ status: "red", label: "Stuck" });
    const failed = base({ stages: [{ universe: "own", stage: "refresh", status: "failure", detail: "boom", github_run_url: null, at: `${RUN}T05:20:00Z` }] });
    expect(find(buildPipelineTimeline(failed, new Date(`${RUN}T06:00:00Z`)), "own-refresh").status).toBe("red");
    const skipped = base({ stages: [{ universe: "own", stage: "refresh", status: "skipped", detail: "Already ingested", github_run_url: null, at: `${RUN}T14:00:00Z` }] });
    expect(find(buildPipelineTimeline(skipped, new Date(`${RUN}T15:00:00Z`)), "own-refresh")).toMatchObject({ status: "green", label: "Skipped" });
  });

  it("flags a failed dispatch even when no stage row exists", () => {
    const data = base({ stages: [], dispatches: [{ universe: "own", stage: "refresh", http_status: 401, error: null, at: `${RUN}T05:10:00Z` }] });
    expect(find(buildPipelineTimeline(data, new Date(`${RUN}T05:20:00Z`)), "own-refresh")).toMatchObject({ status: "red", label: "Dispatch failed" });
  });

  it("stale fix: amber with unfixed tracks, red when over the safety threshold", () => {
    const amber = base({ stale: { affected: 120, unfixed: 6, fixed: 114, rejected: 2, by_source: {} } });
    const s = find(buildPipelineTimeline(amber, new Date(`${RUN}T12:00:00Z`)), "stale-fix");
    expect(s.status).toBe("amber");
    expect(s.detail).toContain("120 stale · 114 fixed · 6 unfixed · 2 rejected");
    const red = base({ stale: { affected: 2400, unfixed: 2400, fixed: 0, rejected: 0, by_source: {} } });
    expect(find(buildPipelineTimeline(red, new Date(`${RUN}T12:00:00Z`)), "stale-fix").status).toBe("red");
  });

  it("artist.tools: partial flags and an earlier failed attempt are amber, failed is red", () => {
    const partial = base({ artist_tools: { ...base().artist_tools!, flags: { adds_incomplete: true, rate_limited: false } } });
    const p = find(buildPipelineTimeline(partial, new Date(`${RUN}T20:00:00Z`)), "artist-tools");
    expect(p.status).toBe("amber");
    expect(p.detail).toContain("partial: adds incomplete");
    const err = base({ artist_tools: { ...base().artist_tools!, inner_status: "failed", error: "artist.tools did not confirm the folder add." } });
    expect(find(buildPipelineTimeline(err, new Date(`${RUN}T20:00:00Z`)), "artist-tools").status).toBe("amber");
    const failed = base({ artist_tools: { ...base().artist_tools!, status: "failed", error: "re-run authorize" } });
    expect(find(buildPipelineTimeline(failed, new Date(`${RUN}T20:00:00Z`)), "artist-tools").status).toBe("red");
    const none = base({ artist_tools: null });
    expect(find(buildPipelineTimeline(none, new Date(`${RUN}T12:00:00Z`)), "artist-tools")).toMatchObject({ status: "neutral", label: "Scheduled" });
    expect(find(buildPipelineTimeline(none, new Date(`${RUN}T16:00:00Z`)), "artist-tools").status).toBe("red");
  });

  it("side jobs: HTTP status shown, non-2xx red, overdue daily job amber, monthly job never overdue", () => {
    const t = buildPipelineTimeline(base(), new Date(`${RUN}T21:00:00Z`));
    expect(find(t, "job-spotify_takedown_watch.yml")).toMatchObject({ status: "green" });
    expect(find(t, "job-spotify_takedown_watch.yml").detail).toContain("HTTP 204");
    expect(find(t, "job-spotify_artist_image_refresh.yml").status).toBe("neutral");
    const bad = base({ workflows: base().workflows.map((w) => (w.workflow === "spotify_takedown_watch.yml" ? { ...w, http_status: 401 } : w)) });
    expect(find(buildPipelineTimeline(bad, new Date(`${RUN}T21:00:00Z`)), "job-spotify_takedown_watch.yml").status).toBe("red");
    const old = buildPipelineTimeline(base(), new Date("2026-10-16T12:00:00Z"));
    expect(find(old, "job-spotify_takedown_watch.yml").status).toBe("amber");
    const monthly = base({ workflows: [...base().workflows, { workflow: "spotify_artist_image_refresh.yml", http_status: 204, error: null, at: "2026-10-02T15:00:00Z", checked_at: null }] });
    expect(find(buildPipelineTimeline(monthly, new Date(`${RUN}T21:00:00Z`)), "job-spotify_artist_image_refresh.yml").status).toBe("green");
  });

  it("alerts raised today are red rows; overall is the worst status", () => {
    const data = base({ alerts: [{ universe: "own", kind: "not_ingested", subject: "[StreamBase] not ingested", at: `${RUN}T08:30:00Z`, sent_at: `${RUN}T08:31:00Z`, send_error: null }] });
    const t = buildPipelineTimeline(data, new Date(`${RUN}T21:00:00Z`));
    expect(t.steps.filter((s) => s.id.startsWith("alert-"))).toHaveLength(1);
    expect(t.overall).toBe("red");
  });
});

describe("worstStatus", () => {
  it("ignores neutral and ranks red over amber over green", () => {
    expect(worstStatus(["neutral", "green"])).toBe("green");
    expect(worstStatus(["green", "amber", "neutral"])).toBe("amber");
    expect(worstStatus(["amber", "red"])).toBe("red");
    expect(worstStatus(["neutral"])).toBe("neutral");
    expect(worstStatus([])).toBe("neutral");
  });
});

describe("source quality", () => {
  it("computes hit rate and in-range share, with status thresholds", () => {
    const rows = buildSourceQuality({
      days: 30,
      rejects_total: 3,
      recent_rejects: [],
      sources: [
        { source: "Beat Analytics", active_days: 8, attempts: 200, fixes: 150, rejects: 5, checked: 100, in_range: 100, last_date: RUN },
        { source: "CheckLeakedCC", active_days: 4, attempts: null, fixes: 182, rejects: null, checked: 139, in_range: 120, last_date: RUN },
        { source: "Tiny", active_days: 1, attempts: 2, fixes: 2, rejects: 0, checked: 2, in_range: 2, last_date: RUN },
      ],
    });
    expect(rows[0]).toMatchObject({ hitRate: 75, inRangePct: 100, status: "green" });
    expect(rows[1].hitRate).toBeNull();
    expect(rows[1].inRangePct).toBeCloseTo(86.3, 1);
    expect(rows[1].status).toBe("red");
    expect(rows[2].status).toBe("neutral"); // too few checks to judge
  });

  it("status bands", () => {
    expect(inRangeStatus(97, 50)).toBe("green");
    expect(inRangeStatus(93, 50)).toBe("amber");
    expect(inRangeStatus(89, 50)).toBe("red");
    expect(inRangeStatus(null, 0)).toBe("neutral");
  });
});
