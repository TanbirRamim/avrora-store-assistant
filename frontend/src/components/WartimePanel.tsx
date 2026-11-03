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

function Grade({ a }: { a: Assessment }) {
  const g = GRADES[a.grade];
  return (
    <span className="t-caption inline-flex shrink-0 items-center gap-1 font-semibold" style={{ color: g.text }}>
      <span className="size-2 rounded-full" style={{ background: g.color }} />
      {g.label}
    </span>
  );
}

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
  const alertLine = !alerts
    ? "Checking air-raid alerts…"
    : alerts.connected
      ? `Air-raid alerts live from alerts.in.ua, ${time(alerts.fetched_at)}`
      : "Air-raid alerts not connected. Risk uses distance only.";
  const threatLine = !threats
    ? "Checking aerial threats…"
    : threats.connected
      ? `${threats.threats.length ? `${threats.threats.length} aerial threats` : "No aerial threats"} reported, mapa.ua ${time(threats.fetched_at)}. Unofficial estimates.`
      : "Aerial threat feed not connected.";
  const nearThreat = exposures?.filter((x) => x.threatKm !== null).length ?? 0;

  if (selected) {
    const { store: s, a } = selected;
    const rows: [string, string][] = [
      ["Front line", `${a.km} km (${ZONES[a.zone].label.toLowerCase()})`],
      ["Air-raid alert", ALERT_LABEL[a.alert]],
      ["Shelter", s.shelter_nearby],
      ["Power", s.power_status === "generator" ? `Generator, about ${a.runtimeHours} h of fuel` : POWER[s.power_status] ?? s.power_status],
      ["Connection", COMMS[s.comms_status] ?? s.comms_status],
      ["Next delivery", s.delivery_eta],
      ["Restock first", s.priority_restock],
      ["Expect demand for", a.demand],
    ];
    return (
      <section aria-label={`War-time details for ${s.city}`}>
        <button onClick={() => onSelect(null)} className="t-subhead -ml-1 flex min-h-[44px] items-center gap-1 rounded-md px-1 font-semibold text-ink underline underline-offset-4">
          <span className="rotate-180">
            <ChevronIcon size={13} />
          </span>
          All stores
        </button>
        <div className="mt-1.5 flex items-start justify-between gap-3 px-1">
          <div className="min-w-0">
            <h2 className="t-headline truncate">{s.city}</h2>
            <p className="t-footnote truncate text-label-2">{s.address}</p>
          </div>
          <span className="mt-0.5">
            <Grade a={a} />
          </span>
        </div>
        <p className="t-subhead mt-2 rounded-[10px] bg-fill px-3 py-2">
          <span className="font-semibold">{a.mode}. </span>
          {a.directive}
        </p>
        <dl className="mt-2 max-h-[22vh] overflow-y-auto rounded-[10px] bg-white md:max-h-none">
          {rows.map(([k, v]) => (
            <div key={k} className="cell flex items-baseline justify-between gap-3 px-3 py-[7px] [--inset:12px]">
              <dt className="t-footnote shrink-0 text-label-2">{k}</dt>
              <dd className="t-footnote text-right">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
    );
  }

  return (
    <>
      <p className="t-footnote px-1 text-label-2" aria-live="polite">
        {failed ? "The war-time data could not be loaded." : alertLine}
      </p>
      {!failed && (
        <p className="t-footnote mt-0.5 flex items-center gap-1.5 px-1 text-label-2">
          <span aria-hidden className="size-2 shrink-0 rounded-full bg-[#af52de]" />
          {threatLine}
        </p>
      )}
      {rated && (
        <ul aria-label="Stores by risk" className="mt-2 max-h-[24vh] overflow-y-auto rounded-[10px] bg-white md:max-h-[46vh]">
          {rated.map(({ store: s, a }) => (
            <li key={s.id} className="cell [--inset:12px]">
              <button onClick={() => onSelect(s.id)} className="flex min-h-[44px] w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-fill">
                <span className="min-w-0 flex-1">
                  <span className="t-subhead block truncate">{s.city}</span>
                  <span className="t-caption num block truncate text-label-2">
                    {a.km} km from the line, {ALERT_LABEL[a.alert] === "Not connected" ? a.mode : ALERT_LABEL[a.alert]}
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
            <h3 className="t-subhead font-semibold">Supply sites at risk</h3>
            <span className="t-caption num text-label-2">
              {exposures.length.toLocaleString("en-US")}
              {nearThreat ? `, ${nearThreat} near threats` : ""}
            </span>
          </div>
          <p className="t-caption px-1 text-label-2">
            Warehouses, logistics centres and partners within {EXPOSURE_FRONT_KM} km of the line or {EXPOSURE_THREAT_KM} km of a reported threat. Ringed on the map.
          </p>
          {exposures.length > 0 && (
            <ul aria-label="Supply sites by risk" className="mt-1.5 rounded-[10px] bg-white">
              {exposures.slice(0, 5).map((x) => (
                <li key={x.id} className="cell [--inset:12px]">
                  <button onClick={() => onExposure(x)} className="flex min-h-[44px] w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-fill">
                    <span className="min-w-0 flex-1">
                      <span className="t-subhead block truncate">{x.name}</span>
                      <span className="t-caption block truncate text-label-2">
                        {x.name === x.kind ? x.reason : `${x.kind}, ${x.reason}`}
                      </span>
                    </span>
                    <span className="t-caption inline-flex shrink-0 items-center gap-1 font-semibold" style={{ color: GRADES[x.grade].text }}>
                      <span className="size-2 rounded-full" style={{ background: GRADES[x.grade].color }} />
                      {GRADES[x.grade].label}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <p className="t-caption mt-2 px-1 text-label-2">
        Sample stores. The front line is a hand-drawn sketch, not a live or current map. Supply actions are rules of thumb.
      </p>
    </>
  );
}
