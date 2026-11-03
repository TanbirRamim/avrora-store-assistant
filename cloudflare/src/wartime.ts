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


const MAPA_CURRENT_URL = "https://mapa.ua/api/v1/current";

export interface AerialThreat {
  id: string;
  kind: string;
  title: string;
  lat: number;
  lon: number;
  amount: number;
  status: string;
}

export type WartimeThreats =
  | { connected: true; source: "mapa.ua"; fetched_at: string; threats: AerialThreat[] }
  | { connected: false; reason: "unavailable" };

/** Public monitoring reports, reduced to the fields needed for defensive supply-chain planning. */
export async function wartimeThreats(): Promise<WartimeThreats> {
  try {
    const response = await fetch(MAPA_CURRENT_URL, {
      cf: { cacheTtl: 30, cacheEverything: true },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return { connected: false, reason: "unavailable" };
    const body = (await response.json()) as {
      objects?: Array<Partial<AerialThreat>>;
      ts?: number;
    };
    const threats = (body.objects ?? []).flatMap((item) =>
      typeof item.id === "number" || typeof item.id === "string"
        ? typeof item.lat === "number" && typeof item.lon === "number"
          ? [{
              id: String(item.id),
              kind: typeof item.kind === "string" ? item.kind : "unknown",
              title: typeof item.title === "string" ? item.title : "Active aerial threat",
              lat: item.lat,
              lon: item.lon,
              amount: typeof item.amount === "number" ? item.amount : 1,
              status: typeof item.status === "string" ? item.status : "active",
            }]
          : []
        : [],
    );
    return {
      connected: true,
      source: "mapa.ua",
      fetched_at: new Date((body.ts ?? Date.now() / 1000) * 1000).toISOString(),
      threats,
    };
  } catch {
    return { connected: false, reason: "unavailable" };
  }
}
