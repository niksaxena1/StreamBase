export type IsrcDetailPayload = {
  isrc: string;
  name: string | null;
  spotify_album_image_url: string | null;
  spotify_track_id?: string | null;
  release_date: string | null;
  totalStreams: number | null;
  dailyStreams: number | null;
  artistsOnTrack?: string;
  distroPlaylists?: string;
  distroPlaylistDetails?: Array<{ key: string; name: string; imageUrl: string | null }>;
  trackArtists?: Array<{ id: string; name: string; imageUrl: string | null }>;
};
