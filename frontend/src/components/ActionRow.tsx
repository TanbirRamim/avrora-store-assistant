"use client";

import { motion } from "motion/react";
import type { Action, Decision } from "@/lib/api";
import { money, proposalText, TYPE_META } from "@/lib/format";
import { CheckIcon, ChevronIcon, TypeIcon } from "./icons";

interface Props {
  action: Action;
  decision?: Decision;
  selected: boolean;
  onOpen: () => void;
  onToggle: () => void;
}

const decisionLabel = (d: Decision) =>
  d.decision === "approve" ? "Approved" : d.decision === "change" ? `Approved with change (${d.value})` : `Dismissed: ${d.reason ?? "no reason"}`;

export function ActionRow({ action, decision, selected, onOpen, onToggle }: Props) {
  const meta = TYPE_META[action.type];
  const done = Boolean(decision);
  return (
    <motion.li
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={{ type: "spring", stiffness: 500, damping: 40 }}
      className="relative"
    >
      <div
        className={`group flex items-start gap-3 px-4 py-3 transition-colors ${
          selected ? "bg-fill" : "hover:bg-[color-mix(in_srgb,var(--fill)_50%,transparent)]"
        }`}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-label={done ? `Undo decision for ${action.product_name}` : `Approve: ${proposalText(action)}`}
          className="mt-0.5 grid size-[22px] shrink-0 place-items-center rounded-full border-[1.5px] transition-colors"
          style={{
            borderColor: done ? "var(--done)" : "var(--label-3)",
            background: done ? "var(--done)" : "transparent",
          }}
        >
          <motion.span
            initial={false}
            animate={{ scale: done ? 1 : 0, opacity: done ? 1 : 0 }}
            transition={{ type: "spring", stiffness: 700, damping: 30 }}
            className="text-white"
          >
            <CheckIcon size={13} />
          </motion.span>
        </button>

        <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-start gap-3 text-left">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[12px] font-medium" style={{ color: meta.color }}>
              <TypeIcon type={action.type} size={14} />
              {meta.label}
            </div>
            <div className={`mt-0.5 text-[15px] font-semibold ${done ? "text-label-2 line-through decoration-label-3" : "text-label"}`}>
              {action.product_name}
            </div>
            <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-label-2">
              {decision ? decisionLabel(decision) : action.reason}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2 pt-4">
            <div className="text-right">
              <div className="num text-[15px] font-semibold text-label">{money(action.risk_uah)}</div>
              <div className="text-[11px] text-label-3">at stake</div>
            </div>
            <ChevronIcon className="text-label-3" />
          </div>
        </button>
      </div>
      <div className="absolute bottom-0 left-[52px] right-0 h-px bg-separator group-last:hidden" />
    </motion.li>
  );
}
