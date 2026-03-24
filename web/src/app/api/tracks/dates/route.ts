import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { apiJsonErr, apiJsonOk, requireAdmin } from "@/lib/api/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sb = await supabaseServer();
  const auth = await requireAdmin(sb);
  if (!auth.ok) return auth.response;

  const svc = supabaseService();

  const pageSize = 1000;
  const hardCap = 100_000;
  const out: Array<{ isrc: string; first_seen: string | null; last_seen: string | null }> = [];

  for (let offset = 0; offset < hardCap; offset += pageSize) {
    const { data, error } = await svc
      .from("tracks")
      .select("isrc,first_seen,last_seen")
      .range(offset, offset + pageSize - 1);

    if (error) return apiJsonErr(error.message, 500);
    const rows = (data ?? []) as Array<{ isrc?: unknown; first_seen?: unknown; last_seen?: unknown }>;
    if (!rows.length) break;

    for (const r of rows) {
      out.push({
        isrc: String(r.isrc ?? ""),
        first_seen: (r.first_seen ?? null) as string | null,
        last_seen: (r.last_seen ?? null) as string | null,
      });
    }

    if (rows.length < pageSize) break;
  }

  return apiJsonOk(
    { rows: out },
    { headers: { "Cache-Control": "max-age=3600, stale-while-revalidate=86400" } },
  );
}
