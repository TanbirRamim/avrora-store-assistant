/** Push routes and the cron job that turns urgent signals into notifications. */
import { collectSignals, type Signal } from "./signals";
import { sendPush, type PushMessage, type PushSubscriptionRow, type VapidKeys } from "./webpush";

export interface PushEnv {
  DB: D1Database;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT: string;
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

function parseSubscription(body: unknown): PushSubscriptionRow | null {
  if (!body || typeof body !== "object") return null;
  const { endpoint, keys } = body as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof endpoint !== "string" || endpoint.length > 2048) return null;
  try {
    if (new URL(endpoint).protocol !== "https:") return null;
  } catch {
    return null;
  }
  const p256dh = keys?.p256dh;
  const auth = keys?.auth;
  if (typeof p256dh !== "string" || !B64URL.test(p256dh) || p256dh.length < 80 || p256dh.length > 100) return null;
  if (typeof auth !== "string" || !B64URL.test(auth) || auth.length < 16 || auth.length > 32) return null;
  return { endpoint, p256dh, auth };
}

async function readJson(req: Request): Promise<unknown> {
  try {
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
  const status = await sendPush(sub, msg, keys);
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
    const sub = parseSubscription(await readJson(req));
    if (!sub) return fail(422, "Not a valid push subscription");
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
    if (status >= 400) return fail(502, `The push service answered ${status}`);
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
  const signals = await collectSignals({ db: env.DB, now });
  if (signals.length === 0) return { signals: 0, sent: 0 };

  const { results: subs } = await env.DB.prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions").all<PushSubscriptionRow>();
  const { results: sentRows } = await env.DB.prepare("SELECT endpoint, signal_key FROM push_sent").all<{
    endpoint: string;
    signal_key: string;
  }>();
  const sent = new Set(sentRows.map((r) => `${r.endpoint}\n${r.signal_key}`));
  const stamp = now.toISOString();
  let count = 0;

  await Promise.all(
    subs.map(async (sub) => {
      const fresh = signals.filter((s) => !sent.has(`${sub.endpoint}\n${s.key}`));
      if (fresh.length === 0) return;
      const direct = fresh.length > MAX_PER_RUN ? fresh.slice(0, MAX_PER_RUN - 1) : fresh;
      const rest = fresh.slice(direct.length);
      const messages = direct.map(toMessage);
      if (rest.length > 0) {
        messages.push({
          title: `${rest.length} more urgent items`,
          body: rest.map((s) => s.title).join(" · "),
          url: "/",
          tag: "summary",
        });
      }
      for (const msg of messages) {
        const status = await deliver(env, keys, sub, msg);
        if (status === 404 || status === 410) return;
        if (status >= 400) return; // try again next run
        count++;
      }
      await env.DB.batch(
        fresh.map((s) => env.DB.prepare("INSERT OR IGNORE INTO push_sent VALUES (?, ?, ?)").bind(sub.endpoint, s.key, stamp)),
      );
    }),
  );
  return { signals: signals.length, sent: count };
}
