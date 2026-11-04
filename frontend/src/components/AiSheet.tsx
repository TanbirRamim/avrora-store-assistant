"use client";

import { motion } from "motion/react";
import { SCRIM_FADE, SHEET_SPRING } from "@/lib/motion";
import { useEffect, useState } from "react";
import { forgetOwn, saveOwn, setLang, useAi, writeBriefing } from "@/lib/ai";
import type { Action } from "@/lib/api";
import { ModelError } from "@/lib/model";
import { CloseIcon } from "./icons";

interface Props {
  actions: Action[];
  notices: Action[];
  onClose: () => void;
}

const INPUT =
  "block min-h-[44px] w-full rounded-[10px] border border-[var(--border)] bg-paper px-3 text-[16px] outline-none transition-shadow placeholder:text-[var(--text-3)] focus:border-ink focus:shadow-[0_0_0_3px_rgba(24,24,27,0.12)] focus-visible:outline-none";

/** AI settings: store AI status, briefing language, and an optional own provider for this device. */
export function AiSheet({ actions, notices, onClose }: Props) {
  const { lang, own, serverModel, hasKey } = useAi();
  const [phone] = useState(() => !matchMedia("(min-width: 768px)").matches);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showOwn, setShowOwn] = useState(Boolean(own));
  const [baseUrl, setBaseUrl] = useState(own?.baseUrl ?? "");
  const [model, setModel] = useState(own?.model ?? "");
  const [key, setKey] = useState("");

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

  const saveOwnAndWrite = async (e: React.FormEvent) => {
    e.preventDefault();
    saveOwn({ baseUrl, model, key: key || own?.key || "" });
    setKey("");
    await write();
  };

  const status = own
    ? { on: true, text: `Using your own key · ${own.model}` }
    : serverModel
      ? { on: true, text: `Store AI connected · ${serverModel}` }
      : { on: false, text: "Not set up" };

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
              the store data. Without AI, fixed rules write the texts.
            </p>
            <span
              data-testid="ai-status"
              className="mt-3 inline-flex min-h-[22px] items-center gap-1.5 rounded-full px-2 text-[12px] font-medium"
              style={status.on ? { background: "var(--success-bg)", color: "var(--green)" } : { background: "var(--neutral-bg)", color: "#3f3f46" }}
            >
              <span className="size-1.5 shrink-0 rounded-full" style={{ background: status.on ? "var(--green)" : "#71717a" }} aria-hidden />
              {status.text}
            </span>
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

            <button
              type="button"
              onClick={() => void write()}
              disabled={busy || !hasKey}
              className="mt-5 inline-flex min-h-[48px] w-full items-center justify-center rounded-[10px] bg-ink text-[15px] font-medium text-white transition-colors hover:bg-[#27272a] disabled:opacity-40"
            >
              {busy ? "Writing, about 20 seconds…" : "Write briefing"}
            </button>

            <div className="mt-5 border-t border-[var(--divider)] pt-4">
              {!showOwn ? (
                <button
                  type="button"
                  onClick={() => setShowOwn(true)}
                  className="min-h-[44px] w-full text-left text-[15px] font-medium text-ink"
                >
                  Use my own key
                </button>
              ) : (
                <form onSubmit={saveOwnAndWrite} aria-label="Your own AI key">
                  <h3 className="text-[15px] font-semibold">Your own key</h3>
                  <p className="t-footnote pt-1 text-muted">
                    Any OpenAI-compatible service. Saved only in this browser and used instead of the store AI on
                    this device.
                  </p>
                  <label className="mt-3 block">
                    <span className="mb-1.5 block text-[14px] font-medium text-ink">Base URL</span>
                    <input type="url" required autoComplete="off" spellCheck={false} placeholder="https://…/v1"
                      value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className={INPUT} />
                  </label>
                  <label className="mt-3 block">
                    <span className="mb-1.5 block text-[14px] font-medium text-ink">Model</span>
                    <input required autoComplete="off" spellCheck={false} value={model}
                      onChange={(e) => setModel(e.target.value)} className={INPUT} />
                  </label>
                  <label className="mt-3 block">
                    <span className="mb-1.5 block text-[14px] font-medium text-ink">API key</span>
                    <input type="password" autoComplete="off" spellCheck={false}
                      placeholder={own?.key ? "Saved in this browser" : "Leave empty if not needed"}
                      value={key} onChange={(e) => setKey(e.target.value)} className={INPUT} />
                  </label>
                  <button
                    disabled={busy || !baseUrl.trim() || !model.trim()}
                    className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center rounded-[10px] border border-[var(--border)] bg-paper text-[15px] font-medium text-ink transition-colors hover:bg-[#fafafa] disabled:opacity-40"
                  >
                    Save and write briefing
                  </button>
                  {own && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        forgetOwn();
                        setBaseUrl("");
                        setModel("");
                        setKey("");
                        setShowOwn(false);
                      }}
                      className="mt-2 min-h-[44px] w-full text-[15px] font-medium"
                      style={{ color: "var(--red)" }}
                    >
                      Remove my key
                    </button>
                  )}
                </form>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </>
  );
}
