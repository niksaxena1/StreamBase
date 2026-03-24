import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { dataDateFromRunDate } from "@/lib/sotDates";
import { apiJsonErr, requireAdmin } from "@/lib/api/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PLAYLISTS: Array<{ key: string; label: string }> = [
  { key: "releases", label: "Releases" },
  { key: "ext", label: "ext" },
  { key: "gahara_records_releases", label: "Gahara Records Releases" },
  { key: "groove_bassment_releases", label: "Groove Bassment Releases" },
];

type PlaylistDailyStatsRow = {
  date: string;
  total_streams_cumulative: number | null;
};

export async function GET() {
  const sb = await supabaseServer();
  const auth = await requireAdmin(sb);
  if (!auth.ok) return auth.response;

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

  const runDatesAsc = Array.from(new Set(runDatesDesc)).sort();

  const results = await Promise.all(
    PLAYLISTS.map(async (p) => {
      const { data, error } = await svc
        .from("playlist_daily_stats")
        .select("date,total_streams_cumulative")
        .eq("playlist_key", p.key)
        .in("date", runDatesAsc);

      if (error) {
        return { key: p.key, label: p.label, rows: [] as PlaylistDailyStatsRow[], error: error.message };
      }

      return { key: p.key, label: p.label, rows: (data ?? []) as PlaylistDailyStatsRow[], error: null as string | null };
    }),
  );

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

  const header = [
    "Date",
    "Releases (streams cumulative)",
    "ext (streams cumulative)",
    "Gahara Records Releases (streams cumulative)",
    "Groove Bassment Releases (streams cumulative)",
  ];

  const keyOrder = ["releases", "ext", "gahara_records_releases", "groove_bassment_releases"];

  const aoa: Array<Array<string | number | null>> = [
    header,
    ...runDatesAsc.map((runDate) => {
      const row: Array<string | number | null> = [dataDateFromRunDate(runDate)];
      for (const k of keyOrder) {
        row.push(byPlaylistDate.get(k)?.get(runDate) ?? null);
      }
      return row;
    }),
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 12 }, { wch: 26 }, { wch: 22 }, { wch: 38 }, { wch: 40 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Last 7 days");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const body = new Uint8Array(buf);

  const filename = "playlist_streams_last_7_days.xlsx";
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
