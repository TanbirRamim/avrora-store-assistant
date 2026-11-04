"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { fetcher } from "@/lib/api";
import { money } from "@/lib/format";
import {
  addDays,
  dayLong,
  dayNum,
  dayShort,
  type Employee,
  EMPLOYEES_KEY,
  type Gap,
  type Plan,
  planKey,
  type ReplanEvent,
  shortSentence,
  span,
  toMin,
  versionLabel,
  workforce,
} from "@/lib/workforce";
import { EmployeeSheet } from "./EmployeeSheet";
import { CheckIcon, ChevronIcon, CloseIcon } from "./icons";
import { ReplanSheet } from "./ReplanSheet";
import { RotaBoard, TaskLegend, useWide } from "./TeamChart";
import { AskTeam, ChangeLog, KpiCard, WhyThisPlan } from "./TeamInsights";
import { TeamPeople } from "./TeamPeople";
import { Badge, BodyPortal, CARD, H2, primaryBtn, ROW, secondaryBtn, TeamSheet } from "./TeamSheet";

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** Plan status as a Polaris-style badge. */
export function StatusPill({ status }: { status: Plan["status"] }) {
  const t = status === "approved" ? "Approved" : status === "rejected" ? "Rejected" : "Draft";
  return (
    <Badge tone={status === "approved" ? "success" : status === "rejected" ? "critical" : "neutral"} testId="plan-status">
      {t}
    </Badge>
  );
}

/** Staffing line on Today: a white row card, opens Team. */
export function TeamTodayCard({ today, onOpen }: { today: string; onOpen: () => void }) {
  const { data: plan, error } = useSWR<Plan>(planKey(today), fetcher);
  if (error) return null;
  return (
    <section aria-label="Staffing today" className={`mt-4 overflow-hidden ${CARD}`}>
      <button onClick={onOpen} className="flex min-h-[64px] w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--surface-2)] active:bg-[var(--neutral-bg)] md:px-5" data-testid="staffing-today">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-[15px] font-semibold leading-5">Staffing today</span>
            {plan && <StatusPill status={plan.status} />}
          </span>
          <span className="num mt-0.5 block text-[14px] leading-5 text-muted">
            {plan ? (
              <>
                {plan.kpis.coverage_pct}% covered, {plan.shifts.length} people
                {plan.gaps.length > 0 && <span className="block text-red">{shortSentence(plan.gaps)}</span>}
              </>
            ) : (
              "Loading the plan…"
            )}
          </span>
        </span>
        <span className="hidden shrink-0 text-[14px] font-medium min-[400px]:inline">Review plan</span>
        <ChevronIcon className="shrink-0 text-[var(--text-3)]" />
      </button>
    </section>
  );
}

/** zinc-100 track, white selected segment that slides between options. Used for Plan / People and the board view. */
function Segmented<T extends string>({ value, onChange, items, label, className = "" }: { value: T; onChange: (v: T) => void; items: readonly (readonly [T, string])[]; label: string; className?: string }) {
  const still = useReducedMotion();
  const id = useId();
  return (
    <div role="tablist" aria-label={label} className={`flex rounded-[10px] bg-[var(--neutral-bg)] p-[3px] ${className}`}>
      {items.map(([v, l]) => (
        <button
          key={v}
          role="tab"
          aria-selected={value === v}
          onClick={() => onChange(v)}
          className={`relative min-h-[44px] flex-1 whitespace-nowrap rounded-[8px] px-3 text-[14px] font-medium leading-none transition-colors duration-150 ${value === v ? "text-ink" : "text-muted hover:text-ink"}`}
        >
          {value === v && (
            <motion.span
              layoutId={`seg-${id}`}
              transition={still ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 42 }}
              aria-hidden
              className="absolute inset-0 rounded-[8px] bg-paper shadow-[0_1px_2px_rgba(16,24,40,0.08),0_0_0_1px_rgba(16,24,40,0.04)]"
            />
          )}
          <span className="relative">{l}</span>
        </button>
      ))}
    </div>
  );
}

function ReplanIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M16.5 10a6.5 6.5 0 0 1-11.6 4M3.5 10a6.5 6.5 0 0 1 11.6-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M15.6 2.8v3.4h-3.4M4.4 17.2v-3.4h3.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const fade = (still: boolean | null) => ({
  initial: still ? { opacity: 0 } : { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0 },
  transition: { duration: 0.16, ease: "easeOut" as const },
});

