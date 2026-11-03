import type { ProductStatus, ProductUpdateKind } from "@/lib/api";
import { shortDate } from "@/lib/format";

/** Label and colours per status. Problem colours match the suggestion type behind them. */
export const STATUS_META: Record<ProductStatus, { label: string; text: string; tint: string }> = {
  late: { label: "Delivery late", text: "var(--delivery-text)", tint: "rgba(175, 82, 222, 0.12)" },
  running_out: { label: "Running out", text: "var(--order-text)", tint: "rgba(255, 59, 48, 0.12)" },
  hard_to_find: { label: "Hard to find", text: "var(--move-text)", tint: "rgba(0, 122, 255, 0.12)" },
  overstocked: { label: "Overstocked", text: "var(--discount-text)", tint: "rgba(255, 149, 0, 0.14)" },
  low: { label: "Low", text: "var(--order-text)", tint: "rgba(255, 59, 48, 0.08)" },
  on_order: { label: "On order", text: "var(--note-text)", tint: "var(--fill)" },
  ok: { label: "OK", text: "#1f7a37", tint: "rgba(52, 199, 89, 0.14)" },
};

export function StatusChip({ status }: { status: ProductStatus }) {
  const m = STATUS_META[status];
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full px-[7px] py-px text-[12px] font-semibold leading-[16px]"
      style={{ color: m.text, background: m.tint }}
    >
      {m.label}
    </span>
  );
}

export const UPDATE_COLOR: Record<ProductUpdateKind, string> = {
  suggestion: "var(--tint)",
  late: "var(--delivery)",
  expected: "var(--note)",
  received: "var(--done)",
  sold_out: "var(--order)",
  no_sales: "var(--discount)",
  promotion: "var(--move)",
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
