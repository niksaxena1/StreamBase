export function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map((n) => Number(n));
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function formatYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function formatDisplay(date: Date): string {
  const d = String(date.getDate()).padStart(2, "0");
  const m = date.toLocaleString("en-US", { month: "short" });
  const y = date.getFullYear();
  return `${d} ${m} ${y}`;
}
