import { describe, expect, it } from "vitest";

import { buildRequestShellContext } from "@/lib/requestAppContext.server";

const ownOnlyAccess = {
  ownCatalog: true,
  competitor: false,
  playlistWatch: false,
  playlistWatchAdmin: false,
};

const competitorAccess = {
  ownCatalog: true,
  competitor: true,
  playlistWatch: false,
  playlistWatchAdmin: false,
};

const labels = [
  {
    label_key: "soave",
    display_name: "Soave",
    image_url: null,
    accent_hex: "b98a46",
  },
];

describe("buildRequestShellContext", () => {
  it("forces own shell context when the user cannot access competitor mode", () => {
    const shell = buildRequestShellContext({
      appAccess: ownOnlyAccess,
      settings: { dataset_mode: "competitor", competitor_label_key: "soave" },
      competitorLabels: labels,
    });

    expect(shell.datasetMode).toBe("own");
    expect(shell.competitorLabels).toEqual([]);
    expect(shell.competitorLabelKey).toBeNull();
  });

  it("uses dataset settings when competitor access is allowed", () => {
    const shell = buildRequestShellContext({
      appAccess: competitorAccess,
      settings: { dataset_mode: "competitor", competitor_label_key: "soave" },
      competitorLabels: labels,
    });

    expect(shell.datasetMode).toBe("competitor");
    expect(shell.competitorLabelKey).toBe("soave");
    expect(shell.competitorDisplayName).toBe("Soave");
  });
});
