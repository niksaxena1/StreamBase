import { describe, expect, it } from "vitest";
import { formatBucketValue } from "./DailySeriesTooltip";

const streams = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const usd = (n: number) => `$${n.toFixed(2)}`;

describe("formatBucketValue", () => {
  it("rounds averaged stream buckets to whole streams", () => {
    expect(formatBucketValue(150749.1, true, streams)).toBe("150,749");
  });
  it("keeps daily values and currency averages as formatted", () => {
    expect(formatBucketValue(150749.1, false, streams)).toBe("150,749.1");
    expect(formatBucketValue(0.4567, true, usd)).toBe("$0.46");
  });
});
