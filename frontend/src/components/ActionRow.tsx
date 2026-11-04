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

/** Type glyph: a small neutral square (Chase delivery is an outline). */
export function TypeGlyph({ type, dim }: { type: Action["type"]; dim?: boolean }) {
  return (
    <span
      aria-hidden
      className="type-glyph"
      data-outline={type === "CHECK_DELIVERY" ? "" : undefined}
      style={{ background: type === "ORDER" ? "var(--red)" : "#a1a1aa", opacity: dim ? 0.4 : 1 }}
    />
  );
}

const BADGE: Record<Action["type"], string> = {
  ORDER: "badge-critical",
  DISCOUNT: "badge-warning",
  MOVE_TO_FRONT: "badge-neutral",
  CHECK_DELIVERY: "badge-warning",
  EXPLAIN_ANOMALY: "badge-neutral",
};

/** Action type as a Polaris-style status badge. */
export function TypeBadge({ type, dim }: { type: Action["type"]; dim?: boolean }) {
  return <span className={`badge ${dim ? "badge-neutral" : BADGE[type]}`}>{TYPE_META[type].label}</span>;
}

/**
 * One decision on a flat paper list. The zinc circle approves in one tap;
 * the rest of the row opens the detail panel.
 */
export function ActionRow({ action, decision, selected, onOpen, onToggle, movedUp }: Props) {
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
      exit={{ opacity: 0, transition: { duration: 0.2, ease: [0.4, 0, 0.2, 1] } }}
      transition={{ type: "spring", stiffness: 500, damping: 42 }}
      className="cell flex scroll-my-24 items-stretch [--inset:52px]"
      style={{ background: selected ? "var(--selected)" : undefined }}
    >
      {/* the row opens first in reading order; the approve circle sits visually at the start */}
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-start gap-2 py-3 pr-3 text-left transition-colors hover:bg-[rgba(0,0,0,0.02)] active:bg-fill md:pr-4"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className={`t-headline line-clamp-2 min-w-0 ${done ? "text-muted" : ""}`}>{action.product_name}</span>
            <span className={`num shrink-0 whitespace-nowrap text-[17px] font-semibold leading-[22px] ${done ? "text-muted" : ""}`}>{money(action.risk_uah)}</span>
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <TypeBadge type={action.type} dim={done} />
            {movedUp && (
              <span
                className="badge badge-neutral"
                data-nodot=""
                data-testid="moved-up"
              >
                <ArrowUpIcon size={11} />
                Moved up
              </span>
            )}
          </span>
          <span
            className={`t-subhead mt-1.5 line-clamp-2 block ${decision && decision.decision !== "reject" ? "font-medium text-green" : "text-muted"}`}
          >
            {decision ? decisionLabel(decision) : action.reason}
          </span>
        </span>
        <ChevronIcon size={13} className="mt-[5px] shrink-0 text-[var(--label-3)]" />
      </button>
      <button
        type="button"
        onClick={onToggle}
        aria-label={done ? `Undo decision for ${action.product_name}` : `Approve ${action.product_name}`}
        className="group order-first flex w-[52px] shrink-0 justify-center pt-[12px]"
      >
        <span
          className="grid size-[24px] place-items-center rounded-full border-[1.5px] transition-[background-color,border-color,transform] duration-200 group-hover:border-[#71717a] group-active:scale-90"
          style={{
            borderColor: done ? "var(--green)" : "#a1a1aa",
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

    </motion.li>
  );
}
