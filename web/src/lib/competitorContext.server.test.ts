import { describe, expect, it } from "vitest";

import { ALL_COMPETITORS_KEY } from "@/lib/competitorContext";
import { buildCompetitorShellContext } from "@/lib/competitorContext.server";

const labels = [
  {
    label_key: "atlast",
    display_name: "ATLAST",
    image_url: "https://example.com/atlast.jpg",
    accent_hex: "ff00b3",
  },
  {
    label_key: "soave",
    display_name: "Soave",
    image_url: "https://example.com/soave.jpg",
    accent_hex: "b98a46",
  },
];

describe("buildCompetitorShellContext", () => {
  it("keeps competitor metadata out of the shell when access is disabled", () => {
    expect(
      buildCompetitorShellContext({
        canUseCompetitor: false,
        datasetMode: "competitor",
        savedCompetitorLabelKey: "soave",
        competitorLabels: labels,
      }),
    ).toEqual({
      datasetMode: "own",
      competitorLabels: [],
      competitorLabelKey: null,
      competitorAccentHex: null,
      competitorDisplayName: null,
      titleTemplate: "%s",
    });
  });

  it("keeps labels available in own mode for the competitor switcher", () => {
    const context = buildCompetitorShellContext({
      canUseCompetitor: true,
      datasetMode: "own",
      savedCompetitorLabelKey: null,
      competitorLabels: labels,
    });

    expect(context.datasetMode).toBe("own");
    expect(context.competitorLabels).toHaveLength(2);
    expect(context.competitorLabelKey).toBe(ALL_COMPETITORS_KEY);
    expect(context.titleTemplate).toBe("%s");
  });

  it("resolves selected competitor accent and title in competitor mode", () => {
    const context = buildCompetitorShellContext({
      canUseCompetitor: true,
      datasetMode: "competitor",
      savedCompetitorLabelKey: "soave",
      competitorLabels: labels,
    });

    expect(context.datasetMode).toBe("competitor");
    expect(context.competitorLabelKey).toBe("soave");
    expect(context.competitorAccentHex).toBe("b98a46");
    expect(context.competitorDisplayName).toBe("Soave");
    expect(context.titleTemplate).toBe("%s \u00b7 Soave");
  });
});
