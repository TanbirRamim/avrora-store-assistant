"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect } from "react";
import useSWR from "swr";
import type { Action, ProductDetail, ProductRow } from "@/lib/api";
import { fetcher } from "@/lib/api";
import { money, proposalText, TYPE_META } from "@/lib/format";
import { Chart } from "./Chart";
import { CloseIcon, TruckIcon } from "./icons";
import { ProductPurchases } from "./ProductPurchases";
import { coverText, dayLabel, signed, STATUS_META, StatusChip, UPDATE_COLOR } from "./ProductStatus";

interface Props {
  row: ProductRow;
  today: string;
  onClose: () => void;
  onOpenAction?: (actionId: string) => void;
}

const units = (n: number) => `${n} ${n === 1 ? "unit" : "units"}`;
const LIST = "overflow-hidden rounded-[14px] bg-paper";
const H3 = "t-headline mb-2 px-1";

function Rows({ items }: { items: [string, React.ReactNode, string?][] }) {
  return (
    <dl className={LIST}>
      {items.map(([k, v, color]) => (
        <div key={k} className="cell flex min-h-[44px] items-center justify-between gap-4 px-4 py-[11px]">
          <dt className="t-subhead shrink-0 text-muted">{k}</dt>
          <dd className="t-subhead num min-w-0 text-right font-medium" style={color ? { color } : undefined}>
            {v}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** One key number in the plain 2×2 list: hairlines between, no cards. */
function Stat({ label, value, unit, color, i }: { label: string; value: React.ReactNode; unit?: string; color?: string; i: number }) {
  return (
    <div className={`px-4 py-3 ${i % 2 === 1 ? "border-l border-[var(--rule)]" : ""} ${i > 1 ? "border-t border-[var(--rule)]" : ""}`}>
      <dt className="t-footnote text-muted">{label}</dt>
      <dd className="num mt-0.5 text-[20px] font-semibold leading-[26px]" style={color ? { color } : undefined}>
        {value}
        {unit && <span className="t-subhead font-normal text-muted"> {unit}</span>}
      </dd>
    </div>
  );
}

/** "Today" reads as "today" mid-sentence; dates keep their capital month. */
const relative = (label: string) => (/^(Today|Yesterday|Tomorrow)$/.test(label) ? label.toLowerCase() : label);

/** One product: key facts, open suggestion, recent changes and trend. Sheet on phones, inspector on desktop. */
export function ProductPanel({ row, today, onClose, onOpenAction }: Props) {
  const { data: product } = useSWR<ProductDetail>(`/api/products/${row.product_id}`, fetcher);
  const { data: actions } = useSWR<Action[]>("/api/actions", fetcher);
  const reduce = useReducedMotion();
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
  const coverWarn = row.attention && (row.status === "running_out" || row.status === "low") ? meta.text : undefined;
  const cover = row.days_cover === null ? "Not selling" : coverText(row.days_cover);
  const [coverNum, ...coverUnit] = cover.split(" ");
  const numeric = /^\d/.test(coverNum);

  return (
    <motion.aside
      initial={reduce ? { opacity: 0 } : { y: 24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={reduce ? { opacity: 0 } : { y: 24, opacity: 0 }}
      transition={reduce ? { duration: 0.15 } : { type: "spring", stiffness: 420, damping: 38 }}
      className="float flex h-full flex-col overflow-hidden rounded-t-[18px] bg-floor lg:rounded-[18px]"
      aria-label={`Product ${row.name}`}
    >
      <div className="flex justify-center pt-2 lg:hidden" aria-hidden>
        <span className="h-[5px] w-9 rounded-full bg-[rgba(0,0,0,0.2)]" />
      </div>
      <header className="flex items-start gap-3 px-5 pb-4 pt-2 lg:pt-5">
        <div className="min-w-0 flex-1">
          <p className="t-footnote text-muted">
            {row.category}, from {row.supplier}
          </p>
          <h2 className="t-title2 mt-1">{row.name}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="font-display num text-[26px] font-bold leading-[30px]">₴{row.price.toFixed(2)}</span>
            <StatusChip status={row.status} />
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close product" className="-mr-2 -mt-1 grid size-[44px] shrink-0 place-items-center">
          <span className="grid size-[32px] place-items-center rounded-full bg-fill text-ink transition-colors hover:bg-fill-2">
            <CloseIcon />
          </span>
        </button>
      </header>

      <div tabIndex={0} aria-label="Product details" className="flex-1 space-y-7 overflow-y-auto overscroll-contain px-4 pb-[max(env(safe-area-inset-bottom),24px)] pt-1 focus-visible:outline-none">
        {row.actions.length > 0 && (
          <section>
            <h3 className={H3}>{row.actions.length > 1 ? "Open suggestions" : "Open suggestion"}</h3>
            <ul className={LIST}>
              {row.actions.map((ref, i) => {
                const a = full.get(ref.id);
                const tm = TYPE_META[ref.type];
                return (
                  <li key={ref.id} className="cell relative border-l-[6px] border-yellow px-4 py-3.5">
                    <p className="t-footnote font-semibold" style={{ color: tm.text }}>
                      {tm.label}
                    </p>
                    <p className="t-body mt-0.5 font-semibold">{a ? proposalText(a) : tm.label}</p>
                    <p className="t-footnote num text-muted">{money(ref.risk_uah)} at stake</p>
                    {onOpenAction && (
                      <button type="button" onClick={() => open(ref.id)} className={`${i === 0 ? "btn-ink" : "btn-ghost"} mt-3 w-full sm:w-auto`}>
                        Review suggestion
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section>
          <h3 className={H3}>Stock</h3>
          <dl className={`${LIST} grid grid-cols-2`}>
            <Stat i={0} label="In stock" value={row.stock} unit={row.stock === 1 ? "unit" : "units"} />
            <Stat i={1} label="Lasts" value={numeric ? coverNum : cover} unit={numeric ? coverUnit.join(" ") : undefined} color={coverWarn} />
            <Stat i={2} label="Sells per day" value={row.daily_sales > 0 ? row.daily_sales.toFixed(1) : "None"} unit={row.daily_sales > 0 ? "a day" : "lately"} />
            <Stat i={3} label="Sold this week" value={row.sold_7d} unit={row.sold_7d === 1 ? "unit" : "units"} />
          </dl>
          <div className={`${LIST} mt-3 flex min-h-[56px] items-center gap-3 px-4 py-3`}>
            <span className="shrink-0" style={{ color: nd?.late ? "var(--orange)" : "var(--ink)" }}>
              <TruckIcon size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="t-footnote block text-muted">Next delivery</span>
              <span className="t-body num block font-medium" style={nd?.late ? { color: "var(--orange)" } : undefined}>
                {nd ? `${units(nd.qty)}, ${nd.late ? `was due ${relative(dayLabel(nd.date, today))}` : relative(dayLabel(nd.date, today))}` : "None booked"}
              </span>
            </span>
          </div>
        </section>

        <section>
          <h3 className={H3}>Details</h3>
          <Rows
            items={[
              ["On order", row.on_order ? units(row.on_order) : "Nothing"],
              ...(product ? [["Delivery takes", `${product.lead_time_days} days`] as [string, string]] : []),
              ["Received this week", units(row.received_7d)],
              ["Stock change this week", row.stock_change_7d === null ? "No data" : signed(row.stock_change_7d)],
              ["Last sale", row.last_sale ? dayLabel(row.last_sale, today) : "None in 90 days"],
            ]}
          />
        </section>

        <ProductPurchases purchases={product ? (product.purchases ?? []) : undefined} summary={product?.purchase_summary} today={today} />

        <section aria-busy={!product}>
          <h3 className={H3}>Updates</h3>
          {product ? (
            <ul className="px-1" aria-label="Product updates">
              {(product.updates ?? []).map((u, i, all) => (
                <li key={i} className="relative flex items-start gap-3 py-2">
                  {i < all.length - 1 && <span className="absolute bottom-[-8px] left-[4px] top-[24px] w-[1.5px] bg-[var(--rule)]" aria-hidden />}
                  <span className="mt-[6px] size-[10px] shrink-0 rounded-full" style={{ background: UPDATE_COLOR[u.kind] }} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="t-subhead block">{u.text}</span>
                    <span className="t-footnote block text-muted">{dayLabel(u.date, today)}</span>
                  </span>
                </li>
              ))}
              {(product.updates ?? []).length === 0 && <li className="t-subhead py-2 text-muted">No changes in the last two weeks.</li>}
            </ul>
          ) : (
            <div className={`${LIST} h-[120px] animate-pulse`} />
          )}
        </section>

        <section aria-busy={!product}>
          <h3 className={H3}>Trend</h3>
          <div className={`${LIST} space-y-8 p-4`}>
            {product ? (
              <>
                <div>
                  <Chart title="Units sold per day" unit="units" kind="bars" color="var(--chart-mark)" data={sales} />
                  <p className="t-footnote mt-1 text-muted">Grey band: expected sales for the next 14 days, about {product.daily_forecast.toFixed(1)} a day.</p>
                </div>
                <Chart title="Stock on hand" unit="units" kind="line" color="var(--chart-mark)" data={stock} />
              </>
            ) : (
              <div className="h-[340px] animate-pulse rounded-lg bg-fill" />
            )}
          </div>
        </section>
      </div>
    </motion.aside>
  );
}
