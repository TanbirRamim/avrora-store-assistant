"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
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
  type Plan,
  planKey,
  shortSentence,
  span,
  toMin,
  versionLabel,
  workforce,
} from "@/lib/workforce";
import { EmployeeSheet } from "./EmployeeSheet";
import { CheckIcon, ChevronIcon } from "./icons";
import { ReplanSheet } from "./ReplanSheet";
import { ScreenHeader } from "./ScreenHeader";
import { RotaBoard, TaskLegend } from "./TeamChart";
import { AskTeam, ChangeLog, KpiCard, WhyThisPlan } from "./TeamInsights";
import { TeamPeople } from "./TeamPeople";
import { primaryBtn, secondaryBtn, TeamSheet } from "./TeamSheet";

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** Plan status as a word in an ink outline (on the yellow tag) or plain on paper. */
export function StatusPill({ status }: { status: Plan["status"] }) {
  const t = status === "approved" ? "Approved" : status === "rejected" ? "Rejected" : "Draft";
  return (
    <span className="inline-flex min-h-[26px] items-center gap-1 whitespace-nowrap rounded-[6px] px-2 text-[13px] font-semibold leading-none shadow-[inset_0_0_0_1.5px_var(--ink)]" data-testid="plan-status">
      {status === "approved" && <CheckIcon size={12} />}
      {t}
    </span>
  );
}

/** Staffing line on Today: flat paper row, opens Team. */
export function TeamTodayCard({ today, onOpen }: { today: string; onOpen: () => void }) {
  const { data: plan, error } = useSWR<Plan>(planKey(today), fetcher);
  if (error) return null;
  return (
    <section aria-label="Staffing today" className="mt-4 overflow-hidden rounded-[14px] bg-paper">
      <button onClick={onOpen} className="flex min-h-[64px] w-full items-center gap-3 px-4 py-3 text-left active:bg-fill md:px-5" data-testid="staffing-today">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="t-headline">Staffing today</span>
            {plan && (
              <span className={`text-[13px] font-semibold ${plan.status === "approved" ? "text-green" : "text-muted"}`}>
                {plan.status === "approved" ? "Approved" : plan.status === "rejected" ? "Rejected" : "Draft"}
              </span>
            )}
          </span>
          <span className="t-subhead num mt-0.5 block text-muted">
            {plan ? (
              <>
                {plan.kpis.coverage_pct}% covered, {plan.shifts.length} people
                {plan.gaps.length > 0 && <span className="block font-semibold text-red">{shortSentence(plan.gaps)}</span>}
              </>
            ) : (
              "Loading the plan…"
            )}
          </span>
        </span>
        <span className="t-subhead hidden shrink-0 font-semibold min-[400px]:inline">Review plan</span>
        <ChevronIcon className="shrink-0 text-muted" />
      </button>
    </section>
  );
}

