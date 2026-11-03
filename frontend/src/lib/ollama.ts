/**
 * Shared request and number check for the OTH Open WebUI model, called from the browser.
 * The server only answers on the university network (campus or VPN).
 */
export const HOST = "https://im-kigs-openwebui.oth-regensburg.de/ollama";
export const MODEL = "qwen3:32b";

export class ModelError extends Error {}

export const VPN_MESSAGE =
  "The OTH server could not be reached. It only answers on the university network, so connect to the OTH VPN and try again.";

/** Sends one system + user message and returns the parsed JSON the model wrote. */
export async function chatJson<T>(key: string, system: string, user: string, schema: object, timeoutMs = 180_000): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${HOST}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL, stream: false, think: false, format: schema, options: { temperature: 0 },
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ModelError(VPN_MESSAGE);
  }
  if (res.status === 401 || res.status === 403) throw new ModelError("The OTH server rejected this key. Check it in Open WebUI under Settings, Account.");
  if (res.status === 404) throw new ModelError(`The OTH server has no model called ${MODEL}.`);
  if (!res.ok) throw new ModelError(`The OTH server answered with an error (${res.status}). Try again.`);
  try {
    return JSON.parse(((await res.json()) as { message: { content: string } }).message.content) as T;
  } catch {
    throw new ModelError("The AI answer could not be used. Try again.");
  }
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
