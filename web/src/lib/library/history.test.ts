import { describe, expect, it } from "vitest";

import { describeValue, diffChangeLog, fieldLabel } from "./history";

describe("describeValue", () => {
  it("shows blanks as a dash", () => {
    expect(describeValue(null)).toBe("—");
    expect(describeValue(undefined)).toBe("—");
    expect(describeValue("")).toBe("—");
    expect(describeValue([])).toBe("—");
  });

  it("formats booleans, numbers, arrays and objects", () => {
    expect(describeValue(true)).toBe("yes");
    expect(describeValue(false)).toBe("no");
    expect(describeValue(3)).toBe("3");
    expect(describeValue(["a", "b"])).toBe("a, b");
    expect(describeValue({ a: 1 })).toBe('{"a":1}');
  });
});

describe("diffChangeLog", () => {
  it("lists only the keys that changed", () => {
    const changes = diffChangeLog(
      { sheet_title: "Fast", genre: "House", isrc: "A" },
      { sheet_title: "Faster", genre: "House", isrc: "A" },
    );
    expect(changes).toEqual([{ field: "sheet_title", before: "Fast", after: "Faster" }]);
  });

  it("shows added and removed values", () => {
    const changes = diffChangeLog({ comment_1: "old" }, { comment_1: null, genre: "Techno" });
    expect(changes).toEqual([
      { field: "comment_1", before: "old", after: "—" },
      { field: "genre", before: "—", after: "Techno" },
    ]);
  });

  it("lists every after-key when there is no before (new track)", () => {
    expect(diffChangeLog(null, { sheet_title: "Fast", non_exclusive_samples: true })).toEqual([
      { field: "sheet_title", before: "—", after: "Fast" },
      { field: "non_exclusive_samples", before: "—", after: "yes" },
    ]);
  });

  it("returns nothing for identical or non-object input", () => {
    expect(diffChangeLog({ a: 1 }, { a: 1 })).toEqual([]);
    expect(diffChangeLog(null, null)).toEqual([]);
    expect(diffChangeLog("x", [1])).toEqual([]);
  });

  it("treats a missing key and a null value as the same", () => {
    expect(diffChangeLog({ a: null }, {})).toEqual([]);
  });
});

describe("fieldLabel", () => {
  it("uses readable labels", () => {
    expect(fieldLabel("sheet_artist")).toBe("Artist");
    expect(fieldLabel("non_exclusive_samples")).toBe("Splice samples");
    expect(fieldLabel("some_other_key")).toBe("some other key");
  });
});
