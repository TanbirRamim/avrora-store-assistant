"use client";

import { ChevronIcon } from "./icons";
import { ALERT_LABEL, type Alerts, type Assessment, COMMS, EXPOSURE_FRONT_KM, EXPOSURE_THREAT_KM, type Exposure, GRADES, POWER, type Threats, type WarStore, ZONES } from "@/lib/wartime";

export interface Rated {
  store: WarStore;
  a: Assessment;
}

const time = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
};

const TINT: Record<keyof typeof GRADES, string> = { critical: "#fef2f2", high: "#fff7ed", elevated: "#fffbeb", low: "#f0fdf4" };

/** Risk grade as a small tinted badge. */
export function GradeBadge({ grade }: { grade: keyof typeof GRADES }) {
  const g = GRADES[grade];
  return (
    <span className="inline-flex h-[22px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-[12px] font-medium" style={{ color: g.text, background: TINT[grade] }}>
      <span className="size-1.5 rounded-full" style={{ background: g.color }} />
      {g.label}
    </span>
  );
}

const Grade = ({ a }: { a: Assessment }) => <GradeBadge grade={a.grade} />;

/** Card contents for the war-time mode of the map: store list (quick selector) or one store's details. */
export function WartimePanel({
  rated,
  alerts,
  threats,
  exposures,
  failed,
  selected,
  onSelect,
  onExposure,
}: {
  rated: Rated[] | null;
  alerts: Alerts | undefined;
  threats: Threats | undefined;
  exposures: Exposure[] | null;
  failed: boolean;
  selected: Rated | null;
  onSelect: (id: string | null) => void;
  onExposure: (x: Exposure) => void;
}) {
  // Feeds that are off stay out of the UI; only live sources are named.
  const alertLine = alerts?.connected ? `Air-raid alerts live from alerts.in.ua, ${time(alerts.fetched_at)}` : null;
  const threatLine = threats?.connected
    ? `${threats.threats.length ? `${threats.threats.length} aerial threats` : "No aerial threats"} reported, ${time(threats.fetched_at)}`
    : null;
  const nearThreat = exposures?.filter((x) => x.threatKm !== null).length ?? 0;

  if (selected) {
    const { store: s, a } = selected;
    const rows: [string, string][] = [
      ["Front line", `${a.km} km (${ZONES[a.zone].label.toLowerCase()})`],
      ...(a.alert === "unknown" ? [] : [["Air-raid alert", ALERT_LABEL[a.alert]] as [string, string]]),
      ["Shelter", s.shelter_nearby],
      ["Power", s.power_status === "generator" ? `Generator, about ${a.runtimeHours} h of fuel` : POWER[s.power_status] ?? s.power_status],
      ["Connection", COMMS[s.comms_status] ?? s.comms_status],
      ["Next delivery", s.delivery_eta],
      ["Restock first", s.priority_restock],
      ["Expect demand for", a.demand],
    ];
    return (
      <section aria-label={`War-time details for ${s.city}`}>
        <button onClick={() => onSelect(null)} className="-ml-1 flex min-h-[44px] items-center gap-1 rounded-md px-1 text-[14px] font-medium text-muted hover:text-ink">
          <span className="rotate-180">
            <ChevronIcon size={13} />
          </span>
          All stores
        </button>
        <div className="mt-1.5 flex items-start justify-between gap-3 px-1">
          <div className="min-w-0">
            <h2 className="truncate text-[17px] font-semibold leading-[22px] tracking-[-0.01em]">{s.city}</h2>
            <p className="t-footnote truncate text-[var(--text-3)]">{s.address}</p>
          </div>
          <span className="mt-0.5">
            <Grade a={a} />
          </span>
        </div>
        <p className="mt-2 rounded-[10px] border border-[var(--divider)] border-l-[3px] border-l-ink bg-[#fafafa] px-3 py-2 text-[14px] leading-[20px]">
          <span className="font-semibold">{a.mode}. </span>
          {a.directive}
        </p>
        <dl className="mt-2 max-h-[22vh] overflow-y-auto rounded-[10px] border border-[var(--border)] bg-white md:max-h-none">
          {rows.map(([k, v]) => (
            <div key={k} className="cell flex items-baseline justify-between gap-3 px-3 py-[7px] [--inset:12px]">
              <dt className="t-footnote shrink-0 text-[var(--text-3)]">{k}</dt>
              <dd className="t-footnote text-right">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
    );
  }

  return (
    <>
      {(failed || alertLine) && (
        <p className="t-footnote px-1 text-[var(--text-3)]" aria-live="polite">
          {failed ? "The war-time data could not be loaded." : alertLine}
        </p>
      )}
      {!failed && threatLine && (
        <p className="t-footnote mt-0.5 flex items-center gap-1.5 px-1 text-[var(--text-3)]">
          <span aria-hidden className="size-2 shrink-0 rounded-full bg-[#9333ea]" />
          {threatLine}
        </p>
      )}
      {rated && (
        <ul aria-label="Stores by risk" className="mt-2 max-h-[24vh] overflow-y-auto rounded-[10px] border border-[var(--border)] bg-white md:max-h-[46vh]">
          {rated.map(({ store: s, a }) => (
            <li key={s.id} className="cell [--inset:12px]">
              <button onClick={() => onSelect(s.id)} className="flex min-h-[44px] w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-[#fafafa]">
                <span className="min-w-0 flex-1">
                  <span className="t-subhead block truncate">{s.city}</span>
                  <span className="t-caption num block truncate text-[var(--text-3)]">
                    {a.km} km from the line, {a.alert === "unknown" ? a.mode : ALERT_LABEL[a.alert]}
                  </span>
                </span>
                <Grade a={a} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {exposures && (
        <section aria-label="Supply sites at risk" className="mt-3">
          <div className="flex items-baseline justify-between gap-2 px-1">
            <h3 className="num text-[14px] font-semibold">
              {exposures.length === 0 ? "No supply sites at risk" : `${exposures.length.toLocaleString("en-US")} supply ${exposures.length === 1 ? "site" : "sites"} at risk`}
            </h3>
            {nearThreat > 0 && <span className="t-caption num text-[var(--text-3)]">{nearThreat} near threats</span>}
          </div>
          <p className="t-caption px-1 text-[var(--text-3)]">
            Warehouses, logistics centres and partners within {EXPOSURE_FRONT_KM} km of the line or {EXPOSURE_THREAT_KM} km of a reported threat. The top five are ringed on the map.
          </p>
          {exposures.length > 0 && (
            <ul aria-label="Supply sites by risk" className="mt-1.5 rounded-[10px] border border-[var(--border)] bg-white">
              {exposures.slice(0, 5).map((x) => (
                <li key={x.id} className="cell [--inset:12px]">
                  <button onClick={() => onExposure(x)} className="flex min-h-[44px] w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-[#fafafa]">
                    <span className="min-w-0 flex-1">
                      <span className="t-subhead block truncate">{x.name}</span>
                      <span className="t-caption block truncate text-[var(--text-3)]">
                        {x.name === x.kind ? x.reason : `${x.kind}, ${x.reason}`}
                      </span>
                    </span>
                    <GradeBadge grade={x.grade} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
