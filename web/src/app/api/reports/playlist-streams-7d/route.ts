import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { dataDateFromRunDate } from "@/lib/sotDates";
import { apiJsonErr, requireAdmin } from "@/lib/api/server";
import { reportRunDates } from "@/lib/playlistReportRange";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PLAYLISTS: Array<{ key: string; label: string }> = [
  { key: "releases", label: "Releases" },
  { key: "ext", label: "ext" },
  { key: "gahara_records_releases", label: "Gahara Records Releases" },
  { key: "groove_bassment_releases", label: "Groove Bassment Releases" },
  { key: "p_total", label: "P Total" },
  { key: "tg_total", label: "TG Total" },
];

const COLLECTOR_AGGREGATES: Array<{
  key: string;
  collector: string;
  label: string;
}> = [
  { key: "collector:PL", collector: "PL", label: "P" },
  { key: "collector:TG", collector: "TG", label: "TG" },
];

type PlaylistDailyStatsRow = {
  date: string;
  total_streams_cumulative: number | null;
};

export async function GET(request: Request) {
  const sb = await supabaseServer();
  const auth = await requireAdmin(sb);
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;
  let customDates: string[] | null;
  try {
    customDates = reportRunDates(params.get("start"), params.get("end"));
  } catch (error) {
    return apiJsonErr((error as Error).message, 400);
  }

  const svc = supabaseService();

  const { data: releasesRows, error: releasesErr } = await svc
    .from("playlist_daily_stats")
    .select("date,total_streams_cumulative")
    .eq("playlist_key", "releases")
    .order("date", { ascending: false })
    .limit(7);

  if (releasesErr) {
    return apiJsonErr(releasesErr.message, 500);
  }

  const runDatesDesc = ((releasesRows ?? []) as PlaylistDailyStatsRow[])
    .map((r) => String(r?.date ?? "").trim())
    .filter(Boolean);

  if (runDatesDesc.length === 0) {
    return apiJsonErr("No Releases rows found", 404);
  }

  if (customDates && customDates[customDates.length - 1] > runDatesDesc[0]) {
    return apiJsonErr("End date exceeds the latest available data", 400);
  }

  const runDatesAsc = customDates ?? Array.from(new Set(runDatesDesc)).sort();

  const [playlistResults, collectorResults] = await Promise.all([
    Promise.all(
      PLAYLISTS.map(async (p) => {
        const { data, error } = await svc
          .from("playlist_daily_stats")
          .select("date,total_streams_cumulative")
          .eq("playlist_key", p.key)
          .in("date", runDatesAsc);

        if (error) {
          return {
            key: p.key,
            label: p.label,
            rows: [] as PlaylistDailyStatsRow[],
            error: error.message,
          };
        }

        return {
          key: p.key,
          label: p.label,
          rows: (data ?? []) as PlaylistDailyStatsRow[],
          error: null as string | null,
        };
      }),
    ),
    Promise.all(
      COLLECTOR_AGGREGATES.map(async (aggregate) => {
        const { data, error } = await svc
          .from("collector_daily_agg")
          .select("date,total_streams_cumulative")
          .eq("collector", aggregate.collector)
          .in("date", runDatesAsc);

        if (error) {
          return {
            key: aggregate.key,
            label: aggregate.label,
            rows: [] as PlaylistDailyStatsRow[],
            error: error.message,
          };
        }

        return {
          key: aggregate.key,
          label: aggregate.label,
          rows: (data ?? []) as PlaylistDailyStatsRow[],
          error: null as string | null,
        };
      }),
    ),
  ]);

  const results = [...playlistResults, ...collectorResults];
  const queryError = results.find((result) => result.error)?.error;
  if (queryError) return apiJsonErr(queryError, 500);

  const byPlaylistDate = new Map<string, Map<string, number | null>>();
  for (const p of results) {
    const m = new Map<string, number | null>();
    for (const r of p.rows) {
      const d = String(r?.date ?? "").trim();
      if (!d) continue;
      m.set(d, r.total_streams_cumulative ?? null);
    }
    byPlaylistDate.set(p.key, m);
  }

  const series = [
    ...PLAYLISTS.map((playlist) => ({
      key: playlist.key,
      label: playlist.label,
    })),
    ...COLLECTOR_AGGREGATES.map((aggregate) => ({
      key: aggregate.key,
      label: aggregate.label,
    })),
  ];
  const header = [
    "Date",
    ...series.map((item) => `${item.label} (streams cumulative)`),
  ];

  const aoa: Array<Array<string | number | null>> = [
    header,
    ...runDatesAsc.map((runDate) => {
      const row: Array<string | number | null> = [dataDateFromRunDate(runDate)];
      for (const item of series) {
        row.push(byPlaylistDate.get(item.key)?.get(runDate) ?? null);
      }
      return row;
    }),
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 12 },
    ...series.map((item) => ({ wch: Math.max(22, item.label.length + 23) })),
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, customDates ? "Selected dates" : "Last 7 days");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const body = new Uint8Array(buf);

  const filename = customDates
    ? `playlist_streams_${params.get("start")}_to_${params.get("end")}.xlsx`
    : "playlist_streams_last_7_days.xlsx";
  return new NextResponse(body, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
