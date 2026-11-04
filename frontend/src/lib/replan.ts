/**
 * Re-planning today's priorities around a power cut or an air-raid alert.
 *
 * The model may only reorder the five existing actions and explain the change in two short lines.
 * Every number in its note must come from the actions or the signal's times; otherwise, or without
 * a key, the deterministic rules below decide the order and write the note.
 */
import type { Action, ActionType, Signal } from "./api";
import type { Lang } from "./assist";
import { allowedNumbers, chatJson, fmtMoney, grounded } from "./model";

export interface Replan {
  signalId: string;
  order: string[];
  note: string;
  source: "model" | "rules";
}

const TZ = "Europe/Kyiv";
export const kyivTime = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

/** Signals worth re-planning for. */
export const replannable = (s: Signal) => s.kind === "power" || s.kind === "air_alert";

const PERISHABLE = /chill|frozen|fridge|dairy|meat|fish|fresh|food|продукт|молоч|заморож/i;

/** Lower comes first. Within a rank the engine's order stays. */
const RANK: Record<"power" | "air_alert", Record<ActionType, number>> = {
  // Orders and price changes need the tills and the network: do them before the cut.
  // Shelf moves and calls to suppliers work without power.
  power: { ORDER: 1, DISCOUNT: 2, CHECK_DELIVERY: 3, MOVE_TO_FRONT: 4, EXPLAIN_ANOMALY: 5 },
  // The floor closes while staff shelter: phone work first, floor work after the all-clear.
  air_alert: { ORDER: 1, CHECK_DELIVERY: 2, DISCOUNT: 3, MOVE_TO_FRONT: 4, EXPLAIN_ANOMALY: 5 },
};

function times(s: Signal) {
  const start = kyivTime(s.starts_at);
  const end = s.ends_at ? kyivTime(s.ends_at) : null;
  const active = Date.parse(s.starts_at) <= Date.now();
  return { start, end, active };
}

function rulesNote(s: Signal, priorities: Action[], lang: Lang): string {
  const { start, end, active } = times(s);
  const chilled = priorities.some((a) => PERISHABLE.test(a.category));
  if (s.kind === "power") {
    const when =
      lang === "uk"
        ? active ? `Світла немає до ${end}.` : `Світла не буде ${start}–${end}.`
        : active ? `Power is off until ${end}.` : `Power is off ${start}–${end}.`;
    const first =
      lang === "uk"
        ? chilled ? "Спершу охолоджені товари, потім замовлення та ціни, поки працюють каси." : "Замовлення та зміни цін першими, поки працюють каси й мережа."
        : chilled ? "Chilled lines first, then orders and price changes while the tills work." : "Orders and price changes first, while the tills and network are up.";
    const later =
      lang === "uk" ? "Переставлення на полицях і дзвінки постачальникам можна робити без світла." : "Shelf moves and supplier calls can be done during the cut.";
    return `${when} ${first}\n${later}`;
  }
  return lang === "uk"
    ? `Повітряна тривога з ${start}: персонал і покупці в укритті.\nЗамовлення й дзвінки постачальникам можна зробити з телефона; роботу в залі після відбою.`
    : `Air-raid alert since ${start}: staff and shoppers are in shelter.\nOrders and supplier calls can be done from a phone; floor work waits for the all-clear.`;
}

/** Deterministic re-plan: perishables first on a power cut, then by the type ranks above. */
export function replanByRules(s: Signal, priorities: Action[], lang: Lang): Replan {
  const kind = s.kind === "air_alert" ? "air_alert" : "power";
  const rank = (a: Action) => RANK[kind][a.type] - (kind === "power" && PERISHABLE.test(a.category) ? 10 : 0);
  const order = priorities
    .map((a, i) => ({ a, i }))
    .sort((x, y) => rank(x.a) - rank(y.a) || x.i - y.i)
    .map((x) => x.a.id);
  return { signalId: s.id, order, note: rulesNote(s, priorities, lang), source: "rules" };
}

const SYSTEM_PROMPT = `You help the manager of a small discount store in Ukraine adjust today's plan to an outside event:
a scheduled power cut or an air-raid alert. You receive today's priorities (id, type, category, product, money at stake,
facts) in the engine's order, and the event with its local start and end times.

Reorder the same priorities so the plan works around the event. During a power cut the tills, card terminals, lights
and network are down; chilled or frozen goods come first. During an air-raid alert staff and shoppers go to shelter and the floor closes.
Return every id exactly once; do not add, drop or rename any action.
Then write a note of at most two short lines (at most 40 words in total) saying what changes and why.
Use only numbers from the data you receive and the event's times; never invent numbers.
Write the note in the language given in the request. Return exactly the JSON requested.`;

const SCHEMA = {
  type: "object",
  properties: { order: { type: "array", items: { type: "string" } }, note: { type: "string" } },
  required: ["order", "note"],
};

/** Asks the AI model; falls back to the rules when its answer breaks the checks. */
export async function replanWithModel(key: string, s: Signal, priorities: Action[], lang: Lang): Promise<Replan> {
  const { start, end, active } = times(s);
  const payload = {
    language: lang === "uk" ? "Ukrainian" : "English",
    event: { kind: s.kind, title: s.title, starts: start, ends: end, already_running: active },
    priorities: priorities.map((a) => ({
      id: a.id, type: a.type, category: a.category, product: a.product_name, money_at_stake: fmtMoney(a.risk_uah), facts: a.facts,
    })),
  };
  const out = await chatJson<{ order: unknown; note: unknown }>(key, SYSTEM_PROMPT, JSON.stringify(payload), SCHEMA);

  const ids = priorities.map((a) => a.id);
  const order = Array.isArray(out.order) ? out.order.filter((x): x is string => typeof x === "string") : [];
  const permutation = order.length === ids.length && new Set(order).size === ids.length && order.every((id) => ids.includes(id));
  const note = typeof out.note === "string" ? out.note.trim().split(/\n+/).slice(0, 2).join("\n") : "";
  const allowed = allowedNumbers([
    ...priorities.flatMap((a) => [...Object.values(a.facts), ...Object.values(a.proposal), a.risk_uah, a.product_name]),
    start, end ?? "",
  ]);
  if (!permutation || !note || !grounded(note, allowed, 45)) return replanByRules(s, priorities, lang);
  return { signalId: s.id, order, note, source: "model" };
}

/** Applies a re-plan to a list; ids it does not know keep their place at the end. */
export function applyOrder<T extends { id: string }>(items: T[], order: string[]): T[] {
  const pos = new Map(order.map((id, i) => [id, i]));
  return items
    .map((a, i) => ({ a, i }))
    .sort((x, y) => (pos.get(x.a.id) ?? order.length + x.i) - (pos.get(y.a.id) ?? order.length + y.i))
    .map((x) => x.a);
}
