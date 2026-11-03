"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { forgetKey, writeBriefing } from "@/lib/ai";
import type { Action } from "@/lib/api";
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
      await writeBriefing(actions, notices, key || undefined);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The AI briefing could not be written.");
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
      <div className="pointer-events-none fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6">
        <motion.form
          role="dialog"
          aria-modal="true"
          aria-labelledby="ai-title"
          onSubmit={submit}
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 40, opacity: 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 38 }}
          className="pointer-events-auto w-full max-w-[460px] rounded-t-[12px] bg-bg pb-[max(env(safe-area-inset-bottom),16px)] md:rounded-[14px] md:pb-4 md:shadow-[0_24px_60px_rgba(0,0,0,0.25)]"
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
              className="grid size-[30px] place-items-center rounded-full bg-fill text-label-2 hover:bg-fill-2"
            >
              <CloseIcon />
            </button>
          </header>

          <div className="px-4 pt-4">
            <p className="t-subhead text-label-2">
              The OTH model picks today&apos;s five priorities and explains them in plain words. Every number it writes
              is checked against the store data.
            </p>

            <h3 className="group-header mt-5">Open WebUI API key</h3>
            <div className="group-list">
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                aria-label="Open WebUI API key"
                placeholder={hasKey ? "Saved in this browser" : "sk-…"}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                autoFocus
                className="t-body w-full bg-transparent px-4 py-[11px] outline-none placeholder:text-label-3"
              />
            </div>
            <p className="group-footer">
              Create one in Open WebUI under Settings, Account, API keys. It stays in this browser and goes only to the
              OTH server, which answers on the university network or VPN.
            </p>

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
                Remove key and use rules
              </button>
            )}
          </div>
        </motion.form>
      </div>
    </>
  );
}