type ReplanStart = { kind: ReplanEvent["kind"]; from: string } | null;

export function TeamView({ today, initialDate, initialTab = "plan" }: { today: string; initialDate?: string; initialTab?: "plan" | "people" }) {
  const [date, setDate] = useState(initialDate && initialDate >= today && initialDate <= addDays(today, 6) ? initialDate : today);
  const [tab, setTab] = useState<"plan" | "people">(initialTab);
  const [person, setPerson] = useState<string | null>(null);
  const [replan, setReplan] = useState<{ start: ReplanStart } | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [cardActionsVisible, setCardActionsVisible] = useState(true);
  const still = useReducedMotion();
  const { mutate } = useSWRConfig();
  const key = planKey(date);
  const { data: plan, error: planError, isLoading, mutate: retry } = useSWR<Plan>(key, fetcher, { keepPreviousData: true });
  const { data: emp } = useSWR<{ employees: Employee[] }>(EMPLOYEES_KEY, fetcher);
  const employees = emp?.employees ?? [];
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const root = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement | null>(null);
  const draft = tab === "plan" && !!plan && plan.status === "draft";
  const showBar = draft && !cardActionsVisible && !replan && !rejectOpen && !person;

  // the floating bar only appears once the summary card's own buttons have scrolled out of view
  const watchActions = useCallback((el: HTMLDivElement | null) => {
    actionsRef.current = el;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setCardActionsVisible(e.isIntersecting), { rootMargin: "-56px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // the scroll area makes room for the floating bar
  useEffect(() => {
    const main = root.current?.closest("main");
    if (!main || !draft) return;
    main.classList.add("pb-action");
    return () => main.classList.remove("pb-action");
  }, [draft]);

  const setPlan = (p: Plan) => mutate(key, p, { revalidate: false });

  const approve = async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const r = await workforce.approve(plan.date, plan.version);
      await setPlan({ ...plan, status: "approved", changes: [...plan.changes, { at: r.at, by: "manager", summary: `Approved: ${versionLabel(plan.version)}.` }] });
      setNote(`Plan approved at ${time(r.at)}.`);
    } catch {
      setError("Couldn't save the approval. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const reject = async (reason: string) => {
    if (!plan) return;
    const r = await workforce.reject(plan.date, plan.version, reason);
    await setPlan({ ...plan, status: "rejected", changes: [...plan.changes, { at: r.at, by: "manager", summary: `Rejected: ${reason}` }] });
    setRejectOpen(false);
    setNote("Plan rejected. Use Replan to get a new one.");
  };

  const loading = !plan || (isLoading && plan.date !== date);

  return (
    <div ref={root}>
      {/* screen header: same spec as ScreenHeader, with the Replan action on the title row */}
      <header className="screen-header">
        <p className="t-footnote num mb-1 font-medium text-muted">{dayLong(date)}</p>
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element -- static export, SVG mark */}
            <img src="/avrora-mark.svg" alt="" width={24} height={24} className="size-6 shrink-0" />
            <h1 className="t-large-title min-w-0">Team</h1>
          </div>
          {tab === "plan" && plan && (
            <button
              type="button"
              onClick={() => setReplan({ start: null })}
              aria-label="Replan"
              data-testid="replan-open"
              className="flex h-[44px] shrink-0 items-center justify-center gap-2 rounded-[10px] border border-[var(--border)] bg-paper px-3.5 text-[15px] font-medium text-ink shadow-[0_1px_2px_rgba(16,24,40,0.04)] hover:bg-[var(--surface-2)] active:bg-[var(--neutral-bg)]"
            >
              <ReplanIcon />
              <span>Replan</span>
            </button>
          )}
        </div>
      </header>

      <Segmented
        label="Team view"
        value={tab}
        onChange={setTab}
        items={[
          ["plan", "Plan"],
          ["people", "People"],
        ]}
        className="mt-3 md:max-w-[280px]"
      />

      <AnimatePresence mode="wait" initial={false}>
        {tab === "people" ? (
          <motion.div key="people" {...fade(still)}>
            <TeamPeople employees={emp ? employees : null} today={today} onOpen={setPerson} />
          </motion.div>
        ) : (
          <motion.div key="plan" {...fade(still)}>
            {/* day picker: compact cells "Mon / 2"; selected = yellow fill, today = red dot */}
            <div role="group" aria-label="Day" className="mt-3 grid grid-cols-7 gap-1 md:max-w-[520px]">
              {days.map((d, i) => {
                const on = d === date;
                return (
                  <button
                    key={d}
                    onClick={() => setDate(d)}
                    aria-pressed={on}
                    aria-label={i === 0 ? `Today, ${dayLong(d)}` : dayLong(d)}
                    className={`relative flex min-h-[52px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-[10px] border transition-colors duration-150 ${
                      on ? "border-yellow bg-yellow font-semibold text-ink" : "border-[var(--border)] bg-paper text-ink hover:bg-[var(--surface-2)] active:bg-[var(--neutral-bg)]"
                    }`}
                  >
                    <span className={`text-[12px] leading-4 ${on ? "text-ink/70" : "text-muted"}`}>{dayShort(d)}</span>
                    <span className="num text-[15px] font-semibold leading-5">{dayNum(d)}</span>
                    {i === 0 && <span aria-hidden className={`absolute right-1.5 top-1.5 size-[5px] rounded-full ${on ? "bg-ink" : "bg-[var(--brand)]"}`} />}
                  </button>
                );
              })}
            </div>

            {planError && !plan ? (
              <div className={`mt-4 px-6 py-10 text-center ${CARD}`}>
                <p className="text-[15px] font-semibold">No staffing plan for this day yet.</p>
                <p className="t-subhead mt-1 text-muted">The plan service didn&apos;t answer.</p>
                <button onClick={() => void retry()} className="btn-ghost mt-4">
                  Try again
                </button>
              </div>
            ) : !plan ? (
              <div className="mt-4 space-y-4" aria-busy="true">
                <div className="h-[200px] animate-pulse rounded-[12px] bg-[var(--neutral-bg)]" />
                <div className="h-[360px] animate-pulse rounded-[12px] bg-[var(--neutral-bg)]" />
              </div>
            ) : (
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={plan.date} {...fade(still)} aria-busy={loading} className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
                  <PlanBody
                    plan={plan}
                    onPerson={setPerson}
                    employees={employees}
                    isToday={plan.date === today}
                    busy={busy}
                    onApprove={() => void approve()}
                    onReject={() => setRejectOpen(true)}
                    onReplan={(start) => setReplan({ start })}
                    actionsRef={watchActions}
                  />
                </motion.div>
              </AnimatePresence>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* fixed layers go to <body>: an animated ancestor (the tab cross-fade) would otherwise become their containing block */}
      <BodyPortal>
      {/* floating approve bar: only once the summary card's buttons are off screen */}
      <AnimatePresence>
        {showBar && plan && (
          <motion.div
            key="bar"
            initial={still ? { opacity: 0 } : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={still ? { opacity: 0 } : { opacity: 0, y: 12 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            role="region"
            aria-label="Plan actions"
            data-testid="plan-actions-bar"
            className="action-zone !bottom-[calc(var(--nav-clear)+6px)] !min-h-[52px] !gap-1.5 !py-[3px] !pl-3 !pr-[3px]"
          >
            <span className="num hidden min-w-0 flex-1 text-[14px] leading-5 text-muted min-[390px]:block">
              Draft{plan.gaps.length > 0 && `, ${plan.gaps.length} ${plan.gaps.length === 1 ? "gap" : "gaps"}`}
            </span>
            <button type="button" onClick={() => setRejectOpen(true)} disabled={busy} aria-label="Reject" className="grid size-[44px] shrink-0 place-items-center rounded-[10px] border border-[var(--border)] bg-paper text-ink hover:bg-[var(--surface-2)] disabled:opacity-40">
              <CloseIcon size={14} />
            </button>
            <button type="button" onClick={() => void approve()} disabled={busy} className="btn-ink !min-h-[44px] flex-1 px-4 text-[15px] disabled:opacity-40 min-[390px]:flex-none">
              {busy ? "Saving…" : "Approve plan"}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--nav-clear)+72px)] z-[35] flex justify-center px-3">
        <AnimatePresence>
          {(note || error) && (
            <motion.div
              key={note ?? error}
              role={error ? "alert" : "status"}
              initial={still ? { opacity: 0 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onAnimationComplete={() => window.setTimeout(() => (setNote(null), setError(null)), 3200)}
              className="float pointer-events-auto flex min-h-[48px] w-full max-w-[420px] items-center rounded-[10px] bg-ink px-4 text-white"
            >
              <span className="t-subhead py-2.5">{error ?? note}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      </BodyPortal>

      <AnimatePresence>
        {person && <EmployeeSheet key={person} id={person} fallback={employees.find((e) => e.employee_id === person)} today={today} onClose={() => setPerson(null)} />}
        {replan && plan && (
          <ReplanSheet
            key="replan"
            plan={plan}
            employees={employees}
            initialKind={replan.start?.kind}
            initialFrom={replan.start?.from}
            onClose={() => setReplan(null)}
            onApproved={(next, at) => {
              const { diff: _d, ...rest } = next;
              void _d;
              void setPlan({ ...rest, status: "approved", changes: [...next.changes, { at, by: "manager", summary: `Approved: ${versionLabel(next.version)}.` }] });
              setReplan(null);
              setNote("New plan approved.");
            }}
          />
        )}
        {rejectOpen && plan && <RejectSheet key="reject" onClose={() => setRejectOpen(false)} onReject={reject} />}
      </AnimatePresence>
    </div>
  );
}

/** A gap's start, as a whole hour the replan form offers. */
const gapHour = (g: Gap) => `${g.from.slice(0, 2)}:00`;

function PlanBody({
  plan,
  onPerson,
  employees,
  isToday,
  busy,
  onApprove,
  onReject,
  onReplan,
  actionsRef,
}: {
  plan: Plan;
  onPerson: (id: string) => void;
  employees: Employee[];
  isToday: boolean;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  onReplan: (start: ReplanStart) => void;
  actionsRef: (el: HTMLDivElement | null) => void;
}) {
  const k = plan.kpis;
  const still = useReducedMotion();
  const [mode, setMode] = useState<"person" | "station">("person");
  const wide = useWide();
  const strengths = Object.fromEntries(employees.map((e) => [e.employee_id, e.strength ?? null]));
  const shifts = plan.shifts.map((s) => ({ ...s, strength: s.strength ?? strengths[s.employee_id] ?? null }));
  const tasks = [...new Set(plan.shifts.flatMap((s) => s.tasks.map((t) => String(t.task))))];
  const hasStations = plan.shifts.some((s) => s.tasks.some((t) => t.station));
  const conditions = [...plan.conditions].sort((a, b) => toMin(a.from) - toMin(b.from));
  const short = plan.gaps.length > 0;

  return (
    <div className="mt-4 space-y-6 md:space-y-8">
      {/* summary card: status, key figure, sentence, stats, then the one approval step */}
      <section aria-label="Plan summary" data-testid="plan-hero" className={CARD}>
        <div className="px-4 pb-4 pt-3.5 md:px-5">
          <div className="flex items-center gap-2">
            <AnimatePresence mode="wait" initial={false}>
              <motion.span key={plan.status} initial={still ? { opacity: 0 } : { opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }} className="inline-flex">
                <StatusPill status={plan.status} />
              </motion.span>
            </AnimatePresence>
            <span className="min-w-0 text-[13px] leading-[18px] text-muted">{versionLabel(plan.version)}</span>
          </div>
          <p className="mt-3 flex items-baseline gap-2">
            <span className="num text-[30px] font-semibold leading-[36px] tracking-[-0.02em]" data-testid="kpi-coverage">
              {k.coverage_pct}%
            </span>
            <span className="text-[15px] leading-5 text-muted">covered</span>
          </p>
          <p className="mt-1 flex items-start gap-2 text-[15px] leading-[22px]" data-testid="tag-sentence">
            {short ? <span aria-hidden className="mt-[8px] size-[6px] shrink-0 rounded-full bg-red" /> : <CheckIcon size={14} className="mt-1 shrink-0 text-green" />}
            <span className={short ? "font-medium text-ink" : "text-muted"}>{shortSentence(plan.gaps)}</span>
          </p>
          {conditions.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Conditions">
              {conditions.map((c, i) => (
                <li key={i}>
                  <Badge dot={false}>
                    {c.label}
                    <span className="num text-muted">{span(c.from, c.to, plan.opening.open, plan.opening.close)}</span>
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
        <dl className="grid grid-cols-3 border-t border-[var(--divider)]">
          {(
            [
              ["Hours", `${k.labour_hours}`, "kpi-hours"],
              ["Cost", money(k.labour_cost_uah), "kpi-cost"],
              ["Gaps", `${plan.gaps.length}`, "kpi-gaps"],
            ] as const
          ).map(([l, v, id]) => (
            <div key={l} className="flex min-w-0 flex-col border-l border-[var(--divider)] px-4 py-3 first:border-l-0 md:px-5">
              <dt className="text-[13px] leading-[18px] text-muted">{l}</dt>
              <dd className={`num mt-0.5 whitespace-nowrap text-[17px] font-semibold leading-[22px] ${id === "kpi-gaps" && short ? "text-red" : ""}`} data-testid={id}>
                {v}
              </dd>
            </div>
          ))}
        </dl>
        <div ref={actionsRef} data-testid="plan-actions" className="border-t border-[var(--divider)] px-4 py-3 md:px-5">
          <AnimatePresence mode="wait" initial={false}>
            {plan.status === "draft" ? (
              <motion.div key="draft" {...fade(still)} className="flex gap-2 md:justify-end">
                <button type="button" onClick={onReject} disabled={busy} className="btn-ghost flex-1 px-4 text-[15px] disabled:opacity-40 md:flex-none">
                  Reject
                </button>
                <button type="button" onClick={onApprove} disabled={busy} className="btn-ink flex-[2] px-5 text-[15px] disabled:opacity-40 md:flex-none">
                  {busy ? "Saving…" : "Approve plan"}
                </button>
              </motion.div>
            ) : (
              <motion.div key={plan.status} {...fade(still)} className="flex min-h-[44px] items-center gap-3">
                {plan.status === "approved" ? (
                  <span className="flex items-center gap-2 text-[15px] font-medium text-green">
                    <motion.span
                      initial={still ? false : { scale: 0.4, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: "spring", stiffness: 500, damping: 26 }}
                      className="grid size-[22px] place-items-center rounded-full bg-green text-white"
                    >
                      <CheckIcon size={12} />
                    </motion.span>
                    Plan approved
                  </span>
                ) : (
                  <span className="text-[15px] font-medium text-red">Plan rejected</span>
                )}
                <span className="min-w-0 flex-1 text-[14px] leading-5 text-muted">Changes go through Replan.</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>

      {/* the gap list: one row per short window, each with its own fix */}
      <section aria-labelledby="gaps-h">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="gaps-h" className={H2}>
            Gaps
          </h2>
          {short && <span className="num px-1 pb-2 text-[13px] text-muted">{plan.gaps.length}</span>}
        </div>
        <ul className={`px-4 ${CARD}`} data-testid="gap-list">
          {plan.gaps.length === 0 ? (
            <li className="flex min-h-[52px] items-center gap-2 py-3 text-[14px]">
              <Badge tone="success">Covered</Badge> Every hour has enough people.
            </li>
          ) : (
            plan.gaps.map((g) => (
              <li key={g.from + g.to} className={`flex flex-col gap-3 py-3.5 md:flex-row md:items-center md:gap-6 ${ROW}`} data-testid="gap">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="num whitespace-nowrap text-[15px] font-semibold">
                      {g.from}–{g.to}
                    </span>
                    <Badge tone="critical">
                      {g.missing} {g.missing === 1 ? "person" : "people"} short
                    </Badge>
                  </p>
                  <p className="mt-1 text-[14px] leading-5 text-muted">{g.reason}</p>
                </div>
                <button type="button" onClick={() => onReplan({ kind: "traffic_spike", from: gapHour(g) })} className="btn-ghost shrink-0 gap-2 px-4 text-[15px]">
                  <ReplanIcon size={16} />
                  Fix with replan
                </button>
              </li>
            ))
          )}
        </ul>
      </section>

      {/* the rota: shift cards on phones, the full grid board from 768 px */}
      <section aria-labelledby="board-h">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-x-3 gap-y-2 px-1">
          <div>
            <h2 id="board-h" className="num text-[15px] font-semibold leading-5">
              Rota {plan.opening.open}–{plan.opening.close}
            </h2>
            <p className="text-[13px] leading-[18px] text-muted">{plan.shifts.length} people on shift</p>
          </div>
          <Segmented
            label="Board view"
            value={mode}
            onChange={setMode}
            items={[
              ["person", "By person"],
              ["station", hasStations ? "By station" : "By task"],
            ]}
            className="w-full min-[400px]:w-auto"
          />
        </div>
        <RotaBoard plan={{ ...plan, shifts }} mode={mode} onPerson={onPerson} isToday={isToday} />
        {mode === "person" && (
          <>
            <TaskLegend tasks={tasks} />
            <p className="mt-1.5 px-1 text-[13px] leading-[18px] text-muted">
              {wide ? "Select a name for the person, a block for the station and why they have it." : "Tap a person for their profile, the day bar for their tasks."}
            </p>
          </>
        )}
      </section>

      <section aria-labelledby="blocks-h">
        <h2 id="blocks-h" className={H2}>
          Staffing by block
        </h2>
        <ul className={`px-4 ${CARD} lg:grid lg:grid-cols-2 lg:gap-x-8`} data-testid="blocks">
          {plan.blocks.map((b) => {
            const s = b.scheduled < b.required;
            return (
              <li key={b.from} className={`flex min-h-[48px] items-center gap-3 py-2 ${ROW} lg:[&:nth-child(2)]:border-t-0`}>
                <span className="num w-[104px] shrink-0 whitespace-nowrap text-[14px]">
                  {b.from}–{b.to}
                </span>
                <span className="flex flex-1 items-center gap-[3px]" aria-hidden>
                  {Array.from({ length: b.required }, (_, i) => (
                    <span key={i} className={`h-[12px] w-[6px] rounded-[2px] ${i < b.scheduled ? "bg-zinc-700" : "border border-red bg-[var(--critical-bg)]"}`} />
                  ))}
                </span>
                {s ? (
                  <Badge tone="critical">
                    <span className="num">
                      {b.scheduled} of {b.required}
                    </span>
                  </Badge>
                ) : (
                  <span className="num shrink-0 text-right text-[14px] text-muted">
                    <span className="font-semibold text-ink">{b.required}</span> {b.required === 1 ? "person" : "people"}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <WhyThisPlan plan={plan} />
      <AskTeam plan={plan} employees={employees} />
      <KpiCard />
      <ChangeLog changes={plan.changes} />
    </div>
  );
}

const REASONS = ["Not enough people at peak", "Wrong people on tasks", "Cost too high", "Availability is out of date"];

function RejectSheet({ onClose, onReject }: { onClose: () => void; onReject: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onReject(reason.trim());
    } catch {
      setError("Couldn't save. Try again.");
      setBusy(false);
    }
  };
  return (
    <TeamSheet
      title="Reject plan"
      labelId="reject-title"
      onClose={onClose}
      footer={
        <div className="flex gap-3">
          <button onClick={onClose} className={secondaryBtn}>
            Cancel
          </button>
          <button onClick={() => void submit()} disabled={!reason.trim() || busy} className={primaryBtn}>
            {busy ? "Saving…" : "Reject plan"}
          </button>
        </div>
      }
    >
      <p className="t-subhead text-muted">Say what&apos;s wrong. It goes into the change log and shapes the next plan.</p>
      <ul className={`mt-4 overflow-hidden ${CARD}`} aria-label="Common reasons">
        {REASONS.map((r) => (
          <li key={r} className={ROW}>
            <button onClick={() => setReason(r)} aria-pressed={reason === r} className={`flex min-h-[48px] w-full items-center justify-between gap-3 px-4 text-left text-[15px] ${reason === r ? "bg-[var(--surface-2)] font-medium" : "hover:bg-[var(--surface-2)]"}`}>
              {r}
              {reason === r && <CheckIcon size={16} />}
            </button>
          </li>
        ))}
      </ul>
      <label htmlFor="reject-reason" className="mt-5 block pb-1.5 text-[14px] font-medium">
        Reason
      </label>
      <textarea
        id="reject-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
        maxLength={200}
        className="w-full resize-none rounded-[10px] border border-[var(--border)] bg-paper px-3 py-2.5 text-[16px] focus:border-ink focus:shadow-[0_0_0_3px_rgba(24,24,27,0.12)] focus:outline-none"
        placeholder="For example: two people on the tills after 17:00"
      />
      {error && (
        <p role="alert" className="t-subhead mt-3 text-red">
          {error}
        </p>
      )}
    </TeamSheet>
  );
}
