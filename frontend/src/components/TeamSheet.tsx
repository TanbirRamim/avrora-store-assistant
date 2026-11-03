"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect } from "react";
import { CloseIcon } from "./icons";

/** A paper sheet: rises from the bottom on phones, centred on wide screens. Footer sits above the home indicator. */
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

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 z-40 bg-black/40" />
      <div className="pointer-events-none fixed inset-x-0 top-0 bottom-[var(--kb,0px)] z-50 flex items-end justify-center pt-[calc(env(safe-area-inset-top)+10px)] md:items-center md:p-6">
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelId}
          initial={still ? { opacity: 0 } : { y: 48 }}
          animate={still ? { opacity: 1 } : { y: 0 }}
          exit={still ? { opacity: 0 } : { y: 48, opacity: 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 40 }}
          className={`float pointer-events-auto relative flex max-h-full w-full ${wide ? "md:max-w-[600px]" : "md:max-w-[500px]"} flex-col overflow-hidden rounded-t-[14px] bg-paper md:max-h-[88vh] md:rounded-[14px]`}
        >
          <div className="flex justify-center pt-2 md:hidden" aria-hidden>
            <span className="h-[4px] w-9 rounded-full bg-rule" />
          </div>
          <div className="flex items-center justify-between gap-3 border-b border-rule px-4 pb-2 pt-1 md:px-6 md:pt-4">
            <h2 id={labelId} className="t-headline min-w-0 truncate">
              {title}
            </h2>
            <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 grid size-[44px] shrink-0 place-items-center rounded-full text-ink active:bg-fill">
              <CloseIcon size={16} />
            </button>
          </div>
          <div
            tabIndex={0}
            className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-4 focus-visible:outline-offset-[-3px] md:px-6 ${footer ? "pb-4" : "pb-[max(env(safe-area-inset-bottom),20px)]"}`}
          >
            {children}
          </div>
          {footer && <div className="border-t border-rule bg-paper px-4 pt-3 pb-[max(env(safe-area-inset-bottom),14px)] md:px-6 md:pb-5">{footer}</div>}
        </motion.div>
      </div>
    </>
  );
}

/** Sheet buttons: the shared ink / ghost pills, stretched to share a row. */
export const primaryBtn = "btn-ink flex-1 disabled:opacity-40";
export const secondaryBtn = "btn-ghost flex-1 disabled:opacity-40";

/** A sheet section title: sentence case, ink, a hairline under it. */
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
