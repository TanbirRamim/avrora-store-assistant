"use client";

import { useState } from "react";
import useSWR from "swr";
import { aiRoute, aiStatus, useAi } from "@/lib/ai";
import { fetcher } from "@/lib/api";
import { money } from "@/lib/format";
import { type Change, changeSummary, type Employee, type Plan } from "@/lib/workforce";
import { askTeam, explainPlan, type Source, type TeamAnswer } from "@/lib/workforce-ai";
import { Badge, CARD, H2, ROW } from "./TeamSheet";

/** Where a text came from is internal; the UI no longer prints it. Kept so callers need no change. */
export function SourceTag(props: { source: Source; lang: "en" | "uk"; error?: string }) {
  void props;
  return null;
}

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** "Why this plan": the model's rewrite when a key is saved, the fixed rules otherwise. */
export function WhyThisPlan({ plan }: { plan: Plan }) {
  const ai = useAi();
  const { data } = useSWR(!ai.ready ? null : ["explain", plan.date, String(plan.version), plan.status, ai.lang, ai.hasKey], () =>
    explainPlan(plan, { key: aiRoute(), lang: ai.lang }),
  );
  const sentences = data?.sentences ?? plan.explain;
  if (!sentences.length) return null;
  return (
    <section aria-labelledby="why-h">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="why-h" className={H2}>
          Why this plan
        </h2>
      </div>
      <div className={`px-4 ${CARD}`} data-testid="why">
        <ol className="text-[14px] leading-[21px]" lang={data?.lang}>
          {sentences.map((s, i) => (
            <li key={s} className={`flex gap-3 py-3 ${ROW}`}>
              <span aria-hidden className="num w-4 shrink-0 font-medium text-muted">
                {i + 1}
              </span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
        {data && data.watchOut.length > 0 && (
          <div className="border-t border-[var(--divider)] py-3">
            <Badge tone="warning">Watch out</Badge>
            <ul className="mt-2 space-y-1 text-[14px] leading-5">
              {data.watchOut.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="border-t border-[var(--divider)] py-3 text-[13px] leading-[18px] text-muted">
          {data?.error ? "The AI answer couldn't be used, so this is the store plan. " : ""}You decide; nothing goes to staff before approval.
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
    await aiStatus();
    setAnswer(await askTeam(question.trim(), plan, employees, { key: aiRoute(), lang: ai.lang }));
    setBusy(false);
  };
  return (
    <section aria-labelledby="ask-h">
      <h2 id="ask-h" className={H2}>
        Ask about the team
      </h2>
      <div className={`p-4 ${CARD}`}>
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
            className="min-h-[44px] min-w-0 flex-1 rounded-[10px] border border-[var(--border)] bg-paper px-3 text-[16px] focus:border-ink focus:shadow-[0_0_0_3px_rgba(24,24,27,0.12)] focus:outline-none"
          />
          <button type="submit" disabled={busy || !q.trim()} className="btn-ink min-h-[44px] shrink-0 px-4 text-[15px] disabled:opacity-40">
            {busy ? "…" : "Ask"}
          </button>
        </form>
        {!answer && (
          <ul className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]" aria-label="Suggested questions">
            {SUGGESTED.map((s) => (
              <li key={s} className="shrink-0">
                <button onClick={() => void ask(s)} className="min-h-[44px] whitespace-nowrap rounded-[10px] border border-[var(--border)] bg-paper px-3.5 text-[14px] font-medium text-[#3f3f46] transition-colors duration-150 hover:bg-[var(--surface-2)] active:bg-[var(--neutral-bg)]">
                  {s}
                </button>
              </li>
            ))}
          </ul>
        )}
        {answer && (
          <div className="mt-3 border-t border-[var(--divider)] pt-3" aria-live="polite" data-testid="ask-answer">
            <p className="text-[14px] leading-[21px]" lang={answer.lang}>
              {answer.answer}
            </p>
            <div className="mt-2 flex items-center justify-between gap-3">
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

/** Thin zinc line over a few points; the last point is marked. */
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
      <path d={line(solid)} fill="none" stroke="#71717a" strokeWidth={1.25} strokeLinejoin="round" strokeLinecap="round" />
      {dashedLast && <path d={line(pts.slice(-2))} fill="none" stroke="#a1a1aa" strokeWidth={1.25} strokeDasharray="2 2" />}
      <circle cx={last[0]} cy={last[1]} r={2} fill="#18181b" />
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
      label: "Sales per staff hour",
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
        <span className="px-1 text-[12px] text-muted">This week is the plan</span>
      </div>
      <div className={`px-4 ${CARD}`} data-testid="kpi-card">
        <ul>
          {lines.map((l) => (
            <li key={l.label} className={`flex min-h-[56px] items-center gap-3 py-2 ${ROW}`}>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] leading-5">{l.label}</span>
                {l.vs && <span className="num block text-[12px] leading-4 text-muted">{l.vs}</span>}
              </span>
              <Spark values={l.vals} dashedLast />
              <span className="num-col w-[76px] shrink-0 text-right text-[15px] font-semibold">{l.value}</span>
            </li>
          ))}
        </ul>
        <p className="num border-t border-[var(--divider)] py-3 text-[13px] leading-[18px] text-muted">
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
      <ol className={`px-4 ${CARD}`} data-testid="audit">
        {[...changes].reverse().map((c, i) => (
          <li key={c.at + i} className={`flex items-start gap-3 py-3 ${ROW}`}>
            <span className="num-col w-[40px] shrink-0 text-[13px] leading-5 text-muted">{time(c.at)}</span>
            <p className="min-w-0 flex-1 text-[14px] leading-5">{changeSummary(c.summary)}</p>
            <Badge dot={false} className={c.by === "manager" ? "!bg-zinc-900 !text-white" : ""}>
              {c.by === "manager" ? "Manager" : "Agent"}
            </Badge>
          </li>
        ))}
      </ol>
    </section>
  );
}
