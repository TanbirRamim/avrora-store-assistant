/**
 * Live air-raid alerts for the map's war-time mode, from alerts.in.ua.
 *
 * Needs ALERTS_IN_UA_TOKEN (wrangler secret put ALERTS_IN_UA_TOKEN; .dev.vars locally). Without a
 * token, or when the API fails, the answer says so and the app rates stores by distance only.
 * Nothing is simulated. Mirrors GET /api/wartime/alerts in backend/src/avrora/api/main.py.
 */

const URL = "https://api.alerts.in.ua/v1/alerts/active.json";

interface Alert {
  location_title?: string;
  location_type?: string;
}

export type WartimeAlerts =
  | { connected: true; source: "alerts.in.ua"; fetched_at: string; oblasts: string[]; hromadas: string[] }
  | { connected: false; reason: "no_token" | "unavailable" };

export function summarise(alerts: Alert[], fetchedAt: string): WartimeAlerts {
  const oblasts = new Set<string>();
  const hromadas = new Set<string>();
  for (const a of alerts) {
    if (!a.location_title) continue;
    // Kyiv is a city with oblast status; the sample stores list it as their oblast
    if (a.location_type === "oblast" || a.location_type === "city") oblasts.add(a.location_title);
    else if (a.location_type === "hromada" || a.location_type === "community") hromadas.add(a.location_title);
  }
  return { connected: true, source: "alerts.in.ua", fetched_at: fetchedAt, oblasts: [...oblasts], hromadas: [...hromadas] };
}

export async function wartimeAlerts(token: string | undefined): Promise<WartimeAlerts> {
  if (!token) return { connected: false, reason: "no_token" };
  try {
    // the API asks clients not to poll more than a few times a minute; share one answer for 30 s
    const res = await fetch(URL, {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": "avrora-store-assistant" },
      cf: { cacheTtl: 30, cacheEverything: true },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { connected: false, reason: "unavailable" };
    const body = (await res.json()) as { alerts?: Alert[] };
    return summarise(body.alerts ?? [], new Date().toISOString());
  } catch {
    return { connected: false, reason: "unavailable" };
  }
}

/**
 * Aerial threats (drones, missiles, guided bombs) from mapa.ua's public feed. Positions are
 * unofficial estimates the site derives from public monitoring channels, so the app labels them
 * that way and never treats them as confirmed. Only "active" objects are passed on; lost or
 * eliminated tracks are dropped. Mirrors GET /api/wartime/threats in backend/src/avrora/api/wartime.py.
 */
const THREATS_URL = "https://mapa.ua/api/v1/current";

export interface AerialThreat {
  id: string;
  kind: string;
  lat: number;
  lon: number;
  amount: number;
  seen_at: string | null;
}

export type WartimeThreats =
  | { connected: true; source: "mapa.ua"; fetched_at: string; threats: AerialThreat[] }
  | { connected: false; reason: "unavailable" };

interface RawThreat {
  id?: unknown;
  kind?: unknown;
  status?: unknown;
  lat?: unknown;
  lon?: unknown;
  amount?: unknown;
  last_seen?: unknown;
}

export function summariseThreats(objects: RawThreat[], ts: number | undefined): WartimeThreats {
  const threats = objects.flatMap((o): AerialThreat[] =>
    o.status === "active" && typeof o.lat === "number" && typeof o.lon === "number" && (typeof o.id === "string" || typeof o.id === "number")
      ? [{
          id: String(o.id),
          kind: typeof o.kind === "string" ? o.kind : "unknown",
          lat: o.lat,
          lon: o.lon,
          amount: typeof o.amount === "number" && o.amount > 0 ? o.amount : 1,
          seen_at: typeof o.last_seen === "string" ? o.last_seen : null,
        }]
      : [],
  );
  const fetched = new Date(typeof ts === "number" ? ts * 1000 : Date.now()).toISOString();
  return { connected: true, source: "mapa.ua", fetched_at: fetched, threats };
}

export async function wartimeThreats(): Promise<WartimeThreats> {
  try {
    const res = await fetch(THREATS_URL, {
      headers: { "User-Agent": "avrora-store-assistant" },
      cf: { cacheTtl: 30, cacheEverything: true },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { connected: false, reason: "unavailable" };
    const body = (await res.json()) as { objects?: RawThreat[]; ts?: number };
    return summariseThreats(Array.isArray(body.objects) ? body.objects : [], body.ts);
  } catch {
    return { connected: false, reason: "unavailable" };
  }
}
