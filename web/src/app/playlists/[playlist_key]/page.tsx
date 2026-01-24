import Link from "next/link";

import { formatDateISO, formatInt, formatUsd } from "@/lib/format";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export default async function PlaylistDetailPage({
  params,
}: {
  params: Promise<{ playlist_key: string }>;
}) {
  const { playlist_key } = await params;
  const sb = supabaseAdmin();

  const { data: playlist, error: playlistErr } = await sb
    .from("playlists")
    .select("playlist_key,display_name,is_catalog")
    .eq("playlist_key", playlist_key)
    .maybeSingle();

  const { data: stats, error: statsErr } = await sb
    .from("playlist_daily_stats")
    .select(
      "date,track_count,total_streams_cumulative,daily_streams_net,daily_streams_lfl,est_revenue_total,est_revenue_daily_net,est_revenue_daily_lfl,missing_streams_track_count",
    )
    .eq("playlist_key", playlist_key)
    .order("date", { ascending: false })
    .limit(30);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
            <Link className="underline" href="/playlists">
              Playlists
            </Link>{" "}
            / <span className="font-mono">{playlist_key}</span>
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            {playlist?.display_name ?? playlist_key}
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--sb-muted)" }}>
            Catalog playlist: <b>{playlist?.is_catalog ? "Yes" : "No"}</b>
          </p>
        </div>
      </div>

      {(playlistErr || statsErr) && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-950">
          Query error:{" "}
          {playlistErr?.message ?? statsErr?.message ?? "unknown error"}
        </div>
      )}

      <div className="sb-card overflow-hidden rounded-[28px]">
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: "var(--sb-border)" }}>
          <div className="text-sm font-medium">Last 30 days</div>
          <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
            Missing streams = tracks not present in catalog snapshot today
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
                <th className="px-5 py-3 font-medium">Est. rev (total)</th>
                <th className="px-5 py-3 font-medium">Missing</th>
              </tr>
            </thead>
            <tbody>
              {(stats ?? []).map((r) => (
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
                  <td className="px-5 py-3">{formatUsd(r.est_revenue_total)}</td>
                  <td className="px-5 py-3">
                    {formatInt(r.missing_streams_track_count)}
                  </td>
                </tr>
              ))}
              {!stats?.length && (
                <tr>
                  <td className="px-5 py-8 text-sm" style={{ color: "var(--sb-muted)" }} colSpan={7}>
                    No stats yet for this playlist.
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

