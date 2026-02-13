import { describe, it, expect } from "vitest";
import { isSchemaMissing } from "./schemaMissing";

describe("isSchemaMissing", () => {
  it("returns true for 'Could not find the table'", () => {
    expect(isSchemaMissing({ message: "Could not find the table 'my_table'" })).toBe(true);
  });

  it("returns true for 'schema cache' errors", () => {
    expect(isSchemaMissing({ message: "PostgREST schema cache lookup failed" })).toBe(true);
  });

  it("returns true for 'column' errors", () => {
    expect(isSchemaMissing({ message: "column 'foo' does not exist" })).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isSchemaMissing({ message: "Connection refused" })).toBe(false);
    expect(isSchemaMissing({ message: "timeout" })).toBe(false);
  });

  it("returns false for null/undefined", () => {
    expect(isSchemaMissing(null)).toBe(false);
    expect(isSchemaMissing(undefined)).toBe(false);
  });

  it("returns false for errors without message", () => {
    expect(isSchemaMissing({})).toBe(false);
    expect(isSchemaMissing("string error")).toBe(false);
  });
});
