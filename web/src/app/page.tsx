import Link from "next/link";

import { StatCard } from "@/components/StatCard";
import { formatDateISO, formatInt, formatUsd } from "@/lib/format";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export default async function Home() {
  let sb;
  try {
    sb = supabaseAdmin();
  } catch {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
        <div className="font-semibold">Missing environment variables</div>
        <div className="mt-1">
          Set <code className="font-mono">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code> for the
          Next.js app. See <code className="font-mono">web/env.example</code>.
        </div>
      </div>
    );
  }

  const { data: latest, error: latestErr } = await sb
    .from("playlist_daily_stats")
    .select(
      "date,track_count,total_streams_cumulative,daily_streams_net,daily_streams_lfl,est_revenue_total,est_revenue_daily_net,est_revenue_daily_lfl",
    )
    .eq("playlist_key", "all_catalog")
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: history, error: historyErr } = await sb
    .from("playlist_daily_stats")
    .select(
      "date,track_count,total_streams_cumulative,daily_streams_net,daily_streams_lfl",
    )
    .eq("playlist_key", "all_catalog")
    .order("date", { ascending: false })
    .limit(30);

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">All Catalog</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--sb-muted)" }}>
            Cumulative streams and daily growth derived from Releases + ext.
          </p>
        </div>
        <div className="text-sm">
          <Link className="underline" href="/health">
            View system health
          </Link>
        </div>
      </div>

      {(latestErr || historyErr) && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-950">
          Query error:{" "}
          {latestErr?.message ?? historyErr?.message ?? "unknown error"}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Last run date"
          value={formatDateISO(latest?.date)}
          subtitle="UTC"
        />
        <StatCard title="Tracks" value={formatInt(latest?.track_count)} />
        <StatCard
          title="Total streams"
          value={formatInt(latest?.total_streams_cumulative)}
          accent
        />
        <StatCard
          title="Est. revenue (total)"
          value={formatUsd(latest?.est_revenue_total)}
        />
      </div>

      <div className="sb-card overflow-hidden rounded-[28px]">
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: "var(--sb-border)" }}>
          <div className="text-sm font-medium">Last 30 days</div>
          <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
            Net daily streams depends on membership changes
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs" style={{ color: "var(--sb-muted)" }}>
              <tr className="border-b" style={{ borderColor: "var(--sb-border)" }}>
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Tracks</th>
                <th className="px-5 py-3 font-medium">Total streams</th>
                <th className="px-5 py-3 font-medium">Daily (net)</th>
                <th className="px-5 py-3 font-medium">Daily (LFL)</th>
              </tr>
            </thead>
            <tbody>
              {(history ?? []).map((r) => (
                <tr
                  key={r.date}
                  className="border-b last:border-0"
                  style={{ borderColor: "var(--sb-border)" }}
                >
                  <td className="px-5 py-3 font-mono text-xs">
                    {formatDateISO(r.date)}
                  </td>
                  <td className="px-5 py-3">{formatInt(r.track_count)}</td>
                  <td className="px-5 py-3">
                    {formatInt(r.total_streams_cumulative)}
                  </td>
                  <td className="px-5 py-3">{formatInt(r.daily_streams_net)}</td>
                  <td className="px-5 py-3">{formatInt(r.daily_streams_lfl)}</td>
                </tr>
              ))}
              {!history?.length && (
                <tr>
                  <td className="px-5 py-8 text-sm" style={{ color: "var(--sb-muted)" }} colSpan={5}>
                    No stats yet. Run the GitHub Action to ingest data.
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
