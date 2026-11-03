"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { currentSubscription, pushSupport, sendTest, subscribe, unsubscribe, type PushSupport } from "@/lib/push";
import { BellIcon, CloseIcon } from "./icons";

/** Settings sheet for push notifications on this device. */
export function NotificationsSheet({ onClose }: { onClose: () => void }) {
  // Only rendered after a tap, never on the server, so browser checks can run during the first render.
  const [support] = useState<PushSupport>(pushSupport);
  const [sub, setSub] = useState<PushSubscription | null>(null);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (support !== "supported") return;
    currentSubscription().then(setSub, () => undefined);
    // The Permissions API is more reliable than Notification.permission in some browsers.
    navigator.permissions
      ?.query({ name: "notifications" })
      .then((p) => setDenied(p.state === "denied"))
      .catch(() => setDenied(Notification.permission === "denied"));
  }, [support]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await work();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong.";
      if (msg === "blocked") setDenied(true);
      else setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const toggle = () =>
    run(async () => {
      if (sub) {
        await unsubscribe(sub);
        setSub(null);
      } else {
        setSub(await subscribe());
      }
    });

  const test = () =>
    run(async () => {
      if (!sub) return;
      await sendTest(sub);
      setStatus("Sent. It should arrive in a few seconds.");
    });

  const on = sub !== null;

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/30"
      />
      <div className="pointer-events-none fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6">
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="notif-title"
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 40, opacity: 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 38 }}
          className="pointer-events-auto w-full max-w-[460px] rounded-t-[12px] bg-bg pb-[max(env(safe-area-inset-bottom),16px)] md:rounded-[14px] md:pb-4 md:shadow-[0_24px_60px_rgba(0,0,0,0.25)]"
        >
          <header className="flex items-center gap-3 border-b border-separator px-4 py-3">
            <span className="icon-tile size-[30px]" style={{ background: "var(--order)" }}>
              <BellIcon size={17} />
            </span>
            <h2 id="notif-title" className="t-headline flex-1">Notifications</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close notifications"
              className="grid size-[30px] place-items-center rounded-full bg-fill text-label-2 hover:bg-fill-2"
            >
              <CloseIcon />
            </button>
          </header>

          <div className="px-4 pt-4">
            {support === "ios-needs-home-screen" && (
              <>
                <div className="group-list px-4 py-3">
                  <p className="t-body">Add to Home Screen first</p>
                  <ol className="t-subhead mt-1 list-decimal space-y-0.5 pl-5 text-label-2">
                    <li>Tap the Share button in Safari.</li>
                    <li>Choose Add to Home Screen.</li>
                    <li>Open Store from your Home Screen and come back here.</li>
                  </ol>
                </div>
                <p className="group-footer">iPhone shows notifications only for apps on the Home Screen (iOS 16.4 or later).</p>
              </>
            )}

            {support === "unsupported" && (
              <div className="group-list t-subhead px-4 py-3 text-label-2">
                This browser can&apos;t show notifications. Try Chrome, Edge, Firefox or Safari.
              </div>
            )}

            {support === "supported" && (
              <>
                <div className="group-list">
                  <div className="cell flex items-center justify-between gap-3 px-4 py-[11px]">
                    <span className="t-body" id="notif-switch-label">Urgent alerts</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      aria-labelledby="notif-switch-label"
                      disabled={busy}
                      onClick={toggle}
                      className={`relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                        on ? "bg-done" : "bg-fill-2"
                      }`}
                    >
                      <span
                        className={`absolute top-[2px] size-[27px] rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_3px_1px_rgba(0,0,0,0.06)] transition-[left] ${
                          on ? "left-[22px]" : "left-[2px]"
                        }`}
                      />
                    </button>
                  </div>
                  {on && (
                    <button
                      type="button"
                      onClick={test}
                      disabled={busy}
                      className="cell t-body w-full px-4 py-[11px] text-left text-tint disabled:opacity-50"
                    >
                      Send test notification
                    </button>
                  )}
                </div>
                <p className="group-footer">
                  {denied && !on
                    ? "Notifications are blocked for this site. Allow them in your browser or system settings, then try again."
                    : "Items about to run out, late deliveries and store notes. Each alert is sent once."}
                </p>
              </>
            )}

            {status && (
              <p role="status" className="t-subhead mt-4 px-1 text-label-2">
                {status}
              </p>
            )}
            {error && (
              <p role="alert" className="t-subhead mt-4 px-1" style={{ color: "var(--order-text)" }}>
                {error}
              </p>
            )}
          </div>
        </motion.div>
      </div>
    </>
  );
}
