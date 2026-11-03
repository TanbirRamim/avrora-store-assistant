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
  /** Language of a model-written briefing. */
  lang?: "uk" | "en";
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
  // Products screen additions (always present from /api/products/{id})
  status?: ProductStatus;
  stock?: number;
  on_order?: number;
  next_delivery?: NextDelivery | null;
  sold_7d?: number;
  received_7d?: number;
  stock_change_7d?: number | null;
  last_sale?: string | null;
  actions?: ActionRef[];
  updates?: ProductUpdate[];
}

/** Stock status on the Products screen. The first four follow the open suggestion's type. */
export type ProductStatus = "late" | "running_out" | "hard_to_find" | "overstocked" | "low" | "on_order" | "ok";

export interface NextDelivery {
  date: string;
  qty: number;
  late: boolean;
}

export interface ActionRef {
  id: string;
  type: ActionType;
  risk_uah: number;
}

export type ProductUpdateKind = "suggestion" | "late" | "expected" | "received" | "sold_out" | "no_sales" | "promotion";

export interface ProductUpdate {
  date: string;
  kind: ProductUpdateKind;
  text: string;
}

export interface StoreUpdate extends ProductUpdate {
  product_id: string;
  name: string;
}

export interface ProductRow {
  product_id: string;
  name: string;
  category: string;
  price: number;
  supplier: string;
  stock: number;
  daily_sales: number;
  /** null when nothing sells */
  days_cover: number | null;
  on_order: number;
  next_delivery: NextDelivery | null;
  sold_7d: number;
  received_7d: number;
  stock_change_7d: number | null;
  last_sale: string | null;
  status: ProductStatus;
  attention: boolean;
  actions: ActionRef[];
}

/** GET /api/products: rows come needs-attention first. */
export interface ProductList {
  today: string;
  /** Last trading day in the data, usually the day before today. */
  last_day: string;
  products: ProductRow[];
  updates: StoreUpdate[];
}

export type SignalKind = "power" | "air_alert" | "weather";

/** A current outside condition: power cut, air-raid alert or notable weather. */
export interface Signal {
  id: string;
  kind: SignalKind;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  starts_at: string;
  ends_at: string | null;
  source: string;
  simulated: boolean;
}

export interface Signals {
  updated_at: string;
  signals: Signal[];
  feeds: { kind: SignalKind; source: string; live: boolean }[];
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
