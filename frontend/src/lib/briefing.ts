/**
 * Model-written briefing, called from the browser so the Open WebUI key never leaves it.
 * The OTH server only answers on the university network (campus or VPN), and it allows
 * cross-origin calls. Same prompt and checks as backend/src/avrora/ai/briefing.py: the model
 * only picks and explains actions the engine computed, and any reason with a number that is
 * not in that action's data falls back to the engine's text.
 */
import type { Action, Briefing } from "./api";
import type { Lang } from "./assist";
import { allowedNumbers, chatJson, grounded, ModelError } from "./ollama";

export { ModelError };

const CANDIDATES = 12;
const TOP_N = 5;

const SYSTEM_PROMPT = `You help the manager of a small discount store plan their day.
You receive candidate actions computed from the store's data. Each has an id, a type, the numbers behind it
and an estimated amount of money at stake in UAH.

Choose the five actions the manager should handle today and order them by urgency. Money at stake matters most,
but an item that will run out before a delivery can arrive is more urgent than slow stock that can wait a few
days. Write one short reason per action for a busy store manager: at most 25 words, plain language, no jargon.
Use only numbers that appear in that action's data. Write a one-sentence summary of the day.
Write the reasons and the summary in the language given in the request. Return exactly the JSON requested.`;

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    priorities: {
      type: "array",
      items: {
        type: "object",
        properties: { action_id: { type: "string" }, reason: { type: "string" } },
        required: ["action_id", "reason"],
      },
    },
  },
  required: ["summary", "priorities"],
};

const valuesOf = (a: Action): unknown[] => [...Object.values(a.facts), ...Object.values(a.proposal), a.risk_uah];

export async function draftBriefing(key: string, actions: Action[], notices: Action[], lang: Lang = "en"): Promise<Briefing> {
  const cands = actions.slice(0, CANDIDATES);
  const payload = JSON.stringify({
    candidates: cands.map((a) => ({
      id: a.id, type: a.type, product: a.product_name, risk_uah: a.risk_uah, facts: a.facts, proposal: a.proposal,
    })),
    store_notes: notices.map((n) => n.reason),
    language: lang === "uk" ? "Ukrainian" : "English",
  });

  const draft = await chatJson<{ summary: string; priorities: { action_id: string; reason: string }[] }>(
    key, SYSTEM_PROMPT, payload, SCHEMA,
  );

  const byId = new Map(cands.map((a) => [a.id, a]));
  const chosen: Action[] = [];
  for (const p of draft.priorities ?? []) {
    const a = byId.get(p.action_id);
    if (!a || chosen.some((c) => c.id === a.id)) continue;
    const reason = typeof p.reason === "string" && grounded(p.reason, allowedNumbers(valuesOf(a))) ? p.reason.trim() : a.reason;
    chosen.push({ ...a, reason });
    if (chosen.length === TOP_N) break;
  }
  for (const a of cands) {
    if (chosen.length === TOP_N) break;
    if (!chosen.some((c) => c.id === a.id)) chosen.push(a);
  }

  const total = chosen.reduce((s, a) => s + a.risk_uah, 0);
  const fallback =
    lang === "uk"
      ? `Сьогодні ${chosen.length} пріоритетів, під загрозою близько ₴${Math.round(total).toLocaleString("uk-UA")}.`
      : `${chosen.length} priorities today, about ₴${Math.round(total).toLocaleString("en-US")} at stake.`;
  const summary = typeof draft.summary === "string" ? draft.summary.trim() : "";
  const allowed = allowedNumbers(chosen.flatMap(valuesOf));
  return {
    summary: summary && grounded(summary, allowed) ? summary : fallback,
    source: "model",
    lang,
    priorities: chosen,
    notices,
  };
}
