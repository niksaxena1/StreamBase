import { redirect } from "next/navigation";

import { CACHE_TTL_1H } from "@/lib/constants";
import { normalizeAppAccess, streamBaseAccessRedirectPath, type AppAccess } from "@/lib/appAccess";
import type { CollaborationGraph, NetworkPlaylistOption } from "@/app/(main-flat)/network/networkTypes";
import { parseHideNonPrimary, parseNetworkScope } from "@/app/(main-flat)/network/networkScope";
import { isAllCompetitorsKey } from "@/lib/competitorContext";
import { getCompetitorShellContext } from "@/lib/competitorContext.server";
import type { DatasetMode } from "@/lib/datasetMode";
import { cachedQuery } from "@/lib/supabase/cache";
import { getArtistsCached } from "@/lib/spotify";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export type NetworkGraphMode = "artists" | "cross-label";

export type NetworkPageShell = {
  datasetMode: DatasetMode;
  graphMode: NetworkGraphMode;
  competitorLabelKey: string | null;
  appAccess: AppAccess;
};

function scopeCacheKey(scope: ReturnType<typeof parseNetworkScope>, hideNonPrimary: boolean): string {
  if (scope.mode === "playlist") return `playlist-${scope.playlistKey}-${hideNonPrimary}`;
  if (scope.mode === "custom") {
    return `custom-${scope.customPlaylistMode}-${scope.customPlaylistKeys.join(",")}-${hideNonPrimary}`;
  }
  return `all-${hideNonPrimary}`;
}

async function hydrateMissingArtistImages(
  svc: ReturnType<typeof supabaseService>,
  graph: CollaborationGraph,
): Promise<CollaborationGraph> {
  const missingArtistIds = graph.nodes
    .filter((node) => !node.image_url && typeof node.id === "string" && node.id.trim())
    .map((node) => node.id.trim());

  if (!missingArtistIds.length) return graph;

  try {
    const artistImages = await getArtistsCached(svc, missingArtistIds, { maxAgeDays: 31 });
    if (artistImages.size === 0) return graph;

    return {
      ...graph,
      nodes: graph.nodes.map((node) => {
        if (node.image_url) return node;
        const hydrated = artistImages.get(node.id);
        return hydrated?.imageUrl ? { ...node, image_url: hydrated.imageUrl } : node;
      }),
    };
  } catch (error) {
    console.error("network graph artist image hydration failed:", error);
    return graph;
  }
}

export async function loadNetworkPageShell(): Promise<NetworkPageShell> {
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const svc = supabaseService();
  const { data: isAdmin } = await sb.rpc("is_admin");
  const { data: accessRow } = await svc
    .from("app_user_access")
    .select("own_catalog,competitor,playlist_watch,playlist_watch_admin")
    .eq("user_id", user.id)
    .maybeSingle();
  const appAccess = normalizeAppAccess(accessRow, Boolean(isAdmin));
  const streamBaseRedirect = streamBaseAccessRedirectPath(appAccess);
  if (streamBaseRedirect) redirect(streamBaseRedirect);

  const shell = await getCompetitorShellContext();
  const graphMode: NetworkGraphMode =
    shell.datasetMode === "competitor" && isAllCompetitorsKey(shell.competitorLabelKey)
      ? "cross-label"
      : "artists";

  if (shell.datasetMode === "competitor" && !appAccess.competitor) {
    redirect(appAccess.ownCatalog ? "/" : "/login");
  }

  return {
    datasetMode: shell.datasetMode,
    graphMode,
    competitorLabelKey: shell.competitorLabelKey,
    appAccess,
  };
}

export async function loadNetworkPlaylists(shell: NetworkPageShell): Promise<NetworkPlaylistOption[]> {
  if (shell.graphMode === "cross-label") {
    return [];
  }

  const svc = supabaseService();

  if (shell.datasetMode === "competitor") {
    const labelKey = shell.competitorLabelKey;
    if (!labelKey || isAllCompetitorsKey(labelKey)) {
      return [];
    }

    const cacheKey = `network-competitor-playlists-v2-${labelKey}`;
    const cached = await cachedQuery(
      async () => {
        const result = await svc
          .schema("competitor")
          .from("playlists")
          .select("playlist_key,display_name,spotify_playlist_image_url")
          .eq("label_key", labelKey)
          .eq("is_active", true)
          .order("display_order", { ascending: true, nullsFirst: false })
          .order("display_name", { ascending: true });
        return {
          data: (result.data ?? []).map((p) => ({
            playlist_key: String(p.playlist_key ?? ""),
            display_name: String(p.display_name ?? p.playlist_key ?? "").trim(),
            spotify_playlist_image_url: (p.spotify_playlist_image_url ?? null) as string | null,
          })),
          error: result.error,
        };
      },
      cacheKey,
      CACHE_TTL_1H,
    );

    if (cached.error) {
      console.error("network competitor playlists load failed:", cached.error);
    }
    return (cached.data ?? []) as NetworkPlaylistOption[];
  }

  const cached = await cachedQuery(
    async () => {
      const result = await svc
        .from("playlists")
        .select("playlist_key,display_name,spotify_playlist_image_url")
        .order("display_order", { ascending: true, nullsFirst: false })
        .order("display_name", { ascending: true });
      return {
        data: (result.data ?? []).map((p) => ({
          playlist_key: String(p.playlist_key ?? ""),
          display_name: String(p.display_name ?? p.playlist_key ?? "").trim(),
          spotify_playlist_image_url: (p.spotify_playlist_image_url ?? null) as string | null,
        })),
        error: result.error,
      };
    },
    "network-playlists",
    CACHE_TTL_1H,
  );

  if (cached.error) {
    console.error("network playlists load failed:", cached.error);
  }

  return (cached.data ?? []) as NetworkPlaylistOption[];
}

