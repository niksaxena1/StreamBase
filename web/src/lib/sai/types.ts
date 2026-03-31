export type SaiRole = "user" | "assistant" | "system" | "tool";

export type SaiEnvelope = {
  route?: {
    pathname?: string;
    search?: Record<string, string>;
  };
  selected?: {
    playlist_key?: string | null;
    artist_id?: string | null;
    isrc?: string | null;
    collector?: string | null;
  };
  ui?: Record<string, unknown>;
};

export type SaiCitation = {
  source: "docs";
  chunkId: string;
  title: string;
  score: number;
  sources?: string[];
};

export type SaiToolCall = {
  tool: string;
  templateId?: string | null;
  params: Record<string, unknown>;
  rowCount?: number | null;
  notes?: string | null;
};

export type SaiAssistantMeta = {
  envelope?: SaiEnvelope;
  retrieval?: { method: "vector" | "lexical"; confidence: "high" | "medium" | "low" } | null;
  citations?: SaiCitation[];
  toolCalls?: SaiToolCall[];
  warnings?: string[];
};

export type SaiStreamEvent =
  | { type: "delta"; text: string }
  | { type: "meta"; meta: Partial<SaiAssistantMeta> }
  | { type: "done"; message: { role: "assistant"; content: string; meta?: SaiAssistantMeta } }
  | { type: "error"; error: string };

/** Mutable accumulator while a single chat turn runs (tools push here). */
export type SaiTurnContext = {
  citations: SaiCitation[];
  toolCalls: SaiToolCall[];
  warnings: string[];
  /** Set by search_docs for assistant meta (last successful retrieval wins). */
  retrievalOverride?: { method: "vector" | "lexical"; confidence: "high" | "medium" | "low" };
};
