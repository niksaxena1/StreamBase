/**
 * Health page "Today's pipeline" and "Source quality" cards.
 *
 * `buildPipelineTimeline` / `buildSourceQuality` are pure (data + clock in, view model out) so the
 * green/amber/red rules are unit-tested. The loaders read two service-role-only SECURITY DEFINER
 * RPCs (`health_pipeline_today`, `health_source_quality`): the `ops` schema is not exposed to the
 * Data API, and each RPC returns one small jsonb document (about 80 ms).
 */

export type StepStatus = "green" | "amber" | "red" | "neutral";

export type StageRow = {
  universe: string;
  stage: string;
  status: string;
  detail: string | null;
  github_run_url: string | null;
  at: string;
};
export type DispatchRow = { universe: string; stage: string; http_status: number | null; error: string | null; at: string };
export type WorkflowRow = { workflow: string; http_status: number | null; error: string | null; at: string; checked_at: string | null };
export type AlertRow = { universe: string; kind: string; subject: string; at: string; sent_at: string | null; send_error: string | null };
export type ArtistToolsRow = {
  status: string;
  runner: string | null;
  started_at: string | null;
  finished_at: string | null;
  added: number;
  observed: number;
  fixed: number;
  inner_status: string | null;
  error: string | null;
  flags: Record<string, boolean>;
};
export type PipelineTodayData = {
  run_date: string;
  generated_at: string;
  stages: StageRow[];
  dispatches: DispatchRow[];
  workflows: WorkflowRow[];
  alerts: AlertRow[];
  stale: {
    affected: number;
    unfixed: number;
    fixed: number;
    rejected: number;
    by_source: Record<string, { fixed: number; second_look: number }>;
  };
  artist_tools: ArtistToolsRow | null;
};

export type TimelineStep = {
  id: string;
  title: string;
  status: StepStatus;
  /** Short status word shown next to the dot ("Success", "Waiting", ...). */
  label: string;
  /** "05:10 to 05:13 UTC (3m)" style time text, if any. */
  time: string | null;
  detail: string | null;
  href?: string | null;
};

export type PipelineTimeline = {
  runDate: string;
  overall: StepStatus;
  steps: TimelineStep[];
};

const MIN = 60_000;
export const OWN_DEADLINE_UTC = "15:30";
const SECOND_LOOK_UTC_MINUTES = 17 * 60 + 30;
const ARTIST_TOOLS_UTC_MINUTES = 18 * 60 + 17;

const SIDE_JOBS: Array<{ workflow: string; title: string; maxAgeHours: number | null; cadence: string }> = [
  { workflow: "spotify_takedown_watch.yml", title: "Takedown watch", maxAgeHours: 26, cadence: "daily 20:00 UTC" },
  { workflow: "spotify_playlist_watch_daily.yml", title: "Playlist watch", maxAgeHours: 26, cadence: "daily 15:11 UTC" },
  { workflow: "spotify_artist_image_refresh.yml", title: "Artist image refresh", maxAgeHours: null, cadence: "first Friday 15:00 UTC" },
];

