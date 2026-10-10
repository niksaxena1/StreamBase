/** Picker option model, ranking and track disambiguation (pure; unit-tested). */
export type OptionThumb = {
  src?: string | null;
  name: string;
  shape: "round" | "square";
};
export type PickerOption = {
  value: string;
  /** Plain text: shown in the closed input, matched by type-ahead, read by screen readers. */
  label: string;
  thumb?: OptionThumb;
  /** Rich row: full-contrast text (defaults to label). */
  primary?: string;
  /** Muted ~12px text on the same line after the primary text. */
  secondary?: string;
  /** Right-aligned muted tabular figures. */
  trailing?: string;
  /** Spoken description of trailing, e.g. "260 tracks". */
  trailingLabel?: string;
  /** Always listed first and never filtered out (e.g. "All artists"). */
  keep?: boolean;
};

/** Case- and accent-insensitive text, folding the letters NFKD leaves alone (same rule as the API). */
export function fold(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/ø/g, "o")
    .replace(/ł/g, "l");
}

/**
 * Type-ahead: keep options whose label (title/name) contains the query, prefix matches first,
 * each group keeping its incoming order. An empty query returns everything unchanged.
 * `drop: false` only reorders (for server-filtered lists whose labels may not contain the query).
 */
export function rankOptions<T extends { label: string; keep?: boolean }>(
  options: readonly T[],
  query: string,
  drop = true,
): T[] {
  const q = fold(query.trim());
  if (!q) return [...options];
  const prefix: T[] = [],
    inside: T[] = [],
    rest: T[] = [];
  for (const option of options) {
    if (option.keep) {
      prefix.push(option);
      continue;
    }
    const text = fold(option.label);
    if (text.startsWith(q)) prefix.push(option);
    else if (text.includes(q)) inside.push(option);
    else if (!drop) rest.push(option);
  }
  return [...prefix, ...inside, ...rest];
}

export type PickerArtist = { name: string; track_count: number; art?: string | null };
export function artistOption(artist: PickerArtist): PickerOption {
  return {
    value: artist.name,
    label: artist.name,
    thumb: { src: artist.art, name: artist.name, shape: "round" },
    primary: artist.name,
    trailing: artist.track_count.toLocaleString("en-US"),
    trailingLabel: `${artist.track_count} ${artist.track_count === 1 ? "track" : "tracks"}`,
  };
}

export type PickerTrack = {
  isrc: string;
  song_name: string;
  artist: string;
  first_day: string;
  art?: string | null;
};
const collator = new Intl.Collator("en", { sensitivity: "base", numeric: false });
/** Alphabetical by title; accents and case do not matter. Ties stay deterministic. */
export function compareTitles(a: PickerTrack, b: PickerTrack): number {
  return (
    collator.compare(a.song_name, b.song_name) ||
    (a.song_name < b.song_name ? -1 : a.song_name > b.song_name ? 1 : 0) ||
    (a.isrc < b.isrc ? -1 : a.isrc > b.isrc ? 1 : 0)
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function firstSeenFull(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return `first seen ${date} ${MONTHS[month - 1]} ${year}`;
}

/**
 * Track picker options: cover + title only, sorted alphabetically. When two of the artist's
 * tracks share a title, a muted disambiguator is added: the differing artist credit, else the
 * year first seen (then the full date, then the ISRC if even that is identical).
 */
export function buildTrackOptions(tracks: readonly PickerTrack[]): PickerOption[] {
  const sorted = [...tracks].sort(compareTitles);
  const groups = new Map<string, PickerTrack[]>();
  for (const track of sorted) {
    const key = fold(track.song_name.trim());
    groups.set(key, [...(groups.get(key) ?? []), track]);
  }
  const strategies: ((t: PickerTrack) => string)[] = [
    (t) => t.artist,
    (t) => `first seen ${t.first_day.slice(0, 4)}`,
    (t) => firstSeenFull(t.first_day),
    (t) => t.isrc,
  ];
  const secondary = new Map<string, string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const pick =
      strategies.find((strategy) => new Set(group.map(strategy)).size === group.length) ??
      strategies[strategies.length - 1];
    for (const track of group) secondary.set(track.isrc, pick(track));
  }
  return sorted.map((track) => ({
    value: track.isrc,
    label: track.song_name,
    thumb: { src: track.art, name: track.song_name, shape: "square" as const },
    primary: track.song_name,
    secondary: secondary.get(track.isrc),
  }));
}
