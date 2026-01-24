import Link from "next/link";
import { ListMusic } from "lucide-react";

import { supabaseServer } from "@/lib/supabase/server";
import { GlassTable, TableRow, TableCell } from "@/components/ui/GlassTable";

export const dynamic = "force-dynamic";

export default async function PlaylistsPage() {
  const sb = await supabaseServer();

  const { data, error } = await sb
    .from("playlists")
    .select("playlist_key,display_name,is_catalog")
    .order("is_catalog", { ascending: false })
    .order("display_name", { ascending: true });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Playlists</h1>
          <p className="mt-2 text-sm" style={{ color: "var(--sb-muted)" }}>
            Tracked playlists from configuration.
          </p>
        </div>
        <div className="rounded-full bg-white/50 p-3 backdrop-blur-md dark:bg-white/5">
          <ListMusic className="h-6 w-6 opacity-70" />
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-950 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-200">
          Query error: {error.message}
        </div>
      )}

      <GlassTable headers={["Key", "Name", "Type"]}>
        {(data ?? []).map((p) => (
          <TableRow key={p.playlist_key}>
            <TableCell mono>
              <Link 
                className="transition-colors hover:text-lime-600 dark:hover:text-lime-400 font-medium" 
                href={`/playlists/${p.playlist_key}`}
              >
                {p.playlist_key}
              </Link>
            </TableCell>
            <TableCell>
              <span className="font-medium">{p.display_name}</span>
            </TableCell>
            <TableCell>
              {p.is_catalog ? (
                <span className="inline-flex items-center rounded-full bg-lime-400/20 px-2.5 py-0.5 text-xs font-medium text-lime-800 dark:text-lime-300">
                  Catalog
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-black/5 px-2.5 py-0.5 text-xs font-medium text-black/60 dark:bg-white/10 dark:text-white/60">
                  Standard
                </span>
              )}
            </TableCell>
          </TableRow>
        ))}
        {!data?.length && (
          <TableRow>
            <TableCell className="text-center opacity-50 py-8" colSpan={3}>
              No playlists found.
            </TableCell>
          </TableRow>
        )}
      </GlassTable>
    </div>
  );
}
