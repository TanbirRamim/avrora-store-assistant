"use client";

import { Fragment, useState } from "react";
import { type HourRow, type Plan, priorityLabel, priorityRank, ROLE_LABEL, type Shift, type TaskSlot, taskMeta, TASK_ORDER, toMin } from "@/lib/workforce";
import { Avatar } from "./EmployeeSheet";

/*
 * The rota board: the Team screen's main visual (docs/design-system.md, "Rota board").
 *
 * Phone choice: the 13 open hours are compressed to fit the screen (about 22 px an hour at 375)
 * rather than scrolling sideways. A manager reads the whole day in one glance, which a sideways
 * scroller hides; names sit on their own line above each bar so they are never truncated, and the
 * narrow left gutter carries the paid hours. From 768 px the name moves into a left column.
 */

const GRID = "grid grid-cols-[48px_minmax(0,1fr)] md:grid-cols-[320px_minmax(0,1fr)]";
const HATCH = "repeating-linear-gradient(135deg, rgba(217,20,14,0.22) 0 2px, transparent 2px 6px)";
const RULES = (n: number) => ({
  backgroundImage: "linear-gradient(to right, var(--rule) 1px, transparent 1px)",
  backgroundSize: `calc(100% / ${n}) 100%`,
});

const hh = (t: string) => t.slice(0, 2);
const nextHour = (t: string) => `${String(Number(hh(t)) + 1).padStart(2, "0")}:00`;
export const stationOf = (t: { task: string; station?: string }) => t.station ?? taskMeta(String(t.task)).label;
const fromMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const hrsText = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} h`;

export function RotaBoard({ plan, mode, onPerson }: { plan: Plan; mode: "person" | "station"; onPerson: (id: string) => void }) {
  const hours = plan.hours;
  const n = hours.length || 13;
  const open = plan.opening.open;
  const a = toMin(open);
  const total = n * 60;
  const pct = (t: string) => `${Math.max(0, Math.min(100, ((toMin(t) - a) / total) * 100))}%`;
  const firstShort = hours.findIndex((h) => h.scheduled < h.required);
  const [sel, setSel] = useState<number | null>(null);
  const [stationHour, setStationHour] = useState<number>(() => {
    const noon = hours.findIndex((h) => h.hour === "12:00");
    return firstShort >= 0 ? firstShort : Math.max(0, noon);
  });
  const shifts = [...plan.shifts].sort((x, y) => toMin(x.start) - toMin(y.start) || toMin(x.end) - toMin(y.end));
  const pickHour = (i: number) => {
    setSel(sel === i ? null : i);
    setStationHour(i);
  };
  const active = mode === "station" ? stationHour : sel;

  return (
    <div className="rounded-[14px] bg-paper px-3 pt-3 pb-1 md:px-5 md:pt-4" data-testid="rota-board">
      {/* hour axis */}
      <div className={GRID} aria-hidden>
        <span />
        <div className="relative h-[18px]">
          {hours.map((h, i) => (
            <span
              key={h.hour}
              className={`font-display num absolute bottom-0 -translate-x-1/2 text-[11px] leading-none text-muted ${i % 2 ? "hidden md:block" : ""} ${i === 0 ? "translate-x-0" : ""}`}
              style={{ left: `${(i / n) * 100}%` }}
            >
              {hh(h.hour)}
            </span>
          ))}
          <span className="font-display num absolute bottom-0 right-0 hidden text-[11px] leading-none text-muted md:block">{hh(plan.opening.close)}</span>
        </div>
      </div>

      {/* need vs on shift, one tappable column per hour */}
      <div className={`${GRID} mt-1.5`}>
        <div className="flex flex-col justify-center gap-[3px] pr-2 text-[12px] leading-[16px] text-muted md:text-[13px]">
          <span>Need</span>
          <span className="font-semibold text-ink">
            On<span className="hidden md:inline"> shift</span>
          </span>
        </div>
        <div className="flex border-y border-rule" role="group" aria-label="Need and on shift per hour">
          {hours.map((h, i) => {
            const short = h.scheduled < h.required;
            const on = active === i;
            return (
              <button
                key={h.hour}
                type="button"
                aria-label={`${h.hour}: need ${h.required}, on shift ${h.scheduled}${short ? `, ${h.required - h.scheduled} short` : ""}`}
                aria-pressed={on}
                onClick={() => pickHour(i)}
                className={`num relative flex min-h-[44px] min-w-0 flex-1 flex-col items-center justify-center gap-[3px] border-l border-rule text-[12px] leading-[16px] first:border-l-0 md:text-[13px] ${on ? "outline outline-2 -outline-offset-2 outline-ink" : ""}`}
                style={short ? { backgroundImage: HATCH, boxShadow: "inset 0 2px 0 var(--red)" } : undefined}
              >
                <span className="text-muted">{h.required}</span>
                <span className={`font-semibold ${short ? "text-red" : "text-ink"}`}>{h.scheduled}</span>
              </button>
            );
          })}
        </div>
      </div>
      <HourReadout row={active !== null ? hours[active] : null} hours={hours} />

      {mode === "person" ? (
        <PersonRows shifts={shifts} n={n} pct={pct} onPerson={onPerson} />
      ) : (
        <StationRows shifts={shifts} hours={hours} at={stationHour} onPerson={onPerson} />
      )}
    </div>
  );
}

function HourReadout({ row, hours }: { row: HourRow | null; hours: HourRow[] }) {
  const short = hours.filter((h) => h.scheduled < h.required).length;
  return (
    <p className={`${GRID} min-h-[40px] items-center py-2`} aria-live="polite">
      <span />
      {row ? (
        <span className="t-subhead num" data-testid="chart-readout">
          <span className="font-semibold">
            {row.hour}–{nextHour(row.hour)}
          </span>{" "}
          <span className="text-muted">
            need {row.required}, on shift {row.scheduled}
            {row.scheduled < row.required && <span className="font-semibold text-red">, {row.required - row.scheduled} short</span>}, {row.customers} customers
          </span>
        </span>
      ) : (
        <span className="t-subhead text-muted">
          {short ? (
            <>
              <span className="font-semibold text-red">
                {short} {short === 1 ? "hour" : "hours"} short
              </span>{" "}
              (hatched). Tap an hour for its numbers.
            </>
          ) : (
            "Every hour is covered. Tap an hour for its numbers."
          )}
        </span>
      )}
    </p>
  );
}

function PersonRows({ shifts, n, pct, onPerson }: { shifts: Shift[]; n: number; pct: (t: string) => string; onPerson: (id: string) => void }) {
  const [picked, setPicked] = useState<{ id: string; i: number } | null>(null);
  return (
    <ul data-testid="roster">
      {shifts.map((s) => {
        const sel = picked?.id === s.employee_id ? s.tasks[picked.i] : null;
        return (
          <li key={s.employee_id} className="border-t border-rule py-2 md:py-1.5">
            <div className={`${GRID} items-center gap-y-1`}>
              <button
                type="button"
                onClick={() => onPerson(s.employee_id)}
                aria-label={`${s.name}, ${ROLE_LABEL[s.role] ?? s.role}, ${s.start} to ${s.end}`}
                className="col-span-2 -mx-1 flex min-h-[44px] min-w-0 items-center gap-2.5 rounded-[10px] px-1 text-left active:bg-fill md:col-span-1 md:mr-3"
              >
                <Avatar id={s.employee_id} name={s.name} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold leading-5">{s.name}</span>
                  <span className="block truncate text-[13px] leading-[18px] text-muted">{ROLE_LABEL[s.role] ?? s.role}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="num block text-[15px] leading-5">
                    {s.start}–{s.end}
                  </span>
                  {s.strength && <span className="block text-[13px] leading-[18px] text-muted">{s.strength}</span>}
                </span>
              </button>
              <span className="num text-[12px] leading-4 text-muted md:hidden">{hrsText(s.hours)}</span>
              <ShiftBar shift={s} n={n} pct={pct} picked={picked?.id === s.employee_id ? picked.i : null} onPick={(i) => setPicked(picked?.id === s.employee_id && picked.i === i ? null : { id: s.employee_id, i })} />
            </div>
            {sel && <TaskReason slot={sel} />}
          </li>
        );
      })}
    </ul>
  );
}

function ShiftBar({ shift: s, n, pct, picked, onPick }: { shift: Shift; n: number; pct: (t: string) => string; picked: number | null; onPick: (i: number) => void }) {
  const breakEnd = s.break_at ? fromMin(toMin(s.break_at) + 30) : null;
  return (
    <div className="relative h-[28px]" style={RULES(n)}>
      {/* the shift itself: ink outline, so time without a task still reads as on shift */}
      <span aria-hidden className="absolute inset-y-[3px] rounded-[4px] border border-ink bg-paper" style={{ left: pct(s.start), width: `calc(${pct(s.end)} - ${pct(s.start)})` }} />
      {s.tasks.map((t, i) => {
        const m = taskMeta(String(t.task));
        const on = picked === i;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onPick(i)}
            aria-pressed={on}
            aria-label={`${m.label} ${t.from} to ${t.to}`}
            className="absolute inset-y-[3px] flex items-center justify-start overflow-hidden rounded-[4px] border-x border-paper pl-[6px] text-[11px] font-bold leading-none after:absolute after:inset-x-0 after:-inset-y-[9px] after:content-['']"
            style={{
              left: pct(t.from),
              width: `calc(${pct(t.to)} - ${pct(t.from)})`,
              background: m.color,
              color: m.fg,
              boxShadow: on ? "0 0 0 2px var(--paper), 0 0 0 4px var(--ink)" : m.outline ? "inset 0 0 0 1.5px var(--ink)" : undefined,
              zIndex: on ? 2 : 1,
            }}
          >
            <span aria-hidden>{m.code}</span>
          </button>
        );
      })}
      {s.break_at && breakEnd && (
        <span aria-hidden className="pointer-events-none absolute inset-y-0 z-[3] flex justify-center bg-paper" style={{ left: pct(s.break_at), width: `calc(${pct(breakEnd)} - ${pct(s.break_at)})` }}>
          <span className="mt-[3px] h-0 w-0 border-x-[4px] border-t-[5px] border-x-transparent border-t-ink" />
        </span>
      )}
    </div>
  );
}

function TaskReason({ slot }: { slot: TaskSlot }) {
  const m = taskMeta(String(slot.task));
  return (
    <div className={`${GRID} pb-1 pt-2`}>
      <span />
      <div className="border-l-2 border-ink pl-3" data-testid="task-reason">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-[15px] font-semibold leading-5">{stationOf(slot)}</span>
          <span className="num text-[13px] text-muted">
            {slot.from}–{slot.to}
          </span>
        </p>
        <p className="text-[13px] leading-[18px] text-muted">
          {m.label}
          {priorityLabel(slot.priority) ? `, ${String(priorityLabel(slot.priority)).toLowerCase()} priority` : ""}
          {typeof slot.match === "number" ? `, ${slot.match}% match` : ""}
        </p>
        <p className="t-subhead mt-1">{slot.reason}</p>
      </div>
    </div>
  );
}

type StationRow = { name: string; task: string; priority: number; slots: { shift: Shift; slot: TaskSlot }[] };

function StationRows({ shifts, hours, at, onPerson }: { shifts: Shift[]; hours: HourRow[]; at: number; onPerson: (id: string) => void }) {
  const map = new Map<string, StationRow>();
  for (const s of shifts)
    for (const t of s.tasks) {
      const k = stationOf(t);
      const row = map.get(k) ?? { name: k, task: String(t.task), priority: 9, slots: [] };
      row.priority = Math.min(row.priority, priorityRank(t.priority));
      row.slots.push({ shift: s, slot: t });
      map.set(k, row);
    }
  const rows = [...map.values()].sort((x, y) => x.priority - y.priority || TASK_ORDER.indexOf(x.task) - TASK_ORDER.indexOf(y.task) || x.name.localeCompare(y.name));
  const during = (r: StationRow, hour: string) => {
    const m0 = toMin(hour);
    return r.slots.filter((x) => toMin(x.slot.from) < m0 + 60 && toMin(x.slot.to) > m0);
  };
  const hour = hours[at]?.hour ?? "12:00";

  return (
    <div data-testid="stations">
      <ul>
        {rows.map((r) => {
          const m = taskMeta(r.task);
          return (
            <li key={r.name} className={`${GRID} items-center gap-y-1 border-t border-rule py-2`} data-testid="station-row">
              <div className="col-span-2 flex min-h-[32px] min-w-0 items-center gap-2.5 md:col-span-1 md:pr-3">
                <span aria-hidden className="grid size-[22px] shrink-0 place-items-center rounded-[4px] text-[11px] font-bold" style={{ background: m.color, color: m.fg, boxShadow: m.outline ? "inset 0 0 0 1.5px var(--ink)" : undefined }}>
                  {m.code}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold leading-5">{r.name}</span>
                  {r.priority < 9 && <span className="block text-[13px] leading-[18px] text-muted">{priorityLabel(r.priority)}</span>}
                </span>
              </div>
              <span className="text-[12px] text-muted md:hidden" aria-hidden />
              <div className="flex h-[28px] items-stretch" role="img" aria-label={`${r.name}: ${hours.map((h) => `${h.hour} ${during(r, h.hour).length}`).join(", ")}`}>
                {hours.map((h, i) => {
                  const c = during(r, h.hour).length;
                  const gap = c === 0 && r.priority === 1 && h.scheduled < h.required;
                  return (
                    <span
                      key={h.hour}
                      className={`num grid min-w-0 flex-1 place-items-center border-l border-paper text-[12px] font-semibold first:border-l-0 ${i === at ? "outline outline-2 -outline-offset-2 outline-ink" : ""}`}
                      style={c ? { background: "var(--ink)", color: "#fff" } : gap ? { backgroundImage: HATCH, color: "var(--red)" } : { background: "var(--floor)", color: "var(--muted)" }}
                    >
                      {c || (gap ? "0" : "")}
                    </span>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-rule pb-3 pt-3">
        <h3 className="t-subhead font-semibold">
          At <span className="num">{hour}</span>
        </h3>
        <p className="text-[13px] leading-[18px] text-muted">Pick an hour in the strip above. Numbers in the cells are people at that station.</p>
        <dl className="mt-2 grid gap-x-6 md:grid-cols-2">
          {rows.map((r) => {
            const here = during(r, hour);
            return (
              <Fragment key={r.name}>
                <div className="flex min-h-[44px] items-start gap-3 border-t border-rule py-2">
                  <dt className="w-[46%] shrink-0 text-[15px] leading-5">{r.name}</dt>
                  <dd className="min-w-0 flex-1 text-[15px] leading-5">
                    {here.length ? (
                      here.map((x, i) => (
                        <button key={i} type="button" onClick={() => onPerson(x.shift.employee_id)} className="block min-h-[28px] text-left font-semibold underline decoration-rule underline-offset-4 active:opacity-60">
                          {x.shift.name}
                        </button>
                      ))
                    ) : (
                      <span className={r.priority === 1 ? "font-semibold text-red" : "text-muted"}>Nobody</span>
                    )}
                  </dd>
                </div>
              </Fragment>
            );
          })}
        </dl>
      </div>
    </div>
  );
}

/** Legend under the board: every task once, with its letter, plus break and short. */
export function TaskLegend({ tasks }: { tasks: string[] }) {
  const used = TASK_ORDER.filter((t) => tasks.includes(t)).concat(tasks.filter((t) => !TASK_ORDER.includes(t)));
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-2 px-1 text-[13px] leading-[18px] text-muted" aria-label="Task key">
      {used.map((t) => {
        const m = taskMeta(t);
        return (
          <li key={t} className="flex items-center gap-1.5 whitespace-nowrap">
            <span aria-hidden className="grid h-[16px] w-[18px] place-items-center rounded-[3px] text-[10px] font-bold" style={{ background: m.color, color: m.fg, boxShadow: m.outline ? "inset 0 0 0 1.5px var(--ink)" : undefined }}>
              {m.code}
            </span>
            {m.label}
          </li>
        );
      })}
      <li className="flex items-center gap-1.5 whitespace-nowrap">
        <span aria-hidden className="h-0 w-0 border-x-[4px] border-t-[5px] border-x-transparent border-t-ink" />
        Break
      </li>
      <li className="flex items-center gap-1.5 whitespace-nowrap">
        <span aria-hidden className="h-[14px] w-[18px] rounded-[2px]" style={{ backgroundImage: HATCH, boxShadow: "inset 0 2px 0 var(--red)" }} />
        Short of people
      </li>
    </ul>
  );
}
