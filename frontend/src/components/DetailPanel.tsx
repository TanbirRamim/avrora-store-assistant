"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import useSWR from "swr";
import type { Action, Decision, DecisionKind, ProductDetail } from "@/lib/api";
import { fetcher } from "@/lib/api";
import { adjustable, money, proposalText } from "@/lib/format";
import { AskSection, SupplierDraft } from "./AiAssist";
import { TypeBadge } from "./ActionRow";
import { ProductThumb } from "./CategoryIcon";
import { Chart } from "./Chart";
import { CheckIcon, CloseIcon } from "./icons";

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

const CARD = "rounded-[12px] border border-[var(--border)] bg-paper shadow-[0_1px_2px_rgba(16,24,40,0.04)]";
const PRIMARY = "inline-flex items-center justify-center gap-2 rounded-[10px] bg-ink px-5 text-[15px] font-medium text-white transition-colors hover:bg-[#27272a] active:bg-[#3f3f46]";
const SECONDARY = "inline-flex items-center justify-center gap-2 rounded-[10px] border border-[var(--border)] bg-paper px-4 text-[15px] font-medium text-ink transition-colors hover:bg-[#fafafa] active:bg-[#f4f4f5]";
const H3 = "mb-2 px-1 text-[15px] font-semibold leading-[20px]";

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
      className="flex h-full flex-col overflow-hidden rounded-t-[16px] bg-floor lg:rounded-none"
      aria-label={`Details for ${action.product_name}`}
    >
      <div onPointerDown={onGrab} className="touch-none lg:touch-auto">
        <div className="flex justify-center pt-2 lg:hidden" aria-hidden>
          <span className="h-[5px] w-9 rounded-full bg-[#d4d4d8]" />
        </div>
        <header className="flex items-start gap-3 border-b border-[var(--border)] bg-paper px-5 pb-4 pt-2 lg:pt-5">
          {/* same anatomy as the product sheet: thumb, category, name, then the figure and a badge */}
          <ProductThumb category={action.category} size={48} />
          <div className="min-w-0 flex-1">
            <p className="t-footnote text-muted">{action.category}</p>
            <h2 className="mt-0.5 text-[20px] font-semibold leading-[26px] tracking-[-0.02em]">{action.product_name}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="num text-[24px] font-semibold leading-[30px] tracking-[-0.02em]">
                {money(action.risk_uah)}
                <span className="ml-1.5 text-[14px] font-normal tracking-normal text-muted">at stake</span>
              </span>
              <TypeBadge type={action.type} />
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close details" className="-mr-2 -mt-1 grid size-[44px] shrink-0 place-items-center">
            <span className="grid size-[32px] place-items-center rounded-full bg-[#f4f4f5] text-muted hover:bg-[#e4e4e7] hover:text-ink">
              <CloseIcon />
            </span>
          </button>
        </header>
      </div>

      <div tabIndex={0} aria-label="Details" className="flex-1 space-y-6 overflow-y-auto px-4 pb-8 pt-4 focus-visible:outline-none">
        <section aria-label="Suggestion" className={`${CARD} overflow-hidden`}>
          <div className="border-l-[3px] border-ink px-4 py-4">
            <p className="t-footnote font-medium text-muted">Suggestion</p>
            <p className="mt-1 text-[20px] font-semibold leading-[26px] tracking-[-0.02em]">{proposalText(action)}</p>
            <p className="mt-1.5 text-[14px] leading-[20px] text-muted">{action.reason}</p>
          </div>
        </section>

        <section aria-label="The numbers behind this">
          <h3 className={H3}>Why</h3>
          <dl className={`${CARD} grid grid-cols-2 overflow-hidden`}>
            {facts.map(([k, v], i) => (
              <div
                key={k}
                className={`min-w-0 px-4 py-3 ${i % 2 === 1 ? "border-l border-[var(--divider)]" : ""} ${i > 1 ? "border-t border-[var(--divider)]" : ""} ${
                  i === facts.length - 1 && i % 2 === 0 ? "col-span-2" : ""
                }`}
              >
                <dt className="t-footnote text-muted">{FACT_LABELS[k]?.[0] ?? k}</dt>
                <dd className="num mt-0.5 truncate text-[17px] font-semibold leading-[22px] tracking-[-0.01em]">{formatFact(k, v)}</dd>
              </div>
            ))}
          </dl>
        </section>

        <AskSection action={action} product={product} onAddKey={onAddKey} />

        {(action.type === "ORDER" || action.type === "CHECK_DELIVERY") && <SupplierDraft action={action} onAddKey={onAddKey} />}

        <section aria-busy={!product} aria-label="Sales and stock">
          <h3 className={H3}>Sales and stock</h3>
          <div className={`${CARD} space-y-7 p-4`}>
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
              <div className="h-[340px] animate-pulse rounded-[10px] bg-[#f4f4f5]" />
            )}
          </div>
        </section>
      </div>

      <footer className="border-t border-[var(--border)] bg-paper px-4 pb-[max(env(safe-area-inset-bottom),14px)] pt-3 lg:pb-4">
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
            <button onClick={onUndo} className={`${SECONDARY} min-h-[44px]`}>
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
            <label className="t-subhead flex min-h-[48px] min-w-0 flex-1 items-center gap-2 rounded-[10px] border border-ink bg-paper px-3 shadow-[0_0_0_3px_rgba(24,24,27,0.12)]">
              <span className="shrink-0 text-muted">{adj.label}</span>
              <input
                type="number"
                min={0}
                max={adj.unit === "%" ? 90 : 10000}
                value={value}
                onChange={(e) => setValue(Number(e.target.value))}
                inputMode="numeric"
                className="num w-full min-w-0 bg-transparent text-right text-[16px] font-semibold outline-none"
                autoFocus
              />
              <span className="shrink-0 text-muted">{adj.unit}</span>
            </label>
            <button type="button" onClick={() => setMode("idle")} className="min-h-[44px] px-2 text-[15px] font-medium text-muted hover:text-ink">
              Cancel
            </button>
            <button className={`${PRIMARY} min-h-[48px]`}>
              Approve
            </button>
          </form>
        ) : mode === "dismiss" ? (
          <div>
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-[15px] font-semibold">Why dismiss it?</span>
              <button onClick={() => setMode("idle")} className="min-h-[44px] px-1 text-[15px] font-medium text-muted hover:text-ink">
                Cancel
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-1">
              {DISMISS_REASONS.map((r, i) => (
                <button
                  key={r}
                  onClick={() => onDecide("reject", { reason: r })}
                  aria-keyshortcuts={String(i + 1)}
                  className={`${SECONDARY} min-h-[48px] justify-between text-left`}
                >
                  {r}
                  <kbd className="t-caption hidden rounded-[5px] border border-[var(--border)] bg-[#fafafa] px-1.5 py-0.5 font-sans text-muted lg:inline">{i + 1}</kbd>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={() => onDecide("approve")}
              aria-keyshortcuts="A"
              className={`${PRIMARY} min-h-[48px] flex-1`}
            >
              <CheckIcon size={15} />
              Approve
            </button>
            {adj && (
              <button
                onClick={() => setMode("adjust")}
                className={`${SECONDARY} min-h-[48px]`}
              >
                Adjust
              </button>
            )}
            <button
              onClick={() => setMode("dismiss")}
              aria-keyshortcuts="D"
              className={`${SECONDARY} min-h-[48px]`}
            >
              Dismiss
            </button>
          </div>
        )}
      </footer>
    </motion.aside>
  );
}
