import { describe, expect, it } from "vitest";
import { defaultPlaylistKey, navigationEntryHref } from "./navigationDefaults";

describe("playlist navigation defaults", () => {
  it("opens All Catalog in own mode and preserves remembered own selections", () => {
    expect(defaultPlaylistKey({ datasetMode: "own" })).toBe("all_catalog");
    expect(navigationEntryHref("/playlists", { datasetMode: "own" }, " releases ")).toBe("/playlists?playlist_key=releases");
  });
  it("uses the first ordered playlist in the selected competitor's scope", () => {
    const defaults = { datasetMode: "competitor" as const, competitorLabelKey: "label", playlistKeys: ["second", "first"] };
    expect(defaultPlaylistKey(defaults)).toBe("second");
    expect(defaultPlaylistKey(defaults, "first")).toBe("first");
    expect(defaultPlaylistKey(defaults, "other-label-playlist")).toBe("second");
    expect(defaultPlaylistKey(defaults, "all_catalog")).toBe("second");
  });
  it("keeps an empty competitor scope on its bare entry point", () => {
    expect(navigationEntryHref("/playlists", { datasetMode: "competitor", playlistKeys: [] }, "all_catalog")).toBe("/playlists");
  });
  it("encodes identities and leaves explicit deep links untouched", () => {
    expect(navigationEntryHref("/playlists", { datasetMode: "own" }, "a&b")).toBe("/playlists?playlist_key=a%26b");
    expect(navigationEntryHref("/catalog", { datasetMode: "own" }, null, " artist ")).toBe("/catalog?artist_id=artist");
    expect(navigationEntryHref("/catalog?artist_id=explicit&isrc=track", { datasetMode: "competitor" }, null, "remembered"))
      .toBe("/catalog?artist_id=explicit&isrc=track");
  });
});
