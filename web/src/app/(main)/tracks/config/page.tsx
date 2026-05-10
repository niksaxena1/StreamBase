import { redirect } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Track Config",
};

export default async function TracksConfigPage() {
  // Redirect to the new catalog config page
  redirect("/catalog/config");
}
