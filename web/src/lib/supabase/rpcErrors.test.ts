import { describe, expect, it } from "vitest";

import { isMissingPostgresFunctionError } from "./rpcErrors";

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
