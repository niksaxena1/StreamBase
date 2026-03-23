import { Suspense } from "react";
import { redirect } from "next/navigation";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { NetworkGraphClient } from "./NetworkGraphClient";
import { parseNetworkScope } from "./networkScope";

export const dynamic = "force-dynamic";

export type GraphNode = {
  id: string;
  name: string;
  track_count: number;
  image_url: string | null;
  /** Distinct other credited artists on the same scoped ISRC as this artist (any credit row). */
  co_artists_any_track?: number;
  /** Distinct other credited artists on ISRCs where this artist is primary (first credit). */
  co_artists_primary_tracks?: number;
};

export type SharedTrack = {
  isrc: string;
  name: string | null;
};

export type GraphEdge = {
  source: string;
  target: string;
  weight: number;
  shared_tracks: SharedTrack[];
};

export type CollaborationGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type NetworkPlaylistOption = {
  playlist_key: string;
  display_name: string;
  spotify_playlist_image_url: string | null;
};

function parseHideNonPrimary(v: string | string[] | undefined): boolean {
  if (v === undefined) return false;
  const s = Array.isArray(v) ? v[0] : v;
  if (typeof s !== "string") return false;
  const t = s.trim().toLowerCase();
  return t === "1" || t === "true" || t === "yes";
}

export default async function NetworkPage({
  searchParams,
}: {
  searchParams?: Promise<{
    playlist?: string;
    hide_non_primary?: string | string[];
    net_scope?: string;
    net_pl?: string;
    net_pl_m?: string;
  }>;
}) {
  const sb = await supabaseServer();
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session) redirect("/login");

  const { data: isAdmin } = await sb.rpc("is_admin");
  if (!isAdmin) redirect("/");

  const sp = (await searchParams) ?? {};

  const svc = supabaseService();

  const { data: playlistRows, error: plErr } = await svc
    .from("playlists")
    .select("playlist_key,display_name,spotify_playlist_image_url")
    .order("display_order", { ascending: true, nullsFirst: false })
    .order("display_name", { ascending: true });

  if (plErr) {
    console.error("network page playlists load failed:", plErr);
  }

  const playlists: NetworkPlaylistOption[] = (playlistRows ?? []).map((p) => ({
    playlist_key: String(p.playlist_key ?? ""),
    display_name: String(p.display_name ?? p.playlist_key ?? "").trim(),
    spotify_playlist_image_url: (p.spotify_playlist_image_url ?? null) as string | null,
  }));

  const validKeys = new Set(playlists.map((p) => p.playlist_key));
  const networkScope = parseNetworkScope(sp, validKeys);

  const hideNonPrimary = parseHideNonPrimary(sp.hide_non_primary);

  const { data, error } = await svc.rpc("artist_collaboration_graph", {
    p_playlist_key: networkScope.mode === "playlist" ? networkScope.playlistKey : null,
    p_hide_non_primary: hideNonPrimary,
    p_scope_playlists:
      networkScope.mode === "custom" && networkScope.customPlaylistKeys.length > 0
        ? networkScope.customPlaylistKeys
        : null,
    p_scope_playlist_mode:
      networkScope.mode === "custom" ? networkScope.customPlaylistMode : "any",
  });

  if (error) {
    console.error("artist_collaboration_graph RPC failed:", error);
    return (
      <div className="p-8 text-center" style={{ color: "var(--sb-muted)" }}>
        Failed to load collaboration graph. Apply the latest{" "}
        <code className="font-mono text-xs">artist_collaboration_graph_*.sql</code> migrations (including{" "}
        <code className="font-mono text-xs">artist_collaboration_graph_track_coartist_counts.sql</code>
        ) if you see a function or column error.
      </div>
    );
  }

  const graph: CollaborationGraph = (data as CollaborationGraph) ?? {
    nodes: [],
    edges: [],
  };

  return (
    <Suspense
      fallback={
        <div className="flex h-[calc(100vh-64px)] items-center justify-center text-sm" style={{ color: "var(--sb-muted)" }}>
          Loading network…
        </div>
      }
    >
      <NetworkGraphClient nodes={graph.nodes} edges={graph.edges} playlists={playlists} hideNonPrimary={hideNonPrimary} />
    </Suspense>
  );
}
