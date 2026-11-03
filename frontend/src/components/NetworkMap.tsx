"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { FilterSpecification, GeoJSONSource, Map as MapLibre, MapLayerMouseEvent, Popup } from "maplibre-gl";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { CloseIcon } from "./icons";
import { type FacilityImpact, type Rated, WartimePanel } from "./WartimePanel";
import { fetcher } from "@/lib/api";
import { ALERTS_URL, type Alerts, assess, distanceToLineKm, type Grade, GRADES, LINES_URL, type LineFeature, STORES_URL, THREATS_URL, type ThreatFeed, type WarStore, ZONES } from "@/lib/wartime";

/**
 * Ukraine supply network: official Avrora stores, Avrora distribution centres, partners and
 * manufacturers, and OpenStreetMap warehouses, logistics centres and food-production sites.
 * MapLibre draws everything on the GPU, so 7,500 points and their clusters stay smooth while
 * zooming. Tiles: OpenFreeMap (free, no key).
 *
 * War-time mode swaps those layers for sample Avrora stores rated by distance to the front line
 * and, when the server is connected to alerts.in.ua, live air-raid alerts (see lib/wartime.ts).
 */

type Category = "avrora" | "supply" | "warehouse" | "logistics" | "food";

interface Props {
  c: Category;
  id: string;
  n?: string; // name
  a?: string; // address
  o?: string; // operator
  b?: string; // brand
  w?: string; // website
  s?: string; // status, when not active
  r?: string; // role (supply nodes) or kind of site (food)
  t?: string; // opening hours (Avrora stores) or note (supply nodes)
  u?: string; // source link (supply nodes)
  l?: string; // source name (supply nodes)
}

interface Feature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: Props;
}

const STYLE = "https://tiles.openfreemap.org/styles/positron";
const DATA = "/map/locations.min.json";
const WORKER = "/map/maplibre-gl-worker.mjs"; // copied from node_modules by `npm run map-worker`
const STORE: [number, number] = [28.4682, 49.2331]; // Avrora Store #417, Vinnytsia
const UKRAINE: [[number, number], [number, number]] = [[22.1, 44.3], [40.3, 52.4]];

export const CATEGORIES: Record<Category, { one: string; color: string }> = {
  avrora: { one: "Avrora store", color: "#ff9500" },
  supply: { one: "Supply partner", color: "#ff2d55" },
  warehouse: { one: "Warehouse", color: "#5856d6" },
  logistics: { one: "Logistics centre", color: "#0a9396" },
  food: { one: "Food production", color: "#34c759" },
};

const STATUS: Record<string, string> = {
  disused: "Disused",
  abandoned: "Abandoned",
  ruins: "Ruins",
  damaged: "Damaged",
  unclear: "Operating status unclear",
  destroyed_historic: "Destroyed",
};

type Filter = "all" | "avrora" | "supply" | "storage" | "food";
const FILTERS: { id: Filter; label: string; cats: Category[] }[] = [
  { id: "all", label: "All", cats: ["avrora", "supply", "warehouse", "logistics", "food"] },
  { id: "avrora", label: "Avrora", cats: ["avrora"] },
  { id: "supply", label: "Supply", cats: ["supply"] },
  { id: "storage", label: "Storage", cats: ["warehouse", "logistics"] },
  { id: "food", label: "Food", cats: ["food"] },
];
const inFilter = (filter: Filter, c: Category) => FILTERS.find((f) => f.id === filter)!.cats.includes(c);

type Mode = "network" | "war";
type NetworkGroup = "avrora" | "supply" | "storage" | "food";
const NETWORK_GROUPS: NetworkGroup[] = ["avrora", "supply", "storage", "food"];
const NETWORK_GROUP_CONFIG: Record<NetworkGroup, { letter: string; color: string; cats: Category[] }> = {
  avrora: { letter: "A", color: CATEGORIES.avrora.color, cats: ["avrora"] },
  supply: { letter: "S", color: CATEGORIES.supply.color, cats: ["supply"] },
  storage: { letter: "S", color: CATEGORIES.warehouse.color, cats: ["warehouse", "logistics"] },
  food: { letter: "F", color: CATEGORIES.food.color, cats: ["food"] },
};
const NETWORK_LAYERS = NETWORK_GROUPS.flatMap((group) => [
  `${group}-clusters`,
  `${group}-cluster-letter`,
  `${group}-points`,
]);
const WAR_LAYERS = ["war-yellow", "war-orange", "war-red", "war-line", "war-facilities", "war-threat-halo", "war-threats", "war-halo", "war-stores"];

