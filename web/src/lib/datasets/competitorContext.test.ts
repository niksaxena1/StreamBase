import { describe, expect, it } from "vitest";

import { resolveCompetitorLabelKey } from "@/lib/competitorContext";

const labels = [
  { label_key: "paraiso", display_name: "Paraíso" },
  { label_key: "soave", display_name: "Soave" },
];

describe("resolveCompetitorLabelKey", () => {
  it("keeps a saved active competitor", () => {
    expect(resolveCompetitorLabelKey("soave", labels)).toBe("soave");
  });

  it("falls back to the first active competitor", () => {
    expect(resolveCompetitorLabelKey("missing", labels)).toBe("paraiso");
  });
});
