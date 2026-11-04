/* Service worker: lets the Home Screen app open without a connection, shows push
 * notifications and opens the app at the item they are about. */

const CACHE = "avrora-v1";
const SHELL = ["/", "/manifest.webmanifest", "/avrora-mark.svg", "/icons/icon-192.png", "/icons/badge-96.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(fallbackUrl || request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(fallbackUrl || request);
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // only this app's own GET requests; map tiles, weather and the AI server go straight to the network
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/push")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, "/"));
  } else if (url.pathname.startsWith("/api/")) {
    // fresh data when online, the last copy when not
    event.respondWith(networkFirst(request));
  } else if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname.startsWith("/map/")) {
    // file names change with each build, so a cached copy is always the right one
    event.respondWith(cacheFirst(request));
  }
});

self.addEventListener("push", (event) => {
  let msg = {};
  try {
    msg = event.data ? event.data.json() : {};
  } catch {
    msg = { body: event.data ? event.data.text() : "" };
  }
  const title = msg.title || "Avrora";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: msg.body || "",
      tag: msg.tag || undefined,
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      data: { url: msg.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        // The page selects the action itself, so its state (scroll, view) survives.
        open.postMessage({ type: "open-url", url: target });
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});

// If the push service rotates the subscription, store the new one.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription;
      const res = await fetch("/api/push/key");
      if (!res.ok) return;
      const { publicKey } = await res.json();
      const pad = "=".repeat((4 - (publicKey.length % 4)) % 4);
      const key = Uint8Array.from(atob((publicKey + pad).replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
      const sub = event.newSubscription || (await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
      if (old) await fetch("/api/push/subscribe", { method: "DELETE", body: JSON.stringify({ endpoint: old.endpoint }) });
      await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
    })(),
  );
});
