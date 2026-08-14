import { NextRequest } from "next/server";

import { apiJsonErr, apiJsonOk, requireAdmin } from "@/lib/api/server";
import {
  DISTRO_MOVEMENT_WINDOWS,
  latestOwnRunDate,
  loadDistroMovementCached,
  type DistroMovementWindow,
} from "@/lib/collectors/distroMovement";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sb = await supabaseServer();
  const auth = await requireAdmin(sb);
  if (!auth.ok) return auth.response;

  const windowRaw = Number(req.nextUrl.searchParams.get("window") ?? "90");
  const windowDays = (DISTRO_MOVEMENT_WINDOWS as readonly number[]).includes(windowRaw)
    ? (windowRaw as DistroMovementWindow)
    : 90;

  const runDate = await latestOwnRunDate();
  if (!runDate) return apiJsonErr("no ingestion runs yet", 404);

  const result = await loadDistroMovementCached({ runDate, windowDays });
  if (result.error) return apiJsonErr(result.error.message, 500);
  return apiJsonOk(result.data);
}