export async function loadNetworkGraph(args: {
  shell: NetworkPageShell;
  searchParams: Record<string, string | string[] | undefined>;
  playlists: NetworkPlaylistOption[];
}): Promise<{ graph: CollaborationGraph; hideNonPrimary: boolean; errorMessage: string | null }> {
  const svc = supabaseService();
  const validKeys = new Set(args.playlists.map((p) => p.playlist_key));
  const networkScope = parseNetworkScope(args.searchParams, validKeys);
  const hideNonPrimary = parseHideNonPrimary(args.searchParams.hide_non_primary);

  if (args.shell.graphMode === "cross-label") {
    const cacheKey = "network-graph-cross-label-v2";
    const cached = await cachedQuery(
      async () => {
        const { data, error } = await svc.schema("competitor").rpc("cross_label_overlap_graph", {
          p_basis: "isrc",
        });
        if (error) return { data: null, error };
        return {
          data: (data as CollaborationGraph) ?? { nodes: [], edges: [] },
          error: null,
        };
      },
      cacheKey,
      CACHE_TTL_1H,
    );

    return {
      graph: cached.data ?? { nodes: [], edges: [] },
      hideNonPrimary: false,
      errorMessage: cached.error?.message ?? null,
    };
  }

  if (args.shell.datasetMode === "competitor") {
    const labelKey = args.shell.competitorLabelKey;
    if (!labelKey || isAllCompetitorsKey(labelKey)) {
      return {
        graph: { nodes: [], edges: [] },
        hideNonPrimary,
        errorMessage: "Select a competitor label to view the artist network.",
      };
    }

    const cacheKey = `network-graph-competitor-v2-${labelKey}-${scopeCacheKey(networkScope, hideNonPrimary)}`;
    const cached = await cachedQuery(
      async () => {
        const { data, error } = await svc.schema("competitor").rpc("artist_collaboration_graph", {
          p_label_key: labelKey,
          p_playlist_key: networkScope.mode === "playlist" ? networkScope.playlistKey : null,
          p_hide_non_primary: hideNonPrimary,
          p_scope_playlists:
            networkScope.mode === "custom" && networkScope.customPlaylistKeys.length > 0
              ? networkScope.customPlaylistKeys
              : null,
          p_scope_playlist_mode: networkScope.mode === "custom" ? networkScope.customPlaylistMode : "any",
        });
        if (error) return { data: null, error };
        return {
          data: (data as CollaborationGraph) ?? { nodes: [], edges: [] },
          error: null,
        };
      },
      cacheKey,
      CACHE_TTL_1H,
    );

    return {
      graph: await hydrateMissingArtistImages(svc, cached.data ?? { nodes: [], edges: [] }),
      hideNonPrimary,
      errorMessage: cached.error?.message ?? null,
    };
  }

  const cacheKey = `network-graph-${scopeCacheKey(networkScope, hideNonPrimary)}`;
  const cached = await cachedQuery(
    async () => {
      const { data, error } = await svc.rpc("artist_collaboration_graph", {
        p_playlist_key: networkScope.mode === "playlist" ? networkScope.playlistKey : null,
        p_hide_non_primary: hideNonPrimary,
        p_scope_playlists:
          networkScope.mode === "custom" && networkScope.customPlaylistKeys.length > 0
            ? networkScope.customPlaylistKeys
            : null,
        p_scope_playlist_mode: networkScope.mode === "custom" ? networkScope.customPlaylistMode : "any",
      });
      if (error) return { data: null, error };
      return {
        data: (data as CollaborationGraph) ?? { nodes: [], edges: [] },
        error: null,
      };
    },
    cacheKey,
    CACHE_TTL_1H,
  );

  return {
    graph: await hydrateMissingArtistImages(svc, cached.data ?? { nodes: [], edges: [] }),
    hideNonPrimary,
    errorMessage: cached.error?.message ?? null,
  };
}
