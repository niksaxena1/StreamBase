import { beforeEach, describe, expect, it, vi } from "vitest";
import type { supabaseService } from "@/lib/supabase/service";
import { loadOwnHealthEvents } from "./loadOwnHealthEvents";
import { loadCompetitorHealthEvents } from "./competitor/loadCompetitorHealthEvents";
import { eventDataDate, eventWindow } from "./events";

vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));

type Query = { schema: string; table: string; filters: Array<[string, ...unknown[]]> };
const window = eventWindow(7, "2026-10-11");
let queries: Query[];
let rpcCalls: Array<{ schema: string; name: string; args: unknown }>;
let rpcError: boolean;

function client() {
  const members = Array.from({ length: 101 }, (_, id) => ({ id, playlist_key: "p", isrc: `ISRC${id}`, valid_from: "2026-10-01", valid_to: id === 0 ? "2026-10-06" : id === 1 ? "2026-10-12" : id === 2 ? "2026-10-13" : null, tracks: null }));
  const from = (schema: string, table: string) => {
    const record: Query = { schema, table, filters: [] };
    queries.push(record);
    const query: Record<string, unknown> = {};
    for (const method of ["select", "gte", "lte", "lt", "or", "order", "in", "eq"]) {
      query[method] = (...args: unknown[]) => { record.filters.push([method, ...args]); return query; };
    }
    query.range = async (start: number, end: number) => {
      let rows: Array<Record<string, unknown>> = table === "playlists" ? [{ playlist_key: "p", display_name: "P", label_key: "label-a", is_active: true }]
        : table === "playlist_memberships" ? members : [];
      for (const [op, key, value] of record.filters) {
        if (typeof key !== "string") continue;
        if (op === "eq") rows = rows.filter((r) => r[key] === value);
        if (op === "in") rows = rows.filter((r) => (value as unknown[]).includes(r[key]));
        if (op === "gte" || op === "lte" || op === "lt") rows = rows.filter((r) => {
          if (r[key] == null) return false;
          const field = String(r[key]); const limit = String(value);
          return op === "gte" ? field >= limit : op === "lte" ? field <= limit : field < limit;
        });
      }
      return { data: rows.slice(start, end + 1), error: null };
    };
    return query;
  };
  const rpc = async (schema: string, name: string, args: unknown) => {
    rpcCalls.push({ schema, name, args });
    return rpcError ? { data: null, error: { message: "RPC unavailable" } } : { data: [], error: null };
  };
  return { from: (table: string) => from("public", table), rpc: (name: string, args: unknown) => rpc("public", name, args),
    schema: (schema: string) => ({ from: (table: string) => from(schema, table), rpc: (name: string, args: unknown) => rpc(schema, name, args) }),
  } as unknown as ReturnType<typeof supabaseService>;
}

beforeEach(() => { queries = []; rpcCalls = []; rpcError = false; });

describe("Health Events RPC dispatch and removal predicates", () => {
  it("calls own totals once and bounds removals by the preceding last-active day", async () => {
    const result = await loadOwnHealthEvents(client(), window);
    expect(result.error).toBeNull();
    expect(rpcCalls).toEqual([{ schema: "public", name: "health_daily_stream_totals", args: { p_start: "2026-09-29", p_end: "2026-10-11" } }]);
    expect(queries.every((q) => q.schema === "public" && !q.table.startsWith("track_daily_streams"))).toBe(true);
    const removalQuery = queries.find((q) => q.table === "playlist_memberships" && q.filters.some(([method, key]) => method === "gte" && key === "valid_to"))!;
    expect(removalQuery.filters).toContainEqual(["gte", "valid_to", "2026-10-06"]);
    expect(removalQuery.filters).toContainEqual(["lte", "valid_to", "2026-10-12"]);
    expect(result.data?.filter((e) => e.type === "playlist_remove").map(eventDataDate)).toEqual(["2026-10-11", "2026-10-05"]);
  });
  it("calls competitor totals once even when discoveries/repairs need multiple batches", async () => {
    const result = await loadCompetitorHealthEvents(client(), window, "label-a");
    expect(result.error).toBeNull();
    expect(queries.filter((q) => q.table === "tracks")).toHaveLength(2);
    expect(rpcCalls).toEqual([{ schema: "competitor", name: "health_daily_stream_totals", args: { p_start: "2026-09-29", p_end: "2026-10-11", p_label_key: "label-a" } }]);
    expect(queries.every((q) => q.schema === "competitor" && !q.table.startsWith("track_daily_streams"))).toBe(true);
    expect(result.data?.filter((e) => e.type === "playlist_remove").map(eventDataDate)).toEqual(["2026-10-11", "2026-10-05"]);
  });
  it("passes NULL for the all-active-labels cohort", async () => {
    await loadCompetitorHealthEvents(client(), window, "__all__");
    expect(rpcCalls[0].args).toMatchObject({ p_label_key: null });
  });
  it("reports missing RPCs rather than falling back to paging snapshots", async () => {
    rpcError = true;
    const result = await loadOwnHealthEvents(client(), window);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe("RPC unavailable");
    expect(rpcCalls).toHaveLength(1);
  });
});
