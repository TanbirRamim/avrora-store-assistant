"use client";

import { motion } from "motion/react";
import { useEffect, useRef } from "react";
import type { Action, Decision } from "@/lib/api";
import { money, TYPE_META } from "@/lib/format";
import { ArrowUpIcon, CheckIcon, ChevronIcon } from "./icons";

interface Props {
  action: Action;
  decision?: Decision;
  selected: boolean;
  onOpen: () => void;
  onToggle: () => void;
  /** Set after a re-plan moved this row higher. */
  movedUp?: boolean;
}

const decisionLabel = (d: Decision) =>
  d.decision === "approve"
    ? "Approved"
    : d.decision === "change"
      ? `Approved with change: ${d.value}`
      : `Dismissed · ${d.reason ?? "No reason"}`;

/** Type glyph: a small coloured square (Chase delivery is an ink outline). */
export function TypeGlyph({ type, dim }: { type: Action["type"]; dim?: boolean }) {
  return (
    <span
      aria-hidden
      className="type-glyph"
      data-outline={type === "CHECK_DELIVERY" ? "" : undefined}
      style={{ background: TYPE_META[type].color, opacity: dim ? 0.4 : 1 }}
    />
  );
}

/**
 * One decision on a flat paper list. The ink circle approves in one tap;
 * the rest of the row opens the detail panel.
 */
export function ActionRow({ action, decision, selected, onOpen, onToggle, movedUp }: Props) {
  const meta = TYPE_META[action.type];
  const done = Boolean(decision);
  const ref = useRef<HTMLLIElement>(null);
  // keyboard moves (j/k) and auto-advance keep the selected row on screen
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);
  return (
    <motion.li
      ref={ref}
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={{ type: "spring", stiffness: 500, damping: 42 }}
      className="cell flex scroll-my-24 items-stretch [--inset:52px]"
      style={{ background: selected ? "var(--selected)" : undefined }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-label={done ? `Undo decision for ${action.product_name}` : `Approve ${action.product_name}`}
        className="group flex w-[52px] shrink-0 justify-center pt-[13px]"
      >
        <span
          className="grid size-[26px] place-items-center rounded-full border-2 transition-[background-color,border-color,transform] duration-200 group-active:scale-90"
          style={{
            borderColor: done ? "var(--green)" : "var(--ink)",
            background: done ? "var(--green)" : "transparent",
          }}
        >
          <motion.span
            initial={false}
            animate={{ scale: done ? 1 : 0.4, opacity: done ? 1 : 0 }}
            transition={{ type: "spring", stiffness: 700, damping: 28 }}
            className="text-white"
          >
            <CheckIcon size={14} />
          </motion.span>
        </span>
      </button>

      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-start gap-2 py-3 pr-3 text-left transition-colors hover:bg-[rgba(0,0,0,0.02)] active:bg-fill md:pr-4"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className={`t-headline line-clamp-2 min-w-0 ${done ? "text-muted" : ""}`}>{action.product_name}</span>
            <span className={`num shrink-0 text-[17px] font-semibold leading-[22px] ${done ? "text-muted" : ""}`}>{money(action.risk_uah)}</span>
          </span>
          <span className="t-footnote mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-medium text-muted">
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <TypeGlyph type={action.type} dim={done} />
              <span style={{ color: done ? undefined : meta.text }}>{meta.label}</span>
            </span>
            {movedUp && (
              <span
                className="inline-flex items-center gap-0.5 whitespace-nowrap rounded-[6px] bg-yellow px-1.5 font-semibold text-ink"
                data-testid="moved-up"
              >
                <ArrowUpIcon size={11} />
                Moved up
              </span>
            )}
          </span>
          <span
            className={`t-subhead mt-1 line-clamp-2 block ${decision && decision.decision !== "reject" ? "font-medium text-green" : "text-muted"}`}
          >
            {decision ? decisionLabel(decision) : action.reason}
          </span>
        </span>
        <ChevronIcon size={13} className="mt-[5px] shrink-0 text-[var(--label-3)]" />
      </button>
    </motion.li>
  );
}
