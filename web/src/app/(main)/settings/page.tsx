import { redirect } from "next/navigation";
import Link from "next/link";
import { revalidatePath } from "next/cache";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { GlassTable, TableCell, TableRow } from "@/components/ui/GlassTable";
import { TrackExclusionForm } from "./TrackExclusionForm";
import { SAISettingsToggle } from "./SAISettingsToggle";

export const revalidate = 86400; // 24h ISR - admin config changes are infrequent

async function requireAdmin() {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  if (!data.user) redirect("/login");

  const { data: isAdmin, error } = await sb.rpc("is_admin");
  if (error) throw new Error(error.message);
  if (!isAdmin) redirect("/");

  return { sb };
}

export default async function SettingsPage() {
  await requireAdmin();
  const svc = supabaseService();

  const { data: latestRun } = await svc
    .from("ingestion_runs")
    .select("run_date")
    .order("run_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const latestRunDate = (latestRun?.run_date as string | null) ?? null;

  // Fetch all tracks for combobox (with artist names)
  let allTracks: Array<{
    isrc: string;
    name: string | null;
    spotify_album_image_url: string | null;
    spotify_artist_names: string[] | null;
  }> = [];

  try {
    const pageSize = 1000;
    let from = 0;
    while (true) {
      const to = from + pageSize - 1;
      const { data, error } = await svc
        .from("tracks")
        .select("isrc,name,spotify_album_image_url,spotify_artist_names")
        .order("last_seen", { ascending: false })
        .range(from, to);

      if (error || !data || data.length === 0) break;
      allTracks.push(...(data as any));
      if (data.length < pageSize) break;
      from += pageSize;
    }
  } catch {
    // ignore
  }

  // Fetch ONLY tracks missing Spotify enrichment (spotify_artist_ids is NULL)
  // for the enrichment exclusion combobox.
  let unenrichedTracks: Array<{
    isrc: string;
    name: string | null;
    spotify_album_image_url: string | null;
    spotify_artist_names: string[] | null;
  }> = [];

  try {
    const pageSize = 1000;
    let from = 0;
    while (true) {
      const to = from + pageSize - 1;
      const { data, error } = await svc
        .from("tracks")
        .select("isrc,name,spotify_album_image_url,spotify_artist_names")
        .is("spotify_artist_ids", null)
        .order("last_seen", { ascending: false })
        .range(from, to);

      if (error || !data || data.length === 0) break;
      unenrichedTracks.push(...(data as any));
      if (data.length < pageSize) break;
      from += pageSize;
    }
  } catch {
    // ignore
  }

  // Fetch all playlists for scope dropdown
  let allPlaylists: Array<{
    playlist_key: string;
    display_name: string;
  }> = [];

  try {
    const { data, error } = await svc
      .from("playlists")
      .select("playlist_key,display_name")
      .order("display_name", { ascending: true });
    if (!error && data) {
      allPlaylists = (data as any);
    }
  } catch {
    // ignore
  }

  // Health exclusions (best-effort; table may not exist yet).
  const exclusionCode = "non_catalog_tracks_present";
  const enrichmentExclusionCode = "tracks_missing_enrichment";
  let exclusions: Array<{
    id: number;
    playlist_key: string | null;
    isrc: string;
    note: string | null;
    created_at: string | null;
  }> = [];

  let enrichmentExclusions: Array<{
    id: number;
    playlist_key: string | null;
    isrc: string;
    note: string | null;
    created_at: string | null;
  }> = [];

  try {
    const { data: exRows, error: exErr } = await svc
      .from("health_warning_exclusions")
      .select("id,playlist_key,isrc,note,created_at")
      .eq("code", exclusionCode)
      .order("created_at", { ascending: false })
      .limit(500);
    if (!exErr) exclusions = (exRows ?? []) as any;
  } catch {
    // ignore
  }

  try {
    const { data: exRows, error: exErr } = await svc
      .from("health_warning_exclusions")
      .select("id,playlist_key,isrc,note,created_at")
      .eq("code", enrichmentExclusionCode)
      .order("created_at", { ascending: false })
      .limit(500);
    if (!exErr) enrichmentExclusions = (exRows ?? []) as any;
  } catch {
    // ignore
  }

  const exclusionIsrcs = Array.from(
    new Set(
      exclusions
        .map((e) => String(e.isrc ?? "").trim().toUpperCase())
        .filter(Boolean),
    ),
  );
  const isrcToName = new Map<string, string | null>();
  if (exclusionIsrcs.length > 0) {
    try {
      const { data: trackRows, error: trackErr } = await svc
        .from("tracks")
        .select("isrc,name")
        .in("isrc", exclusionIsrcs);
      if (!trackErr) {
        for (const t of trackRows ?? []) {
          isrcToName.set(String((t as any).isrc), (t as any).name ?? null);
        }
      }
    } catch {
      // ignore
    }
  }

  async function addHealthExclusion(formData: FormData) {
    "use server";

    await requireAdmin();
    const playlist_key_raw = String(formData.get("playlist_key") ?? "").trim();
    const playlist_key = playlist_key_raw ? playlist_key_raw : null;

    const isrc = String(formData.get("isrc") ?? "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
    const note = String(formData.get("note") ?? "").trim() || null;

    if (!/^[A-Z0-9]{12}$/.test(isrc)) {
      throw new Error("Invalid ISRC. Expected 12 characters (A-Z/0-9).");
    }

    const svc = supabaseService();
    const { error: insErr } = await svc
      .from("health_warning_exclusions")
      .insert([{ code: exclusionCode, playlist_key, isrc, note }]);

    // Ignore duplicates (unique index).
    if (insErr && !String(insErr.message || "").toLowerCase().includes("duplicate")) {
      throw new Error(insErr.message);
    }

    revalidatePath("/health");
    revalidatePath("/settings");
  }

  async function removeHealthExclusion(formData: FormData) {
    "use server";

    await requireAdmin();
    const id = Number(formData.get("id") ?? 0);
    if (!id || Number.isNaN(id)) return;

    const svc = supabaseService();
    const { error: delErr } = await svc.from("health_warning_exclusions").delete().eq("id", id);
    if (delErr) throw new Error(delErr.message);

    revalidatePath("/health");
    revalidatePath("/settings");
  }

  async function addEnrichmentExclusion(formData: FormData) {
    "use server";

    await requireAdmin();
    const playlist_key_raw = String(formData.get("playlist_key") ?? "").trim();
    const playlist_key = playlist_key_raw ? playlist_key_raw : null;

    const isrcsRaw = String(formData.get("isrcs") ?? "").trim();
    const isrcs = isrcsRaw
      ? (JSON.parse(isrcsRaw) as unknown[])
          .map((x) => String(x ?? "").trim().toUpperCase().replace(/\s+/g, ""))
          .filter(Boolean)
      : [
          String(formData.get("isrc") ?? "")
            .trim()
            .toUpperCase()
            .replace(/\s+/g, ""),
        ].filter(Boolean);
    const note = String(formData.get("note") ?? "").trim() || null;

    const svc = supabaseService();
    const errors: string[] = [];

    for (const isrc of isrcs) {
      if (!/^[A-Z0-9]{12}$/.test(isrc)) {
        errors.push(`Invalid ISRC: ${isrc}`);
        continue;
      }

      const { error: insErr } = await svc
        .from("health_warning_exclusions")
        .insert([{ code: enrichmentExclusionCode, playlist_key, isrc, note }]);

      // Ignore duplicates (unique index).
      if (insErr && !String(insErr.message || "").toLowerCase().includes("duplicate")) {
        errors.push(insErr.message);
      }
    }

    if (errors.length) {
      throw new Error(errors[0] ?? "Failed to add exclusions");
    }

    revalidatePath("/health");
    revalidatePath("/settings");
  }

  async function removeEnrichmentExclusion(formData: FormData) {
    "use server";

    await requireAdmin();
    const id = Number(formData.get("id") ?? 0);
    if (!id || Number.isNaN(id)) return;

    const svc = supabaseService();
    const { error: delErr } = await svc.from("health_warning_exclusions").delete().eq("id", id);
    if (delErr) throw new Error(delErr.message);

    revalidatePath("/health");
    revalidatePath("/settings");
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">Settings</h1>
            <p className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
              Admin settings for SpotiBase.
            </p>
          </div>
          <Link
            href="/docs"
            className="sb-ring inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-2 text-xs font-medium transition hover:bg-white dark:bg-white/10 dark:hover:bg-white/15"
            style={{ color: "var(--sb-text)" }}
            title="Open SpotiBase docs"
          >
            Docs
          </Link>
        </div>
      </div>

      <div className="space-y-2">
        <div className="px-1">
          <h2 className="text-sm font-semibold">AI Assistant</h2>
        </div>
        <SAISettingsToggle />
      </div>

      <div className="space-y-2">
        <div className="px-1">
          <h2 className="text-sm font-semibold">Health warning exclusions</h2>
          <p className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
            Exclude intentional non-catalog tracks from the Health warning{" "}
            <span className="font-mono">non_catalog_tracks_present</span> and from the “All Missing Catalog Tracks” list.
          </p>
        </div>

        <TrackExclusionForm
          addHealthExclusion={addHealthExclusion}
          tracks={allTracks}
          playlists={allPlaylists}
          notePlaceholder="Intentional non-catalog track"
        />

        <GlassTable headers={["Scope", "Track", "Note", ""]}>
          {exclusions.map((e) => {
            const isrc = String(e.isrc ?? "").trim().toUpperCase();
            const track = allTracks.find((t) => t.isrc === isrc);
            const name = track?.name ?? isrc;
            const imageUrl = track?.spotify_album_image_url ?? null;
            return (
              <TableRow key={e.id}>
                <TableCell mono className="text-xs">
                  {e.playlist_key ?? "all"}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={imageUrl}
                        alt={name}
                        className="h-8 w-8 rounded-lg object-cover sb-ring flex-shrink-0"
                      />
                    ) : (
                      <div className="h-8 w-8 rounded-lg sb-ring bg-white/60 dark:bg-white/10 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{name}</div>
                      <div className="font-mono text-[10px] opacity-60 truncate">{isrc}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-xs">{e.note ?? "—"}</TableCell>
                <TableCell className="text-right">
                  <form action={removeHealthExclusion}>
                    <input type="hidden" name="id" value={String(e.id)} />
                    <button type="submit" className="text-xs underline opacity-70 hover:opacity-100">
                      remove
                    </button>
                  </form>
                </TableCell>
              </TableRow>
            );
          })}
          {!exclusions.length && (
            <TableRow>
              <TableCell className="text-center opacity-50 py-8" colSpan={4}>
                No exclusions yet.
              </TableCell>
            </TableRow>
          )}
        </GlassTable>
      </div>

      <div className="space-y-2">
        <div className="px-1">
          <h2 className="text-sm font-semibold">Enrichment warning exclusions</h2>
          <p className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
            Suppress the Health warning{" "}
            <span className="font-mono">tracks_missing_enrichment</span> for specific tracks (tracks where enrichment has been intentionally skipped).
          </p>
          <p className="mt-1 text-xs opacity-70" style={{ color: "var(--sb-muted)" }}>
            The Track combobox only lists tracks currently detected as missing enrichment (no Spotify artist IDs).
          </p>
        </div>

        <TrackExclusionForm
          addHealthExclusion={addEnrichmentExclusion}
          tracks={unenrichedTracks}
          playlists={allPlaylists}
          notePlaceholder="Intentional: skip enrichment for this track"
          allowMulti
          submitLabel="Exclude selected"
        />

        <GlassTable headers={["Scope", "Track", "Note", ""]}>
          {enrichmentExclusions.map((e) => {
            const isrc = String(e.isrc ?? "").trim().toUpperCase();
            const track = allTracks.find((t) => t.isrc === isrc);
            const name = track?.name ?? isrc;
            const imageUrl = track?.spotify_album_image_url ?? null;
            return (
              <TableRow key={`enrich-${e.id}`}>
                <TableCell mono className="text-xs">
                  {e.playlist_key ?? "all"}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={imageUrl}
                        alt={name}
                        className="h-8 w-8 rounded-lg object-cover sb-ring flex-shrink-0"
                      />
                    ) : (
                      <div className="h-8 w-8 rounded-lg sb-ring bg-white/60 dark:bg-white/10 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{name}</div>
                      <div className="font-mono text-[10px] opacity-60 truncate">{isrc}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-xs">{e.note ?? "—"}</TableCell>
                <TableCell className="text-right">
                  <form action={removeEnrichmentExclusion}>
                    <input type="hidden" name="id" value={String(e.id)} />
                    <button type="submit" className="text-xs underline opacity-70 hover:opacity-100">
                      remove
                    </button>
                  </form>
                </TableCell>
              </TableRow>
            );
          })}
          {!enrichmentExclusions.length && (
            <TableRow>
              <TableCell className="text-center opacity-50 py-8" colSpan={4}>
                No enrichment exclusions yet.
              </TableCell>
            </TableRow>
          )}
        </GlassTable>
      </div>
    </div>
  );
}

