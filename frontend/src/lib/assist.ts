/**
 * Questions about one action and supplier drafts, written by the store's AI model.
 * The model only sees that action and the product's history; any answer with a number that is
 * not in that data is replaced by a safe fallback.
 */
import type { Action, ProductDetail } from "./api";
import { allowedNumbers, chatJson, fmtMoney, grounded } from "./model";

export const FALLBACK = "I can't answer that from the store data.";
export const OUT_OF_SCOPE = "I can only help with this store's stock, sales, orders and deliveries.";

const ASK_PROMPT = `You answer a discount store manager's question about one suggested action.
You receive the action (type, facts, proposal, reason, money at stake) and the product's recent daily history.
Answer in at most 60 words, plain language, no jargon, no markdown. Use only numbers that appear in the data you receive;
never invent or calculate new figures. Money is already written in the store's format (for example "₴2,671"); copy it exactly, never write UAH or kopecks.
If the data does not answer the question, say so briefly.
If the question is not about this store's operations (stock, sales, prices, orders, deliveries, suppliers),
set in_scope to false and leave answer empty. Return exactly the JSON requested.`;

const ASK_SCHEMA = {
  type: "object",
  properties: { in_scope: { type: "boolean" }, answer: { type: "string" } },
  required: ["in_scope", "answer"],
};

const DRAFT_PROMPT = `You write a short, polite message from a discount store manager to a supplier.
Use only the supplier name, the product name (copied exactly, with any size in it), quantities and days that appear in
the data. Never invent numbers, dates, prices, phone or order numbers, or names; write "as soon as possible", not a date.
At most 90 words, no placeholders like [Name], sign off as "Avrora store, Vinnytsia". Write in the language requested.
Return exactly the JSON requested.`;

const DRAFT_SCHEMA = {
  type: "object",
  properties: { subject: { type: "string" }, body: { type: "string" } },
  required: ["subject", "body"],
};

export const QUESTIONS: Record<Action["type"], string[]> = {
  ORDER: ["Why this quantity?", "What if the delivery is 3 days late?", "What happens if I do nothing?"],
  DISCOUNT: ["Why this discount?", "How long will the stock last?", "What happens if I do nothing?"],
  MOVE_TO_FRONT: ["Why move it?", "Is it a stock problem?", "What happens if I do nothing?"],
  CHECK_DELIVERY: ["How late is it?", "What if it is 3 more days late?", "What happens if I do nothing?"],
  EXPLAIN_ANOMALY: ["What does this mean for sales?", "Should I order more?", "What happens if I do nothing?"],
};

const actionData = (a: Action) => ({
  type: a.type, product: a.product_name, category: a.category, money_at_stake: fmtMoney(a.risk_uah),
  facts: a.facts, proposal: a.proposal, reason: a.reason,
});

const historyData = (p?: ProductDetail) =>
  p ? {
    supplier: p.supplier, lead_time_days: p.lead_time_days, daily_forecast: p.daily_forecast, price: p.price,
    history: p.history.map((h) => ({ date: h.date, sold: h.units_sold, stock: h.stock_end, forecast: h.forecast })),
  } : null;

function allowedFor(a: Action, p?: ProductDetail, extra: unknown[] = []) {
  // the product name counts too: "Bubble wand Set of 10" carries its own number
  const vals: unknown[] = [...Object.values(a.facts), ...Object.values(a.proposal), a.risk_uah, a.reason, a.product_name, ...extra];
  if (p) {
    vals.push(p.price, p.lead_time_days, p.daily_forecast, p.days_cover);
    for (const h of p.history) vals.push(h.date, h.units_sold, h.stock_end, h.forecast);
  }
  return allowedNumbers(vals.filter((v) => v !== null && v !== undefined));
}

export async function askAboutAction(key: string, a: Action, p: ProductDetail | undefined, question: string): Promise<string> {
  const out = await chatJson<{ in_scope: boolean; answer: string }>(
    key, ASK_PROMPT, JSON.stringify({ action: actionData(a), product: historyData(p), question }), ASK_SCHEMA,
  );
  if (out.in_scope === false) return OUT_OF_SCOPE;
  const answer = typeof out.answer === "string" ? out.answer.trim() : "";
  // numbers the manager typed in the question count as given
  return answer && grounded(answer, allowedFor(a, p, [question]), 60) ? answer : FALLBACK;
}

export type Lang = "uk" | "en";

export async function draftSupplierMessage(key: string, a: Action, lang: Lang): Promise<{ subject: string; body: string } | null> {
  const data = { supplier: a.facts.supplier ?? a.proposal.supplier, product: a.product_name, type: a.type, facts: a.facts, proposal: a.proposal };
  const out = await chatJson<{ subject: string; body: string }>(
    key, DRAFT_PROMPT,
    JSON.stringify({ language: lang === "uk" ? "Ukrainian" : "English", data }),
    DRAFT_SCHEMA,
  );
  const allowed = allowedFor(a, undefined);
  const subject = String(out.subject ?? "").trim();
  const body = String(out.body ?? "").trim();
  if (!body || !grounded(subject, allowed, 20) || !grounded(body, allowed, 110)) return null;
  return { subject, body };
}
