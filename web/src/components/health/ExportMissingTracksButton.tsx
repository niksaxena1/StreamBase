"use client";

interface Track {
  isrc: string;
  name: string | null;
  artist_names: string[] | null;
  artist_ids: string[] | null;
  playlists: string[];
}

interface ExportMissingTracksButtonProps {
  tracks: Track[];
  date: string;
}

export function ExportMissingTracksButton({ tracks, date }: ExportMissingTracksButtonProps) {
  const handleExport = () => {
    if (tracks.length === 0) return;

    // Create CSV content
    const headers = ["ISRC", "Track Name", "Artists", "Playlists"];
    const rows = tracks.map((track) => {
      const artists = track.artist_names?.join(", ") || "";
      const playlists = track.playlists.join(", ");
      return [
        track.isrc,
        track.name || "",
        artists,
        playlists,
      ];
    });

    const csvContent = [
      headers.join(","),
      ...rows.map((row) =>
        row.map((cell) => {
          // Escape quotes and wrap in quotes if contains comma, quote, or newline
          const str = String(cell);
          if (str.includes(",") || str.includes('"') || str.includes("\n")) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        }).join(",")
      ),
    ].join("\n");

    // Create blob and download
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `missing-catalog-tracks-${date}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (tracks.length === 0) return null;

  return (
    <button
      onClick={handleExport}
      className="flex items-center gap-1.5 rounded-full bg-white/70 px-2.5 py-1.5 text-[11px] font-medium transition hover:bg-white dark:bg-white/10 dark:hover:bg-white/20"
      title="Export as CSV"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="opacity-70"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      CSV
    </button>
  );
}
