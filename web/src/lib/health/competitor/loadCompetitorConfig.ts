import fs from "node:fs";
import path from "node:path";

export type CompetitorConfigPlaylist = {
  playlist_key: string;
  label_key: string;
  display_name: string;
};

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export function loadCompetitorConfigPlaylists(): CompetitorConfigPlaylist[] {
  const candidates = [
    path.join(process.cwd(), "config", "competitor_playlists.csv"),
    path.join(process.cwd(), "..", "config", "competitor_playlists.csv"),
  ];
  const csvPath = candidates.find((p) => fs.existsSync(p));
  if (!csvPath) return [];

  const raw = fs.readFileSync(csvPath, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  const keyIdx = headers.indexOf("playlist_key");
  const labelIdx = headers.indexOf("label_key");
  const nameIdx = headers.indexOf("display_name");
  if (keyIdx < 0 || labelIdx < 0) return [];

  const rows: CompetitorConfigPlaylist[] = [];
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const playlist_key = cols[keyIdx]?.trim();
    const label_key = cols[labelIdx]?.trim();
    if (!playlist_key || !label_key) continue;
    rows.push({
      playlist_key,
      label_key,
      display_name: (nameIdx >= 0 ? cols[nameIdx] : playlist_key)?.trim() || playlist_key,
    });
  }
  return rows;
}
