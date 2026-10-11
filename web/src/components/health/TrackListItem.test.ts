import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TrackListItem } from "./TrackListItem";

vi.mock("@/components/shell/RouteLink", () => ({ default: "a" }));
vi.mock("@/components/ui/PreviewableArtwork", () => ({ PreviewableArtwork: "img" }));

describe("Health track placeholder status", () => {
  it.each([{}, { dense: true }, { compact: true }])("shows absence in every row layout (%s)", (layout) => {
    const html = renderToStaticMarkup(createElement(TrackListItem, {
      ...layout,
      track: { isrc: "REMOVED", name: "Removed track", spotify_not_found_since: "2026-10-01T00:00:00Z" },
    }));
    expect(html).toContain("Not on Spotify");
    expect(html).toContain("since 2026-10-01; rechecked monthly");
  });

  it("does not label an ordinary missing thumbnail", () => {
    const html = renderToStaticMarkup(createElement(TrackListItem, {
      track: { isrc: "PENDING", name: "Pending track" },
    }));
    expect(html).not.toContain("Not on Spotify");
  });

  it("hides the badge when a thumbnail override supplies artwork", () => {
    const html = renderToStaticMarkup(createElement(TrackListItem, {
      track: { isrc: "REMOVED", name: "Removed track", spotify_not_found_since: "2026-10-01" },
      thumbOverrides: { REMOVED: "https://example.invalid/artwork.jpg" },
    }));
    expect(html).not.toContain("Not on Spotify");
  });
});
