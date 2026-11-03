/**
 * External conditions around the store: scheduled power cuts, air-raid alerts and notable weather.
 *
 * - Power: Vinnytsiaoblenergo blocks requests from outside Ukraine, so the store's queue and
 *   off windows are entered by hand in outages.json (Europe/Kyiv times).
 * - Air alerts: alerts.in.ua, only with an ALERTS_IN_UA_TOKEN. Without it there is no live feed
 *   and alerts come only from the demo simulation.
 * - Weather: Open-Meteo (no key, CC BY 4.0), reported only when it is notable for the store.
 *
 * Simulated events (POST /api/signals/simulate) live in D1 and are always marked simulated.
 */
import outages from "./outages.json";

export type SignalKind = "power" | "air_alert" | "weather";
export type Severity = "high" | "medium" | "low";

export interface ExternalSignal {
  /** Stable per event; also the push dedupe key. */
  id: string;
  kind: SignalKind;
  severity: Severity;
  title: string;
  detail: string;
  starts_at: string;
  ends_at: string | null;
  source: string;
  simulated: boolean;
}

export interface Feed {
  kind: SignalKind;
  source: string;
  live: boolean;
}

export interface ExternalEnv {
  ALERTS_IN_UA_TOKEN?: string;
}

export const STORE = { lat: 49.2331, lon: 28.4682, oblast: "Vinnytsia oblast" };
const TZ = "Europe/Kyiv";
const HOUR = 3_600_000;
/** Power cuts are shown this far ahead. */
const LOOKAHEAD = 24 * HOUR;
const CACHE_MS = 5 * 60_000;
export const POWER_SOURCE = "power company schedule (Vinnytsiaoblenergo)";
export const SIM_SOURCE = "Simulated for the demo";
const WEATHER_SOURCE = "Open-Meteo (CC BY 4.0)";
const ALERTS_SOURCE = "alerts.in.ua";

// ----------------------------------------------------------------------------- Kyiv time

function offsetMs(at: Date): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value ?? "GMT+02:00";
  const m = name.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60_000;
}

/** "2026-11-03" + "14:00" in Kyiv as a UTC Date ("24:00" is the end of the day). */
export function kyivToUtc(date: string, hhmm: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  const guess = naive - offsetMs(new Date(naive));
  return new Date(naive - offsetMs(new Date(guess)));
}

/** Calendar date in Kyiv, as YYYY-MM-DD. */
export const kyivDate = (at: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(at);

/** "14:00" in Kyiv. */
export const kyivTime = (at: Date | string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(at));

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 24 * HOUR).toISOString().slice(0, 10);

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

// ----------------------------------------------------------------------------- cache

const memo = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, now: number, load: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.value as T;
  const value = await load();
  memo.set(key, { at: now, value });
  return value;
}

// ----------------------------------------------------------------------------- power

const range = (s: Date, e: Date) => `${kyivTime(s)}–${kyivTime(e)}`;

export function powerSignal(opts: { id: string; start: Date; end: Date; now: Date; queue: string; source: string; simulated: boolean }): ExternalSignal {
  const { start, end, now } = opts;
  const active = start <= now;
  return {
    id: opts.id,
    kind: "power",
    severity: active || start.getTime() - now.getTime() <= 2 * HOUR ? "high" : "medium",
    title: active ? `Power cut until ${kyivTime(end)}` : `Power cut ${range(start, end)}`,
    detail: `Scheduled power cut for outage queue ${opts.queue}. Tills, lights and card terminals need backup power.`,
    starts_at: iso(start),
    ends_at: iso(end),
    source: opts.source,
    simulated: opts.simulated,
  };
}

