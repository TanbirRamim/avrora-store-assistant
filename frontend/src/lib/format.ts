import type { Action, ActionType } from "./api";

const uah = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export const money = (v: number) => `₴${uah.format(Math.round(v))}`;
export const int = (v: number) => uah.format(Math.round(v));

export const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

export const shortDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export const TYPE_META: Record<ActionType, { label: string; short: string; color: string; text: string; verb: string }> = {
  ORDER: { label: "Reorder", short: "Reorder", color: "var(--order)", text: "var(--order-text)", verb: "Order" },
  DISCOUNT: { label: "Mark down", short: "Mark down", color: "var(--discount)", text: "var(--discount-text)", verb: "Mark down" },
  MOVE_TO_FRONT: { label: "Move to front", short: "Move", color: "var(--move)", text: "var(--move-text)", verb: "Move" },
  CHECK_DELIVERY: { label: "Chase delivery", short: "Chase", color: "var(--delivery)", text: "var(--delivery-text)", verb: "Chase" },
  EXPLAIN_ANOMALY: { label: "Store note", short: "Note", color: "var(--note)", text: "var(--note-text)", verb: "" },
};

/** The one concrete step the manager is asked to approve. */
export function proposalText(a: Action): string {
  const p = a.proposal;
  switch (a.type) {
    case "ORDER":
      return `Order ${p.order_qty} from ${p.supplier}`;
    case "DISCOUNT":
      return `${p.discount_pct}% off until stock clears`;
    case "MOVE_TO_FRONT":
      return "Move to a visible shelf";
    case "CHECK_DELIVERY":
      return String(p.step);
    default:
      return String(p.step ?? "");
  }
}

export function adjustable(a: Action): { key: string; label: string; unit: string; value: number } | null {
  if (a.type === "ORDER") return { key: "order_qty", label: "Quantity", unit: "units", value: Number(a.proposal.order_qty) };
  if (a.type === "DISCOUNT") return { key: "discount_pct", label: "Discount", unit: "%", value: Number(a.proposal.discount_pct) };
  return null;
}
