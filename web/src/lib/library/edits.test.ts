import { describe, expect, it } from "vitest";

import {
  buildNewReleaseFields,
  buildTrackChanges,
  draftFromRow,
  validateChanges,
  validateDraft,
  validateNewRelease,
} from "./edits";
import { makeRow } from "./testRows";

const base = makeRow({
  catalog_id: "TG-00001",
  entity: "tg",
  release_date: "2026-03-01",
  sheet_artist: "Kyden",
  sheet_title: "Fast",
  distributor_account: "TG1 Amuse",
  isrc: "USABC2600001",
  upc: "012345678905",
  comment_1: "ok",
});

describe("buildTrackChanges", () => {
  it("sends nothing when nothing changed", () => {
    expect(buildTrackChanges(base, draftFromRow(base))).toEqual({});
  });

  it("sends only the changed keys", () => {
    const draft = { ...draftFromRow(base), sheet_title: "Faster", comment_1: "ok", genre: "House" };
    expect(buildTrackChanges(base, draft)).toEqual({ sheet_title: "Faster", genre: "House" });
  });

  it("trims text and ignores whitespace-only edits", () => {
    expect(buildTrackChanges(base, { ...draftFromRow(base), sheet_title: "  Fast  " })).toEqual({});
    expect(buildTrackChanges(base, { ...draftFromRow(base), sheet_title: "  Faster " })).toEqual({ sheet_title: "Faster" });
  });

  it("turns cleared text into null", () => {
    expect(buildTrackChanges(base, { ...draftFromRow(base), comment_1: "" })).toEqual({ comment_1: null });
  });

  it("treats null and empty as the same", () => {
    expect(buildTrackChanges(base, { ...draftFromRow(base), comment_2: "" })).toEqual({});
    expect(buildTrackChanges(base, { ...draftFromRow(base), comment_2: "   " })).toEqual({});
  });

  it("handles the release date, including clearing it", () => {
    expect(buildTrackChanges(base, { ...draftFromRow(base), release_date: "2026-04-02" })).toEqual({
      release_date: "2026-04-02",
    });
    expect(buildTrackChanges(base, { ...draftFromRow(base), release_date: "" })).toEqual({ release_date: null });
  });

  it("handles the distributor, including clearing it", () => {
    expect(buildTrackChanges(base, { ...draftFromRow(base), distributor_account: "TG2 Amuse" })).toEqual({
      distributor_account: "TG2 Amuse",
    });
    expect(buildTrackChanges(base, { ...draftFromRow(base), distributor_account: "" })).toEqual({
      distributor_account: null,
    });
  });

  it("handles entity and the splice checkbox", () => {
    expect(buildTrackChanges(base, { ...draftFromRow(base), entity: "p", non_exclusive_samples: true })).toEqual({
      entity: "p",
      non_exclusive_samples: true,
    });
  });

  it("normalises ISRC / UPC before comparing", () => {
    expect(buildTrackChanges(base, { ...draftFromRow(base), isrc: "us-abc-26-00001" })).toEqual({});
    expect(buildTrackChanges(base, { ...draftFromRow(base), upc: "0123 4567 8905" })).toEqual({});
    expect(buildTrackChanges(base, { ...draftFromRow(base), isrc: "us-abc-26-00002" })).toEqual({ isrc: "USABC2600002" });
    expect(buildTrackChanges(base, { ...draftFromRow(base), upc: "012345678912" })).toEqual({ upc: "012345678912" });
  });

  it('clears ISRC / UPC with an empty string, as the RPC expects', () => {
    expect(buildTrackChanges(base, { ...draftFromRow(base), isrc: "", upc: "" })).toEqual({ isrc: "", upc: "" });
  });

  it("does not send an ISRC when the row had none and the field is still empty", () => {
    const bare = makeRow();
    expect(buildTrackChanges(bare, draftFromRow(bare))).toEqual({});
  });
});

describe("validateDraft", () => {
  it("passes a clean draft", () => {
    expect(validateDraft(draftFromRow(base), base)).toEqual({});
  });

  it("flags a bad date, ISRC and UPC", () => {
    const errors = validateDraft({ ...draftFromRow(base), release_date: "2026-02-31", isrc: "abc", upc: "12" }, base);
    expect(Object.keys(errors).sort()).toEqual(["isrc", "release_date", "upc"]);
  });

  it("accepts an ISRC written with dashes and lowercase", () => {
    expect(validateDraft({ ...draftFromRow(base), isrc: "us-abc-26-00123" }, base)).toEqual({});
  });

  it("requires artist and title only if the saved row had them", () => {
    expect(validateDraft({ ...draftFromRow(base), sheet_artist: " " }, base).sheet_artist).toBeTruthy();
    const noArtist = makeRow({ sheet_artist: null });
    expect(validateDraft(draftFromRow(noArtist), noArtist).sheet_artist).toBeUndefined();
  });
});

describe("new release", () => {
  const draft = {
    entity: "tg",
    sheet_artist: " Kyden ",
    sheet_title: "Fast",
    release_date: "",
    distributor_account: "",
  };

  it("builds fields from the filled-in values only", () => {
    expect(buildNewReleaseFields(draft)).toEqual({ sheet_artist: "Kyden", sheet_title: "Fast" });
    expect(buildNewReleaseFields({ ...draft, release_date: "2026-12-01", distributor_account: "TG1 Amuse" })).toEqual({
      sheet_artist: "Kyden",
      sheet_title: "Fast",
      release_date: "2026-12-01",
      distributor_account: "TG1 Amuse",
    });
  });

  it("requires entity, artist and title and checks the date", () => {
    expect(validateNewRelease(draft)).toEqual({});
    const errors = validateNewRelease({ ...draft, entity: "", sheet_artist: "", sheet_title: " ", release_date: "x" });
    expect(Object.keys(errors).sort()).toEqual(["entity", "release_date", "sheet_artist", "sheet_title"]);
  });
});

describe("validateChanges (server side)", () => {
  it("accepts known keys and normalises codes", () => {
    const res = validateChanges({ sheet_title: "Faster", isrc: "us-abc-26-00123", upc: "", non_exclusive_samples: true });
    expect(res).toEqual({
      ok: true,
      changes: { sheet_title: "Faster", isrc: "USABC2600123", upc: "", non_exclusive_samples: true },
    });
  });

  it("rejects unknown keys", () => {
    expect(validateChanges({ catalog_id: "X" })).toEqual({ ok: false, error: 'Can\'t edit "catalog_id"' });
  });

  it("rejects wrong value types", () => {
    expect(validateChanges({ sheet_title: 5 }).ok).toBe(false);
    expect(validateChanges({ non_exclusive_samples: "yes" }).ok).toBe(false);
  });

  it("rejects bad dates and codes", () => {
    expect(validateChanges({ release_date: "2026-02-30" }).ok).toBe(false);
    expect(validateChanges({ isrc: "nope" }).ok).toBe(false);
    expect(validateChanges({ upc: "123" }).ok).toBe(false);
    expect(validateChanges({ entity: "" }).ok).toBe(false);
  });

  it("allows clearing a date", () => {
    expect(validateChanges({ release_date: null })).toEqual({ ok: true, changes: { release_date: null } });
  });

  it("rejects empty or non-object input", () => {
    expect(validateChanges({}).ok).toBe(false);
    expect(validateChanges(null).ok).toBe(false);
    expect(validateChanges([]).ok).toBe(false);
  });
});
