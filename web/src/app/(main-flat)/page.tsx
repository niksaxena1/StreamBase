import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { Suspense } from "react";

import { loadHomeDashboardData } from "@/lib/home/loadHomeDashboard";
import { isPlaylistWatchOnlyAccess } from "@/lib/appAccess";
import { getRequestAppContext } from "@/lib/requestAppContext.server";
import { timedServerStep } from "@/lib/serverTiming";
import { DistroMovementHomeNotice } from "./DistroMovementHomeNotice";
import { HomeDashboardHeader, type HomeHeaderProps } from "./home/HomeDashboardHeader";
import { ChartSkeleton, StatCardSkeleton } from "@/components/ui/Skeleton";
import type { HomeDashboardServerProps } from "./home/homeTypes";
import { HomeDashboardClient } from "./HomeDashboardClient";

// Uses Supabase session cookies; this route must be dynamic in Next 16.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Home",
};

export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<{
    scope?: string;
    range?: string;
    daily?: string;
    xy_date?: string;
    start?: string;
    end?: string;
    legacy?: string;
  }>;
}) {
  return timedServerStep("page.home", () => HomeContent({ searchParams }));
}

async function HomeContent({
  searchParams,
}: {
  searchParams?: Promise<{
    scope?: string;
    range?: string;
    daily?: string;
    xy_date?: string;
    start?: string;
    end?: string;
    legacy?: string;
  }>;
}) {
  const sp = (await searchParams) ?? {};

  const { sb, svc, user, isAdmin, appAccess, settings, shellContext } = await timedServerStep(
    "page.home.context",
    () => getRequestAppContext(),
  );

  if (!user) redirect("/login");

  if (isPlaylistWatchOnlyAccess(appAccess)) redirect("/playlist-watch");

  if (!isAdmin && !appAccess.ownCatalog && !appAccess.competitor) {
    redirect("/login");
  }

  const data = timedServerStep(
    "page.home.dashboard",
    () =>
      loadHomeDashboardData({
        sb,
        svc,
        userId: user.id,
        sp,
        includeScatter: false,
        includeDiagnostics: false,
        settings: settings ?? null,
      }),
  );

  const scope = (sp.scope ?? "all_catalog").toLowerCase();
  const playlistKey = scope === "releases" ? "releases" : scope === "ext" ? "ext" : "all_catalog";
  const rangeDays = sp.start && sp.end
    ? Math.max(1, Math.min(365, Math.ceil((new Date(`${sp.end}T00:00:00Z`).getTime() - new Date(`${sp.start}T00:00:00Z`).getTime()) / 86400000) + 1))
    : Math.max(7, Math.min(sp.legacy === "1" ? 1200 : 365, Number(sp.range ?? "30") || 30));
  const header: HomeHeaderProps = {
    sp, playlistKey, rangeDays,
    datasetMode: shellContext.datasetMode,
    competitorLabelKey: shellContext.competitorLabelKey,
    title: shellContext.datasetMode === "competitor" ? shellContext.competitorDisplayName ?? "Competitor" : playlistKey === "releases" ? "Releases" : playlistKey === "ext" ? "ext" : "All Catalog",
    playlistImageUrl: null, latest: null, latestDataDate: null,
    legacyHistoryEnabled: sp.legacy === "1" && shellContext.datasetMode === "own" && playlistKey === "all_catalog",
  };
  return (
    <div className="space-y-4">
      <Suspense fallback={<HomeDashboardHeader {...header} />}>
        <HomeHeaderData data={data} />
      </Suspense>
      <Suspense fallback={<HomeDashboardSkeleton />}>
        <HomeDashboardData data={data} />
      </Suspense>
      <Suspense fallback={null}>
        <HomeNoticeData data={data} />
      </Suspense>
    </div>
  );
}

async function HomeHeaderData({ data }: { data: Promise<HomeDashboardServerProps> }) {
  const props = await data;
  return <HomeDashboardHeader
    sp={props.sp}
    datasetMode={props.datasetMode}
    playlistKey={props.playlistKey}
    playlistImageUrl={props.playlistImageUrl}
    competitorLabelKey={props.competitorLabelKey}
    title={props.title}
    latestDataDate={props.latestDataDate}
    latest={props.latest}
    rangeDays={props.rangeDays}
    legacyHistoryEnabled={props.legacyHistoryEnabled}
  />;
}

async function HomeDashboardData({ data }: { data: Promise<HomeDashboardServerProps> }) {
  const props = await data;
  return <HomeDashboardClient {...props} />;
}

function HomeDashboardSkeleton() {
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton />
    </div>
    <ChartSkeleton height={260} />
  </div>;
}

async function HomeNoticeData({ data }: { data: Promise<HomeDashboardServerProps> }) {
  const props = await data;
  return props.datasetMode === "own" ? <div className="mt-4"><DistroMovementHomeNotice /></div> : null;
}
