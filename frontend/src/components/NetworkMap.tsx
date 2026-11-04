"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { FilterSpecification, GeoJSONSource, Map as MapLibre, MapLayerMouseEvent, Popup } from "maplibre-gl";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { CheckIcon, CloseIcon } from "./icons";
import { type Rated, WartimePanel } from "./WartimePanel";
import { fetcher } from "@/lib/api";
import {
  ALERTS_URL,
  type Alerts,
  assess,
  BORDER_URL,
  type Exposure,
  exposure,
  GRADES,
  LINES_URL,
  type LineFeature,
  STORES_URL,
  THREATS_URL,
  type Threats,
  threatKind,
  type WarStore,
  ZONES,
} from "@/lib/wartime";

/**
 * Ukraine supply network: official Avrora stores, Avrora distribution centres, partners and
 * manufacturers, and OpenStreetMap warehouses, logistics centres and food-production sites.
 * MapLibre draws everything on the GPU, so 7,500 points and their clusters stay smooth while
 * zooming. Tiles: OpenFreeMap (free, no key).
 *
 * The war-time layer (on by default with the network; checkmarks narrow to one) adds sample Avrora stores rated by distance to the front line
 * and, when the server is connected to alerts.in.ua, live air-raid alerts (see lib/wartime.ts). It also
 * marks active aerial threats from mapa.ua (unofficial estimates) and rings the distribution sites
 * within reach of the front line or a threat, with a suggested supply action for each.
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
const NETWORK_LAYERS = ["clusters", "cluster-letter", "points", "key-points"];
const WAR_LAYERS = ["war-yellow", "war-orange", "war-red", "war-line", "war-exposed", "war-threat-halo", "war-threats", "war-halo", "war-stores"];
/** Distribution sites whose exposure matters for deliveries; shops and food producers are left out. */
const DISTRIBUTION: Category[] = ["supply", "warehouse", "logistics"];
const THREAT_COLOR = "#af52de";

/** Clusters take the colour of the category most of their places belong to (count per category). */
const CLUSTER_COUNTS = {
  nAv: ["+", ["case", ["==", ["get", "c"], "avrora"], 1, 0]],
  nSt: ["+", ["case", ["in", ["get", "c"], ["literal", ["warehouse", "logistics"]]], 1, 0]],
  nFd: ["+", ["case", ["==", ["get", "c"], "food"], 1, 0]],
} as const;

const fmt = new Intl.NumberFormat("en-US");
const time = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
};
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

function exposureHtml(x: Exposure) {
  const g = GRADES[x.grade];
  return `
    <div class="nm-kind" style="color:${g.text}"><span class="nm-dot" style="background:${g.color}"></span>${esc(x.kind)} · ${g.label} risk</div>
    <div class="nm-name">${esc(x.name)}</div>
    <div class="nm-row">${esc(x.reason)}</div>
    <div class="nm-row nm-note">${esc(x.action)}</div>`;
}

