"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/Button";

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
    <Button
      onClick={handleExport}
      title="Export as CSV"
      variant="secondary"
      size="sm"
      leftIcon={<Download className="h-3.5 w-3.5" />}
    >
      CSV
    </Button>
  );
}
