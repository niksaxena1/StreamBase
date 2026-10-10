import type { RequestAppContext } from "@/lib/requestAppContext.server";
import { ALL_COMPETITORS_KEY, resolveCompetitorLabelKey } from "@/lib/competitorContext";
import { normalizeDatasetMode } from "@/lib/datasetMode";

/** Preserve saved-key semantics, including inactive labels and an unset selection. */
export async function resolveHomeDataset(args: {
  svc: RequestAppContext["svc"];
  settings: RequestAppContext["settings"];
  labels?: RequestAppContext["shellContext"]["competitorLabels"];
  ignoreLabelErrors?: boolean;
}) {
  const { svc, settings, labels } = args;
  const datasetMode = normalizeDatasetMode(settings?.dataset_mode);
  let competitorLabelKey = typeof settings?.competitor_label_key === "string" && settings.competitor_label_key.trim()
    ? settings.competitor_label_key.trim() : null;
  let competitorLabelName: string | null = null;
  try {
    if (datasetMode === "competitor") {
      if (competitorLabelKey && competitorLabelKey !== ALL_COMPETITORS_KEY) {
        const knownLabel = labels?.find((label) => label.label_key === competitorLabelKey);
        if (knownLabel) competitorLabelName = knownLabel.display_name;
        else {
          // The request context contains active labels only. Keep the original lookup
          // for a saved inactive key instead of silently switching its dataset.
          const { data: label } = await svc.schema("competitor").from("labels")
            .select("display_name").eq("label_key", competitorLabelKey).maybeSingle();
          competitorLabelName = label?.display_name ?? competitorLabelKey;
        }
      } else {
        // An empty shell list may represent a failed image/label cache load.
        // It must not suppress the live lookup that resolves an unset selection.
        const typedLabels = labels?.length ? labels : (await svc.schema("competitor").from("labels")
          .select("label_key,display_name").eq("is_active", true)
          .order("display_name", { ascending: true })).data ?? [];
        competitorLabelKey = competitorLabelKey === ALL_COMPETITORS_KEY
          ? ALL_COMPETITORS_KEY : resolveCompetitorLabelKey(null, typedLabels);
        competitorLabelName = competitorLabelKey === ALL_COMPETITORS_KEY
          ? "All Competitors" : typedLabels.find((label) => label.label_key === competitorLabelKey)?.display_name ?? competitorLabelKey;
      }
    }
  } catch (error) {
    if (!args.ignoreLabelErrors) throw error;
  }
  return { datasetMode, competitorLabelKey, competitorLabelName };
}
