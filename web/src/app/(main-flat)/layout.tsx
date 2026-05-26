import type { Metadata } from "next";

import { AuthedAppLayout } from "@/app/_shared/AuthedAppLayout";
import { getCompetitorShellContext } from "@/lib/competitorContext.server";
import { APP_SHORT_NAME } from "@/lib/pageTitle";

export async function generateMetadata(): Promise<Metadata> {
  const { titleTemplate } = await getCompetitorShellContext();
  return {
    title: {
      default: APP_SHORT_NAME,
      template: titleTemplate,
    },
  };
}

export default async function MainFlatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AuthedAppLayout appShellProps={{ mainSurface: "plain" }}>{children}</AuthedAppLayout>;
}
