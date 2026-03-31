import { findTrackByIsrc } from "@/lib/spotify";
import { apiJsonErr, apiJsonOk, readJsonBody, requireSessionUser } from "@/lib/api/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Body = { isrcs?: unknown };

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const my = idx++;
      results[my] = await fn(items[my]);
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  await Promise.allSettled(workers);
  return results;
}

export async function POST(req: Request) {
  const sb = await supabaseServer();
  const auth = await requireSessionUser(sb);
  if (!auth.ok) return auth.response;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const json = parsed.body as Body;

  const raw = Array.isArray(json.isrcs) ? json.isrcs : [];
  const isrcs = raw.map((v) => String(v ?? "").trim().toUpperCase()).filter(Boolean);

  if (isrcs.length === 0) {
    return apiJsonErr("missing isrcs", 400);
  }

  const unique = Array.from(new Set(isrcs)).slice(0, 50);

  const concurrency = 5;
  const results = await mapWithConcurrency(unique, concurrency, async (isrc) => {
    try {
      const res = await findTrackByIsrc(isrc);
      return { isrc, albumImageUrl: res?.albumImageUrl ?? null };
    } catch (e: unknown) {
      return { isrc, albumImageUrl: null, error: e instanceof Error ? e.message : "spotify lookup failed" };
    }
  });

  const byIsrc: Record<string, string | null> = {};
  for (const r of results) byIsrc[r.isrc] = r.albumImageUrl ?? null;

  return apiJsonOk({ byIsrc });
}
