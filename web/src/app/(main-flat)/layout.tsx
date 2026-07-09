import type { Metadata } from "next";

import { AuthedAppLayout } from "@/app/_shared/AuthedAppLayout";
import { APP_SHORT_NAME } from "@/lib/pageTitle";
import { getRequestAppContext } from "@/lib/requestAppContext.server";

export async function generateMetadata(): Promise<Metadata> {
  const { shellContext } = await getRequestAppContext();
  return {
    title: {
      default: APP_SHORT_NAME,
      template: shellContext.titleTemplate,
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
