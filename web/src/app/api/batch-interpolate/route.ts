import { NextResponse, NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin() {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  if (!data.user) return null;
  const { data: isAdmin, error } = await sb.rpc("is_admin");
  if (error || !isAdmin) return null;
  return data.user;
}

/**
 * GET /api/batch-interpolate
 *
 * Detects dates in the last 14 days that have significantly fewer tracks
 * than adjacent days (candidates for interpolation).
 */
export async function GET() {
  const user = await requireAdmin();
  if (!user) {
    return NextResponse.json({ error: "not authenticated or not admin" }, { status: 401 });
  }

  const svc = supabaseService();

  // Get track counts per date for the last 14 days
  const { data: dateCounts, error: dcErr } = await svc.rpc("exec_sql" as any, {
    query: `
      SELECT date::text, count(*)::int as track_count
      FROM track_daily_streams
      WHERE date >= current_date - interval '14 days'
      GROUP BY date
      ORDER BY date
    `,
  });

  // Fallback: query directly if RPC not available
  let rows: Array<{ date: string; track_count: number }> = [];
  if (dcErr || !dateCounts) {
    const { data: rawRows, error: rawErr } = await svc
      .from("track_daily_streams")
      .select("date")
      .gte("date", new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10));

    if (rawErr || !rawRows) {
      return NextResponse.json({ error: rawErr?.message ?? "Failed to query" }, { status: 500 });
    }

    // Count per date manually
    const countMap = new Map<string, number>();
    for (const r of rawRows) {
      const d = String((r as any).date);
      countMap.set(d, (countMap.get(d) ?? 0) + 1);
    }
    rows = Array.from(countMap.entries())
      .map(([date, track_count]) => ({ date, track_count }))
      .sort((a, b) => a.date.localeCompare(b.date));
  } else {
    rows = (dateCounts as any[]).map((r: any) => ({
      date: String(r.date),
      track_count: Number(r.track_count),
    }));
  }

  if (rows.length < 3) {
    return NextResponse.json({ candidates: [] });
  }

  // Find dates where track_count is significantly lower than neighbors
  const candidates: Array<{
    date: string;
    track_count: number;
    prev_date: string;
    prev_count: number;
    next_date: string;
    next_count: number;
    missing_estimate: number;
  }> = [];

  for (let i = 1; i < rows.length - 1; i++) {
    const prev = rows[i - 1];
    const curr = rows[i];
    const next = rows[i + 1];
    const neighborAvg = (prev.track_count + next.track_count) / 2;
    const deficit = neighborAvg - curr.track_count;

    // Flag if more than 10 tracks fewer than neighbors, or if count is < 95% of neighbor avg
    if (deficit > 10 || (neighborAvg > 0 && curr.track_count / neighborAvg < 0.95)) {
      candidates.push({
        date: curr.date,
        track_count: curr.track_count,
        prev_date: prev.date,
        prev_count: prev.track_count,
        next_date: next.date,
        next_count: next.track_count,
        missing_estimate: Math.round(deficit),
      });
    }
  }

  // Count stale tracks per candidate date — all queries are independent, run in parallel.
  await Promise.all(
    candidates.map(async (c) => {
      const { data: staleCount } = await svc.rpc("exec_sql" as any, {
        query: `
          SELECT count(*)::int as cnt
          FROM track_daily_streams t1
          JOIN track_daily_streams t0 ON t1.isrc = t0.isrc AND t0.date = '${c.prev_date}'
          WHERE t1.date = '${c.date}'
            AND t1.streams_cumulative = t0.streams_cumulative
            AND t0.streams_cumulative > 0
        `,
      });
      (c as any).stale_count = (staleCount as any)?.[0]?.cnt ?? null;
    }),
  );

  return NextResponse.json({ candidates });
}

/**
 * POST /api/batch-interpolate
 *
 * Executes interpolation for a specific date.
 * Body: { date: string, include_stale: boolean }
 */
