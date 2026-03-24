import { redirect } from "next/navigation";

import { loadHomeDashboardData } from "@/lib/home/loadHomeDashboard";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { HomeDashboardClient } from "./HomeDashboardClient";

// Uses Supabase session cookies; this route must be dynamic in Next 16.
export const dynamic = "force-dynamic";

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
    data: { session },
  } = await sb.auth.getSession();

  if (!session) redirect("/login");

  const { data: isAdmin } = await sb.rpc("is_admin");
  if (!isAdmin) redirect("/login");

  const svc = supabaseService();

  const props = await loadHomeDashboardData({
    sb,
    svc,
    userId: session.user.id,
    sp,
  });

  return <HomeDashboardClient {...props} />;
}
