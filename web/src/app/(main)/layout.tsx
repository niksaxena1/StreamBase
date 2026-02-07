import { AuthedAppLayout } from "@/app/_shared/AuthedAppLayout";

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AuthedAppLayout>{children}</AuthedAppLayout>;
}
