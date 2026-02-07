import { redirect } from "next/navigation";
import { revalidatePath, revalidateTag } from "next/cache";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { PageHeader } from "@/components/shell/PageHeader";
import { GlassTable, TableCell, TableRow, EmptyState } from "@/components/ui/GlassTable";
import { TrackExclusionForm } from "./TrackExclusionForm";
import { SAISettingsToggle } from "./SAISettingsToggle";
import { HomeFiltersToggle } from "./HomeFiltersToggle";
import { PayoutRateSetting } from "./PayoutRateSetting";
import { WeekHighlightDaySetting } from "./WeekHighlightDaySetting";
import { ChartStartDateSetting } from "./ChartStartDateSetting";
import { ChartAxisZoomSetting } from "./ChartAxisZoomSetting";
import { CurrencyDisplaySetting } from "./CurrencyDisplaySetting";
import { ManualStreamOverrideForm } from "./ManualStreamOverrideForm";
import { StreamOverridesTable, StreamOverridesTableDownloadButton } from "./StreamOverridesTable";
import { SectionHeader } from "@/components/ui/SectionHeader";

export const revalidate = 86400; // 24h ISR - admin config changes are infrequent

async function requireAdmin() {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  if (!data.user) redirect("/login");

  const { data: isAdmin, error } = await sb.rpc("is_admin");
  if (error) throw new Error(error.message);
  if (!isAdmin) redirect("/");

  return { sb, userId: data.user.id };
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
  const allTracks: Array<{
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

  // Suggested manual overrides (best-effort; depends on ingestion_warnings).
  // These come from Health warnings emitted when SpotOnTrack exports have missing/invalid stream totals.
  type OverrideSuggestion = {
    isrc: string;
    code: "catalog_streams_missing_prev_nonzero" | "catalog_missing_stream_snapshots";
    suggestedStreams: number | null;
    prevStreams: number | null;
  };

  let overrideSuggestions: OverrideSuggestion[] = [];
  try {
    if (latestRunDate) {
      const { data: warnRows, error } = await svc
        .from("ingestion_warnings")
        .select("code,details_json")
        .eq("run_date", latestRunDate)
        .in("code", ["catalog_streams_missing_prev_nonzero", "catalog_missing_stream_snapshots"])
        .limit(50);
      if (!error) {
        const byIsrc = new Map<string, OverrideSuggestion>();

        for (const w of (warnRows ?? []) as any[]) {
          const code = String(w?.code ?? "") as OverrideSuggestion["code"];
          const d = (w as any)?.details_json ?? {};

          if (code === "catalog_streams_missing_prev_nonzero") {
            const rows = Array.isArray(d?.affected_isrcs_with_prev_sample)
              ? (d.affected_isrcs_with_prev_sample as any[])
              : [];
            for (const r of rows) {
              const isrc = String(r?.isrc ?? "").trim().toUpperCase();
              const prev = Number(r?.prev_streams_cumulative ?? NaN);
              if (!/^[A-Z0-9]{12}$/.test(isrc)) continue;
              const prevStreams = Number.isFinite(prev) ? prev : null;
              // Suggest carrying forward yesterday's value as a starting point.
              const s: OverrideSuggestion = {
                isrc,
                code,
                prevStreams,
                suggestedStreams: prevStreams,
              };
              byIsrc.set(isrc, s);
            }
          }

          if (code === "catalog_missing_stream_snapshots") {
            const isrcs = Array.isArray(d?.missing_isrcs_sample) ? (d.missing_isrcs_sample as any[]) : [];
            for (const raw of isrcs) {
              const isrc = String(raw ?? "").trim().toUpperCase();
              if (!/^[A-Z0-9]{12}$/.test(isrc)) continue;
              if (byIsrc.has(isrc)) continue;
              byIsrc.set(isrc, { isrc, code, prevStreams: null, suggestedStreams: null });
            }
          }
        }

        overrideSuggestions = Array.from(byIsrc.values());
      }
    }
  } catch {
    // ignore
  }

  // Fetch ONLY tracks missing Spotify enrichment (spotify_artist_ids is NULL)
  // for the enrichment exclusion combobox.
  const unenrichedTracks: Array<{
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

  // Manual stream overrides (best-effort; table may not exist yet).
  let streamOverrides: Array<{
    id: number;
    date: string;
    isrc: string;
    streams_cumulative_override: number;
    note: string | null;
    created_by: string | null;
    created_at: string | null;
  }> = [];

  try {
    const { data: rows, error } = await svc
      .from("track_daily_stream_overrides")
      .select("id,date,isrc,streams_cumulative_override,note,created_by,created_at")
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(500);
    if (!error) streamOverrides = (rows ?? []) as any;
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

  async function addStreamOverride(formData: FormData) {
    "use server";

    const { userId } = await requireAdmin();
    const date = String(formData.get("date") ?? "").trim();
    const isrc = String(formData.get("isrc") ?? "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
    const streamsRaw = String(formData.get("streams_cumulative_override") ?? "").trim();
    const note = String(formData.get("note") ?? "").trim() || null;
    const recompute = String(formData.get("recompute") ?? "").trim() === "true";

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid date. Expected YYYY-MM-DD.");
    if (!/^[A-Z0-9]{12}$/.test(isrc)) throw new Error("Invalid ISRC. Expected 12 characters (A-Z/0-9).");
    if (!/^\d+$/.test(streamsRaw)) throw new Error("Streams must be a whole number (digits only).");
    if (!note) throw new Error("Please add a note (required for auditability).");

    const streams = Number(streamsRaw);
    if (!Number.isFinite(streams) || streams < 0) throw new Error("Streams must be a non-negative number.");

    const svc = supabaseService();
    const { error: upErr } = await svc
      .from("track_daily_stream_overrides")
      .upsert(
        [{ date, isrc, streams_cumulative_override: streams, note, created_by: userId }],
        { onConflict: "date,isrc" },
      );
    if (upErr) throw new Error(upErr.message);

    if (recompute) {
      // Best-effort: if RPC doesn't exist yet, still keep the override.
      await svc.rpc("spotibase_recompute_playlist_daily_stats", { p_date: date });
    }

    // Invalidate all Supabase query caches (unstable_cache uses tags in `cachedQuery`).
    // Without this, playlist tables may stay stale for up to 24h.
    revalidateTag("supabase");

    revalidatePath("/health");
    revalidatePath("/settings");
    revalidatePath("/");
    revalidatePath("/playlists");
    revalidatePath("/collectors");
    revalidatePath("/catalog");
  }

  async function removeStreamOverride(formData: FormData) {
    "use server";

    await requireAdmin();
    const id = Number(formData.get("id") ?? 0);
    if (!id || Number.isNaN(id)) return;

    const svc = supabaseService();
    const { error: delErr } = await svc.from("track_daily_stream_overrides").delete().eq("id", id);
    if (delErr) throw new Error(delErr.message);

    const date = String(formData.get("date") ?? "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      await svc.rpc("spotibase_recompute_playlist_daily_stats", { p_date: date });
    }

    revalidateTag("supabase");

    revalidatePath("/health");
    revalidatePath("/settings");
    revalidatePath("/");
    revalidatePath("/playlists");
    revalidatePath("/collectors");
    revalidatePath("/catalog");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        subtitle="Admin settings for SpotiBase."
      />

      <div className="space-y-2">
        <SectionHeader title="AI Assistant" />
        <SAISettingsToggle />
      </div>

      <div className="space-y-2">
        <SectionHeader title="Home" subtitle="Customize what appears on the Home dashboard." />
        <HomeFiltersToggle />
      </div>

      <div className="space-y-2">
        <SectionHeader title="Revenue" subtitle="Configure how estimated revenue is calculated from streams." />
        <PayoutRateSetting />
        <CurrencyDisplaySetting />
      </div>

      <div className="space-y-2">
        <SectionHeader title="Charts" subtitle="Visual preferences for time-series charts." />
        <WeekHighlightDaySetting />
        <ChartStartDateSetting />
        <ChartAxisZoomSetting />
      </div>

      <div className="space-y-2">
        <SectionHeader
          title="Health warning exclusions"
          subtitle={
            <>
              Exclude intentional non-catalog tracks from the Health warning{" "}
              <span className="font-mono">non_catalog_tracks_present</span> and from the "All Missing Catalog Tracks" list.
            </>
          }
        />

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
          {!exclusions.length && <EmptyState colSpan={4} message="No exclusions yet." />}
        </GlassTable>
      </div>

      <div className="space-y-2">
        <SectionHeader
          title="Enrichment warning exclusions"
          subtitle={
            <div className="space-y-1">
              <div>
                Suppress the Health warning{" "}
                <span className="font-mono">tracks_missing_enrichment</span> for specific tracks (tracks where enrichment has been intentionally skipped).
              </div>
              <div className="opacity-70">
                The Track combobox only lists tracks currently detected as missing enrichment (no Spotify artist IDs).
              </div>
            </div>
          }
        />

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
          {!enrichmentExclusions.length && <EmptyState colSpan={4} message="No enrichment exclusions yet." />}
        </GlassTable>
      </div>

      <div className="space-y-2">
        <SectionHeader
          title="Manual stream fixes (overrides)"
          subtitle={
            <>
              Manually override a track's cumulative stream snapshot for a specific{" "}
              <span className="font-mono">run_date</span>. Overrides are stored separately for auditability, and the app can read through an "effective" view.
            </>
          }
          actions={<StreamOverridesTableDownloadButton overrides={streamOverrides} tracks={allTracks} />}
        />

        <ManualStreamOverrideForm
          addStreamOverride={addStreamOverride}
          tracks={allTracks}
          defaultRunDate={latestRunDate}
          suggestions={overrideSuggestions}
        />

        <StreamOverridesTable
          overrides={streamOverrides}
          tracks={allTracks}
          removeStreamOverride={removeStreamOverride}
        />
      </div>
    </div>
  );
}
