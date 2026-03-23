import { NextResponse } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function getLatestTwoStreamDates(
  svc: ReturnType<typeof supabaseService>,
): Promise<{ latest: string | null; previous: string | null }> {
  const dates: string[] = [];
  const seen = new Set<string>();
  let offset = 0;
  const pageSize = 1000;
  const maxScan = 25000;

  while (dates.length < 2 && offset < maxScan) {
    const { data, error } = await svc
      .from("track_daily_streams_effective_public")
      .select("date")
      .order("date", { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error("isrc-stream-totals: stream dates", error);
      break;
    }
    const rows = data ?? [];
    if (!rows.length) break;

    for (const r of rows) {
      const d = r.date as string;
      if (!seen.has(d)) {
        seen.add(d);
        dates.push(d);
        if (dates.length >= 2) break;
      }
    }
    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  return { latest: dates[0] ?? null, previous: dates[1] ?? null };
}

const MAX_ISRCS = 4000;

export async function POST(req: Request) {
  const sb = await supabaseServer();
  const { data: userData } = await sb.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { data: isAdmin, error: adminErr } = await sb.rpc("is_admin");
  if (adminErr) {
    return NextResponse.json({ error: adminErr.message }, { status: 500 });
  }
  if (!isAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const raw = (body as { isrcs?: unknown })?.isrcs;
  const isrcs = (
    Array.isArray(raw)
      ? raw.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((s) => s.trim())
      : []
  ).slice(0, MAX_ISRCS);

  if (!isrcs.length) {
    return NextResponse.json({
      trackCount: 0,
      totalStreams: null as number | null,
      dailyStreams: null as number | null,
    });
  }

  const svc = supabaseService();
  const { latest, previous } = await getLatestTwoStreamDates(svc);

  const latestMap = new Map<string, number>();
  const previousMap = new Map<string, number>();

  if (latest) {
    const dates = previous ? [latest, previous] : [latest];
    for (const part of chunk(isrcs, 150)) {
      const { data: streamPage, error: streamErr } = await svc
        .from("track_daily_streams_effective_public")
        .select("date,isrc,streams_cumulative")
        .in("isrc", part)
        .in("date", dates);

      if (streamErr) {
        console.error("isrc-stream-totals: streams", streamErr);
        break;
      }
      for (const row of streamPage ?? []) {
        const isrc = row.isrc as string;
        const date = row.date as string;
        const cum = row.streams_cumulative as number | null;
        if (cum === null) continue;
        if (date === latest) latestMap.set(isrc, cum);
        if (previous && date === previous) previousMap.set(isrc, cum);
      }
    }
  }

  let totalSum = 0;
  let dailySum = 0;
  let hasTotal = false;
  let hasDaily = false;
  let counted = 0;

  for (const isrc of isrcs) {
    const t = latestMap.get(isrc);
    if (t !== undefined) {
      totalSum += t;
      hasTotal = true;
      counted += 1;
    }
    const p = previousMap.get(isrc);
    if (t !== undefined && p !== undefined) {
      dailySum += Math.max(0, t - p);
      hasDaily = true;
    }
  }

  return NextResponse.json({
    trackCount: counted,
    totalStreams: hasTotal ? totalSum : null,
    dailyStreams: hasDaily ? dailySum : null,
  });
}
