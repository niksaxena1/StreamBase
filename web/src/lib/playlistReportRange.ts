import { addDaysISO, runDateFromDataDate } from "@/lib/sotDates";

export function reportRunDates(start: string | null, end: string | null): string[] | null {
  if (start === null && end === null) return null;
  const valid = (value: string | null): value is string => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  if (!valid(start) || !valid(end)) throw new Error("Choose valid start and end dates.");
  const days = (Date.parse(end) - Date.parse(start)) / 86400000 + 1;
  if (days < 1 || days > 366) throw new Error("Choose an ordered range of up to 366 days.");
  return Array.from({ length: days }, (_, i) => runDateFromDataDate(addDaysISO(start, i)));
}

export function lastTwoTuesdays(latest: string) {
  const weekday = new Date(`${latest}T00:00:00Z`).getUTCDay();
  const end = addDaysISO(latest, -((weekday + 5) % 7));
  return { start: addDaysISO(end, -7), end };
}
