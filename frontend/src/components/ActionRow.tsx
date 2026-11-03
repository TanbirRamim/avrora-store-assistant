"use client";

import { motion } from "motion/react";
import type { Action, Decision } from "@/lib/api";
import { money, TYPE_META } from "@/lib/format";
import { ArrowUpIcon, CheckIcon, ChevronIcon, TypeIcon } from "./icons";

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

/**
 * Reminders-style row. The circle approves in one tap and sits on the title's line;
 * the rest of the row opens the detail inspector.
 */
export function ActionRow({ action, decision, selected, onOpen, onToggle, movedUp }: Props) {
  const meta = TYPE_META[action.type];
  const done = Boolean(decision);
  return (
    <motion.li
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={{ type: "spring", stiffness: 500, damping: 42 }}
      className="cell flex items-start [--inset:52px]"
      style={{ background: selected ? "var(--selected)" : undefined }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-label={done ? `Undo decision for ${action.product_name}` : `Approve ${action.product_name}`}
        className="flex shrink-0 justify-center pl-4 pr-3 pt-[12px]"
      >
        <span
          className="grid size-[22px] place-items-center rounded-full border-[1.5px] transition-colors duration-200"
          style={{
            borderColor: done ? "var(--done)" : "#c7c7cc",
            background: done ? "var(--done)" : "transparent",
          }}
        >
          <motion.span
            initial={false}
            animate={{ scale: done ? 1 : 0.4, opacity: done ? 1 : 0 }}
            transition={{ type: "spring", stiffness: 700, damping: 28 }}
            className="text-white"
          >
            <CheckIcon size={13} />
          </motion.span>
        </span>
      </button>

      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2 py-[11px] pr-3 text-left transition-colors active:bg-fill"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className={`t-body truncate ${done ? "text-label-2" : ""}`}>{action.product_name}</span>
            <span className="t-body num shrink-0 text-label-2">{money(action.risk_uah)}</span>
          </span>
          <span className="t-footnote mt-[3px] flex items-center gap-1 font-medium" style={{ color: meta.text }}>
            <TypeIcon type={action.type} size={13} />
            {meta.label}
            {movedUp && (
              <span className="ml-1.5 inline-flex items-center gap-0.5 text-tint" data-testid="moved-up">
                <ArrowUpIcon size={11} />
                Moved up
              </span>
            )}
          </span>
          <span className="t-subhead mt-[2px] line-clamp-2 block text-label-2">
            {decision ? decisionLabel(decision) : action.reason}
          </span>
        </span>
        <ChevronIcon size={13} className="shrink-0 text-[#c4c4c7]" />
      </button>
    </motion.li>
  );
}
