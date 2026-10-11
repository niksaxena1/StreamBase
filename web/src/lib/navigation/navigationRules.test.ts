import { describe, expect, it } from "vitest";
import { isRouteDestination, shouldStartLinkNavigation } from "./navigationRules";

const current = "https://fixture.invalid/catalog?artist_id=a";
describe("actual route navigation feedback and intent prefetch", () => {
  it("accepts pathname and query-only navigation", () => {
    expect(shouldStartLinkNavigation("/playlists", current)).toBe(true);
    expect(shouldStartLinkNavigation("?artist_id=b", current)).toBe(true);
  });
  it("skips API, downloads, exports, same URLs, fragments, and external destinations", () => {
    for (const href of ["/api/export", "/api", "/export/tracks", "/downloads/export.csv", "/tracks.csv", "#chart", "?artist_id=a#chart", current, "https://other.invalid/catalog", "mailto:user@example.org", "http://["]) {
      expect(isRouteDestination(href, current), href).toBe(false);
    }
  });
  it("skips modified, non-primary, and prevented clicks", () => {
    for (const click of [{ defaultPrevented: true }, { button: 1 }, { button: 2 }, { metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }]) {
      expect(shouldStartLinkNavigation("/playlists", current, click)).toBe(false);
    }
  });
  it("skips download attributes, new targets, and opted-out anchors", () => {
    for (const anchor of [{ download: true }, { target: "_blank" }, { disabled: true }]) {
      expect(shouldStartLinkNavigation("/playlists", current, {}, anchor)).toBe(false);
    }
    expect(shouldStartLinkNavigation("/playlists", current, {}, { target: "_self" })).toBe(true);
  });
});
