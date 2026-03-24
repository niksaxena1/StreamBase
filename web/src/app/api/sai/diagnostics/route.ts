import { NextRequest } from "next/server";

import { supabaseService } from "@/lib/supabase/service";
import { embedTexts, embeddingsEnabled, embeddingDims, embeddingModel } from "@/lib/sai/embeddings";
import { apiJsonErr, apiJsonOk } from "@/lib/api/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireToken(req: NextRequest): string | null {
  const token = process.env.SAI_ADMIN_TOKEN ?? "";
  if (!token) return "SAI_ADMIN_TOKEN not configured";
  const got = req.nextUrl.searchParams.get("token") ?? "";
  if (got !== token) return "invalid token";
  return null;
}

export async function GET(req: NextRequest) {
  const tokErr = requireToken(req);
  if (tokErr) return apiJsonErr(tokErr, 401);

  const svc = supabaseService();
  const out: Record<string, unknown> = {
    ok: true,
    time: new Date().toISOString(),
    env: {
      embeddingsEnabled: embeddingsEnabled(),
      embeddingModel: embeddingsEnabled() ? embeddingModel() : null,
      embeddingDims: embeddingDims(),
    },
    checks: {} as Record<string, unknown>,
  };

  const checks = out.checks as Record<string, unknown>;

  {
    const { count, error } = await svc
      .from("sai_conversations")
      .select("id", { count: "exact", head: true })
      .limit(1);
    checks.sai_conversations = { ok: !error, count: count ?? null, error: error?.message ?? null };
    if (error) out.ok = false;
  }

  {
    const { count, error } = await svc
      .from("sai_doc_chunks")
      .select("id", { count: "exact", head: true })
      .eq("doc_path", "web/src/app/(main-flat)/docs/docs.md");
    checks.sai_doc_chunks = { ok: !error, count: count ?? null, error: error?.message ?? null };
    if (error) out.ok = false;
  }

  {
    const res = await svc.rpc("spotibase_system_stats");
    checks.spotibase_system_stats = { ok: !res.error, error: res.error?.message ?? null };
    if (res.error) out.ok = false;
  }

  let latestRunDate: string | null = null;
  {
    const { data: latest, error } = await svc
      .from("playlist_daily_stats")
      .select("date")
      .eq("playlist_key", "all_catalog")
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();
    latestRunDate = (latest as { date?: string } | null)?.date ?? null;
    checks.latest_run_date = { ok: !error && !!latestRunDate, latestRunDate, error: error?.message ?? null };
    if (error) out.ok = false;
  }

  let sampleIsrc: string | null = null;
  if (latestRunDate) {
    const { data: row, error } = await svc
      .from("track_daily_streams_effective_public")
      .select("isrc")
      .eq("date", latestRunDate)
      .limit(1)
      .maybeSingle();
    sampleIsrc = (row as { isrc?: string } | null)?.isrc ?? null;
    checks.sample_isrc = { ok: !error && !!sampleIsrc, sampleIsrc, error: error?.message ?? null };
    if (error) out.ok = false;
  }

  if (latestRunDate) {
    const playlist_key = "all_catalog";

    {
      const res = await svc.rpc("playlist_series", { playlist_key, start_date: latestRunDate, end_date: latestRunDate });
      checks.playlist_series = {
        ok: !res.error,
        rows: Array.isArray(res.data) ? res.data.length : null,
        error: res.error?.message ?? null,
      };
      if (res.error) out.ok = false;
    }

    {
      const res = await svc.rpc("playlist_top_tracks_total", { playlist_key, run_date: latestRunDate, limit_rows: 5 });
      checks.playlist_top_tracks_total = {
        ok: !res.error,
        rows: Array.isArray(res.data) ? res.data.length : null,
        error: res.error?.message ?? null,
      };
      if (res.error) out.ok = false;
    }

    if (sampleIsrc) {
      {
        const res = await svc.rpc("track_total_streams_for_date", { isrc: sampleIsrc, run_date: latestRunDate });
        checks.track_total_streams_for_date = {
          ok: !res.error,
          streams: res.data ?? null,
          error: res.error?.message ?? null,
        };
        if (res.error) out.ok = false;
      }

      {
        const res = await svc.rpc("track_series", { isrc: sampleIsrc, start_date: latestRunDate, end_date: latestRunDate });
        checks.track_series = {
          ok: !res.error,
          rows: Array.isArray(res.data) ? res.data.length : null,
          error: res.error?.message ?? null,
        };
        if (res.error) out.ok = false;
      }
    }
  }

  if (embeddingsEnabled()) {
    try {
      const { vectors } = await embedTexts(["diagnostics ping"]);
      const v = vectors[0] ?? [];
      checks.openai_embed = { ok: Array.isArray(v) && v.length > 0, dims: Array.isArray(v) ? v.length : null };
      if (!Array.isArray(v) || v.length === 0) out.ok = false;

      if (Array.isArray(v) && v.length > 0) {
        const res = await svc.rpc("sai_docs_search", { query_embedding: v, match_count: 3 });
        checks.sai_docs_search = {
          ok: !res.error,
          rows: Array.isArray(res.data) ? res.data.length : null,
          topScore: Array.isArray(res.data) && res.data[0] ? (res.data[0] as { score?: unknown }).score ?? null : null,
          error: res.error?.message ?? null,
        };
        if (res.error) out.ok = false;
      }
    } catch (e: unknown) {
      checks.openai_embed = { ok: false, error: e instanceof Error ? e.message : "embed error" };
      out.ok = false;
    }
  } else {
    checks.openai_embed = { ok: false, skipped: true, reason: "OPENAI_API_KEY not configured" };
    checks.sai_docs_search = { ok: false, skipped: true, reason: "OPENAI_API_KEY not configured" };
  }

  const ok = Boolean(out.ok);
  return apiJsonOk(out, { status: ok ? 200 : 500, headers: { "Cache-Control": "no-store" } });
}
