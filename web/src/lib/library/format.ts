const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written as YYYY-MM-DD. */
export function isValidIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** "2026-10-23" -> "23 Oct 2026". Empty / invalid input -> "—". */
export function formatReleaseDate(value: string | null | undefined): string {
  if (!value) return "—";
  const m = ISO_DATE.exec(value.slice(0, 10));
  if (!m) return "—";
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return "—";
  return `${Number(m[3])} ${month} ${m[1]}`;
}

/** Seconds -> "m:ss". Null / invalid -> "". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return "";
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * "3:45" -> 225. A bare whole number is read as minutes ("4" -> 240).
 * Returns null for empty or invalid input.
 */
export function parseDuration(input: string | null | undefined): number | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  const mmss = /^(\d{1,4}):([0-5]\d)$/.exec(s);
  if (mmss) return Number(mmss[1]) * 60 + Number(mmss[2]);
  if (/^\d{1,4}$/.test(s)) return Number(s) * 60;
  return null;
}

/** Bytes -> "12.3 MB" (decimal megabytes). */
export function formatMegabytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return "";
  const mb = bytes / 1_000_000;
  if (mb >= 100) return `${Math.round(mb)} MB`;
  if (mb >= 10) return `${mb.toFixed(1)} MB`;
  return `${mb.toFixed(2)} MB`;
}

/** 44100 -> "44.1 kHz". */
export function formatSampleRate(hz: number | null | undefined): string {
  if (!hz || !Number.isFinite(hz) || hz <= 0) return "";
  const khz = hz / 1000;
  return `${Number.isInteger(khz) ? khz : Number(khz.toFixed(2))} kHz`;
}

/** "44.1 kHz · 24-bit · stereo". Missing parts are skipped. */
export function formatAudioSpec(file: {
  sample_rate: number | null;
  bit_depth: number | null;
  channels: number | null;
}): string {
  const parts: string[] = [];
  const rate = formatSampleRate(file.sample_rate);
  if (rate) parts.push(rate);
  if (file.bit_depth) parts.push(`${file.bit_depth}-bit`);
  if (file.channels) {
    parts.push(file.channels === 1 ? "mono" : file.channels === 2 ? "stereo" : `${file.channels} ch`);
  }
  return parts.join(" · ");
}

/** [2] -> "M2", [1, 2] -> "M1/M2". */
export function formatMVersion(versions: number[] | null | undefined): string {
  if (!versions?.length) return "";
  return versions.map((n) => `M${n}`).join("/");
}

/** "a/b/master.wav" or "a\\b\\master.wav" -> "master.wav". */
export function fileNameFromPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** Relative time for the history list. `now` is injectable for tests. */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diffS = Math.round((now - t) / 1000);
  if (diffS < 45) return "just now";
  const min = Math.round(diffS / 60);
  if (min < 60) return `${min} min ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  const date = new Date(t);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** Exact timestamp for hover text. */
export function formatExactTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/** Returns the link only if it is plain http(s); anything else (javascript:, data:) becomes null. */
export function safeExternalUrl(url: string | null | undefined): string | null {
  const raw = (url ?? "").trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** Dropbox web link for a file path: encodes each path segment. */
export function dropboxHomeUrl(path: string): string {
  const segments = path.split("/").filter((s) => s.length > 0);
  return `https://www.dropbox.com/home/${segments.map(encodeURIComponent).join("/")}`;
}
