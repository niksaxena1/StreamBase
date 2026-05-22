import { describe, expect, it } from "vitest";

import { ALL_COMPETITORS_KEY, resolveCompetitorLabelKey } from "@/lib/competitorContext";

const labels = [
  { label_key: "paraiso", display_name: "Paraíso" },
  { label_key: "soave", display_name: "Soave" },
];

describe("resolveCompetitorLabelKey", () => {
  it("keeps a saved active competitor", () => {
    expect(resolveCompetitorLabelKey("soave", labels)).toBe("soave");
  });

  it("falls back to all competitors", () => {
    expect(resolveCompetitorLabelKey("missing", labels)).toBe(ALL_COMPETITORS_KEY);
  });

  it("keeps the all competitors sentinel", () => {
    expect(resolveCompetitorLabelKey(ALL_COMPETITORS_KEY, labels)).toBe(ALL_COMPETITORS_KEY);
  });
});
