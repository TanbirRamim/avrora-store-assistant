"use client";

import { type Employee, nextShiftText, ROLE_LABEL, statusMeta, statusTone } from "@/lib/workforce";
import { Avatar } from "./EmployeeSheet";
import { Badge, CARD, H2 } from "./TeamSheet";

/** Today's shift time if there is one, otherwise the next one. */
function todayShift(e: Employee, today: string) {
  const n = e.next_shift;
  if (n && typeof n !== "string" && n.date === today) return { today: true, text: `${n.start}–${n.end}` };
  return { today: false, text: n ? `Next: ${nextShiftText(n, today)}` : "No shift planned" };
}

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
        <ul className="mt-2 grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3" data-testid="people-list">
          {sorted.map((e) => {
            const s = statusMeta(String(e.status_today));
            const shift = todayShift(e, today);
            return (
              <li key={e.employee_id} className="flex">
                <button
                  onClick={() => onOpen(e.employee_id)}
                  className="flex w-full flex-col items-start rounded-[12px] border border-[var(--border)] bg-paper p-3 text-left shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-[border-color,box-shadow,transform] duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)] hover:border-[#d4d4d8] hover:shadow-[0_4px_12px_rgba(16,24,40,0.06)] active:scale-[0.985] motion-reduce:active:scale-100 md:p-4"
                >
                  <span className="flex w-full items-start justify-between gap-2">
                    <Avatar id={e.employee_id} name={e.name} size={44} />
                    <span className="num text-right text-[13px] leading-[18px] text-muted">
                      <span className="block text-[15px] font-semibold leading-5 text-ink">{e.score}</span>
                      score
                    </span>
                  </span>
                  <span className="mt-3 block text-[15px] font-semibold leading-5 [overflow-wrap:anywhere]">{e.name}</span>
                  <span className="mt-0.5 block text-[13px] leading-[18px] text-muted">{ROLE_LABEL[e.role] ?? e.role}</span>
                  <span className="mt-auto block w-full pt-3">
                    <span className={`num block text-[14px] font-medium leading-5 ${shift.today ? "text-ink" : "text-muted"}`}>{shift.text}</span>
                    <span className="mt-1.5 block">
                      <Badge tone={statusTone(String(e.status_today))}>{s.label}</Badge>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="px-1 pt-2 text-[13px] leading-[18px] text-muted">Score combines speed, errors, punctuality, rating and attendance over 4 weeks.</p>
      </section>
    </div>
  );
}
