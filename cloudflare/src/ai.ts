/**
 * Store AI proxy: POST /api/ai/chat forwards one chat to an OpenAI-compatible provider
 * (`{AI_BASE_URL}/chat/completions`), GET /api/ai/status says whether it is set up.
 *
 * AI_BASE_URL and AI_MODEL are vars in wrangler.jsonc; AI_API_KEY is a secret
 * AI_MODEL may list fallbacks, comma separated ("a,b,c"): when a model is busy or gone (404, 429, 5xx,
 * timeout) the next one answers. AI_REASONING_EFFORT (optional, e.g. "low") keeps thinking models fast.
 * (`npx wrangler secret put AI_API_KEY`). The key is never returned, logged or put in the snapshot.
 * Mirrors backend/src/avrora/api/ai.py.
 */

export interface AiEnv {
  AI_BASE_URL?: string;
  AI_MODEL?: string;
  AI_API_KEY?: string;
  AI_REASONING_EFFORT?: string;
}

const MAX_BODY = 64 * 1024; // bytes
const MAX_TOKENS = 1500;
const MAX_MESSAGES = 4;
const TIMEOUT_MS = 45_000; // per model; the next fallback gets its own
const RETRY_PAUSE_MS = 1500; // one more pass over the models when all were busy
/** Per-isolate limit per client IP: enough for a manager, not for a script. */
const WINDOW_MS = 60_000;
const PER_WINDOW = 20;
const hits = new Map<string, number[]>();

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const fail = (status: number, detail: string) => json({ detail }, status);

const models = (env: AiEnv) => (env.AI_MODEL ?? "").split(",").map((m) => m.trim()).filter(Boolean);
const configured = (env: AiEnv) => Boolean(env.AI_BASE_URL && models(env).length);
/** Worth trying the next model: it is gone, rate-limited or overloaded. */
const tryNext = (status: number) => status === 404 || status === 429 || status >= 500;

export function aiStatus(env: AiEnv): Response {
  return json({ configured: configured(env), model: configured(env) ? models(env)[0] : null });
}

function limited(ip: string, now = Date.now()): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.size > 5000) hits.clear();
  if (recent.length >= PER_WINDOW) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  return false;
}

interface ChatIn {
  messages: { role: "system" | "user"; content: string }[];
  schema?: object;
  max_tokens?: number;
}

function parse(body: unknown): ChatIn | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const msgs = b.messages;
  if (!Array.isArray(msgs) || msgs.length === 0 || msgs.length > MAX_MESSAGES) return null;
  for (const m of msgs)
    if (!m || typeof m !== "object" || !["system", "user"].includes((m as { role: string }).role) || typeof (m as { content: unknown }).content !== "string")
      return null;
  if (b.schema !== undefined && (typeof b.schema !== "object" || b.schema === null)) return null;
  const mt = b.max_tokens;
  if (mt !== undefined && (typeof mt !== "number" || !Number.isFinite(mt) || mt < 1)) return null;
  return { messages: msgs as ChatIn["messages"], schema: b.schema as object | undefined, max_tokens: mt as number | undefined };
}

export async function aiChat(req: Request, env: AiEnv): Promise<Response> {
  if (!configured(env)) return fail(503, "AI is not set up");
  if (limited(req.headers.get("CF-Connecting-IP") ?? "local")) return fail(429, "Too many AI requests. Wait a minute.");
  if (Number(req.headers.get("Content-Length") ?? 0) > MAX_BODY) return fail(413, "Request too large");
  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_BODY) return fail(413, "Request too large");
  let input: ChatIn | null;
  try {
    input = parse(JSON.parse(text));
  } catch {
    input = null;
  }
  if (!input) return fail(422, "Body must be {messages: [{role, content}], schema?, max_tokens?}");

  const url = `${env.AI_BASE_URL!.replace(/\/+$/, "")}/chat/completions`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (env.AI_API_KEY) headers.Authorization = `Bearer ${env.AI_API_KEY}`;
  const base = {
    messages: input.messages, temperature: 0, stream: false,
    max_tokens: Math.min(input.max_tokens ?? MAX_TOKENS, MAX_TOKENS),
    ...(env.AI_REASONING_EFFORT ? { reasoning_effort: env.AI_REASONING_EFFORT } : {}),
  };
  const call = (model: string, format?: object) =>
    fetch(url, {
      method: "POST", headers, signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({ ...base, model, ...(format ? { response_format: format } : {}) }),
    });

  let last = "Can't reach the AI provider";
  try {
    const list = models(env);
    for (const [attempt, model] of [...list, ...list].entries()) {
      if (attempt === list.length) await new Promise((r) => setTimeout(r, RETRY_PAUSE_MS));
      let res: Response;
      try {
        res = await call(model, input.schema ? { type: "json_schema", json_schema: { name: "answer", schema: input.schema } } : undefined);
        // some providers only know plain JSON mode
        if (res.status === 400 && input.schema) res = await call(model, { type: "json_object" });
      } catch {
        last = "Can't reach the AI provider";
        continue; // timeout or network: try the next model
      }
      if (!res.ok) {
        last = `The AI provider answered ${res.status}`;
        if (tryNext(res.status)) continue;
        return fail(502, last);
      }
      const out = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
      const content = out.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) {
        last = "The AI provider sent no answer";
        continue;
      }
      return json({ content, model });
    }
    return fail(502, last);
  } catch {
    return fail(502, "Can't reach the AI provider");
  }
}
