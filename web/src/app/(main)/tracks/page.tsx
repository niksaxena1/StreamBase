import { redirect } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Tracks",
};

export default function TracksPage() {
  // Redirect to the new catalog config page
  redirect("/catalog/config");
}
