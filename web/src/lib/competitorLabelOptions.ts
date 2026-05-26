import type { supabaseService } from "@/lib/supabase/service";

type Svc = ReturnType<typeof supabaseService>;

export type CompetitorLabelOption = {
  value: string;
  label: string;
  imageUrl: string | null;
};

export async function loadCompetitorLabelOptions(svc: Svc): Promise<CompetitorLabelOption[]> {
  const comp = svc.schema("competitor");
  const { data: labels } = await comp
    .from("labels")
    .select("label_key,display_name")
    .eq("is_active", true)
    .order("display_name", { ascending: true });

  const { data: playlists } = await comp
    .from("playlists")
    .select("label_key,spotify_playlist_image_url,display_order")
    .eq("is_active", true)
    .order("display_order", { ascending: true, nullsFirst: false });

  const imageByLabel = new Map<string, string | null>();
  for (const playlist of playlists ?? []) {
    const lk = String(playlist.label_key ?? "");
    if (!lk || imageByLabel.has(lk)) continue;
    imageByLabel.set(lk, (playlist.spotify_playlist_image_url as string | null) ?? null);
  }

  return (labels ?? []).map((label) => {
    const value = String(label.label_key ?? "").trim();
    return {
      value,
      label: String(label.display_name ?? value).trim(),
      imageUrl: imageByLabel.get(value) ?? null,
    };
  }).filter((row) => row.value);
}