export async function POST(request: NextRequest) {
  const user = await requireAdmin();
  if (!user) {
    return NextResponse.json({ error: "not authenticated or not admin" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const date = String(body.date ?? "").trim();
  const includeStale = Boolean(body.include_stale);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Invalid date (YYYY-MM-DD)" }, { status: 400 });
  }

  const svc = supabaseService();

  // Compute prev and next dates
  const dateObj = new Date(date + "T00:00:00Z");
  const prevDate = new Date(dateObj.getTime() - 86400000).toISOString().slice(0, 10);
  const nextDate = new Date(dateObj.getTime() + 86400000).toISOString().slice(0, 10);

  // Fetch prev day data
  const { data: prevRows, error: prevErr } = await svc
    .from("track_daily_streams")
    .select("isrc,streams_cumulative")
    .eq("date", prevDate);
  if (prevErr) {
    return NextResponse.json({ error: prevErr.message }, { status: 500 });
  }

  const prevMap = new Map<string, number>();
  for (const r of (prevRows ?? []) as any[]) {
    const isrc = String(r.isrc ?? "").trim().toUpperCase();
    const s = Number(r.streams_cumulative ?? 0);
    if (isrc && Number.isFinite(s) && s > 0) prevMap.set(isrc, s);
  }

  // Fetch next day data
  const { data: nextRows, error: nextErr } = await svc
    .from("track_daily_streams")
    .select("isrc,streams_cumulative")
    .eq("date", nextDate);
  if (nextErr) {
    return NextResponse.json({ error: nextErr.message }, { status: 500 });
  }

  const nextMap = new Map<string, number>();
  for (const r of (nextRows ?? []) as any[]) {
    const isrc = String(r.isrc ?? "").trim().toUpperCase();
    const s = Number(r.streams_cumulative ?? 0);
    if (isrc && Number.isFinite(s) && s > 0) nextMap.set(isrc, s);
  }

  // Fetch gap day data
  const { data: gapRows, error: gapErr } = await svc
    .from("track_daily_streams")
    .select("isrc,streams_cumulative")
    .eq("date", date);
  if (gapErr) {
    return NextResponse.json({ error: gapErr.message }, { status: 500 });
  }

  const gapMap = new Map<string, number>();
  for (const r of (gapRows ?? []) as any[]) {
    const isrc = String(r.isrc ?? "").trim().toUpperCase();
    const s = Number(r.streams_cumulative ?? 0);
    if (isrc) gapMap.set(isrc, s);
  }

  // Find tracks to interpolate
  const overrides: Array<{ isrc: string; interpolated: number; reason: string }> = [];

  for (const [isrc, prevVal] of prevMap) {
    const nextVal = nextMap.get(isrc);
    if (nextVal == null || nextVal <= 0) continue;

    const gapVal = gapMap.get(isrc);
    const interpolated = Math.floor((prevVal + nextVal) / 2);

    if (gapVal === undefined) {
      // Missing entirely
      overrides.push({ isrc, interpolated, reason: "missing" });
    } else if (includeStale && gapVal === prevVal && nextVal > gapVal) {
      // Stale (same as prev, but next is higher)
      overrides.push({ isrc, interpolated, reason: "stale" });
    }
  }

  if (overrides.length === 0) {
    return NextResponse.json({
      overrides_created: 0,
      missing_count: 0,
      stale_count: 0,
      date,
    });
  }

  // Insert overrides in batches
  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < overrides.length; i += BATCH) {
    const batch = overrides.slice(i, i + BATCH);
    const rows = batch.map((o) => ({
      date,
      isrc: o.isrc,
      streams_cumulative_override: o.interpolated,
      note: `Interpolated from ${prevDate} and ${nextDate} (${o.reason})`,
      created_by: user.id,
    }));

    const { error: insErr } = await svc
      .from("track_daily_stream_overrides")
      .upsert(rows, { onConflict: "date,isrc" });

    if (!insErr) {
      inserted += batch.length;
    }
  }

  // Cascade recompute
  if (inserted > 0) {
    await svc.rpc("spotibase_recompute_playlist_daily_stats_cascade", {
      p_start_date: date,
    });
  }

  const missingCount = overrides.filter((o) => o.reason === "missing").length;
  const staleCount = overrides.filter((o) => o.reason === "stale").length;

  return NextResponse.json({
    overrides_created: inserted,
    missing_count: missingCount,
    stale_count: staleCount,
    date,
  });
}
