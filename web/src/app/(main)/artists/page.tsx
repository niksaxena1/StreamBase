import { redirect } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Artists",
};

export default function ArtistsPage() {
  // Redirect to the new catalog config page
  redirect("/catalog/config");
}
