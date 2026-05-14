import { NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { apiJsonErr, apiJsonOk, readJsonBodyOptional, requireAdmin } from "@/lib/api/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const sb = await supabaseServer();
  const auth = await requireAdmin(sb);
  if (!auth.ok) return auth.response;
  const user = auth.user;

  const body = await readJsonBodyOptional(request);
  const action = String(body.action ?? "");

  if (action === "exclude_stale") {
    const isrc = String(body.isrc ?? "").trim().toUpperCase();
    if (!isrc || !/^[A-Z]{2}[A-Z0-9]{10}$/.test(isrc)) {
      return apiJsonErr("Invalid ISRC", 400);
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
      const { error: insertErr } = await svc.from("health_warning_exclusions").insert([
        {
          code: "individual_tracks_stale",
          isrc,
          note: `Excluded from health page (${new Date().toISOString().slice(0, 10)})`,
        },
      ]);
      if (insertErr) {
        return apiJsonErr(insertErr.message, 500);
      }
    }

    return apiJsonOk({ ok: true as const, action: "exclude_stale" as const, isrc });
  }

  if (action === "quick_override") {
    const isrc = String(body.isrc ?? "").trim().toUpperCase();
    const date = String(body.date ?? "").trim();
    const streamsCumulative = Number(body.streams_cumulative);
    const note = String(body.note ?? "").trim();

    if (!isrc || !/^[A-Z]{2}[A-Z0-9]{10}$/.test(isrc)) {
      return apiJsonErr("Invalid ISRC", 400);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return apiJsonErr("Invalid date (YYYY-MM-DD)", 400);
    }
    if (!Number.isFinite(streamsCumulative) || !Number.isInteger(streamsCumulative) || streamsCumulative < 0) {
      return apiJsonErr("streams_cumulative must be a non-negative integer", 400);
    }
    if (!note) {
      return apiJsonErr("Note is required for overrides", 400);
    }

    const svc = supabaseService();

    const { data: track } = await svc.from("tracks").select("isrc").eq("isrc", isrc).maybeSingle();
    if (!track) {
      return apiJsonErr(`Track ${isrc} not found`, 404);
    }

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
      return apiJsonErr(upsertErr.message, 500);
    }

    await svc.rpc("spotibase_recompute_playlist_daily_stats_cascade", {
      p_start_date: date,
    });

    return apiJsonOk({
      ok: true as const,
      action: "quick_override" as const,
      isrc,
      date,
      streams_cumulative: streamsCumulative,
    });
  }

  if (action === "batch_override") {
    const date = String(body.date ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return apiJsonErr("Invalid date (YYYY-MM-DD)", 400);
    }

    const rawOverrides = body.overrides;
    if (!Array.isArray(rawOverrides) || rawOverrides.length === 0) {
      return apiJsonErr("overrides must be a non-empty array", 400);
    }

    const rawNotePrefix = String(body.notePrefix ?? "stale-fix").trim();
    const notePrefix = [
      "stale-fix",
      "missing-snapshot-fix",
      "prev-nonzero-fix",
    ].includes(rawNotePrefix)
      ? rawNotePrefix
      : "stale-fix";

    const validated: {
      isrc: string;
      streams_cumulative: number;
      providerLabel: string | null;
    }[] = [];
    for (const entry of rawOverrides) {
      const e = entry as Record<string, unknown>;
      const isrc = String(e.isrc ?? "").trim().toUpperCase();
      const sc = Number(e.streams_cumulative);
      if (!isrc || !/^[A-Z]{2}[A-Z0-9]{10}$/.test(isrc)) {
        return apiJsonErr(`Invalid ISRC: ${isrc}`, 400);
      }
      if (!Number.isFinite(sc) || !Number.isInteger(sc) || sc < 0) {
        return apiJsonErr(`Invalid streams_cumulative for ${isrc}`, 400);
      }
      const providerLabel = String(e.providerLabel ?? "").trim();
      validated.push({
        isrc,
        streams_cumulative: sc,
        providerLabel: providerLabel || null,
      });
    }

    const svc = supabaseService();

    const rows = validated.map((v) => ({
      date,
      isrc: v.isrc,
      streams_cumulative_override: v.streams_cumulative,
      note: v.providerLabel
        ? `${notePrefix}: ${v.providerLabel} manual`
        : `${notePrefix}: stream lookup manual`,
      created_by: user.id,
    }));

    const { error: upsertErr } = await svc.from("track_daily_stream_overrides").upsert(rows, { onConflict: "date,isrc" });

    if (upsertErr) {
      return apiJsonErr(upsertErr.message, 500);
    }

    await svc.rpc("spotibase_recompute_playlist_daily_stats_cascade", {
      p_start_date: date,
    });

    return apiJsonOk({
      ok: true as const,
      action: "batch_override" as const,
      date,
      count: validated.length,
      isrcs: validated.map((v) => v.isrc),
    });
  }

  return apiJsonErr(`Unknown action: ${action}`, 400);
}
