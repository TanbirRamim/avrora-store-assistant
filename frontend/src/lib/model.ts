/**
 * One chat with the store's AI model, plus the number check every answer must pass.
 *
 * Requests go to this app's own server (`POST /api/ai/chat`), which forwards them to the store's
 * model with a key kept on the server. The browser never holds a key.
 */

export class ModelError extends Error {}

/** Where to send a chat: the store server, or "" for no AI (rules only). */
export type Route = "server" | "";

const UNREACHABLE = "Can't reach the AI service. Check your connection and try again.";

/** Sends one system + user message and returns the parsed JSON the model wrote. */
export async function chatJson<T>(route: Route | string, system: string, user: string, schema: object, timeoutMs = 180_000): Promise<T> {
  const messages = [{ role: "system", content: system }, { role: "user", content: user }];
  let content: unknown;
  try {
    const res = await fetch("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, schema }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    check(res);
    content = ((await res.json()) as { content?: unknown }).content;
  } catch (e) {
    if (e instanceof ModelError) throw e;
    throw new ModelError(UNREACHABLE);
  }
  try {
    return JSON.parse(String(content)) as T;
  } catch {
    throw new ModelError("The AI answer couldn't be used. Try again.");
  }
}

function check(res: Response) {
  if (res.ok) return;
  if (res.status === 503) throw new ModelError("AI isn't set up for this store yet.");
  if (res.status === 429) throw new ModelError("Too many AI requests. Wait a minute and try again.");
  throw new ModelError("The AI service had a problem. Try again.");
}

const NUM = /\d+(?:[.,]\d+)?/g;
const round1 = (x: number) => Math.round(x * 10) / 10;

export function allowedNumbers(values: unknown[]): Set<number> {
  const nums = new Set<number>();
  for (const v of values)
    for (const m of String(v).match(NUM) ?? []) {
      const x = Number(m.replace(",", "."));
      nums.add(x).add(Math.round(x)).add(round1(x));
    }
  return nums;
}

/** Digit groups split by spaces ("6 041", Ukrainian style) or plain numbers with . or , separators. */
const TOKEN = /\d{1,3}(?:[ \u00A0\u202F]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)*/g;

/** Every way a written number can be read: "6,041" is 6041 in English and 6.041 in Ukrainian. */
function readings(token: string): number[] {
  const t = token.replace(/[ \u00A0\u202F]/g, "");
  const seps = t.match(/[.,]/g) ?? [];
  if (seps.length === 0) return [Number(t)];
  if (new Set(seps).size === 2) {
    const dec = t.lastIndexOf(".") > t.lastIndexOf(",") ? "." : ",";
    return [Number(t.replace(dec === "." ? /,/g : /\./g, "").replace(",", "."))];
  }
  const grouped = /^\d{1,3}([.,]\d{3})+$/.test(t) ? [Number(t.replace(/[.,]/g, ""))] : [];
  return seps.length === 1 ? [Number(t.replace(",", ".")), ...grouped] : grouped;
}

/**
 * True when every number in the text comes from the data (small counts up to 7 are fine) and it fits
 * the word limit. Accepts English (6,041.5) and Ukrainian (6 041,5) number formatting.
 */
export function grounded(text: string, allowed: Set<number>, maxWords = 40): boolean {
  const ok = (x: number) => allowed.has(x) || allowed.has(Math.round(x)) || allowed.has(round1(x)) || (x <= 7 && Number.isInteger(x));
  for (const m of text.match(TOKEN) ?? []) {
    const whole = readings(m).some(ok);
    // "з 7 120 штук" may be two numbers, not one grouped number
    const parts = /\s/.test(m) && m.split(/[ \u00A0\u202F]/).every((p) => readings(p).some(ok));
    if (!whole && !parts) return false;
  }
  return text.split(/\s+/).filter(Boolean).length <= maxWords;
}
