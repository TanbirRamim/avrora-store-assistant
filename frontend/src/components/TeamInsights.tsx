"use client";

import { useState } from "react";
import useSWR from "swr";
import { savedKey, useAi } from "@/lib/ai";
import { fetcher } from "@/lib/api";
import { money } from "@/lib/format";
import type { Change, Employee, Plan } from "@/lib/workforce";
import { askTeam, explainPlan, SOURCE_LABEL, type Source, type TeamAnswer } from "@/lib/workforce-ai";
import { SparkleIcon } from "./icons";

export function SourceTag({ source, lang, error }: { source: Source; lang: "en" | "uk"; error?: string }) {
  return (
    <span className="t-footnote inline-flex items-center gap-1.5 text-label-2" title={error}>
      <SparkleIcon size={13} />
      {SOURCE_LABEL[lang][source]}
    </span>
  );
}

const H2 = "px-1 pb-2 text-[17px] font-semibold leading-[22px]";
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** "Why this plan": the model's rewrite when a key is saved, the fixed rules otherwise. */
export function WhyThisPlan({ plan }: { plan: Plan }) {
  const ai = useAi();
  const { data } = useSWR(["explain", plan.date, String(plan.version), plan.status, ai.lang, ai.hasKey], () =>
    explainPlan(plan, { key: savedKey(), lang: ai.lang }),
  );
  const sentences = data?.sentences ?? plan.explain;
  if (!sentences.length) return null;
  return (
    <section aria-labelledby="why-h">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="why-h" className={H2}>
          Why this plan
        </h2>
        {data && <SourceTag source={data.source} lang={data.lang} error={data.error} />}
      </div>
      <div className="rounded-[14px] bg-paper px-4 py-1" data-testid="why">
        <ol className="text-[16px] leading-[22px]" lang={data?.lang}>
          {sentences.map((s, i) => (
            <li key={s} className="flex gap-3 border-t border-rule py-3 first:border-t-0">
              <span aria-hidden className="num w-4 shrink-0 font-semibold text-muted">
                {i + 1}
              </span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
        {data && data.watchOut.length > 0 && (
          <div className="border-t border-rule py-3">
            <h3 className="text-[15px] font-semibold text-orange">Watch out</h3>
            <ul className="t-subhead mt-1 space-y-1">
              {data.watchOut.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="border-t border-rule py-3 text-[13px] leading-[18px] text-muted">
          {data?.error ? "The AI answer couldn't be used, so fixed rules wrote this. " : ""}You decide; nothing goes to staff before approval.
        </p>
      </div>
    </section>
  );
}

const SUGGESTED = ["Who can cover the evening?", "Who is fastest on the till?", "Why are we short at 18:00?"];

/** Ask a question about today's team; answered from the plan and staff data only. */
export function AskTeam({ plan, employees }: { plan: Plan; employees: Employee[] }) {
  const ai = useAi();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<TeamAnswer | null>(null);
  const ask = async (question: string) => {
    if (!question.trim()) return;
    setQ(question);
    setBusy(true);
    setAnswer(await askTeam(question.trim(), plan, employees, { key: savedKey(), lang: ai.lang }));
    setBusy(false);
  };
  return (
    <section aria-labelledby="ask-h">
      <h2 id="ask-h" className={H2}>
        Ask about the team
      </h2>
      <div className="rounded-[14px] bg-paper p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ask(q);
          }}
          className="flex gap-2"
        >
          <label htmlFor="ask-team" className="sr-only">
            Question about the team
          </label>
          <input
            id="ask-team"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Who can stay late tonight?"
            maxLength={200}
            enterKeyHint="send"
            className="min-h-[48px] min-w-0 flex-1 rounded-[999px] bg-floor px-4 text-[16px] focus:shadow-[inset_0_0_0_1.5px_var(--ink)] focus:outline-none"
          />
          <button type="submit" disabled={busy || !q.trim()} className="btn-ink shrink-0 px-5 disabled:opacity-40">
            {busy ? "…" : "Ask"}
          </button>
        </form>
        {!answer && (
          <ul className="-mx-1 mt-2 flex gap-x-4 overflow-x-auto px-1 [scrollbar-width:none]" aria-label="Suggested questions">
            {SUGGESTED.map((s) => (
              <li key={s} className="shrink-0">
                <button onClick={() => void ask(s)} className="min-h-[44px] whitespace-nowrap text-[15px] font-medium underline decoration-rule underline-offset-4 active:opacity-60">
                  {s}
                </button>
              </li>
            ))}
          </ul>
        )}
        {answer && (
          <div className="mt-3 border-t border-rule pt-3" aria-live="polite" data-testid="ask-answer">
            <p className="text-[16px] leading-[22px]" lang={answer.lang}>
              {answer.answer}
            </p>
            <div className="mt-2 flex items-center justify-between gap-3">
              <SourceTag source={answer.source} lang={answer.lang} error={answer.error} />
              <button onClick={() => (setAnswer(null), setQ(""))} className="btn-text">
                New question
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

interface KpiWeek {
  week_start: string;
  source: string;
  coverage_pct: number;
  labour_hours: number;
  sales_per_labour_hour_uah: number;
}
interface Kpis {
  weeks: KpiWeek[];
  this_week: KpiWeek;
  decisions: { approved: number; rejected: number; replans: number; approval_rate_pct: number | null };
}

/** Thin ink line over a few points; the last point is marked. */
export function Spark({ values, w = 72, h = 22, dashedLast = false }: { values: number[]; w?: number; h?: number; dashedLast?: boolean }) {
  if (values.length < 2) return <svg width={w} height={h} aria-hidden />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const r = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (w - 6) + 3, h - 3 - ((v - min) / r) * (h - 6)] as const);
  const line = (p: readonly (readonly [number, number])[]) => p.map((q, i) => `${i ? "L" : "M"}${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(" ");
  const solid = dashedLast ? pts.slice(0, -1) : pts;
  const last = pts[pts.length - 1];
  return (
    <svg width={w} height={h} aria-hidden className="shrink-0">
      <path d={line(solid)} fill="none" stroke="var(--ink)" strokeWidth={1.25} strokeLinejoin="round" strokeLinecap="round" />
      {dashedLast && <path d={line(pts.slice(-2))} fill="none" stroke="var(--ink)" strokeWidth={1.25} strokeDasharray="2 2" />}
      <circle cx={last[0]} cy={last[1]} r={2.25} fill="var(--ink)" />
    </svg>
  );
}

/** The brief's KPI feedback as a compact list: the last 4 weeks, then this week's plan. */
export function KpiCard() {
  const { data } = useSWR<Kpis>("/api/workforce/kpis", fetcher);
  if (!data) return null;
  const rows = [...data.weeks, data.this_week];
  const prev = data.weeks[data.weeks.length - 1];
  const delta = (a: number, b: number, f: (n: number) => string) => (prev ? `${b - a >= 0 ? "+" : "−"}${f(Math.abs(b - a))} vs last week` : "");
  const lines: { label: string; value: string; vs: string; vals: number[] }[] = [
    {
      label: "Coverage",
      value: `${data.this_week.coverage_pct}%`,
      vs: prev ? delta(prev.coverage_pct, data.this_week.coverage_pct, (n) => `${n.toFixed(1)} pt`) : "",
      vals: rows.map((r) => r.coverage_pct),
    },
    {
      label: "Sales per labour hour",
      value: money(data.this_week.sales_per_labour_hour_uah),
      vs: prev ? delta(prev.sales_per_labour_hour_uah, data.this_week.sales_per_labour_hour_uah, money) : "",
      vals: rows.map((r) => r.sales_per_labour_hour_uah),
    },
    {
      label: "Labour hours",
      value: `${Math.round(data.this_week.labour_hours)} h`,
      vs: prev ? delta(prev.labour_hours, data.this_week.labour_hours, (n) => `${Math.round(n)} h`) : "",
      vals: rows.map((r) => r.labour_hours),
    },
  ];
  return (
    <section aria-labelledby="kpi-h">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="kpi-h" className={H2}>
          Last 4 weeks
        </h2>
        <span className="px-1 text-[13px] text-muted">This week is the plan</span>
      </div>
      <div className="rounded-[14px] bg-paper px-4" data-testid="kpi-card">
        <ul>
          {lines.map((l) => (
            <li key={l.label} className="flex min-h-[56px] items-center gap-3 border-t border-rule py-2 first:border-t-0">
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] leading-5">{l.label}</span>
                {l.vs && <span className="num block text-[13px] leading-[18px] text-muted">{l.vs}</span>}
              </span>
              <Spark values={l.vals} dashedLast />
              <span className="num w-[76px] shrink-0 text-right text-[17px] font-semibold">{l.value}</span>
            </li>
          ))}
        </ul>
        <p className="num border-t border-rule py-3 text-[13px] leading-[18px] text-muted">
          Decisions in 28 days: {data.decisions.approved} approved, {data.decisions.rejected} rejected, {data.decisions.replans} replans.
        </p>
      </div>
    </section>
  );
}

/** Audit trail: who changed the plan and when, newest first. */
export function ChangeLog({ changes }: { changes: Change[] }) {
  return (
    <section aria-labelledby="audit-h">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="audit-h" className={H2}>
          Change log
        </h2>
        <span className="num px-1 text-[13px] text-muted">{changes.length}</span>
      </div>
      <ol className="rounded-[14px] bg-paper px-4" data-testid="audit">
        {[...changes].reverse().map((c, i) => (
          <li key={c.at + i} className="flex gap-3 border-t border-rule py-3 first:border-t-0">
            <span className="num w-[44px] shrink-0 text-[15px] leading-5 text-muted">{time(c.at)}</span>
            <div className="min-w-0">
              <p className="text-[15px] leading-5">{c.summary}</p>
              <p className={`text-[13px] leading-[18px] ${c.by === "manager" ? "font-semibold text-ink" : "text-muted"}`}>{c.by === "manager" ? "Manager" : "Agent"}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
