export type ActionType = "ORDER" | "DISCOUNT" | "MOVE_TO_FRONT" | "CHECK_DELIVERY" | "EXPLAIN_ANOMALY";

export interface Action {
  id: string;
  type: ActionType;
  product_id: string;
  product_name: string;
  category: string;
  risk_uah: number;
  facts: Record<string, number | string>;
  proposal: Record<string, number | string>;
  reason: string;
}

export interface Overview {
  store_name: string;
  today: string;
  products: number;
  stockout_risks: number;
  slow_stock_value_uah: number;
  late_deliveries: number;
  visibility_issues: number;
  value_at_stake_uah: number;
}

export interface Briefing {
  summary: string;
  source: "model" | "rules";
  priorities: Action[];
  notices: Action[];
}

export interface Point {
  date: string;
  units_sold: number | null;
  stock_end: number | null;
  forecast: number | null;
}

export interface ProductDetail {
  product_id: string;
  name: string;
  category: string;
  price: number;
  supplier: string;
  lead_time_days: number;
  daily_forecast: number;
  days_cover: number | null;
  history: Point[];
}

export type DecisionKind = "approve" | "reject" | "change";

export interface Decision {
  action_id: string;
  decision: DecisionKind;
  reason: string | null;
  value: number | null;
  decided_at: string;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {}
    throw new ApiError(res.status, typeof detail === "string" ? detail : "Request failed");
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const fetcher = <T,>(path: string) => request<T>(path);

export const api = {
  decide: (action_id: string, decision: DecisionKind, opts: { reason?: string; value?: number } = {}) =>
    request<Decision>("/api/decisions", {
      method: "POST",
      body: JSON.stringify({ action_id, decision, reason: opts.reason ?? null, value: opts.value ?? null }),
    }),
  undo: (action_id: string) => request<void>(`/api/decisions/${encodeURIComponent(action_id)}`, { method: "DELETE" }),
};
