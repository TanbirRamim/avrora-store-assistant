/**
 * Avrora store assistant on Cloudflare.
 *
 * The store data is synthetic and fixed, so the read-only routes serve a snapshot that
 * `python -m avrora.export` writes at build time. Decisions are the only runtime state
 * and live in D1. Routes and payloads match the FastAPI backend.
 */
import snapshot from "./snapshot.json";

interface Env {
  DB: D1Database;
}

type DecisionKind = "approve" | "reject" | "change";

interface DecisionRow {
  action_id: string;
  decision: DecisionKind;
  reason: string | null;
  value: number | null;
  decided_at: string;
}

const KINDS = new Set<DecisionKind>(["approve", "reject", "change"]);
const KNOWN = new Set(snapshot.actions.map((a) => a.id));
const PRODUCTS = snapshot.products as Record<string, unknown>;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const fail = (status: number, detail: string) => json({ detail }, status);

async function decide(req: Request, env: Env): Promise<Response> {
  let body: Partial<DecisionRow>;
  try {
    body = await req.json();
  } catch {
    return fail(422, "Body must be JSON");
  }
  const { action_id, decision } = body;
  const reason = body.reason ?? null;
  const value = body.value ?? null;
  if (typeof action_id !== "string" || !KNOWN.has(action_id)) return fail(404, `Unknown action ${action_id}`);
  if (!decision || !KINDS.has(decision)) return fail(422, "Decision must be approve, reject or change");
  if (reason !== null && (typeof reason !== "string" || reason.length > 200)) return fail(422, "Reason is too long");
  if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0))
    return fail(422, "Value must be a number of at least 0");
  if (decision === "change" && value === null) return fail(422, "A changed decision needs a value");

  const out: DecisionRow = {
    action_id,
    decision,
    reason,
    value,
    decided_at: new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00"),
  };
  await env.DB.prepare("INSERT OR REPLACE INTO decisions VALUES (?, ?, ?, ?, ?)")
    .bind(out.action_id, out.decision, out.reason, out.value, out.decided_at)
    .run();
  return json(out);
}

export default {
  async fetch(req, env): Promise<Response> {
    const { pathname } = new URL(req.url);
    const method = req.method;

    if (method === "GET") {
      switch (pathname) {
        case "/api/health":
          return json({ status: "ok" });
        case "/api/overview":
        case "/api/briefing":
        case "/api/actions":
        case "/api/evaluation":
          return json(snapshot[pathname.slice(5) as "overview" | "briefing" | "actions" | "evaluation"]);
        case "/api/decisions": {
          const { results } = await env.DB.prepare(
            "SELECT action_id, decision, reason, value, decided_at FROM decisions ORDER BY decided_at DESC",
          ).all<DecisionRow>();
          return json(results);
        }
      }
      const product = pathname.match(/^\/api\/products\/([^/]+)$/);
      if (product) {
        const id = decodeURIComponent(product[1]);
        return id in PRODUCTS ? json(PRODUCTS[id]) : fail(404, `Unknown product ${id}`);
      }
    }

    if (method === "POST" && pathname === "/api/decisions") return decide(req, env);

    const undo = pathname.match(/^\/api\/decisions\/([^/]+)$/);
    if (method === "DELETE" && undo) {
      await env.DB.prepare("DELETE FROM decisions WHERE action_id = ?").bind(decodeURIComponent(undo[1])).run();
      return new Response(null, { status: 204 });
    }

    return fail(404, "Not found");
  },
} satisfies ExportedHandler<Env>;
