import { describe, expect, it } from "vitest";

import { isValidIsrc, isValidUpc, isrcError, normalizeIsrc, normalizeUpc, upcError } from "./codes";

describe("ISRC", () => {
  it("uppercases and strips dashes and spaces", () => {
    expect(normalizeIsrc("us-abc-26-00123")).toBe("USABC2600123");
    expect(normalizeIsrc(" gb xyz 2500010 ")).toBe("GBXYZ2500010");
    expect(normalizeIsrc(null)).toBe("");
  });

  it("accepts the standard shape", () => {
    expect(isValidIsrc("USABC2600123")).toBe(true);
    expect(isValidIsrc("QZ9H82612345")).toBe(true);
  });

  it("rejects bad shapes", () => {
    for (const bad of ["", "USABC260012", "USABC26001234", "1SABC2600123", "USABC26OO123", "usabc2600123"]) {
      expect(isValidIsrc(bad)).toBe(false);
    }
  });

  it("reports an error only for non-empty invalid input", () => {
    expect(isrcError("")).toBeNull();
    expect(isrcError("  ")).toBeNull();
    expect(isrcError("us-abc-26-00123")).toBeNull();
    expect(isrcError("nope")).toMatch(/ISRC/);
  });
});

describe("UPC", () => {
  it("strips dashes and spaces", () => {
    expect(normalizeUpc("0123-4567 8905")).toBe("012345678905");
    expect(normalizeUpc(undefined)).toBe("");
  });

  it("accepts 12 or 13 digits", () => {
    expect(isValidUpc("012345678905")).toBe(true);
    expect(isValidUpc("0123456789012")).toBe(true);
  });

  it("rejects other lengths and non-digits", () => {
    for (const bad of ["", "12345678901", "12345678901234", "01234567890a"]) expect(isValidUpc(bad)).toBe(false);
  });

  it("reports an error only for non-empty invalid input", () => {
    expect(upcError("")).toBeNull();
    expect(upcError("0123 4567 8905")).toBeNull();
    expect(upcError("123")).toMatch(/UPC/);
  });
});
