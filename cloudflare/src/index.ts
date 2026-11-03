/**
 * Avrora store assistant on Cloudflare.
 *
 * The store data is synthetic and fixed, so the read-only routes serve a snapshot that
 * `python -m avrora.export` writes at build time. Decisions are the only runtime state
 * and live in D1. Routes and payloads match the FastAPI backend. Push notifications
 * (/api/push/* and the cron trigger) exist only here. /api/signals reports power cuts,
 * air-raid alerts and notable weather (see external.ts). /api/workforce/* is the staffing
 * agent (see workforce.ts); its plan approvals and audit trail also live in D1.
 */
import { externalSignals, simulatedSignal, type SimRow } from "./external";
import { handlePush, sendUrgent, type PushEnv } from "./push";
import { kyivClock, staffingFromDb } from "./signals";
import snapshot from "./snapshot.json";
import { wartimeAlerts, wartimeThreats } from "./wartime";
import { handleWorkforce } from "./workforce";

interface Env extends PushEnv {
  /** Guards the demo simulation routes; requests send it as X-Demo-Key. */
  DEMO_KEY?: string;
  ALERTS_IN_UA_TOKEN?: string;
}

type DecisionKind = "approve" | "reject" | "change";

interface DecisionRow {
  action_id: string;
  decision: DecisionKind;
  reason: string | null;
  value: number | null;
  decided_at: string;
}

const KINDS = new Set<DecisionKind>(["approve", "reject", "change"]);
const KNOWN = new Set(snapshot.actions.map((a) => a.id));

/** List-row fields that the snapshot leaves out of each product detail (export.py FROM_ROW). */
const FROM_ROW = [
  "product_id", "name", "category", "price", "supplier", "days_cover", "status", "stock", "on_order",
  "next_delivery", "sold_7d", "received_7d", "stock_change_7d", "last_sale", "actions",
] as const;
type Row = Record<(typeof FROM_ROW)[number], unknown>;
interface CompactDetail {
  daily_forecast: number;
  h: { start: string | null; sold: number[]; stock: number[]; ahead: number; ahead_start: string | null };
  /** Purchases: [delivery number, ordered, days to expected, days to received or null, qty]. */
  p: [number, string, number, number | null, number][];
  /** Purchase summary averages: [avg_lead_days, on_time_pct]. */
  ps: [number | null, number | null];
  [key: string]: unknown;
}
const ROWS = new Map((snapshot.product_list.products as unknown as Row[]).map((r) => [r.product_id as string, r]));
const DETAILS = snapshot.product_details as unknown as Record<string, CompactDetail>;

const days = (start: string | null, n: number) =>
  start === null ? [] : Array.from({ length: n }, (_, i) => new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));

const TODAY = snapshot.product_list.today;
const DAY = 86_400_000;
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

/** Purchase rows as analytics/purchases.order_row builds them (late: due before today and not here, or arrived after due). */
function purchases(rows: CompactDetail["p"]) {
  return rows.map(([n, ordered, toExpected, toReceived, qty]) => {
    const expected = addDays(ordered, toExpected);
    const received = toReceived === null ? null : addDays(ordered, toReceived);
    const late = received === null ? Math.max(0, daysBetween(expected, TODAY)) : Math.max(0, daysBetween(expected, received));
    const status = late > 0 ? "late" : received === null ? "on_the_way" : "received";
    return { id: `D${String(n).padStart(5, "0")}`, ordered, expected, received, qty, status, days_late: late };
  });
}

/** GET /api/products/{id}, rebuilt from the list row and the compact detail as export.expand_detail does. */
function productDetail(id: string): unknown {
  const row = ROWS.get(id);
  const c = Object.hasOwn(DETAILS, id) ? DETAILS[id] : undefined;
  if (!row || !c) return undefined;
  const { h, p, ps, ...rest } = c;
  const history = [
    ...days(h.start, h.sold.length).map((date, i) => ({ date, units_sold: h.sold[i], stock_end: h.stock[i], forecast: null })),
    ...days(h.ahead_start, h.ahead).map((date) => ({ date, units_sold: null, stock_end: null, forecast: c.daily_forecast })),
  ];
  const bought = purchases(p);
  const received = bought.flatMap((o) => (o.received === null ? [] : [o.received])).sort();
  const purchase_summary = {
    orders: bought.length,
    units: bought.reduce((n, o) => n + o.qty, 0),
    avg_lead_days: ps[0],
    on_time_pct: ps[1],
    last_received: received.at(-1) ?? null,
  };
  return { ...Object.fromEntries(FROM_ROW.map((k) => [k, row[k]])), ...rest, history, purchases: bought, purchase_summary };
}

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const fail = (status: number, detail: string) => json({ detail }, status);

async function decide(req: Request, env: Env): Promise<Response> {
  let body: Partial<DecisionRow>;
  try {
    body = await req.json();
  } catch {
    return fail(422, "Body must be JSON");
  }
  const { action_id, decision } = body;
  const reason = body.reason ?? null;
  const value = body.value ?? null;
  if (typeof action_id !== "string" || !KNOWN.has(action_id)) return fail(404, `Unknown action ${action_id}`);
  if (!decision || !KINDS.has(decision)) return fail(422, "Decision must be approve, reject or change");
  if (reason !== null && (typeof reason !== "string" || reason.length > 200)) return fail(422, "Reason is too long");
  if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0))
    return fail(422, "Value must be a number of at least 0");
  if (decision === "change" && value === null) return fail(422, "A changed decision needs a value");

  const out: DecisionRow = {
    action_id,
    decision,
    reason,
    value,
    decided_at: new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00"),
  };
  await env.DB.prepare("INSERT OR REPLACE INTO decisions VALUES (?, ?, ?, ?, ?)")
    .bind(out.action_id, out.decision, out.reason, out.value, out.decided_at)
    .run();
  return json(out);
}

