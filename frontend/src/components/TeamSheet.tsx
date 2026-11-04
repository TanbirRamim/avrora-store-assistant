"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "./icons";

const noop = () => () => {};
/** False during the server render, true once in the browser. */
export const useMounted = () => useSyncExternalStore(noop, () => true, () => false);

/** Renders children into <body>: fixed layers then can't be trapped by an animated (transformed) ancestor. */
export function BodyPortal({ children }: { children: React.ReactNode }) {
  return useMounted() ? createPortal(children, document.body) : null;
}

/** A white sheet: rises from the bottom on phones, centred on wide screens. Footer sits above the home indicator. */
export function TeamSheet({
  title,
  labelId,
  onClose,
  children,
  footer,
  wide = false,
}: {
  title: string;
  labelId: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  const still = useReducedMotion();
  const mounted = useMounted();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  if (!mounted) return null;
  // into <body>, so an animated ancestor can't become the fixed layers' containing block
  return createPortal(
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 z-40 bg-zinc-950/40" />
      <div className="pointer-events-none fixed inset-x-0 top-0 bottom-[var(--kb,0px)] z-50 flex items-end justify-center pt-[calc(env(safe-area-inset-top)+10px)] md:items-center md:p-6">
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelId}
          initial={still ? { opacity: 0 } : { y: 48 }}
          animate={still ? { opacity: 1 } : { y: 0 }}
          exit={still ? { opacity: 0 } : { y: 48, opacity: 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 40 }}
          className={`float pointer-events-auto relative flex max-h-full w-full ${wide ? "md:max-w-[600px]" : "md:max-w-[500px]"} flex-col overflow-hidden rounded-t-[16px] border border-[var(--border)] bg-paper md:max-h-[88vh] md:rounded-[12px]`}
        >
          <div className="flex justify-center pt-2 md:hidden" aria-hidden>
            <span className="h-[4px] w-9 rounded-full bg-[var(--border)]" />
          </div>
          <div className="flex items-center justify-between gap-3 border-b border-[var(--divider)] px-4 pb-2 pt-1 md:px-6 md:pt-4">
            <h2 id={labelId} className="t-headline min-w-0 truncate">
              {title}
            </h2>
            <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 grid size-[44px] shrink-0 place-items-center rounded-[10px] text-[var(--text-3)] hover:bg-[var(--neutral-bg)] hover:text-ink active:bg-[var(--neutral-bg)]">
              <CloseIcon size={16} />
            </button>
          </div>
          <div
            tabIndex={0}
            className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-4 focus-visible:outline-offset-[-3px] md:px-6 ${footer ? "pb-4" : "pb-[max(env(safe-area-inset-bottom),20px)]"}`}
          >
            {children}
          </div>
          {footer && <div className="border-t border-[var(--divider)] bg-paper px-4 pt-3 pb-[max(env(safe-area-inset-bottom),14px)] md:px-6 md:pb-5">{footer}</div>}
        </motion.div>
      </div>
    </>,
    document.body,
  );
}

/** Sheet buttons: the shared primary / secondary buttons, stretched to share a row. */
export const primaryBtn = "btn-ink flex-1 disabled:opacity-40";
export const secondaryBtn = "btn-ghost flex-1 disabled:opacity-40";

/** v2 card: white, 1 px border, radius 12, hairline shadow. Lists inside use dividers. */
export const CARD = "rounded-[12px] border border-[var(--border)] bg-paper shadow-[0_1px_2px_rgba(16,24,40,0.04)]";
/** Divider between rows inside a card. */
export const ROW = "border-t border-[var(--divider)] first:border-t-0";
/** Section title above a card. */
export const H2 = "px-1 pb-2 text-[15px] font-semibold leading-5 tracking-[-0.01em]";

type Tone = "success" | "critical" | "warning" | "neutral";

/** Polaris-style badge (shared `.badge` classes): 22 px pill, tinted background, 6 px dot. */
export function Badge({ tone = "neutral", children, dot = true, testId, className = "" }: { tone?: Tone; children: React.ReactNode; dot?: boolean; testId?: string; className?: string }) {
  return (
    <span data-testid={testId} data-nodot={dot ? undefined : ""} className={`badge badge-${tone} ${className}`}>
      {children}
    </span>
  );
}

/** A sheet section title. */
export function SheetHead({ id, children, trailing }: { id?: string; children: React.ReactNode; trailing?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 pb-2">
      <h3 id={id} className="text-[15px] font-semibold leading-5">
        {children}
      </h3>
      {trailing}
    </div>
  );
}
