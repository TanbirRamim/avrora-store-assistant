import type { ProductStatus, ProductUpdateKind } from "@/lib/api";
import { shortDate } from "@/lib/format";

/** Word and colour per status. Red only for urgency, orange for not-urgent warnings. */
export const STATUS_META: Record<ProductStatus, { label: string; text: string }> = {
  late: { label: "Delivery late", text: "var(--orange)" },
  running_out: { label: "Running out", text: "var(--red)" },
  hard_to_find: { label: "Hard to find", text: "var(--ink)" },
  overstocked: { label: "Overstocked", text: "var(--orange)" },
  low: { label: "Low", text: "var(--red)" },
  on_order: { label: "On order", text: "var(--muted)" },
  ok: { label: "OK", text: "var(--green)" },
};

/** Status as a coloured dot and a word, never a filled pill. */
export function StatusChip({ status }: { status: ProductStatus }) {
  const m = STATUS_META[status];
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[13px] font-semibold leading-[18px]" style={{ color: m.text }}>
      <span className="size-2 rounded-full" style={{ background: STATUS_DOT[status] }} aria-hidden />
      {m.label}
    </span>
  );
}

/** Solid colour per status, for dots. */
export const STATUS_DOT: Record<ProductStatus, string> = {
  late: "var(--orange)",
  running_out: "var(--red)",
  hard_to_find: "var(--ink)",
  overstocked: "var(--orange)",
  low: "var(--red)",
  on_order: "#8a8a83",
  ok: "var(--green)",
};

/** Days of cover the bar treats as full. */
export const COVER_SCALE = 30;

/** Slim bar: how long the stock lasts, out of a month. Decorative; the text next to it says the same. */
export function CoverBar({ days, status, className = "" }: { days: number | null; status: ProductStatus; className?: string }) {
  const pct = days === null ? 0 : Math.max(4, Math.min(1, days / COVER_SCALE) * 100);
  return (
    <span className={`block h-[4px] overflow-hidden rounded-full bg-[var(--rule)] ${className}`} aria-hidden>
      <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: status === "running_out" || status === "low" ? "var(--red)" : "var(--ink)" }} />
    </span>
  );
}

export const UPDATE_COLOR: Record<ProductUpdateKind, string> = {
  suggestion: "var(--ink)",
  late: "var(--orange)",
  expected: "#8a8a83",
  received: "var(--green)",
  sold_out: "var(--red)",
  no_sales: "var(--orange)",
  promotion: "var(--ink)",
};

/** Days of cover in plain words. */
export function coverText(days: number | null): string {
  if (days === null) return "Not selling";
  if (days >= 365) return "Over a year";
  if (days < 10) return `${days === 1 ? "1 day" : `${days.toFixed(1)} days`}`;
  return `${Math.round(days)} days`;
}

const DAY = 86_400_000;

/** "Today", "Yesterday", "Tomorrow" or "4 Nov", relative to the store's today. */
export function dayLabel(iso: string, today: string): string {
  const diff = Math.round((Date.parse(`${iso}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / DAY);
  if (diff === 0) return "Today";
  if (diff === -1) return "Yesterday";
  if (diff === 1) return "Tomorrow";
  return shortDate(iso);
}

export const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");
