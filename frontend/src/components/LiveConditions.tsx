"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import type { Signal, Signals } from "@/lib/api";
import type { Lang } from "@/lib/assist";
import type { Replan } from "@/lib/replan";
import { replannable } from "@/lib/replan";
import { AlertIcon, BoltIcon, CheckCircleIcon, CloudIcon, SparkleIcon } from "./icons";

interface Props {
  data: Signals;
  replan: Replan | null;
  busy: boolean;
  error: string | null;
  /** undefined while the AI status is still loading. */
  hasKey?: boolean;
  lang: Lang;
  onReplan: (s: Signal) => void;
  onRevert: () => void;
}


/** Re-renders every minute so "starts in" stays current between polls. */
function useNow(ms = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const span = (ms: number) => {
  const m = Math.max(1, Math.round(ms / 60_000));
  const h = Math.floor(m / 60);
  return h === 0 ? `${m} min` : m % 60 === 0 ? `${h} h` : `${h} h ${m % 60} min`;
};

function look(s: Signal, now: number) {
  const active = Date.parse(s.starts_at) <= now;
  if (s.kind === "weather") return { Icon: CloudIcon, tile: "#71717a", badge: "badge-neutral", timing: null };
  const ends = s.ends_at ? ` · ends in ${span(Date.parse(s.ends_at) - now)}` : "";
  if (s.kind === "air_alert") return { Icon: AlertIcon, tile: "var(--red)", badge: "badge-critical", timing: `Now${ends}` };
  return active
    ? { Icon: BoltIcon, tile: "var(--red)", badge: "badge-critical", timing: `Now${ends}` }
    : { Icon: BoltIcon, tile: "#71717a", badge: "badge-warning", timing: `Starts in ${span(Date.parse(s.starts_at) - now)}` };
}

/** Time ranges like "09:00–13:00" never split across lines. */
const RANGE = /(\d{1,2}:\d{2}\s*[–—-]\s*\d{1,2}:\d{2})/;
export function keepRanges(t: string): ReactNode {
  return t.split(RANGE).map((part, i) => (i % 2 ? <span key={i} className="nowrap">{part}</span> : <Fragment key={i}>{part}</Fragment>));
}

/** Repeated power cuts read as one row with their times; everything else keeps its own row. */
function group(signals: Signal[]) {
  const power = signals.filter((s) => s.kind === "power");
  const out: Signal[][] = [];
  for (const s of signals) {
    if (s.kind !== "power") out.push([s]);
    else if (power.length < 2) out.push([s]);
    else if (s === power[0]) out.push(power);
  }
  return out;
}


/** Power cuts, air-raid alerts and notable weather near the store, with a re-plan for the first two. */
export function LiveConditions({ data, replan, busy, error, hasKey, lang, onReplan, onRevert }: Props) {
  const now = useNow();
  const { signals } = data;

  if (signals.length === 0) {
    return (
      <p className="card t-subhead flex items-start gap-2.5 px-4 py-3 text-muted" data-testid="all-clear">
        <CheckCircleIcon size={17} className="mt-[1.5px] shrink-0 text-green" />
        <span>
          All clear: no power cuts or severe weather ahead.
        </span>
      </p>
    );
  }

  const target = signals.find(replannable);
  return (
    <section aria-labelledby="live-title">
      <div className="section-head">
        <h2 id="live-title" className="list-title">Live conditions</h2>
      </div>
      <div className="flat-list">
        <ul>
          {group(signals).map((items) => {
            const s = items[0];
            const { Icon, tile, badge: tone, timing } = look(s, now);
            const many = items.length > 1;
            return (
              <li key={s.id} className="cell flex items-start gap-3 px-4 py-3.5 [--inset:48px]" data-testid="signal">
                <span className="mt-[2px] shrink-0" style={{ color: tile }} aria-hidden>
                  <Icon size={20} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <span className="t-headline">{many ? `${items.length} power cuts` : keepRanges(s.title)}</span>
                  </div>
                  {!many && timing && (
                    <p className="num mt-1.5">
                      <span className={`badge ${tone}`}>{timing}</span>
                    </p>
                  )}
                  {many && (
                    <ul className="mt-1.5 space-y-1">
                      {items.map((p) => {
                        const l = look(p, now);
                        return (
                          <li key={p.id} className="t-footnote num flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className={`badge ${l.badge}`}>{l.timing}</span>
                            <span className="text-muted">{keepRanges(p.title.replace(/^Power cut\s*/, "").replace(/^./, (c) => c.toUpperCase()))}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <p className="t-subhead mt-1.5 text-muted">{keepRanges(s.detail)}</p>
                </div>
              </li>
            );
          })}

          {target && !replan && (
            <li className="cell [--inset:0px]">
              <button
                type="button"
                onClick={() => onReplan(target)}
                disabled={busy}
                className="flex min-h-[48px] w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[rgba(0,0,0,0.02)] active:bg-fill disabled:opacity-60"
              >
                <span className="shrink-0 text-ink" aria-hidden>
                  <SparkleIcon size={20} />
                </span>
                <span className="t-subhead flex-1 font-semibold text-ink underline-offset-4 hover:underline">{busy ? "Re-planning, about 20 seconds…" : "Re-plan for this"}</span>
                {hasKey !== undefined && <span className="t-footnote whitespace-nowrap text-muted">{hasKey ? "With AI" : "Fixed rules"}</span>}
              </button>
              {error && (
                <p role="alert" className="t-footnote px-4 pb-3 pl-[48px]" style={{ color: "var(--order-text)" }}>
                  {error}
                </p>
              )}
            </li>
          )}

          {replan && (
            <li className="cell edge-accent bg-[#fafafa] px-4 py-3.5 [--inset:0px]" data-testid="replan">
              <div className="flex items-start gap-3">
                <span className="mt-[1px] shrink-0 text-ink" aria-hidden>
                  <SparkleIcon size={20} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="t-headline">What changes</span>
                    <button type="button" onClick={onRevert} className="t-subhead inline-flex min-h-[44px] shrink-0 items-center px-1 font-semibold text-ink underline underline-offset-4">
                      Revert
                    </button>
                  </div>
                  <p className="t-subhead mt-0.5 whitespace-pre-line text-ink" lang={lang} data-testid="replan-note">
                    {replan.note}
                  </p>
                  <p className="t-footnote mt-1.5 text-muted">
                    {replan.source === "model" ? "Reordered by AI. Numbers checked against store data." : "Sorted by fixed rules, not AI."}
                  </p>
                </div>
              </div>
            </li>
          )}
        </ul>
      </div>
    </section>
  );
}
