import { redirect } from "next/navigation";

export default async function TracksConfigPage() {
  // Redirect to the new catalog config page
  redirect("/catalog/config");
}
