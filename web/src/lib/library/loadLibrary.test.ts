import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  cacheKeys: [] as string[],
  onOverviewPage: null as null | (() => void),
  configured: true,
}));

vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logWarn: vi.fn(), logDebug: vi.fn() }));

// Runs the query straight away and records the cache key, like a cold cache.
vi.mock("@/lib/supabase/cache", () => ({
  cachedQuery: async (fn: () => Promise<unknown>, key: string) => {
    state.cacheKeys.push(key);
    try {
      return await fn();
    } catch (error) {
      return { data: null, error: { message: error instanceof Error ? error.message : String(error) } };
    }
  },
}));

vi.mock("@/lib/supabase/catalogService", () => ({
  CATALOG_ENV_VARS: ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
  catalogConfigured: () => state.configured,
  catalogService: () => ({
    from(name: string) {
      let after: string | null = null;
      let max = Infinity;
      const q = {
        select: () => q,
        order: () => q,
        gt: (_col: string, value: string) => {
          after = value;
          return q;
        },
        limit: (n: number) => {
          max = n;
          return q;
        },
        then(resolve: (v: unknown) => void) {
          const rows = [...(state.tables[name] ?? [])]
            .sort((a, b) => String(a.catalog_id ?? a.code ?? a.name).localeCompare(String(b.catalog_id ?? b.code ?? b.name)))
            .filter((r) => after === null || String(r.catalog_id) > after)
            .slice(0, max);
          if (name === "track_overview") state.onOverviewPage?.();
          resolve({ data: rows, error: null });
        },
      };
      return q;
    },
  }),
}));

import { loadLibrary } from "./loadLibrary";

const id = (i: number) => `TG-${String(i * 2).padStart(5, "0")}`;
const overviewRow = (catalog_id: string) => ({ catalog_id, entity: "tg", sheet_artist: "A", sheet_title: "T" });

beforeEach(() => {
  state.cacheKeys = [];
  state.onOverviewPage = null;
  state.configured = true;
  state.tables = {
    track_overview: Array.from({ length: 2400 }, (_, i) => overviewRow(id(i))),
    entities: [{ code: "tg", name: "TG", active: true, catalog_id_prefix: "TG" }],
    distributor_accounts: [{ name: "TG1 Amuse", owner: "x" }],
  };
});

describe("loadLibrary", () => {
  it("reports a missing connection without touching the database", async () => {
    state.configured = false;
    const res = await loadLibrary();
    expect(res.status).toBe("not_configured");
    expect(state.cacheKeys).toEqual([]);
  });

  it("caches the overview as one entry, so every row is the same age", async () => {
    const res = await loadLibrary();
    expect(res.status).toBe("ok");
    expect(state.cacheKeys.filter((k) => k.startsWith("library-overview"))).toEqual(["library-overview"]);
  });

  it("returns every row once even if a row is inserted between pages", async () => {
    let pages = 0;
    state.onOverviewPage = () => {
      pages++;
      if (pages === 1) state.tables.track_overview.push(overviewRow("TG-00001"));
    };
    const res = await loadLibrary();
    if (res.status !== "ok") throw new Error("expected ok");
    const ids = res.rows.map((r) => r.catalog_id);
    expect(new Set(ids).size).toBe(ids.length);
    for (let i = 0; i < 2400; i++) expect(ids).toContain(id(i));
  });

  it("includes the row at the old page boundary (ID 1000 of 2400)", async () => {
    const res = await loadLibrary();
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.rows).toHaveLength(2400);
    expect(res.rows.map((r) => r.catalog_id)).toContain(id(1000));
  });
});
