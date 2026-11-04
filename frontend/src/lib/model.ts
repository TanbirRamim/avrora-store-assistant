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
export const TIMED_OUT = "The AI took too long to answer. Try again.";
/** The server tries every model within about 25 s; past this the browser stops waiting. */
export const REQUEST_TIMEOUT_MS = 30_000;

/** Sends one system + user message and returns the parsed JSON the model wrote, money written as "₴2,671". */
export async function chatJson<T>(route: Route | string, system: string, user: string, schema: object, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
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
    if (e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError")) throw new ModelError(TIMED_OUT);
    throw new ModelError(UNREACHABLE);
  }
  try {
    return tidyAll(JSON.parse(String(content))) as T;
  } catch {
    throw new ModelError("The AI answer couldn't be used. Try again.");
  }
}

function check(res: Response) {
  if (res.ok) return;
  if (res.status === 503) throw new ModelError("AI isn't set up for this store yet.");
  if (res.status === 504) throw new ModelError(TIMED_OUT);
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
  // "17:00" may be written "5 pm"
  for (const v of values)
    for (const m of String(v).matchAll(/\b([01]?\d|2[0-3]):[0-5]\d\b/g)) nums.add(Number(m[1]) % 12 || 12);
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

const moneyFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
/** An amount as the cards show it: "₴2,671". */
export const fmtMoney = (v: number) => `₴${moneyFmt.format(Math.round(v))}`;

/** One written amount ("2671.10", "2 671,1", "2,671.10") as a number, or NaN. */
function amount(raw: string): number {
  const t = raw.replace(/[ \u00A0\u202F]/g, "");
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return Number(t.replace(/,/g, ""));
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) return Number(t.replace(/\./g, "").replace(",", "."));
  return Number(t.replace(",", "."));
}

const AMOUNT = String.raw`\d{1,3}(?:[ \u00A0\u202F]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)*`;
const CURRENCY_AFTER = new RegExp(String.raw`(${AMOUNT})\s*(?:UAH|грн(?:\.(?=\s+[a-zа-яіїєґ]))?|гривень|гривні|гривня|hryvnias?)(?![\p{L}])`, "giu");
const CURRENCY_BEFORE = new RegExp(String.raw`(?:₴|UAH)\s?(${AMOUNT})`, "gi");

/** "2671.10 UAH", "2 671,1 грн" and "₴2671.1" all become "₴2,671", matching the cards. */
export function tidyMoney(text: string): string {
  const fix = (all: string, n: string) => {
    const v = amount(n);
    return Number.isFinite(v) ? fmtMoney(v) : all;
  };
  return text.replace(CURRENCY_AFTER, fix).replace(CURRENCY_BEFORE, fix);
}

function tidyAll(v: unknown): unknown {
  if (typeof v === "string") return tidyMoney(v);
  if (Array.isArray(v)) return v.map(tidyAll);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, tidyAll(x)]));
  return v;
}
