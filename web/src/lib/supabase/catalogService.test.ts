import { afterEach, describe, expect, it, vi } from "vitest";

import { CATALOG_ENV_VARS, catalogConfigured, catalogService } from "./catalogService";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("catalogConfigured", () => {
  it("is false when the env vars are missing", () => {
    vi.stubEnv("CATALOG_SUPABASE_URL", "");
    vi.stubEnv("CATALOG_SUPABASE_SECRET_KEY", "");
    expect(catalogConfigured()).toBe(false);
    expect(() => catalogService()).toThrow(/CATALOG_SUPABASE_URL/);
  });

  it("is false when only one is set", () => {
    vi.stubEnv("CATALOG_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("CATALOG_SUPABASE_SECRET_KEY", "  ");
    expect(catalogConfigured()).toBe(false);
  });

  it("is true when both are set", () => {
    vi.stubEnv("CATALOG_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("CATALOG_SUPABASE_SECRET_KEY", "test-key");
    expect(catalogConfigured()).toBe(true);
    expect(() => catalogService()).not.toThrow();
  });

  it("uses server-only names", () => {
    expect([...CATALOG_ENV_VARS]).toEqual(["CATALOG_SUPABASE_URL", "CATALOG_SUPABASE_SECRET_KEY"]);
    for (const name of CATALOG_ENV_VARS) expect(name.startsWith("NEXT_PUBLIC_")).toBe(false);
  });
});
