import { NextResponse } from "next/server";

import { findTrackByIsrc } from "@/lib/spotify";

export const runtime = "nodejs";

type Body = { isrcs?: unknown };

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

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
  let json: Body;
  try {
    json = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const raw = Array.isArray((json as any).isrcs) ? ((json as any).isrcs as unknown[]) : [];
  const isrcs = raw
    .map((v) => String(v ?? "").trim().toUpperCase())
    .filter(Boolean);

  if (isrcs.length === 0) {
    return NextResponse.json({ error: "missing isrcs" }, { status: 400 });
  }

  // Keep request bounded.
  const unique = Array.from(new Set(isrcs)).slice(0, 50);

  // Spotify search is per-ISRC; do modest parallelism.
  const concurrency = 5;
  const results = await mapWithConcurrency(unique, concurrency, async (isrc) => {
    try {
      const res = await findTrackByIsrc(isrc);
      return { isrc, albumImageUrl: res?.albumImageUrl ?? null };
    } catch (e: any) {
      return { isrc, albumImageUrl: null, error: e?.message ?? "spotify lookup failed" };
    }
  });

  // Return as a map for easy client merge.
  const byIsrc: Record<string, string | null> = {};
  for (const r of results) byIsrc[r.isrc] = r.albumImageUrl ?? null;

  return NextResponse.json({ byIsrc }, { status: 200 });
}

