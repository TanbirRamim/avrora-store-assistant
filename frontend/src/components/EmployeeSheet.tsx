"use client";

import useSWR from "swr";
import { aiRoute, useAi } from "@/lib/ai";
import { coachingNote } from "@/lib/workforce-ai";
import { SourceTag, Spark } from "./TeamInsights";
import { fetcher } from "@/lib/api";
import {
  addDays,
  dayNum,
  dayShort,
  type Employee,
  hrs,
  initials,
  nextShiftText,
  type Profile,
  profileKey,
  ROLE_LABEL,
  statusMeta,
  statusTone,
  taskMeta,
  type WeekPerf,
} from "@/lib/workforce";
import { Badge, CARD, ROW, TeamSheet } from "./TeamSheet";

export function Avatar({ id, name, size = 36 }: { id: string; name: string; size?: number }) {
  return (
    <span
      aria-hidden
      data-id={id}
      className="grid shrink-0 place-items-center rounded-full bg-[var(--neutral-bg)] font-semibold text-[#3f3f46] shadow-[inset_0_0_0_1px_var(--border)]"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
    >
      {initials(name)}
    </span>
  );
}

const METRICS: { key: keyof WeekPerf; label: string; fmt: (v: number) => string; lowerBetter?: boolean }[] = [
  { key: "items_scanned_per_hour", label: "Scan speed", fmt: (v) => `${Math.round(v)}/h` },
  { key: "cases_received_per_hour", label: "Receiving speed", fmt: (v) => `${Math.round(v)} cases/h` },
  { key: "scan_error_rate", label: "Scan errors", fmt: (v) => `${v.toFixed(1)}%`, lowerBetter: true },
  { key: "punctuality_pct", label: "On time", fmt: (v) => `${Math.round(v)}%` },
  { key: "customer_rating", label: "Rating", fmt: (v) => v.toFixed(1) },
];

const H3 = "px-1 pb-2 text-[14px] font-semibold leading-5";

