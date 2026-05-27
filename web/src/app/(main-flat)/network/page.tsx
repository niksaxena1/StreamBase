import { Suspense } from "react";
import type { Metadata } from "next";

import { ChartSkeleton } from "@/components/ui/Skeleton";
import { loadNetworkPageShell, loadNetworkPlaylists } from "@/lib/network/loadNetworkPage";

import { NetworkGraphSection } from "./NetworkGraphSection";

export type {
  CollaborationGraph,
  GraphEdge,
  GraphNode,
  NetworkPlaylistOption,
  SharedTrack,
} from "./networkTypes";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Network",
};

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
  const sp = (await searchParams) ?? {};
  const shell = await loadNetworkPageShell();
  const playlists = await loadNetworkPlaylists(shell);

  return (
    <Suspense fallback={<ChartSkeleton height={520} />}>
      <NetworkGraphSection searchParams={sp} playlists={playlists} shell={shell} />
    </Suspense>
  );
}
