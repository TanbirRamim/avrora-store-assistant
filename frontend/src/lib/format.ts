import type { Action, ActionType } from "./api";

const uah = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export const money = (v: number) => `₴${uah.format(Math.round(v))}`;
export const int = (v: number) => uah.format(Math.round(v));

export const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

export const shortDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export const TYPE_META: Record<ActionType, { label: string; color: string; verb: string }> = {
  ORDER: { label: "Reorder", color: "var(--order)", verb: "Order" },
  DISCOUNT: { label: "Mark down", color: "var(--discount)", verb: "Mark down" },
  MOVE_TO_FRONT: { label: "Move to front", color: "var(--move)", verb: "Move" },
  CHECK_DELIVERY: { label: "Chase delivery", color: "var(--delivery)", verb: "Chase" },
  EXPLAIN_ANOMALY: { label: "Store note", color: "var(--label-2)", verb: "" },
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
