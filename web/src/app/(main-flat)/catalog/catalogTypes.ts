// Shared types for catalog components
export type ChartDataPoint = {
  date: string;
  value: number;
};

export type DailyDataPoint = {
  date: string;
  daily: number | null;
  /** Present when precomputed on the server (7-day window may include days before the visible range). */
  ma7?: number | null;
};

export type ArtistOption = { id: string; name: string; imageUrl?: string | null };
export type TrackOption = { isrc: string; name: string; albumImageUrl?: string | null };

export type TopTrack = {
  isrc: string;
  name: string | null;
  total: number | null;
  daily: number | null;
  albumImageUrl: string | null;
  artistNames?: string[] | null;
  artistIds?: string[] | null;
  releaseDate?: string | null;
  distroPlaylistName?: string | null;
  distroPlaylistImageUrl?: string | null;
};

export type TrackSeriesPoint = { date: string; value: number };
export type TrackDailyPoint = { date: string; daily: number | null; ma7?: number | null };

export type SelectedTrack = {
  name: string | null;
  albumImageUrl: string | null;
  spotifyTrackId: string | null;
  artistNames: string[] | null;
  artistIds: string[] | null;
  releaseDate: string | null;
};

export type TrackPlaylistMembership = {
  playlistKey: string;
  playlistName: string;
  playlistType: string;
  displayOrder: number | null;
  addedRunDate: string;
  removedRunDate: string | null;
  spotifyPlaylistId: string | null;
  spotifyPlaylistImageUrl: string | null;
  isCatalog: boolean;
};
