import { NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const secret = body?.secret as string | undefined;

  if (!secret || secret !== process.env.REVALIDATE_SECRET) {
    return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
  }

  const paths = (body?.paths as string[] | undefined) ?? [
    "/", // main dashboard
    "/playlists",
    "/artists",
    "/catalog",
    "/tracks",
    "/collectors",
    "/health",
  ];

  // Revalidate all Supabase-backed cached queries.
  // In Next 16, passing only the tag is sufficient.
  revalidateTag("supabase");

  // Optionally revalidate a set of known paths.
  for (const path of paths) {
    try {
      revalidatePath(path);
    } catch {
      // Ignore invalid paths
    }
  }

  return NextResponse.json({ revalidated: true, paths });
}

