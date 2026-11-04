"use client";

import { motion } from "motion/react";
import { SCRIM_FADE, SHEET_SPRING } from "@/lib/motion";
import { useEffect, useState } from "react";
import { currentSubscription, pushSupport, sendTest, subscribe, unsubscribe, type PushSupport } from "@/lib/push";
import { CloseIcon } from "./icons";

/** Settings sheet for push notifications on this device. */
export function NotificationsSheet({ onClose }: { onClose: () => void }) {
  // Only rendered after a tap, never on the server, so browser checks can run during the first render.
  const [support] = useState<PushSupport>(pushSupport);
  const [phone] = useState(() => !matchMedia("(min-width: 768px)").matches);
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
        transition={SCRIM_FADE}
        onClick={onClose}
        className="fixed inset-0 z-40 bg-[var(--scrim)]"
      />
      <div className="pointer-events-none fixed inset-x-0 top-0 bottom-[var(--kb,0px)] z-50 flex items-end justify-center pt-[calc(env(safe-area-inset-top)+10px)] md:items-center md:p-6">
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="notif-title"
          // phones: the sheet slides up from the bottom edge; wider screens: the dialog rises and fades in
          initial={phone ? { y: "100%" } : { y: 16, opacity: 0, scale: 0.98 }}
          animate={phone ? { y: 0 } : { y: 0, opacity: 1, scale: 1 }}
          exit={phone ? { y: "100%" } : { y: 12, opacity: 0, scale: 0.98 }}
          transition={SHEET_SPRING}
          className="pointer-events-auto relative max-h-full w-full max-w-[440px] overflow-y-auto overscroll-contain rounded-t-[16px] border border-[var(--border)] bg-paper pb-[max(env(safe-area-inset-bottom),20px)] shadow-[0_8px_24px_rgba(16,24,40,0.08),0_2px_6px_rgba(16,24,40,0.04)] md:rounded-[12px] md:pb-6"
        >
          <div className="flex justify-center pt-2 md:hidden" aria-hidden>
            <span className="h-[5px] w-9 rounded-full bg-[#d4d4d8]" />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close notifications"
            className="absolute right-2 top-2 grid size-[44px] place-items-center"
          >
            <span className="grid size-[32px] place-items-center rounded-full bg-[#f4f4f5] text-muted hover:bg-[#e4e4e7] hover:text-ink">
              <CloseIcon />
            </span>
          </button>

          <header className="px-5 pr-14 pt-4 md:pt-6">
            <h2 id="notif-title" className="text-[20px] font-semibold leading-[26px] tracking-[-0.02em]">Notifications</h2>
            <p className="mt-1.5 text-[14px] leading-[20px] text-muted">
              Get an alert when an item is about to run out, a delivery is late or the store adds a note.
            </p>
            {support === "supported" && (
              <span
                className="mt-3 inline-flex h-[22px] items-center gap-1.5 rounded-full px-2 text-[12px] font-medium"
                style={
                  on
                    ? { background: "var(--success-bg)", color: "var(--green)" }
                    : denied
                      ? { background: "var(--critical-bg)", color: "var(--red)" }
                      : { background: "var(--neutral-bg)", color: "#3f3f46" }
                }
              >
                <span className="size-1.5 rounded-full" style={{ background: on ? "var(--green)" : denied ? "var(--red)" : "#71717a" }} aria-hidden />
                {on ? "On for this device" : denied ? "Blocked in browser settings" : "Off for this device"}
              </span>
            )}
          </header>

          <div className="px-5 pt-5">
            {support === "ios-needs-home-screen" && (
              <>
                <div className="rounded-[12px] border border-[var(--border)] bg-paper p-4">
                  <p className="text-[15px] font-semibold">Add to Home Screen first</p>
                  <ol className="mt-3 space-y-2.5">
                    {["Tap the Share button in Safari.", "Choose Add to Home Screen.", "Open Store from your Home Screen and come back here."].map((t, i) => (
                      <li key={t} className="flex text-[14px] leading-[20px] items-start gap-3">
                        <span className="num grid size-6 shrink-0 place-items-center rounded-full border border-[var(--border)] bg-[#fafafa] text-[13px] font-medium text-label" aria-hidden>
                          {i + 1}
                        </span>
                        <span className="pt-[2px]">{t}</span>
                      </li>
                    ))}
                  </ol>
                </div>
                <p className="t-footnote px-1 pt-2 text-muted">iPhone shows notifications only for apps on the Home Screen (iOS 16.4 or later).</p>
              </>
            )}

            {support === "unsupported" && (
              <div className="rounded-[12px] border border-[var(--border)] bg-paper p-4 text-[14px] text-muted">
                This browser can&apos;t show notifications. Try Chrome, Edge, Firefox or Safari.
              </div>
            )}

            {support === "supported" && (
              <>
                <div className="rounded-[12px] border border-[var(--border)] bg-paper">
                  <div className="flex min-h-[56px] items-center justify-between gap-3 px-4 py-2">
                    <span className="min-w-0">
                      <span className="block text-[15px] font-medium" id="notif-switch-label">Urgent alerts</span>
                      <span className="t-footnote block text-muted">Each alert is sent once.</span>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      aria-labelledby="notif-switch-label"
                      disabled={busy}
                      onClick={toggle}
                      className="grid h-[44px] w-[51px] shrink-0 place-items-center disabled:opacity-50"
                    >
                      <span
                        aria-hidden
                        className={`relative h-[31px] w-[51px] rounded-full transition-colors duration-200 ${on ? "bg-ink" : "bg-[#d4d4d8]"}`}
                      >
                        <span
                          className={`absolute top-[2px] size-[27px] rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_3px_1px_rgba(0,0,0,0.06)] transition-[left] duration-200 ease-[var(--ease-out)] motion-reduce:transition-none ${
                            on ? "left-[22px]" : "left-[2px]"
                          }`}
                        />
                      </span>
                    </button>
                  </div>
                </div>
                {denied && !on && (
                  <p className="t-footnote px-1 pt-2 text-muted">
                    Notifications are blocked for this site. Allow them in your browser or system settings, then try again.
                  </p>
                )}
                {on && (
                  <button
                    type="button"
                    onClick={test}
                    disabled={busy}
                    className="mt-5 inline-flex min-h-[48px] w-full items-center justify-center rounded-[10px] bg-ink text-[15px] font-medium text-white transition-colors hover:bg-[#27272a] disabled:opacity-40"
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
              <p role="alert" className="mt-4 rounded-[10px] border border-[#fecaca] bg-[var(--critical-bg)] px-3 py-2.5 text-[14px] font-medium text-red">
                {error}
              </p>
            )}
          </div>
        </motion.div>
      </div>
    </>
  );
}
