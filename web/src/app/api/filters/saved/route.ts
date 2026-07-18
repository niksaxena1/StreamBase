import { NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { apiJsonErr, apiJsonOk, readJsonBody, requireUser } from "@/lib/api/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sb = await supabaseServer();
  const auth = await requireUser(sb);
  if (!auth.ok) return auth.response;

  const { data, error } = await sb
    .from("saved_filters")
    .select("id,name,entity_type,config,created_at,updated_at")
    .order("updated_at", { ascending: false });

  if (error) {
    return apiJsonErr(error.message, 500);
  }

  const filters = (data ?? []).map((row: Record<string, unknown>) => {
    const cfg = row.config as { groups?: unknown; groupJoinLogic?: string } | undefined;
    return {
      id: row.id,
      name: row.name,
      entityType: row.entity_type,
      groups: cfg?.groups ?? [],
      groupJoinLogic: cfg?.groupJoinLogic === "OR" ? "OR" : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });

  return apiJsonOk({ filters });
}

function toFilterResponse(row: Record<string, unknown>) {
  const cfg = row.config as { groups?: unknown; groupJoinLogic?: string } | null;
  return {
    id: row.id,
    name: row.name,
    entityType: row.entity_type,
    groups: cfg?.groups ?? [],
    groupJoinLogic: cfg?.groupJoinLogic === "OR" ? "OR" : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function POST(req: NextRequest) {
  const sb = await supabaseServer();
  const auth = await requireUser(sb);
  if (!auth.ok) return auth.response;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  if (!body || typeof body !== "object") {
    return apiJsonErr("invalid body", 400);
  }

  const { id, name, entityType, groups, groupJoinLogic } = body as Record<string, unknown>;
  if (!name || typeof name !== "string" || !entityType || typeof entityType !== "string" || !Array.isArray(groups)) {
    return apiJsonErr("name, entityType, and groups are required", 400);
  }
  const idStr = typeof id === "string" && id ? id : null;

  const join = groupJoinLogic === "OR" ? "OR" : "AND";

  const now = new Date().toISOString();

  if (idStr) {
    const { data: updated, error: updateErr } = await sb
      .from("saved_filters")
      .update({
        name,
        entity_type: entityType,
        config: { groups, groupJoinLogic: join },
        updated_at: now,
      })
      .eq("id", idStr)
      .select("id,name,entity_type,config,created_at,updated_at");

    if (updateErr) {
      return apiJsonErr(updateErr.message, 500);
    }

    if (updated && updated.length > 0) {
      return apiJsonOk({ filter: toFilterResponse(updated[0] as Record<string, unknown>) });
    }
  }

  const { data, error } = await sb
    .from("saved_filters")
    .insert({
      user_id: auth.user.id,
      name,
      entity_type: entityType,
      config: { groups, groupJoinLogic: join },
      created_at: now,
      updated_at: now,
    })
    .select("id,name,entity_type,config,created_at,updated_at")
    .single();

  if (error) {
    return apiJsonErr(error.message, 500);
  }

  return apiJsonOk({ filter: toFilterResponse(data as Record<string, unknown>) });
}

export async function DELETE(req: NextRequest) {
  const sb = await supabaseServer();
  const auth = await requireUser(sb);
  if (!auth.ok) return auth.response;

  const filterId = req.nextUrl.searchParams.get("id");
  if (!filterId) {
    return apiJsonErr("id is required", 400);
  }

  const { error } = await sb.from("saved_filters").delete().eq("id", filterId);

  if (error) {
    return apiJsonErr(error.message, 500);
  }

  return apiJsonOk({ ok: true as const });
}
