import Link from "next/link";

import { supabaseServer } from "@/lib/supabase/server";

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
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Playlists</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--sb-muted)" }}>
          Tracked playlists from <code className="font-mono">config/playlists.csv</code>
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-950">
          Query error: {error.message}
        </div>
      )}

      <div className="sb-card overflow-hidden rounded-[28px]">
        <table className="min-w-full text-sm">
          <thead className="text-left text-xs" style={{ color: "var(--sb-muted)" }}>
            <tr className="border-b" style={{ borderColor: "var(--sb-border)" }}>
              <th className="px-5 py-3 font-medium">Key</th>
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium">Catalog?</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((p) => (
              <tr
                key={p.playlist_key}
                className="border-b last:border-0"
                style={{ borderColor: "var(--sb-border)" }}
              >
                <td className="px-5 py-3 font-mono text-xs">
                  <Link className="underline" href={`/playlists/${p.playlist_key}`}>
                    {p.playlist_key}
                  </Link>
                </td>
                <td className="px-5 py-3">{p.display_name}</td>
                <td className="px-5 py-3">{p.is_catalog ? "Yes" : "No"}</td>
              </tr>
            ))}
            {!data?.length && (
              <tr>
                <td className="px-5 py-8 text-sm" style={{ color: "var(--sb-muted)" }} colSpan={3}>
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

