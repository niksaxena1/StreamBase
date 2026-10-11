export function SpotifyNotFoundBadge({
  since,
  imageUrl,
}: {
  since?: string | null;
  imageUrl?: string | null;
}) {
  if (!since || imageUrl) return null;
  return (
    <span
      className="inline-flex items-center rounded-full sb-ring bg-white/60 px-2 py-0.5 text-[10px] font-medium text-black/60 dark:bg-white/10 dark:text-white/60"
      title={`Spotify has no track for this ISRC since ${since.slice(0, 10)}; rechecked monthly`}
    >
      Not on Spotify
    </span>
  );
}
