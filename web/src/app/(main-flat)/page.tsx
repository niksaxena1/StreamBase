import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { loadHomeDashboardData } from "@/lib/home/loadHomeDashboard";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { isPlaylistWatchOnlyAccess, normalizeAppAccess } from "@/lib/appAccess";
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
  const sp = (await searchParams) ?? {};

  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();

  if (!user) redirect("/login");

  const svc = supabaseService();
  const { data: isAdmin } = await sb.rpc("is_admin");
  const { data: accessRow } = await svc
    .from("app_user_access")
    .select("own_catalog,competitor,playlist_watch,playlist_watch_admin")
    .eq("user_id", user.id)
    .maybeSingle();
  const appAccess = normalizeAppAccess(accessRow, Boolean(isAdmin));
  if (isPlaylistWatchOnlyAccess(appAccess)) redirect("/playlist-watch");

  if (!isAdmin && !appAccess.ownCatalog && !appAccess.competitor) {
    redirect("/login");
  }

  const props = await loadHomeDashboardData({
    sb,
    svc,
    userId: user.id,
    sp,
    includeScatter: false,
  });

  return <HomeDashboardClient {...props} />;
}
