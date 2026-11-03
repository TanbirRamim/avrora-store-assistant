/**
 * Urgent signals: things worth waking a store manager's phone for.
 *
 * Each source is a function returning signals. To add a feed (power outages, air alerts, ...),
 * write a SignalSource and append it to SOURCES. A signal's `key` must be stable for the same
 * event, because the cron job sends each key to each phone only once.
 */
import snapshot from "./snapshot.json";

export interface Signal {
  /** Stable id for dedupe, e.g. "action:ORDER-P043" or "outage:2026-11-03T08". */
  key: string;
  title: string;
  body: string;
  /** In-app link opened when the notification is tapped. */
  url: string;
  /** Higher is more urgent; used to pick what to send first. */
  priority: number;
}

export interface SignalContext {
  db: D1Database;
  now: Date;
}

export type SignalSource = (ctx: SignalContext) => Promise<Signal[]> | Signal[];

type SnapshotAction = (typeof snapshot.actions)[number];

const actionUrl = (id: string) => `/?action=${encodeURIComponent(id)}`;
const uah = (n: number) => `₴${Math.round(n).toLocaleString("en-US")}`;

/** Items about to run out and late deliveries, skipping anything the manager already decided. */
export const storeActions: SignalSource = async ({ db }) => {
  const { results } = await db.prepare("SELECT action_id FROM decisions").all<{ action_id: string }>();
  const decided = new Set(results.map((r) => r.action_id));
  const out: Signal[] = [];
  for (const a of snapshot.actions as SnapshotAction[]) {
    if (decided.has(a.id)) continue;
    const facts = a.facts as Record<string, number | string | undefined>;
    if (a.type === "ORDER") {
      const cover = Number(facts.days_cover);
      const lead = Number(facts.lead_time_days);
      // Urgent when stock runs out before a new order could arrive.
      if (!(cover < lead)) continue;
      out.push({
        key: `action:${a.id}`,
        title: `Running out: ${a.product_name}`,
        body: `${a.reason} ${uah(a.risk_uah)} at stake.`,
        url: actionUrl(a.id),
        priority: a.risk_uah,
      });
    } else if (a.type === "CHECK_DELIVERY") {
      out.push({
        key: `action:${a.id}`,
        title: `Late delivery: ${a.product_name}`,
        body: `${a.reason} ${uah(a.risk_uah)} at stake.`,
        url: actionUrl(a.id),
        priority: a.risk_uah,
      });
    }
  }
  return out;
};

/** Store notes from the briefing, such as an outage that hit yesterday's sales. */
export const briefingNotices: SignalSource = () =>
  snapshot.briefing.notices.map((n) => ({
    key: `notice:${n.id}`,
    title: "Store note",
    body: n.reason,
    url: "/",
    priority: 0,
  }));

// briefingNotices is left out: the snapshot note is a past outage that needs no action.
export const SOURCES: SignalSource[] = [storeActions];

/** Runs every source; one failing feed does not block the others. */
export async function collectSignals(ctx: SignalContext, sources = SOURCES): Promise<Signal[]> {
  const settled = await Promise.allSettled(sources.map((s) => s(ctx)));
  const out: Signal[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") out.push(...r.value);
    else console.error("signal source failed", r.reason);
  }
  return out.sort((a, b) => b.priority - a.priority);
}
