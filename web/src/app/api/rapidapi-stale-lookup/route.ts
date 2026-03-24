import { NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { RAPIDAPI_ENDPOINT, RAPIDAPI_HOST, RAPIDAPI_DELAY_MS } from "@/lib/rapidapi";
import { apiJsonErr, apiJsonOk, readJsonBodyOptional, requireAdmin } from "@/lib/api/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type StaleLookupResult = {
  isrc: string;
  streams: number | null;
  status: "ok" | "failed" | "suspicious";
  error?: string;
};

export async function POST(request: NextRequest) {
  const sb = await supabaseServer();
  const auth = await requireAdmin(sb);
  if (!auth.ok) return auth.response;

  const apiKey = process.env.RAPIDAPI_KEY?.trim();
  if (!apiKey) {
    return apiJsonErr("RAPIDAPI_KEY is not configured on the server", 503);
  }

  let isrcs: string[];
  let staleStreams: Record<string, number>;
  try {
    const body = await readJsonBodyOptional(request);
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
      for (const [k, v] of Object.entries(body.staleStreams as Record<string, unknown>)) {
        const n = Number(v);
        if (Number.isFinite(n)) staleStreams[k.trim().toUpperCase()] = n;
      }
    }
  } catch (e) {
    return apiJsonErr(e instanceof Error ? e.message : "Invalid request body", 400);
  }

  const results: StaleLookupResult[] = [];
  const delayMs = RAPIDAPI_DELAY_MS;

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
          const suspicious = stale != null && apiVal < stale;
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

  return apiJsonOk({ results });
}
