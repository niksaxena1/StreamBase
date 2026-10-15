import type { ReactNode } from "react";

import { dataDateFromRunDate } from "@/lib/sotDates";
import {
  buildPipelineTimeline,
  buildSourceQuality,
  loadPipelineToday,
  loadSourceQuality,
  type StepStatus,
} from "@/lib/health/pipelineToday";
import { supabaseService } from "@/lib/supabase/service";

type RpcClient = Parameters<typeof loadPipelineToday>[0];

/** The service client is typed against the generated schema; these two RPCs are new and untyped. */
function rpcClient(): RpcClient {
  return supabaseService() as unknown as RpcClient;
}

const STATUS_COLOR: Record<StepStatus, string> = {
  green: "var(--sb-positive)",
  amber: "var(--sb-warning)",
  red: "var(--sb-error)",
  neutral: "var(--sb-muted)",
};

const STATUS_WORD: Record<StepStatus, string> = {
  green: "OK",
  amber: "Attention",
  red: "Problem",
  neutral: "Pending",
};

function Dot({ status, size = 10 }: { status: StepStatus; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block flex-shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: status === "neutral" ? "transparent" : STATUS_COLOR[status],
        border: `2px solid ${STATUS_COLOR[status]}`,
      }}
    />
  );
}

function StatusPill({ status }: { status: StepStatus }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium sb-ring"
      style={{ color: STATUS_COLOR[status] }}
    >
      <Dot status={status} size={8} />
      {STATUS_WORD[status]}
    </span>
  );
}

function CardShell({ title, subtitle, right, children }: { title: string; subtitle?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="sb-ring rounded-2xl bg-white/70 p-4 dark:bg-white/5" aria-label={title}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {subtitle ? (
            <div className="mt-0.5 text-xs" style={{ color: "var(--sb-muted)" }}>
              {subtitle}
            </div>
          ) : null}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export async function PipelineTodayCard() {
  let data: Awaited<ReturnType<typeof loadPipelineToday>> = null;
  try {
    data = await loadPipelineToday(rpcClient());
  } catch {
    data = null;
  }
  if (!data) {
    return (
      <CardShell title="Today's pipeline">
        <p className="text-xs" style={{ color: "var(--sb-muted)" }}>
          Pipeline status is unavailable right now (the status query failed).
        </p>
      </CardShell>
    );
  }

  const timeline = buildPipelineTimeline(data);

  return (
    <CardShell
      title="Today's pipeline"
      subtitle={`Run date ${data.run_date} (UTC) · data date ${dataDateFromRunDate(data.run_date)}`}
      right={<StatusPill status={timeline.overall} />}
    >
      <ol className="relative ml-[5px] space-y-0.5 border-l pl-4" style={{ borderColor: "var(--sb-border)" }}>
        {timeline.steps.map((step) => (
          <li key={step.id} className="relative py-1.5">
            <span className="absolute -left-[22px] top-[11px] rounded-full" style={{ background: "var(--sb-bg)" }}>
              <Dot status={step.status} />
            </span>
            <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
              <div className="min-w-0 text-sm">
                {step.href ? (
                  <a href={step.href} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                    {step.title}
                  </a>
                ) : (
                  <span className="font-medium">{step.title}</span>
                )}{" "}
                <span className="text-xs font-medium" style={{ color: STATUS_COLOR[step.status] }}>
                  {step.label}
                </span>
              </div>
              {step.time ? (
                <div className="font-mono text-[11px] tabular-nums sm:flex-shrink-0" style={{ color: "var(--sb-muted)" }}>
                  {step.time}
                </div>
              ) : null}
            </div>
            {step.detail ? (
              <div className="break-words text-xs" style={{ color: "var(--sb-muted)" }}>
                {step.detail}
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </CardShell>
  );
}

function pct(n: number | null): string {
  return n == null ? "n/a" : `${n.toFixed(n >= 99.95 || n === 0 ? 0 : 1)}%`;
}

export async function SourceQualityCard() {
  let data: Awaited<ReturnType<typeof loadSourceQuality>> = null;
  try {
    data = await loadSourceQuality(rpcClient(), 30);
  } catch {
    data = null;
  }
  if (!data) {
    return (
      <CardShell title="Source quality (30 days)">
        <p className="text-xs" style={{ color: "var(--sb-muted)" }}>
          Source quality is unavailable right now.
        </p>
      </CardShell>
    );
  }

  const rows = buildSourceQuality(data);

  return (
    <CardShell
      title="Source quality (30 days)"
      subtitle="Fixes per stream source, and how often a fix landed between the previous day and SpotOnTrack's next-day value"
    >
      {rows.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--sb-muted)" }}>
          No stale-track fixes recorded yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-xs">
            <thead>
              <tr className="text-left" style={{ color: "var(--sb-muted)" }}>
                <th className="py-1 pr-2 font-medium">Source</th>
                <th className="py-1 pr-2 text-right font-medium">Fixes</th>
                <th className="py-1 pr-2 text-right font-medium">Attempts</th>
                <th className="py-1 pr-2 text-right font-medium">Rejects</th>
                <th className="py-1 text-right font-medium">In range</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.source} className="border-t" style={{ borderColor: "var(--sb-border)" }}>
                  <td className="py-1.5 pr-2 font-medium">{r.source}</td>
                  <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{r.fixes}</td>
                  <td className="py-1.5 pr-2 text-right font-mono tabular-nums">
                    {r.attempts == null ? "n/a" : r.attempts}
                    {r.hitRate != null ? (
                      <span style={{ color: "var(--sb-muted)" }}> ({pct(r.hitRate)})</span>
                    ) : null}
                  </td>
                  <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{r.rejects == null ? "n/a" : r.rejects}</td>
                  <td className="py-1.5 text-right font-mono tabular-nums">
                    <span className="inline-flex items-center justify-end gap-1.5" style={{ color: STATUS_COLOR[r.status] }}>
                      <Dot status={r.status} size={8} />
                      {pct(r.inRangePct)}
                      <span style={{ color: "var(--sb-muted)" }}> of {r.checked}</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-[11px]" style={{ color: "var(--sb-muted)" }}>
        n/a: not recorded for earlier days. {data.rejects_total} candidate value{data.rejects_total === 1 ? "" : "s"} rejected as implausible in this window.
      </p>
    </CardShell>
  );
}
