import { fileNameFromPath } from "./format";
import type { LibraryFile } from "./types";

const AUDIO_ROLES = ["master", "extended", "radio_edit", "alt_version", "other_root_audio"];
const ARTWORK_ROLES = ["final_artwork", "image_other", "artwork_source"];
const CONTRACT_ROLES = ["contract_signed", "contract_plain", "contract_text_source", "splice_certificate", "cover_license"];

export type FileGroups = {
  audio: LibraryFile[];
  artwork: LibraryFile[];
  contracts: LibraryFile[];
  stems: LibraryFile[];
  other: LibraryFile[];
};

export const ROLE_LABELS: Record<string, string> = {
  master: "Master",
  extended: "Extended",
  radio_edit: "Radio edit",
  alt_version: "Alt version",
  other_root_audio: "Other audio",
  final_artwork: "Final artwork",
  image_other: "Image",
  artwork_source: "Artwork source",
  contract_signed: "Signed contract",
  contract_plain: "Contract",
  contract_text_source: "Contract text",
  splice_certificate: "Splice certificate",
  cover_license: "Cover license",
  stem: "Stem",
  video: "Video",
  other: "Other",
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role.replace(/_/g, " ");
}

function byRoleThenName(order: string[]) {
  return (a: LibraryFile, b: LibraryFile) => {
    const ra = order.indexOf(a.role);
    const rb = order.indexOf(b.role);
    if (ra !== rb) return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
    return fileNameFromPath(a.rel_path).localeCompare(fileNameFromPath(b.rel_path), "en", { numeric: true });
  };
}

/** Splits a track's files into the sections shown in the detail panel. Unknown roles land in Other. */
export function groupFiles(files: LibraryFile[]): FileGroups {
  const groups: FileGroups = { audio: [], artwork: [], contracts: [], stems: [], other: [] };
  for (const file of files) {
    if (AUDIO_ROLES.includes(file.role)) groups.audio.push(file);
    else if (ARTWORK_ROLES.includes(file.role)) groups.artwork.push(file);
    else if (CONTRACT_ROLES.includes(file.role)) groups.contracts.push(file);
    else if (file.role === "stem") groups.stems.push(file);
    else groups.other.push(file);
  }
  groups.audio.sort(byRoleThenName(AUDIO_ROLES));
  groups.artwork.sort(byRoleThenName(ARTWORK_ROLES));
  groups.contracts.sort(byRoleThenName(CONTRACT_ROLES));
  groups.stems.sort(byRoleThenName([]));
  groups.other.sort(byRoleThenName([]));
  return groups;
}

export function totalBytes(files: LibraryFile[]): number {
  return files.reduce((sum, f) => sum + (f.bytes ?? 0), 0);
}
