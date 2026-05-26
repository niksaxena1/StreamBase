import type { SupabaseClient } from "@supabase/supabase-js";

type SpotifyToken = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

function normIsrcForLookup(isrc: string): string {
  // Spotify search expects canonical 12-char alphanumeric ISRCs.
  // SpotOnTrack sometimes exports hyphenated ISRCs (e.g. "GB-SMU-30-65473").
  return String(isrc ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

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
  const isrcNorm = normIsrcForLookup(isrc);
  if (!isrcNorm) return null;
  const q = encodeURIComponent(`isrc:${isrcNorm}`);
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

export type SpotifyPlaylistFollowerLookup = SpotifyPlaylistLookup & {
  ownerId: string | null;
  ownerName: string | null;
  followerCount: number;
  trackCount: number | null;
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

export type SpotifyUserPlaylistSummary = {
  playlistId: string;
  name: string;
  imageUrl: string | null;
  externalUrl: string | null;
  followerCount: number | null;
  ownerId: string | null;
};

type SpotifyUserPlaylistsPage = {
  items?: Array<{
    id?: string;
    name?: string;
    images?: Array<{ url: string }>;
    external_urls?: { spotify?: string };
    owner?: { id?: string };
    followers?: { total?: number };
  }>;
  next?: string | null;
};

function spotifyPathFromNextUrl(next: string | null | undefined): string | null {
  if (!next) return null;
  try {
    const url = new URL(next);
    const path = url.pathname.replace(/^\/v1/, "");
    return `${path}${url.search}`;
  } catch {
    return null;
  }
}

/** Public playlists owned by a Spotify user (client-credentials). Paginated with a safety cap. */
export async function listUserOwnedPlaylists(
  userId: string,
  opts?: { maxItems?: number },
): Promise<{ playlists: SpotifyUserPlaylistSummary[]; truncated: boolean }> {
  const ownerId = String(userId ?? "").trim();
  if (!ownerId) return { playlists: [], truncated: false };

  const maxItems = Math.min(500, Math.max(1, opts?.maxItems ?? 200));
  let path: string | null = `/users/${encodeURIComponent(ownerId)}/playlists?limit=50`;
  const out: SpotifyUserPlaylistSummary[] = [];
  let truncated = false;

  while (path) {
    const page = await spotifyFetch<SpotifyUserPlaylistsPage>(path);
    for (const item of page.items ?? []) {
      if (!item.id || !item.name) continue;
      if (item.owner?.id && item.owner.id !== ownerId) continue;
      out.push({
        playlistId: item.id,
        name: item.name,
        imageUrl: item.images?.[0]?.url ?? null,
        externalUrl: item.external_urls?.spotify ?? null,
        followerCount:
          typeof item.followers?.total === "number" ? item.followers.total : null,
        ownerId: item.owner?.id ?? ownerId,
      });
      if (out.length >= maxItems) {
        truncated = true;
        return { playlists: out, truncated };
      }
    }
    path = truncated ? null : spotifyPathFromNextUrl(page.next);
    if (path && out.length >= maxItems) {
      truncated = true;
      break;
    }
  }

  return { playlists: out, truncated };
}

export type SpotifyUserProfile = {
  userId: string;
  displayName: string | null;
  imageUrl: string | null;
};

export async function getSpotifyUser(userId: string): Promise<SpotifyUserProfile> {
  const id = String(userId ?? "").trim();
  type UserResp = {
    id: string;
    display_name?: string | null;
    images?: Array<{ url: string }>;
  };
  const user = await spotifyFetch<UserResp>(`/users/${encodeURIComponent(id)}`);
  return {
    userId: user.id,
    displayName: user.display_name ?? null,
    imageUrl: user.images?.[0]?.url ?? null,
  };
}

const PLAYLIST_FOLLOWER_ENRICH_CONCURRENCY = 5;

/** User-playlist list items omit follower totals; hydrate via Get Playlist (same as add flow). */
export async function enrichPlaylistsWithFollowerCounts(
  playlists: SpotifyUserPlaylistSummary[],
): Promise<SpotifyUserPlaylistSummary[]> {
  if (playlists.length === 0) return playlists;

  const enriched = [...playlists];
  for (let i = 0; i < enriched.length; i += PLAYLIST_FOLLOWER_ENRICH_CONCURRENCY) {
    const chunk = enriched.slice(i, i + PLAYLIST_FOLLOWER_ENRICH_CONCURRENCY);
    const settled = await Promise.all(
      chunk.map(async (playlist) => {
        if (typeof playlist.followerCount === "number") return playlist;
        try {
          const meta = await getPlaylistWithFollowers(playlist.playlistId);
          return { ...playlist, followerCount: meta.followerCount };
        } catch {
          return playlist;
        }
      }),
    );
    for (let j = 0; j < settled.length; j += 1) {
      enriched[i + j] = settled[j];
    }
  }
  return enriched;
}

export async function getPlaylistWithFollowers(playlistId: string): Promise<SpotifyPlaylistFollowerLookup> {
  type PlaylistResp = {
    id: string;
    name: string;
    images: Array<{ url: string; height: number; width: number }>;
    external_urls?: { spotify?: string };
    owner?: { id?: string; display_name?: string };
    followers?: { total?: number };
    tracks?: { total?: number };
    items?: { total?: number };
  };
  const fields = encodeURIComponent("id,name,owner(id,display_name),images,external_urls,followers(total),tracks(total),items(total)");
  const p = await spotifyFetch<PlaylistResp>(`/playlists/${encodeURIComponent(playlistId)}?fields=${fields}`);
  const followerCount = p.followers?.total;
  if (typeof followerCount !== "number") {
    throw new Error("Spotify playlist response did not include followers.total");
  }
  return {
    playlistId: p.id,
    name: p.name,
    imageUrl: p.images?.[0]?.url ?? null,
    externalUrl: p.external_urls?.spotify ?? null,
    ownerId: p.owner?.id ?? null,
    ownerName: p.owner?.display_name ?? null,
    followerCount,
    trackCount: p.tracks?.total ?? p.items?.total ?? null,
  };
}

export type SpotifyArtistLookup = {
  artistId: string;
  name: string;
  imageUrl: string | null;
  externalUrl: string | null;
};

export async function getArtists(artistIds: string[]): Promise<Map<string, SpotifyArtistLookup>> {
  const result = new Map<string, SpotifyArtistLookup>();
  
  // Spotify API allows up to 50 IDs per request
  const batchSize = 50;
  for (let i = 0; i < artistIds.length; i += batchSize) {
    const batch = artistIds.slice(i, i + batchSize);
    const idsParam = batch.map(id => encodeURIComponent(id)).join(",");
    
    type ArtistsResp = {
      artists: Array<{
        id: string;
        name: string;
        images: Array<{ url: string; height: number; width: number }>;
        external_urls?: { spotify?: string };
      }>;
    };
    
    try {
      const resp = await spotifyFetch<ArtistsResp>(`/artists?ids=${idsParam}`);
      for (const artist of resp.artists) {
        if (artist.id) {
          result.set(artist.id, {
            artistId: artist.id,
            name: artist.name,
            imageUrl: artist.images?.[0]?.url ?? null,
            externalUrl: artist.external_urls?.spotify ?? null,
          });
        }
      }
    } catch (error) {
      console.error(`Error fetching artists batch:`, error);
      // Continue with other batches even if one fails
    }
  }
  
  return result;
}

type CachedArtistRow = {
  artist_id: string;
  name: string | null;
  image_url: string | null;
  external_url: string | null;
  refreshed_at: string;
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Get artists using a DB cache (service role recommended), refreshing stale entries.
 *
 * This reduces Spotify API usage (and tail latency) for hot paths like global search.
 */
export async function getArtistsCached(
  sb: SupabaseClient,
  artistIds: string[],
  opts?: { maxAgeDays?: number },
): Promise<Map<string, SpotifyArtistLookup>> {
  const maxAgeDays = Math.max(1, Math.floor(opts?.maxAgeDays ?? 31));
  const now = Date.now();
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

  const ids = Array.from(new Set(artistIds.filter(Boolean)));
  const result = new Map<string, SpotifyArtistLookup>();
  if (ids.length === 0) return result;

  // Read cached rows (chunked to avoid very large IN lists).
  const cachedRows: CachedArtistRow[] = [];
  for (const idsChunk of chunk(ids, 500)) {
    const { data } = await sb
      .from("spotify_artist_images")
      .select("artist_id,name,image_url,external_url,refreshed_at")
      .in("artist_id", idsChunk);
    if (data?.length) cachedRows.push(...(data as CachedArtistRow[]));
  }

  const cachedById = new Map<string, CachedArtistRow>();
  for (const r of cachedRows) cachedById.set(r.artist_id, r);

  const needsRefresh: string[] = [];
  for (const id of ids) {
    const row = cachedById.get(id);
    if (!row) {
      needsRefresh.push(id);
      continue;
    }
    const refreshedAtMs = Date.parse(row.refreshed_at);
    if (!Number.isFinite(refreshedAtMs) || now - refreshedAtMs > maxAgeMs) {
      needsRefresh.push(id);
      continue;
    }
    result.set(id, {
      artistId: row.artist_id,
      name: row.name ?? "",
      imageUrl: row.image_url ?? null,
      externalUrl: row.external_url ?? null,
    });
  }

  // Refresh missing/stale artists from Spotify (batched).
  if (needsRefresh.length > 0) {
    const fresh = await getArtists(needsRefresh);

    const upserts = Array.from(fresh.values()).map((a) => ({
      artist_id: a.artistId,
      name: a.name,
      image_url: a.imageUrl,
      external_url: a.externalUrl,
      refreshed_at: new Date().toISOString(),
    }));

    if (upserts.length > 0) {
      // Best-effort upsert; never fail the page on cache write.
      try {
        await sb.from("spotify_artist_images").upsert(upserts, { onConflict: "artist_id" });
      } catch (e) {
        console.error("[spotify] failed to upsert artist cache:", e);
      }
    }

    for (const [id, a] of fresh.entries()) result.set(id, a);
  }

  return result;
}

