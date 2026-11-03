"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import useSWR from "swr";
import type { Action, Decision, DecisionKind, ProductDetail } from "@/lib/api";
import { fetcher } from "@/lib/api";
import { adjustable, money, proposalText, TYPE_META } from "@/lib/format";
import { AskSection, SupplierDraft } from "./AiAssist";
import { Chart } from "./Chart";
import { CloseIcon, TypeIcon } from "./icons";

const FACT_LABELS: Record<string, [string, string?]> = {
  stock: ["In stock", "units"],
  daily_sales: ["Sells per day", "units"],
  days_cover: ["Lasts", "days"],
  lead_time_days: ["Delivery takes", "days"],
  on_order: ["Already on order", "units"],
  stock_value: ["Stock value", "₴"],
  usual_daily_sales: ["Usually sells", "a day"],
  recent_daily_sales: ["Last two weeks", "a day"],
  drop_pct: ["Drop", "%"],
  overdue_qty: ["Units late", "units"],
  overdue_days: ["Days late", "days"],
  supplier: ["Supplier"],
};

const DISMISS_REASONS = ["Not needed", "Supplier unavailable", "Already handled"];

interface Props {
  action: Action;
  decision?: Decision;
  onClose: () => void;
  /** Saved optimistically by the page, which then moves on to the next open item. */
  onDecide: (kind: DecisionKind, opts?: { reason?: string; value?: number }) => void;
  onUndo: () => void;
  /** Phones: a press on the grabber or header starts the swipe-down-to-close gesture. */
  onGrab?: (e: React.PointerEvent) => void;
  /** Opens the key sheet; without it the AI sections show a short hint instead. */
  onAddKey?: () => void;
}

/** Single-key shortcuts stay quiet while the manager types, uses a modifier or has a dialog open. */
export function ignoreShortcut(e: KeyboardEvent) {
  if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return true;
  const t = e.target as HTMLElement | null;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return true;
  return document.querySelector('[aria-modal="true"]') !== null;
}

function formatFact(key: string, v: number | string) {
  const [, unit] = FACT_LABELS[key] ?? [];
  if (typeof v === "string") return v;
  if (unit === "₴") return money(v);
  if (key === "days_cover" && v >= 365) return "over a year";
  return `${v}${unit === "%" ? "%" : unit ? ` ${unit}` : ""}`;
}

