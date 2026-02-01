export type ManualOverrideTooltipItem = {
  note: string;
  title?: string;
  imageUrl?: string | null;
};

function isIsoDateString(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function isoDateToNoonUtc(dateString: string): Date {
  // Using noon UTC avoids local timezone shifting the calendar date.
  const [y, m, d] = dateString.split("-").map((x) => Number(x));
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0));
}

function getOrdinalSuffix(n: number): string {
  const j = n % 10;
  const k = n % 100;
  if (j === 1 && k !== 11) return "st";
  if (j === 2 && k !== 12) return "nd";
  if (j === 3 && k !== 13) return "rd";
  return "th";
}

export function formatTooltipDateDaily(dateString: string): string {
  const date = isIsoDateString(dateString) ? isoDateToNoonUtc(dateString) : new Date(dateString);
  const dayOfWeek = date.toLocaleDateString("en-US", { weekday: "long" });
  const day = date.getDate();
  const month = date.toLocaleDateString("en-US", { month: "short" });
  const year = date.getFullYear();
  return `${dayOfWeek}, ${day}${getOrdinalSuffix(day)} ${month} ${year}`;
}

export function formatUsdCompact(n: number, fallback: (n: number) => string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(n);
  } catch {
    return fallback(n);
  }
}

export function showCopiedToast(message: string) {
  try {
    const existing = document.getElementById("sb-copied-toast");
    if (existing) existing.remove();

    const notification = document.createElement("div");
    notification.id = "sb-copied-toast";
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background-color: #22c55e;
      color: white;
      padding: 12px 16px;
      border-radius: 8px;
      font-size: 14px;
      z-index: 9999;
      box-shadow: 0 10px 25px rgba(0,0,0,0.25);
    `;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 2000);
  } catch {
    // ignore toast failures
  }
}

export function extractOverrideItemsFromRechartsPayload(payload: unknown): ManualOverrideTooltipItem[] | null {
  if (!Array.isArray(payload) || payload.length === 0) return null;
  const first = payload[0];
  if (!first || typeof first !== "object") return null;
  const firstObj = first as Record<string, unknown>;
  const inner = firstObj.payload;
  if (!inner || typeof inner !== "object") return null;
  const innerObj = inner as Record<string, unknown>;
  const items = innerObj._overrideItems;
  if (!Array.isArray(items) || items.length === 0) return null;

  return items
    .filter((it) => it && typeof it === "object" && typeof (it as Record<string, unknown>).note === "string")
    .map((it) => {
      const obj = it as Record<string, unknown>;
      return {
        note: String(obj.note),
        title: obj.title ? String(obj.title) : undefined,
        imageUrl:
          obj.imageUrl === null || typeof obj.imageUrl === "string"
            ? (obj.imageUrl as string | null)
            : null,
      };
    });
}

