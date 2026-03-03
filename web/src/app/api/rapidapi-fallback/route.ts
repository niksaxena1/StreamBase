import { NextResponse, NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { RAPIDAPI_ENDPOINT, RAPIDAPI_HOST, RAPIDAPI_DELAY_MS } from "@/lib/rapidapi";

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

/** GET: return count and list of tracks that need RapidAPI fallback (missing stream snapshot for latest date but had non-zero prev day). */
export async function GET() {
  const user = await requireAdmin();
  if (!user) {
    return NextResponse.json({ error: "not authenticated or not admin" }, { status: 401 });
  }

  const svc = supabaseService();

  // Latest date we have in track_daily_streams
  const { data: latestRow, error: latestErr } = await svc
    .from("track_daily_streams")
    .select("date")
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestErr || !latestRow?.date) {
    return NextResponse.json(
      { count: 0, latestDate: null, prevDate: null, candidates: [] },
      { status: 200 },
    );
  }

  const latestDate = String(latestRow.date);
  const prevDate = new Date(latestDate);
  prevDate.setUTCDate(prevDate.getUTCDate() - 1);
  const prevDateStr = prevDate.toISOString().slice(0, 10);

  // Catalog = releases ∪ ext, active on latestDate
  const { data: membershipRows, error: memErr } = await svc
    .from("playlist_memberships")
    .select("isrc")
    .in("playlist_key", ["releases", "ext"])
    .lte("valid_from", latestDate)
    .or(`valid_to.is.null,valid_to.gte.${latestDate}`);

  if (memErr) {
    return NextResponse.json({ error: memErr.message }, { status: 500 });
  }

  const catalogIsrcs = new Set<string>();
  for (const r of membershipRows ?? []) {
    const isrc = String((r as any).isrc ?? "").trim().toUpperCase();
    if (isrc) catalogIsrcs.add(isrc);
  }

  // Prev day: isrc -> streams_cumulative (only > 0)
  const { data: prevRows, error: prevErr } = await svc
    .from("track_daily_streams")
    .select("isrc,streams_cumulative")
    .eq("date", prevDateStr);

  if (prevErr) {
    return NextResponse.json({ error: prevErr.message }, { status: 500 });
  }

  const prevMap = new Map<string, number>();
  for (const r of prevRows ?? []) {
    const isrc = String((r as any).isrc ?? "").trim().toUpperCase();
    const s = Number((r as any).streams_cumulative ?? 0);
    if (isrc && Number.isFinite(s) && s > 0) prevMap.set(isrc, s);
  }

  // Latest day: isrc -> streams_cumulative (so we can treat 0 as "needs fallback" too)
  const { data: latestRows, error: latestRowsErr } = await svc
    .from("track_daily_streams")
    .select("isrc,streams_cumulative")
    .eq("date", latestDate);

  if (latestRowsErr) {
    return NextResponse.json({ error: latestRowsErr.message }, { status: 500 });
  }

  const latestStreams = new Map<string, number>();
  for (const r of latestRows ?? []) {
    const isrc = String((r as any).isrc ?? "").trim().toUpperCase();
    const s = Number((r as any).streams_cumulative ?? 0);
    if (isrc && Number.isFinite(s)) latestStreams.set(isrc, s);
  }

  // Require fallback = catalog track with prev > 0 and (no row today OR row today has 0 streams)
  const candidates: Array<{ isrc: string; prev_streams_cumulative: number }> = [];
  for (const isrc of catalogIsrcs) {
    const prev = prevMap.get(isrc);
    if (prev == null) continue;
    const todayVal = latestStreams.get(isrc);
    if (todayVal !== undefined && todayVal > 0) continue; // already has non-zero today
    candidates.push({ isrc, prev_streams_cumulative: prev });
  }
  candidates.sort((a, b) => b.prev_streams_cumulative - a.prev_streams_cumulative);

  return NextResponse.json({
    count: candidates.length,
    latestDate,
    prevDate: prevDateStr,
    candidates,
  });
}

/** POST: run RapidAPI fallback for up to numTracks (body: { numTracks: number }). */
export async function POST(request: NextRequest) {
  const user = await requireAdmin();
  if (!user) {
    return NextResponse.json({ error: "not authenticated or not admin" }, { status: 401 });
  }

  const apiKey = process.env.RAPIDAPI_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "RAPIDAPI_KEY is not configured on the server" },
      { status: 503 },
    );
  }

  let numTracks: number;
  try {
    const body = await request.json().catch(() => ({}));
    const n = Number((body as any)?.numTracks ?? 0);
    if (!Number.isInteger(n) || n < 1) throw new Error("numTracks must be a positive integer");
    numTracks = Math.min(n, 50); // cap at 50 per request
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Invalid numTracks" },
      { status: 400 },
    );
  }

  // Re-use GET logic to get candidates
  const getRes = await GET();
  if (getRes.status !== 200) return getRes;
  const data = await getRes.json() as {
    count: number;
    latestDate: string | null;
    candidates: Array<{ isrc: string; prev_streams_cumulative: number }>;
  };
  if (!data.latestDate || data.candidates.length === 0) {
    return NextResponse.json({
      repaired: 0,
      attempted: 0,
      message: "No tracks currently need fallback",
    });
  }

  const toProcess = data.candidates.slice(0, numTracks);
  const svc = supabaseService();
  const repairedTracks: Array<{
    isrc: string;
    prev_streams_cumulative: number;
    new_streams_cumulative: number;
  }> = [];
  const delayMs = RAPIDAPI_DELAY_MS; // free tier 1 req/sec

  for (let i = 0; i < toProcess.length; i++) {
    const { isrc, prev_streams_cumulative: prevVal } = toProcess[i];
    try {
      const url = new URL(RAPIDAPI_ENDPOINT);
      url.searchParams.set("isrc", isrc);
      const res = await fetch(url.toString(), {
        headers: {
          "x-rapidapi-host": RAPIDAPI_HOST,
          "x-rapidapi-key": apiKey,
        },
        signal: AbortSignal.timeout(30000),
      });
      const payload = await res.json().catch(() => ({})) as { result?: string; streams?: number };
      if (!res.ok || payload.result !== "success" || payload.streams == null) {
        continue;
      }
      const apiVal = Number(payload.streams);
      if (!Number.isFinite(apiVal) || apiVal < prevVal) continue;

      const { error: upsertErr } = await svc.from("track_daily_streams").upsert(
        [
          {
            date: data.latestDate,
            isrc,
            streams_cumulative: apiVal,
            source_run_id: null,
          },
        ],
        { onConflict: "date,isrc" },
      );
      if (!upsertErr) {
        repairedTracks.push({
          isrc,
          prev_streams_cumulative: prevVal,
          new_streams_cumulative: apiVal,
        });
      }

      if (i < toProcess.length - 1) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    } catch {
      // skip failed request
    }
  }

  if (repairedTracks.length > 0) {
    await svc.rpc("spotibase_recompute_playlist_daily_stats", {
      p_date: data.latestDate,
    });
  }

  return NextResponse.json({
    repaired: repairedTracks.length,
    attempted: toProcess.length,
    latestDate: data.latestDate,
    repairedTracks,
  });
}
