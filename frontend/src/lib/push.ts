/** Browser side of push notifications: support checks, subscribe, unsubscribe, test. */

export type PushSupport =
  | "supported"
  | "ios-needs-home-screen" // iPhone/iPad Safari tab: push only works from a Home Screen app (iOS 16.4+)
  | "unsupported";

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  const apis = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (isIos() && !isStandalone()) return "ios-needs-home-screen";
  return apis ? "supported" : "unsupported";
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const bin = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function send(path: string, method: string, body: unknown) {
  const res = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json()).detail ?? "";
    } catch {}
    throw new Error(detail || `The server answered ${res.status}.`);
  }
}

export function registerServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return Promise.resolve(undefined);
  return navigator.serviceWorker.register("/sw.js").catch(() => undefined);
}

async function registration() {
  await registerServiceWorker();
  return navigator.serviceWorker.ready;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== "supported") return null;
  const reg = await registration();
  return reg.pushManager.getSubscription();
}

/** Asks for permission, subscribes this device and stores it on the server. */
export async function subscribe(): Promise<PushSubscription> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(permission === "denied" ? "blocked" : "Permission was not given.");
  const res = await fetch("/api/push/key");
  if (!res.ok) throw new Error("Notifications are not set up on this server.");
  const { publicKey } = (await res.json()) as { publicKey: string };
  const reg = await registration();
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  await send("/api/push/subscribe", "POST", sub.toJSON());
  return sub;
}

export async function unsubscribe(sub: PushSubscription) {
  await send("/api/push/subscribe", "DELETE", { endpoint: sub.endpoint }).catch(() => undefined);
  await sub.unsubscribe();
}

export const sendTest = (sub: PushSubscription) => send("/api/push/test", "POST", { endpoint: sub.endpoint });
