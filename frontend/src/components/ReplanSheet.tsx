"use client";

import { useState } from "react";
import { savedKey, useAi } from "@/lib/ai";
import { explainReplan, type ReplanExplanation } from "@/lib/workforce-ai";
import { SourceTag } from "./TeamInsights";
import { money } from "@/lib/format";
import { type Employee, EVENT_HOURS, type Plan, type ReplanEvent, workforce } from "@/lib/workforce";
import { Avatar } from "./EmployeeSheet";
import { ChevronIcon } from "./icons";
import { primaryBtn, secondaryBtn, TeamSheet } from "./TeamSheet";

const endOf = (kind: keyof typeof EVENT_HOURS, from: string) => `${String(Math.min(21, Number(from.slice(0, 2)) + EVENT_HOURS[kind])).padStart(2, "0")}:00`;
type Kind = ReplanEvent["kind"];

const OPTIONS: { kind: Kind; label: string; hint: string }[] = [
  { kind: "sick", label: "Someone's off sick", hint: "Find cover for their shift" },
  { kind: "air_alert", label: "Air-raid alert", hint: "Store closes, staff to shelter for 2 h" },
  { kind: "power", label: "Power cut", hint: "Fewer tills, slower checkout for 4 h" },
  { kind: "traffic_spike", label: "Busier than expected", hint: "Add people for the next 3 h" },
];

const HOURS = Array.from({ length: 13 }, (_, i) => `${String(8 + i).padStart(2, "0")}:00`);

const fieldCls =
  "num min-h-[48px] w-full rounded-[10px] bg-paper px-3 text-[16px] shadow-[inset_0_0_0_1.5px_var(--ink)] focus-visible:outline-offset-2";

