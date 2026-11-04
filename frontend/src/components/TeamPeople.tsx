"use client";

import { type Employee, hrs, nextShiftText, ROLE_LABEL, statusMeta, statusTone } from "@/lib/workforce";
import { Avatar } from "./EmployeeSheet";
import { ChevronIcon } from "./icons";
import { Badge, CARD, H2, ROW } from "./TeamSheet";

const ORDER = ["working", "available", "sick", "day_off", "vacation", "unavailable"];

/** Everyone on the staff with their status today, working first. White card with dividers. */
export function TeamPeople({ employees, today, onOpen }: { employees: Employee[] | null; today: string; onOpen: (id: string) => void }) {
  if (!employees) return <div className="mt-4 h-[480px] animate-pulse rounded-[12px] bg-[var(--neutral-bg)]" />;
  const sorted = [...employees].sort((a, b) => ORDER.indexOf(String(a.status_today)) - ORDER.indexOf(String(b.status_today)) || a.name.localeCompare(b.name));
  const counts = ORDER.map((s) => [s, employees.filter((e) => e.status_today === s).length] as const).filter(([, n]) => n > 0);

  return (
    <div className="mt-4">
      {/* today's headcount, as a plain line of figures */}
      <dl className={`flex ${CARD}`} aria-label="Status today">
        {counts.map(([s, n]) => (
          <div key={s} className="flex min-w-0 flex-1 flex-col border-l border-[var(--divider)] px-3 py-3 first:border-l-0 md:px-4">
            <dd className={`num text-[20px] font-semibold leading-7 ${s === "sick" ? "text-red" : ""}`}>{n}</dd>
            <dt className="order-first truncate text-[12px] leading-4 text-muted md:text-[13px]">{statusMeta(s).label}</dt>
          </div>
        ))}
      </dl>
      <section aria-labelledby="people-h" className="mt-6">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="people-h" className={H2}>
            Everyone
          </h2>
          <span className="num px-1 text-[13px] text-muted">{employees.length}</span>
        </div>
        <ul className={`overflow-hidden ${CARD}`} data-testid="people-list">
          {sorted.map((e) => {
            const s = statusMeta(String(e.status_today));
            return (
              <li key={e.employee_id} className={ROW}>
                <button onClick={() => onOpen(e.employee_id)} className="flex min-h-[68px] w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-[var(--surface-2)] active:bg-[var(--neutral-bg)]">
                  <Avatar id={e.employee_id} name={e.name} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[15px] font-semibold leading-5">{e.name}</span>
                      <Badge tone={statusTone(String(e.status_today))}>{s.label}</Badge>
                    </span>
                    <span className="block truncate text-[14px] leading-5 text-muted">
                      {ROLE_LABEL[e.role] ?? e.role}
                      {e.strength ? `, ${e.strength.toLowerCase()}` : ""}
                    </span>
                    <span className="num block truncate text-[13px] leading-[18px] text-muted">
                      {hrs(e.hours_this_week)} of {e.contract_hours_week} this week. Next: {nextShiftText(e.next_shift, today)}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="num block text-[15px] font-semibold leading-5">{e.score}</span>
                    <span className="block text-[12px] leading-4 text-muted">{e.trend === "up" ? "Rising" : e.trend === "down" ? "Falling" : "Steady"}</span>
                  </span>
                  <ChevronIcon className="shrink-0 text-[var(--text-3)]" />
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
