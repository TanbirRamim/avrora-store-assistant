"use client";

import { useEffect, useState } from "react";
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
  hasKey: boolean;
  lang: Lang;
  onReplan: (s: Signal) => void;
  onRevert: () => void;
}

const FEED_LABEL = { power: "Power", air_alert: "Air\u2011raid alerts", weather: "Weather" } as const;
/** Non-breaking hyphens so names like Open-Meteo never wrap mid-word. */
const nb = (t: string) => t.replace(/(\w)-(\w)/g, "$1\u2011$2");

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
  if (s.kind === "weather") return { Icon: CloudIcon, tile: "var(--move)", text: "var(--move-text)", timing: null };
  const ends = s.ends_at ? ` · ends in ${span(Date.parse(s.ends_at) - now)}` : "";
  if (s.kind === "air_alert") return { Icon: AlertIcon, tile: "var(--order)", text: "var(--order-text)", timing: `Now${ends}` };
  return active
    ? { Icon: BoltIcon, tile: "var(--order)", text: "var(--order-text)", timing: `Now${ends}` }
    : { Icon: BoltIcon, tile: "var(--discount)", text: "var(--discount-text)", timing: `Starts in ${span(Date.parse(s.starts_at) - now)}` };
}

/** Power cuts, air-raid alerts and notable weather near the store, with a re-plan for the first two. */
export function LiveConditions({ data, replan, busy, error, hasKey, lang, onReplan, onRevert }: Props) {
  const now = useNow();
  const { signals, feeds } = data;
  const alertsLive = feeds.find((f) => f.kind === "air_alert")?.live ?? false;

  if (signals.length === 0) {
    return (
      <p className="t-footnote mt-4 flex items-start gap-1.5 px-1 text-label-2" data-testid="all-clear">
        <CheckCircleIcon size={15} className="mt-[1.5px] shrink-0 text-[var(--done)]" />
        <span>
          All clear: no power cuts or severe weather ahead.
          {!alertsLive && nb(" Air-raid alerts are not connected.")}
        </span>
      </p>
    );
  }

  const target = signals.find(replannable);
  return (
    <section className="mt-6" aria-labelledby="live-title">
      <h2 id="live-title" className="group-header">Live conditions</h2>
      <ul className="group-list">
        {signals.map((s) => {
          const { Icon, tile, text, timing } = look(s, now);
          return (
            <li key={s.id} className="cell flex items-start gap-3 px-4 py-3 [--inset:58px]" data-testid="signal">
              <span className="icon-tile size-[30px]" style={{ background: tile }}>
                <Icon size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <span className="t-body">{s.title}</span>
                  {s.simulated && (
                    <span className="t-caption mt-[3px] shrink-0 rounded-full bg-fill px-2 py-px font-medium text-label-2">
                      {s.source.includes("example") ? "Example" : "Simulated"}
                    </span>
                  )}
                </div>
                <p className="t-subhead mt-0.5 text-label-2">{s.detail}</p>
                {timing && (
                  <p className="t-footnote num mt-[3px] font-medium" style={{ color: text }}>
                    {timing}
                  </p>
                )}
              </div>
            </li>
          );
        })}

        {target && !replan && (
          <li className="cell [--inset:58px]">
            <button
              type="button"
              onClick={() => onReplan(target)}
              disabled={busy}
              className="flex w-full items-center gap-3 px-4 py-[11px] text-left active:bg-fill disabled:opacity-60"
            >
              <span className="grid size-[30px] shrink-0 place-items-center text-tint">
                <SparkleIcon size={19} />
              </span>
              <span className="t-body flex-1 text-tint">{busy ? "Re-planning, about 20 seconds…" : "Re-plan for this"}</span>
              <span className="t-footnote text-label-2">{hasKey ? "OTH model" : "Rules"}</span>
            </button>
            {error && (
              <p role="alert" className="t-footnote px-4 pb-3 pl-[58px]" style={{ color: "var(--order-text)" }}>
                {error}
              </p>
            )}
          </li>
        )}

        {replan && (
          <li className="cell px-4 py-3 [--inset:58px]" data-testid="replan">
            <div className="flex items-start gap-3">
              <span className="grid size-[30px] shrink-0 place-items-center text-tint">
                <SparkleIcon size={19} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="t-body font-semibold">What changes</span>
                  <button type="button" onClick={onRevert} className="t-subhead shrink-0 text-tint">
                    Revert
                  </button>
                </div>
                <p className="t-subhead mt-0.5 whitespace-pre-line text-label-2" lang={lang} data-testid="replan-note">
                  {replan.note}
                </p>
                <p className="t-footnote mt-1.5 text-label-2">
                  {replan.source === "model" ? "Reordered by the OTH model, numbers checked." : "Ranked by rules."}
                </p>
              </div>
            </div>
          </li>
        )}
      </ul>
      <p className="group-footer">
        {nb(feeds.map((f) => `${FEED_LABEL[f.kind]}: ${f.source}.`).join(" "))}
      </p>
    </section>
  );
}