export function TeamView({ today, initialDate, initialTab = "plan" }: { today: string; initialDate?: string; initialTab?: "plan" | "people" }) {
  const [date, setDate] = useState(initialDate && initialDate >= today && initialDate <= addDays(today, 6) ? initialDate : today);
  const [tab, setTab] = useState<"plan" | "people">(initialTab);
  const [person, setPerson] = useState<string | null>(null);
  const [replanOpen, setReplanOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const { mutate } = useSWRConfig();
  const key = planKey(date);
  const { data: plan, error: planError, isLoading, mutate: retry } = useSWR<Plan>(key, fetcher);
  const { data: emp } = useSWR<{ employees: Employee[] }>(EMPLOYEES_KEY, fetcher);
  const employees = emp?.employees ?? [];
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const root = useRef<HTMLDivElement>(null);
  const showZone = tab === "plan" && !!plan;

  // the scroll area makes room for the bottom action zone while it is shown
  useEffect(() => {
    const main = root.current?.closest("main");
    if (!main || !showZone) return;
    main.classList.add("pb-action");
    return () => main.classList.remove("pb-action");
  }, [showZone]);

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
    setNote("Plan rejected. Use Something changed to get a new one.");
  };

  const approved = plan?.status === "approved";

  return (
    <div ref={root}>
      <ScreenHeader
        title="Team"
        date={dayLong(date)}
        action={
          tab === "plan" && plan && !approved ? (
            <button type="button" onClick={() => setReplanOpen(true)} className="btn-text -ml-1 underline decoration-rule underline-offset-4">
              Something changed
            </button>
          ) : undefined
        }
      />

      {/* Plan / People: flat text tabs with an ink underline */}
      <div role="tablist" aria-label="Team view" className="mt-3 flex gap-6 border-b border-rule">
        {(
          [
            ["plan", "Plan"],
            ["people", "People"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`-mb-px min-h-[44px] border-b-[3px] text-[17px] font-semibold ${tab === id ? "border-ink text-ink" : "border-transparent text-muted"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "people" ? (
        <TeamPeople employees={emp ? employees : null} today={today} onOpen={setPerson} />
      ) : (
        <>
          {/* day picker: Today, Tue 3, …; the yellow pill marks the day shown */}
          <div role="group" aria-label="Day" className="-mx-1 mt-3 flex">
            {days.map((d, i) => {
              const on = d === date;
              return (
                <button
                  key={d}
                  onClick={() => setDate(d)}
                  aria-pressed={on}
                  aria-label={i === 0 ? `Today, ${dayLong(d)}` : dayLong(d)}
                  className="group flex min-h-[44px] min-w-0 flex-1 items-center justify-center px-0.5"
                >
                  <span
                    className={`num whitespace-nowrap rounded-full px-2 py-1.5 text-[14px] leading-[18px] min-[400px]:text-[15px] md:px-3 ${
                      on ? "bg-yellow font-semibold text-ink" : "text-muted group-active:bg-fill"
                    }`}
                  >
                    {i === 0 ? "Today" : `${dayShort(d)} ${dayNum(d)}`}
                  </span>
                </button>
              );
            })}
          </div>

          {planError && !plan ? (
            <div className="mt-4 rounded-[14px] bg-paper px-6 py-10 text-center">
              <p className="t-headline">No staffing plan for this day yet.</p>
              <p className="t-subhead mt-1 text-muted">The plan service didn&apos;t answer.</p>
              <button onClick={() => void retry()} className="btn-ghost mt-4">
                Try again
              </button>
            </div>
          ) : !plan || isLoading ? (
            <div className="mt-4 space-y-4" aria-busy="true">
              <div className="h-[168px] animate-pulse rounded-[14px] bg-fill" />
              <div className="h-[360px] animate-pulse rounded-[14px] bg-fill" />
            </div>
          ) : (
            <PlanBody plan={plan} onPerson={setPerson} employees={employees} />
          )}

          {plan && (
            <div className="action-zone" data-testid="plan-actions">
              {approved ? (
                <>
                  <span className="flex min-w-0 flex-1 items-center gap-2 text-green">
                    <span className="grid size-[24px] shrink-0 place-items-center rounded-full bg-green text-white">
                      <CheckIcon size={13} />
                    </span>
                    <span className="truncate text-[15px] font-semibold">Plan approved</span>
                  </span>
                  <button type="button" onClick={() => setReplanOpen(true)} className="btn-ink shrink-0 px-5 text-[15px]">
                    Something changed
                  </button>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-[15px] text-muted">{plan.status === "rejected" ? "Rejected" : "Draft"}</span>
                  <button type="button" onClick={() => setRejectOpen(true)} disabled={busy || plan.status === "rejected"} className="btn-ghost shrink-0 px-4 text-[15px] disabled:opacity-40">
                    Reject
                  </button>
                  <button type="button" onClick={() => void approve()} disabled={busy} className="btn-ink shrink-0 px-5 text-[15px] disabled:opacity-40">
                    {busy ? "Saving…" : "Approve plan"}
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}

      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--nav-clear)+84px)] z-[35] flex justify-center px-3">
        <AnimatePresence>
          {(note || error) && (
            <motion.div
              key={note ?? error}
              role={error ? "alert" : "status"}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onAnimationComplete={() => window.setTimeout(() => (setNote(null), setError(null)), 3200)}
              className="float pointer-events-auto flex min-h-[48px] w-full max-w-[420px] items-center rounded-[14px] bg-ink px-4 text-white"
            >
              <span className="t-subhead py-2.5">{error ?? note}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {person && <EmployeeSheet key={person} id={person} fallback={employees.find((e) => e.employee_id === person)} today={today} onClose={() => setPerson(null)} />}
        {replanOpen && plan && (
          <ReplanSheet
            key="replan"
            plan={plan}
            employees={employees}
            onClose={() => setReplanOpen(false)}
            onApproved={(next, at) => {
              const { diff: _d, ...rest } = next;
              void _d;
              void setPlan({ ...rest, status: "approved", changes: [...next.changes, { at, by: "manager", summary: `Approved: ${versionLabel(next.version)}.` }] });
              setReplanOpen(false);
              setNote("New plan approved.");
            }}
          />
        )}
        {rejectOpen && plan && <RejectSheet key="reject" onClose={() => setRejectOpen(false)} onReject={reject} />}
      </AnimatePresence>
    </div>
  );
}

function PlanBody({ plan, onPerson, employees }: { plan: Plan; onPerson: (id: string) => void; employees: Employee[] }) {
  const k = plan.kpis;
  const [mode, setMode] = useState<"person" | "station">("person");
  const strengths = Object.fromEntries(employees.map((e) => [e.employee_id, e.strength ?? null]));
  const shifts = plan.shifts.map((s) => ({ ...s, strength: s.strength ?? strengths[s.employee_id] ?? null }));
  const tasks = [...new Set(plan.shifts.flatMap((s) => s.tasks.map((t) => String(t.task))))];
  const hasStations = plan.shifts.some((s) => s.tasks.some((t) => t.station));
  const conditions = [...plan.conditions].sort((a, b) => toMin(a.from) - toMin(b.from));

  return (
    <div className="mt-4 space-y-8">
      {/* the one yellow tag: coverage of the day */}
      <section aria-label="Plan summary" data-testid="plan-hero">
        <div className="price-tag">
          <div className="flex items-start justify-between gap-3 pl-4">
            <span className="text-[13px] leading-[18px]">{versionLabel(plan.version)}</span>
            <StatusPill status={plan.status} />
          </div>
          <p className="mt-3 flex items-baseline gap-2">
            <span className="tag-figure" data-testid="kpi-coverage">
              {k.coverage_pct}%
            </span>
            <span className="text-[15px] leading-5">covered</span>
          </p>
          <p className={`mt-2 text-[17px] leading-[22px] ${plan.gaps.length ? "font-semibold" : ""}`} data-testid="tag-sentence">
            {shortSentence(plan.gaps)}
          </p>
          {conditions.length > 0 && (
            <ul className="mt-3 border-t border-black/15 pt-2.5 text-[15px] leading-5" aria-label="Conditions">
              {conditions.map((c, i) => (
                <li key={i} className="flex justify-between gap-3 py-0.5">
                  <span className="min-w-0">{c.label}</span>
                  <span className="num shrink-0 whitespace-nowrap">{span(c.from, c.to, plan.opening.open, plan.opening.close)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {/* quiet row under the tag */}
        <dl className="mt-3 grid grid-cols-3 gap-3 px-1">
          {(
            [
              ["Labour hours", `${k.labour_hours}`, "kpi-hours"],
              ["Labour cost", money(k.labour_cost_uah), "kpi-cost"],
              ["Short windows", `${plan.gaps.length}`, "kpi-gaps"],
            ] as const
          ).map(([l, v, id]) => (
            <div key={l} className="flex min-w-0 flex-col">
              <dt className="order-last text-[13px] leading-[18px] text-muted">{l}</dt>
              <dd className={`num truncate text-[17px] font-semibold leading-[22px] ${id === "kpi-gaps" && plan.gaps.length ? "text-red" : ""}`} data-testid={id}>
                {v}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* the rota board */}
      <section aria-labelledby="board-h">
        <div className="mb-2 flex items-end justify-between gap-3 px-1">
          <div>
            <h2 id="board-h" className="text-[17px] font-semibold leading-[22px]">
              Rota, {plan.opening.open}–{plan.opening.close}
            </h2>
            <p className="text-[13px] leading-[18px] text-muted">
              {plan.shifts.length} people. Demo data.
            </p>
          </div>
          <div role="tablist" aria-label="Board view" className="flex shrink-0 gap-4">
            {(
              [
                ["person", "By person"],
                ["station", hasStations ? "By station" : "By task"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={mode === id}
                onClick={() => setMode(id)}
                className={`min-h-[44px] whitespace-nowrap border-b-2 text-[15px] font-semibold ${mode === id ? "border-ink text-ink" : "border-transparent text-muted"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <RotaBoard plan={{ ...plan, shifts }} mode={mode} onPerson={onPerson} />
        {mode === "person" && (
          <>
            <TaskLegend tasks={tasks} />
            <p className="mt-2 px-1 text-[13px] leading-[18px] text-muted">Tap a name for the person, a block for the station and why they have it.</p>
          </>
        )}
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* the brief's staffing plan, block by block */}
        <section aria-labelledby="blocks-h">
          <h2 id="blocks-h" className="px-1 pb-2 text-[17px] font-semibold leading-[22px]">
            Staffing by block
          </h2>
          <ul className="rounded-[14px] bg-paper px-4" data-testid="blocks">
            {plan.blocks.map((b) => {
              const short = b.scheduled < b.required;
              return (
                <li key={b.from} className="flex min-h-[48px] items-center gap-3 border-t border-rule py-2 first:border-t-0">
                  <span className="num w-[112px] shrink-0 text-[15px]">
                    {b.from}–{b.to}
                  </span>
                  <span className="flex flex-1 items-center gap-[3px]" aria-hidden>
                    {Array.from({ length: b.required }, (_, i) => (
                      <span key={i} className="h-[14px] w-[8px] rounded-[2px]" style={i < b.scheduled ? { background: "var(--ink)" } : { boxShadow: "inset 0 0 0 1.5px var(--red)" }} />
                    ))}
                  </span>
                  <span className="num shrink-0 text-right text-[15px]">
                    {short ? (
                      <span className="font-semibold text-red">
                        {b.scheduled} of {b.required}
                      </span>
                    ) : (
                      <>
                        <span className="font-semibold">{b.required}</span> {b.required === 1 ? "person" : "people"}
                      </>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="gaps-h">
          <h2 id="gaps-h" className="px-1 pb-2 text-[17px] font-semibold leading-[22px]">
            Where we&apos;re short
          </h2>
          <ul className="rounded-[14px] bg-paper px-4">
            {plan.gaps.length === 0 ? (
              <li className="flex min-h-[48px] items-center gap-2 py-3 text-[15px] text-green">
                <CheckIcon size={14} /> Every hour has enough people.
              </li>
            ) : (
              plan.gaps.map((g) => (
                <li key={g.from + g.to} className="border-t border-rule py-3 first:border-t-0">
                  <p className="num text-[15px] font-semibold">
                    {g.from}–{g.to} <span className="text-red">{g.missing} short</span>
                  </p>
                  <p className="mt-0.5 text-[15px] leading-5 text-muted">{g.reason}</p>
                </li>
              ))
            )}
          </ul>
        </section>
      </div>

      <WhyThisPlan plan={plan} />
      <AskTeam plan={plan} employees={employees} />
      <KpiCard />
      <ChangeLog changes={plan.changes} />
      <p className="px-4 text-center text-[13px] leading-[18px] text-muted">Demo data: staff, shifts and traffic are made up.</p>
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
      <ul className="mt-4 border-t border-rule" aria-label="Common reasons">
        {REASONS.map((r) => (
          <li key={r} className="border-b border-rule">
            <button onClick={() => setReason(r)} aria-pressed={reason === r} className="flex min-h-[48px] w-full items-center justify-between gap-3 text-left text-[16px]">
              {r}
              {reason === r && <CheckIcon size={16} />}
            </button>
          </li>
        ))}
      </ul>
      <label htmlFor="reject-reason" className="mt-5 block pb-1.5 text-[15px] font-semibold">
        Reason
      </label>
      <textarea
        id="reject-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
        maxLength={200}
        className="w-full resize-none rounded-[10px] bg-paper px-3 py-2.5 text-[16px] shadow-[inset_0_0_0_1px_var(--rule)] focus:shadow-[inset_0_0_0_1.5px_var(--ink)] focus:outline-none"
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
