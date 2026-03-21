import { randomBytes } from "crypto";
import { NextResponse } from "next/server";

import { parseConcentrationShareSnapshotV1 } from "@/lib/share/concentrationSnapshot";
import { computeConcentrationShareExpiresAtIso } from "@/lib/share/concentrationShareTtl";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

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
  const { data: userData } = await sb.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { data: isAdmin, error: adminErr } = await sb.rpc("is_admin");
  if (adminErr) {
    return NextResponse.json({ error: adminErr.message }, { status: 500 });
  }
  if (!isAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const snapshot = parseConcentrationShareSnapshotV1(body);
  if (!snapshot) {
    return NextResponse.json({ error: "invalid_snapshot" }, { status: 400 });
  }

  const token = randomBytes(24).toString("base64url");
  const expiresAt = computeConcentrationShareExpiresAtIso();
  const svc = supabaseService();

  const { error } = await svc.from("concentration_share_snapshots").insert({
    token,
    snapshot,
    created_by: userData.user.id,
    expires_at: expiresAt,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Best-effort: remove expired rows so the table does not grow forever.
  await svc.from("concentration_share_snapshots").delete().lt("expires_at", new Date().toISOString());

  return NextResponse.json(
    { token, url: publicShareUrl(req, token), expires_at: expiresAt },
    { status: 201 },
  );
}
