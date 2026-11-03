import type { ReactNode } from "react";

interface Props {
  title: string;
  /** Small muted line above the title, e.g. the date. */
  date?: string;
  /** Text or icon button. Phones: its own row under the title. Wide screens: right of the title. */
  action?: ReactNode;
  /** Optional back link rendered above everything (e.g. "‹ More"). */
  back?: ReactNode;
  className?: string;
}

/**
 * Screen header ("Shop floor"): Avrora mark + title in Unbounded. The secondary action never
 * shares a row with the title on phones, so long titles never get squeezed.
 */
export function ScreenHeader({ title, date, action, back, className = "" }: Props) {
  return (
    <header className={`screen-header ${className}`}>
      {back}
      {date && <p className="t-subhead num text-muted">{date}</p>}
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between md:gap-6">
        <div className="flex min-w-0 items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element -- static export, SVG mark */}
          <img src="/avrora-mark.svg" alt="" width={24} height={24} className="size-6 shrink-0" />
          <h1 className="t-large-title min-w-0">{title}</h1>
        </div>
        {action && <div className="flex shrink-0 items-center gap-2 md:pb-1">{action}</div>}
      </div>
    </header>
  );
}
