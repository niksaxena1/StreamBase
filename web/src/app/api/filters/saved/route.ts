import { NextRequest, NextResponse } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/filters/saved — list all saved filters for the current user */
export async function GET() {
  const sb = await supabaseServer();
  const { data: userData } = await sb.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { data, error } = await sb
    .from("saved_filters")
    .select("id,name,entity_type,config,created_at,updated_at")
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const filters = (data ?? []).map((row: any) => ({
    id: row.id,
    name: row.name,
    entityType: row.entity_type,
    groups: row.config?.groups ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  return NextResponse.json({ filters });
}

/** POST /api/filters/saved — create or update a saved filter */
export async function POST(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: userData } = await sb.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const { id, name, entityType, groups } = body as Record<string, any>;
  if (!name || typeof name !== "string" || !entityType || !Array.isArray(groups)) {
    return NextResponse.json({ error: "name, entityType, and groups are required" }, { status: 400 });
  }

  const now = new Date().toISOString();

  function toFilterResponse(row: any) {
    return {
      id: row.id,
      name: row.name,
      entityType: row.entity_type,
      groups: (row.config as any)?.groups ?? [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // Try to update if an id was provided
  if (id) {
    const { data: updated, error: updateErr } = await sb
      .from("saved_filters")
      .update({
        name,
        entity_type: entityType,
        config: { groups },
        updated_at: now,
      })
      .eq("id", id)
      .select("id,name,entity_type,config,created_at,updated_at");

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // If the id matched an existing row, return the updated record
    if (updated && updated.length > 0) {
      return NextResponse.json({ filter: toFilterResponse(updated[0]) });
    }
    // Otherwise the id was client-generated and doesn't exist yet — fall through to insert
  }

  // Create new (server generates the UUID)
  const { data, error } = await sb
    .from("saved_filters")
    .insert({
      user_id: userData.user.id,
      name,
      entity_type: entityType,
      config: { groups },
      created_at: now,
      updated_at: now,
    })
    .select("id,name,entity_type,config,created_at,updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ filter: toFilterResponse(data) });
}

/** DELETE /api/filters/saved?id=<uuid> — delete a saved filter */
export async function DELETE(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: userData } = await sb.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const filterId = req.nextUrl.searchParams.get("id");
  if (!filterId) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const { error } = await sb
    .from("saved_filters")
    .delete()
    .eq("id", filterId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
