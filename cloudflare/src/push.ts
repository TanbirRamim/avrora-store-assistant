/** Push routes and the cron job that turns urgent signals into notifications. */
import { collectSignals, type Signal } from "./signals";
import { sendPush, type PushMessage, type PushSubscriptionRow, type VapidKeys } from "./webpush";

export interface PushEnv {
  DB: D1Database;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT: string;
  ALERTS_IN_UA_TOKEN?: string;
}

/** Most notifications one cron run sends to a phone; the rest are folded into a summary. */
const MAX_PER_RUN = 3;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const fail = (status: number, detail: string) => json({ detail }, status);

function vapid(env: PushEnv): VapidKeys | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
  return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT };
}

const B64URL = /^[A-Za-z0-9_-]+$/;

/** Push services subscriptions may point at: exact hosts, or "*.suffix" for any subdomain. */
const PUSH_HOSTS = [
  "fcm.googleapis.com",
  "android.googleapis.com",
  "updates.push.services.mozilla.com",
  "*.push.services.mozilla.com",
  "*.notify.windows.com",
  "web.push.apple.com",
  "*.push.apple.com",
];

function knownPushHost(host: string): boolean {
  return PUSH_HOSTS.some((h) => (h.startsWith("*.") ? host.endsWith(h.slice(1)) : host === h));
}

/** An https endpoint on a known push service, with no credentials or custom port. */
function validEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && !u.username && !u.password && u.port === "" && knownPushHost(u.hostname);
  } catch {
    return false;
  }
}

function b64urlBytes(s: string): Uint8Array | null {
  if (!B64URL.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** A real uncompressed P-256 point: 65 bytes starting with 0x04, and on the curve (WebCrypto checks that on import). */
async function validP256dh(p256dh: string): Promise<boolean> {
  const raw = b64urlBytes(p256dh);
  if (!raw || raw.length !== 65 || raw[0] !== 0x04) return false;
  try {
    await crypto.subtle.importKey("raw", raw, { name: "ECDH", namedCurve: "P-256" }, false, []);
    return true;
  } catch {
    return false;
  }
}

async function parseSubscription(body: unknown): Promise<PushSubscriptionRow | null> {
  if (!body || typeof body !== "object") return null;
  const { endpoint, keys } = body as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof endpoint !== "string" || endpoint.length > 2048) return null;
  if (!validEndpoint(endpoint)) return null;
  const p256dh = keys?.p256dh;
  const auth = keys?.auth;
  if (typeof p256dh !== "string" || !(await validP256dh(p256dh))) return null;
  if (typeof auth !== "string" || !B64URL.test(auth) || auth.length < 16 || auth.length > 32) return null;
  return { endpoint, p256dh, auth };
}

async function readJson(req: Request): Promise<unknown> {
  try {
    if (Number(req.headers.get("Content-Length") ?? 0) > 8192) return null;
    return await req.json();
  } catch {
    return null;
  }
}

async function forget(env: PushEnv, endpoint: string) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(endpoint),
    env.DB.prepare("DELETE FROM push_sent WHERE endpoint = ?").bind(endpoint),
  ]);
}

/** Sends and drops the subscription if the push service says it no longer exists. */
async function deliver(env: PushEnv, keys: VapidKeys, sub: PushSubscriptionRow, msg: PushMessage): Promise<number> {
  // Rows stored before validation existed (or edited by hand) are dropped, never sent to.
  if (!validEndpoint(sub.endpoint) || !(await validP256dh(sub.p256dh))) {
    await forget(env, sub.endpoint);
    return 410;
  }
  let status: number;
  try {
    status = await sendPush(sub, msg, keys);
  } catch (e) {
    console.error("push threw", (e as Error).name); // network error: retry next run
    return 599;
  }
  if (status === 404 || status === 410) await forget(env, sub.endpoint);
  else if (status >= 400) console.error("push failed", status, new URL(sub.endpoint).host);
  return status;
}

