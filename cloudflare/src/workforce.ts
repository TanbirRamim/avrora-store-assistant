/**
 * Workforce agent routes, identical to backend/src/avrora/api/workforce.py.
 *
 * Plans and every replan the planner offers are precomputed by `python -m avrora.export`
 * (see export.workforce_snapshot): the scheduler lives only in Python, so the Worker can never
 * drift from it, and the export checks every rebuilt document against the API. Replans are
 * stored as the keys that differ from the day's base plan; unchanged hours are null and
 * unchanged shifts are an index into the base plan's shifts. Status and the audit trail
 * (`changes`) come from the workforce_audit table in D1.
 */
import snapshot from "./snapshot.json";

type Doc = Record<string, unknown> & { changes: { at: string; by: string; summary: string }[]; diff?: unknown[] };
type Compact = Record<string, unknown> & { hours?: (unknown | null)[]; shifts?: (number | unknown)[] };
interface AuditRow {
  version: string;
  action: string;
  by: string;
  summary: string;
  at: string;
}
interface Employee {
  employee_id: string;
  name: string;
  [key: string]: unknown;
}

const WF = snapshot.workforce as unknown as {
  plans: Record<string, Doc>;
  replans: Record<string, Record<string, Compact>>;
  employees: { employees: Employee[] };
  profiles: Record<string, Record<string, unknown>>;
  kpis: Record<string, unknown>;
};
const DATES = Object.keys(WF.plans).sort();
const TODAY = DATES[0];
const KINDS = ["sick", "air_alert", "power", "traffic_spike"] as const;
const EVENT_HOURS: Record<string, number> = { air_alert: 2, power: 4, traffic_spike: 3 };
/** Drafted audit rows kept per plan date; older ones are pruned on write. */
const AUDIT_KEEP = 200;
/** Replans allowed per minute across all dates (counted from the audit table, so it holds across isolates). */
const REPLANS_PER_MINUTE = 10;
const OPEN = 8;
const CLOSE = 21;
const DEFAULT_START = 12;
const PROFILE_FROM_ROW = [
  "employee_id", "name", "role", "skills", "contract_hours_week", "hours_this_week",
  "status_today", "next_shift", "score", "trend", "strength",
] as const;
const EMP = new Map(WF.employees.employees.map((e) => [e.employee_id, e]));

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
class EventError extends Error {}

const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

function day(value: string | null | undefined): string {
  if (value === null || value === undefined) return TODAY;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)))
    throw new HttpError(422, "date must be YYYY-MM-DD");
  if (!DATES.includes(value)) throw new HttpError(404, `Plans cover ${DATES[0]} to ${DATES[DATES.length - 1]}`);
  return value;
}

/** Python's int(s.split(":")[0]) for the whole-hour strings the planner accepts. */
function parseHour(s: string): number {
  const head = s.split(":")[0].trim();
  if (!/^[+-]?\d+$/.test(head)) throw new EventError("from must be a whole hour like 14:00");
  return Number.parseInt(head, 10);
}

interface Event {
  kind: string;
  employee_id?: string;
  start?: number;
  end?: number;
}

/** plan.normalise_event: whole-hour start, fixed length per kind. Returns the version key. */
function normalise(kind: unknown, employeeId: unknown, start: unknown, end: unknown): Event & { key: string } {
  if (typeof kind !== "string" || !(KINDS as readonly string[]).includes(kind))
    throw new EventError(`kind must be one of ${KINDS.join(", ")}`);
  if (kind === "sick") {
    if (typeof employeeId !== "string" || !EMP.has(employeeId)) throw new EventError("sick needs a known employee_id");
    return { kind, employee_id: employeeId, key: `sick-${employeeId}` };
  }
  let a = DEFAULT_START;
  if (start !== null && start !== undefined) {
    if (typeof start !== "string") throw new EventError("from must be a whole hour like 14:00");
    a = parseHour(start);
    if (!start.endsWith(":00")) throw new EventError("from must be a whole hour like 14:00");
  }
  if (!(OPEN <= a && a < CLOSE)) throw new EventError("from must be between 08:00 and 20:00");
  const b = Math.min(CLOSE, a + EVENT_HOURS[kind]);
  if (end !== null && end !== undefined && end !== hh(b))
    throw new EventError(`${kind} lasts ${EVENT_HOURS[kind]} h in the planner, so to must be ${hh(b)} (or left out)`);
  return { kind, start: a, end: b, key: `${kind}-${String(a).padStart(2, "0")}` };
}

/** plan.event_from_version. */
function fromVersion(version: string): (Event & { key: string }) | null {
  if (version === "base") return null;
  const i = version.lastIndexOf("-");
  const kind = i < 0 ? "" : version.slice(0, i);
  const arg = i < 0 ? version : version.slice(i + 1);
  if (kind === "sick") return normalise(kind, arg, null, null);
  if (!/^\d+$/.test(arg)) throw new EventError(`Unknown version ${version}`);
  return normalise(kind, null, hh(Number.parseInt(arg, 10)), null);
}

