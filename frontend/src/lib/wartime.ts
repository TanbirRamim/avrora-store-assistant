/**
 * War-time view: risk per store from its distance to the front line and, when connected,
 * live air-raid alerts. Ported from war-map-monitor/engine (risk_scorer.py, geo_engine.py).
 *
 * Honesty notes shown in the UI:
 * - the stores are illustrative samples (public/map/wartime-stores.json);
 * - the front line is a hand-drawn sketch (public/map/wartime-lines.geojson), not live data;
 * - alerts come from alerts.in.ua only when the server has ALERTS_IN_UA_TOKEN; nothing is simulated.
 */

export const STORES_URL = "/map/wartime-stores.json";
export const LINES_URL = "/map/wartime-lines.geojson";
export const ALERTS_URL = "/api/wartime/alerts";

export interface WarStore {
  id: string;
  name: string;
  city: string;
  oblast: string;
  oblast_uk: string;
  hromada: string;
  address: string;
  lat: number;
  lon: number;
  shelter_nearby: string;
  comms_status: string;
  power_status: string;
  generator_fuel_l: number;
  delivery_eta: string;
  priority_restock: string;
}

/** Front line and border sketch (LineString) plus 25/65/120 km distance bands (kind "band", Polygon). */
export type LineFeature =
  | {
      type: "Feature";
      properties: { kind: "front" | "border"; name: string };
      geometry: { type: "LineString"; coordinates: [number, number][] };
    }
  | {
      type: "Feature";
      properties: { kind: "band"; zone: Zone; km: number };
      geometry: { type: "Polygon"; coordinates: [number, number][][] };
    };

export type Alerts =
  | { connected: true; source: string; fetched_at: string; oblasts: string[]; hromadas: string[] }
  | { connected: false; reason: string };

export type Zone = "red" | "orange" | "yellow" | "rear";
export type Grade = "critical" | "high" | "elevated" | "low";
export type AlertState = "local" | "regional" | "clear" | "unknown";

/** Distance bands in km (config.py): artillery and FPV, MLRS and glide bombs, drone corridors. */
export const ZONES: Record<Zone, { km: number; label: string; fill: string }> = {
  red: { km: 25, label: "Under 25 km", fill: "rgba(255,59,48,0.12)" },
  orange: { km: 65, label: "25–65 km", fill: "rgba(255,149,0,0.09)" },
  yellow: { km: 120, label: "65–120 km", fill: "rgba(255,204,0,0.10)" },
  rear: { km: Infinity, label: "Over 120 km", fill: "transparent" },
};

export const GRADES: Record<Grade, { label: string; color: string; text: string }> = {
  critical: { label: "Critical", color: "#ff3b30", text: "#d70015" },
  high: { label: "High", color: "#ff9500", text: "#b25000" },
  elevated: { label: "Elevated", color: "#ffcc00", text: "#8a6d00" },
  low: { label: "Low", color: "#34c759", text: "#248a3d" },
};

export interface Assessment {
  km: number;
  zone: Zone;
  alert: AlertState;
  score: number;
  grade: Grade;
  directive: string;
  mode: string;
  runtimeHours: number;
  demand: string;
}

/** Shortest distance in km from a point to a polyline (local flat projection, fine at this scale). */
export function distanceToLineKm(lat: number, lon: number, line: [number, number][]): number {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const [aLon, aLat] = line[i];
    const [bLon, bLat] = line[i + 1];
    const kx = Math.cos((((aLat + bLat + lat) / 3) * Math.PI) / 180) * 111.32;
    const ky = 111.0;
    const [px, py, ax, ay, bx, by] = [lon * kx, lat * ky, aLon * kx, aLat * ky, bLon * kx, bLat * ky];
    const dx = bx - ax;
    const dy = by - ay;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return Math.round(best * 10) / 10;
}

export function assess(store: WarStore, lines: LineFeature[], alerts: Alerts | undefined): Assessment {
  const fronts = lines.flatMap((l) => (l.properties.kind === "front" && l.geometry.type === "LineString" ? [l.geometry.coordinates] : []));
  const km = Math.min(...fronts.map((c) => distanceToLineKm(store.lat, store.lon, c)), 999);
  const zone: Zone = km <= ZONES.red.km ? "red" : km <= ZONES.orange.km ? "orange" : km <= ZONES.yellow.km ? "yellow" : "rear";

  const alert: AlertState = !alerts?.connected
    ? "unknown"
    : alerts.hromadas.includes(store.hromada)
      ? "local"
      : alerts.oblasts.includes(store.oblast_uk)
        ? "regional"
        : "clear";

  const base = { red: 60, orange: 40, yellow: 20, rear: 5 }[zone];
  const alertPoints = { local: 40, regional: 25, clear: 0, unknown: 0 }[alert];
  const nearness = Math.max(0, Math.min(30, Math.floor((150 - Math.min(km, 150)) / 5)));
  // an active alert means sheltering wherever the store is, so it never rates below "high"
  const raw = base + alertPoints + nearness;
  const score = Math.max(0, Math.min(100, alertPoints ? Math.max(raw, 60) : raw));
  const grade: Grade = score >= 80 ? "critical" : score >= 60 ? "high" : score >= 40 ? "elevated" : "low";

  let directive: string;
  let mode: string;
  if (alert === "local" || alert === "regional") {
    directive = "Air-raid alert. Stop checkout, lock the registers and take shoppers and staff to the shelter.";
    mode = "Closed, in shelter";
  } else if (zone === "red") {
    directive = "Close to the front line. Keep the shelter unlocked and check the backup connection.";
    mode = "Open, high alert";
  } else if (zone === "orange") {
    directive = "In glide-bomb range. Keep trading and react to air-raid alerts straight away.";
    mode = "Open, monitoring";
  } else {
    directive = "Rear area. Normal trading with routine civil-defence checks.";
    mode = "Normal trading";
  }

  const urgent = zone === "red" || alert === "local" || alert === "regional";
  const demand = urgent
    ? "Power banks 20k, AA/AAA batteries, 5 L water"
    : zone === "orange"
      ? "LED torches, bulbs, thermos flasks"
      : zone === "yellow"
        ? "Power banks 10k, candles, wet wipes"
        : "Usual range";

  // a 15–25 kVA generator burns about 3.2 L an hour
  const runtimeHours = Math.round((store.generator_fuel_l / 3.2) * 10) / 10;
  return { km, zone, alert, score, grade, directive, mode, runtimeHours, demand };
}

export const ALERT_LABEL: Record<AlertState, string> = {
  local: "Active in the community",
  regional: "Active in the region",
  clear: "No alert",
  unknown: "Not connected",
};

export const COMMS: Record<string, string> = { starlink: "Starlink", cellular: "Mobile network", online: "Fixed line" };
export const POWER: Record<string, string> = { grid: "Grid", generator: "Generator", blackout: "Blackout" };
