import { describe, expect, test } from "vitest";

import { getEffectiveCollectorPlaylists, type CollectorPlaylistScopeRow } from "./collectorsUtils";

const playlists: CollectorPlaylistScopeRow[] = [
  {
    playlist_key: "tg_total",
    display_name: "TG Total",
    collector: null,
    spotify_playlist_image_url: "tg-total.jpg",
  },
  {
    playlist_key: "tg_distro_one",
    display_name: "TG Distro One",
    collector: "TG",
    spotify_playlist_image_url: "tg-one.jpg",
  },
  {
    playlist_key: "tg_distro_two",
    display_name: "TG Distro Two",
    collector: "TG",
    spotify_playlist_image_url: "tg-two.jpg",
  },
  {
    playlist_key: "p_total",
    display_name: "P Total",
    collector: null,
    spotify_playlist_image_url: "p-total.jpg",
  },
  {
    playlist_key: "pl_distro",
    display_name: "PL Distro",
    collector: "PL",
    spotify_playlist_image_url: "pl-distro.jpg",
  },
  {
    playlist_key: "a_distro",
    display_name: "A Distro",
    collector: "A",
    spotify_playlist_image_url: "a-distro.jpg",
  },
];

describe("getEffectiveCollectorPlaylists", () => {
  test("keeps assigned playlists when entity playlist totals are disabled", () => {
    expect(getEffectiveCollectorPlaylists(playlists, "TG", false).map((p) => p.playlist_key)).toEqual([
      "tg_distro_one",
      "tg_distro_two",
    ]);
  });

  test("uses the total entity playlists for TG and PL when enabled", () => {
    expect(getEffectiveCollectorPlaylists(playlists, "TG", true).map((p) => p.playlist_key)).toEqual(["tg_total"]);
    expect(getEffectiveCollectorPlaylists(playlists, "PL", true).map((p) => p.playlist_key)).toEqual(["p_total"]);
  });

  test("leaves other collectors on assigned playlists when enabled", () => {
    expect(getEffectiveCollectorPlaylists(playlists, "A", true).map((p) => p.playlist_key)).toEqual(["a_distro"]);
  });
});
