"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import useSWR from "swr";
import type { Action, Decision, DecisionKind, ProductDetail } from "@/lib/api";
import { fetcher } from "@/lib/api";
import { adjustable, money, proposalText, TYPE_META } from "@/lib/format";
import { AskSection, SupplierDraft } from "./AiAssist";
import { Chart } from "./Chart";
import { CheckIcon, CloseIcon, TypeIcon } from "./icons";

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

  const facts = Object.entries(action.facts);
  const reduce = useReducedMotion();

  return (
    <motion.aside
      // moving to the next item swaps the content with a short fade, the sheet itself stays put
      initial={reduce ? false : { opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
      className="flex h-full flex-col overflow-hidden rounded-t-[20px] bg-floor lg:rounded-none"
      aria-label={`Details for ${action.product_name}`}
    >
      <div onPointerDown={onGrab} className="touch-none lg:touch-auto">
        <div className="flex justify-center pt-2 lg:hidden" aria-hidden>
          <span className="h-[5px] w-9 rounded-full bg-[rgba(0,0,0,0.2)]" />
        </div>
        <header className="flex items-start gap-3 px-5 pb-3 pt-2 lg:pt-6">
          <span
            className="grid size-[40px] shrink-0 place-items-center rounded-full"
            style={
              action.type === "CHECK_DELIVERY"
                ? { boxShadow: "inset 0 0 0 1.5px var(--ink)", color: "var(--ink)" }
                : { background: meta.color, color: "#fff" }
            }
          >
            <TypeIcon type={action.type} size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="t-footnote font-semibold" style={{ color: meta.text }}>
              {meta.label}
              <span className="font-normal text-muted">, {action.category}</span>
            </p>
            <h2 className="t-title3 line-clamp-2">{action.product_name}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close details" className="-mr-2 -mt-1 grid size-[44px] shrink-0 place-items-center">
            <span className="grid size-[32px] place-items-center rounded-full bg-fill text-ink hover:bg-fill-2">
              <CloseIcon />
            </span>
          </button>
        </header>
      </div>

      <div tabIndex={0} aria-label="Details" className="flex-1 space-y-7 overflow-y-auto px-4 pb-8 pt-1 focus-visible:outline-none">
        <section aria-label="Suggestion" className="price-tag">
          <p className="t-footnote pl-3 font-semibold">Suggestion</p>
          <p className="t-title2 mt-1 pl-3">{proposalText(action)}</p>
          <p className="t-subhead mt-1.5 pl-3">{action.reason}</p>
          <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-[rgba(0,0,0,0.15)] pl-3 pt-3">
            <span className="t-subhead font-medium">At stake</span>
            <span className="font-display num text-[24px] font-bold leading-7">{money(action.risk_uah)}</span>
          </div>
        </section>

        <section aria-label="The numbers behind this">
          <h3 className="t-headline mb-2 px-1">Why</h3>
          <dl className="overflow-hidden rounded-[14px] bg-paper">
            {facts.map(([k, v]) => (
              <div key={k} className="cell flex min-h-[44px] items-center justify-between gap-4 px-4 py-[11px]">
                <dt className="t-subhead shrink-0 text-muted">{FACT_LABELS[k]?.[0] ?? k}</dt>
                <dd className="t-body num min-w-0 text-right font-semibold">{formatFact(k, v)}</dd>
              </div>
            ))}
          </dl>
        </section>

        <AskSection action={action} product={product} onAddKey={onAddKey} />

        {(action.type === "ORDER" || action.type === "CHECK_DELIVERY") && <SupplierDraft action={action} onAddKey={onAddKey} />}

        <section aria-busy={!product} aria-label="Sales and stock">
          <h3 className="t-headline mb-2 px-1">Sales and stock</h3>
          <div className="space-y-7 rounded-[14px] bg-paper p-4">
            {product ? (
              <>
                <div>
                  <Chart title="Units sold per day" unit="units" kind="bars" color="var(--chart-mark)" data={sales} />
                  <p className="t-footnote mt-2 text-muted">
                    Grey band: expected sales for the next 14 days, about {product.daily_forecast.toFixed(1)} a day.
                  </p>
                </div>
                <Chart title="Stock on hand" unit="units" kind="line" color="var(--chart-mark)" data={stock} />
              </>
            ) : (
              <div className="h-[340px] animate-pulse rounded-[12px] bg-fill" />
            )}
          </div>
        </section>
      </div>

      <footer className="border-t border-[var(--rule)] bg-paper px-4 pb-[max(env(safe-area-inset-bottom),14px)] pt-3 lg:pb-4">
        {decision ? (
          <div className="flex min-h-[50px] items-center justify-between gap-3">
            <span className="t-subhead flex items-center gap-2 font-medium">
              <span
                className="grid size-6 place-items-center rounded-full text-white"
                style={{ background: decision.decision === "reject" ? "var(--muted)" : "var(--green)" }}
                aria-hidden
              >
                {decision.decision === "reject" ? <CloseIcon size={11} /> : <CheckIcon size={12} />}
              </span>
              {decision.decision === "reject" ? `Dismissed: ${decision.reason}` : decision.decision === "change" ? `Approved with ${decision.value} ${adj?.unit ?? ""}` : "Approved"}
            </span>
            <button onClick={onUndo} className="btn-ghost min-h-[44px] px-5 text-[15px]">
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
            <label className="t-subhead flex min-h-[48px] min-w-0 flex-1 items-center gap-2 rounded-[14px] bg-floor px-3.5 shadow-[inset_0_0_0_1.5px_var(--ink)]">
              <span className="shrink-0 text-muted">{adj.label}</span>
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
              <span className="shrink-0 text-muted">{adj.unit}</span>
            </label>
            <button type="button" onClick={() => setMode("idle")} className="t-subhead min-h-[44px] px-2 font-semibold underline underline-offset-4">
              Cancel
            </button>
            <button className="btn-ink px-5">
              Approve
            </button>
          </form>
        ) : mode === "dismiss" ? (
          <div>
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="t-subhead font-semibold">Why dismiss it?</span>
              <button onClick={() => setMode("idle")} className="t-subhead min-h-[44px] px-1 font-semibold underline underline-offset-4">
                Cancel
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-1">
              {DISMISS_REASONS.map((r, i) => (
                <button
                  key={r}
                  onClick={() => onDecide("reject", { reason: r })}
                  aria-keyshortcuts={String(i + 1)}
                  className="btn-ghost justify-between px-5 text-left"
                >
                  {r}
                  <kbd className="t-caption hidden rounded-[5px] bg-fill px-1.5 py-0.5 font-sans text-muted lg:inline">{i + 1}</kbd>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={() => onDecide("approve")}
              aria-keyshortcuts="A"
              className="btn-ink min-h-[52px] flex-1"
            >
              <CheckIcon size={15} />
              Approve
            </button>
            {adj && (
              <button
                onClick={() => setMode("adjust")}
                className="btn-ghost min-h-[52px] px-5"
              >
                Adjust
              </button>
            )}
            <button
              onClick={() => setMode("dismiss")}
              aria-keyshortcuts="D"
              className="btn-ghost min-h-[52px] px-5"
            >
              Dismiss
            </button>
          </div>
        )}
      </footer>
    </motion.aside>
  );
}