export function DetailPanel({ action, decision, onClose, onDecide, onUndo, onAddKey, onGrab }: Props) {
  const meta = TYPE_META[action.type];
  const adj = adjustable(action);
  const [mode, setMode] = useState<"idle" | "adjust" | "dismiss">("idle");
  const [value, setValue] = useState(adj?.value ?? 0);
  const { data: product } = useSWR<ProductDetail>(`/api/products/${action.product_id}`, fetcher);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (document.querySelector('[aria-modal="true"]')) return; // the open dialog closes first
        if (mode !== "idle") setMode("idle");
        else onClose();
        return;
      }
      if (ignoreShortcut(e) || decision) return;
      if (mode === "dismiss" && /^[1-3]$/.test(e.key)) onDecide("reject", { reason: DISMISS_REASONS[Number(e.key) - 1] });
      else if (mode !== "idle") return;
      else if (e.key === "a") onDecide("approve");
      else if (e.key === "d") setMode("dismiss");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onDecide, mode, decision]);

  const history = product?.history ?? [];
  const sales = history.map((p) => ({
    date: p.date,
    value: p.units_sold ?? p.forecast,
    projected: p.units_sold === null,
  }));
  const stock = history.filter((p) => p.stock_end !== null).map((p) => ({ date: p.date, value: p.stock_end }));

  return (
    <motion.aside
      // moving to the next item swaps the content with a short fade, the sheet itself stays put
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
      className="flex h-full flex-col overflow-hidden rounded-t-[12px] bg-bg lg:rounded-none"
      aria-label={`Details for ${action.product_name}`}
    >
      <div onPointerDown={onGrab} className="touch-none lg:touch-auto">
      <div className="flex justify-center pt-2 lg:hidden" aria-hidden>
        <span className="h-[5px] w-9 rounded-full bg-label-3/60" />
      </div>
      <header className="flex items-center gap-3 border-b border-separator px-4 pb-3 pt-3 lg:pt-5">
        <span className="icon-tile size-[38px] rounded-[9px]" style={{ background: meta.color }}>
          <TypeIcon type={action.type} size={21} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="t-footnote text-label-2">
            {meta.label} · {action.category}
          </div>
          <h2 className="t-title3 line-clamp-2">{action.product_name}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="hit grid size-[30px] place-items-center rounded-full bg-fill text-label-2 hover:bg-fill-2"
        >
          <CloseIcon />
        </button>
      </header>
      </div>

      <div tabIndex={0} aria-label="Details" className="flex-1 space-y-7 overflow-y-auto px-4 pb-6 pt-2 focus-visible:outline-none">
        <section>
          <h3 className="group-header">Suggestion</h3>
          <div className="group-list">
            <div className="px-4 py-3">
              <div className="t-headline">{proposalText(action)}</div>
              <p className="t-subhead mt-1 text-label-2">{action.reason}</p>
            </div>
            <div className="relative flex justify-between px-4 py-[11px]">
              <span className="absolute left-4 right-0 top-0 h-[0.5px] bg-separator" />
              <span className="t-body">At stake</span>
              <span className="t-body num text-label-2">{money(action.risk_uah)}</span>
            </div>
          </div>
        </section>

        <section aria-label="The numbers behind this">
          <h3 className="group-header">Why</h3>
          <dl className="group-list">
            {Object.entries(action.facts).map(([k, v]) => (
              <div key={k} className="cell flex justify-between px-4 py-[11px]">
                <dt className="t-body">{FACT_LABELS[k]?.[0] ?? k}</dt>
                <dd className="t-body num text-label-2">{formatFact(k, v)}</dd>
              </div>
            ))}
          </dl>
        </section>

        <AskSection action={action} product={product} onAddKey={onAddKey} />

        {(action.type === "ORDER" || action.type === "CHECK_DELIVERY") && <SupplierDraft action={action} onAddKey={onAddKey} />}

        <section aria-busy={!product}>
          <h3 className="group-header">Trend</h3>
          <div className="group-list space-y-8 px-4 pb-4 pt-4">
          {product ? (
            <>
              <div>
                <Chart title="Units sold per day" unit="units" kind="bars" color="var(--chart-mark)" data={sales} />
                <p className="t-footnote mt-1 text-label-2">
                  Shaded area: expected sales for the next 14 days, about {product.daily_forecast.toFixed(1)} a day.
                </p>
              </div>
              <Chart title="Stock on hand" unit="units" kind="line" color="var(--chart-mark)" data={stock} />
            </>
          ) : (
            <div className="h-[340px] animate-pulse rounded-lg bg-fill" />
          )}
          </div>
        </section>
      </div>

      <footer className="material border-t border-separator bg-[var(--bar)] px-4 pb-[max(env(safe-area-inset-bottom),14px)] pt-3 lg:pb-4">
        {decision ? (
          <div className="flex min-h-[44px] items-center justify-between gap-3">
            <span className="t-subhead text-label-2">
              {decision.decision === "reject" ? `Dismissed: ${decision.reason}` : decision.decision === "change" ? `Approved with ${decision.value} ${adj?.unit ?? ""}` : "Approved"}
            </span>
            <button onClick={onUndo} className="t-subhead min-h-[44px] px-1 font-medium text-tint">
              Undo
            </button>
          </div>
        ) : mode === "adjust" && adj ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              onDecide("change", { value });
            }}
          >
            <label className="t-subhead flex min-h-[44px] min-w-0 flex-1 items-center gap-2 rounded-[10px] bg-fill px-3">
              <span className="shrink-0 text-label-2">{adj.label}</span>
              <input
                type="number"
                min={0}
                max={adj.unit === "%" ? 90 : 10000}
                value={value}
                onChange={(e) => setValue(Number(e.target.value))}
                inputMode="numeric"
                className="num w-full min-w-0 bg-transparent text-right text-[17px] font-semibold outline-none"
                autoFocus
              />
              <span className="shrink-0 text-label-2">{adj.unit}</span>
            </label>
            <button type="button" onClick={() => setMode("idle")} className="t-subhead min-h-[44px] px-2 text-tint">
              Cancel
            </button>
            <button className="t-subhead min-h-[44px] rounded-[12px] bg-tint-fill px-4 font-semibold text-white active:opacity-80">
              Approve
            </button>
          </form>
        ) : mode === "dismiss" ? (
          <div className="flex flex-wrap items-center gap-2">
            {DISMISS_REASONS.map((r) => (
              <button
                key={r}
                onClick={() => onDecide("reject", { reason: r })}
                className="t-subhead min-h-[44px] rounded-full bg-fill px-3.5 font-medium hover:bg-separator"
              >
                {r}
              </button>
            ))}
            <button onClick={() => setMode("idle")} className="t-subhead ml-auto min-h-[44px] px-1 text-tint">
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={() => onDecide("approve")}
              aria-keyshortcuts="A"
              className="flex-1 rounded-[12px] bg-tint-fill py-3 text-[17px] font-semibold text-white active:opacity-80"
            >
              Approve
            </button>
            {adj && (
              <button
                onClick={() => setMode("adjust")}
                className="rounded-[12px] bg-fill px-5 py-3 text-[17px] font-semibold text-tint"
              >
                Adjust
              </button>
            )}
            <button
              onClick={() => setMode("dismiss")}
              aria-keyshortcuts="D"
              className="rounded-[12px] bg-fill px-5 py-3 text-[17px] font-semibold text-label"
            >
              Dismiss
            </button>
          </div>
        )}
      </footer>
    </motion.aside>
  );
}