/** Off windows from outages.json that are running now or start within a day. */
export function scheduledPower(now: Date, schedule = outages): ExternalSignal[] {
  const today = kyivDate(now);
  const out: ExternalSignal[] = [];
  for (const date of [addDays(today, -1), today, addDays(today, 1)]) {
    const windows = (schedule.days as Record<string, string[][] | undefined>)[date] ?? [];
    for (const [from, to] of windows) {
      const start = kyivToUtc(date, from);
      let end = kyivToUtc(date, to);
      if (end <= start) end = new Date(end.getTime() + 24 * HOUR);
      if (end <= now || start.getTime() - now.getTime() > LOOKAHEAD) continue;
      out.push(
        powerSignal({
          id: `power:${schedule.queue}:${iso(start)}`,
          start, end, now, queue: schedule.queue,
          source: schedule.example ? `${POWER_SOURCE} (example times)` : POWER_SOURCE,
          simulated: Boolean(schedule.example),
        }),
      );
    }
  }
  return out;
}

// ----------------------------------------------------------------------------- air alerts

/** Position of Vinnytsia oblast in the alerts.in.ua IoT status string. */
const VINNYTSIA_INDEX = 2;

export function alertSignal(opts: { id: string; since: Date; until?: Date | null; partial?: boolean; source: string; simulated: boolean }): ExternalSignal {
  return {
    id: opts.id,
    kind: "air_alert",
    severity: opts.partial ? "medium" : "high",
    title: opts.partial ? "Air-raid alert in part of the oblast" : "Air-raid alert",
    detail: `${STORE.oblast}, since ${kyivTime(opts.since)}. Staff and shoppers go to shelter; the floor work waits.`,
    starts_at: iso(opts.since),
    ends_at: opts.until ? iso(opts.until) : null,
    source: opts.source,
    simulated: opts.simulated,
  };
}

/** Live alert for Vinnytsia oblast. The first time an alert is seen is kept in D1 as its start. */
export async function liveAlerts(db: D1Database, now: Date, token?: string): Promise<ExternalSignal[]> {
  if (!token) return [];
  const status = await cached("alerts", now.getTime(), async () => {
    const res = await fetch("https://api.alerts.in.ua/v1/iot/active_air_raid_alerts_by_oblast.json", {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`alerts.in.ua answered ${res.status}`);
    const body = (await res.json()) as unknown;
    return String(body).charAt(VINNYTSIA_INDEX);
  });
  const region = "vinnytsia";
  if (status !== "A" && status !== "P") {
    await db.prepare("DELETE FROM alert_state WHERE region = ?").bind(region).run();
    return [];
  }
  let row = await db.prepare("SELECT status, since FROM alert_state WHERE region = ?").bind(region).first<{ status: string; since: string }>();
  if (!row) {
    row = { status, since: iso(now) };
    await db.prepare("INSERT OR REPLACE INTO alert_state VALUES (?, ?, ?)").bind(region, status, row.since).run();
  }
  return [alertSignal({ id: `air_alert:${region}:${row.since}`, since: new Date(row.since), partial: status === "P", source: ALERTS_SOURCE, simulated: false })];
}

// ----------------------------------------------------------------------------- weather

interface Daily {
  time: string[];
  temperature_2m_min: number[];
  temperature_2m_max: number[];
  wind_gusts_10m_max: number[];
  weather_code: number[];
}

const deg = (t: number) => `${Math.round(t) < 0 ? "−" : ""}${Math.abs(Math.round(t))} °C`;
const dayName = (date: string, today: string) =>
  date === today ? "Today" : new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });

