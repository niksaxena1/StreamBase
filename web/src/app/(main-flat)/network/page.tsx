import { redirect } from "next/navigation";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { NetworkGraphClient } from "./NetworkGraphClient";

export const dynamic = "force-dynamic";

export type GraphNode = {
  id: string;
  name: string;
  track_count: number;
  image_url: string | null;
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
  searchParams?: Promise<{ playlist?: string; hide_non_primary?: string | string[] }>;
}) {
  const sb = await supabaseServer();
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session) redirect("/login");

  const { data: isAdmin } = await sb.rpc("is_admin");
  if (!isAdmin) redirect("/");

  const sp = (await searchParams) ?? {};
  const rawPlaylist = typeof sp.playlist === "string" ? sp.playlist.trim() : "";

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
  const playlistKey =
    rawPlaylist && validKeys.has(rawPlaylist) ? rawPlaylist : null;

  const hideNonPrimary = parseHideNonPrimary(sp.hide_non_primary);

  const { data, error } = await svc.rpc("artist_collaboration_graph", {
    p_playlist_key: playlistKey,
    p_hide_non_primary: hideNonPrimary,
  });

  if (error) {
    console.error("artist_collaboration_graph RPC failed:", error);
    return (
      <div className="p-8 text-center" style={{ color: "var(--sb-muted)" }}>
        Failed to load collaboration graph. Deploy migration{" "}
        <code className="font-mono text-xs">artist_collaboration_graph_hide_non_primary.sql</code>{" "}
        if you see a function signature error.
      </div>
    );
  }

  const graph: CollaborationGraph = (data as CollaborationGraph) ?? {
    nodes: [],
    edges: [],
  };

  return (
    <NetworkGraphClient
      nodes={graph.nodes}
      edges={graph.edges}
      playlists={playlists}
      playlistKey={playlistKey}
      hideNonPrimary={hideNonPrimary}
    />
  );
}
