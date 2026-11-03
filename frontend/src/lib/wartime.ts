/**
 * War-time view: risk per store from its distance to the front line and, when connected,
 * live air-raid alerts. Ported from war-map-monitor/engine (risk_scorer.py, geo_engine.py).
 *
 * Honesty notes shown in the UI:
 * - the stores are illustrative samples (public/map/wartime-stores.json);
 * - the front line is a hand-drawn sketch (public/map/wartime-lines.geojson), not live data;
 * - alerts come from alerts.in.ua only when the server has ALERTS_IN_UA_TOKEN; nothing is simulated;
 * - aerial threats come from mapa.ua's public feed: unofficial position estimates, not confirmed strikes.
 */

export const STORES_URL = "/map/wartime-stores.json";
export const LINES_URL = "/map/wartime-lines.geojson";
export const ALERTS_URL = "/api/wartime/alerts";
export const THREATS_URL = "/api/wartime/threats";
export const BORDER_URL = "/map/ukraine-border.geojson";

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

export interface AerialThreat {
  id: string;
  kind: string;
  lat: number;
  lon: number;
  amount: number;
  seen_at: string | null;
}

export type Threats =
  | { connected: true; source: string; fetched_at: string; threats: AerialThreat[] }
  | { connected: false; reason: string };

/** mapa.ua object kinds in plain words; anything new falls back to "Aerial threat". */
export const THREAT_KIND: Record<string, string> = {
  drone_jet: "Jet drone",
  drone_piston: "Attack drone",
  drone_fpv: "FPV drone",
  missile: "Missile",
  missile_ballistic: "Ballistic missile",
  missile_cruise: "Cruise missile",
  bomb: "Guided bomb",
};
export const threatKind = (k: string) => THREAT_KIND[k] ?? "Aerial threat";

/** Great-circle distance in km between two [lon, lat] points. */
export function haversineKm([aLon, aLat]: [number, number], [bLon, bLat]: [number, number]): number {
  const r = Math.PI / 180;
  const h = Math.sin(((bLat - aLat) * r) / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLon - aLon) * r) / 2) ** 2;
  return Math.round(12742 * Math.asin(Math.sqrt(h)) * 10) / 10;
}

/** A distribution site (warehouse, logistics centre, supply partner) inside a risk radius. */
export interface Exposure {
  id: string;
  name: string;
  kind: string;
  coordinates: [number, number];
  frontKm: number;
  threatKm: number | null;
  threatKind: string | null;
  grade: Grade;
  reason: string;
  action: string;
}

/** Radii for "affected": the front line's drone-corridor band, and an active aerial threat nearby. */
export const EXPOSURE_FRONT_KM = 65; // ZONES.orange: 120 km swept in most of the east
export const EXPOSURE_THREAT_KM = 50;

/**
 * Rate one site. Rules of thumb, not a model: within 25 km of the line or 15 km of an active threat
 * is critical, within 65 km or 30 km is high, the rest of the radius is elevated. Returns null when
 * the site is outside both radii.
 */
export function exposure(
  site: { id: string; name: string; kind: string; coordinates: [number, number] },
  fronts: [number, number][][],
  threats: AerialThreat[],
): Exposure | null {
  const [lon, lat] = site.coordinates;
  const frontKm = Math.min(...fronts.map((c) => distanceToLineKm(lat, lon, c)), 999);
  let near: AerialThreat | null = null;
  let threatKm = Infinity;
  for (const t of threats) {
    // cheap box test first; 0.8 degrees is about 55-90 km at Ukraine's latitudes
    if (Math.abs(t.lat - lat) > 0.8 || Math.abs(t.lon - lon) > 1.2) continue;
    const km = haversineKm(site.coordinates, [t.lon, t.lat]);
    if (km < threatKm) [near, threatKm] = [t, km];
  }
  const threatNear = near && threatKm <= EXPOSURE_THREAT_KM;
  if (frontKm > EXPOSURE_FRONT_KM && !threatNear) return null;
  const grade: Grade =
    frontKm <= ZONES.red.km || (threatNear && threatKm <= 15)
      ? "critical"
      : frontKm <= ZONES.orange.km || (threatNear && threatKm <= 30)
        ? "high"
        : "elevated";
  const reason = threatNear
    ? `${threatKind(near!.kind)} reported ${Math.round(threatKm)} km away`
    : `${Math.round(frontKm)} km from the front line`;
  const action =
    grade === "critical"
      ? "Hold shipments from here. Ask the carrier for the driver's status and plan a reroute through a rear hub."
      : grade === "high"
        ? "Expect delays. Order a day early and confirm the delivery window before the truck leaves."
        : "Deliveries usually run. Keep two days of safety stock for lines sourced here.";
  return {
    ...site,
    frontKm,
    threatKm: threatNear ? Math.round(threatKm) : null,
    threatKind: threatNear ? threatKind(near!.kind) : null,
    grade,
    reason,
    action,
  };
}

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
