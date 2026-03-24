import { randomBytes } from "crypto";

import { parseConcentrationShareSnapshotV1 } from "@/lib/share/concentrationSnapshot";
import { computeConcentrationShareExpiresAtIso } from "@/lib/share/concentrationShareTtl";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { apiJsonErr, apiJsonOk, readJsonBody, requireAdmin } from "@/lib/api/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function publicShareUrl(req: Request, token: string): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const proto = (req.headers.get("x-forwarded-proto") ?? "https").split(",")[0]!.trim();
  if (!host) return `/share/concentration/${token}`;
  return `${proto}://${host}/share/concentration/${token}`;
}

export async function POST(req: Request) {
  const sb = await supabaseServer();
  const auth = await requireAdmin(sb);
  if (!auth.ok) return auth.response;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  const snapshot = parseConcentrationShareSnapshotV1(body);
  if (!snapshot) {
    return apiJsonErr("invalid_snapshot", 400);
  }

  const token = randomBytes(24).toString("base64url");
  const expiresAt = computeConcentrationShareExpiresAtIso();
  const svc = supabaseService();

  const { error } = await svc.from("concentration_share_snapshots").insert({
    token,
    snapshot,
    created_by: auth.user.id,
    expires_at: expiresAt,
  });

  if (error) {
    return apiJsonErr(error.message, 500);
  }

  await svc.from("concentration_share_snapshots").delete().lt("expires_at", new Date().toISOString());

  return apiJsonOk({ token, url: publicShareUrl(req, token), expires_at: expiresAt }, { status: 201 });
}
