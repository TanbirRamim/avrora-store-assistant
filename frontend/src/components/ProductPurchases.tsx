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

const CHIP = {
  received: { text: "#1f7a37", tint: "rgba(52, 199, 89, 0.14)" },
  on_the_way: { text: "var(--note-text)", tint: "var(--fill)" },
  late: { text: "var(--delivery-text)", tint: "rgba(175, 82, 222, 0.12)" },
} as const;

function chipLabel(p: Purchase): string {
  if (p.status === "received") return "Received";
  if (p.status === "on_the_way") return "On the way";
  return p.received ? `${days(p.days_late)} late` : `Late by ${days(p.days_late)}`;
}

function Row({ p, today }: { p: Purchase; today: string }) {
  const c = CHIP[p.status];
  // the arrow ends at the arrival date; an order still out ends at its due date
  const end = p.received ? shortDate(p.received) : `due ${inline(p.expected, today)}`;
  const detail = p.received ? `took ${days(between(p.ordered, p.received))}` : p.status === "late" ? "not arrived yet" : null;
  return (
    <li className="cell flex items-center gap-3 px-4 py-[10px]">
      <span className="min-w-0 flex-1">
        <span className="t-body num block truncate">
          {shortDate(p.ordered)} <span aria-hidden>→</span>
          <span className="sr-only">to</span> {end}
        </span>
        <span className="t-footnote num block truncate text-label-2">
          {units(p.qty)}
          {detail && ` · ${detail}`}
        </span>
      </span>
      <span
        className="inline-flex shrink-0 items-center rounded-full px-[7px] py-px text-[12px] font-semibold leading-[16px]"
        style={{ color: c.text, background: c.tint }}
      >
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
      <h3 className="group-header flex items-baseline justify-between">
        <span>Purchase history</span>
        {list.length > PREVIEW && (
          <button type="button" onClick={() => setAll((v) => !v)} className="t-footnote font-medium normal-case text-tint">
            {all ? "Show less" : `Show all ${list.length}`}
          </button>
        )}
      </h3>
      {loading ? (
        <div className="group-list h-[180px] animate-pulse" />
      ) : list.length === 0 ? (
        <div className="group-list t-subhead px-4 py-3 text-label-2">No orders in the last 90 days.</div>
      ) : (
        <ul className="group-list" aria-label="Purchase history">
          {s && (
            <li className="cell px-4 py-[10px]">
              <span className="t-body num block">
                {s.orders} {s.orders === 1 ? "order" : "orders"} · {units(s.units)}
              </span>
              {(facts.length > 0 || s.last_received) && (
                <span className="t-footnote num block text-label-2">
                  {[...facts, s.last_received && `last arrived ${inline(s.last_received, today)}`]
                    .filter((f): f is string => Boolean(f))
                    .map((f, i) => (
                      <Fragment key={i}>
                        {i > 0 && " · "}
                        <span className="whitespace-nowrap">{i === 0 ? f.replace(/^./, (ch) => ch.toUpperCase()) : f}</span>
                      </Fragment>
                    ))}
                </span>
              )}
            </li>
          )}
          {shown.map((p) => (
            <Row key={p.id} p={p} today={today} />
          ))}
        </ul>
      )}
    </section>
  );
}
