import Link from "next/link";
import { User } from "lucide-react";

import { supabaseServer } from "@/lib/supabase/server";
import { GlassTable, TableRow, TableCell } from "@/components/ui/GlassTable";

export const dynamic = "force-dynamic";

type TrackRow = {
  isrc: string;
  name: string | null;
  spotify_artist_ids: string[] | null;
  spotify_artist_names: string[] | null;
};

function deriveArtists(rows: TrackRow[]) {
  const byId = new Map<string, string>();
  for (const t of rows) {
    const ids = t.spotify_artist_ids ?? [];
    const names = t.spotify_artist_names ?? [];
    for (let i = 0; i < Math.min(ids.length, names.length); i++) {
      const id = ids[i];
      const name = names[i];
      if (!id || !name) continue;
      if (!byId.has(id)) byId.set(id, name);
    }
  }
  return Array.from(byId.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function fetchAllTracksMeta(
  sb: Awaited<ReturnType<typeof supabaseServer>>,
  maxRows = 5000,
): Promise<TrackRow[]> {
  const pageSize = 1000;
  const out: TrackRow[] = [];
  let from = 0;

  while (from < maxRows) {
    const to = from + pageSize - 1;
    const { data, error } = await sb
      .from("tracks")
      .select("isrc,name,spotify_artist_ids,spotify_artist_names")
      .not("spotify_artist_ids", "is", null)
      .order("last_seen", { ascending: false })
      .range(from, to);

    if (error) {
      console.error("Error fetching tracks:", error);
      break;
    }

    const rows = (data ?? []) as TrackRow[];
    if (!rows.length) break;
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return out;
}

export default async function ArtistsConfigPage() {
  const sb = await supabaseServer();

  const trackMetaRows = await fetchAllTracksMeta(sb, 5000);
  const artists = deriveArtists(trackMetaRows);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
            Artists
          </h1>
          <p className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
            Artists derived from tracked tracks.
          </p>
        </div>
        <div className="rounded-full bg-white/50 p-2 backdrop-blur-md dark:bg-white/5">
          <User className="h-5 w-5 opacity-70" />
        </div>
      </div>

      <GlassTable headers={["Artist", "ID"]}>
        {artists.map((artist) => (
          <TableRow key={artist.id}>
            <TableCell>
              <Link
                className="transition-colors hover:text-lime-600 dark:hover:text-lime-400 font-medium"
                href={`/artists?artist_id=${encodeURIComponent(artist.id)}`}
              >
                {artist.name}
              </Link>
            </TableCell>
            <TableCell mono className="text-xs">
              {artist.id}
            </TableCell>
          </TableRow>
        ))}
        {!artists.length && (
          <TableRow>
            <TableCell className="py-8 text-center opacity-50" colSpan={2}>
              No artists found.
            </TableCell>
          </TableRow>
        )}
      </GlassTable>
    </div>
  );
}
