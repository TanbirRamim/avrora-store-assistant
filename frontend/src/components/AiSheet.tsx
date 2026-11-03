"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { forgetKey, setLang, useAi, writeBriefing } from "@/lib/ai";
import type { Action } from "@/lib/api";
import { ModelError } from "@/lib/ollama";
import { CloseIcon } from "./icons";

interface Props {
  hasKey: boolean;
  actions: Action[];
  notices: Action[];
  onClose: () => void;
}

/** Where the manager adds the Open WebUI key that lets the OTH model write the briefing. */
export function AiSheet({ hasKey, actions, notices, onClose }: Props) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { lang } = useAi();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await writeBriefing(actions, notices, key || undefined, lang);
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
        onClick={() => !busy && onClose()}
        className="fixed inset-0 z-40 bg-black/30"
      />
      <div className="pointer-events-none fixed inset-x-0 top-0 bottom-[var(--kb,0px)] z-50 flex items-end justify-center pt-[calc(env(safe-area-inset-top)+10px)] md:items-center md:p-6">
        <motion.form
          role="dialog"
          aria-modal="true"
          aria-labelledby="ai-title"
          onSubmit={submit}
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
            disabled={busy}
            aria-label="Close AI briefing"
            className="absolute right-2 top-2 grid size-[44px] place-items-center"
          >
            <span className="grid size-[32px] place-items-center rounded-full bg-fill text-ink hover:bg-fill-2">
              <CloseIcon />
            </span>
          </button>

          <header className="px-5 pr-14 pt-4 md:pt-6">
            <h2 id="ai-title" className="t-title2 font-display">AI briefing</h2>
            <p className="t-subhead mt-1.5 text-muted">
              Picks today&apos;s five priorities and explains them in plain words. Every number is checked against the
              store data.
            </p>
            <span className="t-subhead mt-3 flex items-center gap-2 font-medium">
              <span className="size-2 rounded-full" style={{ background: hasKey ? "var(--green)" : "var(--muted)" }} aria-hidden />
              {hasKey ? "Key saved in this browser" : "No key yet"}
            </span>
          </header>

          <div className="px-4 pt-6">
            <div className="rounded-[14px] bg-paper">
              <label className="block px-4 pb-1 pt-3">
                <span className="t-footnote font-semibold text-muted">Open WebUI key</span>
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Open WebUI key"
                  placeholder={hasKey ? "Saved in this browser" : "sk-…"}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  autoFocus
                  className="t-body block min-h-[40px] w-full bg-transparent outline-none placeholder:text-muted"
                />
              </label>
              <div className="mx-4 h-[0.5px] bg-separator" />
              <div className="flex min-h-[52px] items-center gap-3 px-4 py-2">
                <span className="t-body min-w-0 flex-1">Writes in</span>
                <div role="radiogroup" aria-label="Briefing language" className="flex gap-1.5">
                  {(["uk", "en"] as const).map((l) => (
                    <button
                      key={l}
                      type="button"
                      role="radio"
                      aria-checked={lang === l}
                      disabled={busy}
                      onClick={() => setLang(l)}
                      className={`min-h-[44px] whitespace-nowrap rounded-full px-4 text-[15px] font-medium transition-colors ${lang === l ? "bg-ink text-white" : "text-ink shadow-[inset_0_0_0_1.5px_var(--ink)]"}`}
                    >
                      {l === "uk" ? "Українська" : "English"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <p className="t-footnote px-4 pt-2 text-muted">
              In Open WebUI, open Settings, then Account, and copy your API key. It stays in this browser. AI works
              only on the OTH university network (on campus or through the university VPN).
            </p>

            {error && (
              <p role="alert" className="t-subhead mt-4 rounded-[14px] border-l-[4px] border-red bg-paper px-4 py-3 font-medium text-red">
                {error}
              </p>
            )}

            <button
              disabled={busy || (!key.trim() && !hasKey)}
              className="btn-ink mt-6 min-h-[52px] w-full disabled:opacity-40"
            >
              {busy ? "Writing, about 20 seconds…" : hasKey && !key ? "Write again" : "Save and write briefing"}
            </button>
            {hasKey && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  forgetKey();
                  onClose();
                }}
                className="t-body mt-2 min-h-[44px] w-full"
                style={{ color: "var(--red)" }}
              >
                Remove key and stop using AI
              </button>
            )}
          </div>
        </motion.form>
      </div>
    </>
  );
}
