"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { forgetKey, setLang, useAi, writeBriefing } from "@/lib/ai";
import type { Action } from "@/lib/api";
import { ModelError } from "@/lib/ollama";
import { CloseIcon, SparkleIcon } from "./icons";

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
          className="pointer-events-auto max-h-full w-full max-w-[460px] overflow-y-auto overscroll-contain rounded-t-[12px] bg-bg pb-[max(env(safe-area-inset-bottom),16px)] md:rounded-[14px] md:pb-4 md:shadow-[0_24px_60px_rgba(0,0,0,0.25)]"
        >
          <header className="flex items-center gap-3 border-b border-separator px-4 py-3">
            <span className="icon-tile size-[30px]" style={{ background: "var(--move)" }}>
              <SparkleIcon size={17} />
            </span>
            <h2 id="ai-title" className="t-headline flex-1">AI briefing</h2>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              aria-label="Close AI briefing"
              className="hit grid size-[30px] place-items-center rounded-full bg-fill text-label-2 hover:bg-fill-2"
            >
              <CloseIcon />
            </button>
          </header>

          <div className="px-4 pt-4">
            <p className="t-subhead text-label-2">
              AI picks today&apos;s five priorities and explains them in plain words. Every number it writes is checked
              against the store data.
            </p>

            <h3 className="group-header mt-5">Open WebUI key</h3>
            <div className="group-list">
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                aria-label="Open WebUI key"
                placeholder={hasKey ? "Saved in this browser" : "sk-…"}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                autoFocus
                className="t-body w-full bg-transparent px-4 py-[11px] outline-none placeholder:text-label-3"
              />
            </div>
            <p className="group-footer">
              In Open WebUI, open Settings, then Account, and copy your API key. It is saved only in this browser.
              AI works only on the OTH university network (on campus or through the university VPN).
            </p>

            <h3 className="group-header mt-5">Language</h3>
            <div className="group-list">
              <div className="cell flex items-center gap-3 px-4 py-[9px]">
                <span className="t-body min-w-0 flex-1">Writes in</span>
                <div role="radiogroup" aria-label="Briefing language" className="flex rounded-[9px] bg-fill p-[2px]">
                  {(["uk", "en"] as const).map((l) => (
                    <button
                      key={l}
                      type="button"
                      role="radio"
                      aria-checked={lang === l}
                      disabled={busy}
                      onClick={() => setLang(l)}
                      className={`rounded-[7px] px-3 py-1 text-[13px] font-medium ${lang === l ? "bg-surface shadow-[0_1px_3px_rgba(0,0,0,0.12)]" : "text-label-2"}`}
                    >
                      {l === "uk" ? "Українська" : "English"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <p className="group-footer">AI writes in this language. Numbers are checked either way.</p>

            {error && (
              <p role="alert" className="t-subhead mt-4 px-1" style={{ color: "var(--order-text)" }}>
                {error}
              </p>
            )}

            <button
              disabled={busy || (!key.trim() && !hasKey)}
              className="mt-5 w-full rounded-[12px] bg-tint-fill py-3 text-[17px] font-semibold text-white active:opacity-80 disabled:opacity-40"
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
                className="t-body mt-2 w-full py-2.5"
                style={{ color: "var(--order-text)" }}
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
