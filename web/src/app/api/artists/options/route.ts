import { NextResponse } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
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

  const svc = supabaseService();
  const { data, error } = await svc
    .from("spotify_artist_images")
    .select("artist_id,name,image_url")
    .order("name", { ascending: true })
    .limit(5000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const artists = (data ?? [])
    .map((a: any) => ({
      artist_id: String(a?.artist_id ?? ""),
      name: (a?.name ?? null) as string | null,
      image_url: (a?.image_url ?? null) as string | null,
    }))
    .filter((a: any) => a.artist_id);

  return NextResponse.json({ artists }, { status: 200 });
}