function threatHtml(p: { kind: string; amount: number; seen: string }) {
  const n = Number(p.amount) > 1 ? ` × ${Number(p.amount)}` : "";
  return `
    <div class="nm-kind" style="color:${THREAT_COLOR}"><span class="nm-dot" style="background:${THREAT_COLOR}"></span>Aerial threat</div>
    <div class="nm-name">${esc(threatKind(p.kind))}${n}</div>
    ${p.seen ? `<div class="nm-row">Last reported ${esc(p.seen)}</div>` : ""}
    <div class="nm-row nm-note">Unofficial position estimate from mapa.ua, not a confirmed strike. Follow official air-raid alerts for safety.</div>`;
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
  const dock = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--dock-h")) || 60;
  return { top: p.top + 16, left: p.left + 16, right: 16, bottom: dock + 32 };
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
  // both layers show by default; the checkmarks narrow the map to one of them (never to none)
  const [show, setShow] = useState<Record<Mode, boolean>>({ network: true, war: true });
  const [war, setWar] = useState<{ stores: WarStore[]; lines: LineFeature[] } | null>(null);
  const [warFailed, setWarFailed] = useState(false);
  const [warId, setWarId] = useState<string | null>(null);
  const { data: alerts, error: alertsError } = useSWR<Alerts>(show.war ? ALERTS_URL : null, fetcher, {
    refreshInterval: 60_000,
  });
  const alertState = useMemo<Alerts | undefined>(
    () => (alertsError ? { connected: false, reason: "unavailable" } : alerts),
    [alerts, alertsError],
  );
  const { data: threats, error: threatsError } = useSWR<Threats>(show.war ? THREATS_URL : null, fetcher, {
    refreshInterval: 60_000,
  });
  const threatState = useMemo<Threats | undefined>(
    () => (threatsError ? { connected: false, reason: "unavailable" } : threats),
    [threats, threatsError],
  );

  // war-time data, loaded the first time that layer is shown
  useEffect(() => {
    if (!show.war || war) return;
    let live = true;
    Promise.all([fetch(STORES_URL).then((r) => r.json()), fetch(LINES_URL).then((r) => r.json())])
      .then(([s, l]: [{ stores: WarStore[] }, { features: LineFeature[] }]) => live && setWar({ stores: s.stores, lines: l.features }))
      .catch(() => live && setWarFailed(true));
    return () => {
      live = false;
    };
  }, [show.war, war]);

  const rated = useMemo<Rated[] | null>(
    () =>
      war &&
      war.stores
        .map((store) => ({ store, a: assess(store, war.lines, alertState) }))
        .sort((x, y) => y.a.score - x.a.score || x.a.km - y.a.km),
    [war, alertState],
  );
  const selectedWar = rated?.find((r) => r.store.id === warId) ?? null;

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

  // distribution sites near the front line or an active aerial threat, worst first
  const exposures = useMemo<Exposure[] | null>(() => {
    if (!features || !war) return null;
    const fronts = war.lines.flatMap((l) => (l.properties.kind === "front" && l.geometry.type === "LineString" ? [l.geometry.coordinates] : []));
    const active = threatState?.connected ? threatState.threats : [];
    const rank = { critical: 0, high: 1, elevated: 2, low: 3 };
    return features
      .flatMap((f) => {
        const p = f.properties;
        if (!DISTRIBUTION.includes(p.c) || p.s) return [];
        const x = exposure({ id: p.id, name: p.n ?? p.o ?? CATEGORIES[p.c].one, kind: kind(p), coordinates: f.geometry.coordinates }, fronts, active);
        return x ? [x] : [];
      })
      .sort((a, b) => rank[a.grade] - rank[b.grade] || (a.threatKm ?? a.frontKm) - (b.threatKm ?? b.frontKm));
  }, [features, war, threatState]);

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
        map.addSource("places", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
          cluster: true,
          clusterRadius: 44,
          clusterMaxZoom: 13,
          clusterProperties: CLUSTER_COUNTS,
          promoteId: "id",
        });
        // supply partners are few and the reason to open the map, so they are never folded into clusters
        map.addSource("key", { type: "geojson", data: { type: "FeatureCollection", features: [] }, promoteId: "id" });
        map.addLayer({
          id: "clusters",
          type: "circle",
          source: "places",
          filter: ["has", "point_count"],
          paint: {
            "circle-color": [
              "case",
              [">=", ["get", "nAv"], ["max", ["get", "nSt"], ["get", "nFd"]]],
              CATEGORIES.avrora.color,
              [">=", ["get", "nFd"], ["get", "nSt"]],
              CATEGORIES.food.color,
              CATEGORIES.warehouse.color,
            ],
            "circle-radius": ["step", ["get", "point_count"], 13, 25, 16, 150, 19, 600, 23],
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
            "circle-radius-transition": { duration: 300 },
          },
        });
        map.addLayer({
          id: "cluster-letter",
          type: "symbol",
          source: "places",
          filter: ["has", "point_count"],
          layout: {
            "text-field": [
              "case",
              [">=", ["get", "nAv"], ["max", ["get", "nSt"], ["get", "nFd"]]],
              "A",
              [">=", ["get", "nFd"], ["get", "nSt"]],
              "F",
              "S",
            ],
            "text-font": ["Noto Sans Bold"],
            "text-size": 13,
            "text-allow-overlap": true,
          },
          paint: { "text-color": "#ffffff" },
        });
        map.addLayer({
          id: "points",
          type: "circle",
          source: "places",
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-color": [
              "match",
              ["get", "c"],
              "avrora",
              CATEGORIES.avrora.color,
              "logistics",
              CATEGORIES.logistics.color,
              "food",
              CATEGORIES.food.color,
              CATEGORIES.warehouse.color,
            ],
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 4, 12, 6, 16, 8],
            "circle-stroke-width": 1.5,
            "circle-stroke-color": "#ffffff",
            "circle-opacity": ["case", ["has", "s"], 0.45, 1],
            "circle-stroke-opacity": ["case", ["has", "s"], 0.45, 1],
          },
        });
        map.addLayer({
          id: "key-points",
          type: "circle",
          source: "key",
          paint: {
            "circle-color": CATEGORIES.supply.color,
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 5.5, 12, 8, 16, 10],
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
            "circle-opacity": ["case", ["has", "s"], 0.6, 1],
          },
        });

        // national border (Natural Earth outline), under the labels so place names stay readable
        map.addSource("border", { type: "geojson", data: BORDER_URL });
        map.addLayer(
          {
            id: "border",
            type: "line",
            source: "border",
            layout: { "line-join": "round" },
            paint: { "line-color": "#3a3a3c", "line-opacity": 0.55, "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.8, 8, 1.6] },
          },
          map.getStyle().layers.find((l) => l.type === "symbol")?.id,
        );

        // war-time layers; visibility follows the checkmarks
        map.addSource("war-lines", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addSource("war-stores", { type: "geojson", data: { type: "FeatureCollection", features: [] }, promoteId: "id" });
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
        map.addSource("war-exposed", { type: "geojson", data: { type: "FeatureCollection", features: [] }, promoteId: "id" });
        map.addSource("war-threats", { type: "geojson", data: { type: "FeatureCollection", features: [] }, promoteId: "id" });
        // a ring in the risk colour around each exposed distribution site; the dot itself stays the network's
        map.addLayer({
          id: "war-exposed",
          type: "circle",
          source: "war-exposed",
          layout: { visibility: "none" },
          paint: {
            "circle-color": ["get", "color"],
            "circle-opacity": 0.14,
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 6, 12, 11],
            "circle-stroke-width": 2,
            "circle-stroke-color": ["get", "color"],
          },
        });
        map.addLayer({
          id: "war-threat-halo",
          type: "circle",
          source: "war-threats",
          layout: { visibility: "none" },
          paint: { "circle-color": THREAT_COLOR, "circle-opacity": 0.16, "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 9, 10, 16] },
        });
        map.addLayer({
          id: "war-threats",
          type: "circle",
          source: "war-threats",
          layout: { visibility: "none" },
          paint: { "circle-color": THREAT_COLOR, "circle-radius": 4.5, "circle-stroke-width": 1.5, "circle-stroke-color": "#ffffff" },
        });
        map.on("click", "war-threats", (e: MapLayerMouseEvent) => {
          const f = e.features?.[0];
          if (!f) return;
          popupCat.current = null;
          popupRef.current
            ?.setLngLat((f.geometry as unknown as { coordinates: [number, number] }).coordinates)
            .setHTML(threatHtml(f.properties as { kind: string; amount: number; seen: string }))
            .addTo(map);
        });
        map.on("click", "war-exposed", (e: MapLayerMouseEvent) => {
          const f = e.features?.[0];
          // the stores and threats drawn on top win the click
          if (!f || map.queryRenderedFeatures(e.point, { layers: ["war-stores", "war-threats"] }).length) return;
          popupCat.current = null;
          popupRef.current
            ?.setLngLat((f.geometry as unknown as { coordinates: [number, number] }).coordinates)
            .setHTML(exposureHtml(JSON.parse(f.properties.x as string) as Exposure))
            .addTo(map);
        });
        map.addLayer({
          id: "war-halo",
          type: "circle",
          source: "war-stores",
          filter: ["==", ["get", "selected"], true],
          layout: { visibility: "none" },
          paint: { "circle-color": "#ffde00", "circle-opacity": 0.85, "circle-stroke-width": 1.5, "circle-stroke-color": "#000000", "circle-radius": 15 },
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
          if (typeof id === "string") setWarId(id);
        });

        map.on("click", "clusters", async (e: MapLayerMouseEvent) => {
          const f = e.features?.[0];
          if (!f) return;
          const zoom = await (map.getSource("places") as GeoJSONSource).getClusterExpansionZoom(f.properties.cluster_id);
          map.easeTo({ center: (f.geometry as unknown as { coordinates: [number, number] }).coordinates, zoom: zoom + 0.3, duration: 600 });
        });
        const open = (e: MapLayerMouseEvent) => {
          const f = e.features?.[0];
          if (!f) return;
          const coords = (f.geometry as unknown as { coordinates: [number, number] }).coordinates;
          popupCat.current = (f.properties as Props).c;
          popupRef.current?.setLngLat(coords).setHTML(popupHtml(f.properties as Props)).addTo(map);
        };
        // a ring or marker drawn on top (supply partner, exposure, threat, store) wins the click
        const onTop = (e: MapLayerMouseEvent, layers: string[]) =>
          map.queryRenderedFeatures(e.point, { layers: layers.filter((l) => map.getLayoutProperty(l, "visibility") !== "none") }).length > 0;
        map.on("click", "points", (e: MapLayerMouseEvent) => {
          if (!onTop(e, ["key-points", "war-exposed", "war-threats", "war-stores"])) open(e);
        });
        map.on("click", "key-points", (e: MapLayerMouseEvent) => {
          if (!onTop(e, ["war-exposed", "war-threats", "war-stores"])) open(e);
        });
        for (const layer of ["clusters", "points", "key-points", "war-stores", "war-threats", "war-exposed"]) {
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
    const key = (f: Feature) => f.properties.c === "supply";
    (map.getSource("places") as GeoJSONSource).setData({ type: "FeatureCollection", features: visible.filter((f) => !key(f)) });
    (map.getSource("key") as GeoJSONSource).setData({ type: "FeatureCollection", features: visible.filter(key) });
    // close the popup only if its place has just been filtered out
    if (popupCat.current && !inFilter(filter, popupCat.current)) popupRef.current?.remove();
  }, [ready, visible, filter]);

  // show or hide each layer set with its checkmark
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    for (const id of NETWORK_LAYERS) map.setLayoutProperty(id, "visibility", show.network ? "visible" : "none");
    for (const id of WAR_LAYERS) map.setLayoutProperty(id, "visibility", show.war ? "visible" : "none");
  }, [ready, show]);

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
    (map.getSource("war-exposed") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: (exposures ?? []).map((x) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: x.coordinates },
        properties: { id: x.id, color: GRADES[x.grade].color, x: JSON.stringify(x) },
      })),
    });
    (map.getSource("war-threats") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: (threatState?.connected ? threatState.threats : []).map((t) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [t.lon, t.lat] },
        properties: { id: t.id, kind: t.kind, amount: t.amount, seen: t.seen_at ? time(t.seen_at) : "" },
      })),
    });
  }, [ready, exposures, threatState]);

  const focusExposure = (x: Exposure) => {
    const map = mapRef.current;
    if (!map) return;
    requestAnimationFrame(() => {
      map.flyTo({ center: x.coordinates, zoom: 11, duration: 1200, essential: true, offset: cardOffset(container.current, card.current) });
      popupCat.current = null;
      popupRef.current?.setLngLat(x.coordinates).setHTML(exposureHtml(x)).addTo(map);
    });
  };

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
        className="absolute left-3 right-3 top-3 z-10 rounded-[14px] bg-[rgba(255,255,255,0.92)] p-3 shadow-[0_8px_30px_rgba(0,0,0,0.12),0_0_0_0.5px_rgba(0,0,0,0.06)] backdrop-blur-xl max-h-[46%] overflow-y-auto overscroll-contain md:left-4 md:max-h-[calc(100%-var(--nav-clear)-36px)] md:right-auto md:top-4 md:w-[380px]"
      >
        <div aria-label="Show on map" role="group" className="mb-3 flex gap-2">
          {(["network", "war"] as const).map((m) => {
            const on = show[m];
            const last = on && !show[m === "network" ? "war" : "network"];
            return (
              <button
                key={m}
                role="checkbox"
                aria-checked={on}
                aria-disabled={last || undefined}
                title={last ? "At least one layer stays on" : undefined}
                onClick={() => {
                  if (last) return;
                  if (on) popupRef.current?.remove();
                  setShow((v) => ({ ...v, [m]: !on }));
                }}
                className={`t-footnote flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-full px-2.5 font-medium transition-colors ${
                  on ? "bg-ink text-white" : "bg-fill text-label-2 hover:text-label"
                }`}
              >
                <span
                  aria-hidden
                  className={`grid size-[16px] place-items-center rounded-full transition-colors ${on ? "bg-yellow text-ink" : "border-[1.5px] border-muted"}`}
                >
                  {on && <CheckIcon size={10} />}
                </span>
                {m === "network" ? "Supply network" : "War-time risk"}
              </button>
            );
          })}
        </div>

        <section aria-label="Map legend" className="mb-3 rounded-[10px] border border-separator bg-white/75 px-2.5 py-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {show.network && (
              <>
                {[
                  ["A", "Avrora", CATEGORIES.avrora.color],
                  ["S", "Storage & logistics", CATEGORIES.warehouse.color],
                  ["F", "Food", CATEGORIES.food.color],
                ].map(([letter, label, color]) => (
                  <span key={label} className="t-caption inline-flex items-center gap-1 text-label-2">
                    <span className="grid size-[17px] place-items-center rounded-full text-[10px] font-bold leading-none text-white" style={{ background: color }}>
                      {letter}
                    </span>
                    {label}
                  </span>
                ))}
                <span className="t-caption inline-flex items-center gap-1 text-label-2">
                  <span className="size-2.5 rounded-full border border-white" style={{ background: CATEGORIES.supply.color }} />
                  Supply
                </span>
                <span className="t-caption inline-flex items-center gap-1 text-label-2">
                  <span className="size-2.5 rounded-full border border-white" style={{ background: CATEGORIES.logistics.color }} />
                  Logistics
                </span>
              </>
            )}
            {show.war && (
              <>
                <span className="t-caption inline-flex items-center gap-1 text-label-2">
                  <span className="size-3 rounded-full border-2 border-[#ff3b30] bg-[rgba(255,59,48,0.14)]" />
                  Risk site
                </span>
                <span className="t-caption inline-flex items-center gap-1 text-label-2">
                  <span className="size-2.5 rounded-full" style={{ background: THREAT_COLOR }} />
                  Aerial threat
                </span>
                <span className="t-caption inline-flex items-center gap-1 text-label-2">
                  <span className="h-0.5 w-4 rounded-full bg-[#d70015]" />
                  Front line
                </span>
              </>
            )}
          </div>
          {show.war && (
            <p className="t-caption mt-1.5 border-t border-separator pt-1.5 text-label-2">
              Risk rings mark supply sites affected by front-line distance or a nearby active threat. Select one to see why and the recommended action.
            </p>
          )}
        </section>

        {show.network && (
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
              className={`t-caption relative flex min-h-[32px] flex-1 items-center justify-center gap-1 rounded-[7px] px-1 py-[5px] font-medium transition-colors ${filter === f ? "text-white" : "text-label"}`}
            >
              {filter === f && (
                <motion.span
                  layoutId="map-seg"
                  className="absolute inset-0 rounded-[7px] bg-ink"
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

        {show.war && (
          <div className={show.network ? "mt-3 border-t border-separator pt-3" : ""}>
            {!selectedWar && (show.network ? <h2 className="t-headline px-1">War-time risk</h2> : <h1 className="t-headline px-1">War-time risk</h1>)}
            <WartimePanel
              rated={rated}
              alerts={alertState}
              threats={threatState}
              exposures={exposures}
              failed={warFailed}
              selected={selectedWar}
              onSelect={setWarId}
              onExposure={focusExposure}
            />
          </div>
        )}
      </motion.div>

      <button
        onClick={toStore}
        className="t-subhead float absolute bottom-[calc(var(--nav-clear)+44px)] right-[10px] md:bottom-[calc(var(--nav-clear)+124px)] z-10 flex min-h-[44px] items-center gap-2 rounded-full bg-ink py-1.5 pl-1.5 pr-4 font-semibold text-white"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- static export, SVG mark */}
        <img src="/avrora-mark.svg" alt="" width={24} height={24} className="size-7 rounded-full bg-yellow p-[3px]" />
        Your store
      </button>
    </div>
  );
}
