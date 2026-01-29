import { redirect } from "next/navigation";

export default function TracksPage() {
  // Redirect to the new catalog config page
  redirect("/catalog/config");
}