function label(e: Event): string {
  if (e.kind === "sick") return `${EMP.get(e.employee_id!)!.name} sick`;
  const what = { air_alert: "air-raid alert", power: "power cut", traffic_spike: "traffic spike" }[e.kind as "power"];
  return `${what} ${hh(e.start!)}-${hh(e.end!)}`;
}

/** export.expand_replan. */
function planFor(date: string, key: string): Doc {
  const base = WF.plans[date];
  if (key === "base") return base;
  const c = WF.replans[date][key];
  const out: Record<string, unknown> = { ...base, ...c };
  if (c.hours) out.hours = c.hours.map((h, i) => (h === null ? (base.hours as unknown[])[i] : h));
  if (c.shifts) out.shifts = c.shifts.map((s) => (typeof s === "number" ? (base.shifts as unknown[])[s] : s));
  return out as Doc;
}

async function audit(db: D1Database, date: string): Promise<AuditRow[]> {
  const { results } = await db
    .prepare("SELECT version, action, by, summary, at FROM workforce_audit WHERE date = ? ORDER BY id")
    .bind(date)
    .all<AuditRow>();
  return results;
}

async function log(db: D1Database, date: string, version: string, action: string, by: string, summary: string, reason: string | null = null) {
  const at = now();
  await db.batch([
    db
      .prepare("INSERT INTO workforce_audit (date, version, action, by, summary, reason, at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(date, version, action, by, summary, reason, at),
    // Keep the newest AUDIT_KEEP "drafted" rows per day so replan spam cannot grow the table (read in full by
    // planStates). Approvals and rejections are never pruned: they decide which plan is in force.
    db
      .prepare("DELETE FROM workforce_audit WHERE date = ? AND action = 'drafted' AND id <= (SELECT id FROM workforce_audit WHERE date = ? AND action = 'drafted' ORDER BY id DESC LIMIT 1 OFFSET ?)")
      .bind(date, date, AUDIT_KEEP),
  ]);
  return at;
}

/** The version the manager approved last for a day, or null (draft, or rejected since). */
function approvedVersion(rows: AuditRow[]): string | null {
  const last = rows.filter((r) => r.action === "approved" || r.action === "rejected").at(-1);
  return last?.action === "approved" ? last.version : null;
}

export interface DayState {
  plan: Doc;
  approved: boolean;
  /** sick-* replans drafted for the day, as employee ids */
  sickReported: string[];
}

/** Per plan date: the plan in force (approved version, else the base draft) and what the audit says. */
export async function planStates(db: D1Database): Promise<Record<string, DayState>> {
  const { results } = await db
    .prepare("SELECT date, version, action, by, summary, at FROM workforce_audit ORDER BY id")
    .all<AuditRow & { date: string }>();
  const out: Record<string, DayState> = {};
  for (const d of DATES) {
    const rows = results.filter((r) => r.date === d);
    const v = approvedVersion(rows);
    const sick = rows.filter((r) => r.action === "drafted" && r.version.startsWith("sick-")).map((r) => r.version.slice(5));
    out[d] = { plan: planFor(d, v ?? "base"), approved: v !== null, sickReported: [...new Set(sick)] };
  }
  return out;
}

/** Sick days from the availability in the snapshot profiles: date -> [employee_id, name]. */
export function sickFromAvailability(): Record<string, [string, string][]> {
  const out: Record<string, [string, string][]> = {};
  for (const [id, p] of Object.entries(WF.profiles))
    for (const a of (p.availability ?? []) as { date: string; status: string }[])
      if (a.status === "sick") (out[a.date] ??= []).push([id, EMP.get(id)!.name]);
  return out;
}

export const employeeName = (id: string) => EMP.get(id)?.name ?? id;

const monday = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

/** kpis.decisions: approvals, rejections and replans of the last 28 days, by week of the decision. */
async function decisions(db: D1Database, now: Date) {
  const since = new Date(Math.floor(now.getTime() / 1000) * 1000 - 28 * 86_400_000);
  const { results } = await db.prepare("SELECT action, at FROM workforce_audit ORDER BY id").all<{ action: string; at: string }>();
  const field: Record<string, "approved" | "rejected" | "replans"> = { approved: "approved", rejected: "rejected", drafted: "replans" };
  const total = { approved: 0, rejected: 0, replans: 0 };
  const weeks = new Map<string, { week_start: string; approved: number; rejected: number; replans: number }>();
  for (const r of results) {
    const f = field[r.action];
    if (!f || Date.parse(r.at) < since.getTime()) continue;
    const ws = monday(r.at);
    if (!weeks.has(ws)) weeks.set(ws, { week_start: ws, approved: 0, rejected: 0, replans: 0 });
    weeks.get(ws)![f] += 1;
    total[f] += 1;
  }
  const decided = total.approved + total.rejected;
  return {
    since: since.toISOString().replace(/\.\d{3}Z$/, "+00:00"),
    ...total,
    approval_rate_pct: decided ? Math.round((1000 * total.approved) / decided) / 10 : null,
    by_week: [...weeks.keys()].sort().map((k) => weeks.get(k)!),
  };
}

const withAudit = (doc: Doc, rows: AuditRow[], status = "draft") => ({
  ...doc,
  status,
  changes: [...doc.changes, ...rows.map((r) => ({ at: r.at, by: r.by, summary: r.summary }))],
});

function version(v: unknown): string {
  const s = String(v);
  try {
    fromVersion(s);
  } catch (e) {
    throw new HttpError(422, `Unknown plan version ${s}: ${(e as Error).message}`);
  }
  return s;
}

async function body(req: Request): Promise<Record<string, unknown>> {
  try {
    const b = await req.json();
    if (b && typeof b === "object" && !Array.isArray(b)) return b as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  throw new HttpError(400, "Body must be a JSON object");
}

async function route(req: Request, db: D1Database, pathname: string): Promise<Response | null> {
  const method = req.method;
  if (method === "GET" && pathname === "/api/workforce/plan") {
    const d = day(new URL(req.url).searchParams.get("date"));
    const rows = await audit(db, d);
    const v = approvedVersion(rows);
    if (v !== null) return json(withAudit(planFor(d, v), rows, "approved"));
    return json(withAudit(planFor(d, "base"), rows));
  }
  if (method === "GET" && pathname === "/api/workforce/kpis") return json({ ...WF.kpis, decisions: await decisions(db, new Date()) });
  if (method === "GET" && pathname === "/api/workforce/employees") return json(WF.employees);
  const emp = pathname.match(/^\/api\/workforce\/employees\/([^/]+)$/);
  if (method === "GET" && emp) {
    let id: string;
    try {
      id = decodeURIComponent(emp[1]);
    } catch {
      throw new HttpError(400, "Malformed employee id");
    }
    const row = EMP.get(id);
    if (!row || !Object.hasOwn(WF.profiles, id)) throw new HttpError(404, `Unknown employee ${id}`);
    return json({ ...Object.fromEntries(PROFILE_FROM_ROW.map((k) => [k, row[k]])), ...WF.profiles[id] });
  }
  if (method === "POST" && pathname === "/api/workforce/replan") {
    const b = await body(req);
    const d = day(b.date as string | undefined);
    const ev = (b.event ?? {}) as Record<string, unknown>;
    if (typeof b.event !== "object" || b.event === null) throw new HttpError(422, "event is required");
    let e;
    try {
      e = normalise(ev.kind, ev.employee_id, ev.from, ev.to);
    } catch (err) {
      throw new HttpError(422, (err as Error).message);
    }
    const doc = planFor(d, e.key);
    const since = new Date(Date.now() - 60_000).toISOString();
    const recent = await db
      .prepare("SELECT COUNT(*) AS n FROM workforce_audit WHERE action = 'drafted' AND at >= ?")
      .bind(since.replace(/\.\d{3}Z$/, "+00:00"))
      .first<{ n: number }>();
    if ((recent?.n ?? 0) >= REPLANS_PER_MINUTE) throw new HttpError(429, "Too many replans. Wait a minute.");
    await log(db, d, e.key, "drafted", "agent", `Replanned for ${label(e)}: ${doc.diff!.length} changes`);
    return json(withAudit(doc, await audit(db, d)));
  }
  if (method === "POST" && (pathname === "/api/workforce/plan/approve" || pathname === "/api/workforce/plan/reject")) {
    const b = await body(req);
    if (typeof b.date !== "string" || typeof b.version !== "string") throw new HttpError(422, "date and version are required");
    const d = day(b.date);
    const v = version(b.version);
    if (pathname.endsWith("/approve")) {
      const at = await log(db, d, v, "approved", "manager", `Manager approved plan ${v}`);
      return json({ status: "approved", at, date: d, version: v });
    }
    const reason = b.reason;
    if (typeof reason !== "string" || reason.length < 1 || reason.length > 200)
      throw new HttpError(422, "reason must be 1 to 200 characters");
    const at = await log(db, d, v, "rejected", "manager", `Manager rejected plan ${v}: ${reason}`, reason);
    return json({ status: "rejected", at, date: d, version: v, reason });
  }
  return null;
}

/** Handles /api/workforce/*; null when the path is not a workforce route. */
export async function handleWorkforce(req: Request, db: D1Database, pathname: string): Promise<Response | null> {
  try {
    return await route(req, db, pathname);
  } catch (e) {
    if (e instanceof HttpError) return json({ detail: e.message }, e.status);
    throw e;
  }
}
