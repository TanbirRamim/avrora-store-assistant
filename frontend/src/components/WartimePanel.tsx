"use client";

import { ChevronIcon } from "./icons";
import { ALERT_LABEL, type Alerts, type Assessment, COMMS, GRADES, POWER, type WarStore, ZONES } from "@/lib/wartime";

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
  failed,
  selected,
  onSelect,
}: {
  rated: Rated[] | null;
  alerts: Alerts | undefined;
  failed: boolean;
  selected: Rated | null;
  onSelect: (id: string | null) => void;
}) {
  const alertLine = !alerts
    ? "Checking air-raid alerts…"
    : alerts.connected
      ? `Air-raid alerts live from alerts.in.ua, ${time(alerts.fetched_at)}`
      : "Air-raid alerts not connected. Risk uses distance only.";

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
        <button onClick={() => onSelect(null)} className="t-subhead -ml-1 flex items-center gap-0.5 rounded-md px-1 text-tint">
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
      {rated && (
        <ul aria-label="Stores by risk" className="mt-2 max-h-[24vh] overflow-y-auto rounded-[10px] bg-white md:max-h-[46vh]">
          {rated.map(({ store: s, a }) => (
            <li key={s.id} className="cell [--inset:12px]">
              <button onClick={() => onSelect(s.id)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-fill">
                <span className="min-w-0 flex-1">
                  <span className="t-subhead block truncate">{s.city}</span>
                  <span className="t-caption num block truncate text-label-2">
                    {a.km} km from the line · {ALERT_LABEL[a.alert] === "Not connected" ? a.mode : ALERT_LABEL[a.alert]}
                  </span>
                </span>
                <Grade a={a} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="t-caption mt-2 px-1 text-label-2">
        Sample stores. The front line is a hand-drawn sketch, not a live or current map.
      </p>
    </>
  );
}