function utcMinutesOfDay(d: Date): number {
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export function formatUtcTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

function formatUtcDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.toISOString().slice(5, 10)} ${formatUtcTime(iso)} UTC`;
}

function formatDuration(fromIso: string, toIso: string): string {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const m = Math.round(ms / MIN);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

const SEVERITY: Record<StepStatus, number> = { neutral: 0, green: 1, amber: 2, red: 3 };
export function worstStatus(statuses: StepStatus[]): StepStatus {
  let worst: StepStatus = "neutral";
  let seen = false;
  for (const s of statuses) {
    if (s === "neutral") continue;
    if (!seen || SEVERITY[s] > SEVERITY[worst]) worst = s;
    seen = true;
  }
  return seen ? worst : "neutral";
}

function stageStep(
  data: PipelineTodayData,
  now: Date,
  universe: "own" | "competitor",
  stage: "refresh" | "sync_export",
): TimelineStep {
  const label = `${universe === "own" ? "Own" : "Competitor"} ${stage === "refresh" ? "refresh" : "sync + export"}`;
  const id = `${universe}-${stage}`;
  const rows = data.stages.filter((r) => r.universe === universe && r.stage === stage);
  const dispatch = [...data.dispatches].reverse().find((d) => d.universe === universe && d.stage === stage);
  const dispatchText = dispatch
    ? dispatch.http_status != null
      ? `Dispatch HTTP ${dispatch.http_status} at ${formatUtcTime(dispatch.at)} UTC`
      : dispatch.error
        ? `Dispatch error: ${dispatch.error}`
        : `Dispatched ${formatUtcTime(dispatch.at)} UTC`
    : null;
  const dispatchBad = dispatch ? (dispatch.http_status != null && dispatch.http_status >= 300) || (dispatch.http_status == null && !!dispatch.error) : false;

  const last = rows[rows.length - 1];
  if (!last) {
    const deadlinePassed = utcMinutesOfDay(now) >= 15 * 60 + 30 && now.toISOString().slice(0, 10) === data.run_date;
    if (dispatchBad) return { id, title: label, status: "red", label: "Dispatch failed", time: null, detail: dispatchText };
    return {
      id,
      title: label,
      status: deadlinePassed ? "red" : "neutral",
      label: deadlinePassed ? `Not started by ${OWN_DEADLINE_UTC} UTC` : "Waiting",
      time: null,
      detail: dispatchText,
    };
  }

  const startedRow = [...rows].reverse().find((r) => r.status === "started" && r.at <= last.at);
  const terminal = last.status !== "started";
  const time = startedRow && terminal
    ? `${formatUtcTime(startedRow.at)} to ${formatUtcTime(last.at)} UTC (${formatDuration(startedRow.at, last.at)})`
    : `${formatUtcTime(last.at)} UTC`;
  const detail = [last.detail, dispatchText].filter(Boolean).join(" · ") || null;
  const href = last.github_run_url;

  if (last.status === "success") return { id, title: label, status: dispatchBad ? "amber" : "green", label: "Success", time, detail, href };
  if (last.status === "skipped") return { id, title: label, status: "green", label: "Skipped", time, detail, href };
  if (last.status === "started") {
    const ageMin = (now.getTime() - new Date(last.at).getTime()) / MIN;
    const stuck = ageMin > 150;
    return {
      id,
      title: label,
      status: stuck ? "red" : "amber",
      label: stuck ? "Stuck" : "Running",
      time: `since ${formatUtcTime(last.at)} UTC`,
      detail,
      href,
    };
  }
  return { id, title: label, status: "red", label: "Failed", time, detail, href };
}

function ownIngested(data: PipelineTodayData): boolean {
  return data.stages.some((r) => r.universe === "own" && r.stage === "sync_export" && (r.status === "success" || r.status === "skipped"));
}

function staleStep(data: PipelineTodayData, now: Date): TimelineStep {
  const s = data.stale;
  const title = "Stale-track fix";
  if (!ownIngested(data) && s.affected === 0) {
    return { id: "stale-fix", title, status: "neutral", label: "Waiting", time: null, detail: "Starts after the own export is ingested" };
  }
  if (s.affected === 0) {
    return { id: "stale-fix", title, status: "green", label: "None stale", time: null, detail: "No stale tracks in today's warning" };
  }
  const sources = Object.entries(s.by_source)
    .map(([name, v]) => `${name} ${v.fixed}`)
    .join(", ");
  const base = `${s.affected} stale · ${s.fixed} fixed · ${s.unfixed} unfixed${s.rejected ? ` · ${s.rejected} rejected` : ""}`;
  const detail = sources ? `${base} (${sources})` : base;
  if (s.affected >= 500 && s.fixed === 0) {
    return { id: "stale-fix", title, status: "red", label: "Over threshold", time: null, detail: `${base}. Auto-fix skips 500 or more stale tracks` };
  }
  if (s.unfixed === 0) return { id: "stale-fix", title, status: "green", label: "All fixed", time: null, detail };
  const sinceIngest = now.getUTCHours() >= 10;
  return {
    id: "stale-fix",
    title,
    status: "amber",
    label: sinceIngest ? "Unfixed remain" : "In progress",
    time: null,
    detail,
  };
}

function secondLookStep(data: PipelineTodayData, now: Date): TimelineStep {
  const id = "second-look";
  const title = "Second look";
  const dispatch = data.workflows.find((w) => w.workflow === "rapidapi_stale_fix.yml" && w.at.slice(0, 10) === data.run_date);
  const secondLookFixed = Object.values(data.stale.by_source).reduce((n, v) => n + v.second_look, 0);
  const isToday = now.toISOString().slice(0, 10) === data.run_date;
  const minutes = utcMinutesOfDay(now);
  if (dispatch) {
    const ok = dispatch.http_status === 204 || (dispatch.http_status != null && dispatch.http_status < 300);
    if (!ok) {
      return {
        id, title, status: "red", label: "Dispatch failed",
        time: `${formatUtcTime(dispatch.at)} UTC`,
        detail: dispatch.error ? `HTTP ${dispatch.http_status ?? "?"}: ${dispatch.error}` : `HTTP ${dispatch.http_status ?? "?"}`,
      };
    }
    return {
      id, title, status: "green", label: "Dispatched",
      time: `${formatUtcTime(dispatch.at)} UTC`,
      detail: `HTTP ${dispatch.http_status} · ${secondLookFixed} fixed on this pass · ${data.stale.unfixed} still unfixed`,
    };
  }
  if (data.stale.affected > 0 && data.stale.unfixed === 0) {
    return { id, title, status: "neutral", label: "Not needed", time: null, detail: "Every stale track was fixed in the first pass" };
  }
  if (isToday && minutes < SECOND_LOOK_UTC_MINUTES + 10) {
    return { id, title, status: "neutral", label: "Scheduled", time: "17:30 UTC", detail: null };
  }
  if (!isToday) {
    return { id, title, status: "neutral", label: "No dispatch recorded", time: null, detail: null };
  }
  return {
    id, title, status: "amber", label: "No dispatch recorded", time: "17:30 UTC",
    detail: "The database job is missing or still disabled",
  };
}

function artistToolsStep(data: PipelineTodayData, now: Date): TimelineStep {
  const id = "artist-tools";
  const title = "artist.tools";
  const at = data.artist_tools;
  const isToday = now.toISOString().slice(0, 10) === data.run_date;
  if (!at) {
    const minutes = utcMinutesOfDay(now);
    if (isToday && minutes < ARTIST_TOOLS_UTC_MINUTES + 20) {
      return { id, title, status: "neutral", label: "Scheduled", time: "18:17 UTC", detail: null };
    }
    const lateRed = isToday && minutes > 20 * 60 + 30;
    return {
      id, title, status: lateRed ? "red" : isToday ? "amber" : "neutral", label: "No run recorded", time: null,
      detail: null,
    };
  }
  const counts = `${at.added} added · ${at.observed} observed · ${at.fixed} fixed`;
  const time = at.started_at
    ? at.finished_at
      ? `${formatUtcTime(at.started_at)} to ${formatUtcTime(at.finished_at)} UTC (${formatDuration(at.started_at, at.finished_at)})`
      : `since ${formatUtcTime(at.started_at)} UTC`
    : null;
  const partial = Object.entries(at.flags ?? {})
    .filter(([, v]) => v === true)
    .map(([k]) => k.replace(/_/g, " "));
  if (at.status === "failed") {
    return { id, title, status: "red", label: "Failed", time, detail: [counts, at.error].filter(Boolean).join(" · ") };
  }
  if (at.status === "running") {
    const ageMin = at.started_at ? (now.getTime() - new Date(at.started_at).getTime()) / MIN : 0;
    return { id, title, status: ageMin > 120 ? "red" : "amber", label: ageMin > 120 ? "Stuck" : "Running", time, detail: counts };
  }
  const issues = [
    ...(at.error ? [at.error] : []),
    ...(at.inner_status === "failed" && !at.error ? ["an earlier attempt failed"] : []),
    ...(partial.length ? [`partial: ${partial.join(", ")}`] : []),
  ];
  if (issues.length) {
    return { id, title, status: "amber", label: "Partial", time, detail: [counts, ...issues].join(" · ") };
  }
  return { id, title, status: "green", label: "Success", time, detail: counts };
}

function sideJobSteps(data: PipelineTodayData, now: Date): TimelineStep[] {
  return SIDE_JOBS.map((job) => {
    const id = `job-${job.workflow}`;
    const row = data.workflows.find((w) => w.workflow === job.workflow);
    if (!row) return { id, title: job.title, status: "neutral" as StepStatus, label: "No dispatch yet", time: null, detail: job.cadence };
    const failed = row.http_status == null ? !!row.error : row.http_status >= 300;
    const unanswered = row.http_status == null && !row.error;
    const ageH = (now.getTime() - new Date(row.at).getTime()) / (60 * MIN);
    const http = row.http_status != null ? `HTTP ${row.http_status}` : row.error ? `error: ${row.error}` : "awaiting GitHub reply";
    const detail = `${http} · ${job.cadence}`;
    if (failed) return { id, title: job.title, status: "red" as StepStatus, label: "Dispatch failed", time: formatUtcDateTime(row.at), detail };
    if (unanswered) return { id, title: job.title, status: ageH > 1 ? ("amber" as StepStatus) : ("neutral" as StepStatus), label: "Pending", time: formatUtcDateTime(row.at), detail };
    if (job.maxAgeHours != null && ageH > job.maxAgeHours) {
      return { id, title: job.title, status: "amber" as StepStatus, label: "Overdue", time: formatUtcDateTime(row.at), detail };
    }
    return { id, title: job.title, status: "green" as StepStatus, label: "Dispatched", time: formatUtcDateTime(row.at), detail };
  });
}

function alertSteps(data: PipelineTodayData): TimelineStep[] {
  if (data.alerts.length === 0) {
    return [{ id: "alerts", title: "Alerts", status: "green", label: "None raised", time: null, detail: "Failures-only email policy" }];
  }
  return data.alerts.map((a, i) => ({
    id: `alert-${i}`,
    title: "Alert",
    status: "red" as StepStatus,
    label: a.sent_at ? "Emailed" : a.send_error ? "Email failed" : "Queued",
    time: `${formatUtcTime(a.at)} UTC`,
    detail: `${a.subject} (${a.universe})`,
  }));
}

export function buildPipelineTimeline(data: PipelineTodayData, now: Date = new Date()): PipelineTimeline {
  const steps: TimelineStep[] = [
    stageStep(data, now, "own", "refresh"),
    stageStep(data, now, "own", "sync_export"),
    stageStep(data, now, "competitor", "refresh"),
    stageStep(data, now, "competitor", "sync_export"),
    staleStep(data, now),
    secondLookStep(data, now),
    artistToolsStep(data, now),
    ...sideJobSteps(data, now),
    ...alertSteps(data),
  ];
  return { runDate: data.run_date, overall: worstStatus(steps.map((s) => s.status)), steps };
}

// ---------------------------------------------------------------------------------------------
// Source quality

export type SourceQualityRow = {
  source: string;
  active_days: number;
  attempts: number | null;
  fixes: number;
  rejects: number | null;
  checked: number;
  in_range: number;
  last_date: string | null;
};
export type SourceQualityData = {
  days: number;
  sources: SourceQualityRow[];
  rejects_total: number;
  recent_rejects: Array<{ date: string; isrc: string; source: string; value: number | null; reason: string }>;
};

export type SourceQualityView = {
  source: string;
  fixes: number;
  attempts: number | null;
  rejects: number | null;
  /** fixes / attempts as a percent, null when attempts were not recorded. */
  hitRate: number | null;
  checked: number;
  /** Share of checkable fixes that lie between the previous day and SpotOnTrack's next-day value. */
  inRangePct: number | null;
  status: StepStatus;
};

export function inRangeStatus(pct: number | null, checked: number): StepStatus {
  if (pct == null || checked < 5) return "neutral";
  if (pct >= 97) return "green";
  if (pct >= 90) return "amber";
  return "red";
}

export function buildSourceQuality(data: SourceQualityData): SourceQualityView[] {
  return data.sources.map((s) => {
    const inRangePct = s.checked > 0 ? (s.in_range / s.checked) * 100 : null;
    return {
      source: s.source,
      fixes: s.fixes,
      attempts: s.attempts,
      rejects: s.rejects,
      hitRate: s.attempts != null && s.attempts > 0 ? (s.fixes / s.attempts) * 100 : null,
      checked: s.checked,
      inRangePct,
      status: inRangeStatus(inRangePct, s.checked),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Loaders (server only; callers import them from server components)

type RpcClient = {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export async function loadPipelineToday(client: RpcClient, runDate?: string): Promise<PipelineTodayData | null> {
  const { data, error } = await client.rpc("health_pipeline_today", runDate ? { p_run_date: runDate } : {});
  if (error || !data || typeof data !== "object") return null;
  return data as PipelineTodayData;
}

export async function loadSourceQuality(client: RpcClient, days = 30): Promise<SourceQualityData | null> {
  const { data, error } = await client.rpc("health_source_quality", { p_days: days });
  if (error || !data || typeof data !== "object") return null;
  return data as SourceQualityData;
}
