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
    /\blast (7|14|28|30|90) days\b/.test(q);

  const looksLikeHelp =
    /\bhow do i\b/.test(q) ||
    /\bwhere\b/.test(q) ||
    /\bwhat is\b/.test(q) ||
    /\bexplain\b/.test(q) ||
    /\bmeaning\b/.test(q) ||
    /\bdefinition\b/.test(q);

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

