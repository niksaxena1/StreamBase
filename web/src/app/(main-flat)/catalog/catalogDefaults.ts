export function defaultCatalogArtistId(recent: { spotify_artist_ids?: string[] | null } | null): string {
  return String(recent?.spotify_artist_ids?.[0] ?? "").trim();
}

export function defaultCatalogIsrc(
  requestedIsrc: string | null,
  tracks: ReadonlyArray<{ isrc: string; name: string | null }>,
  mode: "own" | "competitor",
): string | null {
  if (requestedIsrc) return requestedIsrc;
  if (mode === "competitor") return tracks[0]?.isrc ?? null;
  return [...tracks].sort((a, b) => (a.name ?? a.isrc).localeCompare(b.name ?? b.isrc))[0]?.isrc ?? null;
}

export function catalogDefaultsHref(currentHref: string, artistId: string, isrc: string | null): string | null {
  const url = new URL(currentHref, "https://streambase.invalid");
  if (url.pathname !== "/catalog") return null;
  let changed = false;
  if (!url.searchParams.get("artist_id")?.trim() && artistId) { url.searchParams.set("artist_id", artistId); changed = true; }
  if (!url.searchParams.get("isrc")?.trim() && isrc) { url.searchParams.set("isrc", isrc); changed = true; }
  return changed ? url.pathname + url.search + url.hash : null;
}
