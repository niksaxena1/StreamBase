import { NextResponse, NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RAPIDAPI_HOST = "spotify-track-streams-playback-count1.p.rapidapi.com";
const RAPIDAPI_ENDPOINT = `https://${RAPIDAPI_HOST}/tracks/spotify_track_streams`;

async function requireAdmin() {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  if (!data.user) return null;
  const { data: isAdmin, error } = await sb.rpc("is_admin");
  if (error || !isAdmin) return null;
  return data.user;
}

export type StaleLookupResult = {
  isrc: string;
  streams: number | null;
  status: "ok" | "failed" | "suspicious";
  error?: string;
};

/**
 * POST /api/rapidapi-stale-lookup
 *
 * Lookup-only: fetches stream counts from RapidAPI for the given ISRCs
 * but does NOT write anything to the database. Returns results for
 * the caller to review before deciding to apply overrides.
 *
 * Body: { isrcs: string[], staleStreams?: Record<string, number> }
 *   - isrcs: array of ISRCs to look up (max 20)
 *   - staleStreams: optional map of isrc -> current stale cumulative count,
 *     used to flag suspicious results (fetched < stale)
 */
export async function POST(request: NextRequest) {
  const user = await requireAdmin();
  if (!user) {
    return NextResponse.json(
      { error: "not authenticated or not admin" },
      { status: 401 },
    );
  }

  const apiKey = process.env.RAPIDAPI_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "RAPIDAPI_KEY is not configured on the server" },
      { status: 503 },
    );
  }

  let isrcs: string[];
  let staleStreams: Record<string, number>;
  try {
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const raw = body.isrcs;
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new Error("isrcs must be a non-empty array");
    }
    isrcs = raw
      .map((v) => String(v ?? "").trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 20);
    if (isrcs.length === 0) throw new Error("No valid ISRCs provided");

    staleStreams = {};
    if (body.staleStreams && typeof body.staleStreams === "object") {
      for (const [k, v] of Object.entries(
        body.staleStreams as Record<string, unknown>,
      )) {
        const n = Number(v);
        if (Number.isFinite(n)) staleStreams[k.trim().toUpperCase()] = n;
      }
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Invalid request body" },
      { status: 400 },
    );
  }

  const results: StaleLookupResult[] = [];
  const delayMs = 1100;

  for (let i = 0; i < isrcs.length; i++) {
    const isrc = isrcs[i];
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
      const payload = (await res.json().catch(() => ({}))) as {
        result?: string;
        streams?: number;
      };

      if (!res.ok || payload.result !== "success" || payload.streams == null) {
        results.push({ isrc, streams: null, status: "failed", error: "No data from API" });
      } else {
        const apiVal = Number(payload.streams);
        if (!Number.isFinite(apiVal)) {
          results.push({ isrc, streams: null, status: "failed", error: "Invalid stream count" });
        } else {
          const stale = staleStreams[isrc];
          const suspicious =
            stale != null && apiVal < stale;
          results.push({
            isrc,
            streams: apiVal,
            status: suspicious ? "suspicious" : "ok",
          });
        }
      }
    } catch {
      results.push({ isrc, streams: null, status: "failed", error: "Request failed" });
    }

    if (i < isrcs.length - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return NextResponse.json({ results });
}