/** Frost, heat or storm today or tomorrow; ordinary weather returns nothing. */
export function notableWeather(d: Daily, now: Date): ExternalSignal[] {
  const today = kyivDate(now);
  const out: ExternalSignal[] = [];
  for (let i = 0; i < Math.min(d.time.length, 2); i++) {
    const date = d.time[i];
    const base = { kind: "weather" as const, severity: "low" as const, source: WEATHER_SOURCE, simulated: false,
      starts_at: iso(kyivToUtc(date, "00:00")), ends_at: iso(kyivToUtc(addDays(date, 1), "00:00")) };
    const when = dayName(date, today);
    const gust = d.wind_gusts_10m_max[i];
    const code = d.weather_code[i];
    if (code >= 95 || gust >= 70) {
      out.push({ ...base, id: `weather:storm:${date}`, title: `Storm, gusts up to ${Math.round(gust)} km/h`,
        detail: `${when}. Storms raise the risk of unplanned power cuts; bring in outdoor displays.` });
    } else if (d.temperature_2m_min[i] <= -5) {
      out.push({ ...base, id: `weather:frost:${date}`, title: `Frost down to ${deg(d.temperature_2m_min[i])}`,
        detail: `${when}. Clear ice at the entrance; deliveries may run late on icy roads.` });
    } else if (d.temperature_2m_max[i] >= 30) {
      out.push({ ...base, id: `weather:heat:${date}`, title: `Heat up to ${deg(d.temperature_2m_max[i])}`,
        detail: `${when}. Fridges and air conditioning work harder; keep goods out of direct sun.` });
    }
  }
  return out;
}

export async function weather(now: Date): Promise<ExternalSignal[]> {
  const daily = await cached("weather", now.getTime(), async () => {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.search = new URLSearchParams({
      latitude: String(STORE.lat), longitude: String(STORE.lon), timezone: TZ, forecast_days: "2",
      daily: "temperature_2m_min,temperature_2m_max,wind_gusts_10m_max,weather_code",
    }).toString();
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Open-Meteo answered ${res.status}`);
    return ((await res.json()) as { daily: Daily }).daily;
  });
  return notableWeather(daily, now);
}

// ----------------------------------------------------------------------------- simulation

export interface SimRow {
  id: string;
  kind: "power" | "air_alert";
  starts_at: string;
  ends_at: string;
}

export function simulatedSignal(r: SimRow, now: Date): ExternalSignal {
  const start = new Date(r.starts_at);
  const end = new Date(r.ends_at);
  return r.kind === "power"
    ? powerSignal({ id: `sim:${r.id}`, start, end, now, queue: outages.queue, source: SIM_SOURCE, simulated: true })
    : alertSignal({ id: `sim:${r.id}`, since: start, until: end, source: SIM_SOURCE, simulated: true });
}

export async function simulated(db: D1Database, now: Date): Promise<ExternalSignal[]> {
  const { results } = await db
    .prepare("SELECT id, kind, starts_at, ends_at FROM simulated_signals WHERE ends_at > ? ORDER BY starts_at")
    .bind(iso(now))
    .all<SimRow>();
  return results.filter((r) => Date.parse(r.starts_at) - now.getTime() <= LOOKAHEAD).map((r) => simulatedSignal(r, now));
}

// ----------------------------------------------------------------------------- all

const RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

/** Every current signal; a failing feed is logged and skipped. */
export async function externalSignals(db: D1Database, now: Date, env: ExternalEnv): Promise<{ signals: ExternalSignal[]; feeds: Feed[] }> {
  const parts = await Promise.allSettled([
    simulated(db, now),
    Promise.resolve(scheduledPower(now)),
    liveAlerts(db, now, env.ALERTS_IN_UA_TOKEN),
    weather(now),
  ]);
  const signals: ExternalSignal[] = [];
  for (const p of parts) {
    if (p.status === "fulfilled") signals.push(...p.value);
    else console.error("external feed failed", p.reason);
  }
  signals.sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.starts_at.localeCompare(b.starts_at));
  const feeds: Feed[] = [
    { kind: "power", source: outages.example ? `${POWER_SOURCE} (example times)` : POWER_SOURCE, live: !outages.example },
    { kind: "air_alert", source: env.ALERTS_IN_UA_TOKEN ? ALERTS_SOURCE : "not connected yet, simulated only", live: Boolean(env.ALERTS_IN_UA_TOKEN) },
    { kind: "weather", source: WEATHER_SOURCE, live: parts[3].status === "fulfilled" },
  ];
  return { signals, feeds };
}
