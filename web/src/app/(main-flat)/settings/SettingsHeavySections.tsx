import { loadSettingsHeavyData } from "@/lib/settings/loadSettingsHeavyData";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { HealthExclusionsSection, type ExclusionTabConfig } from "./HealthExclusionsSection";
import { ManualStreamOverrideForm } from "./ManualStreamOverrideForm";
import { StreamOverridesTable, StreamOverridesTableDownloadButton } from "./StreamOverridesTable";

export async function SettingsHeavySections(props: {
  latestRunDate: string | null;
  runDateOptions: string[];
  allPlaylists: Array<{ playlist_key: string; display_name: string }>;
  exclusionCountEstimate: number;
  streamOverrideCountEstimate: number;
  addHealthExclusion: (formData: FormData) => Promise<void>;
  removeHealthExclusion: (formData: FormData) => Promise<void>;
  addEnrichmentExclusion: (formData: FormData) => Promise<void>;
  removeEnrichmentExclusion: (formData: FormData) => Promise<void>;
  addStaleExclusion: (formData: FormData) => Promise<void>;
  removeStaleExclusion: (formData: FormData) => Promise<void>;
  addStreamOverride: (formData: FormData) => Promise<void>;
  removeStreamOverride: (formData: FormData) => Promise<void>;
}) {
  const heavy = await loadSettingsHeavyData(props.latestRunDate);
  const totalExclusions =
    heavy.exclusions.length + heavy.enrichmentExclusions.length + heavy.staleExclusions.length;

  const exclusionTabs: ExclusionTabConfig[] = [
    {
      key: "non_catalog",
      label: "Non-catalog",
      description: (
        <>
          Exclude intentional non-catalog tracks from the Health warning{" "}
          <span className="font-mono">non_catalog_tracks_present</span> and from the &ldquo;All Missing Catalog
          Tracks&rdquo; list.
        </>
      ),
      exclusions: heavy.exclusions,
      addAction: props.addHealthExclusion,
      removeAction: props.removeHealthExclusion,
      formTracks: heavy.allTracks,
      notePlaceholder: "Intentional non-catalog track",
    },
    {
      key: "enrichment",
      label: "Enrichment",
      description: (
        <div className="space-y-1">
          <div>
            Suppress the Health warning{" "}
            <span className="font-mono">tracks_missing_enrichment</span> for tracks where enrichment has been
            intentionally skipped.
          </div>
          <div className="opacity-70">
            The Track combobox only lists tracks currently detected as missing enrichment (no Spotify artist IDs).
          </div>
        </div>
      ),
      exclusions: heavy.enrichmentExclusions,
      addAction: props.addEnrichmentExclusion,
      removeAction: props.removeEnrichmentExclusion,
      formTracks: heavy.unenrichedTracks,
      notePlaceholder: "Intentional: skip enrichment for this track",
      allowMulti: true,
      submitLabel: "Exclude selected",
    },
    {
      key: "stale",
      label: "Stale tracks",
      description: (
        <div className="space-y-1">
          <div>
            Exclude tracks from the <span className="font-mono">individual_tracks_stale</span> Health warning.
            Excluded tracks will not be flagged even if their daily streams show zero growth.
          </div>
          <div className="opacity-70">Exclusions take effect on the next ingestion run.</div>
        </div>
      ),
      exclusions: heavy.staleExclusions,
      addAction: props.addStaleExclusion,
      removeAction: props.removeStaleExclusion,
      formTracks: heavy.allTracks,
      notePlaceholder: "Intentional: this track's streams may not update daily",
      allowMulti: true,
      submitLabel: "Exclude selected",
    },
  ];

  return (
    <>
      <div id="exclusions" className="scroll-mt-14">
        <CollapsibleSection
          title={
            <>
              Health exclusions{" "}
              <span className="ml-1.5 tabular-nums opacity-80">{totalExclusions || props.exclusionCountEstimate}</span>
            </>
          }
          subtitle="Manage non-catalog, enrichment, and stale track exclusions."
          storageKey="sb-settings-exclusions"
          defaultOpen={false}
        >
          <HealthExclusionsSection tabs={exclusionTabs} playlists={props.allPlaylists} allTracks={heavy.allTracks} />
        </CollapsibleSection>
      </div>

      <div id="overrides" className="scroll-mt-14">
        <CollapsibleSection
          title={
            <>
              Manual stream overrides{" "}
              <span className="ml-1.5 tabular-nums opacity-80">
                {heavy.streamOverrides.length || props.streamOverrideCountEstimate}
              </span>
            </>
          }
          subtitle="Override cumulative stream snapshots for specific run dates."
          storageKey="sb-settings-overrides"
          defaultOpen={false}
          actions={
            <StreamOverridesTableDownloadButton overrides={heavy.streamOverrides} tracks={heavy.allTracks} />
          }
        >
          <ManualStreamOverrideForm
            addStreamOverride={props.addStreamOverride}
            tracks={heavy.allTracks}
            defaultRunDate={props.latestRunDate}
            runDateOptions={props.runDateOptions}
            suggestions={heavy.overrideSuggestions}
          />

          <div className="mt-3">
            <StreamOverridesTable
              overrides={heavy.streamOverrides}
              tracks={heavy.allTracks}
              removeStreamOverride={props.removeStreamOverride}
            />
          </div>
        </CollapsibleSection>
      </div>
    </>
  );
}
