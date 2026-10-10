// Copy playlist thumbnails into a project-owned Supabase Storage bucket.
// Refresh must not replace these URLs with Spotify mosaics afterward.
//
// Required env vars:
// - NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY
//
// Optional:
// - PLAYLIST_TYPE=Distro   (default Distro; use ALL to snapshot every playlist with an image)
// - FORCE=1                (re-upload even when the row already points at Storage)

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const BUCKET = "playlist-logos";
const LOCAL_LOGO_OVERRIDES = {
  masafi_amuse: "public/playlist-logos/amuse.jpg",
  tg_amuse: "public/playlist-logos/amuse.jpg",
  tgm_amuse: "public/playlist-logos/amuse.jpg",
  ghr_emubands: "public/playlist-logos/emubands.jpg",
  tg_emubands: "public/playlist-logos/emubands.jpg",
  tps_emubands: "public/playlist-logos/emubands.jpg",
  tg_imusician: "public/playlist-logos/imusician.jpg",
  tg_indiemassive: "public/playlist-logos/indiemassive.jpg",
  masafy_landr: "public/playlist-logos/landr.jpg",
  fh_offstep: "public/playlist-logos/offstep.jpg",
  tg_offstep: "public/playlist-logos/offstep.jpg",
  p_release: "public/playlist-logos/releese.jpg",
  gb_routenote: "public/playlist-logos/routenote.jpg",
  p_routenote: "public/playlist-logos/routenote.jpg",
  sonomo: "public/playlist-logos/sonomo.jpg",
  tg_toolost: "public/playlist-logos/toolost.jpg",
};

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function isOwnedStorageUrl(url) {
  return (url ?? "").includes(`/storage/v1/object/public/${BUCKET}/`);
}

function extensionFor(contentType, sourceUrl) {
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (type === "image/png") return ".png";
  if (type === "image/webp") return ".webp";
  if (type === "image/gif") return ".gif";
  if (type === "image/jpeg" || type === "image/jpg") return ".jpg";
  const path = String(sourceUrl ?? "").split("?")[0].toLowerCase();
  if (path.endsWith(".png")) return ".png";
  if (path.endsWith(".webp")) return ".webp";
  if (path.endsWith(".gif")) return ".gif";
  return ".jpg";
}

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!SUPABASE_URL) throw new Error("Missing env var: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)");
const SUPABASE_SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const playlistType = (process.env.PLAYLIST_TYPE ?? "Distro").trim();
const force = ["1", "true", "yes"].includes(String(process.env.FORCE ?? "").toLowerCase());

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID ?? "";
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET ?? "";

let tokenCache = { token: null, expiresAtMs: 0 };

async function getSpotifyToken() {
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) return null;
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
  if (!res.ok) throw new Error(`Spotify token error ${res.status}`);
  const json = await res.json();
  tokenCache = { token: json.access_token, expiresAtMs: now + (json.expires_in ?? 3600) * 1000 };
  return tokenCache.token;
}

async function spotifyPlaylistImage(playlistId) {
  const token = await getSpotifyToken();
  if (!token || !playlistId) return null;
  const res = await fetch(`https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}?fields=images`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json.images?.[0]?.url ?? null;
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function ensureBucket() {
  const { data: buckets, error } = await sb.storage.listBuckets();
  if (error) throw new Error(`listBuckets failed: ${error.message}`);
  const existing = (buckets ?? []).find((b) => b.name === BUCKET || b.id === BUCKET);
  if (existing) {
    if (!existing.public) {
      const { error: updErr } = await sb.storage.updateBucket(BUCKET, { public: true });
      if (updErr) throw new Error(`updateBucket failed: ${updErr.message}`);
    }
    return;
  }
  const { error: createErr } = await sb.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: "5MB",
    allowedMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
  });
  if (createErr) throw new Error(`createBucket failed: ${createErr.message}`);
}

async function loadBytes(playlistKey, imageUrl) {
  const overrideRel = LOCAL_LOGO_OVERRIDES[playlistKey];
  if (overrideRel) {
    const abs = join(process.cwd(), overrideRel);
    if (!existsSync(abs)) throw new Error(`Local logo missing for ${playlistKey}: ${abs}`);
    return { bytes: readFileSync(abs), contentType: "image/png", source: `file:${overrideRel}` };
  }

  if (imageUrl?.startsWith("/playlist-logos/")) {
    const abs = join(process.cwd(), "public", imageUrl.replace(/^\//, ""));
    if (!existsSync(abs)) throw new Error(`Local logo missing for ${playlistKey}: ${abs}`);
    return { bytes: readFileSync(abs), contentType: "image/png", source: `file:${imageUrl}` };
  }

  if (!imageUrl) return null;
  const res = await fetch(imageUrl, { cache: "no-store" });
  if (!res.ok) throw new Error(`download ${res.status} for ${playlistKey}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  return { bytes, contentType, source: imageUrl.slice(0, 80) };
}

async function main() {
  await ensureBucket();

  let query = sb
    .from("playlists")
    .select("playlist_key,display_name,playlist_type,spotify_playlist_id,spotify_playlist_image_url")
    .order("playlist_key", { ascending: true });
  if (playlistType.toUpperCase() !== "ALL") {
    query = query.eq("playlist_type", playlistType);
  }
  const { data, error } = await query;
  if (error) throw new Error(`select playlists failed: ${error.message}`);

  const rows = (data ?? []).filter((row) => {
    if (LOCAL_LOGO_OVERRIDES[row.playlist_key]) return true;
    return Boolean(row.spotify_playlist_image_url);
  });

  console.log(`[playlist-logos] snapshotting ${rows.length} playlists (type=${playlistType}, force=${force})`);

  let uploaded = 0;
  let skipped = 0;
  const failures = [];

  for (const row of rows) {
    const key = String(row.playlist_key);
    const current = row.spotify_playlist_image_url ?? null;
    if (!force && isOwnedStorageUrl(current) && !LOCAL_LOGO_OVERRIDES[key]) {
      skipped += 1;
      continue;
    }
    try {
      let loaded = null;
      try {
        loaded = await loadBytes(key, current);
      } catch (e) {
        const spotifyUrl = await spotifyPlaylistImage(row.spotify_playlist_id);
        if (!spotifyUrl) throw e;
        loaded = await loadBytes(key, spotifyUrl);
      }
      if (!loaded) {
        skipped += 1;
        continue;
      }
      const ext = extensionFor(loaded.contentType, LOCAL_LOGO_OVERRIDES[key] ?? current);
      const objectKey = `${key}${ext}`;
      const { error: upErr } = await sb.storage.from(BUCKET).upload(objectKey, loaded.bytes, {
        upsert: true,
        contentType: loaded.contentType.split(";")[0],
      });
      if (upErr) throw new Error(upErr.message);
      const publicUrl = `${SUPABASE_URL.replace(/\/$/, "")}/storage/v1/object/public/${BUCKET}/${objectKey}`;
      const { error: dbErr } = await sb
        .from("playlists")
        .update({ spotify_playlist_image_url: publicUrl })
        .eq("playlist_key", key);
      if (dbErr) throw new Error(dbErr.message);
      uploaded += 1;
      console.log(`OK ${key} <- ${loaded.source}`);
    } catch (e) {
      failures.push({ key, error: e instanceof Error ? e.message : String(e) });
      console.log(`FAIL ${key}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log(
    JSON.stringify({
      uploaded,
      skipped,
      failed: failures.length,
      failures,
    }),
  );
  if (failures.length) process.exit(1);
}

main().catch((e) => {
  console.error("[playlist-logos] failed:", e);
  process.exit(1);
});
