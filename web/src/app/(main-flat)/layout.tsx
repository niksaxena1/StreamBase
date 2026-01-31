import { AppShell } from "@/components/shell/AppShell";
import { supabaseServer } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function MainFlatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sb = await supabaseServer();
  const {
    data: { session },
  } = await sb.auth.getSession();

  if (!session) {
    // Middleware should already redirect, but keep a hard server-side guard.
    redirect("/login");
  }

  return <AppShell mainSurface="plain">{children}</AppShell>;
}

