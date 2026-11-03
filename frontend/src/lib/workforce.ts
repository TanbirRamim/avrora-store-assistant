/** Workforce agent: types and calls for docs/workforce-contract.md. All data behind it is synthetic. */

import { ApiError } from "@/lib/api";

export type Role = "senior_cashier" | "cashier" | "stocker" | "merchandiser" | "shift_lead";
export type Skill = "checkout" | "receiving" | "replenishment" | "merchandising" | "customer_service" | "inventory";
export type Task = Skill;
export type ConditionKind = "power" | "air_alert" | "promotion" | "delivery";
export type PlanStatus = "draft" | "approved" | "rejected";

export interface Condition {
  kind: ConditionKind;
  label: string;
  from: string;
  to: string;
}

export interface HourRow {
  hour: string;
  customers: number;
  transactions: number;
  required: number;
  scheduled: number;
  workload: Record<Task, number>;
}

export interface Block {
  from: string;
  to: string;
  required: number;
  scheduled: number;
}

export interface TaskSlot {
  from: string;
  to: string;
  task: Task | string;
  reason: string;
  /** e.g. "Lead checkout", "Receiving dock" (newer contract; optional) */
  station?: string;
  /** "Critical" | "High" | "Standard" (older fixtures: 1-3) */
  priority?: string | number;
  /** fit of this person for this task, 0-100 */
  match?: number;
}

export interface Shift {
  employee_id: string;
  name: string;
  role: Role;
  start: string;
  end: string;
  break_at: string | null;
  hours: number;
  /** e.g. "Fast checkout" (optional) */
  strength?: string | null;
  tasks: TaskSlot[];
}

export interface Gap {
  from: string;
  to: string;
  missing: number;
  reason: string;
}

export interface Kpis {
  labour_hours: number;
  labour_cost_uah: number;
  coverage_pct: number;
  sales_per_labour_hour_uah: number;
  overtime_hours: number;
  rule_violations: number;
}

export interface Change {
  at: string;
  by: "agent" | "manager";
  summary: string;
}

export interface DiffRow {
  employee_id: string;
  name: string;
  before: string;
  after: string;
  why: string;
}

export interface Plan {
  date: string;
  generated_at: string;
  status: PlanStatus;
  /** "base" for the agent's draft, or the replan key such as "sick-E05" */
  version: string | number;
  demo_data?: boolean;
  opening: { open: string; close: string };
  conditions: Condition[];
  hours: HourRow[];
  blocks: Block[];
  shifts: Shift[];
  gaps: Gap[];
  kpis: Kpis;
  explain: string[];
  changes: Change[];
  /** only on a replan proposal */
  diff?: DiffRow[];
}

export type EmployeeStatus = "working" | "available" | "day_off" | "sick" | "vacation" | "unavailable";

export interface NextShift {
  date: string;
  start: string;
  end: string;
}

export interface Employee {
  employee_id: string;
  name: string;
  role: Role;
  skills: Skill[];
  contract_hours_week: number;
  hours_this_week: number;
  status_today: EmployeeStatus | string;
  next_shift: NextShift | string | null;
  score: number;
  strength?: string | null;
  trend: "up" | "flat" | "down";
}

export interface WeekPerf {
  week_start: string;
  items_scanned_per_hour: number;
  cases_received_per_hour: number;
  shelves_replenished_per_hour?: number;
  scan_error_rate: number;
  punctuality_pct: number;
  absences?: number;
  customer_rating: number;
}

export interface DayAvailability {
  date: string;
  status: EmployeeStatus | string;
  available_from?: string | null;
  available_to?: string | null;
  note?: string | null;
}

export interface Profile extends Employee {
  performance: WeekPerf[];
  strengths: string[];
  watch: string[];
  recent_shifts: { date: string; start: string; end: string; tasks?: string[] | string }[];
  availability: DayAvailability[];
}

export type ReplanEvent =
  | { kind: "sick"; employee_id: string }
  | { kind: "air_alert" | "power" | "traffic_spike"; from: string };

/** Replan windows are fixed per kind; the server clips them at closing. */
export const EVENT_HOURS: Record<"air_alert" | "power" | "traffic_spike", number> = { air_alert: 2, power: 4, traffic_spike: 3 };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {}
    throw new ApiError(res.status, typeof detail === "string" ? detail : "Request failed");
  }
  return res.json();
}

export const planKey = (date: string) => `/api/workforce/plan?date=${date}`;
export const EMPLOYEES_KEY = "/api/workforce/employees";
export const profileKey = (id: string) => `/api/workforce/employees/${encodeURIComponent(id)}`;

export const workforce = {
  replan: (date: string, event: ReplanEvent) =>
    request<Plan>("/api/workforce/replan", { method: "POST", body: JSON.stringify({ date, event }) }),
  approve: (date: string, version: string | number) =>
    request<{ status: "approved"; at: string }>("/api/workforce/plan/approve", { method: "POST", body: JSON.stringify({ date, version }) }),
  reject: (date: string, version: string | number, reason: string) =>
    request<{ status: string; at: string }>("/api/workforce/plan/reject", { method: "POST", body: JSON.stringify({ date, version, reason }) }),
};

/* ---------- display helpers ---------- */

