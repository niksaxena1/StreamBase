import { NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { apiJsonErr, apiJsonOk, requireUser } from "@/lib/api/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_POINTS = 400;

function normalizeIsrc(raw: string | null): string {
  return String(raw ?? "").trim().toUpperCase();
}

function addDaysIso(dateIso: string, deltaDays: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  const sb = await supabaseServer();
  const auth = await requireUser(sb);
  if (!auth.ok) return auth.response;

  const isrc = normalizeIsrc(request.nextUrl.searchParams.get("isrc"));
  if (!isrc) {
    return apiJsonErr("Missing isrc.", 400);
  }

  const svc = supabaseService();
  const { data, error } = await svc
    .from("track_daily_streams_effective_public")
    .select("date,streams_cumulative")
    .eq("isrc", isrc)
    .order("date", { ascending: true })
    .limit(MAX_POINTS);

  if (error) {
    return apiJsonErr(error.message, 500);
  }

  const rows = (data ?? []) as Array<{ date?: unknown; streams_cumulative?: unknown }>;
  let previousDate: string | null = null;
  let previousTotal: number | null = null;

  const points = rows.map((row) => {
    const date = String(row.date ?? "").slice(0, 10);
    const total =
      row.streams_cumulative != null && Number.isFinite(Number(row.streams_cumulative))
        ? Number(row.streams_cumulative)
        : null;

    let daily: number | null = null;
    if (
      previousDate &&
      total !== null &&
      previousTotal !== null &&
      date === addDaysIso(previousDate, 1)
    ) {
      daily = total - previousTotal;
    }

    previousDate = date || previousDate;
    previousTotal = total ?? previousTotal;

    return {
      date,
      total_streams_cumulative: total,
      daily_streams_delta: daily,
    };
  });

  return apiJsonOk({ points });
}
