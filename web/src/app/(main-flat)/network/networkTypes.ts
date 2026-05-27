export type GraphNode = {
  id: string;
  name: string;
  track_count: number;
  image_url: string | null;
  co_artists_any_track?: number;
  co_artists_primary_tracks?: number;
};

export type SharedTrack = {
  isrc: string;
  name: string | null;
  album_image_url?: string | null;
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
