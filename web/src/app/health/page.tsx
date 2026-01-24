import Link from "next/link";

import { formatDateISO } from "@/lib/format";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export default async function HealthPage() {
  const sb = supabaseAdmin();

  const { data: runs, error: runsErr } = await sb
    .from("ingestion_runs")
    .select("run_date,status,logs_url,started_at,finished_at")
    .order("run_date", { ascending: false })
    .limit(14);

  const latestDate = runs?.[0]?.run_date ?? null;

  const { data: warnings, error: warnErr } = latestDate
    ? await sb
        .from("ingestion_warnings")
        .select("severity,code,playlist_key,message")
        .eq("run_date", latestDate)
        .order("severity", { ascending: false })
        .order("playlist_key", { ascending: true })
    : { data: [], error: null };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">System Health</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--sb-muted)" }}>
          Recent ingestion runs and anomaly warnings.
        </p>
      </div>

      {(runsErr || warnErr) && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-950">
          Query error: {runsErr?.message ?? warnErr?.message ?? "unknown error"}
        </div>
      )}

      <div className="sb-card overflow-hidden rounded-[28px]">
        <div className="border-b px-5 py-4 text-sm font-medium" style={{ borderColor: "var(--sb-border)" }}>
          Ingestion runs (last 14 days)
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs" style={{ color: "var(--sb-muted)" }}>
              <tr className="border-b" style={{ borderColor: "var(--sb-border)" }}>
                <th className="px-5 py-3 font-medium">Run date</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Logs</th>
              </tr>
            </thead>
            <tbody>
              {(runs ?? []).map((r) => (
                <tr
                  key={r.run_date}
                  className="border-b last:border-0"
                  style={{ borderColor: "var(--sb-border)" }}
                >
                  <td className="px-5 py-3 font-mono text-xs">
                    {formatDateISO(r.run_date)}
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium"
                      style={{
                        background:
                          r.status === "success"
                            ? "color-mix(in srgb, var(--sb-accent) 55%, white)"
                            : "rgba(0,0,0,0.06)",
                        color: r.status === "success" ? "black" : "black",
                        boxShadow: "0 0 0 1px var(--sb-border)",
                      }}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    {r.logs_url ? (
                      <a
                        className="underline"
                        href={r.logs_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        open
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
              {!runs?.length && (
                <tr>
                  <td className="px-5 py-8 text-sm" style={{ color: "var(--sb-muted)" }} colSpan={3}>
                    No ingestion runs yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="sb-card overflow-hidden rounded-[28px]">
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: "var(--sb-border)" }}>
          <div className="text-sm font-medium">
            Warnings {latestDate ? <span className="text-zinc-500">({latestDate})</span> : null}
          </div>
          <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
            <Link className="underline" href="/playlists">
              View playlists
            </Link>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs" style={{ color: "var(--sb-muted)" }}>
              <tr className="border-b" style={{ borderColor: "var(--sb-border)" }}>
                <th className="px-5 py-3 font-medium">Severity</th>
                <th className="px-5 py-3 font-medium">Code</th>
                <th className="px-5 py-3 font-medium">Playlist</th>
                <th className="px-5 py-3 font-medium">Message</th>
              </tr>
            </thead>
            <tbody>
              {(warnings ?? []).map((w, i) => (
                <tr
                  key={`${w.code}-${w.playlist_key ?? "global"}-${i}`}
                  className="border-b last:border-0"
                  style={{ borderColor: "var(--sb-border)" }}
                >
                  <td className="px-5 py-3 font-mono text-xs">{w.severity}</td>
                  <td className="px-5 py-3 font-mono text-xs">{w.code}</td>
                  <td className="px-5 py-3 font-mono text-xs">
                    {w.playlist_key ?? "—"}
                  </td>
                  <td className="px-5 py-3">{w.message}</td>
                </tr>
              ))}
              {!warnings?.length && (
                <tr>
                  <td className="px-5 py-8 text-sm" style={{ color: "var(--sb-muted)" }} colSpan={4}>
                    No warnings for the latest run.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

