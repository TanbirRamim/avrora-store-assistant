"use client";

import { ChevronIcon } from "./icons";
import { ALERT_LABEL, type Alerts, type Assessment, COMMS, type Grade, GRADES, POWER, type ThreatFeed, type WarStore, ZONES } from "@/lib/wartime";

export interface Rated {
  store: WarStore;
  a: Assessment;
}

export interface FacilityImpact {
  id: string;
  name: string;
  category: string;
  address: string;
  coordinates: [number, number];
  frontKm: number;
  threatKm: number | null;
  threatTitle: string | null;
  grade: Grade;
  reason: string;
  recommendation: string;
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
  facilityImpacts,
  selectedFacility,
  onSelectFacility,
  threats,
}: {
  rated: Rated[] | null;
  alerts: Alerts | undefined;
  failed: boolean;
  selected: Rated | null;
  onSelect: (id: string | null) => void;
  facilityImpacts: FacilityImpact[] | null;
  selectedFacility: FacilityImpact | null;
  onSelectFacility: (id: string | null) => void;
  threats: ThreatFeed | undefined;
}) {
  const alertLine = !alerts
    ? "Checking air-raid alerts…"
    : alerts.connected
      ? `Air-raid alerts live from alerts.in.ua, ${time(alerts.fetched_at)}`
      : "Air-raid alerts not connected. Risk uses distance only.";

  if (selectedFacility) {
    const f = selectedFacility;
    const g = GRADES[f.grade];
    const rows: [string, string][] = [
      ["Type", f.category],
      ["Address", f.address || "No address in OpenStreetMap"],
      ["Coordinates", `${f.coordinates[1]}, ${f.coordinates[0]}`],
      ["Front line", `${f.frontKm} km`],
      ["Nearest active aerial threat", f.threatKm === null ? "None within 150 km" : `${f.threatKm} km · ${f.threatTitle}`],
      ["Why affected", f.reason],
    ];
    return (
      <section aria-label={`Supply-chain impact for ${f.name}`}>
        <button onClick={() => onSelectFacility(null)} className="t-subhead -ml-1 flex items-center gap-0.5 rounded-md px-1 text-tint">
          <span className="rotate-180"><ChevronIcon size={13} /></span>
          All risks
        </button>
        <div className="mt-1.5 flex items-start justify-between gap-3 px-1">
          <div className="min-w-0">
            <h2 className="t-headline truncate">{f.name}</h2>
            <p className="t-footnote truncate text-label-2">Supply-chain facility</p>
          </div>
          <span className="t-caption mt-0.5 inline-flex items-center gap-1 font-semibold" style={{ color: g.text }}>
            <span className="size-2 rounded-full" style={{ background: g.color }} />{g.label}
          </span>
        </div>
        <p className="t-subhead mt-2 rounded-[10px] bg-fill px-3 py-2">
          <span className="font-semibold">Recommended action. </span>{f.recommendation}
        </p>
        <dl className="mt-2 max-h-[30vh] overflow-y-auto rounded-[10px] bg-white">
          {rows.map(([k, v]) => (
            <div key={k} className="cell flex items-baseline justify-between gap-3 px-3 py-[7px] [--inset:12px]">
              <dt className="t-footnote shrink-0 text-label-2">{k}</dt><dd className="t-footnote text-right">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="t-caption mt-2 px-1 text-label-2">Threat positions are public monitoring reports, not confirmed strikes. Do not use this map for personal safety decisions.</p>
      </section>
    );
  }

  if (selected) {
    const { store: s, a } = selected;
    const rows: [string, string][] = [
      ["Store ID", s.id],
      ["City", s.city],
      ["Oblast", `${s.oblast} · ${s.oblast_uk}`],
      ["Hromada", s.hromada],
      ["Coordinates", `${s.lat}, ${s.lon}`],
      ["Front line", `${a.km} km (${ZONES[a.zone].label.toLowerCase()})`],
      ["Risk score", `${a.score}/100 · ${GRADES[a.grade].label}`],
      ["Operating mode", a.mode],
      ["Air-raid alert", ALERT_LABEL[a.alert]],
      ["Shelter", s.shelter_nearby],
      ["Power", s.power_status === "generator" ? `Generator, about ${a.runtimeHours} h of fuel` : POWER[s.power_status] ?? s.power_status],
      ["Generator fuel", `${s.generator_fuel_l} L`],
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
            <h2 className="t-headline truncate">{s.name}</h2>
            <p className="t-footnote truncate text-label-2">
              {s.city} · {s.address}
            </p>
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
        <div className="t-caption mt-1 space-y-0.5 px-1 text-label-2">
          <p>All {rated.length} stores available in the war-time dataset are shown.</p>
          {alerts?.connected && (
            <>
              <p>Active oblasts: {alerts.oblasts.length ? alerts.oblasts.join(", ") : "None"}</p>
              <p>Active hromadas: {alerts.hromadas.length ? alerts.hromadas.join(", ") : "None"}</p>
            </>
          )}
        </div>
      )}
      {facilityImpacts && (
        <section className="mt-2 rounded-[10px] bg-white p-2" aria-label="Supply-chain exposure">
          <div className="flex items-baseline justify-between gap-2 px-1">
            <h2 className="t-subhead">Supply-chain exposure</h2>
            <span className="t-caption num text-label-2">{facilityImpacts.length} affected</span>
          </div>
          <p className="t-caption mt-0.5 px-1 text-label-2">
            Warehouses, logistics centres and supply nodes within 120 km of the front or 150 km of an active aerial threat.
          </p>
          {threats?.connected && (
            <p className="t-caption mt-1 px-1 font-medium text-[#d70015]">
              {threats.threats.length ? `${threats.threats.length} active aerial threat reports, including drone warnings` : "No active aerial threats reported."}
            </p>
          )}
          <ul aria-label="Affected supply facilities" className="mt-1 max-h-[18vh] overflow-y-auto">
            {facilityImpacts.slice(0, 30).map((f) => (
              <li key={f.id} className="cell [--inset:8px]">
                <button onClick={() => onSelectFacility(f.id)} className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-fill">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: GRADES[f.grade].color }} />
                  <span className="min-w-0 flex-1">
                    <span className="t-caption block truncate font-semibold">{f.name}</span>
                    <span className="t-caption block truncate text-label-2">{f.reason}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {facilityImpacts.length > 30 && <p className="t-caption mt-1 px-1 text-label-2">Highest-risk 30 listed; every affected facility is marked and clickable on the map.</p>}
        </section>
      )}
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
        All available sample-store fields are shown. Store operations are illustrative; the front line is a hand-drawn sketch, not a live or current map.
      </p>
    </>
  );
}
