import { describe, expect, it } from "vitest";

import { parseBulkIsrcInput } from "./bulkIsrc";

describe("parseBulkIsrcInput", () => {
  it("normalizes pasted newline, comma, tab, and space separated ISRCs", () => {
    expect(parseBulkIsrcInput(" se5bu2515517,\nSE6XY2585663\tSE6XY2574698 ")).toEqual({
      isrcs: ["SE5BU2515517", "SE6XY2585663", "SE6XY2574698"],
      duplicateCount: 0,
    });
  });

  it("removes duplicates while preserving the first-seen order", () => {
    expect(parseBulkIsrcInput("SE5BU2515517 se5bu2515517 SE6XY2585663")).toEqual({
      isrcs: ["SE5BU2515517", "SE6XY2585663"],
      duplicateCount: 1,
    });
  });
});
