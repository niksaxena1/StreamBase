"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  ArrowRightLeft,
  GitCompareArrows,
  LayoutDashboard,
  LibraryBig,
} from "lucide-react";

import type { CompetitorsPageCoreProps } from "@/lib/competitors/loadCompetitorsPage";
import { ChartSkeleton, TableSkeleton } from "@/components/ui/Skeleton";
import { isOwnCatalogLabelKey } from "@/lib/competitors/ownCatalog";

import { CompetitorLabelCards } from "./CompetitorLabelCards";
import { CompetitorsClient } from "./CompetitorsClient";
import { CompetitorsIntelSections } from "./CompetitorsIntelSections";
import type { CompetitorWorkspaceView } from "./competitorsTypes";

const CompetitorOverviewCharts = dynamic(
  () => import("./CompetitorOverviewCharts").then((module) => ({ default: module.CompetitorOverviewCharts })),
  { ssr: false, loading: () => <ChartSkeleton height={360} /> },
);
const CompetitorComparisonInsights = dynamic(
  () => import("./CompetitorComparisonInsights").then((module) => ({ default: module.CompetitorComparisonInsights })),
  { ssr: false, loading: () => <ChartSkeleton height={360} /> },
);
const CompetitorMovementDashboard = dynamic(
  () => import("./CompetitorMovementDashboard").then((module) => ({ default: module.CompetitorMovementDashboard })),
  { ssr: false, loading: () => <TableSkeleton rows={6} cols={4} /> },
);
const CompetitorCatalogIntelligence = dynamic(
  () => import("./CompetitorCatalogIntelligence").then((module) => ({ default: module.CompetitorCatalogIntelligence })),
  { ssr: false, loading: () => <ChartSkeleton height={360} /> },
);
const CompetitorDataHealth = dynamic(
  () => import("./CompetitorDataHealth").then((module) => ({ default: module.CompetitorDataHealth })),
  { ssr: false, loading: () => <TableSkeleton rows={6} cols={5} /> },
);

const VIEWS: Array<{
  key: CompetitorWorkspaceView;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "compare", label: "Compare", icon: GitCompareArrows },
  { key: "movement", label: "Movement", icon: ArrowRightLeft },
  { key: "catalog", label: "Catalog intelligence", icon: LibraryBig },
  { key: "health", label: "Data health", icon: Activity },
];

function parseView(value: string | null): CompetitorWorkspaceView {
  return VIEWS.some((view) => view.key === value) ? (value as CompetitorWorkspaceView) : "overview";
}

export function CompetitorsWorkspace({ core }: { core: CompetitorsPageCoreProps }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = parseView(searchParams.get("view"));
  const activeLabels = useMemo(
    () => core.labels.filter((label) => label.is_active !== false),
    [core.labels],
  );
  const competitorLabels = useMemo(
    () => activeLabels.filter((label) => !isOwnCatalogLabelKey(label.label_key)),
    [activeLabels],
  );

  function selectView(next: CompetitorWorkspaceView) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "overview") params.delete("view");
    else params.set("view", next);
    const query = params.toString();
    router.replace(query ? `?${query}` : "?", { scroll: false });
  }

  return (
    <div className="space-y-4">
      <nav className="sticky top-2 z-20 -mx-1 overflow-x-auto px-1 pb-1" aria-label="Competitor workspace">
        <div role="tablist" className="sb-glass inline-flex min-w-max items-center gap-1 p-1">
          {VIEWS.map((item) => {
            const selected = view === item.key;
            return (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={selected}
                className="sb-control inline-flex h-8 items-center gap-2 rounded-md px-3 text-xs font-medium transition-colors"
                style={{
                  background: selected ? "var(--sb-accent)" : "transparent",
                  color: selected ? "var(--sb-accent-text, #000)" : "var(--sb-muted)",
                }}
                onClick={() => selectView(item.key)}
              >
                <item.icon className="h-3.5 w-3.5" />
                {item.label}
              </button>
            );
          })}
        </div>
      </nav>

      <div role="tabpanel" aria-label={VIEWS.find((item) => item.key === view)?.label}>
        {view === "overview" ? (
          <div className="space-y-4">
            <CompetitorLabelCards rows={core.comparisonRows} playlistsByLabel={core.playlistsByLabel} />
            <CompetitorOverviewCharts labels={activeLabels} labelSeries={core.labelSeries} />
          </div>
        ) : null}

        {view === "compare" ? (
          <div className="space-y-4">
            <CompetitorsClient
              labels={core.labels}
              comparisonRows={core.comparisonRows}
              labelSeries={core.labelSeries}
              latestDataDate={core.latestDataDate}
              latestRunDate={core.latestRunDate}
              selectedCompetitorLabelKey={core.selectedCompetitorLabelKey}
              playlistsByLabel={core.playlistsByLabel}
              showCards={false}
            />
            <CompetitorComparisonInsights labels={activeLabels} labelSeries={core.labelSeries} />
          </div>
        ) : null}

        {view === "movement" ? (
          <div className="space-y-4">
            <CompetitorMovementDashboard latestRunDate={core.latestRunDate} labels={competitorLabels} />
            <CompetitorsIntelSections
              labels={core.labels}
              latestDataDate={core.latestDataDate}
              latestRunDate={core.latestRunDate}
              selectedCompetitorLabelKey={core.selectedCompetitorLabelKey}
              section="movement"
            />
          </div>
        ) : null}

        {view === "catalog" ? (
          <div className="space-y-4">
            <CompetitorCatalogIntelligence latestRunDate={core.latestRunDate} labels={competitorLabels} />
            <CompetitorsIntelSections
              labels={core.labels}
              latestDataDate={core.latestDataDate}
              latestRunDate={core.latestRunDate}
              selectedCompetitorLabelKey={core.selectedCompetitorLabelKey}
              section="catalog"
            />
          </div>
        ) : null}

        {view === "health" ? (
          <CompetitorDataHealth
            labels={core.labels}
            labelSeries={core.labelSeries}
            runHistory={core.runHistory}
            warnings={core.warnings}
            overrideDays={core.overrideDays}
            overrideRowCount={core.overrideRowCount}
          />
        ) : null}
      </div>
    </div>
  );
}
