"use client";

/** Thin zinc progress bar for the summary header: how many of today's priorities have a decision. */
export function TagProgress({ done, total }: { done: number; total: number }) {
  const frac = total ? done / total : 0;
  return (
    <div className="flex items-center gap-3" role="img" aria-label={`${done} of ${total} handled`}>
      <div className="tag-bar flex-1" aria-hidden>
        <span style={{ width: `${frac * 100}%` }} />
      </div>
      <span aria-hidden className="num shrink-0 text-[13px] font-medium leading-[18px] text-muted">
        {done} of {total} done
      </span>
    </div>
  );
}

/** Small progress ring in ink (green when complete). */
export function Ring({ done, total, size = 56 }: { done: number; total: number; size?: number }) {
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = total ? done / total : 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${done} of ${total} handled`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--fill-2)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={frac === 1 ? "var(--green)" : "var(--ink)"}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          opacity={frac === 0 ? 0 : 1}
        />
      </svg>
      <span className="num absolute inset-0 grid place-items-center text-[14px] font-semibold" aria-hidden>
        {done}/{total}
      </span>
    </div>
  );
}
