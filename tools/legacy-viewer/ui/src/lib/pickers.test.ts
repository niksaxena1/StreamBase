import { describe, expect, it } from "vitest";
import {
  artistOption,
  buildTrackOptions,
  fold,
  rankOptions,
  type PickerTrack,
} from "./pickers";

const track = (
  isrc: string,
  song_name: string,
  artist = "Joongle",
  first_day = "2024-01-17",
): PickerTrack => ({ isrc, song_name, artist, first_day, art: `art/tracks/${isrc}.jpg` });

describe("track picker options", () => {
  it("sorts alphabetically by title, ignoring case and accents", () => {
    const options = buildTrackOptions([
      track("3", "zebra"),
      track("2", "Élan"),
      track("1", "...Baby One More Time"),
      track("5", "apple"),
      track("4", "Eagle"),
      track("6", "Dreams"),
    ]);
    expect(options.map((o) => o.primary)).toEqual([
      "...Baby One More Time",
      "apple",
      "Dreams",
      "Eagle",
      "Élan",
      "zebra",
    ]);
  });
  it("shows the title only unless titles collide", () => {
    const options = buildTrackOptions([
      track("1", "Dreams", "Joongle", "2023-07-08"),
      track("2", "Stars", "Joongle", "2024-01-01"),
    ]);
    expect(options.map((o) => [o.label, o.primary, o.secondary, o.trailing])).toEqual([
      ["Dreams", "Dreams", undefined, undefined],
      ["Stars", "Stars", undefined, undefined],
    ]);
    expect(options[0].thumb).toEqual({ src: "art/tracks/1.jpg", name: "Dreams", shape: "square" });
  });
  it("disambiguates same titles by the differing artist credit", () => {
    const options = buildTrackOptions([
      track("2", "Dreams", "Joongle, Sam", "2024-02-02"),
      track("1", "dreams", "Joongle", "2023-07-08"),
    ]);
    expect(new Map(options.map((o) => [o.value, o.secondary]))).toEqual(
      new Map([
        ["1", "Joongle"],
        ["2", "Joongle, Sam"],
      ]),
    );
  });
  it("falls back to first seen year, then date, then ISRC", () => {
    const byYear = buildTrackOptions([
      track("1", "Dreams", "Joongle", "2023-07-08"),
      track("2", "Dreams", "Joongle", "2025-01-02"),
    ]);
    expect(byYear.map((o) => o.secondary)).toEqual(["first seen 2023", "first seen 2025"]);
    const byDate = buildTrackOptions([
      track("1", "Dreams", "Joongle", "2023-07-08"),
      track("2", "Dreams", "Joongle", "2023-09-30"),
    ]);
    expect(byDate.map((o) => o.secondary)).toEqual(["first seen 8 Jul 2023", "first seen 30 Sep 2023"]);
    const byIsrc = buildTrackOptions([
      track("B", "Dreams", "Joongle", "2023-07-08"),
      track("A", "Dreams", "Joongle", "2023-07-08"),
    ]);
    expect(byIsrc.map((o) => [o.value, o.secondary])).toEqual([["A", "A"], ["B", "B"]]);
  });
  it("only annotates the colliding group", () => {
    const options = buildTrackOptions([
      track("1", "Dreams", "Joongle", "2023-07-08"),
      track("2", "Dreams", "Joongle, Sam", "2024-02-02"),
      track("3", "Unique"),
    ]);
    expect(options.find((o) => o.value === "3")?.secondary).toBeUndefined();
  });
});

describe("type-ahead ranking", () => {
  const options = [
    { label: "Stardust" },
    { label: "A Sky Full of Stars" },
    { label: "Star Boy" },
    { label: "Élan" },
    { label: "Zero" },
  ];
  it("matches accent- and case-insensitively, prefix matches first", () => {
    expect(rankOptions(options, "STAR").map((o) => o.label)).toEqual([
      "Stardust",
      "Star Boy",
      "A Sky Full of Stars",
    ]);
    expect(rankOptions(options, "elan").map((o) => o.label)).toEqual(["Élan"]);
  });
  it("returns everything for an empty query and can reorder without dropping", () => {
    expect(rankOptions(options, "  ")).toHaveLength(5);
    expect(rankOptions(options, "star", false).map((o) => o.label)).toEqual([
      "Stardust",
      "Star Boy",
      "A Sky Full of Stars",
      "Élan",
      "Zero",
    ]);
  });
  it("always keeps pinned options such as All artists first", () => {
    const pinned = [{ label: "All artists", keep: true }, ...options];
    expect(rankOptions(pinned, "zero")[0].label).toBe("All artists");
  });
  it("folds stroked letters like the API", () => {
    expect(fold("Nøway ŁÓDŹ")).toBe("noway lodz");
  });
});

describe("artist picker option", () => {
  it("has a round photo, the name, and the track count right-aligned", () => {
    expect(artistOption({ name: "Joongle", track_count: 260, art: "art/artists/x.jpg" })).toEqual({
      value: "Joongle",
      label: "Joongle",
      thumb: { src: "art/artists/x.jpg", name: "Joongle", shape: "round" },
      primary: "Joongle",
      trailing: "260",
      trailingLabel: "260 tracks",
    });
    expect(artistOption({ name: "Solo", track_count: 1 }).trailingLabel).toBe("1 track");
  });
});
