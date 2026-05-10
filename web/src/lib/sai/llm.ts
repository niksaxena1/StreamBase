import type { SupabaseClient } from "@supabase/supabase-js";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText, tool, stepCountIs, type ModelMessage } from "ai";
import { z } from "zod";

import { logDebug, logWarn } from "@/lib/logger";
import { mergeDocCitations, retrieveDocs } from "./docs";
import type { SaiEnvelope, SaiTurnContext } from "./types";
import {
  type DataQueryTemplateId,
  formatDataPayload,
  runDataQuery,
  searchEntities,
} from "./tools";

const SAI_MODEL_OPTIONS = [
  { id: "gpt-4.1", label: "GPT-4.1", provider: "openai" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 Mini", provider: "openai" },
  { id: "gpt-4.1-nano", label: "GPT-4.1 Nano (fast)", provider: "openai" },
  { id: "o4-mini", label: "o4-mini (reasoning)", provider: "openai" },
] as const;

export type SaiModelOption = (typeof SAI_MODEL_OPTIONS)[number];
export { SAI_MODEL_OPTIONS };

function isOpenRouterModel(modelId: string): boolean {
  return modelId.includes("/");
}

export function defaultModelId(): string {
  if (process.env.SAI_MODEL) return process.env.SAI_MODEL;
  return process.env.OPENAI_CHAT_MODEL ?? "gpt-4.1-mini";
}

function resolveProvider(modelId: string) {
  if (isOpenRouterModel(modelId)) {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error("OpenRouter model selected but OPENROUTER_API_KEY is not set.");
    return { apiKey: key, baseURL: "https://openrouter.ai/api/v1" };
  }
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Missing env var: OPENAI_API_KEY (or set OPENROUTER_API_KEY for OpenRouter)");
  return { apiKey: key };
}


function extractPathIds(pathname: string): { artist_id?: string; isrc?: string } {
  const out: { artist_id?: string; isrc?: string } = {};
  const artistMatch = /\/artists\/([0-9A-Za-z]{22})\b/.exec(pathname);
  if (artistMatch) out.artist_id = artistMatch[1];
  const trackMatch = /\/tracks\/([A-Z0-9]{12})\b/i.exec(pathname);
  if (trackMatch) out.isrc = trackMatch[1].toUpperCase();
  return out;
}

function buildSystemPrompt(envelope: SaiEnvelope): string {
  const path = envelope.route?.pathname ?? "(unknown)";
  const search = envelope.route?.search ?? {};
  const sel = envelope.selected ?? {};
  const ui = envelope.ui ?? {};
  const pathIds = extractPathIds(path);

  const contextArtistId = sel.artist_id ?? pathIds.artist_id ?? null;
  const contextIsrc = sel.isrc ?? pathIds.isrc ?? null;
  const contextPlaylistKey = sel.playlist_key ?? null;
  const contextCollector = sel.collector ?? null;

  return [
    "You are SAI (SBase AI), an expert in-app assistant for SBase — a Spotify catalog analytics platform.",
    "",
    "# ABOUT SPOTIBASE",
    "SBase ingests daily SpotOnTrack CSV exports into a Postgres database (via Supabase).",
    "It is NOT the official Spotify for Artists API — data comes from SpotOnTrack scrapes.",
    "Users track stream counts, trends, top tracks, playlist performance, collectors (revenue groupings), data health, and artist collaboration networks.",
    "Key pages: Home (dashboard), Playlists, Catalog, Collectors, Health, Network (collaboration graph), Settings, Docs.",
    "",
    "# IDENTIFIERS",
    "- Spotify artist id: exactly 22 base62 characters [0-9A-Za-z], e.g. 3TVXtAsR1Inumwj472S9r4",
    "- Track ISRC: exactly 12 alphanumeric characters, e.g. USRC11600001",
    "- Playlist key: internal slug like all_catalog, releases, ext, or custom keys from search",
    "",
    "# KEY DOMAIN KNOWLEDGE",
    "- playlist_key 'all_catalog' = the ENTIRE catalog (all tracks). Use this for 'total streams', 'my catalog', 'overall', etc.",
    "- playlist_key 'releases' = official releases playlist.",
    "- playlist_key 'ext' = external/editorial playlists.",
    "- When user asks 'how many streams' without specifying an entity, they mean the full catalog → use get_playlist_streams with playlist_key='all_catalog'.",
    "- When user asks about an artist/track BY NAME, you MUST call search_entities first to get the ID, then call the appropriate tool with that ID.",
    "",
    "# MULTI-STEP REASONING — THIS IS CRITICAL",
    "You MUST think step-by-step. Most questions require 2+ tool calls.",
    "",
    "COMMON PATTERNS:",
    "",
    "Q: 'How many total streams?' → get_playlist_streams(playlist_key='all_catalog')",
    "",
    "Q: 'How is [artist name] doing?'",
    "→ Step 1: search_entities(query='[artist name]')",
    "→ Step 2: get_artist_streams(artist_id='<id from step 1>')",
    "",
    "Q: 'Top tracks' → get_playlist_top_tracks(playlist_key='all_catalog')",
    "",
    "Q: 'How is [track name] doing?'",
    "→ Step 1: search_entities(query='[track name]')",
    "→ Step 2: get_track_streams(isrc='<isrc from step 1>')",
    "",
    "Q: 'Trends for [artist]?'",
    "→ Step 1: search_entities(query='[artist]')",
    "→ Step 2: get_artist_series(artist_id='<id from step 1>')",
    "",
    "NEVER guess or fabricate IDs. ALWAYS use search_entities when the user gives a name.",
    "NEVER invent numbers. Only state metrics returned by tools.",
    "If a tool returns ok=false, explain the error and try an alternative approach.",
    "",
    "# CURRENT UI CONTEXT",
    `Page: ${path}`,
    `Query params: ${JSON.stringify(search)}`,
    `Selected: playlist_key=${contextPlaylistKey ?? "none"}, artist_id=${contextArtistId ?? "none"}, isrc=${contextIsrc ?? "none"}, collector=${contextCollector ?? "none"}`,
    `UI hints: ${JSON.stringify(ui)}`,
    "",
    "When the user says 'this page', 'this artist', 'this track', 'this playlist' — use the ids above.",
    contextArtistId ? `The user is viewing artist ${contextArtistId}. Use this for artist_* queries unless they specify another.` : "",
    contextIsrc ? `The user is viewing track ${contextIsrc}. Use this for track_* queries unless they specify another.` : "",
    contextPlaylistKey ? `The user is viewing playlist '${contextPlaylistKey}'. Use this for playlist_* queries unless they specify another.` : "",
    "",
    "# RESPONSE FORMAT",
    "- Use Markdown: **bold** key numbers, bullet lists for comparisons, headings for sections.",
    "- Be concise but thorough. Lead with the answer, then supporting detail.",
    "- For data answers: state the number clearly, mention the date/period, and add brief context.",
    "- For trends: describe direction (up/down/flat), magnitude, and any notable patterns.",
    "- If you used multiple tools, synthesize the results into a coherent narrative — don't just list raw outputs.",
    "- Never show raw JSON to the user. Always interpret and present data in natural language.",
  ].filter(Boolean).join("\n");
}

function makeDataTool(
  sb: SupabaseClient,
  ctx: SaiTurnContext,
  templateId: DataQueryTemplateId,
  description: string,
  schema: z.ZodObject<any>,
) {
  return tool({
    description,
    inputSchema: schema,
    execute: async (params: Record<string, unknown>) => {
      logDebug(`[SAI] ${templateId} params=`, JSON.stringify(params));
      const res = await runDataQuery(sb, { templateId, params });
      ctx.toolCalls.push(res.toolCall);

      if (!res.payload) {
        const notes = res.toolCall.notes ?? "No data returned";
        logWarn(`[SAI] ${templateId} tool returned no payload`);
        logDebug(`[SAI] ${templateId} FAILED: ${notes}`);
        ctx.warnings.push(`${templateId}: ${notes}`);
        return { ok: false, error: notes, params_received: params };
      }

      const summary = formatDataPayload(templateId, res.payload);
      logDebug(`[SAI] ${templateId} OK: ${summary.slice(0, 120)}`);
      return { ok: true, summary, rowCount: res.toolCall.rowCount ?? undefined };
    },
  });
}

export function createSaiTools(sb: SupabaseClient, ctx: SaiTurnContext) {
  return {
    search_entities: tool({
      description:
        "Search artists, tracks, and playlists by name. Returns IDs you need for other tools. ALWAYS call this first when the user mentions an entity by name.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Artist name, track title, or playlist name"),
        max_results: z.number().int().min(1).max(30).optional().describe("Max rows (default 10)"),
      }),
      execute: async ({ query, max_results }) => {
        const mr = max_results ?? 10;
        logDebug(`[SAI] search_entities query=`, query, `max=${mr}`);
        const { toolCall, rows, error } = await searchEntities(sb, query, mr);
        ctx.toolCalls.push(toolCall);
        if (error) {
          logWarn(`[SAI] search_entities failed`);
          logDebug(`[SAI] search_entities error:`, error);
          ctx.warnings.push(`search_entities: ${error}`);
        }
        logDebug(`[SAI] search_entities returned ${rows.length} rows`);

        const slim = rows.slice(0, mr).map((r: unknown) => {
          const o = r as Record<string, unknown>;
          const type = String(o.type ?? "");
          const id = String(o.id ?? "");
          const entry: Record<string, unknown> = { type, name: o.name };

          if (type === "artist") {
            entry.artist_id = id;
            entry.hint = "Pass this artist_id to get_artist_streams, get_artist_series, or get_artist_top_tracks";
          } else if (type === "track") {
            entry.isrc = id;
            entry.artist_names = o.artist_names ?? undefined;
            entry.hint = "Pass this isrc to get_track_streams or get_track_series";
          } else if (type === "playlist") {
            entry.playlist_key = id;
            entry.hint = "Pass this playlist_key to get_playlist_streams, get_playlist_series, or get_playlist_top_tracks";
          }
          return entry;
        });

        return { count: slim.length, results: slim };
      },
    }),

    get_system_stats: makeDataTool(sb, ctx, "system_stats",
      "Get system-wide stats: total tracks, playlists, distinct artists, latest data date. No parameters needed.",
      z.object({}),
    ),

    get_artist_streams: makeDataTool(sb, ctx, "artist_total_streams",
      "Get total cumulative streams for one artist. Requires artist_id (22-char Spotify ID from search_entities).",
      z.object({
        artist_id: z.string().describe("Spotify artist ID (22 characters), get this from search_entities"),
        run_date: z.string().optional().describe("Date YYYY-MM-DD (defaults to latest)"),
      }),
    ),

    get_track_streams: makeDataTool(sb, ctx, "track_total_streams",
      "Get total cumulative streams for one track. Requires isrc (12-char ISRC from search_entities).",
      z.object({
        isrc: z.string().describe("Track ISRC (12 characters), get this from search_entities"),
        run_date: z.string().optional().describe("Date YYYY-MM-DD (defaults to latest)"),
      }),
    ),

    get_playlist_streams: makeDataTool(sb, ctx, "playlist_total_streams",
      "Get total cumulative streams for a playlist. Use playlist_key='all_catalog' for the entire catalog.",
      z.object({
        playlist_key: z.string().describe("Playlist key, e.g. 'all_catalog', 'releases', 'ext', or a key from search_entities"),
        run_date: z.string().optional().describe("Date YYYY-MM-DD (defaults to latest)"),
      }),
    ),

    get_artist_series: makeDataTool(sb, ctx, "artist_series",
      "Get daily stream time series for one artist over a date range (default ~30 days).",
      z.object({
        artist_id: z.string().describe("Spotify artist ID (22 characters)"),
        start_date: z.string().optional().describe("Start date YYYY-MM-DD"),
        end_date: z.string().optional().describe("End date YYYY-MM-DD (defaults to latest)"),
      }),
    ),

    get_track_series: makeDataTool(sb, ctx, "track_series",
      "Get daily stream time series for one track over a date range (default ~30 days).",
      z.object({
        isrc: z.string().describe("Track ISRC (12 characters)"),
        start_date: z.string().optional().describe("Start date YYYY-MM-DD"),
        end_date: z.string().optional().describe("End date YYYY-MM-DD (defaults to latest)"),
      }),
    ),

    get_playlist_series: makeDataTool(sb, ctx, "playlist_series",
      "Get daily stream time series for a playlist over a date range (default ~30 days).",
      z.object({
        playlist_key: z.string().describe("Playlist key"),
        start_date: z.string().optional().describe("Start date YYYY-MM-DD"),
        end_date: z.string().optional().describe("End date YYYY-MM-DD (defaults to latest)"),
      }),
    ),

    get_artist_top_tracks: makeDataTool(sb, ctx, "artist_top_tracks_total",
      "Get an artist's top tracks ranked by total cumulative streams.",
      z.object({
        artist_id: z.string().describe("Spotify artist ID (22 characters)"),
        run_date: z.string().optional().describe("Date YYYY-MM-DD (defaults to latest)"),
        limit_rows: z.number().int().min(1).max(100).optional().describe("Max tracks to return (default 25)"),
      }),
    ),

    get_artist_top_tracks_daily: makeDataTool(sb, ctx, "artist_top_tracks_daily",
      "Get an artist's top tracks ranked by daily streams (most popular right now).",
      z.object({
        artist_id: z.string().describe("Spotify artist ID (22 characters)"),
        run_date: z.string().optional().describe("Date YYYY-MM-DD (defaults to latest)"),
        limit_rows: z.number().int().min(1).max(100).optional().describe("Max tracks to return (default 25)"),
      }),
    ),

    get_playlist_top_tracks: makeDataTool(sb, ctx, "playlist_top_tracks_total",
      "Get top tracks in a playlist ranked by total cumulative streams.",
      z.object({
        playlist_key: z.string().optional().describe("Playlist key (use 'all_catalog' for entire catalog)"),
        playlist_query: z.string().optional().describe("Search for playlist by name if you don't have the key"),
        run_date: z.string().optional().describe("Date YYYY-MM-DD (defaults to latest)"),
        limit_rows: z.number().int().min(1).max(100).optional().describe("Max tracks to return (default 25)"),
      }),
    ),

    search_docs: tool({
      description:
        "Search SBase product documentation. Use for 'how do I...', feature explanations, settings questions — NOT for stream numbers.",
      inputSchema: z.object({
        query: z.string().min(1).describe("What to look up in the docs"),
        max_chunks: z.number().int().min(1).max(8).optional().describe("Number of doc sections (default 5)"),
      }),
      execute: async ({ query, max_chunks }) => {
        const r = await retrieveDocs(query, { maxChunks: max_chunks ?? 5 });
        mergeDocCitations(ctx.citations, r.citations);
        ctx.toolCalls.push({
          tool: "search_docs",
          params: { query, max_chunks: max_chunks ?? 5, method: r.method },
          rowCount: r.citations.length,
          notes: `confidence=${r.confidence}`,
        });
        ctx.retrievalOverride = { method: r.method, confidence: r.confidence };

        if (!r.contextText) {
          return { found: false, message: "No matching documentation sections." };
        }
        return {
          found: true,
          method: r.method,
          confidence: r.confidence,
          chunk_ids: r.citations.map((c) => c.chunkId),
          titles: r.citations.map((c) => c.title),
          excerpt: r.contextText.slice(0, 12000),
        };
      },
    }),
  };
}