/** Answers /api/push/*, or returns null for other paths. */
export async function handlePush(req: Request, env: PushEnv, pathname: string): Promise<Response | null> {
  const method = req.method;

  if (pathname === "/api/push/key" && method === "GET") {
    return env.VAPID_PUBLIC_KEY ? json({ publicKey: env.VAPID_PUBLIC_KEY }) : fail(503, "Notifications are not set up");
  }

  if (pathname === "/api/push/subscribe" && method === "POST") {
    const sub = await parseSubscription(await readJson(req));
    if (!sub) return fail(422, "Not a valid push subscription");
    // A browser that re-subscribes keeps its endpoint but may bring new keys: store the newest ones.
    await env.DB.prepare(
      "INSERT INTO push_subscriptions VALUES (?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth",
    )
      .bind(sub.endpoint, sub.p256dh, sub.auth, new Date().toISOString())
      .run();
    return json({ subscribed: true }, 201);
  }

  if (pathname === "/api/push/subscribe" && method === "DELETE") {
    const body = (await readJson(req)) as { endpoint?: unknown } | null;
    if (typeof body?.endpoint !== "string") return fail(422, "Body needs the subscription endpoint");
    await forget(env, body.endpoint);
    return new Response(null, { status: 204 });
  }

  if (pathname === "/api/push/test" && method === "POST") {
    const keys = vapid(env);
    if (!keys) return fail(503, "Notifications are not set up");
    const body = (await readJson(req)) as { endpoint?: unknown } | null;
    if (typeof body?.endpoint !== "string") return fail(422, "Body needs the subscription endpoint");
    const sub = await env.DB.prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE endpoint = ?")
      .bind(body.endpoint)
      .first<PushSubscriptionRow>();
    if (!sub) return fail(404, "This device is not subscribed");
    const status = await deliver(env, keys, sub, {
      title: "Test notification",
      body: "Notifications work. Urgent items will show up like this.",
      url: "/",
      tag: "test",
    });
    if (status === 404 || status === 410) return fail(410, "This device's subscription expired. Turn notifications on again.");
    if (status >= 400) return fail(502, "The push service did not accept the test notification");
    return json({ sent: true });
  }

  return pathname.startsWith("/api/push/") ? fail(404, "Not found") : null;
}

function toMessage(s: Signal): PushMessage {
  return { title: s.title, body: s.body, url: s.url, tag: s.key };
}

/** Cron: send every new urgent signal to every phone once. */
export async function sendUrgent(env: PushEnv, now = new Date()): Promise<{ signals: number; sent: number }> {
  const keys = vapid(env);
  if (!keys) {
    console.error("VAPID_PRIVATE_KEY is not set; skipping push");
    return { signals: 0, sent: 0 };
  }
  const signals = await collectSignals({ db: env.DB, now, alertsToken: env.ALERTS_IN_UA_TOKEN });
  if (signals.length === 0) return { signals: 0, sent: 0 };

  const { results: subs } = await env.DB.prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions").all<PushSubscriptionRow>();
  const { results: sentRows } = await env.DB.prepare("SELECT endpoint, signal_key FROM push_sent").all<{
    endpoint: string;
    signal_key: string;
  }>();
  const sent = new Set(sentRows.map((r) => `${r.endpoint}\n${r.signal_key}`));
  const stamp = now.toISOString();
  let count = 0;

  await Promise.allSettled(
    subs.map(async (sub) => {
      const fresh = signals.filter((s) => !sent.has(`${sub.endpoint}\n${s.key}`));
      if (fresh.length === 0) return;
      const direct = fresh.length > MAX_PER_RUN ? fresh.slice(0, MAX_PER_RUN - 1) : fresh;
      const rest = fresh.slice(direct.length);
      const items: { msg: PushMessage; keys: string[] }[] = direct.map((sig) => ({ msg: toMessage(sig), keys: [sig.key] }));
      if (rest.length > 0) {
        items.push({
          msg: {
            title: `${rest.length} more urgent items`,
            body: rest.map((s) => s.title).join(" · "),
            url: "/",
            tag: "summary",
          },
          keys: rest.map((s) => s.key),
        });
      }
      for (const { msg, keys: covered } of items) {
        let status: number;
        try {
          status = await deliver(env, keys, sub, msg);
        } catch (e) {
          console.error("push row failed", (e as Error).name); // one bad row must not stall the others
          return;
        }
        if (status >= 400) return; // gone (already forgotten) or try again next run
        count++;
        // Record per message, so a failure further on does not resend what already arrived.
        await env.DB.batch(
          covered.map((k) => env.DB.prepare("INSERT OR IGNORE INTO push_sent VALUES (?, ?, ?)").bind(sub.endpoint, k, stamp)),
        );
      }
    }),
  );
  return { signals: signals.length, sent: count };
}
