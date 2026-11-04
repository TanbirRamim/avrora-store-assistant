import type { ProductStatus, ProductUpdateKind } from "@/lib/api";
import { shortDate } from "@/lib/format";

/** Word and colour per status. Red only for urgency, orange for not-urgent warnings. */
export const STATUS_META: Record<ProductStatus, { label: string; text: string }> = {
  late: { label: "Delivery late", text: "var(--orange)" },
  running_out: { label: "Running out", text: "#b91c1c" },
  hard_to_find: { label: "Hard to find", text: "#3f3f46" },
  overstocked: { label: "Overstocked", text: "var(--orange)" },
  low: { label: "Low", text: "#b91c1c" },
  on_order: { label: "On order", text: "var(--muted)" },
  ok: { label: "OK", text: "var(--green)" },
};

/** Tinted background per status (Polaris-style badge). */
export const STATUS_BG: Record<ProductStatus, string> = {
  late: "var(--warning-bg)",
  running_out: "var(--critical-bg)",
  hard_to_find: "var(--neutral-bg)",
  overstocked: "var(--warning-bg)",
  low: "var(--critical-bg)",
  on_order: "var(--neutral-bg)",
  ok: "var(--success-bg)",
};

/** Status as a small badge: soft tint, darker text, 6 px dot. */
export function StatusChip({ status }: { status: ProductStatus }) {
  const m = STATUS_META[status];
  return (
    <span
      className="inline-flex h-[22px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-[12px] font-medium leading-[16px]"
      style={{ color: m.text, background: STATUS_BG[status] }}
    >
      <span className="size-1.5 rounded-full" style={{ background: STATUS_DOT[status] }} aria-hidden />
      {m.label}
    </span>
  );
}

/** Solid colour per status, for dots. */
export const STATUS_DOT: Record<ProductStatus, string> = {
  late: "var(--orange)",
  running_out: "var(--red)",
  hard_to_find: "#52525b",
  overstocked: "var(--orange)",
  low: "var(--red)",
  on_order: "#71717a",
  ok: "var(--green)",
};

/** Days of cover the bar treats as full. */
export const COVER_SCALE = 30;

/** Slim bar: how long the stock lasts, out of a month. Decorative; the text next to it says the same. */
export function CoverBar({ days, status, className = "" }: { days: number | null; status: ProductStatus; className?: string }) {
  const pct = days === null ? 0 : Math.max(4, Math.min(1, days / COVER_SCALE) * 100);
  return (
    <span className={`block h-[3px] overflow-hidden rounded-full bg-[#f4f4f5] ${className}`} aria-hidden>
      <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: status === "running_out" || status === "low" ? "var(--red)" : "#71717a" }} />
    </span>
  );
}

export const UPDATE_COLOR: Record<ProductUpdateKind, string> = {
  suggestion: "#52525b",
  late: "var(--orange)",
  expected: "#a1a1aa",
  received: "var(--green)",
  sold_out: "var(--red)",
  no_sales: "var(--orange)",
  promotion: "#52525b",
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
