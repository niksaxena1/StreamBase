import type { SupabaseClient } from "@supabase/supabase-js";

import type { SaiToolCall } from "./types";

export type DataQueryTemplateId = "system_stats";

export type DataQueryPlan = {
  templateId: DataQueryTemplateId;
  params: Record<string, unknown>;
};

export type DataQueryResult = {
  toolCall: SaiToolCall;
  payload: unknown;
};

export async function runDataQuery(
  sb: SupabaseClient,
  plan: DataQueryPlan,
): Promise<DataQueryResult> {
  if (plan.templateId === "system_stats") {
    const { data, error } = await sb.rpc("spotibase_system_stats");
    if (error) {
      return {
        toolCall: {
          tool: "data_query",
          templateId: "system_stats",
          params: {},
          rowCount: null,
          notes: `rpc error: ${error.message}`,
        },
        payload: null,
      };
    }
    return {
      toolCall: {
        tool: "data_query",
        templateId: "system_stats",
        params: {},
        rowCount: null,
        notes: "Derived from spotibase_system_stats()",
      },
      payload: data,
    };
  }

  // Exhaustiveness guard
  const neverId: never = plan.templateId;
  throw new Error(`Unknown templateId: ${neverId}`);
}

