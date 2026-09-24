import { describe, expect, it } from "vitest";
import { duplicatePlaylistIdWarnings } from "./duplicatePlaylistIds";

const row = (key: string, id: string | null) => ({ playlist_key: key, display_name: key, spotify_playlist_id: id });
describe("duplicatePlaylistIdWarnings", () => {
  it("ignores missing IDs and distinct playlists", () => {
    expect(duplicatePlaylistIdWarnings([row("a", null), row("b", " "), row("c", "x"), row("d", "y")], "2026-09-24")).toEqual([]);
  });
  it("reports one stable warning per shared ID with every affected playlist", () => {
    const warnings = duplicatePlaylistIdWarnings([row("tg", " x "), row("tps", "x"), row("third", "x")], "2026-09-24");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ severity: "warn", code: "duplicate_spotify_playlist_id", run_date: "2026-09-24", details_json: { spotify_playlist_id: "x", playlist_keys: ["tg", "third", "tps"] } });
  });
  it("clears after correction and does not count repeated rows", () => {
    expect(duplicatePlaylistIdWarnings([row("tg", "x"), row("tg", "x"), row("tps", "y")], "2026-09-24")).toEqual([]);
  });
});
