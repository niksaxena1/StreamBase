type SpotifyToken = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

type TokenCache = {
  token: string;
  expiresAtMs: number;
};

declare global {
  var __spotifyTokenCache: TokenCache | undefined;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  const cached = globalThis.__spotifyTokenCache;
  if (cached && cached.expiresAtMs > now + 30_000) {
    return cached.token;
  }

  const clientId = requireEnv("SPOTIFY_CLIENT_ID");
  const clientSecret = requireEnv("SPOTIFY_CLIENT_SECRET");
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify token error ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as SpotifyToken;
  globalThis.__spotifyTokenCache = {
    token: json.access_token,
    expiresAtMs: now + json.expires_in * 1000,
  };
  return json.access_token;
}

async function spotifyFetch<T>(path: string): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify API error ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export type SpotifyTrackLookup = {
  trackId: string;
  trackName: string;
  albumId: string;
  albumName: string;
  albumImageUrl: string | null;
  artistIds: string[];
  artistNames: string[];
  externalUrl: string | null;
};

export async function findTrackByIsrc(isrc: string): Promise<SpotifyTrackLookup | null> {
  const q = encodeURIComponent(`isrc:${isrc}`);
  type SearchResp = {
    tracks?: {
      items: Array<{
        id: string;
        name: string;
        external_urls?: { spotify?: string };
        artists: Array<{ id: string; name: string }>;
        album: {
          id: string;
          name: string;
          images: Array<{ url: string; height: number; width: number }>;
        };
      }>;
    };
  };

  const resp = await spotifyFetch<SearchResp>(`/search?q=${q}&type=track&limit=1`);
  const item = resp.tracks?.items?.[0];
  if (!item) return null;

  const bestImg = (item.album.images ?? [])[0]?.url ?? null;
  return {
    trackId: item.id,
    trackName: item.name,
    albumId: item.album.id,
    albumName: item.album.name,
    albumImageUrl: bestImg,
    artistIds: item.artists.map((a) => a.id),
    artistNames: item.artists.map((a) => a.name),
    externalUrl: item.external_urls?.spotify ?? null,
  };
}

export type SpotifyPlaylistLookup = {
  playlistId: string;
  name: string;
  imageUrl: string | null;
  externalUrl: string | null;
};

export async function getPlaylist(playlistId: string): Promise<SpotifyPlaylistLookup> {
  type PlaylistResp = {
    id: string;
    name: string;
    images: Array<{ url: string; height: number; width: number }>;
    external_urls?: { spotify?: string };
  };
  const p = await spotifyFetch<PlaylistResp>(`/playlists/${encodeURIComponent(playlistId)}`);
  return {
    playlistId: p.id,
    name: p.name,
    imageUrl: p.images?.[0]?.url ?? null,
    externalUrl: p.external_urls?.spotify ?? null,
  };
}

