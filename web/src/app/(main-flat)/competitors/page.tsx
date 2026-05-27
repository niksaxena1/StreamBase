import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { supabaseServer } from "@/lib/supabase/server";
import { loadCompetitorsPageCore } from "@/lib/competitors/loadCompetitorsPage";
import { PageHeader } from "@/components/shell/PageHeader";
import { formatDateISO } from "@/lib/format";

import { CompetitorsClient } from "./CompetitorsClient";
import { CompetitorsIntelSections } from "./CompetitorsIntelSections";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Competitors",
};

export default async function CompetitorsPage() {
  const sb = await supabaseServer();
  const { data: userData } = await sb.auth.getUser();
  if (!userData.user) redirect("/login");
  const { data: isAdmin } = await sb.rpc("is_admin");
  if (!isAdmin) redirect("/");

  const loaded = await loadCompetitorsPageCore(userData.user);
  if (loaded.status === "wrong-mode") redirect("/");

  let subtitle: ReactNode = "No competitor data found yet.";
  if (loaded.status === "ok") {
    subtitle = (
      <>
        Latest data date: <span className="font-mono">{formatDateISO(loaded.data.latestDataDate)}</span>
      </>
    );
  }

  const core = loaded.status === "ok" ? loaded.data : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Competitors"
        subtitle={subtitle}
        actions={
          <Link href="/health" className="sb-link-hover text-xs whitespace-nowrap">
            Pipeline health &amp; ingestion status →
          </Link>
        }
      />

      {core ? (
        <>
          <CompetitorsClient
            labels={core.labels}
            comparisonRows={core.comparisonRows}
            labelSeries={core.labelSeries}
            latestDataDate={core.latestDataDate}
            latestRunDate={core.latestRunDate}
            selectedCompetitorLabelKey={core.selectedCompetitorLabelKey}
            playlistsByLabel={core.playlistsByLabel}
          />

          <CompetitorsIntelSections
            labels={core.labels}
            latestDataDate={core.latestDataDate}
            latestRunDate={core.latestRunDate}
          />
        </>
      ) : null}
    </div>
  );
}
