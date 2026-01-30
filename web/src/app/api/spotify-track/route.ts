import { NextResponse } from "next/server";

import { findTrackByIsrc } from "@/lib/spotify";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const isrc = (url.searchParams.get("isrc") ?? "").trim().toUpperCase();
  if (!isrc) {
    return NextResponse.json({ error: "missing isrc" }, { status: 400 });
  }

  try {
    const res = await findTrackByIsrc(isrc);
    return NextResponse.json(
      { isrc, albumImageUrl: res?.albumImageUrl ?? null },
      { status: 200 },
    );
  } catch (e: any) {
    return NextResponse.json(
      { isrc, error: e?.message ?? "spotify lookup failed" },
      { status: 500 },
    );
  }
}

