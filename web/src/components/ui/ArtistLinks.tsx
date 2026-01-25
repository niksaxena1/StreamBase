import Link from "next/link";

export function ArtistLinks(props: {
  artistNames: string[] | null | undefined;
  artistIds: string[] | null | undefined;
  className?: string;
}) {
  if (!props.artistNames?.length) return null;

  const names = props.artistNames;
  const ids = props.artistIds ?? [];

  return (
    <div className={props.className}>
      {names.map((name, idx) => {
        const artistId = ids[idx] ?? null;
        return (
          <span key={`${name}-${idx}`}>
            {artistId ? (
              <Link
                href={`/dashboard/artists?artist_id=${encodeURIComponent(artistId)}`}
                className="font-medium transition-colors hover:text-lime-600 dark:hover:text-lime-400 underline"
              >
                {name}
              </Link>
            ) : (
              <span className="font-medium">{name}</span>
            )}
            {idx < names.length - 1 ? ", " : ""}
          </span>
        );
      })}
    </div>
  );
}
