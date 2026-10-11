import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { SpotifyNotFoundBadge } from "./SpotifyNotFoundBadge";

describe("Spotify not-found badge", () => {
  it("renders a neutral label and dated tooltip for a confirmed missing thumbnail", () => {
    const html = renderToStaticMarkup(createElement(SpotifyNotFoundBadge, {
      since: "2026-10-11T16:30:00Z", imageUrl: null,
    }));
    expect(html).toContain("Not on Spotify");
    expect(html).toContain("Spotify has no track for this ISRC since 2026-10-11; rechecked monthly");
    expect(html).toContain("sb-ring");
  });

  it.each([undefined, null, ""])("stays hidden without a confirmed absence (%s)", (since) => {
    expect(renderToStaticMarkup(createElement(SpotifyNotFoundBadge, { since }))).toBe("");
  });

  it("stays hidden when artwork is available", () => {
    expect(renderToStaticMarkup(createElement(SpotifyNotFoundBadge, {
      since: "2026-10-11T16:30:00Z", imageUrl: "https://example.invalid/cover.jpg",
    }))).toBe("");
  });
});
