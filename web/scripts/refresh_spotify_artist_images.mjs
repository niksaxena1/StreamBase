// Refresh Spotify artist image URLs in Supabase cache table.
// Intended to run on a schedule (e.g. first Friday of the month).
//
// Required env vars:
// - NEXT_PUBLIC_SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY
// - SPOTIFY_CLIENT_ID
// - SPOTIFY_CLIENT_SECRET
//
// Optional:
// - MAX_REFRESH: max rows to refresh (default 2000)
// - MAX_AGE_DAYS: refresh rows older than this (default 31)

import { createClient } from "@supabase/supabase-js";

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!SUPABASE_URL) {
  throw new Error("Missing env var: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)");
}
const SUPABASE_SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const SPOTIFY_CLIENT_ID = requireEnv("SPOTIFY_CLIENT_ID");
const SPOTIFY_CLIENT_SECRET = requireEnv("SPOTIFY_CLIENT_SECRET");

const MAX_REFRESH = Math.max(1, Number(process.env.MAX_REFRESH ?? "2000") || 2000);
const MAX_AGE_DAYS = Math.max(1, Number(process.env.MAX_AGE_DAYS ?? "31") || 31);

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let tokenCache = { token: null, expiresAtMs: 0 };

async function getSpotifyToken() {
  const now = Date.now();
  if (tokenCache.token && tokenCache.expiresAtMs > now + 30_000) return tokenCache.token;

  const auth = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Spotify token error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  tokenCache = { token: json.access_token, expiresAtMs: now + (json.expires_in ?? 3600) * 1000 };
  return tokenCache.token;
}

async function spotifyGetArtists(ids) {
  const token = await getSpotifyToken();
  const idsParam = ids.map(encodeURIComponent).join(",");
  const res = await fetch(`https://api.spotify.com/v1/artists?ids=${idsParam}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Spotify artists error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return await res.json();
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Grab a batch of stale rows; refresh those.
  const { data: staleRows, error } = await sb
    .from("spotify_artist_images")
    .select("artist_id,refreshed_at")
    .lt("refreshed_at", cutoff)
    .order("refreshed_at", { ascending: true })
    .limit(MAX_REFRESH);

  if (error) throw error;
  const ids = (staleRows ?? []).map((r) => r.artist_id).filter(Boolean);

  if (ids.length === 0) {
    console.log(`[spotify-refresh] nothing to refresh (cutoff ${cutoff})`);
    return;
  }

  console.log(`[spotify-refresh] refreshing ${ids.length} artists (cutoff ${cutoff})`);

  const refreshedAt = new Date().toISOString();
  let refreshedCount = 0;

  for (const idsChunk of chunk(ids, 50)) {
    const resp = await spotifyGetArtists(idsChunk);
    const upserts = (resp.artists ?? [])
      .filter((a) => a?.id)
      .map((a) => ({
        artist_id: a.id,
        name: a.name ?? null,
        image_url: a.images?.[0]?.url ?? null,
        external_url: a.external_urls?.spotify ?? null,
        refreshed_at: refreshedAt,
      }));

    if (upserts.length > 0) {
      const { error: upsertErr } = await sb.from("spotify_artist_images").upsert(upserts, { onConflict: "artist_id" });
      if (upsertErr) throw upsertErr;
      refreshedCount += upserts.length;
    }
  }

  console.log(`[spotify-refresh] upserted ${refreshedCount} artists`);
}

main().catch((e) => {
  console.error("[spotify-refresh] failed:", e);
  process.exit(1);
});

