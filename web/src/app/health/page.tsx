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
        <h1 className="text-2xl font-semibold tracking-tight">System Health</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Recent ingestion runs and anomaly warnings.
        </p>
      </div>

      {(runsErr || warnErr) && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-950">
          Query error: {runsErr?.message ?? warnErr?.message ?? "unknown error"}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-zinc-200 px-4 py-3 text-sm font-medium dark:border-zinc-800">
          Ingestion runs (last 14 days)
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs text-zinc-500">
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className="px-4 py-2">Run date</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Logs</th>
              </tr>
            </thead>
            <tbody>
              {(runs ?? []).map((r) => (
                <tr
                  key={r.run_date}
                  className="border-b border-zinc-100 last:border-0 dark:border-zinc-800"
                >
                  <td className="px-4 py-2 font-mono text-xs">
                    {formatDateISO(r.run_date)}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={
                        r.status === "success"
                          ? "text-emerald-600"
                          : r.status === "failed"
                            ? "text-red-600"
                            : "text-amber-600"
                      }
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {r.logs_url ? (
                      <a className="underline" href={r.logs_url} target="_blank">
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
                  <td className="px-4 py-6 text-sm text-zinc-500" colSpan={3}>
                    No ingestion runs yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="text-sm font-medium">
            Warnings {latestDate ? <span className="text-zinc-500">({latestDate})</span> : null}
          </div>
          <div className="text-xs text-zinc-500">
            <Link className="underline" href="/playlists">
              View playlists
            </Link>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs text-zinc-500">
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className="px-4 py-2">Severity</th>
                <th className="px-4 py-2">Code</th>
                <th className="px-4 py-2">Playlist</th>
                <th className="px-4 py-2">Message</th>
              </tr>
            </thead>
            <tbody>
              {(warnings ?? []).map((w, i) => (
                <tr
                  key={`${w.code}-${w.playlist_key ?? "global"}-${i}`}
                  className="border-b border-zinc-100 last:border-0 dark:border-zinc-800"
                >
                  <td className="px-4 py-2 font-mono text-xs">{w.severity}</td>
                  <td className="px-4 py-2 font-mono text-xs">{w.code}</td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {w.playlist_key ?? "—"}
                  </td>
                  <td className="px-4 py-2">{w.message}</td>
                </tr>
              ))}
              {!warnings?.length && (
                <tr>
                  <td className="px-4 py-6 text-sm text-zinc-500" colSpan={4}>
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

