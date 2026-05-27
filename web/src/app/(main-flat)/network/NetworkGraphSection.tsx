import type { CollaborationGraph, NetworkPlaylistOption } from "./networkTypes";
import { loadNetworkGraph, type NetworkPageShell } from "@/lib/network/loadNetworkPage";
import { NetworkGraphClient } from "./NetworkGraphClient";

export async function NetworkGraphSection(props: {
  searchParams: Record<string, string | string[] | undefined>;
  playlists: NetworkPlaylistOption[];
  shell: NetworkPageShell;
}) {
  const { graph, hideNonPrimary, errorMessage } = await loadNetworkGraph({
    shell: props.shell,
    searchParams: props.searchParams,
    playlists: props.playlists,
  });

  if (errorMessage) {
    const migrationHint =
      props.shell.datasetMode === "competitor"
        ? "competitor_artist_collaboration_graph.sql and competitor_cross_label_overlap_graph.sql"
        : "artist_collaboration_graph_*.sql (including artist_collaboration_graph_track_coartist_counts.sql)";
    return (
      <div className="p-8 text-center" style={{ color: "var(--sb-muted)" }}>
        Failed to load collaboration graph. Apply the latest{" "}
        <code className="font-mono text-xs">{migrationHint}</code> migrations if you see a function or column error.
        <div className="mt-2 text-xs opacity-70">{errorMessage}</div>
      </div>
    );
  }

  return (
    <NetworkGraphClient
      nodes={graph.nodes}
      edges={graph.edges}
      playlists={props.playlists}
      hideNonPrimary={hideNonPrimary}
      mode={props.shell.graphMode}
      datasetMode={props.shell.datasetMode}
    />
  );
}
