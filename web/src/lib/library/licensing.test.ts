import { describe, expect, it } from "vitest";
import { licensingBatches, licensingCsv, licensingPackChoices, parseLicensing, type LibraryLicenseDetail } from "./licensing";
import { normalizeOverviewRow } from "./normalize";

const old = { licensee: "UNIQODE", pack: "Summer", batch_date: "2026-08-12", status: "sent", status_on: "2026-08-13" };
const recent = { ...old, pack: "Autumn", batch_date: "2026-10-17", status: "staged" };

describe("licensing overview", () => {
  it("accepts JSON or arrays, sorts newest first and matches licensees without case", () => {
    const parsed = parseLicensing(JSON.stringify([old, recent]));
    expect(licensingBatches(parsed, "Uniqode").map((b) => b.pack)).toEqual(["Autumn", "Summer"]);
    expect(normalizeOverviewRow({ licensing: [old] }).licensing).toEqual(parseLicensing([old]));
  });
  it("tolerates missing, broken and malformed data", () => {
    for (const raw of [null, undefined, "{broken", {}, "null", 3]) expect(parseLicensing(raw)).toEqual([]);
    expect(parseLicensing([null, {}, { ...old, status: "unknown" }, { ...old, batch_date: "2026-02-30" }, old])).toHaveLength(1);
  });
  it("formats the newest batch for export and leaves absent licensees blank", () => {
    expect(licensingCsv(parseLicensing([old]), "uniqode")).toBe("12.08.26 Sent");
    expect(licensingCsv([], "evenfall")).toBe("");
  });
  it("groups selected batch memberships and counts only tracks needing a status change", () => {
    const memberships: LibraryLicenseDetail[] = [
      { ...parseLicensing([old])[0], pack_id: 1, catalog_id: "TG-1", shared_link: null, dropbox_path: null },
      { ...parseLicensing([recent])[0], pack_id: 1, catalog_id: "TG-2", shared_link: null, dropbox_path: null },
      { ...parseLicensing([recent])[0], pack_id: 2, catalog_id: "TG-1", shared_link: null, dropbox_path: null },
    ];
    const choices = licensingPackChoices(memberships, ["TG-1", "TG-2"], "sent");
    expect(choices.map((b) => [b.pack_id, b.memberIds, b.changeIds])).toEqual([
      [1, ["TG-1", "TG-2"], ["TG-2"]], [2, ["TG-1"], ["TG-1"]],
    ]);
    expect(licensingPackChoices(memberships, ["TG-2"], "staged").map((b) => [b.pack_id, b.changeIds])).toEqual([[1, []]]);
    expect(licensingPackChoices(memberships, ["TG-3"], "sent")).toEqual([]);
  });
});
