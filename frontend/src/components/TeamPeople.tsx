"use client";

import { type Employee, hrs, nextShiftText, ROLE_LABEL, statusMeta } from "@/lib/workforce";
import { Avatar } from "./EmployeeSheet";
import { ChevronIcon } from "./icons";

const ORDER = ["working", "available", "sick", "day_off", "vacation", "unavailable"];

/** Everyone on the staff with their status today, working first. Flat paper list with hairlines. */
export function TeamPeople({ employees, today, onOpen }: { employees: Employee[] | null; today: string; onOpen: (id: string) => void }) {
  if (!employees) return <div className="mt-4 h-[480px] animate-pulse rounded-[14px] bg-fill" />;
  const sorted = [...employees].sort((a, b) => ORDER.indexOf(String(a.status_today)) - ORDER.indexOf(String(b.status_today)) || a.name.localeCompare(b.name));
  const counts = ORDER.map((s) => [s, employees.filter((e) => e.status_today === s).length] as const).filter(([, n]) => n > 0);

  return (
    <div className="mt-4">
      {/* today's headcount, as a plain line of figures */}
      <dl className="flex flex-wrap gap-x-6 gap-y-2 px-1" aria-label="Status today">
        {counts.map(([s, n]) => (
          <div key={s} className="flex flex-col">
            <dd className={`num text-[22px] font-semibold leading-7 ${s === "sick" ? "text-red" : ""}`}>{n}</dd>
            <dt className="order-first text-[13px] leading-[18px] text-muted">{statusMeta(s).label}</dt>
          </div>
        ))}
      </dl>
      <section aria-labelledby="people-h" className="mt-6">
        <div className="flex items-baseline justify-between gap-3 px-1 pb-2">
          <h2 id="people-h" className="text-[17px] font-semibold leading-[22px]">
            Everyone
          </h2>
          <span className="num text-[13px] text-muted">{employees.length}</span>
        </div>
        <ul className="rounded-[14px] bg-paper" data-testid="people-list">
          {sorted.map((e) => {
            const s = statusMeta(String(e.status_today));
            return (
              <li key={e.employee_id} className="border-t border-rule first:border-t-0">
                <button onClick={() => onOpen(e.employee_id)} className="flex min-h-[68px] w-full items-center gap-3 px-4 py-2.5 text-left active:bg-fill">
                  <Avatar id={e.employee_id} name={e.name} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="truncate text-[17px] font-semibold leading-[22px]">{e.name}</span>
                      <span className="inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold" style={{ color: e.status_today === "working" ? "var(--green)" : e.status_today === "sick" ? "var(--red)" : "var(--muted)" }}>
                        <span aria-hidden className="size-[7px] rounded-full" style={{ background: s.color }} />
                        {s.label}
                      </span>
                    </span>
                    <span className="block truncate text-[15px] leading-5 text-muted">
                      {ROLE_LABEL[e.role] ?? e.role}
                      {e.strength ? `, ${e.strength.toLowerCase()}` : ""}
                    </span>
                    <span className="num block truncate text-[13px] leading-[18px] text-muted">
                      {hrs(e.hours_this_week)} of {e.contract_hours_week} this week. Next: {nextShiftText(e.next_shift, today)}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="num block text-[17px] font-semibold leading-[22px]">{e.score}</span>
                    <span className="block text-[12px] leading-4 text-muted">{e.trend === "up" ? "Rising" : e.trend === "down" ? "Falling" : "Steady"}</span>
                  </span>
                  <ChevronIcon className="shrink-0 text-muted" />
                </button>
              </li>
            );
          })}
        </ul>
        <p className="px-1 pt-2 text-[13px] leading-[18px] text-muted">Score combines speed, errors, punctuality, rating and attendance over 4 weeks. Demo data.</p>
      </section>
    </div>
  );
}