const fmt = new Intl.NumberFormat("en-US");

function distanceKm(a: [number, number], b: [number, number]) {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const lat1 = a[1] * rad;
  const lat2 = b[1] * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return Math.round(6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)) * 10) / 10;
}

/** Kind line above the name: the role for supply nodes and food sites, else the category. */
const kind = (p: Props) => p.r ?? CATEGORIES[p.c].one;

function source(p: Props): { href: string; label: string } | null {
  if (p.c === "avrora") {
    const id = p.id.split("-").pop();
    return { href: `https://avrora.ua/index.php?dispatch=store_locator.view&store_location_id=${id}`, label: "View on avrora.ua" };
  }
  if (p.c === "supply") return p.u ? { href: p.u, label: `Source: ${p.l ?? "public record"}` } : null;
  const [type, osmId] = p.id.split("/");
  return osmId ? { href: `https://www.openstreetmap.org/${type}/${osmId}`, label: "View on OpenStreetMap" } : null;
}

function popupHtml(p: Props) {
  const color = CATEGORIES[p.c].color;
  const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  const link = source(p);
  const rows = [
    p.a && `<div class="nm-row">${esc(p.a)}</div>`,
    (p.o || p.b) && `<div class="nm-row">Operator: ${esc(p.o || p.b!)}</div>`,
    p.t && p.c === "avrora" && `<div class="nm-row">Open ${esc(p.t)}</div>`,
    p.s && `<div class="nm-row nm-status">${STATUS[p.s] ?? esc(p.s)}</div>`,
    p.t && p.c !== "avrora" && `<div class="nm-row nm-note">${esc(p.t)}</div>`,
  ].filter(Boolean);
  return `
    <div class="nm-kind" style="color:${color}"><span class="nm-dot" style="background:${color}"></span>${esc(kind(p))}</div>
    <div class="nm-name">${esc(p.n ?? "Unnamed place")}</div>
    ${rows.join("")}
    ${link ? `<a class="nm-link" href="${esc(link.href)}" target="_blank" rel="noopener noreferrer">${esc(link.label)}</a>` : ""}`;
}

/** Keep flight targets clear of the floating card: below it or beside it, whichever leaves more map. */
function cardPadding(el: HTMLElement | null, cardEl: HTMLElement | null) {
  const zero = { top: 0, left: 0, right: 0, bottom: 0 };
  const box = el?.getBoundingClientRect();
  const c = cardEl?.getBoundingClientRect();
  if (!box || !c || !box.width) return zero;
  const below = c.bottom - box.top;
  const beside = c.right - box.left;
  return box.width * (box.height - below) >= (box.width - beside) * box.height
    ? { ...zero, top: Math.min(below, box.height * 0.5) }
    : { ...zero, left: beside };
}

/** Shift a flight target into the middle of the uncovered area (offset doesn't stick, unlike padding). */
function cardOffset(el: HTMLElement | null, cardEl: HTMLElement | null): [number, number] {
  const p = cardPadding(el, cardEl);
  return [p.left / 2, p.top / 2];
}

/** Initial fit: Ukraine in the map area that the card doesn't cover. */
function fitPadding(el: HTMLElement | null, cardEl: HTMLElement | null) {
  const p = cardPadding(el, cardEl);
  return { top: p.top + 16, left: p.left + 16, right: 16, bottom: 16 };
}

