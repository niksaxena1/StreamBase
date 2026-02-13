import { describe, it, expect } from "vitest";
import { patchSearchParams, hrefWithPatchedSearchParams } from "./searchParams";

// ---------------------------------------------------------------------------
// patchSearchParams
// ---------------------------------------------------------------------------

describe("patchSearchParams", () => {
  it("sets new params", () => {
    const result = patchSearchParams("", { artist: "abc123", tab: "tracks" });
    expect(result.get("artist")).toBe("abc123");
    expect(result.get("tab")).toBe("tracks");
  });

  it("updates existing params", () => {
    const result = patchSearchParams("artist=old&tab=tracks", { artist: "new" });
    expect(result.get("artist")).toBe("new");
    expect(result.get("tab")).toBe("tracks");
  });

  it("deletes params set to null", () => {
    const result = patchSearchParams("artist=abc&tab=tracks", { artist: null });
    expect(result.has("artist")).toBe(false);
    expect(result.get("tab")).toBe("tracks");
  });

  it("deletes params set to undefined", () => {
    const result = patchSearchParams("artist=abc", { artist: undefined });
    expect(result.has("artist")).toBe(false);
  });

  it("deletes params set to empty string", () => {
    const result = patchSearchParams("artist=abc", { artist: "" });
    expect(result.has("artist")).toBe(false);
  });

  it("accepts SearchParamsLike objects", () => {
    const existing = new URLSearchParams("foo=bar");
    const result = patchSearchParams(existing, { baz: "qux" });
    expect(result.get("foo")).toBe("bar");
    expect(result.get("baz")).toBe("qux");
  });
});

// ---------------------------------------------------------------------------
// hrefWithPatchedSearchParams
// ---------------------------------------------------------------------------

describe("hrefWithPatchedSearchParams", () => {
  it("returns prefixed search string", () => {
    const result = hrefWithPatchedSearchParams("", { tab: "artists" });
    expect(result).toBe("?tab=artists");
  });

  it("uses custom prefix", () => {
    const result = hrefWithPatchedSearchParams("", { tab: "artists" }, { prefix: "#" });
    expect(result).toBe("#tab=artists");
  });

  it("preserves existing params while patching", () => {
    const result = hrefWithPatchedSearchParams("a=1&b=2", { b: "3", c: "4" });
    expect(result).toContain("a=1");
    expect(result).toContain("b=3");
    expect(result).toContain("c=4");
  });
});
