/**
 * Model-written briefing, called from the browser so the Open WebUI key never leaves it.
 * The OTH server only answers on the university network (campus or VPN), and it allows
 * cross-origin calls. Same prompt and checks as backend/src/avrora/ai/briefing.py: the model
 * only picks and explains actions the engine computed, and any reason with a number that is
 * not in that action's data falls back to the engine's text.
 */
import type { Action, Briefing } from "./api";

const HOST = "https://im-kigs-openwebui.oth-regensburg.de/ollama";
const MODEL = "qwen3:32b";
const CANDIDATES = 12;
const TOP_N = 5;

const SYSTEM_PROMPT = `You help the manager of a small discount store plan their day.
You receive candidate actions computed from the store's data. Each has an id, a type, the numbers behind it
and an estimated amount of money at stake in UAH.

Choose the five actions the manager should handle today and order them by urgency. Money at stake matters most,
but an item that will run out before a delivery can arrive is more urgent than slow stock that can wait a few
days. Write one short reason per action for a busy store manager: at most 25 words, plain language, no jargon.
Use only numbers that appear in that action's data. Write a one-sentence summary of the day.
Return exactly the JSON requested.`;

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

export class ModelError extends Error {}

const NUM = /\d+(?:[.,]\d+)?/g;
const round1 = (x: number) => Math.round(x * 10) / 10;

function allowedNumbers(values: unknown[]): Set<number> {
  const nums = new Set<number>();
  for (const v of values)
    for (const m of String(v).match(NUM) ?? []) {
      const x = Number(m.replace(",", "."));
      nums.add(x).add(Math.round(x)).add(round1(x));
    }
  return nums;
}

function grounded(text: string, allowed: Set<number>): boolean {
  for (const m of text.replace(/[  ]/g, "").match(NUM) ?? []) {
    const x = Number(m.replace(",", "."));
    if (!allowed.has(x) && !allowed.has(Math.round(x)) && !(x <= 7 && Number.isInteger(x))) return false;
  }
  return text.split(/\s+/).length <= 40;
}

const valuesOf = (a: Action): unknown[] => [...Object.values(a.facts), ...Object.values(a.proposal), a.risk_uah];

export async function draftBriefing(key: string, actions: Action[], notices: Action[]): Promise<Briefing> {
  const cands = actions.slice(0, CANDIDATES);
  const payload = JSON.stringify({
    candidates: cands.map((a) => ({
      id: a.id, type: a.type, product: a.product_name, risk_uah: a.risk_uah, facts: a.facts, proposal: a.proposal,
    })),
    store_notes: notices.map((n) => n.reason),
  });

  let res: Response;
  try {
    res = await fetch(`${HOST}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL, stream: false, think: false, format: SCHEMA, options: { temperature: 0 },
        messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: payload }],
      }),
      signal: AbortSignal.timeout(180_000),
    });
  } catch {
    throw new ModelError("The OTH server could not be reached. It only answers on the university network, so connect to the OTH VPN and try again.");
  }
  if (res.status === 401 || res.status === 403) throw new ModelError("The OTH server rejected this key. Check it in Open WebUI under Settings, Account.");
  if (res.status === 404) throw new ModelError(`The OTH server has no model called ${MODEL}.`);
  if (!res.ok) throw new ModelError(`The OTH server answered with an error (${res.status}). Try again.`);

  let draft: { summary: string; priorities: { action_id: string; reason: string }[] };
  try {
    draft = JSON.parse(((await res.json()) as { message: { content: string } }).message.content);
  } catch {
    throw new ModelError("The AI answer could not be used. Try again.");
  }

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
  const fallback = `${chosen.length} priorities today, about ₴${Math.round(total).toLocaleString("en-US")} at stake.`;
  const summary = typeof draft.summary === "string" ? draft.summary.trim() : "";
  const allowed = allowedNumbers(chosen.flatMap(valuesOf));
  return {
    summary: summary && grounded(summary, allowed) ? summary : fallback,
    source: "model",
    priorities: chosen,
    notices,
  };
}
