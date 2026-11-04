"use client";

import { motion } from "motion/react";
import { SCRIM_FADE, SHEET_SPRING } from "@/lib/motion";
import { useEffect, useState } from "react";
import { setLang, useAi, writeBriefing } from "@/lib/ai";
import type { Action } from "@/lib/api";
import { ModelError } from "@/lib/model";
import { CloseIcon } from "./icons";

interface Props {
  actions: Action[];
  notices: Action[];
  onClose: () => void;
}

/** AI settings: whether the store AI is on, and the language it writes in. */
export function AiSheet({ actions, notices, onClose }: Props) {
  const { lang, hasKey } = useAi();
  const [phone] = useState(() => !matchMedia("(min-width: 768px)").matches);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const write = async () => {
    setBusy(true);
    setError(null);
    try {
      await writeBriefing(actions, notices, lang);
      onClose();
    } catch (err) {
      setError(err instanceof ModelError ? err.message : "The AI briefing couldn't be written. Try again.");
    } finally {
      setBusy(false);
    }
  };


  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={SCRIM_FADE}
        onClick={() => !busy && onClose()}
        className="fixed inset-0 z-40 bg-[var(--scrim)]"
      />
      <div className="pointer-events-none fixed inset-x-0 top-0 bottom-[var(--kb,0px)] z-50 flex items-end justify-center pt-[calc(env(safe-area-inset-top)+10px)] md:items-center md:p-6">
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="ai-title"
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
            disabled={busy}
            aria-label="Close AI settings"
            className="absolute right-2 top-2 grid size-[44px] place-items-center"
          >
            <span className="grid size-[32px] place-items-center rounded-full bg-[#f4f4f5] text-muted hover:bg-[#e4e4e7] hover:text-ink">
              <CloseIcon />
            </span>
          </button>

          <header className="px-5 pr-14 pt-4 md:pt-6">
            <h2 id="ai-title" className="text-[20px] font-semibold leading-[26px] tracking-[-0.02em]">AI settings</h2>
            <p className="mt-1.5 text-[14px] leading-[20px] text-muted">
              AI picks today&apos;s five priorities and explains them in plain words. Every number is checked against
              the store data.
            </p>
            {hasKey && (
              <span
                data-testid="ai-status"
                className="mt-3 inline-flex min-h-[22px] items-center gap-1.5 rounded-full px-2 text-[12px] font-medium"
                style={{ background: "var(--success-bg)", color: "var(--green)" }}
              >
                <span className="size-1.5 shrink-0 rounded-full" style={{ background: "var(--green)" }} aria-hidden />
                Written by the store&apos;s AI
              </span>
            )}
          </header>

          <div className="px-5 pt-5">
            <div className="flex min-h-[44px] items-center gap-3">
              <span className="min-w-0 flex-1 text-[14px] font-medium">Writes in</span>
              <div role="radiogroup" aria-label="Briefing language" className="flex rounded-[10px] bg-[#f4f4f5] p-[3px]">
                {(["uk", "en"] as const).map((l) => (
                  <button
                    key={l}
                    type="button"
                    role="radio"
                    aria-checked={lang === l}
                    disabled={busy}
                    onClick={() => setLang(l)}
                    className={`min-h-[38px] max-md:min-h-[44px] whitespace-nowrap rounded-[8px] px-3 text-[14px] font-medium transition-colors ${lang === l ? "bg-paper text-ink shadow-[0_1px_2px_rgba(16,24,40,0.08),0_1px_3px_rgba(16,24,40,0.06)]" : "text-muted hover:text-ink"}`}
                  >
                    {l === "uk" ? "Українська" : "English"}
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <p role="alert" className="mt-4 rounded-[10px] border border-[#fecaca] bg-[var(--critical-bg)] px-3 py-2.5 text-[14px] font-medium text-red">
                {error}
              </p>
            )}

            {hasKey && (
            <button
              type="button"
              onClick={() => void write()}
              disabled={busy}
              className="mt-5 inline-flex min-h-[48px] w-full items-center justify-center rounded-[10px] bg-ink text-[15px] font-medium text-white transition-colors hover:bg-[#27272a] disabled:opacity-40"
            >
              {busy ? "Writing, about 20 seconds…" : "Write briefing"}
            </button>
            )}

          </div>
        </motion.div>
      </div>
    </>
  );
}
