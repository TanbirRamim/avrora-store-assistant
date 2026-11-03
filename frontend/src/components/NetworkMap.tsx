"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { FilterSpecification, GeoJSONSource, Map as MapLibre, MapLayerMouseEvent, Popup } from "maplibre-gl";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { BoxIcon, CloseIcon } from "./icons";
import { type Rated, WartimePanel } from "./WartimePanel";
import { fetcher } from "@/lib/api";
import { ALERTS_URL, type Alerts, assess, GRADES, LINES_URL, type LineFeature, STORES_URL, type WarStore, ZONES } from "@/lib/wartime";

/**
 * Ukraine supply network: public OpenStreetMap department stores, warehouses and logistics
 * centres around the store. MapLibre draws everything on the GPU, so 6,000 points and their
 * clusters stay smooth while zooming. Tiles: OpenFreeMap (free, no key).
 *
 * War-time mode swaps those layers for sample Avrora stores rated by distance to the front line
 * and, when the server is connected to alerts.in.ua, live air-raid alerts (see lib/wartime.ts).
 */

type Category = "store" | "warehouse" | "logistics";

interface Props {
  c: Category;
  id: string;
  n?: string;
  a?: string;
  o?: string;
  b?: string;
  w?: string;
  s?: string;
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

export const CATEGORIES: Record<Category, { label: string; one: string; color: string }> = {
  store: { label: "Stores", one: "Department store", color: "#ff9500" },
  warehouse: { label: "Warehouses", one: "Warehouse", color: "#5856d6" },
  logistics: { label: "Logistics", one: "Logistics centre", color: "#0a9396" },
};

const STATUS: Record<string, string> = { disused: "Disused", abandoned: "Abandoned", ruins: "Ruins" };

type Filter = Category | "all";
const FILTERS: Filter[] = ["all", "store", "warehouse", "logistics"];

type Mode = "network" | "war";
const NETWORK_LAYERS = ["clusters", "cluster-count", "points"];
const WAR_LAYERS = ["war-yellow", "war-orange", "war-red", "war-line", "war-halo", "war-stores"];

const fmt = new Intl.NumberFormat("en-US");

function popupHtml(p: Props) {
  const cat = CATEGORIES[p.c];
  const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  const [type, osmId] = p.id.split("/");
  const rows = [
    p.a && `<div class="nm-row">${esc(p.a)}</div>`,
    (p.o || p.b) && `<div class="nm-row">Operator: ${esc(p.o || p.b!)}</div>`,
    p.s && `<div class="nm-row nm-status">${STATUS[p.s] ?? esc(p.s)}</div>`,
  ].filter(Boolean);
  return `
    <div class="nm-kind" style="color:${cat.color}"><span class="nm-dot" style="background:${cat.color}"></span>${cat.one}</div>
    <div class="nm-name">${esc(p.n ?? "No name in OpenStreetMap")}</div>
    ${rows.join("")}
    <a class="nm-link" href="https://www.openstreetmap.org/${type}/${osmId}" target="_blank" rel="noopener noreferrer">View on OpenStreetMap</a>`;
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
  const { data: alerts, error: alertsError } = useSWR<Alerts>(mode === "war" ? ALERTS_URL : null, fetcher, {
    refreshInterval: 60_000,
  });
  const alertState = useMemo<Alerts | undefined>(
    () => (alertsError ? { connected: false, reason: "unavailable" } : alerts),
    [alerts, alertsError],
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

  const counts = useMemo(() => {
    const c = { all: 0, store: 0, warehouse: 0, logistics: 0 } as Record<Filter, number>;
    for (const f of features ?? []) {
      c[f.properties.c]++;
      c.all++;
    }
    return c;
  }, [features]);

  const visible = useMemo(
    () => (features ?? []).filter((f) => filter === "all" || f.properties.c === filter),
    [features, filter],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return visible
      .filter((f) => [f.properties.n, f.properties.a, f.properties.o, f.properties.b].some((v) => v?.toLowerCase().includes(q)))
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
      el.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9"/></svg>`;
      new maplibre.Marker({ element: el }).setLngLat(STORE).addTo(map);

      popupRef.current = new maplibre.Popup({ closeButton: false, maxWidth: "280px", offset: 10, className: "nm-popup" });

      map.on("error", (e) => console.warn("map:", e.error?.message));
      map.on("load", () => {
        map.addSource("places", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
          cluster: true,
          clusterRadius: 44,
          clusterMaxZoom: 13,
          promoteId: "id",
        });
        map.addLayer({
          id: "clusters",
          type: "circle",
          source: "places",
          filter: ["has", "point_count"],
          paint: {
            "circle-color": "rgba(28,28,30,0.86)",
            "circle-radius": ["step", ["get", "point_count"], 13, 25, 16, 150, 19, 600, 23],
            "circle-stroke-width": 1.5,
            "circle-stroke-color": "#ffffff",
            "circle-radius-transition": { duration: 300 },
          },
        });
        map.addLayer({
          id: "cluster-count",
          type: "symbol",
          source: "places",
          filter: ["has", "point_count"],
          layout: {
            "text-field": ["get", "point_count_abbreviated"],
            "text-font": ["Noto Sans Bold"],
            "text-size": ["step", ["get", "point_count"], 11, 150, 12],
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
            "circle-color": ["match", ["get", "c"], "store", CATEGORIES.store.color, "logistics", CATEGORIES.logistics.color, CATEGORIES.warehouse.color],
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 4, 12, 6, 16, 8],
            "circle-stroke-width": 1.5,
            "circle-stroke-color": "#ffffff",
            "circle-opacity": ["case", ["has", "s"], 0.45, 1],
            "circle-stroke-opacity": ["case", ["has", "s"], 0.45, 1],
          },
        });

        // war-time layers, hidden until that mode is chosen
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
          if (typeof id === "string") setWarId(id);
        });

        map.on("click", "clusters", async (e: MapLayerMouseEvent) => {
          const f = e.features?.[0];
          if (!f) return;
          const zoom = await (map.getSource("places") as GeoJSONSource).getClusterExpansionZoom(f.properties.cluster_id);
          map.easeTo({ center: (f.geometry as unknown as { coordinates: [number, number] }).coordinates, zoom: zoom + 0.3, duration: 600 });
        });
        map.on("click", "points", (e: MapLayerMouseEvent) => {
          const f = e.features?.[0];
          if (!f) return;
          const coords = (f.geometry as unknown as { coordinates: [number, number] }).coordinates;
          popupCat.current = (f.properties as Props).c;
          popupRef.current?.setLngLat(coords).setHTML(popupHtml(f.properties as Props)).addTo(map);
        });
        for (const layer of ["clusters", "points", "war-stores"]) {
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
    (map.getSource("places") as GeoJSONSource).setData({ type: "FeatureCollection", features: visible });
    // close the popup only if its place has just been filtered out
    if (popupCat.current && filter !== "all" && popupCat.current !== filter) popupRef.current?.remove();
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
            <WartimePanel rated={rated} alerts={alertState} failed={warFailed} selected={selectedWar} onSelect={setWarId} />
          </>
        ) : (
          <>
        <h1 className="t-headline px-1">Supply network</h1>
        <p className="t-footnote px-1 text-label-2">
          {features ? `${fmt.format(counts.all)} places in Ukraine from OpenStreetMap` : failed ? "The map data could not be loaded." : "Loading places…"}
        </p>

        <div role="tablist" aria-label="Show on map" className="mt-3 flex rounded-[9px] bg-fill p-[2px]">
          {FILTERS.map((f) => (
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
              {f !== "all" && <span className="relative size-2 rounded-full" style={{ background: CATEGORIES[f].color }} />}
              <span className="relative">{f === "all" ? "All" : CATEGORIES[f].label}</span>
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
            placeholder="Search name, address or operator"
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
                    <span className="t-subhead block truncate">{f.properties.n ?? CATEGORIES[f.properties.c].one}</span>
                    <span className="t-caption block truncate text-label-2">{f.properties.a ?? CATEGORIES[f.properties.c].one}</span>
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
        <span className="icon-tile size-6 rounded-full" style={{ background: "var(--order)" }}>
          <BoxIcon size={13} />
        </span>
        Your store
      </button>
    </div>
  );
}