export const ROLE_LABEL: Record<string, string> = {
  shift_lead: "Shift lead",
  senior_cashier: "Senior cashier",
  cashier: "Cashier",
  stocker: "Stocker",
  merchandiser: "Merchandiser",
};

/**
 * Task palette for the rota board (Shop floor): ink, greys and the one yellow, told apart by
 * lightness as well as hue (safe for every colour-vision type), and always with a letter code
 * and a label. `fg` is the text colour on the fill (>= 4.5:1). `outline` draws an ink ring.
 */
export interface TaskStyle {
  label: string;
  code: string;
  color: string;
  fg: string;
  outline?: boolean;
  /** legacy: text colour on paper */
  text: string;
}
export const TASK_META: Record<string, TaskStyle> = {
  checkout: { label: "Checkout", code: "C", color: "#000000", fg: "#ffffff", text: "#000000" },
  receiving: { label: "Receiving", code: "R", color: "#ffde00", fg: "#000000", text: "#000000" },
  replenishment: { label: "Restocking", code: "S", color: "#5c5c57", fg: "#ffffff", text: "#000000" },
  merchandising: { label: "Merchandising", code: "M", color: "#a6a69e", fg: "#000000", text: "#000000" },
  customer_service: { label: "Customer help", code: "H", color: "#ffffff", fg: "#000000", outline: true, text: "#000000" },
  inventory: { label: "Inventory", code: "I", color: "#e2e2dc", fg: "#000000", text: "#000000" },
  shelter: { label: "Shelter", code: "A", color: "#d9140e", fg: "#ffffff", text: "#d9140e" },
};
export const TASK_ORDER = ["checkout", "receiving", "replenishment", "merchandising", "customer_service", "inventory", "shelter"];

const PRIORITY_RANK: Record<string, number> = { critical: 1, high: 2, standard: 3 };
export const priorityRank = (p?: string | number) => (typeof p === "number" ? p : p ? (PRIORITY_RANK[p.toLowerCase()] ?? 9) : 9);
export const priorityLabel = (p?: string | number) =>
  typeof p === "string" ? p : p === 1 ? "Critical" : p === 2 ? "High" : p ? "Standard" : null;

/** "base" reads as the agent's draft; a replan key as what triggered it. */
export const versionLabel = (v: string | number) => {
  if (typeof v === "number") return `Version ${v}`;
  if (v === "base") return "Agent draft";
  const [k, x] = v.split("-");
  const what = { sick: "Sick cover", air_alert: "Alert", power: "Power cut", traffic_spike: "Busy" }[k] ?? k;
  return /^\d+$/.test(x ?? "") ? `${what} ${x.padStart(2, "0")}:00` : what;
};
export const taskMeta = (t: string): TaskStyle =>
  TASK_META[t] ?? { label: t.replace(/_/g, " "), code: t.slice(0, 1).toUpperCase(), color: "#e2e2dc", fg: "#000000", text: "#000000" };

/** Conditions are plain lines of text on the tag; no colour of their own. */
export const CONDITION_META: Record<ConditionKind, { label: string }> = {
  delivery: { label: "Delivery" },
  power: { label: "Power cut" },
  air_alert: { label: "Air-raid alert" },
  promotion: { label: "Promotion" },
};

export const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  working: { label: "Working", color: "var(--green)" },
  available: { label: "Free", color: "var(--ink)" },
  day_off: { label: "Day off", color: "#a6a69e" },
  sick: { label: "Sick", color: "var(--red)" },
  vacation: { label: "Vacation", color: "#a6a69e" },
  unavailable: { label: "Unavailable", color: "#a6a69e" },
};
export const statusMeta = (s: string) => STATUS_LABEL[s] ?? { label: s.replace(/_/g, " "), color: "#a6a69e" };

/** "08:00" to "11:00" as "08:00–11:00"; a whole-day window as "all day". */
export const span = (from: string, to: string, open = "08:00", close = "21:00") => (from <= open && to >= close ? "all day" : `${from}\u2060–\u2060${to}`); // word joiners: a time range never splits across lines

/** Gap sentence for the tag: "2 people short: 09:00–11:00 and 17:00–20:00". */
export function shortSentence(gaps: { from: string; to: string; missing: number }[]) {
  if (!gaps.length) return "Every hour has enough people.";
  const most = Math.max(...gaps.map((g) => g.missing));
  const times = gaps.map((g) => `${g.from}–${g.to}`);
  const list = times.length === 1 ? times[0] : `${times.slice(0, -1).join(", ")} and ${times[times.length - 1]}`;
  return `${most} ${most === 1 ? "person" : "people"} short: ${list}`;
}

export const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
};

export const initials = (name: string) =>
  name
    .replace(/\./g, "")
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

/** Avatars are quiet: floor disc, ink initials. Kept as a function for callers. */
export const avatarColor = (id: string) => (id ? "var(--floor)" : "var(--floor)");

export const hrs = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} h`;

export function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const dayShort = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
export const dayNum = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDate();
export const dayLong = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

export const nextShiftText = (n: Employee["next_shift"], today: string) => {
  if (!n) return "None planned";
  if (typeof n === "string") return n;
  const day = n.date === today ? "Today" : n.date === addDays(today, 1) ? "Tomorrow" : dayShort(n.date);
  return `${day} ${n.start}–${n.end}`;
};
