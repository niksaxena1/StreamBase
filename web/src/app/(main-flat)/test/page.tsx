import { redirect } from "next/navigation";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { ArtistChainsClient } from "./ArtistChainsClient";

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

export default async function TestPage() {
  const sb = await supabaseServer();
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session) redirect("/login");

  const { data: isAdmin } = await sb.rpc("is_admin");
  if (!isAdmin) redirect("/");

  const svc = supabaseService();

  const { data, error } = await svc.rpc("artist_collaboration_graph");

  if (error) {
    console.error("artist_collaboration_graph RPC failed:", error);
    return (
      <div className="p-8 text-center" style={{ color: "var(--sb-muted)" }}>
        Failed to load collaboration graph. Make sure the{" "}
        <code className="font-mono text-xs">artist_collaboration_graph</code>{" "}
        RPC function has been deployed.
      </div>
    );
  }

  const graph: CollaborationGraph = (data as CollaborationGraph) ?? {
    nodes: [],
    edges: [],
  };

  return <ArtistChainsClient nodes={graph.nodes} edges={graph.edges} />;
}
