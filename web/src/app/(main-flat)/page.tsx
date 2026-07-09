import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { loadHomeDashboardData } from "@/lib/home/loadHomeDashboard";
import { isPlaylistWatchOnlyAccess } from "@/lib/appAccess";
import { getRequestAppContext } from "@/lib/requestAppContext.server";
import { timedServerStep } from "@/lib/serverTiming";
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
  }>;
}) {
  const sp = (await searchParams) ?? {};

  const { sb, svc, user, isAdmin, appAccess } = await timedServerStep(
    "page.home.context",
    () => getRequestAppContext(),
  );

  if (!user) redirect("/login");

  if (isPlaylistWatchOnlyAccess(appAccess)) redirect("/playlist-watch");

  if (!isAdmin && !appAccess.ownCatalog && !appAccess.competitor) {
    redirect("/login");
  }

  const props = await timedServerStep(
    "page.home.dashboard",
    () =>
      loadHomeDashboardData({
        sb,
        svc,
        userId: user.id,
        sp,
        includeScatter: false,
        includeDiagnostics: false,
      }),
  );

  return <HomeDashboardClient {...props} />;
}
