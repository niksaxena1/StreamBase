import type { Metadata } from "next";

import { loadChartsPage } from "@/lib/charts/loadChartsPage";
import { parseCompareDays, parseIsoDate } from "@/lib/charts/chartsModel";

import { ChartsClient } from "./ChartsClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Charts",
};

type SearchParams = {
  date?: string | string[];
  compare?: string | string[];
};

export default async function ChartsPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const sp = (await searchParams) ?? {};
  const data = await loadChartsPage({
    date: parseIsoDate(sp.date),
    compareDays: parseCompareDays(sp.compare),
  });

  return <ChartsClient data={data} />;
}