/** Constant-time check of the X-Demo-Key header. */
function demoAllowed(req: Request, env: Env): boolean {
  const want = env.DEMO_KEY ?? "";
  const got = req.headers.get("X-Demo-Key") ?? "";
  if (!want || got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

const SIM_DEFAULTS = { power: { minutes: 240, starts_in: 90 }, air_alert: { minutes: 45, starts_in: 0 } } as const;

/** POST /api/signals/simulate {kind, minutes, starts_in?}: a demo event, pushed to phones at once. */
async function simulate(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  let body: { kind?: unknown; minutes?: unknown; starts_in?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail(422, "Body must be JSON");
  }
  const kind = body.kind;
  if (kind !== "power" && kind !== "air_alert") return fail(422, "kind must be power or air_alert");
  const minutes = body.minutes ?? SIM_DEFAULTS[kind].minutes;
  const startsIn = body.starts_in ?? SIM_DEFAULTS[kind].starts_in;
  if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 1 || minutes > 720)
    return fail(422, "minutes must be a whole number from 1 to 720");
  if (typeof startsIn !== "number" || !Number.isInteger(startsIn) || startsIn < 0 || startsIn > 720)
    return fail(422, "starts_in must be a whole number of minutes from 0 to 720");

  const now = new Date();
  const start = new Date(Math.floor(now.getTime() / 60_000) * 60_000 + startsIn * 60_000);
  const row: SimRow = {
    id: `${kind}-${crypto.randomUUID().slice(0, 8)}`,
    kind,
    starts_at: start.toISOString(),
    ends_at: new Date(start.getTime() + minutes * 60_000).toISOString(),
  };
  await env.DB.batch([
    env.DB.prepare("DELETE FROM simulated_signals WHERE ends_at <= ?").bind(now.toISOString()),
    env.DB.prepare("INSERT INTO simulated_signals VALUES (?, ?, ?, ?, ?)").bind(row.id, row.kind, row.starts_at, row.ends_at, now.toISOString()),
  ]);
  ctx.waitUntil(sendUrgent(env, now));
  return json(simulatedSignal(row, now), 201);
}

export default {
  async fetch(req, env, ctx): Promise<Response> {
    const { pathname } = new URL(req.url);
    const method = req.method;

    if (method === "GET") {
      switch (pathname) {
        case "/api/health":
          return json({ status: "ok" });
        case "/api/overview":
        case "/api/briefing":
        case "/api/actions":
        case "/api/evaluation":
          return json(snapshot[pathname.slice(5) as "overview" | "briefing" | "actions" | "evaluation"]);
        case "/api/products":
          return json(snapshot.product_list);
        case "/api/signals": {
          const now = new Date();
          return json({ updated_at: now.toISOString(), ...(await externalSignals(env.DB, now, env)) });
        }
        case "/api/signals/staffing": {
          const now = new Date();
          const k = kyivClock(now);
          const dates = Object.keys(snapshot.workforce.plans).sort();
          return json({ updated_at: now.toISOString().replace(/\.\d{3}Z$/, "Z"), date: dates.includes(k.date) ? k.date : dates[0],
            signals: await staffingFromDb(env.DB, now) });
        }
        case "/api/wartime/threats":
          return json(await wartimeThreats());
        case "/api/wartime/alerts":
          return json(await wartimeAlerts(env.ALERTS_IN_UA_TOKEN));
        case "/api/decisions": {
          const { results } = await env.DB.prepare(
            "SELECT action_id, decision, reason, value, decided_at FROM decisions ORDER BY decided_at DESC",
          ).all<DecisionRow>();
          return json(results);
        }
      }
      const product = pathname.match(/^\/api\/products\/([^/]+)$/);
      if (product) {
        const id = decodeURIComponent(product[1]);
        const detail = productDetail(id);
        return detail ? json(detail) : fail(404, `Unknown product ${id}`);
      }
    }

    if (pathname.startsWith("/api/workforce/")) return (await handleWorkforce(req, env.DB, pathname)) ?? fail(404, "Not found");

    if (pathname.startsWith("/api/push/")) return (await handlePush(req, env, pathname)) ?? fail(404, "Not found");

    if (method === "POST" && pathname === "/api/decisions") return decide(req, env);

    if (pathname === "/api/signals/simulate" && (method === "POST" || method === "DELETE")) {
      if (!demoAllowed(req, env)) return fail(403, "Needs a valid X-Demo-Key header");
      if (method === "POST") return simulate(req, env, ctx);
      await env.DB.prepare("DELETE FROM simulated_signals").run();
      return new Response(null, { status: 204 });
    }

    const undo = pathname.match(/^\/api\/decisions\/([^/]+)$/);
    if (method === "DELETE" && undo) {
      await env.DB.prepare("DELETE FROM decisions WHERE action_id = ?").bind(decodeURIComponent(undo[1])).run();
      return new Response(null, { status: 204 });
    }

    return fail(404, "Not found");
  },

  // Every 15 minutes: push new urgent signals to subscribed phones.
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(sendUrgent(env));
  },
} satisfies ExportedHandler<Env>;
