"use client";

import { Fragment, useEffect, useState, useSyncExternalStore } from "react";
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
const SHORT_BG = "rgba(220, 38, 38, 0.06)";
const RULES = (n: number) => ({
  backgroundImage: "linear-gradient(to right, var(--divider) 1px, transparent 1px)",
  backgroundSize: `calc(100% / ${n}) 100%`,
});
const segStyle = (m: { color: string; fg: string; outline?: boolean }) => ({ background: m.color, color: m.fg, boxShadow: m.outline ? "inset 0 0 0 1px #a1a1aa" : undefined });

const WIDE = "(min-width: 768px)";
/** True from 768 px: the full grid board. Phones get shift cards. Server render assumes wide. */
export function useWide() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(WIDE);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
}

/** Minutes since midnight, refreshed each minute; null until mounted (no hydration mismatch). */
function useNow() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setNow(d.getHours() * 60 + d.getMinutes());
    };
    tick();
    const t = window.setInterval(tick, 60_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

const hh = (t: string) => t.slice(0, 2);
const nextHour = (t: string) => `${String(Number(hh(t)) + 1).padStart(2, "0")}:00`;
export const stationOf = (t: { task: string; station?: string }) => t.station ?? taskMeta(String(t.task)).label;
const fromMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const hrsText = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} h`;

export function RotaBoard({ plan, mode, onPerson, isToday = false }: { plan: Plan; mode: "person" | "station"; onPerson: (id: string) => void; isToday?: boolean }) {
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
  const nowMin = useNow();
  const nowPct = isToday && nowMin !== null && nowMin >= a && nowMin <= a + total ? ((nowMin - a) / total) * 100 : null;
  const wide = useWide();

  if (!wide)
    return (
      <PhoneBoard plan={plan} shifts={shifts} mode={mode} active={active} stationHour={stationHour} onHour={pickHour} pct={pct} nowPct={nowPct} onPerson={onPerson} />
    );

  return (
    <div className="rounded-[12px] border border-[var(--border)] bg-paper px-3 pb-1 shadow-[0_1px_2px_rgba(16,24,40,0.04)] md:px-5" data-testid="rota-board">
      {/* hour axis: sticks under the compact bar while the rows scroll */}
      <div className={`${GRID} sticky top-[44px] z-[6] -mx-3 rounded-t-[12px] border-b border-[var(--divider)] bg-paper px-3 pb-1.5 pt-3 md:top-0 md:-mx-5 md:px-5 md:pt-4`} aria-hidden>
        <span />
        <div className="relative h-[16px]">
          {nowPct !== null && <span className="absolute -bottom-1.5 size-[7px] -translate-x-1/2 rounded-full bg-red" style={{ left: `${nowPct}%` }} />}
          {hours.map((h, i) => (
            <span
              key={h.hour}
              className={`num-col absolute bottom-0 -translate-x-1/2 text-[11px] leading-none text-muted ${i % 2 ? "hidden md:block" : ""} ${i === 0 ? "translate-x-0" : ""}`}
              style={{ left: `${(i / n) * 100}%` }}
            >
              {hh(h.hour)}
            </span>
          ))}
          <span className="num-col absolute bottom-0 right-0 hidden text-[11px] leading-none text-muted md:block">{hh(plan.opening.close)}</span>
        </div>
      </div>

      {/* need vs on shift, one tappable column per hour */}
      <div className={`${GRID} mt-2`}>
        <div className="flex flex-col justify-center gap-[3px] pr-2 text-[12px] leading-[16px] text-muted md:text-[13px]">
          <span>Need</span>
          <span className="font-semibold text-ink">
            On<span className="hidden md:inline"> shift</span>
          </span>
        </div>
        <div className="flex overflow-hidden rounded-[8px] border border-[var(--border)]" role="group" aria-label="Need and on shift per hour">
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
                className={`num-col relative flex min-h-[44px] min-w-0 flex-1 flex-col items-center justify-center gap-[3px] border-l border-[var(--divider)] text-[12px] leading-[16px] first:border-l-0 md:text-[13px] ${on ? "outline outline-2 -outline-offset-2 outline-ink" : "hover:bg-[var(--surface-2)]"}`}
                style={short ? { background: "var(--critical-bg)" } : undefined}
              >
                <span className="text-muted">{h.required}</span>
                <span className={`font-semibold ${short ? "text-red" : "text-ink"}`}>{h.scheduled}</span>
              </button>
            );
          })}
        </div>
      </div>
      <HourReadout row={active !== null ? hours[active] : null} hours={hours} />

      <div className="relative">
        {/* short hours as red-tinted columns, the current time as a thin red line */}
        <div className={`${GRID} pointer-events-none absolute inset-0`} aria-hidden>
          <span />
          <div className="relative">
            {hours.map((h, i) =>
              h.scheduled < h.required ? <span key={h.hour} className="absolute inset-y-0" style={{ left: `${(i / n) * 100}%`, width: `${100 / n}%`, background: SHORT_BG }} /> : null,
            )}
            {nowPct !== null && <span className="absolute inset-y-0 z-[5] w-[1.5px] -translate-x-1/2 bg-red" style={{ left: `${nowPct}%` }} data-testid="now-line" />}
          </div>
        </div>
        {mode === "person" ? (
          <PersonRows shifts={shifts} n={n} pct={pct} onPerson={onPerson} />
        ) : (
          <StationRows shifts={shifts} hours={hours} at={stationHour} onPerson={onPerson} />
        )}
      </div>
      {/* the hours again under the rows: the top axis can sit behind the floating tab bar on a desktop screen */}
      <div className={`${GRID} border-t border-[var(--divider)] pb-2 pt-1.5`} aria-hidden data-testid="rota-axis-bottom">
        <span />
        <div className="relative h-[14px]">
          {hours.map((h, i) => (
            <span key={h.hour} className={`num-col absolute top-0 -translate-x-1/2 text-[11px] leading-none text-muted ${i === 0 ? "translate-x-0" : ""}`} style={{ left: `${(i / n) * 100}%` }}>
              {hh(h.hour)}
            </span>
          ))}
          <span className="num-col absolute right-0 top-0 text-[11px] leading-none text-muted">{hh(plan.opening.close)}</span>
        </div>
      </div>
    </div>
  );
}

function HourReadout({ row, hours, bare = false }: { row: HourRow | null; hours: HourRow[]; bare?: boolean }) {
  const short = hours.filter((h) => h.scheduled < h.required).length;
  const hint = bare ? "Tap a short hour for its numbers." : "Tap an hour for its numbers.";
  return (
    <p className={bare ? "min-h-[40px] py-2" : `${GRID} min-h-[40px] items-center py-2`} aria-live="polite">
      {!bare && <span />}
      {row ? (
        <span className="num text-[14px] leading-5" data-testid="chart-readout">
          <span className="font-semibold">
            {row.hour}–{nextHour(row.hour)}
          </span>{" "}
          <span className="text-muted">
            need {row.required}, on shift {row.scheduled}
            {row.scheduled < row.required && <span className="font-semibold text-red">, {row.required - row.scheduled} short</span>}, {row.customers} customers
          </span>
        </span>
      ) : (
        <span className="text-[14px] leading-5 text-muted">
          {short ? (
            <>
              <span className="font-semibold text-red">
                {short} {short === 1 ? "hour" : "hours"} short
              </span>{" "}
              {bare ? "" : "(red columns). "}
              {hint}
            </>
          ) : (
            "Every hour is covered."
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
          <li key={s.employee_id} className="relative border-t border-[var(--divider)] py-2 md:py-1.5">
            <div className={`${GRID} items-center gap-y-1`}>
              <button
                type="button"
                onClick={() => onPerson(s.employee_id)}
                aria-label={`${s.name}, ${ROLE_LABEL[s.role] ?? s.role}, ${s.start} to ${s.end}`}
                className="col-span-2 -mx-1 flex min-h-[44px] min-w-0 items-center gap-2.5 rounded-[8px] px-1 text-left hover:bg-[var(--surface-2)] active:bg-[var(--neutral-bg)] md:col-span-1 md:mr-3"
              >
                <Avatar id={s.employee_id} name={s.name} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-semibold leading-5">{s.name}</span>
                  <span className="block text-[13px] leading-[18px] text-muted">{ROLE_LABEL[s.role] ?? s.role}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="num block whitespace-nowrap text-[14px] leading-5">
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
    <div className="relative h-[30px]" style={RULES(n)}>
      {/* the shift itself: a quiet frame, so time without a task still reads as on shift */}
      <span aria-hidden className="absolute inset-y-[2px] rounded-[6px] border border-[#d4d4d8] bg-[#fafafa]" style={{ left: pct(s.start), width: `calc(${pct(s.end)} - ${pct(s.start)})` }} />
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
            className="absolute inset-y-[4px] flex items-center justify-start overflow-hidden rounded-[5px] border-x-[1.5px] border-paper pl-[6px] text-[11px] font-semibold leading-none after:absolute after:inset-x-0 after:-inset-y-[11px] after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            style={{
              left: pct(t.from),
              width: `calc(${pct(t.to)} - ${pct(t.from)})`,
              ...segStyle(m),
              boxShadow: on ? "0 0 0 2px var(--paper), 0 0 0 3.5px var(--ink)" : segStyle(m).boxShadow,
              zIndex: on ? 2 : 1,
            }}
          >
            <span aria-hidden>{m.code}</span>
          </button>
        );
      })}
      {s.break_at && breakEnd && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-[2px] z-[3] rounded-[3px] border border-dashed border-[#a1a1aa] bg-paper"
          style={{ left: pct(s.break_at), width: `calc(${pct(breakEnd)} - ${pct(s.break_at)})` }}
        />
      )}
    </div>
  );
}

function TaskReason({ slot }: { slot: TaskSlot }) {
  const m = taskMeta(String(slot.task));
  return (
    <div className={`${GRID} pb-1 pt-2`}>
      <span />
      <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2" data-testid="task-reason">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-[14px] font-semibold leading-5">{stationOf(slot)}</span>
          <span className="num text-[13px] text-muted">
            {slot.from}–{slot.to}
          </span>
        </p>
        <p className="text-[13px] leading-[18px] text-muted">
          {m.label}
          {priorityLabel(slot.priority) ? `, ${String(priorityLabel(slot.priority)).toLowerCase()} priority` : ""}
          {typeof slot.match === "number" ? `, ${slot.match}% match` : ""}
        </p>
        <p className="mt-1 text-[14px] leading-5">{slot.reason}</p>
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
            <li key={r.name} className={`${GRID} relative items-center gap-y-1 border-t border-[var(--divider)] py-2`} data-testid="station-row">
              <div className="col-span-2 flex min-h-[32px] min-w-0 items-center gap-2.5 md:col-span-1 md:pr-3">
                <span aria-hidden className="grid size-[22px] shrink-0 place-items-center rounded-[6px] text-[11px] font-semibold" style={segStyle(m)}>
                  {m.code}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-semibold leading-5">{r.name}</span>
                  {r.priority < 9 && <span className="block text-[13px] leading-[18px] text-muted">{priorityLabel(r.priority)}</span>}
                </span>
              </div>
              <span className="text-[12px] text-muted md:hidden" aria-hidden />
              <div className="flex h-[28px] items-stretch gap-[2px]" role="img" aria-label={`${r.name}: ${hours.map((h) => `${h.hour} ${during(r, h.hour).length}`).join(", ")}`}>
                {hours.map((h, i) => {
                  const c = during(r, h.hour).length;
                  const gap = c === 0 && r.priority === 1 && h.scheduled < h.required;
                  return (
                    <span
                      key={h.hour}
                      className={`num-col grid min-w-0 flex-1 place-items-center rounded-[4px] text-[12px] font-semibold ${i === at ? "outline outline-2 outline-offset-1 outline-ink" : ""}`}
                      style={c ? { background: "#3f3f46", color: "#fff" } : gap ? { background: "var(--critical-bg)", color: "var(--red)", boxShadow: "inset 0 0 0 1px rgba(220,38,38,0.35)" } : { background: "#f4f4f5", color: "var(--text-3)" }}
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
      <div className="border-t border-[var(--divider)] pb-3 pt-3">
        <h3 className="text-[14px] font-semibold">
          At <span className="num">{hour}</span>
        </h3>
        <p className="text-[13px] leading-[18px] text-muted">Pick an hour in the strip above. Numbers in the cells are people at that station.</p>
        <dl className="mt-2 grid gap-x-6 md:grid-cols-2">
          {rows.map((r) => {
            const here = during(r, hour);
            return (
              <Fragment key={r.name}>
                <div className="flex min-h-[44px] items-center gap-3 border-t border-[var(--divider)] py-0.5">
                  <dt className="w-[46%] shrink-0 text-[14px] leading-5 text-muted">{r.name}</dt>
                  <dd className="min-w-0 flex-1 text-[14px] leading-5">
                    {here.length ? (
                      here.map((x, i) => (
                        <button key={i} type="button" onClick={() => onPerson(x.shift.employee_id)} className="flex min-h-[44px] items-center text-left font-medium hover:underline active:opacity-60">
                          {x.shift.name}
                        </button>
                      ))
                    ) : (
                      <span className={r.priority === 1 ? "font-medium text-red" : "text-muted"}>Nobody</span>
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
    <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-2 px-1 text-[13px] leading-[18px] text-muted" aria-label="Task key">
      {used.map((t) => {
        const m = taskMeta(t);
        return (
          <li key={t} className="flex items-center gap-1.5 whitespace-nowrap">
            <span aria-hidden className="grid h-[16px] w-[18px] place-items-center rounded-[4px] text-[10px] font-semibold" style={segStyle(m)}>
              {m.code}
            </span>
            {m.label}
          </li>
        );
      })}
      <li className="flex items-center gap-1.5 whitespace-nowrap">
        <span aria-hidden className="h-[16px] w-[18px] rounded-[3px] border border-dashed border-[#a1a1aa] bg-paper" />
        Break
      </li>
      <li className="flex items-center gap-1.5 whitespace-nowrap">
        <span aria-hidden className="h-[16px] w-[18px] rounded-[3px] border border-[rgba(220,38,38,0.35)] bg-[var(--critical-bg)]" />
        Short of people
      </li>
    </ul>
  );
}

/*
 * Phones (< 768 px): the grid board turns into a coverage chart plus one shift card per person.
 * Only the short hours are tappable (44 px chips); every other hour is read from the chart.
 */
function PhoneBoard({
  plan,
  shifts,
  mode,
  active,
  stationHour,
  onHour,
  pct,
  nowPct,
  onPerson,
}: {
  plan: Plan;
  shifts: Shift[];
  mode: "person" | "station";
  active: number | null;
  stationHour: number;
  onHour: (i: number) => void;
  pct: (t: string) => string;
  nowPct: number | null;
  onPerson: (id: string) => void;
}) {
  const hours = plan.hours;
  const n = hours.length || 13;
  const peak = Math.max(1, ...hours.map((h) => Math.max(h.required, h.scheduled)));
  const shortIdx = hours.map((h, i) => (h.scheduled < h.required ? i : -1)).filter((i) => i >= 0);
  const ticks = hours.map((h, i) => [h.hour, i] as const).filter(([, i]) => i % 3 === 0);

  return (
    <div data-testid="rota-board" className="space-y-4">
      <section aria-label="Coverage" className={`px-4 pb-1 pt-3.5 ${CARD_CLS}`}>
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-[14px] font-semibold leading-5">Need vs on shift</h3>
          <span className="flex items-center gap-3 text-[12px] leading-4 text-muted" aria-hidden>
            <span className="flex items-center gap-1.5">
              <span className="h-[10px] w-[6px] rounded-[2px] bg-zinc-700" />
              On shift
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-[10px] w-[6px] rounded-[2px] border border-[#a1a1aa]" />
              Need
            </span>
          </span>
        </div>
        {/* bars: outline = need, fill = on shift, red when short */}
        <div className="relative mt-3" role="img" aria-label={hours.map((h) => `${h.hour} need ${h.required}, on shift ${h.scheduled}`).join("; ")}>
          <div className="flex h-[64px] items-end gap-[3px]">
            {hours.map((h, i) => {
              const short = h.scheduled < h.required;
              return (
                <span key={h.hour} className="relative flex h-full min-w-0 flex-1 items-end">
                  <span className="absolute inset-x-0 bottom-0 rounded-[3px] border border-[#a1a1aa]" style={{ height: `${(h.required / peak) * 100}%`, borderColor: short ? "rgba(220,38,38,0.6)" : undefined }} />
                  <span
                    className={`relative w-full rounded-[3px] transition-[outline] ${short ? "bg-red" : "bg-zinc-700"} ${active === i ? "outline outline-2 outline-offset-2 outline-ink" : ""}`}
                    style={{ height: `${(h.scheduled / peak) * 100}%` }}
                  />
                </span>
              );
            })}
          </div>
          {nowPct !== null && <span aria-hidden className="absolute inset-y-0 w-[1.5px] -translate-x-1/2 bg-red" style={{ left: `${nowPct}%` }} data-testid="now-line" />}
          <div className="relative mt-1.5 h-[14px]" aria-hidden>
            {ticks.map(([t, i]) => (
              <span key={t} className="num-col absolute text-[11px] leading-[14px] text-muted" style={{ left: `${((i + 0.5) / n) * 100}%`, transform: "translateX(-50%)" }}>
                {hh(t)}
              </span>
            ))}
          </div>
        </div>
        {shortIdx.length > 0 && (
          <ul className="scroll-row -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]" aria-label="Short hours">
            {shortIdx.map((i) => {
              const h = hours[i];
              const miss = h.required - h.scheduled;
              return (
                <li key={h.hour} className="shrink-0">
                  <button
                    type="button"
                    className="chip num !gap-1.5 !px-3 !text-[14px]"
                    aria-pressed={active === i}
                    aria-label={`${h.hour}: need ${h.required}, on shift ${h.scheduled}, ${miss} short`}
                    onClick={() => onHour(i)}
                  >
                    {h.hour}
                    <span className={active === i ? "text-white" : "font-semibold text-red"}>−{miss}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <HourReadout row={active !== null ? hours[active] : null} hours={hours} bare />
      </section>

      {mode === "person" ? (
        <ShiftCards shifts={shifts} pct={pct} n={n} onPerson={onPerson} open={plan.opening.open} close={plan.opening.close} />
      ) : (
        <div className={`px-3 ${CARD_CLS}`}>
          <StationRows shifts={shifts} hours={hours} at={stationHour} onPerson={onPerson} />
        </div>
      )}
    </div>
  );
}

const CARD_CLS = "rounded-[12px] border border-[var(--border)] bg-paper shadow-[0_1px_2px_rgba(16,24,40,0.04)]";

function ShiftCards({ shifts, pct, n, onPerson, open, close }: { shifts: Shift[]; pct: (t: string) => string; n: number; onPerson: (id: string) => void; open: string; close: string }) {
  const [opened, setOpened] = useState<string | null>(null);
  return (
    <ul data-testid="roster" className={`overflow-hidden ${CARD_CLS}`}>
      {shifts.map((s) => {
        const role = ROLE_LABEL[s.role] ?? s.role;
        const isOpen = opened === s.employee_id;
        const breakEnd = s.break_at ? fromMin(toMin(s.break_at) + 30) : null;
        return (
          <li key={s.employee_id} className="border-t border-[var(--divider)] px-4 pb-0.5 pt-2 first:border-t-0">
            <button
              type="button"
              onClick={() => onPerson(s.employee_id)}
              aria-label={`${s.name}, ${role}, ${s.start} to ${s.end}`}
              className="-mx-2 flex min-h-[48px] w-[calc(100%+16px)] items-center gap-3 rounded-[10px] px-2 text-left hover:bg-[var(--surface-2)] active:bg-[var(--neutral-bg)]"
            >
              <Avatar id={s.employee_id} name={s.name} size={36} />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold leading-5">{s.name}</span>
                <span className="block text-[13px] leading-[18px] text-muted">
                  {role}
                  {s.strength ? `, ${s.strength.toLowerCase()}` : ""}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="num block whitespace-nowrap text-[15px] font-medium leading-5">
                  {s.start}–{s.end}
                </span>
                <span className="num block text-[13px] leading-[18px] text-muted">{hrsText(s.hours)}</span>
              </span>
            </button>
            {/* slim day bar: the shift on the opening hours, task letters inside; tap for the tasks */}
            <button
              type="button"
              aria-expanded={isOpen}
              aria-label={`Tasks for ${s.name}`}
              onClick={() => setOpened(isOpen ? null : s.employee_id)}
              className="-mx-2 -mt-0.5 flex min-h-[44px] w-[calc(100%+16px)] items-center gap-2 rounded-[10px] px-2 hover:bg-[var(--surface-2)] active:bg-[var(--neutral-bg)]"
            >
              <span className="num-col w-[18px] shrink-0 text-left text-[11px] text-muted" aria-hidden>
                {hh(open)}
              </span>
              <span className="relative h-[18px] flex-1 rounded-[5px] bg-[var(--neutral-bg)]" style={RULES(n)} aria-hidden>
                {s.tasks.map((t, i) => {
                  const m = taskMeta(String(t.task));
                  return (
                    <span
                      key={i}
                      className="absolute inset-y-0 flex items-center overflow-hidden rounded-[4px] border-x border-paper pl-[5px] text-[10px] font-semibold leading-none"
                      style={{ left: pct(t.from), width: `calc(${pct(t.to)} - ${pct(t.from)})`, ...segStyle(m) }}
                    >
                      {toMin(t.to) - toMin(t.from) >= 60 ? m.code : null}
                    </span>
                  );
                })}
                {s.break_at && breakEnd && (
                  <span className="absolute inset-y-0 z-[2] rounded-[3px] border border-dashed border-[#a1a1aa] bg-paper" style={{ left: pct(s.break_at), width: `calc(${pct(breakEnd)} - ${pct(s.break_at)})` }} />
                )}
              </span>
              <span className="num-col w-[18px] shrink-0 text-right text-[11px] text-muted" aria-hidden>
                {hh(close)}
              </span>
              <ChevronDown open={isOpen} />
            </button>
            <div className="grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none" style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}>
              <div className="overflow-hidden">
                {isOpen && (
                  <ul className="mb-2 mt-1 rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)] px-3" data-testid="task-reason">
                    {s.tasks.map((t, i) => {
                      const m = taskMeta(String(t.task));
                      return (
                        <li key={i} className="flex gap-2.5 border-t border-[var(--divider)] py-2.5 first:border-t-0">
                          <span aria-hidden className="mt-[1px] grid h-[18px] w-[20px] shrink-0 place-items-center rounded-[4px] text-[10px] font-semibold" style={segStyle(m)}>
                            {m.code}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-baseline gap-x-2">
                              <span className="text-[14px] font-semibold leading-5">{stationOf(t)}</span>
                              <span className="num text-[13px] text-muted">
                                {t.from}–{t.to}
                              </span>
                            </span>
                            <span className="block text-[14px] leading-5 text-[#52525b]">{t.reason}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ChevronDown({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className={`shrink-0 text-[var(--text-3)] transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}>
      <path d="M3.5 5.25 7 8.75l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
