import { Suspense } from "react";
import { redirect } from "next/navigation";
import { revalidatePath, revalidateTag } from "next/cache";
import type { Metadata } from "next";

import { normalizeAppAccess, streamBaseAccessRedirectPath } from "@/lib/appAccess";
import { loadSettingsShell } from "@/lib/settings/loadSettingsShell";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { PageHeader } from "@/components/shell/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { PurgeCacheButton } from "./PurgeCacheButton";
import { SAISettingsToggle } from "./SAISettingsToggle";
import { HomeFiltersToggle } from "./HomeFiltersToggle";
import { HomeArtificialSpikesSectionToggle } from "./HomeArtificialSpikesSectionToggle";
import { PayoutRateSetting } from "./PayoutRateSetting";
import { WeekHighlightDaySetting } from "./WeekHighlightDaySetting";
import { ChartStartDateSetting } from "./ChartStartDateSetting";
import { ChartAxisZoomSetting } from "./ChartAxisZoomSetting";
import { WeekendDipSetting } from "./WeekendDipSetting";
import { CurrencyDisplaySetting } from "./CurrencyDisplaySetting";
import { RevenueDecimalDisplaySetting } from "./RevenueDecimalDisplaySetting";
import { StaleTrackThresholdSetting } from "./StaleTrackThresholdSetting";
import { ArtificialStreamSpikeSetting } from "./ArtificialStreamSpikeSetting";
import { ArtificialStreamSpikeWarningToggle } from "./ArtificialStreamSpikeWarningToggle";
import { RapidApiAutoFixSetting } from "./RapidApiAutoFixSetting";
import { HideStaleAnnotationsSetting } from "./HideStaleAnnotationsSetting";
import { NetworkBackgroundGridSetting } from "./NetworkBackgroundGridSetting";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { SettingsNav } from "./SettingsNav";
import { CollectorEntityPlaylistStatsSetting } from "./CollectorEntityPlaylistStatsSetting";
import { SettingsHeavySections } from "./SettingsHeavySections";

export const dynamic = "force-dynamic";

const EXCLUSION_CODE_NON_CATALOG = "non_catalog_tracks_present";
const EXCLUSION_CODE_ENRICHMENT = "tracks_missing_enrichment";
const EXCLUSION_CODE_STALE = "individual_tracks_stale";

export const metadata: Metadata = {
  title: "Settings",
};

async function requireAdmin() {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  if (!data.user) redirect("/login");

  const svc = supabaseService();
  const { data: isAdmin, error } = await sb.rpc("is_admin");
  if (error) throw new Error(error.message);

  const { data: accessRow } = await svc
    .from("app_user_access")
    .select("own_catalog,competitor,playlist_watch,playlist_watch_admin")
    .eq("user_id", data.user.id)
    .maybeSingle();
  const appAccess = normalizeAppAccess(accessRow, Boolean(isAdmin));
  const streamBaseRedirect = streamBaseAccessRedirectPath(appAccess);
  if (streamBaseRedirect) redirect(streamBaseRedirect);

  if (!isAdmin) redirect("/");

  return { sb, userId: data.user.id };
}

