"use client";

import { Fragment, useState } from "react";
import type { Purchase, PurchaseSummary } from "@/lib/api";
import { shortDate } from "@/lib/format";
import { dayLabel } from "./ProductStatus";

const PREVIEW = 5;
const DAY = 86_400_000;

const units = (n: number) => `${n.toLocaleString("en-GB")} ${n === 1 ? "unit" : "units"}`;
const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;
const between = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY);

/** "today", "yesterday", "tomorrow" or "4 Nov", for use inside a sentence. */
const inline = (iso: string, today: string) => {
  const label = dayLabel(iso, today);
  return /^\d/.test(label) ? label : label.toLowerCase();
};

const DOT = { received: "var(--green)", on_the_way: "#8a8a83", late: "var(--orange)" } as const;
const CARD = "rounded-[14px] bg-paper";

const CHIP = {
  received: { text: "var(--green)" },
  on_the_way: { text: "var(--muted)" },
  late: { text: "var(--orange)" },
} as const;

function chipLabel(p: Purchase): string {
  if (p.status === "received") return "Received";
  if (p.status === "on_the_way") return "On the way";
  return p.received ? `${days(p.days_late)} late` : `Late by ${days(p.days_late)}`;
}

function Row({ p, today, last }: { p: Purchase; today: string; last: boolean }) {
  const c = CHIP[p.status];
  // the arrow ends at the arrival date; an order still out ends at its due date
  const end = p.received ? shortDate(p.received) : `due ${inline(p.expected, today)}`;
  const detail = p.received ? `took ${days(between(p.ordered, p.received))}` : p.status === "late" ? "not arrived yet" : null;
  return (
    <li className="relative flex items-center gap-3 py-2.5 pl-4 pr-4">
      {!last && <span className="absolute bottom-[-12px] left-[20px] top-[30px] w-[1.5px] bg-[var(--rule)]" aria-hidden />}
      <span className="mt-[2px] size-[9px] shrink-0 self-start rounded-full translate-y-[6px]" style={{ background: DOT[p.status] }} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="t-subhead num block font-medium">
          {shortDate(p.ordered)} <span aria-hidden>→</span>
          <span className="sr-only">to</span> {end}
        </span>
        <span className="t-footnote num block text-muted">
          {units(p.qty)}
          {detail && `, ${detail}`}
        </span>
      </span>
      <span className="shrink-0 whitespace-nowrap text-[13px] font-semibold leading-[18px]" style={{ color: c.text }}>
        {chipLabel(p)}
      </span>
    </li>
  );
}

/** Supplier orders for one product, newest first: a summary line, then each order with its status. */
export function ProductPurchases({ purchases, summary, today }: { purchases?: Purchase[]; summary?: PurchaseSummary | null; today: string }) {
  const [all, setAll] = useState(false);
  const loading = purchases === undefined;
  const list = purchases ?? [];
  const shown = all ? list : list.slice(0, PREVIEW);
  const s = summary;
  const facts = s
    ? [
        s.avg_lead_days !== null && `usually takes ${days(Math.round(s.avg_lead_days))}`,
        s.on_time_pct !== null && `${s.on_time_pct}% on time`,
      ].filter(Boolean)
    : [];

  return (
    <section aria-busy={loading}>
      <h3 className="t-headline mb-2 flex min-h-[24px] items-center justify-between px-1">
        <span>Purchase history</span>
        {list.length > PREVIEW && (
          <button type="button" onClick={() => setAll((v) => !v)} className="t-subhead -my-3 min-h-[44px] px-1 font-semibold underline underline-offset-4">
            {all ? "Show less" : `Show all ${list.length}`}
          </button>
        )}
      </h3>
      {loading ? (
        <div className={`${CARD} h-[180px] animate-pulse`} />
      ) : list.length === 0 ? (
        <div className={`${CARD} t-subhead px-4 py-4 text-muted`}>No orders in the last 90 days.</div>
      ) : (
        <ul className={`${CARD} overflow-hidden pb-1.5`} aria-label="Purchase history">
          {s && (
            <li className="mb-1.5 border-b border-[var(--rule)] px-4 py-3">
              <span className="t-body num block font-semibold">
                {s.orders} {s.orders === 1 ? "order" : "orders"}, {units(s.units)}
              </span>
              {(facts.length > 0 || s.last_received) && (
                <span className="t-footnote num block text-muted">
                  {[...facts, s.last_received && `last arrived ${inline(s.last_received, today)}`]
                    .filter((f): f is string => Boolean(f))
                    .map((f, i) => (
                      <Fragment key={i}>
                        {i > 0 && ", "}
                        <span className="whitespace-nowrap">{i === 0 ? f.replace(/^./, (ch) => ch.toUpperCase()) : f}</span>
                      </Fragment>
                    ))}
                </span>
              )}
            </li>
          )}
          {shown.map((p, i) => (
            <Row key={p.id} p={p} today={today} last={i === shown.length - 1} />
          ))}
        </ul>
      )}
    </section>
  );
}
