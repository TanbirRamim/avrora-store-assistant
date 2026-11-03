"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { currentSubscription, pushSupport, sendTest, subscribe, unsubscribe, type PushSupport } from "@/lib/push";
import { CloseIcon } from "./icons";

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
      const msg = err instanceof Error && !(err instanceof DOMException) ? err.message : "Something went wrong. Try again.";
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
      <div className="pointer-events-none fixed inset-x-0 top-0 bottom-[var(--kb,0px)] z-50 flex items-end justify-center pt-[calc(env(safe-area-inset-top)+10px)] md:items-center md:p-6">
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="notif-title"
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 40, opacity: 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 38 }}
          className="float pointer-events-auto relative max-h-full w-full max-w-[440px] overflow-y-auto overscroll-contain rounded-t-[20px] bg-floor pb-[max(env(safe-area-inset-bottom),20px)] md:rounded-[20px] md:pb-6"
        >
          <div className="flex justify-center pt-2 md:hidden" aria-hidden>
            <span className="h-[5px] w-9 rounded-full bg-[rgba(0,0,0,0.2)]" />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close notifications"
            className="absolute right-2 top-2 grid size-[44px] place-items-center"
          >
            <span className="grid size-[32px] place-items-center rounded-full bg-fill text-ink hover:bg-fill-2">
              <CloseIcon />
            </span>
          </button>

          <header className="px-5 pr-14 pt-4 md:pt-6">
            <h2 id="notif-title" className="t-title2 font-display">Notifications</h2>
            <p className="t-subhead mt-1.5 text-muted">
              Get an alert when an item is about to run out, a delivery is late or the store adds a note.
            </p>
            {support === "supported" && (
              <span className="t-subhead mt-3 flex items-center gap-2 font-medium">
                <span className="size-2 rounded-full" style={{ background: on ? "var(--green)" : denied ? "var(--red)" : "var(--muted)" }} aria-hidden />
                {on ? "On for this device" : denied ? "Blocked in browser settings" : "Off for this device"}
              </span>
            )}
          </header>

          <div className="px-4 pt-6">
            {support === "ios-needs-home-screen" && (
              <>
                <div className="rounded-[14px] bg-paper p-4">
                  <p className="t-headline">Add to Home Screen first</p>
                  <ol className="mt-3 space-y-2.5">
                    {["Tap the Share button in Safari.", "Choose Add to Home Screen.", "Open Store from your Home Screen and come back here."].map((t, i) => (
                      <li key={t} className="t-subhead flex items-start gap-3">
                        <span className="num grid size-6 shrink-0 place-items-center rounded-full bg-fill text-[13px] font-semibold text-label" aria-hidden>
                          {i + 1}
                        </span>
                        <span className="pt-[2px]">{t}</span>
                      </li>
                    ))}
                  </ol>
                </div>
                <p className="t-footnote px-4 pt-2 text-muted">iPhone shows notifications only for apps on the Home Screen (iOS 16.4 or later).</p>
              </>
            )}

            {support === "unsupported" && (
              <div className="rounded-[14px] bg-paper t-subhead p-4 text-muted">
                This browser can&apos;t show notifications. Try Chrome, Edge, Firefox or Safari.
              </div>
            )}

            {support === "supported" && (
              <>
                <div className="rounded-[14px] bg-paper">
                  <div className="flex min-h-[56px] items-center justify-between gap-3 px-4 py-2">
                    <span className="min-w-0">
                      <span className="t-body block" id="notif-switch-label">Urgent alerts</span>
                      <span className="t-footnote block text-muted">Each alert is sent once.</span>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      aria-labelledby="notif-switch-label"
                      disabled={busy}
                      onClick={toggle}
                      className={`relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                        on ? "bg-green" : "bg-[#c9c9c2]"
                      }`}
                    >
                      <span
                        className={`absolute top-[2px] size-[27px] rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_3px_1px_rgba(0,0,0,0.06)] transition-[left] motion-reduce:transition-none ${
                          on ? "left-[22px]" : "left-[2px]"
                        }`}
                      />
                    </button>
                  </div>
                </div>
                {denied && !on && (
                  <p className="t-footnote px-4 pt-2 text-muted">
                    Notifications are blocked for this site. Allow them in your browser or system settings, then try again.
                  </p>
                )}
                {on && (
                  <button
                    type="button"
                    onClick={test}
                    disabled={busy}
                    className="btn-ink mt-6 min-h-[52px] w-full disabled:opacity-40"
                  >
                    Send test notification
                  </button>
                )}
              </>
            )}

            {status && (
              <p role="status" className="t-subhead mt-4 text-center text-muted">
                {status}
              </p>
            )}
            {error && (
              <p role="alert" className="t-subhead mt-4 rounded-[14px] border-l-[4px] border-red bg-paper px-4 py-3 font-medium text-red">
                {error}
              </p>
            )}
          </div>
        </motion.div>
      </div>
    </>
  );
}
