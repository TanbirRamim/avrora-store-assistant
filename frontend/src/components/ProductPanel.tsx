"use client";

import { motion } from "motion/react";
import { useEffect } from "react";
import useSWR from "swr";
import type { Action, ProductDetail, ProductRow } from "@/lib/api";
import { fetcher } from "@/lib/api";
import { money, proposalText, TYPE_META } from "@/lib/format";
import { Chart } from "./Chart";
import { ChevronIcon, CloseIcon, TypeIcon } from "./icons";
import { ProductPurchases } from "./ProductPurchases";
import { coverText, dayLabel, signed, STATUS_META, StatusChip, UPDATE_COLOR } from "./ProductStatus";

interface Props {
  row: ProductRow;
  today: string;
  onClose: () => void;
  onOpenAction?: (actionId: string) => void;
}

const units = (n: number) => `${n} ${n === 1 ? "unit" : "units"}`;

function Rows({ items }: { items: [string, React.ReactNode, string?][] }) {
  return (
    <dl className="group-list">
      {items.map(([k, v, color]) => (
        <div key={k} className="cell flex justify-between gap-4 px-4 py-[11px]">
          <dt className="t-body shrink-0">{k}</dt>
          <dd className="t-body num min-w-0 truncate text-right text-label-2" style={color ? { color } : undefined}>
            {v}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** One product: key facts, open suggestion, recent changes and trend. Sheet on phones, inspector on desktop. */
/** "Today" reads as "today" mid-sentence; dates keep their capital month. */
const relative = (label: string) => (/^(Today|Yesterday|Tomorrow)$/.test(label) ? label.toLowerCase() : label);

export function ProductPanel({ row, today, onClose, onOpenAction }: Props) {
  const { data: product } = useSWR<ProductDetail>(`/api/products/${row.product_id}`, fetcher);
  const { data: actions } = useSWR<Action[]>("/api/actions", fetcher);
  const meta = STATUS_META[row.status];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const history = product?.history ?? [];
  const sales = history.map((p) => ({ date: p.date, value: p.units_sold ?? p.forecast, projected: p.units_sold === null }));
  const stock = history.filter((p) => p.stock_end !== null).map((p) => ({ date: p.date, value: p.stock_end }));
  const full = new Map((actions ?? []).map((a) => [a.id, a]));
  const nd = row.next_delivery;
  const open = (id: string) => onOpenAction?.(id);

  return (
    <motion.aside
      initial={{ x: 40, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 40, opacity: 0 }}
      transition={{ type: "spring", stiffness: 420, damping: 38 }}
      className="flex h-full flex-col overflow-hidden rounded-t-[12px] bg-bg lg:rounded-none"
      aria-label={`Product ${row.name}`}
    >
      <div className="flex justify-center pt-2 lg:hidden" aria-hidden>
        <span className="h-[5px] w-9 rounded-full bg-label-3/60" />
      </div>
      <header className="flex items-center gap-3 border-b border-separator px-4 pb-3 pt-3 lg:pt-5">
        <div className="min-w-0 flex-1">
          <div className="t-footnote flex items-center gap-1.5 text-label-2">
            <StatusChip status={row.status} />
            <span className="truncate">{row.category}</span>
          </div>
          <h2 className="t-title3 mt-0.5 truncate">{row.name}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close product"
          className="grid size-[30px] shrink-0 place-items-center rounded-full bg-fill text-label-2 hover:bg-fill-2"
        >
          <CloseIcon />
        </button>
      </header>

      <div tabIndex={0} aria-label="Product details" className="flex-1 space-y-7 overflow-y-auto px-4 pb-6 pt-2 focus-visible:outline-none">
        {row.actions.length > 0 && (
          <section>
            <h3 className="group-header">{row.actions.length > 1 ? "Open suggestions" : "Open suggestion"}</h3>
            <ul className="group-list">
              {row.actions.map((ref) => {
                const a = full.get(ref.id);
                const tm = TYPE_META[ref.type];
                return (
                  <li key={ref.id} className="cell [--inset:52px]">
                    <button
                      type="button"
                      onClick={() => open(ref.id)}
                      disabled={!onOpenAction}
                      className="flex w-full items-center gap-3 py-[10px] pl-4 pr-3 text-left active:bg-fill"
                    >
                      <span className="icon-tile size-[30px]" style={{ background: tm.color }}>
                        <TypeIcon type={ref.type} size={17} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="t-body block">{a ? proposalText(a) : tm.label}</span>
                        <span className="t-footnote block text-label-2">
                          {tm.label} · {money(ref.risk_uah)} at stake
                        </span>
                      </span>
                      {onOpenAction && <ChevronIcon size={13} className="shrink-0 text-[#c4c4c7]" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section>
          <h3 className="group-header">Stock</h3>
          <Rows
            items={[
              ["In stock", units(row.stock)],
              ["Sells per day", row.daily_sales > 0 ? `about ${row.daily_sales.toFixed(1)}` : "none lately"],
              ["Lasts", coverText(row.days_cover), row.attention && row.status !== "overstocked" ? meta.text : undefined],
              ["On order", row.on_order ? units(row.on_order) : "Nothing"],
              [
                "Next delivery",
                nd ? `${units(nd.qty)}, ${nd.late ? `was due ${relative(dayLabel(nd.date, today))}` : relative(dayLabel(nd.date, today))}` : "None booked",
                nd?.late ? "var(--delivery-text)" : undefined,
              ],
              ["Price", `₴${row.price.toFixed(2)}`],
              ["Supplier", row.supplier],
              ...(product ? [["Delivery takes", `${product.lead_time_days} days`] as [string, string]] : []),
            ]}
          />
        </section>

        <section>
          <h3 className="group-header">Last 7 days</h3>
          <Rows
            items={[
              ["Sold", units(row.sold_7d)],
              ["Received", units(row.received_7d)],
              ["Stock change", row.stock_change_7d === null ? "No data" : signed(row.stock_change_7d)],
              ["Last sale", row.last_sale ? dayLabel(row.last_sale, today) : "None in 90 days"],
            ]}
          />
        </section>

        <ProductPurchases purchases={product ? (product.purchases ?? []) : undefined} summary={product?.purchase_summary} today={today} />

        <section aria-busy={!product}>
          <h3 className="group-header">Updates</h3>
          {product ? (
            <ul className="group-list" aria-label="Product updates">
              {(product.updates ?? []).map((u, i) => (
                <li key={i} className="cell flex items-start gap-3 px-4 py-[10px] [--inset:34px]">
                  <span className="mt-[7px] size-2 shrink-0 rounded-full" style={{ background: UPDATE_COLOR[u.kind] }} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="t-subhead block">{u.text}</span>
                    <span className="t-footnote block text-label-2">{dayLabel(u.date, today)}</span>
                  </span>
                </li>
              ))}
              {(product.updates ?? []).length === 0 && (
                <li className="t-subhead px-4 py-3 text-label-2">No changes in the last two weeks.</li>
              )}
            </ul>
          ) : (
            <div className="group-list h-[120px] animate-pulse" />
          )}
        </section>

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

      {row.actions.length > 0 && onOpenAction && (
        <footer className="border-t border-separator bg-[rgba(249,249,249,0.94)] px-4 pb-[max(env(safe-area-inset-bottom),14px)] pt-3 backdrop-blur-xl">
          <button
            onClick={() => open(row.actions[0].id)}
            className="w-full rounded-[12px] bg-tint-fill py-3 text-[17px] font-semibold text-white active:opacity-80"
          >
            Review suggestion
          </button>
        </footer>
      )}
    </motion.aside>
  );
}
