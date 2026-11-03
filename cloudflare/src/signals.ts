/**
 * Urgent signals: things worth waking a store manager's phone for.
 *
 * Each source is a function returning signals. To add a feed (power outages, air alerts, ...),
 * write a SignalSource and append it to SOURCES. A signal's `key` must be stable for the same
 * event, because the cron job sends each key to each phone only once.
 */
import { externalSignals, type ExternalSignal } from "./external";
import snapshot from "./snapshot.json";
import { employeeName, planStates, sickFromAvailability, type DayState } from "./workforce";

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
  /** Live air-raid alerts need an alerts.in.ua token. */
  alertsToken?: string;
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

/** Push power cuts from 2 hours before they start; alerts and notable weather once each. */
const PUSH_AHEAD_MS = 2 * 3_600_000;

function externalPush(e: ExternalSignal, now: Date): Signal | null {
  const demo = e.simulated ? "Demo: " : "";
  if (e.kind === "power") {
    if (Date.parse(e.starts_at) - now.getTime() > PUSH_AHEAD_MS) return null;
    return { key: e.id, title: `${demo}${e.title}`, body: `${e.detail} Open the app to re-plan today.`, url: "/", priority: 1e9 };
  }
  if (e.kind === "air_alert") {
    return { key: e.id, title: `${demo}${e.title}`, body: e.detail, url: "/", priority: 2e9 };
  }
  return { key: e.id, title: e.title, body: e.detail, url: "/", priority: 0 };
}

/** Scheduled power cuts, air-raid alerts and notable weather (see external.ts). */
export const externalConditions: SignalSource = async ({ db, now, alertsToken }) => {
  const { signals } = await externalSignals(db, now, { ALERTS_IN_UA_TOKEN: alertsToken });
  return signals.map((e) => externalPush(e, now)).filter((s): s is Signal => s !== null);
};

// ----------------------------------------------------------------------------- staffing
// Same rules as staffing_signals in backend/src/avrora/api/signals.py. Plans run on the demo
// calendar: when the Kyiv date has no plan, "today" is the first plan date and only the clock is real.

export type Severity = "high" | "medium" | "low";
export interface StaffingSignal extends Signal {
  kind: "unapproved" | "gap" | "sick" | "no_lead";
  severity: Severity;
}
interface StaffPlan {
  opening: { open: string; close: string };
  shifts: { role: string }[];
  gaps: { from: string; to: string; missing: number; reason: string }[];
}

const STAFFING_PRIORITY: Record<Severity, number> = { high: 1_500_000_000, medium: 500_000_000, low: 0 };
const APPROVE_FROM_HOUR = 7;
export const teamUrl = (day: string) => `/?view=team&date=${day}`;
const people = (n: number) => (n === 1 ? "1 person" : `${n} people`);
const hourOf = (hhmm: string) => Number.parseInt(hhmm.slice(0, 2), 10);

/** Kyiv calendar date and fractional hour. */
export function kyivClock(now: Date): { date: string; hour: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) + Number(parts.minute) / 60 };
}

/**
 * plans: plan in force per date; approved: per date; sick: per date, [employee_id, name, reported]
 * where reported means a sick re-plan was drafted today (a sick call) rather than known in advance.
 */
export function staffingSignals(
  now: Date,
  plans: Record<string, StaffPlan>,
  approved: Record<string, boolean>,
  sick: Record<string, [string, string, boolean][]>,
): StaffingSignal[] {
  const dates = Object.keys(plans).sort();
  if (dates.length === 0) return [];
  const clock = kyivClock(now);
  const today = plans[clock.date] ? clock.date : dates[0];
  const hour = clock.hour;
  const tomorrow = dates.find((d) => d > today);
  const openToday = hour < hourOf(plans[today].opening.close);
  const out: StaffingSignal[] = [];
  const add = (key: string, kind: StaffingSignal["kind"], severity: Severity, title: string, body: string, day: string) =>
    out.push({ key, kind, severity, title, body, url: teamUrl(day), priority: STAFFING_PRIORITY[severity] });

  if (openToday && hour >= APPROVE_FROM_HOUR && !approved[today])
    add(`staffing:unapproved:${today}`, "unapproved", "high", "Today's staff plan is not approved",
      `The store opens at ${plans[today].opening.open}. Review the agent's plan and approve it, or ask for a re-plan.`, today);
  for (const day of tomorrow ? [today, tomorrow] : [today]) {
    const p = plans[day];
    const isToday = day === today;
    for (const g of p.gaps) {
      const start = hourOf(g.from);
      if (isToday && hourOf(g.to) <= hour) continue;
      const severity: Severity = isToday && start - hour <= 2 ? "high" : "medium";
      add(`staffing:gap:${day}:${g.from}-${g.to}:${g.missing}`, "gap", severity,
        `${isToday ? "Short" : "Tomorrow: short"} ${people(g.missing)} ${g.from}-${g.to}`,
        `${g.reason}. Open the team plan to find cover.`, day);
    }
    if ((openToday || !isToday) && !p.shifts.some((s) => s.role === "shift_lead"))
      add(`staffing:no_lead:${day}`, "no_lead", "medium", `No shift lead ${isToday ? "today" : "tomorrow"}`,
        "A senior cashier leads the floor. Make sure they know who handles refunds and the cash office.", day);
  }
  if (openToday) {
    const first = plans[today].gaps.find((g) => hourOf(g.to) > hour);
    const still = first ? ` Still short ${people(first.missing)} ${first.from}-${first.to}.` : "";
    for (const [id, name, reported] of sick[today] ?? []) {
      if (reported)
        add(`staffing:sick:${today}:${id}`, "sick", "high", `${name} called in sick`,
          `The agent drafted a re-plan for today.${still} Review and approve it.`, today);
      else
        add(`staffing:sick:${today}:${id}`, "sick", "medium", `${name} is off sick today`,
          `Today's plan already works without them.${still}`, today);
    }
  }
  return out.sort((a, b) => b.priority - a.priority || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Plan inputs from the snapshot and the D1 audit trail. */
export async function staffingFromDb(db: D1Database, now: Date): Promise<StaffingSignal[]> {
  const states: Record<string, DayState> = await planStates(db);
  const known = sickFromAvailability();
  const plans: Record<string, StaffPlan> = {};
  const approved: Record<string, boolean> = {};
  const sick: Record<string, [string, string, boolean][]> = {};
  for (const [d, st] of Object.entries(states)) {
    plans[d] = st.plan as unknown as StaffPlan;
    approved[d] = st.approved;
    const list: [string, string, boolean][] = (known[d] ?? []).map(([id, name]) => [id, name, false]);
    for (const id of st.sickReported) if (!list.some((x) => x[0] === id)) list.push([id, employeeName(id), true]);
    sick[d] = list;
  }
  return staffingSignals(now, plans, approved, sick);
}

/** Unapproved plan after 07:00, short-staffed windows today/tomorrow, sick calls and a missing shift lead. */
export const staffing: SignalSource = async ({ db, now }) =>
  (await staffingFromDb(db, now)).map(({ key, title, body, url, priority }) => ({ key, title, body, url, priority }));

// briefingNotices is left out: the snapshot note is a past outage that needs no action.
export const SOURCES: SignalSource[] = [externalConditions, staffing, storeActions];

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
