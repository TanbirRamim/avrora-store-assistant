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

/** True when every number in the text comes from the data (small counts up to 7 are fine) and it fits the word limit. */
export function grounded(text: string, allowed: Set<number>, maxWords = 40): boolean {
  for (const m of text.replace(/[  ]/g, "").match(NUM) ?? []) {
    const x = Number(m.replace(",", "."));
    if (!allowed.has(x) && !allowed.has(Math.round(x)) && !(x <= 7 && Number.isInteger(x))) return false;
  }
  return text.split(/\s+/).length <= maxWords;
}