export function EmployeeSheet({ id, fallback, today, onClose }: { id: string; fallback?: Employee; today: string; onClose: () => void }) {
  const { data, error } = useSWR<Profile>(profileKey(id), fetcher);
  const p: (Partial<Profile> & Employee) | undefined = data ?? fallback;
  const ai = useAi();
  const { data: coach } = useSWR(data ? ["coach", id, ai.lang, ai.hasKey] : null, () => coachingNote(data!, { key: aiRoute(), lang: ai.lang }));
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const st = p ? statusMeta(String(p.status_today)) : null;

  return (
    <TeamSheet title={p?.name ?? "Employee"} labelId="emp-title" onClose={onClose}>
      {!p ? (
        <div className="h-[420px] animate-pulse rounded-[12px] bg-[var(--neutral-bg)]" />
      ) : (
        <div className="space-y-6 pb-2">
          <section className="flex items-center gap-3.5">
            <Avatar id={p.employee_id} name={p.name} size={56} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[20px] font-semibold leading-[25px] tracking-[-0.02em]">{p.name}</div>
              <div className="text-[14px] leading-5 text-muted">
                {ROLE_LABEL[p.role] ?? p.role}
                {p.strength ? `, ${p.strength.toLowerCase()}` : ""}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="num text-[30px] font-semibold leading-9 tracking-[-0.02em]" data-testid="emp-score">
                {p.score}
              </div>
              <div className="text-[12px] leading-4 text-muted">Score</div>
            </div>
          </section>

          <dl className={`px-4 ${CARD}`}>
            <div className="flex min-h-[44px] items-center justify-between gap-3 py-2">
              <dt className="text-[14px] text-muted">Today</dt>
              <dd>
                <Badge tone={statusTone(String(p.status_today))}>{st!.label}</Badge>
              </dd>
            </div>
            <div className="flex min-h-[44px] items-center justify-between gap-3 border-t border-[var(--divider)] py-2">
              <dt className="text-[14px] text-muted">Next shift</dt>
              <dd className="num text-[14px] font-medium">{nextShiftText(p.next_shift, today)}</dd>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-3 border-t border-[var(--divider)] py-2.5">
              <dt className="text-[14px] text-muted">This week</dt>
              <dd className="num text-[14px] font-medium">
                {hrs(p.hours_this_week)} <span className="font-normal text-muted">of {p.contract_hours_week} h</span>
              </dd>
              <dd className="mt-2 h-[4px] w-full overflow-hidden rounded-full bg-[var(--neutral-bg)]" aria-hidden>
                <div className="h-full rounded-full bg-zinc-700" style={{ width: `${Math.min(100, (p.hours_this_week / Math.max(1, p.contract_hours_week)) * 100)}%` }} />
              </dd>
            </div>
          </dl>

          <section>
            <h3 className={H3}>Skills</h3>
            <ul className="flex flex-wrap gap-1.5 px-1">
              {p.skills.map((s) => {
                const m = taskMeta(s);
                return (
                  <li key={s}>
                    <Badge dot={false}>{m.label}</Badge>
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-labelledby="avail-h">
            <h3 id="avail-h" className={H3}>
              Next 7 days
            </h3>
            <ol className={`grid grid-cols-7 overflow-hidden ${CARD}`}>
              {days.map((d, i) => {
                const a = p.availability?.find((x) => x.date === d);
                const status = String(a?.status ?? "available");
                const free = status === "available" || status === "working";
                const word = free ? "Free" : status === "day_off" ? "Off" : statusMeta(status).label;
                return (
                  <li key={d} className="flex flex-col items-center gap-0.5 border-l border-[var(--divider)] py-2 text-center first:border-l-0" aria-label={`${dayShort(d)}: ${statusMeta(status).label}`}>
                    <span className="text-[12px] leading-4 text-muted">{i === 0 ? "Today" : dayShort(d)}</span>
                    <span className="num text-[15px] font-semibold leading-5">{dayNum(d)}</span>
                    <span className={`text-[11px] leading-4 ${status === "sick" ? "font-medium text-red" : free ? "text-green" : "text-muted"}`}>{word}</span>
                  </li>
                );
              })}
            </ol>
          </section>

          {data?.performance && data.performance.length > 0 ? (
            <section aria-labelledby="perf-h">
              <h3 id="perf-h" className={H3}>
                Last 12 weeks
              </h3>
              <ul className={`px-4 ${CARD}`}>
                {METRICS.map((m) => {
                  const vals = data.performance.map((w) => Number(w[m.key])).filter((v) => Number.isFinite(v));
                  if (!vals.length) return null;
                  return (
                    <li key={m.key} className={`flex min-h-[48px] items-center gap-3 py-2 ${ROW}`}>
                      <span className="min-w-0 flex-1 truncate text-[14px]">{m.label}</span>
                      <Spark values={vals} w={88} />
                      <span className="num-col w-[84px] shrink-0 text-right text-[14px] font-semibold">{m.fmt(vals[vals.length - 1])}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : error ? (
            <p className="text-[14px] text-muted">Performance history isn&apos;t available right now.</p>
          ) : (
            <div className="h-[260px] animate-pulse rounded-[12px] bg-[var(--neutral-bg)]" />
          )}

          {coach && (
            <section aria-labelledby="coach-h" data-testid="coaching">
              <div className="flex items-baseline justify-between gap-3 pr-1">
                <h3 id="coach-h" className={H3}>
                  For your next one-to-one
                </h3>
                <SourceTag source={coach.source} lang={coach.lang} error={coach.error} />
              </div>
              <div className={`px-4 ${CARD}`} lang={coach.lang}>
                {coach.strengths.length > 0 && (
                  <div className="py-3">
                    <Badge tone="success">Strengths</Badge>
                    <ul className="mt-2 space-y-1 text-[14px] leading-5">
                      {coach.strengths.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {coach.focus.length > 0 && (
                  <div className="border-t border-[var(--divider)] py-3">
                    <Badge tone="warning">Things to watch</Badge>
                    <ul className="mt-2 space-y-1 text-[14px] leading-5">
                      {coach.focus.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="border-t border-[var(--divider)] py-3 text-[14px] leading-5">{coach.note}</p>
              </div>
            </section>
          )}
          <p className="text-center text-[13px] text-muted">Demo data. Names are made up.</p>
        </div>
      )}
    </TeamSheet>
  );
}
