"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import useSWR from "swr";
import type { Action, Decision, DecisionKind, ProductDetail } from "@/lib/api";
import { fetcher } from "@/lib/api";
import { adjustable, money, proposalText, TYPE_META } from "@/lib/format";
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
  onDecide: (kind: DecisionKind, opts?: { reason?: string; value?: number }) => Promise<void>;
  onUndo: () => Promise<void>;
}

function formatFact(key: string, v: number | string) {
  const [, unit] = FACT_LABELS[key] ?? [];
  if (typeof v === "string") return v;
  if (unit === "₴") return money(v);
  if (key === "days_cover" && v >= 365) return "over a year";
  return `${v}${unit === "%" ? "%" : unit ? ` ${unit}` : ""}`;
}

export function DetailPanel({ action, decision, onClose, onDecide, onUndo }: Props) {
  const meta = TYPE_META[action.type];
  const adj = adjustable(action);
  const [mode, setMode] = useState<"idle" | "adjust" | "dismiss">("idle");
  const [value, setValue] = useState(adj?.value ?? 0);
  const [busy, setBusy] = useState(false);
  const { data: product } = useSWR<ProductDetail>(`/api/products/${action.product_id}`, fetcher);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      setMode("idle");
    } finally {
      setBusy(false);
    }
  };

  const history = product?.history ?? [];
  const sales = history.map((p) => ({
    date: p.date,
    value: p.units_sold ?? p.forecast,
    projected: p.units_sold === null,
  }));
  const stock = history.filter((p) => p.stock_end !== null).map((p) => ({ date: p.date, value: p.stock_end }));

  return (
    <motion.aside
      key="panel"
      initial={{ x: 40, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 40, opacity: 0 }}
      transition={{ type: "spring", stiffness: 420, damping: 38 }}
      className="flex h-full flex-col overflow-hidden bg-surface lg:rounded-l-2xl lg:shadow-[var(--shadow)]"
      aria-label={`Details for ${action.product_name}`}
    >
      <div className="flex justify-center pt-2 lg:hidden" aria-hidden>
        <span className="h-[5px] w-9 rounded-full bg-label-3/60" />
      </div>
      <header className="flex items-start gap-3 border-b border-separator px-5 pb-4 pt-3 lg:pt-5">
        <div
          className="grid size-9 shrink-0 place-items-center rounded-[10px] text-white"
          style={{ background: meta.color }}
        >
          <TypeIcon type={action.type} size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-medium text-label-2">
            {meta.label} · {action.category}
          </div>
          <h2 className="truncate text-[20px] font-semibold tracking-[-0.01em]">{action.product_name}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="grid size-7 place-items-center rounded-full bg-fill text-label-2 hover:text-label"
        >
          <CloseIcon />
        </button>
      </header>

      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
        <section>
          <p className="text-[15px] leading-relaxed text-label">{action.reason}</p>
          <div className="mt-3 flex items-baseline justify-between rounded-xl bg-surface-2 px-4 py-3 ring-1 ring-separator">
            <span className="text-[15px] font-semibold">{proposalText(action)}</span>
            <span className="num text-[13px] text-label-2">{money(action.risk_uah)} at stake</span>
          </div>
        </section>

        <section aria-label="The numbers behind this">
          <h3 className="mb-2 text-[13px] font-semibold text-label-2">Why</h3>
          <dl className="divide-y divide-separator overflow-hidden rounded-xl bg-surface-2 ring-1 ring-separator">
            {Object.entries(action.facts).map(([k, v]) => (
              <div key={k} className="flex justify-between px-4 py-2.5 text-[14px]">
                <dt className="text-label-2">{FACT_LABELS[k]?.[0] ?? k}</dt>
                <dd className="num font-medium">{formatFact(k, v)}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="space-y-5" aria-busy={!product}>
          {product ? (
            <>
              <Chart
                title="Units sold per day"
                unit="units"
                kind="bars"
                color={meta.color}
                data={sales}
              />
              <Chart title="Stock on hand" unit="units" kind="line" color="var(--label)" data={stock} />
              <p className="text-[12px] text-label-3">
                Shaded area: expected sales for the next 14 days ({product.daily_forecast} a day).
              </p>
            </>
          ) : (
            <div className="h-[340px] animate-pulse rounded-xl bg-fill" />
          )}
        </section>
      </div>

      <footer className="border-t border-separator bg-[color-mix(in_srgb,var(--surface)_85%,transparent)] px-5 py-4 backdrop-blur">
        {decision ? (
          <div className="flex items-center justify-between">
            <span className="text-[14px] text-label-2">
              {decision.decision === "reject" ? `Dismissed: ${decision.reason}` : decision.decision === "change" ? `Approved with ${decision.value} ${adj?.unit ?? ""}` : "Approved"}
            </span>
            <button disabled={busy} onClick={() => run(onUndo)} className="text-[14px] font-medium text-tint">
              Undo
            </button>
          </div>
        ) : mode === "adjust" && adj ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => onDecide("change", { value }));
            }}
          >
            <label className="flex flex-1 items-center gap-2 rounded-[10px] bg-fill px-3 py-2 text-[14px]">
              <span className="text-label-2">{adj.label}</span>
              <input
                type="number"
                min={0}
                max={adj.unit === "%" ? 90 : 10000}
                value={value}
                onChange={(e) => setValue(Number(e.target.value))}
                className="num w-full bg-transparent text-right font-semibold outline-none"
                autoFocus
              />
              <span className="text-label-2">{adj.unit}</span>
            </label>
            <button type="button" onClick={() => setMode("idle")} className="px-3 py-2 text-[14px] text-tint">
              Cancel
            </button>
            <button disabled={busy} className="rounded-[10px] bg-tint px-4 py-2 text-[14px] font-semibold text-white">
              Approve
            </button>
          </form>
        ) : mode === "dismiss" ? (
          <div className="flex flex-wrap items-center gap-2">
            {DISMISS_REASONS.map((r) => (
              <button
                key={r}
                disabled={busy}
                onClick={() => run(() => onDecide("reject", { reason: r }))}
                className="rounded-full bg-fill px-3 py-1.5 text-[13px] font-medium hover:bg-separator"
              >
                {r}
              </button>
            ))}
            <button onClick={() => setMode("idle")} className="ml-auto text-[14px] text-tint">
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              disabled={busy}
              onClick={() => run(() => onDecide("approve"))}
              className="flex-1 rounded-[10px] bg-tint py-2.5 text-[15px] font-semibold text-white active:opacity-80"
            >
              Approve
            </button>
            {adj && (
              <button
                onClick={() => setMode("adjust")}
                className="rounded-[10px] bg-fill px-4 py-2.5 text-[15px] font-medium text-tint"
              >
                Adjust
              </button>
            )}
            <button
              onClick={() => setMode("dismiss")}
              className="rounded-[10px] bg-fill px-4 py-2.5 text-[15px] font-medium text-label"
            >
              Dismiss
            </button>
          </div>
        )}
      </footer>
    </motion.aside>
  );
}
