import type { SaiEnvelope } from "./types";
import type { DataQueryPlan } from "./tools";

export type SaiPlan = {
  lane: "docs" | "data" | "hybrid";
  docs?: { query: string };
  data?: { queries: DataQueryPlan[] };
  notes?: string[];
};

function norm(s: string) {
  return (s ?? "").toLowerCase();
}

/**
 * v1 planner: heuristic, deterministic, safe.
 * Later: replace with an LLM planner that outputs the same schema.
 */
export function planMessage(message: string, envelope?: SaiEnvelope): SaiPlan {
  const q = norm(message);

  const notes: string[] = [];
  // Data questions should be explicit (numbers/totals/trends). Merely mentioning
  // entities like "tracks/playlists" is NOT enough.
  const looksLikeData =
    /\bhow many\b/.test(q) ||
    /\bcount\b/.test(q) ||
    /\btotal\b/.test(q) ||
    /\b(sum|average|avg|median|min|max)\b/.test(q) ||
    /\bstats?\b/.test(q) ||
    /\brows?\b/.test(q) ||
    /\btrend\b/.test(q) ||
    /\bover time\b/.test(q) ||
    /\blast (7|14|28|30|90) days\b/.test(q) ||
    // Ranking queries are data questions even without explicit counts.
    (/\btop\b/.test(q) && /\btracks?\b/.test(q));

  const looksLikeHelp =
    /\bhow do i\b/.test(q) ||
    /\bwhere\b/.test(q) ||
    /\bwhat is\b/.test(q) ||
    /\bexplain\b/.test(q) ||
    /\bmeaning\b/.test(q) ||
    /\bdefinition\b/.test(q);

  const isrcMatch = /\b[A-Z0-9]{12}\b/i.exec(message);
  const maybeIsrc = isrcMatch ? isrcMatch[0].toUpperCase() : envelope?.selected?.isrc ?? null;

  // Spotify artist ids are 22 char base62.
  const artistIdMatch = /\b[0-9A-Za-z]{22}\b/.exec(message);
  const maybeArtistId = artistIdMatch ? artistIdMatch[0] : envelope?.selected?.artist_id ?? null;

  const knownPlaylistKeyMatch = /\b(all_catalog|releases|ext)\b/i.exec(message);
  const knownPlaylistKey = knownPlaylistKeyMatch?.[1]?.toLowerCase() ?? null;

  // If user says "Top tracks in <...>", capture the full phrase. This is used either as
  // a direct playlist key (ext/releasess/all_catalog) OR as a playlist name to resolve.
  const inPhraseMatch = /\btop\s+tracks?\s+in\s+(.+?)\s*$/i.exec(message);
  const inPhraseRaw = inPhraseMatch?.[1]?.trim() ?? null;

  // Token candidate for explicit keys like "playlist releases" or "in releases".
  const inTokenMatch = /\b(?:in|playlist)\s+([a-z0-9_]{3,})\b/i.exec(message);
  const inToken = inTokenMatch?.[1]?.toLowerCase() ?? null;

  const stopTokens = new Set(["track", "tracks", "top", "playlist", "playlists", "in"]);
  const tokenLooksLikePlaylistKey =
    !!inToken && !stopTokens.has(inToken) && (inToken === "all_catalog" || inToken === "releases" || inToken === "ext" || inToken.includes("_"));

  const maybePlaylistKey =
    (knownPlaylistKey ?? (tokenLooksLikePlaylistKey ? inToken : null) ?? envelope?.selected?.playlist_key ?? null) ?? null;

  const playlistQuery =
    // If user provided a phrase and it wasn't a recognized key, treat it as a playlist name.
    inPhraseRaw && inPhraseRaw.toLowerCase() !== maybePlaylistKey ? inPhraseRaw : null;

  const dateMatch = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(message);
  const maybeDate = dateMatch ? dateMatch[1] : null;

  const wantsSeries = /\b(trend|over time|series|history|last \d+ days)\b/.test(q);
  const wantsTop = /\btop\b/.test(q) && /\btracks?\b/.test(q);

  // Context hint: if user is on /docs, prefer docs; if on dashboards, allow hybrid.
  const path = envelope?.route?.pathname ?? "";
  if (path.startsWith("/docs")) notes.push("context: /docs");

  if (looksLikeData && looksLikeHelp) {
    return {
      lane: "hybrid",
      docs: { query: message },
      data: { queries: [{ templateId: "system_stats", params: {} }] },
      notes: ["hybrid: docs + system_stats", ...notes],
    };
  }

  if (looksLikeData) {
    // Prefer entity-specific templates when possible.
    // Allow "top tracks in all_catalog" even if the user doesn't say "playlist".
    if (wantsTop && (maybePlaylistKey || playlistQuery)) {
      return {
        lane: "data",
        data: {
          queries: [
            {
              templateId: "playlist_top_tracks_total",
              params: { playlist_key: maybePlaylistKey, playlist_query: playlistQuery, run_date: maybeDate },
            },
          ],
        },
        notes: ["data: playlist_top_tracks_total", ...notes],
      };
    }

    if (/\bartist\b/.test(q) && maybeArtistId) {
      if (wantsTop) {
        return {
          lane: "data",
          data: { queries: [{ templateId: "artist_top_tracks_total", params: { artist_id: maybeArtistId, run_date: maybeDate } }] },
          notes: ["data: artist_top_tracks_total", ...notes],
        };
      }
      if (wantsSeries) {
        return {
          lane: "data",
          data: { queries: [{ templateId: "artist_series", params: { artist_id: maybeArtistId, end_date: maybeDate } }] },
          notes: ["data: artist_series", ...notes],
        };
      }
      return {
        lane: "data",
        data: { queries: [{ templateId: "artist_total_streams", params: { artist_id: maybeArtistId, run_date: maybeDate } }] },
        notes: ["data: artist_total_streams", ...notes],
      };
    }

    if (/\bplaylist\b/.test(q) && maybePlaylistKey) {
      if (wantsTop) {
        return {
          lane: "data",
          data: { queries: [{ templateId: "playlist_top_tracks_total", params: { playlist_key: maybePlaylistKey, run_date: maybeDate } }] },
          notes: ["data: playlist_top_tracks_total", ...notes],
        };
      }
      if (wantsSeries) {
        return {
          lane: "data",
          data: { queries: [{ templateId: "playlist_series", params: { playlist_key: maybePlaylistKey, end_date: maybeDate } }] },
          notes: ["data: playlist_series", ...notes],
        };
      }
      return {
        lane: "data",
        data: { queries: [{ templateId: "playlist_total_streams", params: { playlist_key: maybePlaylistKey, run_date: maybeDate } }] },
        notes: ["data: playlist_total_streams", ...notes],
      };
    }

    if (/\btrack\b/.test(q) && maybeIsrc) {
      if (wantsSeries) {
        return {
          lane: "data",
          data: { queries: [{ templateId: "track_series", params: { isrc: maybeIsrc, end_date: maybeDate } }] },
          notes: ["data: track_series", ...notes],
        };
      }
      return {
        lane: "data",
        data: { queries: [{ templateId: "track_total_streams", params: { isrc: maybeIsrc, run_date: maybeDate } }] },
        notes: ["data: track_total_streams", ...notes],
      };
    }

    return {
      lane: "data",
      data: { queries: [{ templateId: "system_stats", params: {} }] },
      notes: ["data: system_stats", ...notes],
    };
  }

  return {
    lane: "docs",
    docs: { query: message },
    notes: ["docs: retrieval", ...notes],
  };
}