export function NetworkMap() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibre | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const popupCat = useRef<Category | null>(null);
  const [features, setFeatures] = useState<Feature[] | null>(null);
  const [ready, setReady] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [failed, setFailed] = useState(false);
  const [mode, setMode] = useState<Mode>("network");
  const [war, setWar] = useState<{ stores: WarStore[]; lines: LineFeature[] } | null>(null);
  const [warFailed, setWarFailed] = useState(false);
  const [warId, setWarId] = useState<string | null>(null);
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const { data: alerts, error: alertsError } = useSWR<Alerts>(mode === "war" ? ALERTS_URL : null, fetcher, {
    refreshInterval: 60_000,
  });
  const alertState = useMemo<Alerts | undefined>(
    () => (alertsError ? { connected: false, reason: "unavailable" } : alerts),
    [alerts, alertsError],
  );
  const { data: threats, error: threatsError } = useSWR<ThreatFeed>(mode === "war" ? THREATS_URL : null, fetcher, {
    refreshInterval: 60_000,
  });
  const threatState = useMemo<ThreatFeed | undefined>(
    () => (threatsError ? { connected: false, reason: "unavailable" } : threats),
    [threats, threatsError],
  );

  // war-time data, loaded the first time the mode is opened
  useEffect(() => {
    if (mode !== "war" || war) return;
    let live = true;
    Promise.all([fetch(STORES_URL).then((r) => r.json()), fetch(LINES_URL).then((r) => r.json())])
      .then(([s, l]: [{ stores: WarStore[] }, { features: LineFeature[] }]) => live && setWar({ stores: s.stores, lines: l.features }))
      .catch(() => live && setWarFailed(true));
    return () => {
      live = false;
    };
  }, [mode, war]);

  const rated = useMemo<Rated[] | null>(
    () =>
      war &&
      war.stores
        .map((store) => ({ store, a: assess(store, war.lines, alertState) }))
        .sort((x, y) => y.a.score - x.a.score || x.a.km - y.a.km),
    [war, alertState],
  );
  const selectedWar = rated?.find((r) => r.store.id === warId) ?? null;

  const facilityImpacts = useMemo<FacilityImpact[] | null>(() => {
    if (!features || !war) return null;
    const fronts = war.lines.flatMap((line) =>
      line.properties.kind === "front" && line.geometry.type === "LineString" ? [line.geometry.coordinates] : [],
    );
    const activeThreats = threatState?.connected ? threatState.threats.filter((t) => t.status === "active") : [];
    const rank: Record<Grade, number> = { critical: 3, high: 2, elevated: 1, low: 0 };
    return features
      .flatMap((feature): FacilityImpact[] => {
        const p = feature.properties;
        if (!(["warehouse", "logistics", "supply"] as Category[]).includes(p.c)) return [];
        const coordinates = feature.geometry.coordinates;
        const frontKm = Math.round(Math.min(...fronts.map((line) => distanceToLineKm(coordinates[1], coordinates[0], line)), 999) * 10) / 10;
        let nearest = null as (typeof activeThreats)[number] | null;
        let threatKm = Infinity;
        for (const threat of activeThreats) {
          const km = distanceKm(coordinates, [threat.lon, threat.lat]);
          if (km < threatKm) { nearest = threat; threatKm = km; }
        }
        if (frontKm > 120 && threatKm > 150) return [];
        const grade: Grade = frontKm <= 25 || threatKm <= 50 ? "critical" : frontKm <= 65 || threatKm <= 100 ? "high" : "elevated";
        const reason = threatKm <= 150 && nearest
          ? `Active ${nearest.kind.replaceAll("_", " " )} report ${threatKm} km away`
          : `${frontKm} km from the mapped front line`;
        const recommendation = grade === "critical"
          ? "Pause dispatches, account for staff, use shelter protocol, reroute through an alternate hub and notify carriers."
          : grade === "high"
            ? "Hold non-essential movements, confirm the driver route and shelter plan, and move urgent stock through an alternate hub."
            : "Increase safety stock, confirm a backup carrier and route, and check live warnings before dispatch.";
        return [{
          id: p.id,
          name: p.n ?? p.o ?? CATEGORIES[p.c].one,
          category: CATEGORIES[p.c].one,
          address: p.a ?? "",
          coordinates,
          frontKm,
          threatKm: threatKm <= 150 ? threatKm : null,
          threatTitle: threatKm <= 150 && nearest ? nearest.title : null,
          grade,
          reason,
          recommendation,
        }];
      })
      .sort((a, b) => rank[b.grade] - rank[a.grade] || (a.threatKm ?? a.frontKm) - (b.threatKm ?? b.frontKm));
  }, [features, war, threatState]);
  const selectedFacility = facilityImpacts?.find((f) => f.id === facilityId) ?? null;

  // data
  useEffect(() => {
    let live = true;
    fetch(DATA)
      .then((r) => r.json())
      .then((d: { features: Feature[] }) => live && setFeatures(d.features))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const total = features?.length ?? 0;

  const visible = useMemo(() => (features ?? []).filter((f) => inFilter(filter, f.properties.c)), [features, filter]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return visible
      .filter((f) => [f.properties.n, f.properties.a, f.properties.o, f.properties.b, f.properties.r].some((v) => v?.toLowerCase().includes(q)))
      .slice(0, 6);
  }, [visible, query]);

  // map
  useEffect(() => {
    let disposed = false;
    (async () => {
      const maplibre = await import("maplibre-gl");
      maplibre.setWorkerUrl(WORKER);
      if (disposed || !container.current) return;
      const map = new maplibre.Map({
        container: container.current,
        style: STYLE,
        bounds: UKRAINE,
        fitBoundsOptions: { padding: fitPadding(container.current, card.current) },
        maxBounds: [[2, 33], [60, 62]],
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
      });
      map.touchZoomRotate.disableRotation();
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), "bottom-right");
      // compact attribution starts expanded; keep it as the small (i) button like Apple Maps' "Legal"
      // MapLibre re-expands it whenever sources change, so collapse it until the user opens it themselves.
      let attribOpened = false;
      container.current.querySelector(".maplibregl-ctrl-attrib-button")?.addEventListener("click", () => (attribOpened = true));
      map.on("data", () => {
        if (!attribOpened) container.current?.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
      });
      mapRef.current = map;

      const el = document.createElement("div");
      el.className = "nm-store";
      el.setAttribute("aria-label", "Avrora Store #417, Vinnytsia");
      el.innerHTML = `<img src="/avrora-mark.svg" alt="" width="28" height="28">`;
      new maplibre.Marker({ element: el }).setLngLat(STORE).addTo(map);

      popupRef.current = new maplibre.Popup({ closeButton: false, maxWidth: "280px", offset: 10, className: "nm-popup" });

      map.on("error", (e) => console.error("map:", e.error?.message));
      map.on("load", () => {
        for (const group of NETWORK_GROUPS) {
          const config = NETWORK_GROUP_CONFIG[group];
          const sourceId = `network-${group}`;
          map.addSource(sourceId, {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
            cluster: true,
            clusterRadius: 44,
            clusterMaxZoom: 13,
            promoteId: "id",
          });
          map.addLayer({
            id: `${group}-clusters`,
            type: "circle",
            source: sourceId,
            filter: ["has", "point_count"],
            paint: {
              "circle-color": config.color,
              "circle-radius": ["step", ["get", "point_count"], 13, 25, 16, 150, 19, 600, 23],
              "circle-stroke-width": 2,
              "circle-stroke-color": "#ffffff",
              "circle-radius-transition": { duration: 300 },
            },
          });
          map.addLayer({
            id: `${group}-cluster-letter`,
            type: "symbol",
            source: sourceId,
            filter: ["has", "point_count"],
            layout: {
              "text-field": config.letter,
              "text-font": ["Noto Sans Bold"],
              "text-size": 13,
              "text-allow-overlap": true,
            },
            paint: { "text-color": "#ffffff" },
          });
          map.addLayer({
            id: `${group}-points`,
            type: "circle",
            source: sourceId,
            filter: ["!", ["has", "point_count"]],
            paint: {
              "circle-color":
                group === "storage"
                  ? ["match", ["get", "c"], "logistics", CATEGORIES.logistics.color, CATEGORIES.warehouse.color]
                  : config.color,
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 4, 12, 6, 16, 8],
              "circle-stroke-width": 1.5,
              "circle-stroke-color": "#ffffff",
              "circle-opacity": ["case", ["has", "s"], 0.45, 1],
              "circle-stroke-opacity": ["case", ["has", "s"], 0.45, 1],
            },
          });
        }

        // war-time layers, hidden until that mode is chosen
        map.addSource("war-lines", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addSource("war-stores", { type: "geojson", data: { type: "FeatureCollection", features: [] }, promoteId: "id" });
        map.addSource("war-facilities", { type: "geojson", data: { type: "FeatureCollection", features: [] }, promoteId: "id" });
        map.addSource("war-threats", { type: "geojson", data: { type: "FeatureCollection", features: [] }, promoteId: "id" });
        // distance bands, precomputed buffers around the sketched line, drawn under the map's labels
        const beforeLabels = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
        for (const z of ["yellow", "orange", "red"] as const) {
          const band: FilterSpecification = ["all", ["==", ["get", "kind"], "band"], ["==", ["get", "zone"], z]];
          map.addLayer(
            {
              id: `war-${z}`,
              type: "fill",
              source: "war-lines",
              filter: band,
              layout: { visibility: "none" },
              paint: { "fill-color": ZONES[z].fill },
            },
            beforeLabels,
          );
        }
        map.addLayer({
          id: "war-line",
          type: "line",
          source: "war-lines",
          filter: ["!=", ["get", "kind"], "band"],
          layout: { visibility: "none", "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": "#d70015",
            "line-width": ["interpolate", ["linear"], ["zoom"], 5, 1.5, 10, 3],
            "line-dasharray": ["case", ["==", ["get", "kind"], "front"], ["literal", [1, 0]], ["literal", [2, 1.5]]],
          },
        });
        map.addLayer({
          id: "war-facilities",
          type: "circle",
          source: "war-facilities",
          layout: { visibility: "none" },
          paint: {
            "circle-color": ["get", "color"],
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 4, 12, 7],
            "circle-stroke-width": 1.5,
            "circle-stroke-color": "#ffffff",
          },
        });
        map.addLayer({
          id: "war-threat-halo",
          type: "circle",
          source: "war-threats",
          layout: { visibility: "none" },
          paint: { "circle-color": "#af52de", "circle-radius": 18, "circle-opacity": 0.16 },
        });
        map.addLayer({
          id: "war-threats",
          type: "circle",
          source: "war-threats",
          layout: { visibility: "none" },
          paint: { "circle-color": "#af52de", "circle-radius": 6, "circle-stroke-width": 2, "circle-stroke-color": "#ffffff" },
        });
        map.addLayer({
          id: "war-halo",
          type: "circle",
          source: "war-stores",
          filter: ["==", ["get", "selected"], true],
          layout: { visibility: "none" },
          paint: { "circle-color": "rgba(0,113,227,0.22)", "circle-radius": 17 },
        });
        map.addLayer({
          id: "war-stores",
          type: "circle",
          source: "war-stores",
          layout: { visibility: "none" },
          paint: {
            "circle-color": ["get", "color"],
            "circle-radius": ["case", ["get", "selected"], 9, 7],
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
          },
        });
        map.on("click", "war-stores", (e: MapLayerMouseEvent) => {
          const id = e.features?.[0]?.properties.id;
          if (typeof id === "string") { setFacilityId(null); setWarId(id); }
        });
        map.on("click", "war-facilities", (e: MapLayerMouseEvent) => {
          const id = e.features?.[0]?.properties.id;
          if (typeof id === "string") { setWarId(null); setFacilityId(id); }
        });
        map.on("click", "war-threats", (e: MapLayerMouseEvent) => {
          const feature = e.features?.[0];
          if (!feature) return;
          const coordinates = (feature.geometry as unknown as { coordinates: [number, number] }).coordinates;
          const title = String(feature.properties.title ?? "Active aerial threat").replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
          const kind = String(feature.properties.kind ?? "unknown").replaceAll("_", " ");
          popupRef.current?.setLngLat(coordinates).setHTML(`<div class="nm-kind" style="color:#af52de">Active aerial threat</div><div class="nm-name">${title}</div><div class="nm-row">${kind} · public monitoring report, not a confirmed strike</div>`).addTo(map);
        });

        const open = (e: MapLayerMouseEvent) => {
          const f = e.features?.[0];
          if (!f) return;
          const coords = (f.geometry as unknown as { coordinates: [number, number] }).coordinates;
          popupCat.current = (f.properties as Props).c;
          popupRef.current?.setLngLat(coords).setHTML(popupHtml(f.properties as Props)).addTo(map);
        };
        for (const group of NETWORK_GROUPS) {
          const sourceId = `network-${group}`;
          const clusterLayer = `${group}-clusters`;
          const pointLayer = `${group}-points`;
          map.on("click", clusterLayer, async (e: MapLayerMouseEvent) => {
            const f = e.features?.[0];
            if (!f) return;
            const zoom = await (map.getSource(sourceId) as GeoJSONSource).getClusterExpansionZoom(f.properties.cluster_id);
            map.easeTo({ center: (f.geometry as unknown as { coordinates: [number, number] }).coordinates, zoom: zoom + 0.3, duration: 600 });
          });
          map.on("click", pointLayer, open);
          for (const layer of [clusterLayer, pointLayer]) {
            map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
            map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
          }
        }
        for (const layer of ["war-stores", "war-facilities", "war-threats"]) {
          map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
          map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
        }
        setReady(true);
      });
    })();
    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // keep the source in step with the filter
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    for (const group of NETWORK_GROUPS) {
      const categories = NETWORK_GROUP_CONFIG[group].cats;
      (map.getSource(`network-${group}`) as GeoJSONSource).setData({
        type: "FeatureCollection",
        features: visible.filter((f) => categories.includes(f.properties.c)),
      });
    }
    // close the popup only if its place has just been filtered out
    if (popupCat.current && !inFilter(filter, popupCat.current)) popupRef.current?.remove();
  }, [ready, visible, filter]);

  // switch layer sets with the mode
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    for (const id of NETWORK_LAYERS) map.setLayoutProperty(id, "visibility", mode === "network" ? "visible" : "none");
    for (const id of WAR_LAYERS) map.setLayoutProperty(id, "visibility", mode === "war" ? "visible" : "none");
  }, [ready, mode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !war || !rated) return;
    (map.getSource("war-lines") as GeoJSONSource).setData({ type: "FeatureCollection", features: war.lines });
    (map.getSource("war-stores") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: rated.map(({ store: s, a }) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [s.lon, s.lat] },
        properties: { id: s.id, city: s.city, color: GRADES[a.grade].color, selected: s.id === warId },
      })),
    });
  }, [ready, war, rated, warId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("war-facilities") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: (facilityImpacts ?? []).map((f) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: f.coordinates },
        properties: { id: f.id, color: GRADES[f.grade].color },
      })),
    });
    const active = threatState?.connected ? threatState.threats.filter((t) => t.status === "active") : [];
    (map.getSource("war-threats") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: active.map((t) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [t.lon, t.lat] },
        properties: { id: t.id, title: t.title, kind: t.kind, amount: t.amount },
      })),
    });
  }, [ready, facilityImpacts, threatState]);

  // highlight and fly to the chosen war-time store
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !war) return;
    const s = war.stores.find((x) => x.id === warId);
    if (!s) return;
    requestAnimationFrame(() =>
      map.flyTo({ center: [s.lon, s.lat], zoom: 9, duration: 1200, essential: true, offset: cardOffset(container.current, card.current) }),
    );
  }, [ready, war, warId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !selectedFacility) return;
    map.flyTo({ center: selectedFacility.coordinates, zoom: 10, duration: 1000, essential: true, offset: cardOffset(container.current, card.current) });
  }, [ready, selectedFacility]);

  const focus = (f: Feature) => {
    const map = mapRef.current;
    if (!map) return;
    setQuery("");
    // wait a frame so the card has collapsed its results list before measuring it
    requestAnimationFrame(() => {
      map.flyTo({ center: f.geometry.coordinates, zoom: 15, duration: 1400, essential: true, offset: cardOffset(container.current, card.current) });
      // open right away: the popup is anchored to the coordinates, so it rides along with the flight
      popupCat.current = f.properties.c;
      popupRef.current?.setLngLat(f.geometry.coordinates).setHTML(popupHtml(f.properties)).addTo(map);
    });
  };

  const toStore = () => mapRef.current?.flyTo({ center: STORE, zoom: 11, duration: 1400, essential: true, offset: cardOffset(container.current, card.current) });

  return (
    <div className="relative h-full w-full bg-[#f2efe9]">
      <div className="absolute inset-0">
        <div ref={container} className="h-full w-full" aria-label="Map of the Ukraine supply network" role="region" />
      </div>

      <motion.div
        ref={card}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 34 }}
        className="absolute left-3 right-3 top-3 z-10 rounded-[14px] bg-[rgba(255,255,255,0.92)] p-3 shadow-[0_8px_30px_rgba(0,0,0,0.12),0_0_0_0.5px_rgba(0,0,0,0.06)] backdrop-blur-xl md:left-4 md:right-auto md:top-4 md:w-[380px]"
      >
        <div aria-label="Map mode" role="group" className="mb-3 flex rounded-[9px] bg-fill p-[2px]">
          {(["network", "war"] as const).map((m) => (
            <button
              key={m}
              aria-pressed={mode === m}
              onClick={() => {
                if (m !== mode) popupRef.current?.remove();
                setMode(m);
              }}
              className="t-footnote relative flex-1 rounded-[7px] px-1 py-[5px] font-medium"
            >
              {mode === m && (
                <motion.span
                  layoutId="map-mode"
                  className="absolute inset-0 rounded-[7px] bg-white shadow-[0_3px_8px_rgba(0,0,0,0.12),0_3px_1px_rgba(0,0,0,0.04)]"
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                />
              )}
              <span className="relative">{m === "network" ? "Network" : "War-time"}</span>
            </button>
          ))}
        </div>

        {mode === "war" ? (
          <>
            {!selectedWar && <h1 className="t-headline px-1">War-time risk</h1>}
            <WartimePanel
              rated={rated}
              alerts={alertState}
              failed={warFailed}
              selected={selectedWar}
              onSelect={setWarId}
              facilityImpacts={facilityImpacts}
              selectedFacility={selectedFacility}
              onSelectFacility={setFacilityId}
              threats={threatState}
            />
          </>
        ) : (
          <>
        <h1 className="t-headline px-1">Supply network</h1>
        <p className="t-footnote px-1 text-label-2">
          {features ? `${fmt.format(total)} places in Ukraine from Avrora and OpenStreetMap` : failed ? "Can't load the map. Check your connection and try again." : "Loading places…"}
        </p>

        <div role="tablist" aria-label="Show on map" className="mt-3 flex rounded-[9px] bg-fill p-[2px]">
          {FILTERS.map(({ id: f, label, cats }) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className="t-caption relative flex flex-1 items-center justify-center gap-1 rounded-[7px] px-1 py-[5px] font-medium"
            >
              {filter === f && (
                <motion.span
                  layoutId="map-seg"
                  className="absolute inset-0 rounded-[7px] bg-white shadow-[0_3px_8px_rgba(0,0,0,0.12),0_3px_1px_rgba(0,0,0,0.04)]"
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                />
              )}
              {f !== "all" && <span className="relative size-2 rounded-full" style={{ background: CATEGORIES[cats[0]].color }} />}
              <span className="relative">{label}</span>
            </button>
          ))}
        </div>
        <p className="t-caption num mt-1.5 px-1 text-label-2" aria-live="polite">
          {features && `${fmt.format(visible.length)} shown`}
        </p>

        <div className="relative mt-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search store, address or partner"
            aria-label="Search places"
            className="t-subhead w-full rounded-[10px] bg-fill px-3 py-[7px] outline-none placeholder:text-label-2"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 grid size-[18px] -translate-y-1/2 place-items-center rounded-full bg-[#8e8e93] text-white"
            >
              <CloseIcon size={9} />
            </button>
          )}
        </div>
        {query.trim().length >= 2 && (
          <ul className="mt-2 overflow-hidden rounded-[10px] bg-white" aria-label="Search results">
            {results.length === 0 && <li className="t-subhead px-3 py-2.5 text-label-2">No places match.</li>}
            {results.map((f) => (
              <li key={f.properties.id} className="cell [--inset:12px]">
                <button onClick={() => focus(f)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-fill">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: CATEGORIES[f.properties.c].color }} />
                  <span className="min-w-0">
                    <span className="t-subhead block truncate">{f.properties.n ?? kind(f.properties)}</span>
                    <span className="t-caption block truncate text-label-2">{f.properties.a ?? kind(f.properties)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
          </>
        )}
      </motion.div>

      <button
        onClick={toStore}
        className="t-subhead absolute bottom-[44px] right-[10px] md:bottom-[124px] z-10 flex items-center gap-1.5 rounded-full bg-[rgba(255,255,255,0.9)] py-1.5 pl-1.5 pr-3 font-medium shadow-[0_4px_14px_rgba(0,0,0,0.14),0_0_0_0.5px_rgba(0,0,0,0.06)] backdrop-blur-xl"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- static export, SVG mark */}
        <img src="/avrora-mark.svg" alt="" width={24} height={24} className="size-6" />
        Your store
      </button>
    </div>
  );
}
