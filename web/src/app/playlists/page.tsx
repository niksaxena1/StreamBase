import Link from "next/link";

import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export default async function PlaylistsPage() {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("playlists")
    .select("playlist_key,display_name,is_catalog")
    .order("is_catalog", { ascending: false })
    .order("display_name", { ascending: true });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Playlists</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Tracked playlists from <code className="font-mono">config/playlists.csv</code>
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-950">
          Query error: {error.message}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <table className="min-w-full text-sm">
          <thead className="text-left text-xs text-zinc-500">
            <tr className="border-b border-zinc-200 dark:border-zinc-800">
              <th className="px-4 py-2">Key</th>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Catalog?</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((p) => (
              <tr
                key={p.playlist_key}
                className="border-b border-zinc-100 last:border-0 dark:border-zinc-800"
              >
                <td className="px-4 py-2 font-mono text-xs">
                  <Link className="underline" href={`/playlists/${p.playlist_key}`}>
                    {p.playlist_key}
                  </Link>
                </td>
                <td className="px-4 py-2">{p.display_name}</td>
                <td className="px-4 py-2">{p.is_catalog ? "Yes" : "No"}</td>
              </tr>
            ))}
            {!data?.length && (
              <tr>
                <td className="px-4 py-6 text-sm text-zinc-500" colSpan={3}>
                  No playlists found. Ensure ingestion has run at least once.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

