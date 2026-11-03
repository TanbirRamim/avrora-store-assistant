/* Service worker: shows push notifications and opens the app at the item they are about. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let msg = {};
  try {
    msg = event.data ? event.data.json() : {};
  } catch {
    msg = { body: event.data ? event.data.text() : "" };
  }
  const title = msg.title || "Store Assistant";
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
