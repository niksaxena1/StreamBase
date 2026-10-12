import { afterEach, describe, expect, it, vi } from "vitest";

import { CATALOG_ENV_VARS, catalogConfigured, catalogService } from "./catalogService";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("catalogConfigured", () => {
  it("is false when the env vars are missing", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(catalogConfigured()).toBe(false);
    expect(() => catalogService()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("is false when only one is set", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "  ");
    expect(catalogConfigured()).toBe(false);
  });

  it("is true when both are set", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");
    expect(catalogConfigured()).toBe(true);
    expect(() => catalogService()).not.toThrow();
  });

  it("uses the app's own project URL and server-only service key", () => {
    expect([...CATALOG_ENV_VARS]).toEqual(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
    expect(CATALOG_ENV_VARS[1].startsWith("NEXT_PUBLIC_")).toBe(false);
  });
});