export function ReplanSheet({
  plan,
  employees,
  onClose,
  onApproved,
}: {
  plan: Plan;
  employees: Employee[];
  onClose: () => void;
  onApproved: (next: Plan, at: string) => void;
}) {
  const [kind, setKind] = useState<Kind | null>(null);
  const working = plan.shifts.map((s) => s.employee_id);
  const [emp, setEmp] = useState<string>(plan.shifts[0]?.employee_id ?? "");
  const [from, setFrom] = useState("12:00");
  const [proposal, setProposal] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ai = useAi();
  const [story, setStory] = useState<ReplanExplanation | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
    } catch {
      setCopied(null);
    }
  };

  const event = (): ReplanEvent | null => {
    if (kind === "sick") return emp ? { kind, employee_id: emp } : null;
    if (kind) return { kind, from };
    return null;
  };

  const propose = async () => {
    const ev = event();
    if (!ev) return;
    setBusy(true);
    setError(null);
    try {
      const next = await workforce.replan(plan.date, ev);
      setProposal(next);
      void explainReplan(plan, next, next.diff ?? [], { key: savedKey(), lang: ai.lang }).then(setStory);
    } catch {
      setError("Couldn't work out a new plan. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    if (!proposal) return;
    setBusy(true);
    setError(null);
    try {
      const r = await workforce.approve(proposal.date, proposal.version);
      onApproved(proposal, r.at);
    } catch {
      setError("Couldn't save the approval. Try again.");
      setBusy(false);
    }
  };

  const delta = (a: number, b: number, fmt: (n: number) => string) => {
    const d = b - a;
    if (Math.abs(d) < 0.05) return "no change";
    return `${d > 0 ? "+" : "−"}${fmt(Math.abs(d))}`;
  };

  const footer = proposal ? (
    <div className="flex gap-3">
      <button type="button" onClick={onClose} disabled={busy} className={secondaryBtn}>
        Keep current
      </button>
      <button type="button" onClick={() => void approve()} disabled={busy} className={primaryBtn}>
        {busy ? "Saving…" : "Approve"}
      </button>
    </div>
  ) : (
    <button type="button" onClick={() => void propose()} disabled={!kind || busy || !event()} className={`${primaryBtn} w-full`}>
      {busy ? "Working it out…" : "Show new plan"}
    </button>
  );

  const off = (t: string) => /^(off|day off|—|-)$/i.test(t.trim()) || /\boff\b|sick/i.test(t);
  const pretty = (t: string) => (off(t) ? "Off" : t);

  return (
    <TeamSheet title={proposal ? "Proposed plan" : "Something changed"} labelId="replan-title" onClose={onClose} footer={footer} wide>
      {!proposal ? (
        <div className="space-y-5 pb-2">
          <p className="t-subhead text-muted">Tell the agent what happened. It drafts a new plan; nothing changes until you approve it.</p>
          <fieldset>
            <legend className="sr-only">What happened</legend>
            <div className="border-y border-rule">
              {OPTIONS.map((o) => (
                <label key={o.kind} className="flex min-h-[60px] cursor-pointer items-center gap-3 border-t border-rule py-2 first:border-t-0">
                  <input type="radio" name="replan-kind" value={o.kind} checked={kind === o.kind} onChange={() => setKind(o.kind)} className="peer sr-only" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[17px] leading-[22px]">{o.label}</span>
                    <span className="block text-[13px] leading-[18px] text-muted">{o.hint}</span>
                  </span>
                  <span
                    aria-hidden
                    className="grid size-[24px] shrink-0 place-items-center rounded-full shadow-[inset_0_0_0_1.5px_var(--ink)] peer-checked:bg-ink peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink [&>span]:opacity-0 peer-checked:[&>span]:opacity-100"
                  >
                    <span className="size-2 rounded-full bg-white" />
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {kind === "sick" && (
            <div>
              <label htmlFor="replan-emp" className="block pb-1.5 text-[15px] font-semibold">
                Who called in sick?
              </label>
              <select id="replan-emp" value={emp} onChange={(e) => setEmp(e.target.value)} className={fieldCls}>
                {employees
                  .filter((e) => working.includes(e.employee_id))
                  .map((e) => (
                    <option key={e.employee_id} value={e.employee_id}>
                      {e.name}
                    </option>
                  ))}
                {employees.length === 0 &&
                  plan.shifts.map((s) => (
                    <option key={s.employee_id} value={s.employee_id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </div>
          )}
          {kind && kind !== "sick" && (
            <div>
              <label htmlFor="replan-from" className="block pb-1.5 text-[15px] font-semibold">
                Starts at
              </label>
              <div className="flex items-center gap-3">
                <select id="replan-from" value={from} onChange={(e) => setFrom(e.target.value)} className={`${fieldCls} max-w-[140px]`}>
                  {HOURS.map((h) => (
                    <option key={h}>{h}</option>
                  ))}
                </select>
                <span className="num text-[15px] text-muted" data-testid="replan-window">
                  until {endOf(kind, from)}, {EVENT_HOURS[kind]} h
                </span>
              </div>
            </div>
          )}
          {error && (
            <p role="alert" className="t-subhead font-semibold text-red">
              {error}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-6 pb-2" data-testid="replan-proposal">
          <section aria-label="Before and after">
            <dl className="border-y border-rule">
              {(
                [
                  ["Coverage", `${plan.kpis.coverage_pct}%`, `${proposal.kpis.coverage_pct}%`, delta(plan.kpis.coverage_pct, proposal.kpis.coverage_pct, (n) => `${n.toFixed(1)} pt`)],
                  ["Labour hours", `${plan.kpis.labour_hours}`, `${proposal.kpis.labour_hours}`, delta(plan.kpis.labour_hours, proposal.kpis.labour_hours, (n) => `${n} h`)],
                  ["Labour cost", money(plan.kpis.labour_cost_uah), money(proposal.kpis.labour_cost_uah), delta(plan.kpis.labour_cost_uah, proposal.kpis.labour_cost_uah, money)],
                ] as const
              ).map(([k, before, after, d]) => (
                <div key={k} className="flex min-h-[48px] items-center gap-3 border-t border-rule py-2 first:border-t-0">
                  <dt className="flex-1 text-[15px]">{k}</dt>
                  <dd className="num flex items-center gap-1.5 text-[15px]">
                    <span className="text-muted">{before}</span>
                    <ChevronIcon size={11} className="text-muted" />
                    <span className="font-semibold">{after}</span>
                  </dd>
                  <dd className="num w-[84px] shrink-0 text-right text-[13px] text-muted">{d}</dd>
                </div>
              ))}
            </dl>
          </section>

          {story?.summary && (
            <section data-testid="replan-summary">
              <p className="text-[16px] leading-[22px]" lang={story.lang}>
                {story.summary}
              </p>
              <div className="mt-1">
                <SourceTag source={story.source} lang={story.lang} error={story.error} />
              </div>
            </section>
          )}

          <section aria-labelledby="diff-h">
            <div className="flex items-baseline justify-between gap-3 pb-2">
              <h3 id="diff-h" className="text-[15px] font-semibold">
                Who changes
              </h3>
              <span className="num text-[13px] text-muted">{proposal.diff?.length ?? 0}</span>
            </div>
            <ul className="border-y border-rule">
              {(proposal.diff ?? []).map((d) => {
                const removed = off(d.after) && !off(d.before);
                const added = off(d.before) && !off(d.after);
                const same = d.before === d.after;
                const tag = removed ? ["Out", "var(--red)"] : added ? ["Called in", "var(--green)"] : same ? ["New tasks", "var(--muted)"] : ["Longer shift", "var(--ink)"];
                const m = story?.messages.find((x) => x.employee_id === d.employee_id);
                return (
                  <li key={d.employee_id} className="flex items-start gap-3 border-t border-rule py-3 first:border-t-0">
                    <Avatar id={d.employee_id} name={d.name} size={36} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[17px] font-semibold leading-[22px]">{d.name}</span>
                        <span className="shrink-0 whitespace-nowrap text-[13px] font-semibold" style={{ color: tag[1] }}>
                          {tag[0]}
                        </span>
                      </div>
                      <div className="num mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[15px]">
                        {same ? (
                          <span className="font-semibold">{pretty(d.after)}</span>
                        ) : (
                          <>
                            <span className="whitespace-nowrap text-muted line-through decoration-muted/60">{pretty(d.before)}</span>
                            <ChevronIcon size={11} className="text-muted" />
                            <span className="whitespace-nowrap font-semibold">{pretty(d.after)}</span>
                          </>
                        )}
                      </div>
                      <p className="mt-1 text-[13px] leading-[18px] text-muted">{d.why}</p>
                      {m && (
                        <div className="mt-2 border-l-2 border-ink pl-3">
                          <p className="t-subhead" lang={story?.lang}>
                            {m.text}
                          </p>
                          <button type="button" onClick={() => void copy(d.employee_id, m.text)} aria-label={`Copy message to ${d.name}`} className="btn-text -ml-1 text-[13px]">
                            {copied === d.employee_id ? "Copied" : "Copy message"}
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
              {(proposal.diff ?? []).length === 0 && <li className="t-subhead py-4 text-muted">No one needs to move. The current plan still works.</li>}
            </ul>
          </section>

          {proposal.explain.length > 0 && (
            <section aria-labelledby="pwhy-h">
              <h3 id="pwhy-h" className="pb-2 text-[15px] font-semibold">
                Why
              </h3>
              <ol className="border-y border-rule text-[15px] leading-5">
                {proposal.explain.map((s, i) => (
                  <li key={s} className="flex gap-3 border-t border-rule py-2.5 first:border-t-0">
                    <span aria-hidden className="num w-4 shrink-0 font-semibold text-muted">
                      {i + 1}
                    </span>
                    {s}
                  </li>
                ))}
              </ol>
            </section>
          )}
          <p className="text-[13px] leading-[18px] text-muted">Messages are never sent for you; copy them into your team chat. Nothing changes until you approve. Keep current leaves the plan as it is.</p>
          {error && (
            <p role="alert" className="t-subhead font-semibold text-red">
              {error}
            </p>
          )}
        </div>
      )}
    </TeamSheet>
  );
}