export default async function SettingsPage() {
  const { userId } = await requireAdmin();
  const {
    latestRunDate,
    earliestDataDate,
    latestDataDate,
    runDateOptions,
    allPlaylists,
    exclusionCount,
    streamOverrideCount,
  } = await loadSettingsShell();

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
      .insert([{ code: EXCLUSION_CODE_NON_CATALOG, playlist_key, isrc, note }]);

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
        .insert([{ code: EXCLUSION_CODE_ENRICHMENT, playlist_key, isrc, note }]);

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

  async function addStaleExclusion(formData: FormData) {
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
        .insert([{ code: EXCLUSION_CODE_STALE, playlist_key, isrc, note }]);

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

  async function removeStaleExclusion(formData: FormData) {
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

    // Validate that the ISRC exists in the tracks table (FK constraint also enforces this,
    // but a clear error message is better than a generic constraint violation).
    const { data: trackRow } = await svc
      .from("tracks")
      .select("isrc")
      .eq("isrc", isrc)
      .maybeSingle();
    if (!trackRow) throw new Error(`ISRC ${isrc} not found in the tracks table. Only existing tracks can be overridden.`);

    const { error: upErr } = await svc
      .from("track_daily_stream_overrides")
      .upsert(
        [{ date, isrc, streams_cumulative_override: streams, note, created_by: userId }],
        { onConflict: "date,isrc" },
      );
    if (upErr) throw new Error(upErr.message);

    if (recompute) {
      // Cascade recompute: updates daily_streams_net for the overridden date AND all
      // subsequent dates, so the forward chain of daily deltas stays correct.
      await svc.rpc("spotibase_recompute_playlist_daily_stats_cascade", { p_start_date: date });
    }

    // Invalidate all Supabase query caches (unstable_cache uses tags in `cachedQuery`).
    // Without this, playlist tables may stay stale for up to 24h.
    revalidateTag("supabase", "max");

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

    // Atomic: delete the override AND cascade-recompute in a single transaction.
    // If either step fails, everything rolls back — no stale stats left behind.
    const { error: rpcErr } = await svc.rpc("spotibase_remove_stream_override", { p_override_id: id });
    if (rpcErr) throw new Error(rpcErr.message);

    revalidateTag("supabase", "max");

    revalidatePath("/health");
    revalidatePath("/settings");
    revalidatePath("/");
    revalidatePath("/playlists");
    revalidatePath("/collectors");
    revalidatePath("/catalog");
  }

  async function purgeSupabaseCaches() {
    "use server";

    await requireAdmin();

    // `cachedQuery` uses unstable_cache tags: ["supabase", cacheTagForKey(key)].
    // Purge the shared tag to invalidate all cached Supabase reads immediately.
    revalidateTag("supabase", "max");

    revalidatePath("/settings");
    revalidatePath("/health");
    revalidatePath("/");
    revalidatePath("/playlists");
    revalidatePath("/collectors");
    revalidatePath("/catalog");
  }

  const sections = [
    { id: "collectors", label: "Collectors" },
    { id: "ai", label: "AI" },
    { id: "home", label: "Home" },
    { id: "revenue", label: "Revenue" },
    { id: "charts", label: "Charts" },
    { id: "network", label: "Network" },
    { id: "health", label: "Health" },
    { id: "cache", label: "Cache" },
    { id: "exclusions", label: `Exclusions (${exclusionCount})` },
    { id: "overrides", label: `Overrides (${streamOverrideCount})` },
  ];

  const lastRefreshed = new Date().toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        subtitle={
          <>
            Admin settings for StreamBase.{" "}
            <span className="opacity-50">Data as of {lastRefreshed}</span>
          </>
        }
      />

      <SettingsNav sections={sections} />

      {/* Quick settings — 2-column card grid on wider screens */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div
          id="ai"
          className="scroll-mt-14 space-y-2 rounded-xl border p-4"
          style={{ borderColor: "var(--sb-border)" }}
        >
          <SectionHeader title="AI Assistant" />
          <SAISettingsToggle />
        </div>

        <div
          id="collectors"
          className="scroll-mt-14 space-y-2 rounded-xl border p-4"
          style={{ borderColor: "var(--sb-border)" }}
        >
          <SectionHeader title="Collectors" subtitle="Choose how collector totals are scoped." />
          <CollectorEntityPlaylistStatsSetting />
        </div>

        <div
          id="home"
          className="scroll-mt-14 space-y-2 rounded-xl border p-4"
          style={{ borderColor: "var(--sb-border)" }}
        >
          <SectionHeader title="Home" subtitle="Customize what appears on the Home dashboard." />
          <HomeFiltersToggle />
          <HomeArtificialSpikesSectionToggle />
        </div>

        <div
          id="revenue"
          className="scroll-mt-14 space-y-2 rounded-xl border p-4"
          style={{ borderColor: "var(--sb-border)" }}
        >
          <SectionHeader title="Revenue" subtitle="Configure how estimated revenue is calculated from streams." />
          <PayoutRateSetting />
          <CurrencyDisplaySetting />
          <RevenueDecimalDisplaySetting />
        </div>

        <div
          id="charts"
          className="scroll-mt-14 space-y-2 rounded-xl border p-4"
          style={{ borderColor: "var(--sb-border)" }}
        >
          <SectionHeader title="Charts" subtitle="Visual preferences for time-series charts." />
          <WeekHighlightDaySetting />
          <ChartStartDateSetting minDataDateIso={earliestDataDate} maxDataDateIso={latestDataDate} />
          <ChartAxisZoomSetting />
          <WeekendDipSetting />
          <HideStaleAnnotationsSetting />
        </div>

        <div
          id="network"
          className="scroll-mt-14 space-y-2 rounded-xl border p-4"
          style={{ borderColor: "var(--sb-border)" }}
        >
          <SectionHeader title="Network" subtitle="Collaboration Network page preferences." />
          <NetworkBackgroundGridSetting />
        </div>

        <div
          id="health"
          className="scroll-mt-14 space-y-2 rounded-xl border p-4"
          style={{ borderColor: "var(--sb-border)" }}
        >
          <SectionHeader title="Health" subtitle="Configure data-quality detection thresholds used during daily ingestion." />
          <StaleTrackThresholdSetting />
          <ArtificialStreamSpikeWarningToggle />
          <ArtificialStreamSpikeSetting />
          <RapidApiAutoFixSetting />
        </div>

        <div
          id="cache"
          className="scroll-mt-14 space-y-2 rounded-xl border p-4"
          style={{ borderColor: "var(--sb-border)" }}
        >
          <SectionHeader title="Cache" subtitle="Force-refresh server-side cached query results." />
          <div className="text-xs space-y-2" style={{ color: "var(--sb-muted)" }}>
            <div>
              If artwork or tables look stale after enrichment or ingestion, use this to purge the Vercel Data Cache.
              All server-side query results are invalidated immediately and will be re-fetched from the database on the next page load.
            </div>
            <PurgeCacheButton purgeAction={purgeSupabaseCaches} />
          </div>
        </div>
      </div>

      <Suspense
        fallback={
          <>
            <Skeleton className="h-32 w-full rounded-xl" />
            <Skeleton className="mt-4 h-32 w-full rounded-xl" />
          </>
        }
      >
        <SettingsHeavySections
          latestRunDate={latestRunDate}
          runDateOptions={runDateOptions}
          allPlaylists={allPlaylists}
          exclusionCountEstimate={exclusionCount}
          streamOverrideCountEstimate={streamOverrideCount}
          addHealthExclusion={addHealthExclusion}
          removeHealthExclusion={removeHealthExclusion}
          addEnrichmentExclusion={addEnrichmentExclusion}
          removeEnrichmentExclusion={removeEnrichmentExclusion}
          addStaleExclusion={addStaleExclusion}
          removeStaleExclusion={removeStaleExclusion}
          addStreamOverride={addStreamOverride}
          removeStreamOverride={removeStreamOverride}
        />
      </Suspense>
    </div>
  );
}
