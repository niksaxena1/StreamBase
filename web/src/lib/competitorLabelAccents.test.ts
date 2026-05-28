import { describe, expect, it } from "vitest";

import { accentColorDistance } from "@/lib/competitorAccentPalette";

import {
  applyResolvedLabelAccents,
  buildResolvedAccentMap,
  PINNED_LABEL_ACCENTS,
} from "./competitorLabelAccents";

describe("competitorLabelAccents", () => {
  it("separates ATLAST from selected. when stored reds are too close", () => {
    const resolved = applyResolvedLabelAccents([
      { label_key: "atlast", accent_hex: "fd0280" },
      { label_key: "selected", accent_hex: "db0c0c" },
    ]);
    const atlast = resolved.find((l) => l.label_key === "atlast")!.accent_hex!;
    const selected = resolved.find((l) => l.label_key === "selected")!.accent_hex!;
    expect(accentColorDistance(atlast, selected)).toBeGreaterThanOrEqual(0.33);
    expect(selected).toBe(PINNED_LABEL_ACCENTS.selected);
    expect(atlast).not.toBe("fd0280");
  });

  it("keeps pinned paraiso orange stable across harmonize", () => {
    const resolved = applyResolvedLabelAccents([
      { label_key: "atlast", accent_hex: "ff00b3" },
      { label_key: "paraiso", accent_hex: "fc6244" },
      { label_key: "soave", accent_hex: "cc8233" },
    ]);
    expect(resolved.find((l) => l.label_key === "paraiso")?.accent_hex).toBe("ff9028");
  });

  it("keeps pinned soave tan-gold stable across harmonize", () => {
    const resolved = applyResolvedLabelAccents([
      { label_key: "paraiso", accent_hex: "ff9028" },
      { label_key: "soave", accent_hex: "cc8233" },
    ]);
    expect(resolved.find((l) => l.label_key === "soave")?.accent_hex).toBe("b98a46");
  });

  it("is idempotent when accents are already resolved", () => {
    const input = [
      { label_key: "atlast", accent_hex: "ff00b3" },
      { label_key: "selected", accent_hex: "db0c0c" },
    ];
    const once = applyResolvedLabelAccents(input);
    const twice = applyResolvedLabelAccents(once);
    expect(twice).toEqual(once);
  });

  it("buildResolvedAccentMap matches applyResolvedLabelAccents", () => {
    const labels = [
      { label_key: "atlast", accent_hex: "fd0280" },
      { label_key: "selected", accent_hex: "db0c0c" },
    ];
    const map = buildResolvedAccentMap(labels);
    const applied = applyResolvedLabelAccents(labels);
    expect(map.get("atlast")).toBe(applied[0]!.accent_hex);
    expect(map.get("selected")).toBe(applied[1]!.accent_hex);
  });
});
