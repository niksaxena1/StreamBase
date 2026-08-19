import { describe, expect, it } from "vitest";

import { isMissingPostgresFunctionError, queryErrorMessage } from "./rpcErrors";

describe("isMissingPostgresFunctionError", () => {
  it("detects native Postgres undefined-function errors", () => {
    expect(isMissingPostgresFunctionError({ code: "42883", message: "function public.foo() does not exist" })).toBe(true);
  });

  it("detects PostgREST schema-cache function misses", () => {
    expect(
      isMissingPostgresFunctionError({
        code: "PGRST202",
        message: "Could not find the function public.catalog_artist_series_fast in the schema cache",
      }),
    ).toBe(true);
  });

  it("does not hide ordinary query errors", () => {
    expect(isMissingPostgresFunctionError({ code: "23505", message: "duplicate key value violates unique constraint" })).toBe(false);
  });
});

describe("queryErrorMessage", () => {
  it("reads message from PostgREST-style plain objects", () => {
    expect(
      queryErrorMessage({
        code: "PGRST202",
        message: "Could not find the function public.catalog_config_artist_rows",
      }),
    ).toBe("Could not find the function public.catalog_config_artist_rows");
  });

  it("falls back for Error instances", () => {
    expect(queryErrorMessage(new Error("boom"))).toBe("boom");
  });
});
