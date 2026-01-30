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
  tool: "data_query";
  templateId: string;
  params: Record<string, unknown>;
  rowCount?: number | null;
  notes?: string | null;
};

export type SaiAssistantMeta = {
  envelope?: SaiEnvelope;
  plan?: unknown;
  citations?: SaiCitation[];
  toolCalls?: SaiToolCall[];
  warnings?: string[];
};

export type SaiStreamEvent =
  | { type: "delta"; text: string }
  | { type: "meta"; meta: Partial<SaiAssistantMeta> }
  | { type: "done"; message: { role: "assistant"; content: string; meta?: SaiAssistantMeta } }
  | { type: "error"; error: string };

