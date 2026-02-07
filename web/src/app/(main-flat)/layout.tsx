import { AuthedAppLayout } from "@/app/_shared/AuthedAppLayout";

export default async function MainFlatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AuthedAppLayout appShellProps={{ mainSurface: "plain" }}>{children}</AuthedAppLayout>;
}

