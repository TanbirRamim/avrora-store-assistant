"use client";

import useSWR from "swr";
import { savedKey, useAi } from "@/lib/ai";
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
  taskMeta,
  type WeekPerf,
} from "@/lib/workforce";
import { TeamSheet } from "./TeamSheet";

export function Avatar({ id, name, size = 36 }: { id: string; name: string; size?: number }) {
  return (
    <span
      aria-hidden
      data-id={id}
      className="grid shrink-0 place-items-center rounded-full bg-floor font-semibold text-ink shadow-[inset_0_0_0_1px_var(--rule)]"
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

const H3 = "pb-2 text-[15px] font-semibold leading-5";

export function EmployeeSheet({ id, fallback, today, onClose }: { id: string; fallback?: Employee; today: string; onClose: () => void }) {
  const { data, error } = useSWR<Profile>(profileKey(id), fetcher);
  const p: (Partial<Profile> & Employee) | undefined = data ?? fallback;
  const ai = useAi();
  const { data: coach } = useSWR(data ? ["coach", id, ai.lang, ai.hasKey] : null, () => coachingNote(data!, { key: savedKey(), lang: ai.lang }));
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const st = p ? statusMeta(String(p.status_today)) : null;

  return (
    <TeamSheet title={p?.name ?? "Employee"} labelId="emp-title" onClose={onClose}>
      {!p ? (
        <div className="h-[420px] animate-pulse rounded-[14px] bg-fill" />
      ) : (
        <div className="space-y-6 pb-2">
          <section className="flex items-center gap-3.5">
            <Avatar id={p.employee_id} name={p.name} size={56} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[20px] font-semibold leading-[25px]">{p.name}</div>
              <div className="text-[15px] leading-5 text-muted">{ROLE_LABEL[p.role] ?? p.role}</div>
              {p.strength && <div className="text-[15px] leading-5">{p.strength}</div>}
            </div>
            <div className="shrink-0 text-right">
              <div className="font-display num text-[28px] font-bold leading-8" data-testid="emp-score">
                {p.score}
              </div>
              <div className="text-[13px] leading-[18px] text-muted">Score</div>
            </div>
          </section>

          <dl className="border-y border-rule">
            <div className="flex min-h-[44px] items-center justify-between gap-3 py-2">
              <dt className="text-[15px] text-muted">Today</dt>
              <dd className="flex items-center gap-1.5 text-[15px] font-semibold" style={{ color: p.status_today === "sick" ? "var(--red)" : p.status_today === "working" ? "var(--green)" : undefined }}>
                <span aria-hidden className="size-2 rounded-full" style={{ background: st!.color }} />
                {st!.label}
              </dd>
            </div>
            <div className="flex min-h-[44px] items-center justify-between gap-3 border-t border-rule py-2">
              <dt className="text-[15px] text-muted">Next shift</dt>
              <dd className="num text-[15px] font-semibold">{nextShiftText(p.next_shift, today)}</dd>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-3 border-t border-rule py-2.5">
              <dt className="text-[15px] text-muted">This week</dt>
              <dd className="num text-[15px] font-semibold">
                {hrs(p.hours_this_week)} <span className="font-normal text-muted">of {p.contract_hours_week} h</span>
              </dd>
              <dd className="mt-2 h-[4px] w-full overflow-hidden rounded-full bg-rule" aria-hidden>
                <div className="h-full rounded-full bg-ink" style={{ width: `${Math.min(100, (p.hours_this_week / Math.max(1, p.contract_hours_week)) * 100)}%` }} />
              </dd>
            </div>
          </dl>

          <section>
            <h3 className={H3}>Skills</h3>
            <ul className="flex flex-wrap gap-x-4 gap-y-2">
              {p.skills.map((s) => {
                const m = taskMeta(s);
                return (
                  <li key={s} className="flex items-center gap-1.5 whitespace-nowrap text-[15px]">
                    <span aria-hidden className="grid h-[16px] w-[18px] place-items-center rounded-[3px] text-[10px] font-bold" style={{ background: m.color, color: m.fg, boxShadow: m.outline ? "inset 0 0 0 1.5px var(--ink)" : undefined }}>
                      {m.code}
                    </span>
                    {m.label}
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-labelledby="avail-h">
            <h3 id="avail-h" className={H3}>
              Next 7 days
            </h3>
            <ol className="grid grid-cols-7 border-y border-rule">
              {days.map((d, i) => {
                const a = p.availability?.find((x) => x.date === d);
                const status = String(a?.status ?? "available");
                const free = status === "available" || status === "working";
                const word = free ? "Free" : status === "day_off" ? "Off" : statusMeta(status).label;
                return (
                  <li key={d} className="flex flex-col items-center gap-1 border-l border-rule py-2 text-center first:border-l-0" aria-label={`${dayShort(d)}: ${statusMeta(status).label}`}>
                    <span className="text-[12px] leading-4 text-muted">{i === 0 ? "Today" : dayShort(d)}</span>
                    <span className="num text-[15px] font-semibold leading-5">{dayNum(d)}</span>
                    <span className={`text-[12px] leading-4 ${status === "sick" ? "font-semibold text-red" : free ? "text-ink" : "text-muted"}`}>{word}</span>
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
              <ul className="border-y border-rule">
                {METRICS.map((m) => {
                  const vals = data.performance.map((w) => Number(w[m.key])).filter((v) => Number.isFinite(v));
                  if (!vals.length) return null;
                  return (
                    <li key={m.key} className="flex min-h-[48px] items-center gap-3 border-t border-rule py-2 first:border-t-0">
                      <span className="flex-1 text-[15px]">{m.label}</span>
                      <Spark values={vals} w={96} />
                      <span className="num w-[84px] shrink-0 text-right text-[15px] font-semibold">{m.fmt(vals[vals.length - 1])}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : error ? (
            <p className="t-subhead text-muted">Performance history isn&apos;t available right now.</p>
          ) : (
            <div className="h-[260px] animate-pulse rounded-[14px] bg-fill" />
          )}

          {coach && (
            <section aria-labelledby="coach-h" data-testid="coaching">
              <div className="flex items-baseline justify-between gap-3">
                <h3 id="coach-h" className={H3}>
                  For your next one-to-one
                </h3>
                <SourceTag source={coach.source} lang={coach.lang} error={coach.error} />
              </div>
              <div className="border-y border-rule" lang={coach.lang}>
                {coach.strengths.length > 0 && (
                  <div className="py-3">
                    <h4 className="text-[13px] font-semibold text-green">Strengths</h4>
                    <ul className="t-subhead mt-1 space-y-1">
                      {coach.strengths.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {coach.focus.length > 0 && (
                  <div className="border-t border-rule py-3">
                    <h4 className="text-[13px] font-semibold text-orange">Things to watch</h4>
                    <ul className="t-subhead mt-1 space-y-1">
                      {coach.focus.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="t-subhead border-t border-rule py-3">{coach.note}</p>
              </div>
            </section>
          )}
          <p className="text-center text-[13px] text-muted">Demo data. Names are made up.</p>
        </div>
      )}
    </TeamSheet>
  );
}
