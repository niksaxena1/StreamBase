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
 * POST /api/health-actions
 *
 * Supports three actions:
 *   { action: "exclude_stale", isrc: string }
 *     → Adds the ISRC to health_warning_exclusions for individual_tracks_stale
 *
 *   { action: "quick_override", isrc: string, date: string, streams_cumulative: number, note: string }
 *     → Inserts a manual override and triggers cascade recompute
 *
 *   { action: "batch_override", date: string, overrides: [{ isrc: string, streams_cumulative: number }] }
 *     → Inserts multiple overrides at once, then triggers a single cascade recompute
 */
export async function POST(request: NextRequest) {
  const user = await requireAdmin();
  if (!user) {
    return NextResponse.json(
      { error: "not authenticated or not admin" },
      { status: 401 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const action = String(body.action ?? "");

  if (action === "exclude_stale") {
    const isrc = String(body.isrc ?? "").trim().toUpperCase();
    if (!isrc || !/^[A-Z]{2}[A-Z0-9]{10}$/.test(isrc)) {
      return NextResponse.json({ error: "Invalid ISRC" }, { status: 400 });
    }

    const svc = supabaseService();
    const { error } = await svc.from("health_warning_exclusions").upsert(
      [
        {
          code: "individual_tracks_stale",
          isrc,
          note: `Excluded from health page (${new Date().toISOString().slice(0, 10)})`,
        },
      ],
      { onConflict: "code,isrc" },
    );

    if (error) {
      // Try plain insert as fallback (upsert conflict key may differ)
      const { error: insertErr } = await svc
        .from("health_warning_exclusions")
        .insert([
          {
            code: "individual_tracks_stale",
            isrc,
            note: `Excluded from health page (${new Date().toISOString().slice(0, 10)})`,
          },
        ]);
      if (insertErr) {
        return NextResponse.json(
          { error: insertErr.message },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({ ok: true, action: "exclude_stale", isrc });
  }

  if (action === "quick_override") {
    const isrc = String(body.isrc ?? "").trim().toUpperCase();
    const date = String(body.date ?? "").trim();
    const streamsCumulative = Number(body.streams_cumulative);
    const note = String(body.note ?? "").trim();

    if (!isrc || !/^[A-Z]{2}[A-Z0-9]{10}$/.test(isrc)) {
      return NextResponse.json({ error: "Invalid ISRC" }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { error: "Invalid date (YYYY-MM-DD)" },
        { status: 400 },
      );
    }
    if (
      !Number.isFinite(streamsCumulative) ||
      !Number.isInteger(streamsCumulative) ||
      streamsCumulative < 0
    ) {
      return NextResponse.json(
        { error: "streams_cumulative must be a non-negative integer" },
        { status: 400 },
      );
    }
    if (!note) {
      return NextResponse.json(
        { error: "Note is required for overrides" },
        { status: 400 },
      );
    }

    const svc = supabaseService();

    // Check ISRC exists
    const { data: track } = await svc
      .from("tracks")
      .select("isrc")
      .eq("isrc", isrc)
      .maybeSingle();
    if (!track) {
      return NextResponse.json(
        { error: `Track ${isrc} not found` },
        { status: 404 },
      );
    }

    // Upsert override
    const { error: upsertErr } = await svc
      .from("track_daily_stream_overrides")
      .upsert(
        [
          {
            date,
            isrc,
            streams_cumulative_override: streamsCumulative,
            note,
            created_by: user.id,
          },
        ],
        { onConflict: "date,isrc" },
      );

    if (upsertErr) {
      return NextResponse.json(
        { error: upsertErr.message },
        { status: 500 },
      );
    }

    // Cascade recompute from the override date
    await svc.rpc("spotibase_recompute_playlist_daily_stats_cascade", {
      p_start_date: date,
    });

    return NextResponse.json({
      ok: true,
      action: "quick_override",
      isrc,
      date,
      streams_cumulative: streamsCumulative,
    });
  }

  if (action === "batch_override") {
    const date = String(body.date ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { error: "Invalid date (YYYY-MM-DD)" },
        { status: 400 },
      );
    }

    const rawOverrides = body.overrides;
    if (!Array.isArray(rawOverrides) || rawOverrides.length === 0) {
      return NextResponse.json(
        { error: "overrides must be a non-empty array" },
        { status: 400 },
      );
    }

    const validated: { isrc: string; streams_cumulative: number }[] = [];
    for (const entry of rawOverrides) {
      const e = entry as Record<string, unknown>;
      const isrc = String(e.isrc ?? "").trim().toUpperCase();
      const sc = Number(e.streams_cumulative);
      if (!isrc || !/^[A-Z]{2}[A-Z0-9]{10}$/.test(isrc)) {
        return NextResponse.json(
          { error: `Invalid ISRC: ${isrc}` },
          { status: 400 },
        );
      }
      if (!Number.isFinite(sc) || !Number.isInteger(sc) || sc < 0) {
        return NextResponse.json(
          { error: `Invalid streams_cumulative for ${isrc}` },
          { status: 400 },
        );
      }
      validated.push({ isrc, streams_cumulative: sc });
    }

    const svc = supabaseService();
    const note = "stale-fix: RapidAPI manual";

    const rows = validated.map((v) => ({
      date,
      isrc: v.isrc,
      streams_cumulative_override: v.streams_cumulative,
      note,
      created_by: user.id,
    }));

    const { error: upsertErr } = await svc
      .from("track_daily_stream_overrides")
      .upsert(rows, { onConflict: "date,isrc" });

    if (upsertErr) {
      return NextResponse.json(
        { error: upsertErr.message },
        { status: 500 },
      );
    }

    await svc.rpc("spotibase_recompute_playlist_daily_stats_cascade", {
      p_start_date: date,
    });

    return NextResponse.json({
      ok: true,
      action: "batch_override",
      date,
      count: validated.length,
      isrcs: validated.map((v) => v.isrc),
    });
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
