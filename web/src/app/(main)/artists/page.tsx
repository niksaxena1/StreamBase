import { redirect } from "next/navigation";

export default function ArtistsPage() {
  // Redirect to the new catalog config page
  redirect("/catalog/config");
}
