"use client";

import { motion } from "motion/react";

/** Progress ring for today's priorities: how many have a decision. */
export function Ring({ done, total, size = 56 }: { done: number; total: number; size?: number }) {
  const stroke = 7;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = total ? done / total : 0;
  return (
    <div className="relative" style={{ width: size, height: size }} role="img" aria-label={`${done} of ${total} handled`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--fill)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={frac === 1 ? "var(--done)" : "var(--tint)"}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={false}
          animate={{ strokeDashoffset: c * (1 - frac) }}
          transition={{ type: "spring", stiffness: 120, damping: 20 }}
        />
      </svg>
      <span className="num absolute inset-0 grid place-items-center text-[14px] font-semibold">
        {done}/{total}
      </span>
    </div>
  );
}
