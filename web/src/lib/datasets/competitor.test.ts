import { describe, expect, it } from "vitest";

import { datasetSchemaForMode, navItemsForMode } from "@/lib/datasets";

describe("dataset helpers", () => {
  it("uses competitor schema in competitor mode", () => {
    expect(datasetSchemaForMode("competitor")).toBe("competitor");
  });

  it("uses public schema in own mode", () => {
    expect(datasetSchemaForMode("own")).toBe("public");
  });

  it("hides collectors in competitor mode", () => {
    const items = [
      { href: "/", label: "Home" },
      { href: "/collectors", label: "Collectors" },
    ];
    expect(navItemsForMode("competitor", items).some((i) => i.href === "/collectors")).toBe(false);
  });
});
