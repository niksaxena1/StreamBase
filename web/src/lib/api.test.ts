import { describe, it, expect } from "vitest";
import {
  isApiSuccess,
  parseApiJsonEnvelope,
  safeJsonParse,
  getField,
  asArray,
  asNumber,
  asString,
  asBool,
} from "./api";
import type { ApiResponse } from "./api";

// ---------------------------------------------------------------------------
// isApiSuccess
// ---------------------------------------------------------------------------

describe("parseApiJsonEnvelope", () => {
  it("returns data for a success envelope", () => {
    expect(parseApiJsonEnvelope<{ a: number }>({ success: true, data: { a: 1 } })).toEqual({ a: 1 });
  });

  it("throws with server error for a failure envelope", () => {
    expect(() => parseApiJsonEnvelope({ success: false, error: "nope" })).toThrow("nope");
  });

  it("throws for a generic failure envelope without error text", () => {
    expect(() => parseApiJsonEnvelope({ success: false })).toThrow("Request failed");
  });

  it("throws for malformed JSON shape", () => {
    expect(() => parseApiJsonEnvelope(null)).toThrow("Invalid API response");
    expect(() => parseApiJsonEnvelope({ foo: 1 })).toThrow("Invalid API response");
  });
});

describe("isApiSuccess", () => {
  it("returns true for success response", () => {
    const response: ApiResponse<string> = { success: true, data: "hello" };
    expect(isApiSuccess(response)).toBe(true);
  });

  it("returns false for error response", () => {
    const response: ApiResponse<string> = { success: false, error: "failed" };
    expect(isApiSuccess(response)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// safeJsonParse
// ---------------------------------------------------------------------------

describe("safeJsonParse", () => {
  it("parses valid JSON", () => {
    expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 });
    expect(safeJsonParse("[1,2,3]")).toEqual([1, 2, 3]);
    expect(safeJsonParse('"hello"')).toBe("hello");
    expect(safeJsonParse("42")).toBe(42);
    expect(safeJsonParse("true")).toBe(true);
    expect(safeJsonParse("null")).toBe(null);
  });

  it("returns null for invalid JSON", () => {
    expect(safeJsonParse("not json")).toBe(null);
    expect(safeJsonParse("{broken}")).toBe(null);
    expect(safeJsonParse("")).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// getField
// ---------------------------------------------------------------------------

describe("getField", () => {
  it("extracts existing field", () => {
    expect(getField<number>({ count: 42 }, "count")).toBe(42);
  });

  it("returns undefined for missing field", () => {
    expect(getField({ count: 42 }, "missing")).toBeUndefined();
  });

  it("returns undefined for non-object", () => {
    expect(getField(null, "key")).toBeUndefined();
    expect(getField(undefined, "key")).toBeUndefined();
    expect(getField("string", "key")).toBeUndefined();
    expect(getField(42, "key")).toBeUndefined();
  });

  it("works with nested values", () => {
    expect(getField<object>({ nested: { a: 1 } }, "nested")).toEqual({ a: 1 });
  });
});

// ---------------------------------------------------------------------------
// asArray
// ---------------------------------------------------------------------------

describe("asArray", () => {
  it("returns the array if value is an array", () => {
    expect(asArray([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("returns empty array for non-array", () => {
    expect(asArray(null)).toEqual([]);
    expect(asArray(undefined)).toEqual([]);
    expect(asArray("string")).toEqual([]);
    expect(asArray(42)).toEqual([]);
    expect(asArray({})).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// asNumber
// ---------------------------------------------------------------------------

describe("asNumber", () => {
  it("returns number for numeric values", () => {
    expect(asNumber(42)).toBe(42);
    expect(asNumber("100")).toBe(100);
    expect(asNumber(0)).toBe(0);
    expect(asNumber(-5.5)).toBe(-5.5);
  });

  it("returns fallback for non-numeric", () => {
    expect(asNumber("hello")).toBe(0);
    expect(asNumber(null)).toBe(0);
    expect(asNumber(undefined)).toBe(0);
    expect(asNumber(NaN)).toBe(0);
    expect(asNumber(Infinity)).toBe(0);
  });

  it("uses custom fallback for non-numeric strings", () => {
    expect(asNumber("hello", -1)).toBe(-1);
  });

  it("converts null to 0 (Number(null) is finite)", () => {
    // Number(null) === 0, which is finite, so fallback is NOT used
    expect(asNumber(null)).toBe(0);
    expect(asNumber(null, 99)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// asString
// ---------------------------------------------------------------------------

describe("asString", () => {
  it("returns string values", () => {
    expect(asString("hello")).toBe("hello");
    expect(asString("")).toBe("");
  });

  it("returns fallback for non-string", () => {
    expect(asString(42)).toBe("");
    expect(asString(null)).toBe("");
    expect(asString(undefined)).toBe("");
    expect(asString(true)).toBe("");
    expect(asString({})).toBe("");
  });

  it("uses custom fallback", () => {
    expect(asString(null, "default")).toBe("default");
  });
});

// ---------------------------------------------------------------------------
// asBool
// ---------------------------------------------------------------------------

describe("asBool", () => {
  it("returns boolean values directly", () => {
    expect(asBool(true)).toBe(true);
    expect(asBool(false)).toBe(false);
  });

  it("converts truthy string/number values", () => {
    expect(asBool("true")).toBe(true);
    expect(asBool("1")).toBe(true);
    expect(asBool(1)).toBe(true);
  });

  it("returns false for other values", () => {
    expect(asBool("false")).toBe(false);
    expect(asBool("0")).toBe(false);
    expect(asBool(0)).toBe(false);
    expect(asBool(null)).toBe(false);
    expect(asBool(undefined)).toBe(false);
    expect(asBool("yes")).toBe(false);
    expect(asBool(42)).toBe(false);
  });
});
