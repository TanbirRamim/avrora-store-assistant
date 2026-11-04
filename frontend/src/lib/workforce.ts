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
 * Task palette for the rota board (v2 "Quiet professional"): a neutral zinc scale told apart by
 * lightness (safe for every colour-vision type), always with a letter code and a legend. Red only
 * for shelter. `fg` is the text colour on the fill (>= 4.5:1). `outline` draws a zinc border.
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
  checkout: { label: "Checkout", code: "C", color: "#27272a", fg: "#ffffff", text: "#18181b" },
  receiving: { label: "Receiving", code: "R", color: "#71717a", fg: "#ffffff", text: "#18181b" },
  replenishment: { label: "Restocking", code: "S", color: "#52525b", fg: "#ffffff", text: "#18181b" },
  merchandising: { label: "Merchandising", code: "M", color: "#d4d4d8", fg: "#18181b", text: "#18181b" },
  customer_service: { label: "Customer help", code: "H", color: "#ffffff", fg: "#18181b", outline: true, text: "#18181b" },
  inventory: { label: "Inventory", code: "I", color: "#e4e4e7", fg: "#18181b", text: "#18181b" },
  shelter: { label: "Shelter", code: "A", color: "#dc2626", fg: "#ffffff", text: "#dc2626" },
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
/** "air_alert-12" as the manager reads it in the change log: "the air-raid alert re-plan (12:00–14:00)". */
export function planLabel(v: string): string {
  if (v === "base") return "the agent's draft plan";
  const i = v.lastIndexOf("-");
  const [k, x] = [v.slice(0, i), v.slice(i + 1)];
  if (k === "sick") return "the sick-cover re-plan";
  const what = { air_alert: "air-raid alert", power: "power cut", traffic_spike: "busy-period" }[k];
  if (!what || !/^\d+$/.test(x)) return "a re-plan";
  const from = Number(x);
  const to = Math.min(21, from + EVENT_HOURS[k as keyof typeof EVENT_HOURS]);
  return `the ${what} re-plan (${String(from).padStart(2, "0")}:00–${String(to).padStart(2, "0")}:00)`;
}

/** Older change-log lines carried the raw version ("Manager approved plan air_alert-12"); show them in words. */
export const changeSummary = (s: string) =>
  s
    .replace(/\b(approved|rejected) plan (base|[a-z_]+-[A-Za-z0-9]+)\b/, (_, verb: string, v: string) => `${verb} ${planLabel(v)}`)
    .replace(/(\D|^)1 changes\b/, "$11 change");

export const taskMeta = (t: string): TaskStyle =>
  TASK_META[t] ?? { label: t.replace(/_/g, " "), code: t.slice(0, 1).toUpperCase(), color: "#e4e4e7", fg: "#18181b", text: "#18181b" };

/** Conditions show as small neutral badges with their time window. */
export const CONDITION_META: Record<ConditionKind, { label: string }> = {
  delivery: { label: "Delivery" },
  power: { label: "Power cut" },
  air_alert: { label: "Air-raid alert" },
  promotion: { label: "Promotion" },
};

export const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  working: { label: "Working", color: "var(--green)" },
  available: { label: "Free", color: "#71717a" },
  day_off: { label: "Day off", color: "#a1a1aa" },
  sick: { label: "Sick", color: "var(--red)" },
  vacation: { label: "Vacation", color: "#a1a1aa" },
  unavailable: { label: "Unavailable", color: "#a1a1aa" },
};
export const statusMeta = (s: string) => STATUS_LABEL[s] ?? { label: s.replace(/_/g, " "), color: "#a1a1aa" };

/** "08:00" to "11:00" as "08:00–11:00"; a whole-day window as "all day". */
export const span = (from: string, to: string, open = "08:00", close = "21:00") => (from <= open && to >= close ? "all day" : `${from}\u2060–\u2060${to}`); // word joiners: a time range never splits across lines

/** Status tone for badges: success / critical / warning / neutral. */
export type Tone = "success" | "critical" | "warning" | "neutral";
export const statusTone = (s: string): Tone => (s === "working" ? "success" : s === "sick" ? "critical" : "neutral");

/** Gap sentence for the summary: "1 person short 09:00–11:00 and 17:00–20:00". Ranges never wrap. */
export function shortSentence(gaps: { from: string; to: string; missing: number }[]) {
  if (!gaps.length) return "Every hour has enough people.";
  const most = Math.max(...gaps.map((g) => g.missing));
  const times = gaps.map((g) => `${g.from}\u2060–\u2060${g.to}`);
  const list = times.length === 1 ? times[0] : `${times.slice(0, -1).join(", ")} and ${times[times.length - 1]}`;
  return `${most} ${most === 1 ? "person" : "people"} short ${list}`;
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
