import { describe, expect, it } from "vitest";

import { groupFiles, roleLabel, totalBytes } from "./files";
import type { LibraryFile } from "./types";

function file(role: string, rel_path: string, extra: Partial<LibraryFile> = {}): LibraryFile {
  return {
    id: rel_path,
    catalog_id: "TG-00001",
    rel_path,
    role,
    m_version: null,
    bytes: null,
    duration_s: null,
    sample_rate: null,
    bit_depth: null,
    channels: null,
    width: null,
    height: null,
    dropbox_path: null,
    ...extra,
  };
}

describe("groupFiles", () => {
  const files = [
    file("stem", "stems/kick.wav", { bytes: 1000 }),
    file("alt_version", "fast_alt.wav"),
    file("master", "fast_M2.wav"),
    file("final_artwork", "cover.jpg"),
    file("artwork_source", "cover.psd"),
    file("image_other", "promo.png"),
    file("contract_signed", "contract_signed.pdf"),
    file("splice_certificate", "splice.pdf"),
    file("stem", "stems/bass.wav", { bytes: 500 }),
    file("video", "teaser.mp4"),
    file("other", "notes.txt"),
    file("mystery_role", "x.bin"),
    file("extended", "fast_ext.wav"),
  ];
  const groups = groupFiles(files);

  it("puts audio roles together, master first", () => {
    expect(groups.audio.map((f) => f.role)).toEqual(["master", "extended", "alt_version"]);
  });

  it("puts artwork roles together, final artwork first", () => {
    expect(groups.artwork.map((f) => f.role)).toEqual(["final_artwork", "image_other", "artwork_source"]);
  });

  it("puts contract roles together", () => {
    expect(groups.contracts.map((f) => f.role)).toEqual(["contract_signed", "splice_certificate"]);
  });

  it("keeps stems apart and sorted by name", () => {
    expect(groups.stems.map((f) => f.rel_path)).toEqual(["stems/bass.wav", "stems/kick.wav"]);
    expect(totalBytes(groups.stems)).toBe(1500);
  });

  it("sends video, other and unknown roles to Other", () => {
    expect(groups.other.map((f) => f.rel_path).sort()).toEqual(["notes.txt", "teaser.mp4", "x.bin"]);
  });

  it("returns empty groups for no files", () => {
    expect(groupFiles([])).toEqual({ audio: [], artwork: [], contracts: [], stems: [], other: [] });
  });
});

describe("roleLabel", () => {
  it("uses friendly names and falls back to the role text", () => {
    expect(roleLabel("radio_edit")).toBe("Radio edit");
    expect(roleLabel("some_new_role")).toBe("some new role");
  });
});