export function createSaiTurnContext(): SaiTurnContext {
  return { citations: [], toolCalls: [], warnings: [] };
}

export function streamSaiChat(opts: {
  supabase: SupabaseClient;
  envelope: SaiEnvelope;
  /** Prior turns only; do not include the latest user message here. */
  history: ModelMessage[];
  userMessage: string;
  ctx: SaiTurnContext;
  /** Client-chosen model id, e.g. "gpt-4.1" or "google/gemini-2.5-pro-preview". */
  modelOverride?: string;
}) {
  const { supabase, envelope, history, userMessage, ctx } = opts;

  const modelId = opts.modelOverride || defaultModelId();
  const provider = resolveProvider(modelId);
  const openai = createOpenAI(provider);
  const model = openai(modelId);

  const tools = createSaiTools(supabase, ctx);

  const messages: ModelMessage[] = [
    ...history,
    { role: "user", content: userMessage },
  ];

  return streamText({
    model,
    system: buildSystemPrompt(envelope),
    messages,
    tools,
    stopWhen: stepCountIs(6),
    temperature: 0,
    maxRetries: 1,
    onError: ({ error }) => {
      const msg = error instanceof Error ? error.message : String(error);
      ctx.warnings.push(`streamText error: ${msg}`);
    },
  });
}
